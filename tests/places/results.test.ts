import { describe, expect, it } from "vitest";
import {
  cellModelEnabled,
  cellModelTilePath,
  computeScoreResults,
  computeSpeciesResults,
  describeAnalysisError,
  fetchFailureFromError,
  placeCellsInStudyArea,
  placeRowAnalysis,
  speciesTilePlan,
  type ScoreResults,
} from "../../src/places/results";
import { PUBLIC_DATA_BASE } from "../../src/lib/release/dataBase";
import { TEMPLATES } from "../../src/lib/analysis/templates";
import type { SqlRunner } from "../../src/lib/analysis/queries";
import type { DataEngineContext } from "../../src/places/dataEngine";
import type { GridSpec } from "../../src/lib/grid/grid";
import type { AreaGeometry } from "../../src/lib/geo/types";

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

const SQUARE: AreaGeometry = {
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
};

describe("cellModelEnabled", () => {
  it("is true when boot has no capabilities section at all", () => {
    expect(cellModelEnabled({})).toBe(true);
    expect(cellModelEnabled(null)).toBe(true);
  });

  it("is true when capabilities.cell_model is anything other than exactly false", () => {
    expect(cellModelEnabled({ capabilities: { cell_model: true } })).toBe(true);
    expect(cellModelEnabled({ capabilities: {} })).toBe(true);
  });

  it("is false ONLY for an explicit false, per the task's literal wording", () => {
    expect(cellModelEnabled({ capabilities: { cell_model: false } })).toBe(false);
  });
});

describe("cellModelTilePath", () => {
  it("matches analysis/sources.ts's own construction", () => {
    expect(cellModelTilePath(42)).toBe("serve/cell_model/tile=42/data_0.parquet");
  });
});

/** the same fake DataEngineContext pattern tests/places/studyArea.test.ts uses. */
function fakeCtx(opts: {
  countAnswer?: number;
  /** the D7b-clipped rows `placeCellsInStudyArea` returns -- kept CONSISTENT with `countAnswer`
   * by the caller (both describe the SAME `place_cell_sa`), never derived from one another here,
   * so a test that passes both is the one asserting they actually agree. */
  saRows?: { cell_id: number; pct: number }[];
  scoreRows?: Record<string, unknown>[];
  speciesRows?: Record<string, unknown>[];
}): {
  ctx: DataEngineContext;
  cellTilesCalls: number[][];
  mountCalls: number[][];
  unmountCalls: number;
} {
  const cellTilesCalls: number[][] = [];
  const mountCalls: number[][] = [];
  let unmountCalls = 0;
  const db: SqlRunner = {
    async exec<T>(sql: string): Promise<T[]> {
      if (/SELECT count\(\*\)/i.test(sql)) return [{ n: opts.countAnswer ?? 10 }] as unknown as T[];
      if (/FROM place_cell_sa/i.test(sql) && /pct_covered\s+AS\s+pct/i.test(sql)) {
        return (opts.saRows ?? []) as unknown as T[];
      }
      if (/^\s*SELECT/i.test(sql) && /agg\.metric_key/i.test(sql)) {
        return (opts.scoreRows ?? []) as unknown as T[];
      }
      if (/^\s*SELECT/i.test(sql) && /species/i.test(sql)) {
        return (opts.speciesRows ?? []) as unknown as T[];
      }
      return [] as T[];
    },
  };
  const sources = {
    db,
    templates: TEMPLATES,
    async cellTiles(tiles: readonly number[]) {
      cellTilesCalls.push([...tiles]);
    },
    batches(tiles: readonly number[]) {
      return [[...tiles]];
    },
    async mountCellModel(tiles: readonly number[]) {
      mountCalls.push([...tiles]);
    },
    async unmountCellModel() {
      unmountCalls++;
    },
  };
  return {
    ctx: { sources, grid: GRID } as unknown as DataEngineContext,
    cellTilesCalls,
    mountCalls,
    unmountCalls,
  };
}

