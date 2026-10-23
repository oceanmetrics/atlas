// places/pickInstall.ts -- wires pick.ts's pure state machine onto the shared map's click and
// long-press (Deliverable 2: "multi-select with modifier or long-press"; touch works). Uses ONLY
// `handle.map`'s `on`/`off`/`queryRenderedFeatures`/`project` -- exactly the calls docs/map.md's
// `MapHandle` grants a lens for hit-testing ("the raw MapLibre map -- for `on`/`off` and
// `queryRenderedFeatures`; never for `addLayer`"). The highlight itself is a `composeStyle`
// `selection` input Places.svelte computes from the state this reports, never something painted
// here directly.
import { zoneAtPoint, type QueryableMap, type ZoneHit } from "../lib/map/interaction";
import { togglePick, type PickState } from "./pick";
import type { ZoneUnitSpec } from "../lib/map/types";

const LONG_PRESS_MS = 500;

export interface PickMapLike extends QueryableMap {
  on(type: string, listener: (e: unknown) => void): unknown;
  off(type: string, listener: (e: unknown) => void): unknown;
}

interface MapMouseEventLike {
  point: { x: number; y: number };
  originalEvent?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean };
}

export interface PickModeHandle {
  /** stop listening; safe to call more than once. */
  uninstall(): void;
}

/**
 * Turn pick mode on for `units` (D17: the release's one drawable unit; this takes the whole list
 * so a future release with more than one still resolves the SAME way `zoneAtPoint` already does
 * everywhere else). `onChange` fires with the new {@link PickState} after every click/tap;
 * Places.svelte turns the result into a `selection` composeStyle input and, on "Add to places",
 * into `#pl=` via `model.ts`'s `addZonePlace`.
 */
export function installPickMode(
  map: PickMapLike,
  units: readonly ZoneUnitSpec[],
  onChange: (next: PickState) => void,
): PickModeHandle {
  let state: PickState = { unit: null, keys: [] };
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let longPressed = false;

  function resolve(e: MapMouseEventLike): ZoneHit | null {
    return zoneAtPoint(map, e.point, units);
  }

  function apply(hit: ZoneHit | null, multi: boolean) {
    if (!hit) return;
    state = togglePick(state, hit, multi);
    onChange(state);
  }

  const onClick = (raw: unknown) => {
    if (longPressed) {
      longPressed = false; // the long-press handler below already applied this tap
      return;
    }
    const e = raw as MapMouseEventLike;
    const multi = !!(
      e.originalEvent?.ctrlKey ||
      e.originalEvent?.metaKey ||
      e.originalEvent?.shiftKey
    );
    apply(resolve(e), multi);
  };
  const onTouchStart = (raw: unknown) => {
    const e = raw as MapMouseEventLike;
    cancelPress();
    pressTimer = setTimeout(() => {
      longPressed = true;
      apply(resolve(e), true); // a long-press always ADDS to the selection (D2's touch path)
    }, LONG_PRESS_MS);
  };
  function cancelPress() {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = null;
  }

  map.on("click", onClick);
  map.on("touchstart", onTouchStart);
  map.on("touchend", cancelPress);
  map.on("touchcancel", cancelPress);
  map.on("dragstart", cancelPress); // a pan/drag starting mid-press is not a long-press

  return {
    uninstall() {
      cancelPress();
      map.off("click", onClick);
      map.off("touchstart", onTouchStart);
      map.off("touchend", cancelPress);
      map.off("touchcancel", cancelPress);
      map.off("dragstart", cancelPress);
    },
  };
}
