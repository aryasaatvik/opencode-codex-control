## opencode-codex-control@0.1.0

### Add Codex Computer Use and Chrome tools

An OpenCode V2 plugin that exposes Codex Computer Use (`computer_use.*`) and
Chrome (`chrome.*`) as native tools by bridging `codex app-server` and the
bundled `node_repl` `js` tool. Chrome targets the current `ax`/`playwright` API.

One app-server connection is created lazily on the first tool call and closed
on unload; calls are serialized so concurrent sessions cannot interleave
desktop or browser actions. The plugin has no runtime dependencies.
