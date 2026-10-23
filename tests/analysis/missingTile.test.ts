// tests/analysis/missingTile.test.ts -- P8 item 1: "a missing cell tile is EMPTY, not a failure."
//
// `placeCells`/`tilesForCells` (`analysis/place.ts`) compute tile indices GEOMETRICALLY, from the
// grid -- not from the release's actual object list -- so a place that touches land or runs past a
// release's published footprint asks for a tile that release never generated. Live-reproduced by
// P7 (v7, `-170,50,-130,60`): `.../v7/app/cell/tile=593/data_0.parquet` (and its `serve/cell_model`
// twin) answers 403 while neighbours 588-592 answer 200 -- S3's GetObject-without-ListBucket
// response for a missing key. That is a release-side gap, not a failure: the tile has no scored
// cells, so `AnalysisSources#cellTiles`/`#mountCellModel` (`lib/analysis/sources.ts`) now skip it
// and keep going. Anything else (5xx, a network error, a 403 on a non-tile object) must still
// reject -- `places/results.ts#describeAnalysisError`'s honest sentence, unchanged.
//
// This file has two tiers: fast, pure unit tests of the classifier (Part 1, no DuckDB), and a real
// `Engine` + `AnalysisSources` + `places/results.ts` integration proof of the aggregation over a
// mix of present/missing tiles (Part 2, `tests/analysis/nodeEngine.ts` -- the same real-DuckDB
// harness `concurrentPlaces.test.ts` uses).
import { beforeAll, describe, expect, it } from "vitest";
import { AnalysisSources, isMissingTileStatus } from "../../src/lib/analysis/sources";
import { placeCells, tilesForCells } from "../../src/lib/analysis/place";
import { EngineUnavailableError } from "../../src/lib/engine/engine";
import { TEMPLATES } from "../../src/lib/analysis/templates";
import { gridFromBoot } from "../../src/lib/grid/grid";
import type { AreaGeometry } from "../../src/lib/geo/types";
import type { DataEngineContext } from "../../src/places/dataEngine";
import { computeScoreResults, describeAnalysisError } from "../../src/places/results";
import { instantiateNodeDuckdb, nodeEngine, type NodeDuckdb } from "./nodeEngine";

// ---- Part 1: the classifier, in isolation (tile URL + status -> empty vs error) ----------------

describe("isMissingTileStatus (the empty-vs-error classifier)", () => {
  it("is true for a raw fetchWithSizeGuard 403", () => {
    expect(
      isMissingTileStatus(
        new Error("fetch https://x/v7/app/cell/tile=593/data_0.parquet: HTTP 403"),
      ),
    ).toBe(true);
  });

  it("is true for a raw 404 -- S3's 403 and a plain 404 mean the same thing", () => {
    expect(isMissingTileStatus(new Error("fetch https://x/tile=9/data_0.parquet: HTTP 404"))).toBe(
      true,
    );
  });

  it("survives EngineUnavailableError's own wrapping (engine.ts wraps EVERY load() failure)", () => {
    const wrapped = new EngineUnavailableError(
      new Error("fetch https://x/v7/app/cell/tile=593/data_0.parquet: HTTP 403"),
    );
    expect(wrapped.message).toBe(
      "data engine unavailable: fetch https://x/v7/app/cell/tile=593/data_0.parquet: HTTP 403",
    );
    expect(isMissingTileStatus(wrapped)).toBe(true);
  });

  it("is FALSE for a 5xx -- a real server failure must still surface as one", () => {
    expect(isMissingTileStatus(new Error("fetch https://x/tile=1/data_0.parquet: HTTP 500"))).toBe(
      false,
    );
    expect(isMissingTileStatus(new Error("fetch https://x/tile=1/data_0.parquet: HTTP 503"))).toBe(
      false,
    );
  });

  it("is FALSE for anything that isn't this fetch-failure shape (a network error, a WASM crash)", () => {
    expect(isMissingTileStatus(new Error("Failed to fetch"))).toBe(false);
    expect(isMissingTileStatus(new Error("RuntimeError: function signature mismatch"))).toBe(false);
    expect(isMissingTileStatus("boom")).toBe(false);
    expect(isMissingTileStatus(null)).toBe(false);
  });

  it("is FALSE for a 403 that merely CONTAINS other digits before the trailing status", () => {
    // guards against a naive /\d+/ match picking up part of the URL/tile number instead of the
    // trailing HTTP status.
    expect(
      isMissingTileStatus(new Error("fetch https://x/tile=403/data_0.parquet: HTTP 500")),
    ).toBe(false);
  });
});

