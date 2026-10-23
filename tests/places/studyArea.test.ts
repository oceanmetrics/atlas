import { describe, expect, it } from "vitest";
import {
  checkTouchesStudyArea,
  outsideUsWaters,
  touchesStudyArea,
} from "../../src/places/studyArea";
import { allRefusalSamples } from "../../src/lib/geo/upload/messages";
import { TEMPLATES } from "../../src/lib/analysis/templates";
import type { SqlRunner } from "../../src/lib/analysis/queries";
import type { NormalizedPlace } from "../../src/lib/geo/upload/normalize";
import type { DataEngineContext } from "../../src/places/dataEngine";
import type { GridSpec } from "../../src/lib/grid/grid";

const GRID: GridSpec = {
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

const SQUARE: NormalizedPlace = {
  name: "Test Place",
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [-124, 40],
        [-124, 41],
        [-123, 41],
        [-123, 40],
        [-124, 40],
      ],
    ],
  },
  bbox: [-124, 40, -123, 41],
  vertices: 4,
  sourceIndex: 0,
};

/** a fake DataEngineContext: `db.exec`'s COUNT query answers `countAnswer`; every other statement
 * (the INSERTs/CREATE VIEW `createPlaceCells`/`createStudyAreaCells` issue) is accepted and
 * ignored -- this tests `studyArea.ts`'s own CONTROL FLOW (which SQL twins are called and in what
 * order, and how the count is turned into a boolean/refusal), not DuckDB itself, which the parity
 * harness (`tests/fixtures/parity-e2e/`) already exercises for real. */
function fakeCtx(countAnswer: number): { ctx: DataEngineContext; cellTilesCalls: number[][] } {
  const cellTilesCalls: number[][] = [];
  const db: SqlRunner = {
    async exec<T>(sql: string): Promise<T[]> {
      if (/SELECT count\(\*\)/i.test(sql)) return [{ n: countAnswer }] as unknown as T[];
      return [] as T[];
    },
  };
  const sources = {
    db,
    templates: TEMPLATES,
    async cellTiles(tiles: readonly number[]) {
      cellTilesCalls.push([...tiles]);
    },
  };
  return {
    ctx: { sources, grid: GRID } as unknown as DataEngineContext,
    cellTilesCalls,
  };
}

describe("outsideUsWaters", () => {
  it("names the place and never says 'invalid'", () => {
    const r = outsideUsWaters("Mid-Pacific Test");
    expect(r.what).toContain("Mid-Pacific Test");
    expect(r.rule).toBe("outsideStudyArea");
    for (const word of ["invalid", "bad file", "malformed", "error"]) {
      expect(r.what.toLowerCase()).not.toContain(word);
      expect(r.why.toLowerCase()).not.toContain(word);
      expect(r.fix.toLowerCase()).not.toContain(word);
    }
  });

  it("fits the same shape every other upload refusal does", () => {
    const sample = allRefusalSamples()[0];
    const r = outsideUsWaters("x");
    expect(Object.keys(r).sort()).toEqual(Object.keys(sample).sort());
  });
});

describe("touchesStudyArea", () => {
  it("fetches the place's own cell tiles, then answers true when the count is > 0", async () => {
    const { ctx, cellTilesCalls } = fakeCtx(42);
    const result = await touchesStudyArea(ctx, SQUARE);
    expect(result).toBe(true);
    expect(cellTilesCalls).toHaveLength(1);
    expect(cellTilesCalls[0].length).toBeGreaterThan(0);
  });

  it("answers false when the study-area cell count is 0", async () => {
    const { ctx } = fakeCtx(0);
    expect(await touchesStudyArea(ctx, SQUARE)).toBe(false);
  });

  it("answers false without even querying when the place falls entirely outside the release's grid", async () => {
    // a small, REGIONAL grid (like usa05, not global05) that a mid-Pacific square lands nowhere
    // near -- covers zero cells without needing a degenerate ring (which the codec itself refuses).
    const regional: GridSpec = { ...GRID, nc: 10, nr: 10, xmin: 0, ymax: 1, resx: 0.1, resy: 0.1 };
    const { ctx, cellTilesCalls } = fakeCtx(999);
    (ctx as unknown as { grid: GridSpec }).grid = regional;
    expect(await touchesStudyArea(ctx, SQUARE)).toBe(false);
    expect(cellTilesCalls).toHaveLength(0);
  });
});

describe("checkTouchesStudyArea", () => {
  it("is null (nothing refused) when every place touches the study area", async () => {
    const { ctx } = fakeCtx(10);
    expect(await checkTouchesStudyArea(ctx, [SQUARE])).toBeNull();
  });

  it("refuses, naming the first offending place, and stops there", async () => {
    const { ctx } = fakeCtx(0);
    const second: NormalizedPlace = { ...SQUARE, name: "Second Place" };
    const refusal = await checkTouchesStudyArea(ctx, [SQUARE, second]);
    expect(refusal?.rule).toBe("outsideStudyArea");
    expect(refusal?.what).toContain("Test Place");
    expect(refusal?.what).not.toContain("Second Place");
  });
});
