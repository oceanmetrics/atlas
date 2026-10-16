// The pure rules behind "follow an Atlas link, carry the clicked point, and come back": what the way back
// remembers, when it stops being good, and what the clicked point does when the collection changes under it.
// Kept apart from `state.svelte.ts` so each rule has a small unit test (that file needs the Svelte runtime).
import type { MapView, Sel } from "../../lib/state/types";

/** the layer and view to return to after a followed link. */
export interface ReturnTarget {
  /** the keys of the Sel that select the layer, as they were (`undefined` = unset, so the way back clears
   * what the followed link set, e.g. `sp`). Never `map`: the camera is flown to `camera`. */
  sel: Partial<Sel>;
  camera: MapView;
  /** the layer's name, for "Back to <label>". */
  label: string;
  /** the collection the followed link opened: the way back ends when the layer is no longer it. */
  target: string;
}

/** the Sel keys that select the layer in the Collections lens. */
export const LAYER_KEYS = ["c", "i", "sp", "rep"] as const;

/** the way back for a follow made from `sel` at `camera`; `null` when the camera is unknown (no map). */
export function makeReturnTo(a: {
  sel: Sel;
  camera: MapView | null;
  label: string;
  target: string;
}): ReturnTarget | null {
  if (!a.camera) return null;
  const sel: Partial<Sel> = {};
  for (const k of LAYER_KEYS) (sel as Record<string, unknown>)[k] = a.sel[k];
  return { sel, camera: a.camera, label: a.label, target: a.target };
}

/** the way back survives while the Collections lens shows the collection the link opened. */
export function returnStillValid(
  r: ReturnTarget,
  lens: string,
  collectionId: string | null,
): boolean {
  return lens === "collection" && collectionId === r.target;
}

/**
 * What the clicked raster point does when the collection or item under it changes.
 * - `rekey`: a followed link carried it; the new collection's item is ready, so re-key and re-read the pixel.
 * - `wait`: carried, but the new collection's item is not ready yet (or is still the one we left): keep it.
 * - `normal`: the ordinary rule (the same collection follows the item; another one drops the point).
 */
export function carryDecision(a: {
  carrying: boolean;
  pointCollection: string;
  entryId: string | null;
  hasItem: boolean;
  key: string | null;
  fromKey: string | null;
}): "rekey" | "wait" | "normal" {
  if (!a.carrying) return "normal";
  if (!a.entryId) return "wait";
  if (a.pointCollection === a.entryId) return "normal";
  if (!a.hasItem || a.key === a.fromKey) return "wait";
  return "rekey";
}
