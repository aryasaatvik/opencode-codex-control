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

  test("retain keeps every failed id and dedupes repeats", () => {
    const turns = new TurnTracker();
    turns.retain(["a", "a", "b"]);
    expect(turns.take()).toEqual(["a", "b"]);

    // Many failures are all kept, oldest first, so none is dropped unretried.
    const many = Array.from({ length: 20 }, (_, index) => `t${index}`);
    turns.retain(many);
    expect(turns.take()).toEqual(many);
  });
});
