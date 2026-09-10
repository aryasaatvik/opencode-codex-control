import { describe, expect, test } from "bun:test";

import { readSettings } from "../src/controller";

describe("readSettings", () => {
  test("defaults both surfaces on", () => {
    expect(readSettings(undefined)).toEqual({ computerUse: true, chrome: true });
  });

  test("honours explicit disables and paths", () => {
    expect(
      readSettings({ computerUse: false, chrome: false, codexHome: "/x", codexCli: "codex" }),
    ).toEqual({ computerUse: false, chrome: false, codexHome: "/x", codexCli: "codex" });
  });

  test("ignores non-string path options", () => {
    expect(readSettings({ codexHome: 42, codexCli: null })).toEqual({
      computerUse: true,
      chrome: true,
    });
  });
});
