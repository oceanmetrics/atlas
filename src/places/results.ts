// places/results.ts -- Deliverable 5: composite / components / species for a custom place, by the
// PUBLISHED zone method (master plan D7/D7b) through the existing SQL twins -- the same numbers a
// Program Area's own page shows, computed over a place's own cell set instead of a zone's. The
// flower/DataTable rendering is `ResultsPanel.svelte`'s job (shared `src/lib/ui/` components, not
// anything belonging to the scores lens); this module is engine-facing and lens-agnostic.
import { exclusive } from "../lib/analysis/exclusive";
import { placeCells, tilesForCells } from "../lib/analysis/place";
import {
  componentMetricKeys,
  createPlaceCells,
  createStudyAreaCells,
  meanScore,
  scoresForCells,
  speciesForCells,
  type ComponentScore,
  type SpeciesRow,
} from "../lib/analysis/queries";
import type { DataEngineContext } from "./dataEngine";
import type { AreaGeometry } from "../lib/geo/types";
import type { CellCoverage } from "../lib/geo/coverage";
import { PUBLIC_DATA_BASE } from "../lib/release/dataBase";
// Q3 (P round, item 1): a ZONE place's species table goes through the SAME path the scores lens'
// own Table > Zones tool uses -- `loadSpeciesRowsFor` (given an already-booted `sources`, not the
// lens' memoised singleton) and `zoneAllKey` (unused for a `kind: "zone"` selection but part of
// its options shape) -- see `zoneSpeciesResults`'s own header below for why this needs no fetch
// plan, unlike {@link computeSpeciesResults} just above it.
import { loadSpeciesRowsFor } from "../lens/scores/speciesLoad";
import { zoneAllKey } from "../lens/scores/boot";

export interface CoverageSummary {
  /** cells this place's geometry overlaps, before any study-area clip. */
  nCellsTotal: number;
  /** D7b: touched cells that are inside the release's study area -- what scores/species/area are
   * actually computed over. */
  nCellsStudyArea: number;
  /** `nCellsStudyArea / nCellsTotal * 100`; 0 for a place with no cells at all. */
  coveragePct: number;
}

export interface ScoreResults {
  coverage: CoverageSummary;
  components: ComponentScore[];
  /** `msens::mean_score()` -- NaN when the place has no scored cell at all. */
  composite: number;
}

/** `Places.svelte`'s own per-place cache entry -- a real result, mid-flight, or a described
 * failure (never a bare `"error"` flag: {@link describeAnalysisError}'s own header explains why a
 * place's row has to be able to say WHAT failed). */
export type PlaceScoreState = ScoreResults | "loading" | { error: string };

export interface PlaceRowAnalysis {
  coveragePct: number | null;
  composite: number | null;
  /** what to show in place of a composite chip while there is no number to show. */
  status?: "loading" | "error" | "outside";
  errorMessage?: string;
}

/**
 * `placeScores[key]` (`Places.svelte`'s cache, keyed by a place's own geometry) -> what its row's
 * chip should show. Pulled out as a pure function -- CLAUDE.md's "keep core logic in an exported
 * function ... a component just calls it" -- so every branch (still loading, a described failure,
 * analysed-but-zero-study-area-coverage, a real composite) has a direct unit test independent of
 * Svelte. `undefined` (never triggered yet, e.g. no release resolved) reads the same as "not
 * analysed yet" always has.
 */
export function placeRowAnalysis(cached: PlaceScoreState | undefined): PlaceRowAnalysis {
  if (cached === undefined) return { coveragePct: null, composite: null };
  if (cached === "loading") return { coveragePct: null, composite: null, status: "loading" };
  if (typeof cached === "object" && "error" in cached) {
    return { coveragePct: null, composite: null, status: "error", errorMessage: cached.error };
  }
  if (cached.coverage.nCellsStudyArea === 0) {
    // analysed, genuinely has no US-study-area coverage -- distinct from "not analysed yet".
    return { coveragePct: 0, composite: null, status: "outside" };
  }
  return {
    coveragePct: cached.coverage.coveragePct,
    composite: Number.isFinite(cached.composite) ? cached.composite : null,
  };
}

/** `boot.capabilities.cell_model` (schema TBD, atlas-1): `false` is the ONLY value that turns
 * species off -- absent/unknown fails OPEN here (species is attempted; a real fetch failure is
 * caught and surfaced separately), matching the task's literal "capabilities.cell_model = false". */
export function cellModelEnabled(boot: unknown): boolean {
  const caps = (boot as { capabilities?: { cell_model?: unknown } } | null | undefined)
    ?.capabilities;
  return caps?.cell_model !== false;
}