describe("speciesTilePlan", () => {
  it("names the release-relative URL for every tile the place touches", () => {
    const { ctx } = fakeCtx({});
    const plan = speciesTilePlan(ctx, "v9", SQUARE);
    expect(plan.tiles.length).toBeGreaterThan(0);
    for (const url of plan.urls) {
      expect(url).toMatch(/^v9\/serve\/cell_model\/tile=\d+\/data_0\.parquet$/);
    }
  });
});

describe("computeScoreResults", () => {
  it("computes coverage from the study-area cell count vs. the total", async () => {
    const { ctx, cellTilesCalls } = fakeCtx({ countAnswer: 5 });
    const boot = { layers: [] }; // no component metric keys -- components stays empty, harmlessly
    const result = await computeScoreResults(ctx, boot, SQUARE);
    expect(result.coverage.nCellsStudyArea).toBe(5);
    expect(result.coverage.nCellsTotal).toBeGreaterThan(0);
    expect(result.coverage.coveragePct).toBeCloseTo((5 / result.coverage.nCellsTotal) * 100);
    expect(cellTilesCalls).toHaveLength(1);
    expect(result.components).toEqual([]);
    expect(result.composite).toBeNaN(); // meanScore() of zero components
  });

  it("coveragePct is 0, not NaN, for a place with no cells at all", async () => {
    const { ctx } = fakeCtx({ countAnswer: 0 });
    (ctx as unknown as { grid: GridSpec }).grid = { ...GRID, nc: 1, nr: 1, xmin: 500, ymax: 500 };
    const result = await computeScoreResults(ctx, {}, SQUARE);
    expect(result.coverage.nCellsTotal).toBe(0);
    expect(result.coverage.coveragePct).toBe(0);
  });
});

describe("placeCellsInStudyArea", () => {
  it("returns the CLIPPED rows, and its count matches computeScoreResults' nCellsStudyArea for the SAME place -- fix round 1 (Opus review): 'show analysis cells' must paint exactly this set, never the raw geo/coverage.ts#cellsInPolygon() one", async () => {
    // a place straddling the study-area edge: 5 cells touched, only 2 (a fictional in/NULL pair)
    // survive the clip -- the fixture's own numbers are what "straddling the edge" means here; the
    // SQL twin's own behaviour (which rows survive coalesce(in_usa, TRUE)) is
    // tests/analysis/studyAreaClip.test.ts's job, not this file's.
    const saRows = [
      { cell_id: 11, pct: 100 },
      { cell_id: 42, pct: 60 },
    ];
    const { ctx } = fakeCtx({ countAnswer: saRows.length, saRows });

    const cells = await placeCellsInStudyArea(ctx, SQUARE);
    expect(cells).toEqual(saRows);

    const result = await computeScoreResults(ctx, {}, SQUARE);
    expect(cells.length).toBe(result.coverage.nCellsStudyArea);
  });

  it("never returns more cells than the place's own unclipped total", async () => {
    const { ctx } = fakeCtx({ countAnswer: 0, saRows: [] });
    const cells = await placeCellsInStudyArea(ctx, SQUARE);
    const result = await computeScoreResults(ctx, {}, SQUARE);
    expect(cells.length).toBeLessThanOrEqual(result.coverage.nCellsTotal);
  });
});

