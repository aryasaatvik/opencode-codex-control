import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "codex-control-artifact-"));
const run = async (cmd: string[], cwd: string) => {
  const child = Bun.spawn(cmd, {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, BUN_INSTALL_CACHE_DIR: join(root, "cache") },
  });
  assert.equal(await child.exited, 0, `Failed: ${cmd.join(" ")}`);
};
try {
  const tarball = join(root, "package.tgz");
  await run([process.execPath, "pm", "pack", "--filename", tarball], process.cwd());
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: { "opencode-codex-control": `file:${tarball}` },
    }),
  );
  await run([process.execPath, "install", "--ignore-scripts", "--offline"], root);
  await writeFile(
    join(root, "consumer.ts"),
    `
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import plugin from "opencode-codex-control";
assert.equal(fileURLToPath(import.meta.resolve("opencode-codex-control")), realpathSync("node_modules/opencode-codex-control/index.ts"));
assert.equal(plugin.id, "codex-control");
const cleanup = await plugin.setup({
  options: { computerUse: false, chrome: false, codexHome: resolve("codex-home") },
  tool: { transform: async (register) => register({
    namespace() { throw new Error("Disabled namespace registered"); },
    add() { throw new Error("Disabled tool registered"); },
  }) },
  event: { subscribe() { throw new Error("Disabled surfaces subscribed"); } },
});
assert.equal(typeof cleanup, "function");
await cleanup();
`,
  );
  await run([process.execPath, "consumer.ts"], root);
} finally {
  await rm(root, { recursive: true, force: true });
}
