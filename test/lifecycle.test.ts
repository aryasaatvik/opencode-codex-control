import { describe, expect, test } from "bun:test";

import { TURN_END_EVENTS, watchTurnEnd } from "../src/lifecycle";

const stream = (types: readonly string[]): AsyncIterable<{ readonly type: string }> => ({
  async *[Symbol.asyncIterator]() {
    for (const type of types) yield { type };
  },
});

describe("turn-end lifecycle", () => {
  test("covers success, failure, interruption, and idle", () => {
    for (const type of [
      "session.execution.succeeded",
      "session.execution.failed",
      "session.execution.interrupted",
      "session.idle",
    ]) {
      expect(TURN_END_EVENTS.has(type)).toBe(true);
    }
  });

  test("releases for terminal events and ignores every other event", async () => {
    const released: string[] = [];
    await watchTurnEnd(
      stream([
        "session.updated",
        "session.execution.succeeded",
        "message.updated",
        "session.idle",
        "session.execution.started",
      ]),
      async () => {
        released.push("release");
      },
      () => {
        throw new Error("release should not fail");
      },
    );

    expect(released).toHaveLength(2);
  });

  test("reports a failed release and retries on the next terminal event", async () => {
    const errors: unknown[] = [];
    let attempts = 0;
    await watchTurnEnd(
      stream(["session.execution.failed", "session.idle"]),
      async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("turn_ended timed out");
      },
      (error) => {
        errors.push(error);
      },
    );

    expect(attempts).toBe(2);
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain("turn_ended timed out");
  });

  test("ends when the event stream ends and never releases without an event", async () => {
    let releases = 0;
    await watchTurnEnd(stream([]), async () => {
      releases += 1;
    }, () => {});
    expect(releases).toBe(0);
  });
});
