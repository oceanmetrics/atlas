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
//   - a raster item's value arrives AFTER the click (a `/cog/point` read), when the overlay card is
//     already open: the raster interaction pushes it as a CARD LINE (`pushCardLine`) and the overlay card,
//     which registered a sink, adds it under the place. No second popup for the raster value either.
//
// Plain module state (no Svelte): both sides are installed from effects and clean up after
// themselves; a stale registration never overwrites a newer one.
export interface ScreenPoint {
  x: number;
  y: number;
}
export type OverlayProbe = (point: ScreenPoint) => boolean;
export type CellLineProvider = (point: ScreenPoint) => string | null;

export type CardLineSink = (lngLat: [number, number], text: string) => void;

let cardLineSink: CardLineSink | null = null;
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

/** the overlay card registers where a late data line goes; the returned function unregisters it (only
 * if still the current one). */
export function registerCardLineSink(sink: CardLineSink): () => void {
  cardLineSink = sink;
  return () => {
    if (cardLineSink === sink) cardLineSink = null;
  };
}

/** offer a data line to the open overlay card at `lngLat` (the click that opened it); `true` when a
 * card took it. The card ignores a line for a card that is no longer open or sits elsewhere. */
export function pushCardLine(lngLat: [number, number], text: string): boolean {
  try {
    if (!cardLineSink) return false;
    cardLineSink(lngLat, text);
    return true;
  } catch {
    return false;
  }
}