// P7 addendum: reproduced live against v7 (`-170,50,-130,60`, a box that runs past the populated
// footprint) -- `.../v7/app/cell/tile=593/data_0.parquet` answers 403 while its neighbours 588-592
// answer 200. `engine/materialize.ts#fetchWithSizeGuard` throws `Error("fetch <url>: HTTP 403")`,
// `engine.ts` wraps every failure as `EngineUnavailableError("data engine unavailable: <cause>")`.
describe("fetchFailureFromError / describeAnalysisError", () => {
  const url = `${PUBLIC_DATA_BASE}v7/app/cell/tile=593/data_0.parquet`;
  const wrapped = new Error(`data engine unavailable: fetch ${url}: HTTP 403`);

  it("names the release-relative OBJECT, not the whole https:// URL", () => {
    expect(fetchFailureFromError(wrapped)).toEqual({
      path: "v7/app/cell/tile=593/data_0.parquet",
      status: 403,
    });
  });

  it("describeAnalysisError names the release + object + status, live-reproduced wording", () => {
    expect(describeAnalysisError(wrapped)).toBe(
      "analysis unavailable for this release: v7/app/cell/tile=593/data_0.parquet (HTTP 403)",
    );
  });

  it("is null/falls back to the raw message for anything that is not a fetch failure", () => {
    const other = new Error("data engine unavailable: RuntimeError: function signature mismatch");
    expect(fetchFailureFromError(other)).toBeNull();
    expect(describeAnalysisError(other)).toBe(other.message);
  });

  it("falls back to a generic sentence for a non-Error throw", () => {
    expect(fetchFailureFromError("boom")).toBeNull();
    expect(describeAnalysisError("boom")).toBe("Couldn't compute scores for this place.");
  });

  it("keeps a URL outside PUBLIC_DATA_BASE verbatim (never mangled)", () => {
    const custom = new Error(
      "fetch https://example.com/v9/app/cell/tile=1/data_0.parquet: HTTP 404",
    );
    expect(fetchFailureFromError(custom)).toEqual({
      path: "https://example.com/v9/app/cell/tile=1/data_0.parquet",
      status: 404,
    });
  });
});

// P7: `Places.svelte`'s row chip used to hard-code `composite: null` for EVERY `kind: "geom"` row,
// unconditionally -- so a place stayed "not analysed yet" forever even once ResultsPanel had
// computed a real composite for it. `placeRowAnalysis` is what a row now reads instead.
describe("placeRowAnalysis", () => {
  const scored: ScoreResults = {
    coverage: { nCellsTotal: 200, nCellsStudyArea: 150, coveragePct: 75 },
    components: [],
    composite: 27.8,
  };

  it("undefined (not yet triggered) reads as 'not analysed yet' -- no status at all", () => {
    expect(placeRowAnalysis(undefined)).toEqual({ coveragePct: null, composite: null });
  });

  it("'loading' shows neither a number nor a stale one", () => {
    expect(placeRowAnalysis("loading")).toEqual({
      coveragePct: null,
      composite: null,
      status: "loading",
    });
  });

  it("a real ScoreResults shows the actual composite/coverage", () => {
    expect(placeRowAnalysis(scored)).toEqual({ coveragePct: 75, composite: 27.8 });
  });

  it("zero study-area coverage is 'outside', distinct from 'not analysed yet' or an error", () => {
    const outside: ScoreResults = {
      coverage: { nCellsTotal: 40, nCellsStudyArea: 0, coveragePct: 0 },
      components: [],
      composite: NaN,
    };
    expect(placeRowAnalysis(outside)).toEqual({
      coveragePct: 0,
      composite: null,
      status: "outside",
    });
  });

  it("a NaN composite (meanScore of zero components) never renders as a number", () => {
    const noComponents: ScoreResults = {
      coverage: { nCellsTotal: 40, nCellsStudyArea: 40, coveragePct: 100 },
      components: [],
      composite: NaN,
    };
    expect(placeRowAnalysis(noComponents).composite).toBeNull();
  });

  it("a described failure surfaces its own message, not a generic flag", () => {
    expect(
      placeRowAnalysis({ error: "analysis unavailable for this release: v7/x (HTTP 403)" }),
    ).toEqual({
      coveragePct: null,
      composite: null,
      status: "error",
      errorMessage: "analysis unavailable for this release: v7/x (HTTP 403)",
    });
  });
});

describe("computeSpeciesResults", () => {
  it("mounts and unmounts exactly one batch of cell_model tiles for a small place", async () => {
    const { ctx, mountCalls, unmountCalls: getUnmount } = fakeCtx({ speciesRows: [] });
    const progress: [number, number][] = [];
    await computeSpeciesResults(ctx, SQUARE, (done, total) => progress.push([done, total]));
    expect(mountCalls).toHaveLength(1);
    expect(progress).toEqual([[1, 1]]);
    void getUnmount;
  });
});
