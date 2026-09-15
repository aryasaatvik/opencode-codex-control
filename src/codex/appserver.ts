// Codex app-server bridge.
//
// Computer Use and Chrome are not MCP servers a client can spawn. Since the
// 2026-08-28 Codex update the Computer Use service only honours calls from a
// session registered by a Codex host process, and Chrome ships no server at
// all. The supported path is `codex app-server` — Codex's own JSON-RPC front
// end — whose `mcpServer/tool/call` invokes a plugin tool directly with no
// model turn and no inference.
//
// Both surfaces are driven through the bundled `node_repl` server's `js`
// tool: the program compiled by `tools/computer-use`/`tools/chrome` runs
// inside it, imports `@oai/sky` or the Chrome browser client, and writes one
// JSON value back. Chrome additionally refuses to run without Codex turn
// metadata, which this bridge supplies because it starts no turns.
//
// The wire is newline-delimited JSON managed here. It is NOT MCP-shaped
// (`_meta: null`, its own notification families), so it cannot go through a
// generic MCP stdio transport.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import { permissionFailure, permissionFailureMessage } from "./permissions";

export interface ElicitationRequest {
  readonly message: string;
  readonly mode?: string;
  readonly url?: string;
  readonly meta: Record<string, unknown>;
  readonly requestedSchema?: unknown;
}

export type ElicitationAction = "accept" | "decline" | "cancel";

export interface CodexAppServerConfig {
  /** The `codex` CLI to spawn. */
  readonly codexCli: string;
  /** Value for the child's `CODEX_HOME`; omitted leaves the inherited one. */
  readonly codexHome?: string;
  /**
   * How to answer a plugin approval prompt. Defaults to accepting: the
   * OpenCode tool call the user already allowed is the consent boundary, so
   * Codex's own prompt is redundant here.
   */
  readonly onElicitation?: (
    request: ElicitationRequest,
  ) => ElicitationAction | Promise<ElicitationAction>;
  /** Diagnostics: startup transitions and other notifications. */
  readonly onLog?: (message: string) => void;
}

/** An image the tool emitted, shaped as an OpenCode file content part. */
export interface ToolAttachment {
  readonly type: "file";
  readonly uri: string;
  readonly mime: string;
}

