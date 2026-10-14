// WP14: reading a raster item's value under the pointer -- the pure rules (newest read wins, the
// debounce, no read while the map moves, one request at a time, the footprint check, the unit text).
import { describe, expect, it } from "vitest";
import {
  HOVER_DELAY_MS,
  createHoverReader,
  createLatestRead,
  pointInBounds,
  shouldUnpin,
  unitLabel,
  wrapLon,
  type Timers,
} from "../../src/lib/raster/pointRead";

/** a manual clock: `set` queues, `advance` runs what is due. */
function fakeTimers() {
  let now = 0;
  let next = 1;
  const queue = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    set(fn, ms) {
      const id = next++;
      queue.set(id, { at: now + ms, fn });
      return id;
    },
    clear(h) {
      queue.delete(h as number);
    },
  };
  return {
    timers,
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...queue]) {
        if (t.at <= now) {
          queue.delete(id);
          t.fn();
        }
      }
    },
  };
}

/** a read the test settles by hand; records every start and abort. */
function manualRead() {
  const calls: {
    p: string;
    signal: AbortSignal;
    resolve: (v: number | null) => void;
    reject: (e: unknown) => void;
  }[] = [];
  let inflight = 0;
  let maxInflight = 0;
  const read = (p: string, signal: AbortSignal) =>
    new Promise<number | null>((resolve, reject) => {
      inflight++;
      maxInflight = Math.max(maxInflight, inflight);
      signal.addEventListener("abort", () => {
        inflight--;
        reject(new Error("aborted"));
      });
      calls.push({
        p,
        signal,
        resolve: (v) => {
          if (!signal.aborted) inflight--;
          resolve(v);
        },
        reject,
      });
    });
  return { read, calls, maxInflight: () => maxInflight };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("createLatestRead: one read, the newest wins", () => {
  it("a newer run aborts the previous read and drops its late answer (a stale click never lands)", async () => {
    const m = manualRead();
    const got: [string, number | null][] = [];
    const latest = createLatestRead(m.read, (p, v) => got.push([p, v]));
    latest.run("a");
    latest.run("b");
    expect(m.calls[0].signal.aborted).toBe(true);
    m.calls[0].resolve(1); // a transport that ignored the abort still answers
    m.calls[1].resolve(2);
    await tick();
    expect(got).toEqual([["b", 2]]);
  });
  it("cancel drops the answer; a read that throws delivers nothing and frees the slot", async () => {
    const m = manualRead();
    const got: unknown[] = [];
    const latest = createLatestRead(m.read, (_p, v) => got.push(v));
    latest.run("a");
    expect(latest.active).toBe(true);
    latest.cancel();
    expect(latest.active).toBe(false);
    latest.run("b");
    m.calls[1].reject(new Error("HTTP 500"));
    await tick();
    expect(got).toEqual([]);
    expect(latest.active).toBe(false);
  });
});

describe("createHoverReader: debounced, still-map only, one request at a time", () => {
  function setup(moving = () => false) {
    const clock = fakeTimers();
    const m = manualRead();
    const got: [string, number | null][] = [];
    const reader = createHoverReader<string, number | null>({
      read: m.read,
      isMoving: moving,
      onResult: (p, v) => got.push([p, v]),
      timers: clock.timers,
    });
    return { clock, m, got, reader };
  }
  it("waits 250 ms after the pointer settles before the first request", () => {
    expect(HOVER_DELAY_MS).toBe(250);
    const { clock, m, reader } = setup();
    reader.move("p1");
    clock.advance(249);
    expect(m.calls).toHaveLength(0);
    clock.advance(1);
    expect(m.calls.map((c) => c.p)).toEqual(["p1"]);
  });
  it("a sweep costs one request: every move restarts the timer, only the last position is read", () => {
    const { clock, m, reader } = setup();
    for (const p of ["a", "b", "c", "d", "e"]) {
      reader.move(p);
      clock.advance(100);
    }
    expect(m.calls).toHaveLength(0);
    clock.advance(150);
    expect(m.calls.map((c) => c.p)).toEqual(["e"]);
  });
  it("a move while a read is in flight aborts it; never more than one request in flight", async () => {
    const { clock, m, got, reader } = setup();
    reader.move("a");
    clock.advance(250);
    reader.move("b");
    expect(m.calls[0].signal.aborted).toBe(true);
    clock.advance(250);
    m.calls[1].resolve(7);
    await tick();
    expect(m.maxInflight()).toBe(1);
    expect(got).toEqual([["b", 7]]);
  });
  it("no request while the map is moving; the position is read once it idles", () => {
    let moving = true;
    const { clock, m, reader } = setup(() => moving);
    reader.move("a");
    clock.advance(250);
    expect(m.calls).toHaveLength(0);
    expect(reader.pending).toBe(true);
    moving = false;
    reader.idle();
    clock.advance(250);
    expect(m.calls.map((c) => c.p)).toEqual(["a"]);
  });
  it("cancel (the pointer left) clears the timer and any read", () => {
    const { clock, m, reader } = setup();
    reader.move("a");
    reader.cancel();
    clock.advance(1000);
    expect(m.calls).toHaveLength(0);
    expect(reader.pending).toBe(false);
  });
});

describe("the footprint check", () => {
  it("wraps a longitude into [-180, 180)", () => {
    expect(wrapLon(190)).toBe(-170);
    expect(wrapLon(-190)).toBe(170);
    expect(wrapLon(-70.5)).toBe(-70.5);
    expect(wrapLon(180)).toBe(-180);
  });
  it("inside / outside a box; unknown bounds read as inside (the server answers)", () => {
    const b: [number, number, number, number] = [-80, 30, -60, 50];
    expect(pointInBounds(-70, 40, b)).toBe(true);
    expect(pointInBounds(-90, 40, b)).toBe(false);
    expect(pointInBounds(-70, 60, b)).toBe(false);
    expect(pointInBounds(-70, 40, null)).toBe(true);
  });
  it("a world-wide box holds every longitude; a box over the antimeridian wraps", () => {
    expect(pointInBounds(179.9, 0, [-180, -62, 180, 80])).toBe(true);
    expect(pointInBounds(200, 0, [-180, -62, 180, 80])).toBe(true);
    const bering: [number, number, number, number] = [170, 50, -160, 70];
    expect(pointInBounds(-175, 60, bering)).toBe(true);
    expect(pointInBounds(175, 60, bering)).toBe(true);
    expect(pointInBounds(0, 60, bering)).toBe(false);
  });
});

describe("the click card yields to the hover only once the pointer has left it", () => {
  it("40 px away or more unpins; closer does not", () => {
    expect(shouldUnpin({ x: 0, y: 0 }, { x: 10, y: 10 })).toBe(false);
    expect(shouldUnpin({ x: 0, y: 0 }, { x: 30, y: 30 })).toBe(true);
  });
});

describe("unitLabel", () => {
  it("reads the catalog's unit strings as they appear next to a number", () => {
    expect(unitLabel("percent")).toBe("%");
    expect(unitLabel("n_per_km2")).toBe("n/km²");
    expect(unitLabel("individuals/km2")).toBe("individuals/km²");
    expect(unitLabel("unitless")).toBe("");
    expect(unitLabel("")).toBe("");
  });
});