/** the `place_cell`/`place_cell_sa` setup every result below depends on -- idempotent
 * (`CREATE OR REPLACE`), so calling it more than once for the same place is harmless.
 *
 * usability B1: ONLY ever called inside `exclusive()` (`lib/analysis/exclusive.ts`), together with
 * the reads that depend on it. Between this function's statements and the scores/species query
 * after it, nothing else may touch `cell`/`place_cell`/`place_cell_sa` -- on 0.10.21 a second
 * analysis did, and a place read 200 % coverage or another place's scores. */
async function ensurePlaceCells(ctx: DataEngineContext, geometry: AreaGeometry) {
  const cells = placeCells(geometry, ctx.grid);
  await ctx.sources.cellTiles(tilesForCells(cells, ctx.grid));
  await createPlaceCells(ctx.sources.db, cells);
  const nCellsStudyArea = await createStudyAreaCells(ctx.sources.db, ctx.sources.templates);
  return { cells, nCellsStudyArea };
}

/** D7b's coverage + Deliverable 5's composite/components. Requires `ctx.sources.coreTables()` to
 * have already run (`dataEngine.ts`'s `boot()` does this once, before this is ever called). */
export function computeScoreResults(
  ctx: DataEngineContext,
  boot: unknown,
  geometry: AreaGeometry,
): Promise<ScoreResults> {
  // usability B1: the cell set and the scores read over it are ONE unit on this engine
  return exclusive(ctx.sources.db, async () => {
    const { cells, nCellsStudyArea } = await ensurePlaceCells(ctx, geometry);
    const coverage: CoverageSummary = {
      nCellsTotal: cells.length,
      nCellsStudyArea,
      coveragePct: cells.length ? (nCellsStudyArea / cells.length) * 100 : 0,
    };
    const metricKeys = componentMetricKeys(boot);
    const components = metricKeys.length
      ? await scoresForCells(ctx.sources.db, ctx.sources.templates, { metricKeys })
      : [];
    return { coverage, components, composite: meanScore(components) };
  });
}

/**
 * D7b's CLIPPED cell set -- the actual rows `place_cell_sa` holds (`sql/cells_in_study_area.sql`),
 * never the raw, unclipped `geo/coverage.ts#cellsInPolygon()` result. Fix round 1 (Opus review):
 * "show analysis cells" was painting the unclipped set (14,238 squares for a place whose analysis
 * only touches 14,165 cells) because it called `cellsInPolygon` directly instead of asking the
 * engine for the SAME clip `computeScoreResults` already runs. This is that clip, exposed so the
 * toggle can paint exactly what D7b says drives scores/species/area/N cells -- nothing else.
 */
export function placeCellsInStudyArea(
  ctx: DataEngineContext,
  geometry: AreaGeometry,
): Promise<CellCoverage[]> {
  // usability B1: the toggle running beside the SAME place's scores is how 0.10.21 doubled
  // `place_cell` -- both inserted into one table between two `CREATE OR REPLACE`s
  return exclusive(ctx.sources.db, async () => {
    await ensurePlaceCells(ctx, geometry);
    return ctx.sources.db.exec<CellCoverage>(
      "SELECT cell_id, pct_covered AS pct FROM place_cell_sa ORDER BY cell_id;",
    );
  });
}

/** the `serve/cell_model` tile path a release publishes -- mirrors `analysis/sources.ts`'s own
 * (private) construction of it, so the fetch-plan estimate and the actual mount agree on the URL. */
export const cellModelTilePath = (tile: number): string =>
  `serve/cell_model/tile=${tile}/data_0.parquet`;

/** the tiles a place's species table needs, and their `cell_model` URLs -- what
 * `places/fetchPlan.ts` measures BEFORE anything is fetched. */
export function speciesTilePlan(
  ctx: DataEngineContext,
  ver: string,
  geometry: AreaGeometry,
): { tiles: number[]; urls: string[] } {
  const cells = placeCells(geometry, ctx.grid);
  const tiles = tilesForCells(cells, ctx.grid);
  return { tiles, urls: tiles.map((t) => `${ver}/${cellModelTilePath(t)}`) };
}

export interface SpeciesResults {
  rows: SpeciesRow[];
  tilesUsed: number;
}

/**
 * The species table, fetched in <= `MAX_CELL_MODEL_TILES`-tile batches (bounded memory, plan
 * `engine/`) -- called only after the fetch plan was shown and (if over the threshold) accepted.
 * `onBatch` fires after each batch's buffers are dropped, for a progress readout.
 */
export function computeSpeciesResults(
  ctx: DataEngineContext,
  geometry: AreaGeometry,
  onBatch?: (done: number, total: number) => void,
): Promise<SpeciesResults> {
  // usability B1: every batch mounts `cell_model`/`cell_model_key` and reads `place_cell_sa`, and
  // the combine replaces `species_agg`/`species_sel` -- the whole walk is one unit on this engine
  return exclusive(ctx.sources.db, async () => {
    await ensurePlaceCells(ctx, geometry);
    const cells = placeCells(geometry, ctx.grid);
    const tiles = tilesForCells(cells, ctx.grid);
    const batches = ctx.sources.batches(tiles);
    let done = 0;
    const rows = await speciesForCells(ctx.sources.db, ctx.sources.templates, {
      batches,
      mount: (batchTiles) => ctx.sources.mountCellModel(batchTiles),
      unmount: async (batchTiles) => {
        await ctx.sources.unmountCellModel();
        void batchTiles;
        done++;
        onBatch?.(done, batches.length);
      },
    });
    return { rows, tilesUsed: tiles.length };
  });
}

