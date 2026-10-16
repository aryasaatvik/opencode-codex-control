import { expect, spyOn, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tegami, type TegamiPlugin } from "tegami";
import { releaseChecks } from "../scripts/release-checks.mts";

for (const exitCode of [1, 0]) {
  test(`release:check exit ${exitCode} ${exitCode ? "blocks" : "reaches"} publication`, async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codex-control-release-gate-"));
    const userConfig = process.env.NPM_CONFIG_USERCONFIG;
    const rejectNetwork = () => {
      throw new Error("Unexpected outbound fetch");
    };
    const fetchTrap = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(rejectNetwork, { preconnect: rejectNetwork }),
    );
    let publicationReached = false;
    const substitute: TegamiPlugin = {
      name: "local-publication-substitute",
      enforce: "pre",
      publishPreflight() {
        return { shouldPublish: true };
      },
      resolvePlanStatus() {
        return "pending";
      },
      beforePublishAll() {
        publicationReached = true;
        throw new Error("Local publication reached");
      },
    };
    try {
      // Tegami reads npm configuration during graph resolution; isolate it too.
      process.env.NPM_CONFIG_USERCONFIG = join(cwd, ".npmrc");
      await writeFile(process.env.NPM_CONFIG_USERCONFIG, "");
      await writeFile(
        join(cwd, "package.json"),
        JSON.stringify({
          name: "opencode-codex-control",
          version: "1.0.0",
          scripts: { "release:check": `bun -e 'process.exit(${exitCode})'` },
        }),
      );
      await mkdir(join(cwd, ".tegami"));
      await writeFile(
        join(cwd, ".tegami/publish-lock.yaml"),
        "core:packages:\n  - id: npm:opencode-codex-control\n    updated: true\nnpm:packages:\n  - id: npm:opencode-codex-control\n",
      );
      const paper = tegami({ cwd, npm: { client: "bun" }, plugins: [releaseChecks(), substitute] });
      const context = await paper._internal.context();
      expect(context.graph.get("npm:opencode-codex-control")).toBeDefined();
      // Retain the real lifecycle and graph, replacing only remote npm behavior.
      context.plugins = context.plugins.filter((plugin) => plugin.name !== "npm");
      await expect(paper.publish()).rejects.toThrow(
        exitCode ? "Codex Control release gate failed" : "Local publication reached",
      );
      expect(publicationReached).toBe(exitCode === 0);
      expect(fetchTrap.mock.calls).toHaveLength(0);
    } finally {
      fetchTrap.mockRestore();
      if (userConfig === undefined) delete process.env.NPM_CONFIG_USERCONFIG;
      else process.env.NPM_CONFIG_USERCONFIG = userConfig;
      await rm(cwd, { recursive: true, force: true });
    }
  });
}
