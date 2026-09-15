// Turn-id bookkeeping for the Codex bridge.
//
// Every call in one OpenCode turn shares a turn id, and Codex releases the
// Computer Use and Chrome sessions per turn through `node_repl` `turn_ended`.
// Two properties matter: a call that arrives while an earlier release is still
// in flight must start its own turn rather than reuse the releasing one, and a
// turn whose release fails must never be lost, so a later release can retry it.

import { randomUUID } from "node:crypto";

export class TurnTracker {
  #active: string | undefined;
  #unreleased: string[] = [];

  /** The id shared by every call until the turn is released. */
  current(): string {
    return (this.#active ??= randomUUID());
  }

  /**
   * Claim the ids to release: the active turn plus any whose earlier release
   * failed. Clears the active turn so the next call starts a new one.
   */
  take(): readonly string[] {
    const ids = this.#unreleased.slice();
    if (this.#active !== undefined) ids.push(this.#active);
    this.#active = undefined;
    this.#unreleased = [];
    return ids;
  }

  /**
   * Retain ids whose release failed so a later release retries them. Every id
   * is kept until its own release succeeds: dropping one would lose the only
   * handle on that turn's session, leaving it alive for good.
   */
  retain(ids: readonly string[]): void {
    for (const id of ids) {
      if (!this.#unreleased.includes(id)) this.#unreleased.push(id);
    }
  }
}
