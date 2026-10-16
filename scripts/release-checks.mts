import type { TegamiPlugin } from "tegami";

export const releaseChecks = (): TegamiPlugin => ({
  name: "codex-control-release-checks",
  enforce: "pre",
  async afterPreflight({ plan }) {
    if (plan.packages.get("npm:opencode-codex-control")?.preflight?.shouldPublish !== true) return;
    const child = Bun.spawn(["bun", "run", "release:check"], {
      cwd: this.cwd,
      stderr: "inherit",
      stdout: "inherit",
    });
    if ((await child.exited) !== 0) throw new Error("Codex Control release gate failed");
  },
});
