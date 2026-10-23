// analysis/place.ts -- the pure half of "a place becomes numbers" (atlas-2 Step 3b).
//
// No engine, no network, no DOM: geometry in, a cell list and the tile ids to fetch out. Every rule
// here already has a twin and a fixture somewhere else in this repo; this module only puts them in
// the one order every lens must use, so no caller can accidentally analyse the geometry it was
// handed instead of the geometry a shared link reproduces.
import { cellsInPolygon, type CellCoverage } from "../geo/coverage";
import { roundTrip } from "../geo/placeCodec";
import { normalizeForAnalysis } from "../geo/unwrap";
import type { AreaGeometry } from "../geo/types";
import { tileOf, type GridSpec } from "../grid/grid";

/**
 * The geometry every analysis runs on (plan D8).
 *
 * `normalizeForAnalysis()` FIRST, then `decode(encode(...))` -- that order is not interchangeable
 * and the plan's prose ("decode(encode(geometry)) -> normalizeForAnalysis") has them the wrong way
 * round. `encodeGeometry()` REFUSES a ring that is still wrapped (D8 addendum ruling 2, reject code
 * `wrapped`), so encoding an un-normalized Bering polygon throws instead of producing a token; and
 * unwrapping AFTER the round trip would analyse a geometry the link cannot carry. D8 addendum says
 * it in the same words: "TypeScript callers go `normalizeForAnalysis()` then `encodeGeometry()`".
 *
 * The round trip is not a formality. A link carries quantized coordinates (10^-3 deg, or 10^-4 for
 * a place under half a degree), so the sender and the recipient only compute the same `pct_covered`
 * -- and therefore the same score -- if the SENDER also analysed the quantized geometry.
 */
export function analysisGeometry(geom: AreaGeometry): AreaGeometry {
  return roundTrip(normalizeForAnalysis(geom));
}

/**
 * A place's cells, on this release's grid -- `cellsInPolygon()` over {@link analysisGeometry}.
 *
 * NOT clipped to the study area: that clip needs the release's `cell` table and therefore the
 * engine, and it lives in `sql/cells_in_study_area.sql` (D7b). What comes back here is "the squares
 * this polygon overlaps", land and foreign waters included.
 */
export function placeCells(geom: AreaGeometry, grid: GridSpec): CellCoverage[] {
  return cellsInPolygon(analysisGeometry(geom), grid);
}

/** the partition tiles a cell set touches, ascending and deduplicated (`grid.tileOf`). */
export function tilesForCells(cells: readonly CellCoverage[], grid: GridSpec): number[] {
  const seen = new Set<number>();
  for (const c of cells) seen.add(tileOf(c.cell_id, grid));
  return [...seen].sort((a, b) => a - b);
}

/**
 * How many `cell_model` tiles may be materialized at once (plan atlas-2 `engine/`).
 *
 * One tile is ~0.8 M rows (tile 1012: 784,092 rows for 1,500 cells) and a 40-tile place is ~30 M
 * rows, which must never exist in the browser at once. Eight is the plan's number; the batching is
 * exact (`sql/species_for_cells.sql`'s header), so this is purely a memory dial and
 * `tests/analysis/batching.test.ts` proves changing it cannot change an answer.
 */
export const MAX_CELL_MODEL_TILES = 8;

/** split `tiles` into consecutive batches of at most `size` (default {@link MAX_CELL_MODEL_TILES}). */
export function batchTiles(tiles: readonly number[], size = MAX_CELL_MODEL_TILES): number[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error(`batchTiles: bad size ${size}`);
  const out: number[][] = [];
  for (let i = 0; i < tiles.length; i += size) out.push(tiles.slice(i, i + size));
  return out;
}
