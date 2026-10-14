// The pure half of reading a raster item's value under the pointer (WP14; Collections lens, COG items).
// The map side (`lib/map/layers/rasterValue.ts`) wires these to MapLibre events, the lens
// (`lens/collection/state.svelte.ts`) to `/cog/point` through `point.ts#ValueSource`.
//
// REQUEST BUDGET (live-measured, see CHANGELOG 0.1.0): a hex item costs no request per hover (its values
// are in memory). A COG item costs, per layer, one `/cog/statistics` for the legend histogram (two when
// the rescale is "auto": the display range first, then the histogram over that range; both cached per
// COG and band) and, per pointer interaction:
//   - hover: at most ONE `/cog/point` per settled pointer. A read starts `HOVER_DELAY_MS` (250 ms) after
//     the last pointer move, only while the map is not moving, and a newer move ABORTS the one in flight
//     (and drops its late answer), so there is never more than one request in flight and a sweep across
//     the map costs one request at its end, not one per mousemove;
//   - click: one `/cog/point`; a newer click aborts the previous one;
//   - a pointer outside the COG's known footprint costs none (no data, answered locally).
// Nothing here knows about MapLibre or the network; the timer is injected so a test is synchronous.

/** how long the pointer must rest before a hover read starts. */
export const HOVER_DELAY_MS = 250;
/** a pinned click card yields to the hover once the pointer has moved this many CSS pixels from it. */
export const UNPIN_DISTANCE_PX = 40;

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}
const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface LatestRead<P> {
  /** abort the previous read (if any) and start this one. */
  run(p: P): void;
  /** abort the read in flight; its answer is dropped. */
  cancel(): void;
  /** true while a read is in flight. */
  readonly active: boolean;
}

/**
 * One read at a time, the newest wins: `run` aborts the previous read through its `AbortSignal` and an
 * answer from a superseded (or cancelled) read is never delivered, even when the transport ignored the
 * abort. A read that throws delivers nothing.
 */
export function createLatestRead<P, V>(
  read: (p: P, signal: AbortSignal) => Promise<V>,
  onResult: (p: P, v: V) => void,
): LatestRead<P> {
  let current: AbortController | null = null;
  return {
    run(p) {
      current?.abort();
      const ctrl = new AbortController();
      current = ctrl;
      void read(p, ctrl.signal).then(
        (v) => {
          if (current !== ctrl || ctrl.signal.aborted) return;
          current = null;
          onResult(p, v);
        },
        () => {
          if (current === ctrl) current = null;
        },
      );
    },
    cancel() {
      current?.abort();
      current = null;
    },
    get active() {
      return current !== null;
    },
  };
}

export interface HoverReaderOptions<P, V> {
  read(p: P, signal: AbortSignal): Promise<V>;
  /** called with the answer of the LATEST settled position only. */
  onResult(p: P, v: V): void;
  /** true while the map pans/zooms/flies: no read starts then (it starts when the map idles). */
  isMoving(): boolean;
  delayMs?: number;
  timers?: Timers;
}

export interface HoverReader<P> {
  /** the pointer moved to `p`: abort any read, restart the settle timer. */
  move(p: P): void;
  /** the map stopped moving: a position that waited for it is read now (after the settle delay). */
  idle(): void;
  /** the pointer left (or the owner took over): abort and forget. */
  cancel(): void;
  readonly pending: boolean;
  readonly active: boolean;
}

/** The debounced hover read: `HOVER_DELAY_MS` after the pointer settles, never while the map is moving,
 * one read in flight at most (see the module header's budget). */
export function createHoverReader<P, V>(opts: HoverReaderOptions<P, V>): HoverReader<P> {
  const delay = opts.delayMs ?? HOVER_DELAY_MS;
  const timers = opts.timers ?? realTimers;
  let timer: unknown = null;
  let waiting: P | null = null;
  const latest = createLatestRead(opts.read, opts.onResult);
  const clearTimer = () => {
    if (timer !== null) timers.clear(timer);
    timer = null;
  };
  const arm = () => {
    clearTimer();
    timer = timers.set(() => {
      timer = null;
      if (waiting === null) return;
      if (opts.isMoving()) return; // stays `waiting`: `idle()` re-arms it
      const p = waiting;
      waiting = null;
      latest.run(p);
    }, delay);
  };
  return {
    move(p) {
      latest.cancel();
      waiting = p;
      arm();
    },
    idle() {
      if (waiting !== null && timer === null) arm();
    },
    cancel() {
      clearTimer();
      waiting = null;
      latest.cancel();
    },
    get pending() {
      return waiting !== null;
    },
    get active() {
      return latest.active;
    },
  };
}

/** `lon` wrapped into [-180, 180), as titiler needs (the map keeps an unwrapped longitude past the
 * antimeridian). */
export function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** whether (`lon`, `lat`) lies inside `bounds` [west, south, east, north]; `null` bounds = unknown =
 * inside (let the server answer). The longitude is wrapped first; a box with west > east wraps. */
export function pointInBounds(
  lon: number,
  lat: number,
  bounds: readonly [number, number, number, number] | null | undefined,
): boolean {
  if (!bounds) return true;
  const [w, s, e, n] = bounds;
  if (lat < s || lat > n) return false;
  const x = wrapLon(lon);
  // a box as wide as the world holds every longitude
  if (e - w >= 360) return true;
  return w <= e ? x >= w && x <= e : x >= w || x <= e;
}

/** true once the pointer has moved `distance` CSS pixels or more from where the card was pinned. */
export function shouldUnpin(
  from: { x: number; y: number },
  to: { x: number; y: number },
  distance = UNPIN_DISTANCE_PX,
): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) >= distance;
}

// --- the value as text ---------------------------------------------------------------------------

/** the unit as it reads next to a number: "percent" -> "%", "n_per_km2" -> "n/km²",
 * "individuals/km2" -> "individuals/km²"; "" for none. */
export function unitLabel(unit: string): string {
  const u = unit.trim();
  if (!u || u === "unitless") return "";
  if (u === "percent") return "%";
  return u.replace(/_per_/g, "/").replace(/km2\b/g, "km²");
}
