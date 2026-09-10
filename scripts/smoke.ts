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
};

const cleanup = await (plugin as unknown as {
  setup(ctx: unknown): Promise<(() => Promise<void>) | void>;
}).setup(fakeContext);

console.log("namespaces:", namespaces);
console.log(
  "tools:",
  tools.map((tool) => `${tool.options?.namespace ?? "?"}:${tool.name}`).join(", "),
);

const byId = new Map(
  tools.map((tool) => [`${tool.options?.namespace ?? "?"}:${tool.name}`, tool]),
);

const call = async (id: string, input: unknown): Promise<string> => {
  const tool = byId.get(id);
  if (tool === undefined) throw new Error(`tool not registered: ${id}`);
  const result = await tool.execute(input, { progress: async () => undefined });
  return typeof result.content === "string" ? result.content : JSON.stringify(result);
};

const apps = await call("computer_use:list_apps", {});
console.log("\ncomputer_use:list_apps ->", apps.slice(0, 240));

const tabs = await call("chrome:list_tabs", {});
console.log("\nchrome:list_tabs ->", tabs.slice(0, 240));

await cleanup?.();
console.log("\nsmoke ok");
