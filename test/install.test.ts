import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  chromeClientPath,
  detectInstall,
  resolveCodexCli,
  resolveCodexHome,
} from "../src/codex/install";

describe("resolveCodexHome", () => {
  test("prefers an explicit value", () => {
    expect(resolveCodexHome("/custom/codex")).toBe("/custom/codex");
  });
});

describe("chromeClientPath", () => {
  test("points at the latest bundled browser client", () => {
    expect(chromeClientPath("/home/x")).toBe(
      join("/home/x", "plugins/cache/openai-bundled/chrome/latest/scripts/browser-client.mjs"),
    );
  });
});

describe("resolveCodexCli", () => {
  test("returns undefined for a non-executable explicit path", () => {
    expect(resolveCodexCli("/definitely/not/here/codex")).toBeUndefined();
  });
});

describe("detectInstall", () => {
  test("reports nothing installed for an empty CODEX_HOME", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-home-"));
    const install = detectInstall({ codexHome: root, codexCli: "/definitely/not/here/codex" });
    expect(install.cli).toBeUndefined();
    expect(install.computerUse).toBe(false);
    expect(install.chrome).toBe(false);
    expect(install.chromeModulePath.endsWith("browser-client.mjs")).toBe(true);
  });

  test("detects the Chrome client and Computer Use app when present", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-home-"));

    const chrome = chromeClientPath(root);
    mkdirSync(join(chrome, ".."), { recursive: true });
    writeFileSync(chrome, "export const setupBrowserRuntime = async () => ({});\n");

    const client = join(
      root,
      "computer-use",
      "Codex Computer Use.app",
      "Contents",
      "SharedSupport",
      "SkyComputerUseClient.app",
      "Contents",
      "MacOS",
      "SkyComputerUseClient",
    );
    mkdirSync(join(client, ".."), { recursive: true });
    writeFileSync(client, "#!/bin/sh\n", { mode: 0o755 });

    const install = detectInstall({ codexHome: root });
    expect(install.chrome).toBe(true);
    expect(install.computerUse).toBe(true);
  });
});
