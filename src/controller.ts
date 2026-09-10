// Owns the Codex app-server connection and turns tool calls into results.
//
// One connection per plugin instance. `CodexAppServer` serializes calls inside
// it, so concurrent OpenCode sessions cannot interleave desktop or browser
// actions. The connection is created lazily on the first tool call and closed
// when the plugin unloads.

import { CodexAppServer, toolCallError } from "./codex/appserver";
import { detectInstall, setupHint } from "./codex/install";
import type { ComputerUseTool } from "./tools/computer-use";
import { computerUseProgram } from "./tools/computer-use";
import type { ChromeTool } from "./tools/chrome";
import { chromeProgram } from "./tools/chrome";

export const COMPUTER_USE_NAMESPACE = "computer_use";
export const CHROME_NAMESPACE = "chrome";

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

  async callComputerUse(tool: ComputerUseTool, input: unknown): Promise<string> {
    const install = detectInstall(this.#settings);
    if (install.cli === undefined) throw new Error(setupHint("codex"));
    if (!install.computerUse) throw new Error(setupHint("computer-use"));
    const result = await this.#bridge().callJs({
      code: computerUseProgram(tool, input),
      title: `Computer Use: ${tool.name}`,
    });
    const error = toolCallError(result, COMPUTER_USE_NAMESPACE);
    if (error !== undefined) throw error;
    return result.text;
  }

  async callChrome(tool: ChromeTool, input: unknown): Promise<string> {
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
    return result.text;
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
