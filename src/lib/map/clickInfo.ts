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
//   - a collection's own vector overlays (`atlas:overlays`: sightings, tracklines) register a LENS probe:
//     `overlayAt` answers true over them too (the hex hover and the raster card stay away, and the raster
//     value joins the overlay card as a card line), and `lensOverlayAt` tells the gazetteer overlays to
//     stay quiet there (the collection's features are what a click on them is for: one card, theirs).
//
// Plain module state (no Svelte): both sides are installed from effects and clean up after
// themselves; a stale registration never overwrites a newer one. Probes and card sinks are SETS (the
// gazetteer's and the collection's can be installed at once); the cell line is one provider (one data
// layer is on the map at a time).
export interface ScreenPoint {
  x: number;
  y: number;
}
export type OverlayProbe = (point: ScreenPoint) => boolean;
export type CellLineProvider = (point: ScreenPoint) => string | null;

export type CardLineSink = (lngLat: [number, number], text: string) => void;

const cardLineSinks = new Set<CardLineSink>();
const overlayProbes = new Set<OverlayProbe>();
const lensProbes = new Set<OverlayProbe>();
let cellLineProvider: CellLineProvider | null = null;

/** register an overlay probe (`lens: true` for a lens' own overlays, see the header); the returned
 * function unregisters exactly this one. */
export function registerOverlayProbe(
  probe: OverlayProbe,
  opts: { lens?: boolean } = {},
): () => void {
  const set = opts.lens ? lensProbes : overlayProbes;
  set.add(probe);
  return () => void set.delete(probe);
}

function anyHit(probes: ReadonlySet<OverlayProbe>, point: ScreenPoint): boolean {
  for (const probe of probes) {
    try {
      if (probe(point) === true) return true;
    } catch {
      // a probe racing a style swap is a miss
    }
  }
  return false;
}

/** register the hex cell line; the returned function unregisters it (only if still the current one). */
export function registerCellLine(provider: CellLineProvider): () => void {
  cellLineProvider = provider;
  return () => {
    if (cellLineProvider === provider) cellLineProvider = null;
  };
}

/** whether an overlay feature (a gazetteer place, or a collection's own) is under `point` (false when no
 * overlay is on the map). */
export function overlayAt(point: ScreenPoint): boolean {
  return anyHit(lensProbes, point) || anyHit(overlayProbes, point);
}

/** whether a lens' own overlay feature (a collection's sighting, trackline) is under `point`. */
export function lensOverlayAt(point: ScreenPoint): boolean {
  return anyHit(lensProbes, point);
}

/** the data line of the cell under `point` ("Cell 1234: 0.42"), `null` when there is none. */
export function cellLineAt(point: ScreenPoint): string | null {
  try {
    return cellLineProvider?.(point) ?? null;
  } catch {
    return null;
  }
}

/** an overlay card registers where a late data line goes; the returned function unregisters exactly
 * this one. */
export function registerCardLineSink(sink: CardLineSink): () => void {
  cardLineSinks.add(sink);
  return () => void cardLineSinks.delete(sink);
}

/** offer a data line to the open overlay card at `lngLat` (the click that opened it); `true` when a
 * sink took it without throwing. Each card ignores a line for a card that is no longer open or sits
 * elsewhere. */
export function pushCardLine(lngLat: [number, number], text: string): boolean {
  let took = false;
  for (const sink of cardLineSinks) {
    try {
      sink(lngLat, text);
      took = true;
    } catch {
      // a card racing its own close is a miss
    }
  }
  return took;
}
