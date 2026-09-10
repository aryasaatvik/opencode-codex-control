// Adapted from Executor (MIT, Copyright (c) 2026 Rhys Sullivan). See NOTICE.
// Shared helpers for projecting Codex's `node_repl` `js` tool as typed tools.
//
// Both surfaces (Computer Use via `@oai/sky`, Chrome via `browser-client.mjs`)
// work the same way: a call is compiled into one JavaScript program, that
// program is executed through Codex's `node_repl` server, and it reports a
// single JSON value back through `nodeRepl.write`. The encoding that puts
// caller arguments INTO that source text and reads one JSON value OUT is the
// genuinely shared part, and the part that must be exactly right.

/**
 * An expression that evaluates to `value` inside the REPL.
 *
 * `JSON.parse` of a string, NOT a bare object literal. The two differ in
 * exactly the way that matters here: `__proto__` as a key sets an object's
 * PROTOTYPE in a literal, while being an ordinary own key under `JSON.parse`.
 * Embedding caller arguments as a literal would let a caller move data onto
 * the prototype chain; parsing keeps arguments data.
 *
 * U+2028/U+2029 are legal inside a JSON string but are literal line
 * terminators in a JS source text, so they are escaped.
 */
export const jsString = (value: string): string =>
  JSON.stringify(value).replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");

export const jsLiteral = (value: unknown): string =>
  `JSON.parse(${JSON.stringify(JSON.stringify(value ?? null))
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029")})`;

/**
 * Wrap a program body so it runs in its own scope and reports one JSON value.
 *
 * The scope matters: a REPL session is persistent, so a program that declared
 * its working variables at top level would redeclare the same `const` on every
 * call. Everything per-call lives inside the IIFE; only deliberate caches (the
 * imported runtime) are left on `globalThis`.
 *
 * The REPL returns values only through `nodeRepl.write`, and only as text;
 * `undefined` (every action method) becomes `null` so a caller always gets a
 * well-formed JSON body rather than an empty string.
 */
export const writeJsonResult = (body: readonly string[], expression: string): string =>
  [
    "await (async () => {",
    ...body.map((line) => `  ${line}`),
    `  const result = ${expression};`,
    "  nodeRepl.write(JSON.stringify(result ?? null));",
    "})();",
  ].join("\n");
