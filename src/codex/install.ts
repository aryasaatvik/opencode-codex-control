// Locate the Codex install this plugin drives.
//
// Nothing here bundles or downloads anything: the `codex` CLI, the shared
// "Codex Computer Use" app, and the Chrome plugin's bundled browser client are
// all installed and licensed through the user's own Codex install. This module
// only READS what is already on disk and reports whether each surface can run.

import { accessSync, constants, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

const isExecutable = (file: string): boolean => {
  try {
    accessSync(file, constants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
};

const isReadable = (file: string): boolean => {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
};

export const resolveCodexHome = (explicit?: string): string =>
  explicit ?? process.env["CODEX_HOME"] ?? join(homedir(), ".codex");

/** The `codex` CLI the bridge spawns. PATH first, then the common install
 *  locations for launch contexts that do not inherit the user's shell PATH. */
export const resolveCodexCli = (explicit?: string): string | undefined => {
  if (explicit !== undefined) return isExecutable(explicit) ? explicit : undefined;
  const dirs = [
    ...(process.env["PATH"] ?? "").split(delimiter),
    join(homedir(), ".local", "bin"),
    join(homedir(), ".bun", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  for (const dir of dirs) {
    if (dir.length === 0) continue;
    const candidate = join(dir, "codex");
    if (isExecutable(candidate)) return candidate;
  }
  return undefined;
};

/** The shared Codex Computer Use app: the install marker for Computer Use. */
const computerUseClientPath = (codexHome: string): string =>
  join(
    codexHome,
    "computer-use",
    "Codex Computer Use.app",
    "Contents",
    "SharedSupport",
    "SkyComputerUseClient.app",
    "Contents",
    "MacOS",
    "SkyComputerUseClient",
  );

/** The Chrome plugin's bundled browser client, reached through the `latest`
 *  symlink Codex maintains beside the versioned directories, so a plugin
 *  update does not strand the stored path. */
export const chromeClientPath = (codexHome: string): string =>
  join(
    codexHome,
    "plugins",
    "cache",
    "openai-bundled",
    "chrome",
    "latest",
    "scripts",
    "browser-client.mjs",
  );

export interface CodexInstall {
  /** Resolved `codex` CLI, or undefined when Codex is not installed. */
  readonly cli?: string;
  readonly codexHome: string;
  readonly computerUse: boolean;
  readonly chrome: boolean;
  /** Absolute path the Chrome surface imports; always present, may not exist. */
  readonly chromeModulePath: string;
}

export const detectInstall = (options?: {
  readonly codexHome?: string;
  readonly codexCli?: string;
}): CodexInstall => {
  const codexHome = resolveCodexHome(options?.codexHome);
  const cli = resolveCodexCli(options?.codexCli);
  const chromeModulePath = chromeClientPath(codexHome);
  return {
    ...(cli === undefined ? {} : { cli }),
    codexHome,
    computerUse: isExecutable(computerUseClientPath(codexHome)),
    chrome: isReadable(chromeModulePath),
    chromeModulePath,
  };
};

/** The message shown when a surface cannot run yet. Written as ordered steps
 *  because the person reading it has just been told they cannot proceed. */
export const setupHint = (missing: "computer-use" | "chrome" | "codex"): string => {
  if (missing === "codex") {
    return "Codex is not installed. Install the Codex app from openai.com/codex and sign in.";
  }
  if (missing === "chrome") {
    return [
      "The Codex Chrome plugin is not installed.",
      "In Codex, open Settings → Computer use and install the ChatGPT browser extension, then use Chrome once inside Codex so it can reach your browser.",
    ].join(" ");
  }
  return [
    "The Codex Computer Use app is not installed.",
    "Install the Codex app from openai.com/codex, open Computer Use once inside Codex, and grant the macOS permissions it asks for.",
  ].join(" ");
};
