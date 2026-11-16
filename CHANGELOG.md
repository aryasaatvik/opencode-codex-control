## opencode-codex-control@0.2.0

### Show screenshots and release control sessions

- Show Computer Use and Chrome screenshots as image content in OpenCode.
- Release Codex control sessions when an OpenCode turn succeeds, fails, is interrupted, or becomes idle. Use `computer_use.stop` to release both surfaces early.
- Retry failed session cleanup with bounded work.

### Fix Chrome coordinate targets

- Send `[x, y]` coordinate tuples for Chrome clicks, scrolling, and drag endpoints.
- Reject incomplete click and scroll targets instead of acting at an unintended zero coordinate.
- Clarify the scroll coordinate requirements and document the stop tool.

## opencode-codex-control@0.1.0

### Add Codex Computer Use and Chrome tools

An OpenCode V2 plugin that exposes Codex Computer Use (`computer_use.*`) and
Chrome (`chrome.*`) as native tools by bridging `codex app-server` and the
bundled `node_repl` `js` tool. Chrome targets the current `ax`/`playwright` API.

One app-server connection is created lazily on the first tool call and closed
on unload; calls are serialized so concurrent sessions cannot interleave
desktop or browser actions. The plugin has no runtime dependencies.
