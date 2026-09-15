// Owns the Codex app-server connection and turns tool calls into results.
//
// One connection per plugin instance. `CodexAppServer` serializes calls inside
// it, so concurrent OpenCode sessions cannot interleave desktop or browser
// actions. The connection is created lazily on the first tool call and closed
// when the plugin unloads.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { CodexAppServer, toolCallError } from "./codex/appserver";
import { detectInstall, setupHint } from "./codex/install";
import type { ComputerUseTool } from "./tools/computer-use";
import { computerUseProgram } from "./tools/computer-use";
import type { ChromeTool } from "./tools/chrome";
import { chromeProgram } from "./tools/chrome";

export const COMPUTER_USE_NAMESPACE = "computer_use";
export const CHROME_NAMESPACE = "chrome";

/**
 * A tool result as OpenCode consumes it. Text alone is enough for most tools;
 * screenshots need a `file` part because a `file://` path in the text is not
 * rendered — see `screenshotContent` below.
 */
export type ToolContentPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string };

export type ToolContent = string | ReadonlyArray<ToolContentPart>;

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const mimeForPath = (path: string): string => {
  const dot = path.lastIndexOf(".");
  return (
    (dot === -1 ? undefined : MIME_BY_EXTENSION[path.slice(dot).toLowerCase()]) ??
    "application/octet-stream"
  );
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** The screenshot URL Computer Use returns, when the state carried one. */
const computerUseScreenshotUrl = (text: string): string | undefined => {
  const value = parseJson(text) as { screenshot?: { url?: unknown } } | undefined;
  const url = value?.screenshot?.url;
  return typeof url === "string" ? url : undefined;
};

/**
 * Text plus an image content part, so the model can actually see the
 * screenshot instead of receiving an unreadable `file://` string.
 *
 * The bytes are read here, in the plugin's own process, and inlined as a data
 * URI. A `file://` part does not render, and the Codex REPL sandbox refuses the
 * filesystem writes an in-REPL `emitImage` would otherwise need.
 */
const screenshotContent = async (text: string, url: string): Promise<ToolContent> => {
  const mime = mimeForPath(url);
  try {
    const bytes = await readFile(fileURLToPath(url));
    return [
      { type: "text", text },
      { type: "file", uri: `data:${mime};base64,${bytes.toString("base64")}`, mime },
    ];
  } catch {
    // Keep the URL visible rather than failing the whole read.
    return [{ type: "text", text }];
  }
};

export interface PluginSettings {
  readonly codexHome?: string;
  readonly codexCli?: string;
  readonly computerUse: boolean;
  readonly chrome: boolean;
}

export class Controller {
  readonly #settings: PluginSettings;
  #server: CodexAppServer | undefined;

  constructor(settings: PluginSettings) {
    this.#settings = settings;
  }

  #bridge(): CodexAppServer {
    this.#server ??= new CodexAppServer({
      codexCli: this.#settings.codexCli ?? "codex",
      ...(this.#settings.codexHome === undefined ? {} : { codexHome: this.#settings.codexHome }),
      onLog: (message) => console.log(`[codex-control] ${message}`),
    });
    return this.#server;
  }

  async callComputerUse(tool: ComputerUseTool, input: unknown): Promise<ToolContent> {
    const install = detectInstall(this.#settings);
    if (install.cli === undefined) throw new Error(setupHint("codex"));
    if (!install.computerUse) throw new Error(setupHint("computer-use"));
    const result = await this.#bridge().callJs({
      code: computerUseProgram(tool, input),
      title: `Computer Use: ${tool.name}`,
    });
    const error = toolCallError(result, COMPUTER_USE_NAMESPACE);
    if (error !== undefined) throw error;
    const url = tool.screenshot ? computerUseScreenshotUrl(result.text) : undefined;
    return url === undefined ? result.text : await screenshotContent(result.text, url);
  }

  async callChrome(tool: ChromeTool, input: unknown): Promise<ToolContent> {
    const install = detectInstall(this.#settings);
    if (install.cli === undefined) throw new Error(setupHint("codex"));
    if (!install.chrome) throw new Error(setupHint("chrome"));
    const result = await this.#bridge().callJs({
      code: chromeProgram(tool, input, install.chromeModulePath),
      title: `Chrome: ${tool.name}`,
      // Real navigation routinely outruns the REPL's 30s default; a page load
      // plus its DOM pass needs the longer budget.
      timeoutMs: 55_000,
    });
    const error = toolCallError(result, CHROME_NAMESPACE);
    if (error !== undefined) throw error;
    const attachments = tool.screenshot ? result.attachments : [];
    return attachments.length === 0
      ? result.text
      : [{ type: "text", text: result.text }, ...attachments];
  }

  /**
   * End the current turn, releasing the Computer Use and Chrome sessions.
   *
   * No-op when nothing has run yet, so the plugin can call it on every turn
   * end and on an explicit stop request without tracking state itself.
   */
  async releaseTurn(): Promise<void> {
    const server = this.#server;
    if (server === undefined) return;
    await server.endTurn();
  }

  async close(): Promise<void> {
    const server = this.#server;
    this.#server = undefined;
    await server?.close();
  }
}

export const readSettings = (options: unknown): PluginSettings => {
  const o = (options ?? {}) as Record<string, unknown>;
  return {
    ...(typeof o["codexHome"] === "string" ? { codexHome: o["codexHome"] } : {}),
    ...(typeof o["codexCli"] === "string" ? { codexCli: o["codexCli"] } : {}),
    computerUse: o["computerUse"] !== false,
    chrome: o["chrome"] !== false,
  };
};