export interface ToolCallResult {
  /** The joined text content of the tool call. */
  readonly text: string;
  /** Image content blocks, as OpenCode file parts (data URIs, or a file URL). */
  readonly attachments: ReadonlyArray<ToolAttachment>;
  readonly isError: boolean;
  readonly structuredContent?: unknown;
  readonly meta?: unknown;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface RpcMessage {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

const INITIALIZE_TIMEOUT_MS = 30_000;
const DEFAULT_CALL_TIMEOUT_MS = 60_000;

/** `mcpServer/startupStatus/updated` — Codex reports every server it runs. */
const STARTUP_STATUS_METHOD = "mcpServer/startupStatus/updated";

export class CodexAppServer {
  readonly #config: CodexAppServerConfig;
  #child: ReturnType<typeof spawn> | undefined;
  #stdoutBuffer = "";
  #stderrTail = "";
  #nextId = 1;
  #threadId: string | undefined;
  /** The thread's session id, which Codex's Computer Use and Chrome clients read
   *  from request metadata to scope their application sessions. */
  #sessionId: string | undefined;
  #starting: Promise<void> | undefined;
  #ready = false;
  #closed = false;
  #queue: Promise<unknown> = Promise.resolve();
  /** One turn id shared by every call until the turn is ended, mirroring
   *  Codex's single `turn_id` per prompt rather than one per call. */
  #turnId: string | undefined;
  readonly #pending = new Map<number, Pending>();

  constructor(config: CodexAppServerConfig) {
    this.#config = config;
  }

  get threadId(): string | undefined {
    return this.#threadId;
  }

  /** Start and hand-shake on first use; a warm instance is a no-op. */
  async ensureReady(): Promise<void> {
    if (this.#closed) throw new Error("The Codex app-server connection has been closed.");
    if (this.#ready) return;
    this.#starting ??= this.#handshake();
    await this.#starting;
  }

  async #handshake(): Promise<void> {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(this.#config.codexCli, ["app-server"], {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          ...(this.#config.codexHome === undefined ? {} : { CODEX_HOME: this.#config.codexHome }),
        },
      });
    } catch (error) {
      throw new Error(
        `Could not start the Codex app-server with "${this.#config.codexCli}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    this.#child = child;
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => this.#onStdout(chunk));
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      // Keep a short tail so a startup failure can explain itself.
      this.#stderrTail = (this.#stderrTail + chunk).slice(-2000);
    });
    child.stdin?.on("error", () => undefined);
    child.stdout?.on("error", () => undefined);
    child.on("error", (error: Error) => this.#failAll(error));
    child.on("exit", () => this.#failAll(new Error("Codex app-server exited.")));

    await this.#request(
      "initialize",
      { clientInfo: { name: "opencode", title: "OpenCode", version: "0.1.0" } },
      INITIALIZE_TIMEOUT_MS,
    );
    this.#notify("initialized", {});
    const started = (await this.#request(
      "thread/start",
      // `approvalPolicy: "on-request"` is load-bearing: on a thread whose
      // policy declines MCP elicitations, Codex answers every plugin prompt
      // itself and never forwards it, surfacing as an unexplained denial on
      // any tool that asks.
      { sessionStartSource: "startup", approvalPolicy: "on-request" },
      INITIALIZE_TIMEOUT_MS,
    )) as { thread?: { id?: string; session_id?: string } } | undefined;
    const threadId = started?.thread?.id;
    if (typeof threadId !== "string") {
      throw new Error("Codex app-server returned no thread id from thread/start.");
    }
    this.#threadId = threadId;
    this.#sessionId =
      typeof started?.thread?.session_id === "string" ? started.thread.session_id : threadId;
    this.#ready = true;
  }

  /**
   * Call one tool on one Codex MCP server.
   *
   * `_meta` carries Codex turn metadata because the Chrome client refuses to
   * run without it. The turn id is stable for the whole OpenCode turn so the
   * Computer Use and Chrome sessions stay alive across many calls, exactly as
   * they do inside one Codex turn.
   */
  async callTool(
    server: string,
    tool: string,
    args: unknown,
    options?: { readonly timeoutMs?: number },
  ): Promise<ToolCallResult> {
    await this.ensureReady();
    const timeoutMs = options?.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
    const turnId = this.#ensureTurnId();
    return this.#serialize(async () => {
      const reply = await this.#request(
        "mcpServer/tool/call",
        {
          threadId: this.#threadId,
          server,
          tool,
          arguments: args ?? {},
          _meta: this.#requestMeta(turnId),
        },
        timeoutMs,
      );
      return normalizeToolCall(reply);
    });
  }

  #ensureTurnId(): string {
    return (this.#turnId ??= randomUUID());
  }

  /**
   * Codex's MCP request metadata. The Computer Use and Chrome clients read
   * `nodeRepl.requestMeta` and key their application sessions on `sessionId`
   * and `threadId`, so a call without them is scoped to the wrong (or no)
   * session — which is how a user stop can appear to stick to an app.
   */
  #requestMeta(turnId: string): Record<string, unknown> {
    const sessionId = this.#sessionId ?? this.#threadId;
    return {
      callId: randomUUID(),
      sessionId,
      threadId: this.#threadId,
      "x-codex-turn-metadata": {
        session_id: sessionId,
        thread_id: this.#threadId,
        turn_id: turnId,
      },
    };
  }

  /**
   * End the current turn, releasing the Computer Use and Chrome sessions.
   *
   * This mirrors Codex's `Stop`/`Interrupt` hooks, which call the hidden
   * `node_repl` `turn_ended` tool with the turn's session and turn ids.
   * Without it the sessions outlive their use and the user has to stop them.
   * A no-op when no turn is active, so it is safe to call on every turn end.
   */
  async endTurn(): Promise<void> {
    const turnId = this.#turnId;
    if (turnId === undefined || this.#threadId === undefined || this.#closed) return;
    this.#turnId = undefined;
    try {
      await this.#serialize(async () => {
        await this.#request(
          "mcpServer/tool/call",
          {
            threadId: this.#threadId,
            server: "node_repl",
            tool: "turn_ended",
            arguments: {
              hook_event_name: "Stop",
              session_id: this.#sessionId ?? this.#threadId,
              turn_id: turnId,
            },
            _meta: this.#requestMeta(turnId),
          },
          DEFAULT_CALL_TIMEOUT_MS,
        );
      });
    } catch (error) {
      // Keep the turn so a later release can retry: `turn_ended` is idempotent,
      // and without this an RPC failure or timeout would drop the only id that
      // identifies the turn, leaving the session to outlive it. A new turn may
      // already have claimed the slot, so only restore when it is still empty.
      this.#turnId ??= turnId;
      throw error;
    }
  }

  /** Run one JavaScript program in Codex's `node_repl`. */
  async callJs(program: {
    readonly code: string;
    readonly title: string;
    readonly timeoutMs?: number;
  }): Promise<ToolCallResult> {
    const timeoutMs = program.timeoutMs ?? 30_000;
    return this.callTool(
      "node_repl",
      "js",
      {
        code: program.code,
        title: program.title,
        ...(program.timeoutMs === undefined ? {} : { timeout_ms: program.timeoutMs }),
      },
      // Leave headroom under the caller so a slow page fails as a page error
      // rather than an abandoned request.
      { timeoutMs: timeoutMs + 20_000 },
    );
  }

  async close(): Promise<void> {
    this.#closed = true;
    const child = this.#child;
    this.#child = undefined;
    if (child === undefined) return;
    child.stdin?.end();
    child.kill("SIGTERM");
    const escalate = setTimeout(() => child.kill("SIGKILL"), 3000);
    escalate.unref?.();
  }

  /** Serialize calls: one real desktop and one real browser can only be
   *  driven by one action at a time, however many OpenCode sessions exist. */
  #serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(fn, fn);
    this.#queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  #request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const child = this.#child;
    if (child === undefined || this.#closed) {
      return Promise.reject(new Error("Codex app-server is not running."));
    }
    const id = this.#nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        const tail = this.#stderrTail.trim();
        reject(
          new Error(
            `Codex app-server did not answer ${method} within ${timeoutMs}ms.${
              tail.length === 0 ? "" : `\n${tail}`
            }`,
          ),
        );
      }, timeoutMs);
      this.#pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.#send({ jsonrpc: "2.0", id, method, params });
    });
  }

  #notify(method: string, params: unknown): void {
    this.#send({ jsonrpc: "2.0", method, params });
  }

  #send(message: unknown): void {
    this.#child?.stdin?.write(`${JSON.stringify(message)}\n`, () => undefined);
  }

  #onStdout(chunk: string): void {
    this.#stdoutBuffer += chunk;
    const lines = this.#stdoutBuffer.split("\n");
    this.#stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      let message: RpcMessage;
      try {
        message = JSON.parse(trimmed) as RpcMessage;
      } catch {
        continue;
      }
      this.#dispatch(message);
    }
  }

  #dispatch(message: RpcMessage): void {
    const isResponse =
      message.method === undefined &&
      typeof message.id === "number" &&
      (message.result !== undefined || message.error !== undefined);
    if (isResponse) {
      const pending = this.#pending.get(message.id as number);
      if (pending === undefined) return;
      this.#pending.delete(message.id as number);
      if (message.error === undefined) {
        pending.resolve(message.result);
      } else {
        pending.reject(new Error(rpcErrorMessage(message.error)));
      }
      return;
    }
    if (message.method !== undefined && message.id !== undefined) {
      void this.#handleServerRequest(message);
      return;
    }
    if (message.method !== undefined) {
      this.#handleNotification(message.method, message.params);
    }
  }

  async #handleServerRequest(message: RpcMessage): Promise<void> {
    if (message.method === "mcpServer/elicitation/request") {
      const action = await this.#answerElicitation(message.params);
      this.#send({ jsonrpc: "2.0", id: message.id, result: { action } });
      return;
    }
    // The bridge starts no turns, so there is nothing else it can answer.
    this.#send({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32601, message: `OpenCode does not handle ${message.method}` },
    });
  }

  async #answerElicitation(rawParams: unknown): Promise<ElicitationAction> {
    const params = (rawParams ?? {}) as Record<string, unknown>;
    const meta =
      params["_meta"] !== null && typeof params["_meta"] === "object"
        ? (params["_meta"] as Record<string, unknown>)
        : {};
    const connector =
      typeof meta["connector_name"] === "string" ? (meta["connector_name"] as string) : undefined;
    const message =
      typeof params["message"] === "string"
        ? (params["message"] as string)
        : `Approve this ${connector ?? "Codex"} request?`;
    const request: ElicitationRequest = {
      message,
      mode: typeof params["mode"] === "string" ? (params["mode"] as string) : undefined,
      url: typeof params["url"] === "string" ? (params["url"] as string) : undefined,
      meta,
      requestedSchema: params["requestedSchema"],
    };
    const decided = await this.#config.onElicitation?.(request);
    this.#config.onLog?.(
      `Codex approval ${decided ?? "accept"}${connector === undefined ? "" : ` (${connector})`}: ${message}`,
    );
    return decided ?? "accept";
  }

  #handleNotification(method: string, params: unknown): void {
    if (method !== STARTUP_STATUS_METHOD) return;
    const entry = (params ?? {}) as { name?: unknown; status?: unknown };
    if (typeof entry.name !== "string" || typeof entry.status !== "string") return;
    this.#config.onLog?.(`Codex MCP server ${entry.name} is ${entry.status}`);
  }

  #failAll(error: Error): void {
    this.#ready = false;
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }
}

const normalizeToolCall = (raw: unknown): ToolCallResult => {
  const result = (raw ?? {}) as {
    content?: unknown;
    structuredContent?: unknown;
    isError?: unknown;
    _meta?: unknown;
  };
  const content = Array.isArray(result.content) ? result.content : [];
  const texts: string[] = [];
  const attachments: ToolAttachment[] = [];
  for (const block of content) {
    const b = block as {
      type?: unknown;
      text?: unknown;
      data?: unknown;
      mimeType?: unknown;
      url?: unknown;
    };
    if (typeof b.text === "string" && b.text.length > 0) {
      texts.push(b.text);
      continue;
    }
    // The node_repl `js` tool emits images via `nodeRepl.emitImage`. Preserve
    // them: a screenshot the model cannot see is worse than no tool at all.
    if (b.type !== "image") continue;
    const mime = typeof b.mimeType === "string" ? b.mimeType : "image/png";
    if (typeof b.data === "string") {
      attachments.push({ type: "file", uri: `data:${mime};base64,${b.data}`, mime });
    } else if (typeof b.url === "string") {
      attachments.push({ type: "file", uri: b.url, mime });
    }
  }
  return {
    text: texts.join("\n"),
    attachments,
    isError: result.isError === true,
    ...(result.structuredContent === undefined
      ? {}
      : { structuredContent: result.structuredContent }),
    ...(result._meta === undefined ? {} : { meta: result._meta }),
  };
};

const rpcErrorMessage = (error: unknown): string => {
  const e = (error ?? {}) as { message?: unknown; data?: unknown };
  const message = typeof e.message === "string" ? e.message : JSON.stringify(error);
  return typeof e.data === "string" && e.data.length > 0 ? `${message} (${e.data})` : message;
};

/** Throw an actionable error for a failed tool call, translating macOS
 *  permission denials into the exact System Settings entry to enable. */
export const toolCallError = (
  result: ToolCallResult,
  surface: string | undefined,
): Error | undefined => {
  if (!result.isError) return undefined;
  const text = result.text.length > 0 ? result.text : "The Codex tool call failed.";
  const permission = permissionFailure(text, surface);
  return new Error(permission === null ? text : permissionFailureMessage(permission));
};
