import { describe, expect, it } from "vitest";
import {
  cellBounds,
  cellSquare,
  cellsFeatureCollection,
  MAX_ANALYSIS_CELLS,
} from "../../src/places/cellSquares";
import type { GridSpec } from "../../src/lib/grid/grid";

const GLOBAL05: GridSpec = {
  gridId: "global05",
  nc: 7200,
  nr: 3600,
  xmin: -180,
  ymax: 90,
  resx: 0.05,
  resy: 0.05,
  lon360: false,
  tileSize: 50,
};

const USA05: GridSpec = {
  gridId: "usa05",
  nc: 3103,
  nr: 2006,
  xmin: 141.1,
  ymax: 74.3,
  resx: 0.05,
  resy: 0.05,
  lon360: true,
  tileSize: 50,
};

describe("cellBounds", () => {
  it("cell 1 (row 0, col 0) sits at the grid's own top-left corner", () => {
    expect(cellBounds(1, GLOBAL05)).toEqual([-180, 90 - 0.05, -180 + 0.05, 90]);
  });

  it("cell nc+1 (row 1, col 0) sits one row down", () => {
    const [x0, y0, x1, y1] = cellBounds(GLOBAL05.nc + 1, GLOBAL05);
    expect(x0).toBeCloseTo(-180);
    expect(y1).toBeCloseTo(90 - 0.05);
    expect(y0).toBeCloseTo(90 - 0.1);
    expect(x1).toBeCloseTo(-180 + 0.05);
  });

  it("each cell is exactly resx by resy", () => {
    const [x0, y0, x1, y1] = cellBounds(1234, GLOBAL05);
    expect(x1 - x0).toBeCloseTo(GLOBAL05.resx);
    expect(y1 - y0).toBeCloseTo(GLOBAL05.resy);
  });
});

describe("cellSquare", () => {
  it("is a closed 5-point ring", () => {
    const sq = cellSquare(1, GLOBAL05);
    expect(sq.type).toBe("Polygon");
    expect(sq.coordinates[0]).toHaveLength(5);
    expect(sq.coordinates[0][0]).toEqual(sq.coordinates[0][4]);
  });

  it("re-wraps a usa05 (lon360) cell past 180 back into -180..180 (map/layers/zones.ts's own rule)", () => {
    // a cell well past 180 in the raw 141.10-based frame -- pick a column far enough along.
    const raw = USA05.xmin + 2000 * USA05.resx; // ~241 deg raw
    expect(raw).toBeGreaterThan(180);
    const col = 2000;
    const sq = cellSquare(col + 1, USA05); // cell_id = row*nc + col + 1, row 0
    for (const [x] of sq.coordinates[0]) {
      expect(x).toBeGreaterThanOrEqual(-180);
      expect(x).toBeLessThanOrEqual(180);
    }
  });

  it("does NOT rewrap a global05 cell (already -180..180, lon360=false)", () => {
    const sq = cellSquare(1, GLOBAL05);
    expect(sq.coordinates[0][0][0]).toBe(-180);
  });
});

describe("cellsFeatureCollection", () => {
  it("carries pct and a matching 0-1 opacity property per cell", () => {
    const fc = cellsFeatureCollection(
      [
        { cell_id: 1, pct: 40 },
        { cell_id: 2, pct: 100 },
      ],
      GLOBAL05,
    );
    expect(fc.features).toHaveLength(2);
    expect(fc.features[0].properties).toEqual({ pct: 40, opacity: 0.4 });
    expect(fc.features[1].properties).toEqual({ pct: 100, opacity: 1 });
  });

  it("an empty cell list is an empty FeatureCollection", () => {
    expect(cellsFeatureCollection([], GLOBAL05)).toEqual({
      type: "FeatureCollection",
      features: [],
    });
  });
});

describe("MAX_ANALYSIS_CELLS", () => {
  it("is the documented 20k ceiling", () => {
    expect(MAX_ANALYSIS_CELLS).toBe(20_000);
  });
});
