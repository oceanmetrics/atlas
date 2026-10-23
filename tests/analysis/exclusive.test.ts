// usability B1: `exclusive()` is the queue every place analysis runs inside. The behavioural gate is
// tests/analysis/concurrentPlaces.test.ts (a real engine, a real catalog); these pin the queue's own
// four rules one fixture each, so a regression names the rule that broke.
import { describe, expect, it } from "vitest";
import { exclusive } from "../../src/lib/analysis/exclusive";
import type { SqlRunner } from "../../src/lib/analysis/queries";

const runner = (): SqlRunner => ({ exec: async () => [] });

/** a promise the test settles by hand, so the ORDER of events is the test's, not the scheduler's. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

describe("exclusive() -- one analysis at a time per database", () => {
  it("never starts the second before the first has settled, whatever the first awaits", async () => {
    const db = runner();
    const log: string[] = [];
    const g = gate();
    const first = exclusive(db, async () => {
      log.push("a:start");
      await g.opened;
      log.push("a:end");
      return "a";
    });
    const second = exclusive(db, async () => {
      log.push("b:start");
      return "b";
    });
    await new Promise((r) => setTimeout(r, 10)); // plenty of turns for b to start, if it could
    expect(log).toEqual(["a:start"]);
    g.open();
    expect(await Promise.all([first, second])).toEqual(["a", "b"]);
    expect(log).toEqual(["a:start", "a:end", "b:start"]);
  });

  it("is first in, first out across many callers", async () => {
    const db = runner();
    const log: number[] = [];
    await Promise.all(
      [0, 1, 2, 3, 4].map((i) =>
        exclusive(db, async () => {
          await new Promise((r) => setTimeout(r, 5 - i)); // later callers are FASTER
          log.push(i);
        }),
      ),
    );
    expect(log).toEqual([0, 1, 2, 3, 4]);
  });

  it("delivers a rejection to its own caller and still runs the next one", async () => {
    const db = runner();
    const failed = exclusive(db, async () => {
      throw new Error("tile 3 is 404");
    });
    const next = exclusive(db, async () => "still ran");
    await expect(failed).rejects.toThrow("tile 3 is 404");
    await expect(next).resolves.toBe("still ran");
    // a SYNCHRONOUS throw inside fn is a rejection too, never an exception out of exclusive()
    const sync = exclusive(db, () => {
      throw new Error("sync");
    });
    await expect(sync).rejects.toThrow("sync");
    await expect(exclusive(db, async () => 1)).resolves.toBe(1);
  });

  it("keeps separate databases independent (the scores lens' engine never waits on the Places one)", async () => {
    const places = runner();
    const scores = runner();
    const g = gate();
    const held = exclusive(places, () => g.opened);
    await expect(exclusive(scores, async () => "not blocked")).resolves.toBe("not blocked");
    g.open();
    await held;
  });
});
