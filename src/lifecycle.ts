// Turn-end lifecycle: release the Codex sessions when an OpenCode turn ends.
//
// Codex releases Computer Use and Chrome through its `Stop`/`Interrupt` hooks,
// which call the hidden `node_repl` `turn_ended` tool. OpenCode surfaces the
// same boundary as session events, so this module maps them to a release. It is
// separate from the plugin so the event filtering can be tested without a live
// Codex install.

/**
 * Events that mark the end of an OpenCode turn.
 *
 * Repeats are harmless: the bridge no-ops when no turn is active, and
 * `node_repl` ignores repeated notifications for the same session and turn, so
 * "exactly once per turn" is enforced at those layers rather than here.
 */
export const TURN_END_EVENTS: ReadonlySet<string> = new Set([
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.idle",
]);

/**
 * Drive releases from a stream of OpenCode events until it ends or aborts.
 *
 * Every terminal event triggers one release attempt; every other event is
 * ignored. A failed release is reported and does not end the loop, so the next
 * terminal event retries it.
 */
export const watchTurnEnd = async (
  events: AsyncIterable<{ readonly type: string }>,
  release: () => Promise<void>,
  onError: (error: unknown) => void,
): Promise<void> => {
  for await (const event of events) {
    if (!TURN_END_EVENTS.has(event.type)) continue;
    try {
      await release();
    } catch (error) {
      onError(error);
    }
  }
};
