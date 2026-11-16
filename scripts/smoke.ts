// End-to-end smoke test for the plugin, run with `bun run`.
//
// It registers the real plugin against a minimal fake Context, then invokes
// the registered tool executors the way OpenCode would. This exercises the
// actual shipped code paths: tool registration, program compilation, the
// app-server handshake, and both surfaces over `node_repl`.
//
// Run: bun scripts/smoke.ts

import plugin from "../src/plugin";

interface RegisteredTool {
  readonly name: string;
  readonly options?: { readonly namespace?: string };
  execute(input: unknown, context: unknown): Promise<{ content?: unknown }>;
}

// An event stream that stays open until the plugin unloads. The plugin
// subscribes for turn-end events and then forgets about it; only the returned
// cleanup's abort ends the stream, which is what unblocks `setup`'s watcher.
const eventStream = (options: {
  readonly signal: AbortSignal;
}): AsyncIterable<{ readonly type: string }> => ({
  [Symbol.asyncIterator]: (): AsyncIterator<{ readonly type: string }> => ({
    next: async () => {
      if (!options.signal.aborted) {
        await new Promise<void>((resolve) =>
          options.signal.addEventListener("abort", () => resolve(), { once: true }),
        );
      }
      return { done: true, value: undefined };
    },
  }),
});

const namespaces: unknown[] = [];
const tools: RegisteredTool[] = [];

const fakeContext = {
  options: {},
  tool: {
    transform: async (callback: (editor: unknown) => void) => {
      callback({
        namespace: (namespace: unknown) => namespaces.push(namespace),
        add: (tool: RegisteredTool) => tools.push(tool),
        list: () => [],
        get: () => undefined,
        update: () => undefined,
        remove: () => undefined,
      });
    },
  },
  event: {
    subscribe: eventStream,
  },
};

const cleanup = await (
  plugin as unknown as {
    setup(ctx: unknown): Promise<(() => Promise<void>) | void>;
  }
).setup(fakeContext);

console.log("namespaces:", namespaces);
console.log(
  "tools:",
  tools.map((tool) => `${tool.options?.namespace ?? "?"}:${tool.name}`).join(", "),
);

const byId = new Map(tools.map((tool) => [`${tool.options?.namespace ?? "?"}:${tool.name}`, tool]));

const call = async (id: string, input: unknown): Promise<string> => {
  const tool = byId.get(id);
  if (tool === undefined) throw new Error(`tool not registered: ${id}`);
  const result = await tool.execute(input, { progress: async () => undefined });
  return typeof result.content === "string" ? result.content : JSON.stringify(result);
};

// Count entries without echoing app names, tab URLs, or other user state.
const count = (text: string): string => {
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) return `${parsed.length} entries`;
  } catch {
    // Not JSON; fall back to the line count below.
  }
  return `${text.split("\n").filter((line) => line.trim() !== "").length} lines`;
};

const STOP_RESPONSE = "Released the Codex control sessions for this turn.";

let stop: string | undefined;
try {
  try {
    const apps = await call("computer_use:list_apps", {});
    console.log("\ncomputer_use:list_apps ->", count(apps));

    const tabs = await call("chrome:list_tabs", {});
    console.log("chrome:list_tabs ->", count(tabs));
  } finally {
    // Release explicitly, the way a caller should, even if a list call fails;
    // the turn-end watcher covers the implicit path.
    stop = await call("computer_use:stop", {});
    console.log("computer_use:stop ->", stop);
  }

  // Hold the plugin to the response it documents.
  if (stop !== STOP_RESPONSE) {
    throw new Error(`unexpected computer_use:stop response: ${stop}`);
  }
} finally {
  await cleanup?.();
}

console.log("\nsmoke ok");
