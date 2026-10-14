// lib/map/clickInfo.ts -- the small seam that keeps ONE popup on the map when two layers answer the
// same pointer: a gazetteer overlay feature (a sanctuary, a lease) and a lens' own data under it (a
// hex cell). Neither owner imports the other; each registers what it can say here.
//
//   - the overlay interaction registers a PROBE ("is there an overlay feature at this point?"); the
//     hex interaction asks it and stays quiet when there is (no second hover popup), and the species
//     lens skips its click popup (one card at a time).
//   - the hex interaction registers a CELL LINE ("Cell 1234: 0.42 · 12 likely species" at a point);
//     the overlay popup (hover and click) shows it under the place, so a click on both reads as one
//     card: the place on top, the cell value under it. The cell selection itself is the hex layer's
//     own click and is unaffected.
//
// Plain module state (no Svelte): both sides are installed from effects and clean up after
// themselves; a stale registration never overwrites a newer one.
export interface ScreenPoint {
  x: number;
  y: number;
}
export type OverlayProbe = (point: ScreenPoint) => boolean;
export type CellLineProvider = (point: ScreenPoint) => string | null;

let overlayProbe: OverlayProbe | null = null;
let cellLineProvider: CellLineProvider | null = null;

/** register the overlay probe; the returned function unregisters it (only if still the current one). */
export function registerOverlayProbe(probe: OverlayProbe): () => void {
  overlayProbe = probe;
  return () => {
    if (overlayProbe === probe) overlayProbe = null;
  };
}

/** register the hex cell line; the returned function unregisters it (only if still the current one). */
export function registerCellLine(provider: CellLineProvider): () => void {
  cellLineProvider = provider;
  return () => {
    if (cellLineProvider === provider) cellLineProvider = null;
  };
}

/** whether a gazetteer overlay feature is under `point` (false when no overlay is on the map). */
export function overlayAt(point: ScreenPoint): boolean {
  try {
    return overlayProbe?.(point) === true;
  } catch {
    return false; // a probe racing a style swap
  }
}

/** the data line of the cell under `point` ("Cell 1234: 0.42"), `null` when there is none. */
export function cellLineAt(point: ScreenPoint): string | null {
  try {
    return cellLineProvider?.(point) ?? null;
  } catch {
    return null;
  }
}
