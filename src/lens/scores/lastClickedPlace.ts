// R3-W8 item 5 fix round: the `Place` "Add to places" appends for the CURRENT Last-clicked
// selection -- a zone selection becomes the SAME shape `addZonePlace()` already builds
// (`places/model.ts`); a cell selection becomes a `GeomPlace` over the cell's own square
// (`places/cellSquares.ts#cellSquare`, the "Show analysis cells" toggle's own per-cell geometry)
// through `geomPlaceFrom()` -- the SAME pair a drawn/typed place already goes through. A clicked
// cell becomes a real, shareable place this way, not a new fourth `Place` kind the codec would
// have to learn.
//
// SEPARATE from `lastClicked.ts` (the row's own label) and reached only via a dynamic `import()`
// from Shell.svelte's "Add to places" handler: `geomPlaceFrom()` pulls in the place codec's own
// encode/decode/simplify pipeline (`lib/analysis/place.ts`), heavy enough that statically importing
// it pushed the 450 KB static-critical-path budget over by ~4 KB for a button most sessions never
// press.
import { geomPlaceFrom } from "../../places/geomPlace";
import { cellSquare } from "../../places/cellSquares";
import { zoneSetForUnit } from "../../places/model";
import { gridFromBoot } from "../../lib/grid/grid";
import type { Place } from "../../lib/geo/placeCodec";
import type { PolygonGeometry, Position } from "../../lib/geo/types";
import type { ScoresSelection } from "./selection";

/** `null` when nothing is clicked, `boot` has not resolved, or (defensively) a zone's own unit does
 * not map to a codec `ZoneSet` (D17 -- every published release's one drawable unit always does;
 * this is belt-and-braces, not a real-world case). */
export function placeFromLastClicked(selection: ScoresSelection, boot: unknown): Place | null {
  if (!selection || !boot || typeof boot !== "object") return null;
  if (selection.kind === "zone") {
    const set = zoneSetForUnit(selection.unit);
    return set ? { kind: "zone", set, keys: [selection.key] } : null;
  }
  // `cellSquare()` returns a generic geojson `Polygon` (`Position = number[]`, variable length);
  // the app's own `AreaGeometry` is stricter (`Position = [number, number]`) -- this square's own
  // 5 vertices are already exactly 2 elements each (cellSquares.ts's own construction), so mapping
  // each pair across is a type-narrowing copy, never a real coordinate transform.
  const square = cellSquare(selection.cellId, gridFromBoot(boot));
  const ring: Position[] = square.coordinates[0]!.map(([lon, lat]) => [lon!, lat!]);
  const geometry: PolygonGeometry = { type: "Polygon", coordinates: [ring] };
  return geomPlaceFrom(geometry, `Cell ${selection.cellId}`);
}
