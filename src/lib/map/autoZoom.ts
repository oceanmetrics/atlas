// "Auto-zoom to layer" (WP14): when on, a change of layer (item, taxon, representation) flies the camera to
// the new layer's extent; when off the camera stays. A browser preference like the panel's dock side
// (`ui/panelGeometry.ts`): localStorage, never the URL, default ON, storage-injectable and never throwing.
// The URL stays the view: a `?map=` in the link the page OPENED with always wins over the first fit.
export const AUTO_ZOOM_KEY = "atlas.autozoom";

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

/** the saved choice; `true` (on) when nothing is saved, the value is not ours, or storage throws. */
export function loadAutoZoom(storage: ReadableStorage | null | undefined): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(AUTO_ZOOM_KEY) !== "off";
  } catch {
    return true;
  }
}

/** saves the choice (only `off` is written as a non-default). Never throws: chrome, not correctness. */
export function saveAutoZoom(storage: WritableStorage | null | undefined, on: boolean): void {
  if (!storage) return;
  try {
    storage.setItem(AUTO_ZOOM_KEY, on ? "on" : "off");
  } catch {
    // quota / private mode
  }
}

/**
 * Whether a layer change flies the camera. `first` is the first layer the page resolved, `hasMapParam`
 * that the opening URL carried `map=`: that view is the user's, so the first layer never moves it.
 */
export function shouldAutoZoom(a: { on: boolean; first: boolean; hasMapParam: boolean }): boolean {
  return a.on && !(a.first && a.hasMapParam);
}

/** a stable string for a frame, to tell "the same extent again" (a season change of one hex grid) from
 * a layer somewhere else: the camera only flies to a frame it was not just flown to. */
export function boundsKey(bounds: readonly (readonly [number, number])[]): string {
  return bounds.map((p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`).join(";");
}
