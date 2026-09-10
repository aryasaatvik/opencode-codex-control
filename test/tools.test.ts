import { describe, expect, test } from "bun:test";

import { COMPUTER_USE_TOOLS, computerUseProgram } from "../src/tools/computer-use";
import { CHROME_TOOLS, chromeProgram } from "../src/tools/chrome";

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
});