/**
 * ONE zone's species table (Q3, item 1: "the species table on request through the same zone-
 * species path the Table > Zones tool uses"). `speciesLoad.ts#loadSpeciesRowsFor`, given THIS
 * module's own already-booted `ctx.sources` rather than the scores lens' own memoised singleton --
 * so a zone place selected in Places never depends on ScoresLens having been mounted at all, and
 * cannot race it (`loadSpeciesRowsFor` already wraps the whole read in `exclusive(sources.db, ...)`,
 * the same FIFO {@link computeScoreResults} and {@link computeSpeciesResults} use).
 *
 * Unlike {@link computeSpeciesResults} (a custom place's cell-model tiles, fetched in bounded-memory
 * batches), `species_for_zone.sql` reads the WHOLE `zone_taxon` table `AnalysisSources#coreTables()`
 * already loaded before this is ever called -- one query against data already in memory, so there
 * is no fetch plan/tile-count confirmation step here (`ResultsPanel.svelte`'s own "Loading species
 * needs N tiles" prompt is a custom-place-only concept: it simply does not apply to a zone).
 */
export function zoneSpeciesResults(
  ctx: DataEngineContext,
  boot: unknown,
  unit: string,
  key: string,
): Promise<SpeciesRow[]> {
  return loadSpeciesRowsFor(ctx.sources, (boot ?? {}) as Record<string, unknown>, {
    selection: { kind: "zone", unit, key },
    zoneAllKey: zoneAllKey(boot),
  });
}

// --- P7 addendum: honest failures for a MISSING release object -----------------------------------
//
// A drawn place can legitimately cover ground a release never published a tile for -- `placeCells`
// walks the geometric grid, not the release's actual object list, so a box that touches land or
// runs past the populated footprint asks `AnalysisSources#cellTiles` for a `app/cell/tile={t}/
// data_0.parquet` that genuinely does not exist. S3 answers a GetObject on a missing key with 403
// (no ListBucket permission to disclose 404 vs "forbidden"), `engine/materialize.ts#fetchWithSizeGuard`
// throws `Error("fetch <url>: HTTP 403")`, and `engine.ts` normalizes every failure into
// `EngineUnavailableError("data engine unavailable: <cause>")` -- reproduced live (v7,
// `-170,50,-130,60`): `.../v7/app/cell/tile=593/data_0.parquet` 403s while its neighbours 588-592
// answer 200. `computeScoreResults`'s own callers used to show that raw, stack-shaped message
// verbatim (or, `Places.svelte`'s row chip, nothing analysis-specific at all -- see this module's
// header) -- neither says what actually happened. `describeAnalysisError` names the missing OBJECT
// (release-relative, not the whole `https://` URL) when the failure is exactly this shape, so a
// release gap reads as "analysis unavailable for this release: v7/app/cell/tile=593/data_0.parquet
// (HTTP 403)" -- a sentence that can be handed to whoever publishes the release, not a stack trace.
// Anything else (a WASM crash, a malformed query) falls back to the error's own message, unchanged.

/** the release-relative KEY inside `err`'s own message, when it names one via
 * `fetchWithSizeGuard`'s "fetch <url>: HTTP <code>" shape -- `null` for anything else (a WASM
 * crash, a malformed query, ...). Strips {@link PUBLIC_DATA_BASE} so the result names an OBJECT
 * ("v7/app/cell/tile=593/data_0.parquet"), not a full URL. */
export function fetchFailureFromError(err: unknown): { path: string; status: number } | null {
  const msg = err instanceof Error ? err.message : String(err);
  const m = /fetch (\S+): HTTP (\d+)/.exec(msg);
  if (!m) return null;
  const [, url, status] = m;
  const path = url.startsWith(PUBLIC_DATA_BASE) ? url.slice(PUBLIC_DATA_BASE.length) : url;
  return { path, status: Number(status) };
}

/** one honest sentence for a failed place analysis -- the ONE place `Places.svelte`'s row chip and
 * `ResultsPanel.svelte`'s own error paragraph both build their text from, so the two can never say
 * two different things about the SAME failure. */
export function describeAnalysisError(err: unknown): string {
  const failure = fetchFailureFromError(err);
  if (failure) {
    return `analysis unavailable for this release: ${failure.path} (HTTP ${failure.status})`;
  }
  return err instanceof Error ? err.message : "Couldn't compute scores for this place.";
}