// ---- Part 2: the real aggregation, a mix of present + missing tiles ----------------------------

const NC = 8;
const TILE = 4;
const BASE = "https://fixture.test/";
const VER = "vM";

const BOOT = {
  ver: VER,
  built_at: "2026-09-24T00:00:00Z",
  id_field: "mdl_key",
  grid: {
    nc: NC,
    nr: NC,
    xmin: -125,
    ymax: 42,
    resx: 0.05,
    resy: 0.05,
    lon360: false,
    tile: { size: TILE },
  },
  layers: [{ metric_key: "extrisk_bird_ecoregion_rescaled", category: "component" }],
  tables: {},
};

const rowOf = (id: number) => Math.floor((id - 1) / NC) + 1;
const colOf = (id: number) => ((id - 1) % NC) + 1;
const tileOfCell = (id: number) =>
  Math.floor((rowOf(id) - 1) / TILE) * (NC / TILE) + Math.floor((colOf(id) - 1) / TILE);

const enc = (s: string) => new TextEncoder().encode(s);

/** tile 0 present, tile 1 DELIBERATELY ABSENT (the fixture's `nodeEngine` 404s anything not in its
 * `files` map -- this reproduces the live 403/404 P7 found without a real S3). */
function fixtureFiles(): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const cells = Array.from({ length: NC * NC }, (_, i) => i + 1);
  const mine = cells.filter((id) => tileOfCell(id) === 0);
  const cellCsv = [
    "cell_id,in_usa,area_km2,extrisk_bird_ecoregion_rescaled",
    ...mine.map((id) => `${id},true,${20 + id / 10},${id * 1.5}`),
  ].join("\n");
  files.set(`${VER}/app/cell/tile=0/data_0.parquet`, enc(cellCsv));
  // NOTE: no `tile=1` entry at all -- 404s.
  files.set(
    `${VER}/app/taxon.parquet`,
    enc(
      "key,sp_cat,common,sci,taxon_id,taxon_authority,er_code,er_score,is_mmpa,is_mbta,valid_usa\nsp:1,bird,gull,Larus one,worms:1,worms,EN,50,false,true,true",
    ),
  );
  files.set(`${VER}/tables/model.parquet`, enc("mdl_id,mdl_key\n1,sp:1"));
  files.set(`${VER}/app/zone_taxon.parquet`, enc("zone_value,mdl_key\nz:1,sp:1"));
  files.set(`${VER}/app/taxonomy.parquet`, enc("taxon_id,Kingdom\nworms:1,Animalia"));
  return files;
}

const box = (x0: number, y0: number, x1: number, y1: number): AreaGeometry => ({
  type: "Polygon",
  coordinates: [
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
      [x0, y0],
    ],
  ],
});

// GRID-ALIGNED boundaries (exact multiples of resx/resy=0.05 from xmin=-125/ymax=42), not the
// "just inside" insets `concurrentPlaces.test.ts` uses elsewhere -- those insets deliberately give
// their boundary COLUMN partial pct_covered (a different fixture's point), which would make a
// bigger and a smaller box disagree at their shared edge for a reason that has nothing to do with
// this file's rule. Grid-aligned edges give every included cell pct_covered = 100 exactly, so
// TILE0_ONLY_PLACE really is "the tile-0 half of MIXED_PLACE", byte for byte.

/** spans tile 0 (rows 1-4, cols 1-4: 16 cells, present) AND tile 1 (rows 1-4, cols 5-8: 16 cells,
 * missing) -- Ben's rectangle in miniature: a place whose geometric footprint legitimately reaches
 * a tile the release never generated. */
const MIXED_PLACE = box(-125.0, 41.8, -124.6, 42.0);
/** tile 0 alone (same rows, half the width) -- the "what SHOULD the present tile alone answer"
 * baseline the mixed-place composite must reproduce exactly. */
const TILE0_ONLY_PLACE = box(-125.0, 41.8, -124.8, 42.0);
/** entirely inside tile 1 -- EVERY tile this place touches is missing. */
const ALL_MISSING_PLACE = box(-124.8, 41.8, -124.6, 42.0);

