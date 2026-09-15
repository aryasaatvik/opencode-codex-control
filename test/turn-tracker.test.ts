import { describe, expect, test } from "bun:test";

import { TurnTracker } from "../src/codex/turn-tracker";

describe("TurnTracker", () => {
  test("shares one id within a turn and starts a new one after take", () => {
    const turns = new TurnTracker();
    const first = turns.current();
    expect(turns.current()).toBe(first);

    expect(turns.take()).toEqual([first]);

    const second = turns.current();
    expect(second).not.toBe(first);
  });

  test("take is empty when no turn is active", () => {
    expect(new TurnTracker().take()).toEqual([]);
  });

  test("retains a failed release and retries it on the next take", () => {
    const turns = new TurnTracker();
    const turn = turns.current();
    expect(turns.take()).toEqual([turn]);

    turns.retain([turn]);
    // A call that arrives while the release is in flight claims its own turn.
    const next = turns.current();
    expect(turns.take()).toEqual([turn, next]);
  });

  test("retain dedupes and bounds the backlog", () => {
    const turns = new TurnTracker();
    turns.retain(["a", "a"]);
    expect(turns.take()).toEqual(["a"]);

    for (let index = 0; index < 20; index += 1) turns.retain([`t${index}`]);
    const taken = turns.take();
    expect(taken).toHaveLength(16);
    expect(taken.at(-1)).toBe("t19");
  });
});
