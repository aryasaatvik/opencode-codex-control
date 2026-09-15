import { describe, expect, test } from "bun:test";

import { COMPUTER_USE_TOOLS, computerUseProgram } from "../src/tools/computer-use";
import { CHROME_TOOLS, chromeProgram } from "../src/tools/chrome";

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...parameters: string[]
) => (...args: unknown[]) => Promise<unknown>;

/** Run a Chrome tool's real expression against a mock tab. */
const executeChromeTool = (name: string, args: unknown, tab: unknown): Promise<unknown> => {
  const tool = CHROME_TOOLS.find((candidate) => candidate.name === name);
  if (tool === undefined) throw new Error(`missing tool ${name}`);
  return new AsyncFunction("__args", "__tab", `return (${tool.expression});`)(args, tab);
};

const mockTab = (calls: Record<string, unknown[]>) => ({
  ax: {
    click: async (...args: unknown[]) => {
      calls["click"] = args;
    },
    scroll: async (...args: unknown[]) => {
      calls["scroll"] = args;
    },
    drag: async (...args: unknown[]) => {
      calls["drag"] = args;
    },
  },
});

describe("Computer Use tools", () => {
  test("names are unique and schemas are closed objects", () => {
    const names = COMPUTER_USE_TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of COMPUTER_USE_TOOLS) {
      expect(tool.inputSchema["type"]).toBe("object");
      expect(tool.inputSchema["additionalProperties"]).toBe(false);
    }
  });

  test("every tool compiles to a program that calls its sky method", () => {
    for (const tool of COMPUTER_USE_TOOLS) {
      const program = computerUseProgram(tool, { app: "X" });
      expect(program).toContain('(await import("@oai/sky")).sky');
      expect(program).toContain(`sky.${tool.method}`);
      expect(program).toContain("nodeRepl.write(JSON.stringify(result ?? null))");
    }
  });

  test("only get_app_state surfaces a screenshot", () => {
    const flagged = COMPUTER_USE_TOOLS.filter((tool) => tool.screenshot === true);
    expect(flagged.map((tool) => tool.name)).toEqual(["get_app_state"]);
  });
});

describe("Chrome tools", () => {
  test("names are unique and schemas are closed objects", () => {
    const names = CHROME_TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of CHROME_TOOLS) {
      expect(tool.inputSchema["type"]).toBe("object");
      expect(tool.inputSchema["additionalProperties"]).toBe(false);
    }
  });

  test("every tool compiles to a program that imports the browser client", () => {
    for (const tool of CHROME_TOOLS) {
      const program = chromeProgram(tool, {}, "/tmp/browser-client.mjs");
      expect(program).toContain('await import("/tmp/browser-client.mjs")');
      expect(program).toContain("setupBrowserRuntime");
    }
  });

  test("page tools resolve a tab; list and new do not", () => {
    const byName = new Map(CHROME_TOOLS.map((tool) => [tool.name, tool]));
    expect(byName.get("list_tabs")?.needsTab).toBe(false);
    expect(byName.get("new_tab")?.needsTab).toBe(false);
    expect(byName.get("read_page")?.needsTab).toBe(true);
    expect(byName.get("click")?.needsTab).toBe(true);
  });

  test("coordinate targets reach the ax API as [x, y] tuples", async () => {
    const calls: Record<string, unknown[]> = {};
    const tab = mockTab(calls);

    await executeChromeTool("click", { x: 10, y: 20 }, tab);
    expect(calls["click"]?.[0]).toEqual([10, 20]);

    await executeChromeTool("click", { element_index: 7 }, tab);
    expect(calls["click"]?.[0]).toBe(7);

    await executeChromeTool("scroll", { x: 5, y: 6, direction: "down" }, tab);
    expect(calls["scroll"]?.[0]).toEqual([5, 6]);
    expect(calls["scroll"]?.[1]).toBe("down");

    await executeChromeTool("drag", { from_x: 1, from_y: 2, to_x: 3, to_y: 4 }, tab);
    expect(calls["drag"]).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  test("an incomplete target is rejected instead of acting at [0, 0]", async () => {
    const calls: Record<string, unknown[]> = {};
    const tab = mockTab(calls);

    const rejection = "Provide an element_index, or both x and y";
    await expect(executeChromeTool("click", {}, tab)).rejects.toThrow(rejection);
    await expect(executeChromeTool("click", { x: 10 }, tab)).rejects.toThrow(rejection);
    await expect(executeChromeTool("scroll", { direction: "down" }, tab)).rejects.toThrow(
      rejection,
    );

    expect(calls["click"]).toBeUndefined();
    expect(calls["scroll"]).toBeUndefined();
  });

  test("screenshot is the only tool that surfaces a written image", () => {
    const byName = new Map(CHROME_TOOLS.map((tool) => [tool.name, tool]));
    const flagged = CHROME_TOOLS.filter((tool) => tool.screenshot === true);
    expect(flagged.map((tool) => tool.name)).toEqual(["screenshot"]);

    const screenshot = byName.get("screenshot");
    expect(screenshot?.needsTab).toBe(true);
    const program = chromeProgram(screenshot!, {}, "/tmp/browser-client.mjs");
    expect(program).toContain("__tab.screenshot(");
    expect(program).toContain("nodeRepl.emitImage(");
  });
});
