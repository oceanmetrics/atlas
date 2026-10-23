// places/cellSquares.ts -- Deliverable 2's "show analysis cells" toggle: each covered cell as a
// GeoJSON square carrying its own `pct` (1-100) and `opacity` (`pct / 100`) properties, so the
// selection layer's fill-opacity can be DATA-DRIVEN per cell (map/style.ts's `cellOpacity` flag on
// `SelectionSpec`) instead of the flat 0.15 an ordinary selection highlight uses.
import type { Feature, FeatureCollection, Polygon } from "geojson";
import type { CellCoverage } from "../lib/geo/coverage";
import type { GridSpec } from "../lib/grid/grid";

/** Deliverable 2: "places <= 20k cells" -- past this, painting one polygon per cell is not worth
 * the GPU/memory cost of a FeatureCollection this large; the caller offers the toggle disabled
 * rather than building (and shipping to the GPU) a huge source. */
export const MAX_ANALYSIS_CELLS = 20_000;

/** a raw grid longitude back into -180..180 -- the SAME rewrap `map/layers/zones.ts`'s
 * `zoneLabelsFromBoot` already applies to `usa05`'s (`lon360`) cached label points, for the
 * identical reason: a GeoJSON source is RFC 7946, and MapLibre would place a 250 deg vertex a
 * world away from the polygon it belongs to. */
function wrapLon(x: number): number {
  return x > 180 ? x - 360 : x;
}

/** the four corners of one cell, `[xmin, ymin, xmax, ymax]`, in the grid's own (possibly 0-360)
 * frame -- exported so a test can check the un-wrapped geometry directly. */
export function cellBounds(cellId: number, grid: GridSpec): [number, number, number, number] {
  const row = Math.floor((cellId - 1) / grid.nc);
  const col = (cellId - 1) % grid.nc;
  const x0 = grid.xmin + col * grid.resx;
  const y1 = grid.ymax - row * grid.resy;
  return [x0, y1 - grid.resy, x0 + grid.resx, y1];
}

export function cellSquare(cellId: number, grid: GridSpec): Polygon {
  const [x0, y0, x1, y1] = cellBounds(cellId, grid);
  const [lx0, lx1] = [wrapLon(x0), wrapLon(x1)];
  return {
    type: "Polygon",
    coordinates: [
      [
        [lx0, y0],
        [lx0, y1],
        [lx1, y1],
        [lx1, y0],
        [lx0, y0],
      ],
    ],
  };
}

export function cellsFeatureCollection(
  cells: readonly CellCoverage[],
  grid: GridSpec,
): FeatureCollection {
  const features: Feature[] = cells.map((c) => ({
    type: "Feature",
    geometry: cellSquare(c.cell_id, grid),
    properties: { pct: c.pct, opacity: c.pct / 100 },
  }));
  return { type: "FeatureCollection", features };
}
