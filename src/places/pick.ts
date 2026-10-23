// places/pick.ts -- pick mode's pure selection logic (Deliverable 2): which zone keys are
// currently picked, and what one more click/long-press does to that set. The DOM/MapLibre wiring
// (attaching this to `handle.map`'s click/touch events) is pickInstall.ts's job; everything a test
// can assert without a browser lives here.
import type { ZoneHit } from "../lib/map/interaction";

export interface PickState {
  unit: string | null;
  keys: string[];
}

export const EMPTY_PICK: PickState = { unit: null, keys: [] };

export function clearPick(): PickState {
  return { unit: null, keys: [] };
}

/**
 * One hit resolves against the CURRENT pick state (Deliverable 2: "multi-select with modifier or
 * long-press"). `multi` is the caller's own gesture test (ctrl/shift held, or a long-press already
 * fired) -- this module knows nothing about pointer events.
 *
 * - a hit on a DIFFERENT unit than the one already picked starts a fresh selection (D17: a release
 *   publishes exactly one drawable unit, but a release change mid-session must not silently mix
 *   keys from two different unit types into one zone place);
 * - a plain click (not `multi`) REPLACES the set with just this key, so "pick one, then pick
 *   another" without the modifier does what it looks like it does rather than growing forever --
 *   EXCEPT clicking the one already-picked key again, which clears the pick (a toggle-off);
 * - `multi` toggles the hit key into/out of the set, leaving every other key alone.
 */
export function togglePick(state: PickState, hit: ZoneHit, multi: boolean): PickState {
  if (!multi) {
    if (state.unit === hit.unit && state.keys.length === 1 && state.keys[0] === hit.key) {
      return clearPick();
    }
    return { unit: hit.unit, keys: [hit.key] };
  }
  if (state.unit !== hit.unit) return { unit: hit.unit, keys: [hit.key] };
  const has = state.keys.includes(hit.key);
  return {
    unit: hit.unit,
    keys: has ? state.keys.filter((k) => k !== hit.key) : [...state.keys, hit.key],
  };
}