let bindings: NodeDuckdb;

beforeAll(async () => {
  bindings = await instantiateNodeDuckdb();
}, 180_000);

async function freshCtx(): Promise<DataEngineContext> {
  const engine = nodeEngine(bindings, BASE, fixtureFiles());
  const sources = new AnalysisSources(engine, {
    url: (p) => `${BASE}${VER}/${p}`,
    boot: BOOT,
    templates: TEMPLATES,
  });
  await sources.coreTables();
  return { engine, sources, grid: gridFromBoot(BOOT) };
}

describe("P8 item 1: a place spanning a present + a missing tile still gets a composite", () => {
  it("fixture sanity: MIXED_PLACE really touches both tiles, ALL_MISSING_PLACE only the missing one -- so the 'no throw' results below aren't vacuous", () => {
    const grid = gridFromBoot(BOOT);
    expect(tilesForCells(placeCells(MIXED_PLACE, grid), grid)).toEqual([0, 1]);
    expect(tilesForCells(placeCells(ALL_MISSING_PLACE, grid), grid)).toEqual([1]);
  });

  it("computeScoreResults does NOT throw, and the row shows a real composite -- never the release-side gap", async () => {
    const ctx = await freshCtx();
    const result = await computeScoreResults(ctx, BOOT, MIXED_PLACE);
    // 32 cells touched GEOMETRICALLY (16 per tile, `placeCells` doesn't know which tiles were
    // published), but only tile 0's 16 ever reach `place_cell_sa` -- tile 1's cells never appear in
    // the `cell` view at all, so the JOIN simply doesn't match them ("no scored cells there").
    expect(result.coverage.nCellsTotal).toBe(32);
    expect(result.coverage.nCellsStudyArea).toBe(16);
    expect(result.coverage.coveragePct).toBeCloseTo(50, 10);
    expect(result.composite).not.toBeNaN();
    expect(Number.isFinite(result.composite)).toBe(true);
  }, 60_000);

  it("a solo run over the PRESENT tile alone reproduces the EXACT same composite -- the missing tile contributed nothing, corrupted nothing", async () => {
    const ctxMixed = await freshCtx();
    const mixed = await computeScoreResults(ctxMixed, BOOT, MIXED_PLACE);

    const ctxSolo = await freshCtx();
    const solo = await computeScoreResults(ctxSolo, BOOT, TILE0_ONLY_PLACE);

    expect(solo.coverage.nCellsStudyArea).toBe(16);
    expect(mixed.composite).toBeCloseTo(solo.composite, 10);
  }, 60_000);

  it("EVERY tile missing: a real (zero-coverage) result, never a '#view not registered' crash", async () => {
    const ctx = await freshCtx();
    const result = await computeScoreResults(ctx, BOOT, ALL_MISSING_PLACE);
    expect(result.coverage.nCellsTotal).toBeGreaterThan(0); // the geometric footprint is real
    expect(result.coverage.nCellsStudyArea).toBe(0); // but nothing published for any of it
    expect(result.composite).toBeNaN(); // meanScore() of zero components -- the honest "no data"
  }, 60_000);

  it("a REAL failure (a 5xx tile, not a release-side gap) is NOT swallowed -- computeScoreResults rejects, with the honest message", async () => {
    // tile 1 answers 500 instead of the fixture's default 404 -- proves the skip-on-403/404 branch
    // in `cellTiles()` does NOT also skip a genuine server error.
    const engine = nodeEngine(bindings, BASE, fixtureFiles(), {
      statusFor: (path) => (path.includes("tile=1/") ? 500 : undefined),
    });
    const sources = new AnalysisSources(engine, {
      url: (p) => `${BASE}${VER}/${p}`,
      boot: BOOT,
      templates: TEMPLATES,
    });
    await sources.coreTables();
    const ctx: DataEngineContext = { engine, sources, grid: gridFromBoot(BOOT) };

    let caught: unknown;
    try {
      await computeScoreResults(ctx, BOOT, MIXED_PLACE);
    } catch (err) {
      caught = err;
    }
    expect(
      caught,
      "expected computeScoreResults to reject on a real 500, not skip it",
    ).toBeDefined();
    expect(describeAnalysisError(caught)).toContain("HTTP 500");
    expect(describeAnalysisError(caught)).toContain("tile=1");
  }, 60_000);
});
