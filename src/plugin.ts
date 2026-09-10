// OpenCode plugin: Codex Computer Use and Chrome as native tools.
//
// Codex's Computer Use and Chrome plugins are driven entirely through
// `codex app-server` (see `codex/appserver.ts`). This plugin owns one
// app-server connection, projects each surface as typed tools, and lets
// OpenCode's permission layer be the consent boundary: every tool carries a
// `permission` action, and Codex's own approval prompts are answered
// automatically once the user has allowed the call.
//
// Nothing is spawned until the first tool call, and each surface reports a
// clear setup path when Codex or that surface is not installed.

import type { Plugin as PluginNamespace } from "@opencode/plugin";

import { resolveCodexHome } from "./codex/install";
import {
  CHROME_NAMESPACE,
  COMPUTER_USE_NAMESPACE,
  Controller,
  readSettings,
} from "./controller";
import { CHROME_TOOLS } from "./tools/chrome";
import { COMPUTER_USE_TOOLS } from "./tools/computer-use";

type PluginContext = PluginNamespace.Context;

// A plain object rather than `Plugin.define`: the helper is an identity
// function, and importing it only for that would pull OpenCode's full server
// dependency graph into every install. The `satisfies` keeps the type
// contract without a runtime dependency.
const plugin = {
  id: "codex-control",
  async setup(ctx: PluginContext) {
    const settings = readSettings(ctx.options);
    const controller = new Controller(settings);

    await ctx.tool.transform((editor) => {
      if (settings.computerUse) {
        editor.namespace({
          name: COMPUTER_USE_NAMESPACE,
          description:
            "Control macOS desktop apps through Codex Computer Use: read the accessibility tree and screenshots, click, type, and scroll.",
        });
        for (const tool of COMPUTER_USE_TOOLS) {
          editor.add({
            name: tool.name,
            description: tool.description,
            input: tool.inputSchema,
            options: {
              namespace: COMPUTER_USE_NAMESPACE,
              permission: COMPUTER_USE_NAMESPACE,
            },
            execute: async (input: unknown) => ({
              content: await controller.callComputerUse(tool, input),
            }),
          });
        }
      }

      if (settings.chrome) {
        editor.namespace({
          name: CHROME_NAMESPACE,
          description:
            "Control the real Chrome browser through Codex: open tabs, navigate, read pages, click, and type, using the user's logged-in sessions.",
        });
        for (const tool of CHROME_TOOLS) {
          editor.add({
            name: tool.name,
            description: tool.description,
            input: tool.inputSchema,
            options: { namespace: CHROME_NAMESPACE, permission: CHROME_NAMESPACE },
            execute: async (input: unknown) => ({
              content: await controller.callChrome(tool, input),
            }),
          });
        }
      }
    });

    console.log(
      `[codex-control] loaded (codex home: ${resolveCodexHome(settings.codexHome)}, computer use: ${settings.computerUse}, chrome: ${settings.chrome})`,
    );

    return async () => {
      await controller.close();
    };
  },
} satisfies PluginNamespace.Plugin;

export default plugin;
