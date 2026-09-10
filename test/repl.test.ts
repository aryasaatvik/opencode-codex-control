import { describe, expect, test } from "bun:test";

import { jsLiteral, jsString, writeJsonResult } from "../src/codex/repl";

describe("jsLiteral", () => {
  test("evaluates back to the original value", () => {
    expect(eval(jsLiteral({ a: 1, b: "x" }))).toEqual({ a: 1, b: "x" });
    expect(eval(jsLiteral(null))).toBeNull();
    expect(eval(jsLiteral([1, 2]))).toEqual([1, 2]);
  });

  test("keeps __proto__ as an own key instead of polluting the prototype", () => {
    const evil = JSON.parse('{"__proto__":{"polluted":true}}');
    const value = eval(jsLiteral(evil)) as Record<string, unknown>;
    expect(Object.prototype).not.toHaveProperty("polluted");
    expect(Object.prototype.hasOwnProperty.call(value, "__proto__")).toBe(true);
  });

  test("escapes line and paragraph separators", () => {
    for (const char of ["\u2028", "\u2029"]) {
      const expression = jsLiteral(`a${char}b`);
      expect(expression).not.toContain(char);
      expect(eval(expression)).toBe(`a${char}b`);
    }
  });
});

describe("jsString", () => {
  test("produces a JS string literal", () => {
    expect(eval(jsString("a\nb"))).toBe("a\nb");
  });
});

describe("writeJsonResult", () => {
  test("reports one JSON value through nodeRepl.write", () => {
    const program = writeJsonResult(["const x = 1;"], "x + 1");
    expect(program).toContain("nodeRepl.write(JSON.stringify(result ?? null))");
    expect(program).toContain("const result = x + 1;");
  });
});
