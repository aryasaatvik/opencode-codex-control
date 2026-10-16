import { defineConfig } from "oxlint";

export default defineConfig({
  ignorePatterns: [".scratchpad/**"],
  overrides: [
    // These tests deliberately evaluate generated JavaScript literals.
    { files: ["test/repl.test.ts"], rules: { "eslint/no-eval": "off" } },
    // Preserve the existing app-server implementation in this tooling lane.
    {
      files: ["src/codex/appserver.ts"],
      rules: { "eslint/no-unused-private-class-members": "off" },
    },
  ],
});
