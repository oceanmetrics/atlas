// report/data.ts -- atlas-7 step 2: turns a `PlaceStub` (model.ts#expandPlaces) into the
// `PlaceScoreInput`/`SpeciesRow[]` pair `buildReport()` wants, through the SAME engine plumbing the
// Places panel and the scores lens already use -- no second query path, per the phase's review
// checklist ("no second copy").
//
//   zone place  -> scores from `boot.zones` directly (model.ts#zoneScoreInput, synchronous, no
//                  engine at all -- a published zone_metric row IS the number); species through
//                  `speciesForZone()` (analysis/queries.ts), same as TablePanel.svelte's zones tab.
//   custom place -> `computeScoreResults()`/`computeSpeciesResults()` (places/results.ts), the D7b
//                  blended/clipped path a drawn place already uses in the Places panel.
//   upload place -> the geometry was never carried in the link (places/placeCodec.ts: an upload
//                  place is a NAME + a digest, the actual geometry lives only in the sender's
//                  browser storage) -- this module reports that as a `null` result with a reason
//                  the document can show, rather than throwing.
import { getDataEngine, type DataEngineContext } from "../places/dataEngine";
import { computeScoreResults, computeSpeciesResults } from "../places/results";
import { approxAreaKm2 } from "../places/area";
import { exclusive } from "../lib/analysis/exclusive";
import { speciesForZone, type SpeciesRow } from "../lib/analysis/queries";
import { zoneScoreInput, type PlaceScoreInput, type PlaceStub } from "../lib/report/model";
import type { SqlRun } from "../lib/report/provenance";
import type { AreaGeometry } from "../lib/geo/types";

/** `@duckdb/duckdb-wasm`'s pinned version (package.json) -- the provenance block's own line, not
 * re-derived at runtime (the package exposes no version string on its public API). */
export const DUCKDB_WASM_VERSION = "1.32.0";

export interface PlaceDataResult {
  scores: PlaceScoreInput | null;
  species: readonly SpeciesRow[] | null;
  /** set only when this place cannot be analysed at all (an upload place with no geometry, or an
   * engine failure) -- the document shows this instead of quietly staying "still loading". */
  error: string | null;
}

/** a zone place's scores: synchronous, straight out of `boot.zones` -- never the engine. */
export function zonePlaceScores(boot: unknown, unit: string, key: string): PlaceScoreInput {
  return zoneScoreInput(boot, unit, key);
}

/** a zone place's species table -- `species_for_zone.sql` over the release's `zone_taxon`. */
export async function zonePlaceSpecies(
  ctx: DataEngineContext,
  unit: string,
  key: string,
): Promise<SpeciesRow[]> {
  // usability B1: `species_agg`/`species_sel` are the SAME objects a custom place's species walk
  // replaces (places/results.ts) -- sequential in `Report.svelte` today, queued regardless
  return exclusive(ctx.sources.db, () =>
    speciesForZone(ctx.sources.db, ctx.sources.templates, {
      zoneFld: `${unit}_key`,
      zoneValue: key,
    }),
  );
}

/** a custom (drawn/decoded) place's scores -- the D7b-clipped blend (places/results.ts), the SAME
 * numbers the Places panel's own results tab shows for this geometry. */
export async function customPlaceScores(
  ctx: DataEngineContext,
  boot: unknown,
  geometry: AreaGeometry,
): Promise<PlaceScoreInput> {
  const r = await computeScoreResults(ctx, boot, geometry);
  return {
    components: r.components.map((c) => ({
      metric_key: c.metric_key,
      component: c.component,
      score: c.score,
      even: c.even,
      coverage: c.coverage,
      mean_where_present: c.mean_where_present,
    })),
    nCells: r.coverage.nCellsStudyArea,
    // approxAreaKm2 (places/area.ts): the same fast equirectangular estimate the Places panel's
    // own list column shows -- not the D7b-clipped, coverage-weighted figure (no single "area of
    // the whole place" query exists yet; see this module's header). Adequate for a display value.
    areaKm2: approxAreaKm2(geometry),
    nCellsTouched: r.coverage.nCellsTotal,
  };
}

/** a custom place's species table, batched over its `cell_model` tiles (places/results.ts). */
export async function customPlaceSpecies(
  ctx: DataEngineContext,
  geometry: AreaGeometry,
  onBatch?: (done: number, total: number) => void,
): Promise<SpeciesRow[]> {
  const r = await computeSpeciesResults(ctx, geometry, onBatch);
  return r.rows;
}

/** one place's full result, dispatched by kind -- the ONE function `Report.svelte` calls per
 * place, so the component itself never branches on `stub.place.kind`. */
export async function loadPlaceData(
  ctx: DataEngineContext | null,
  boot: unknown,
  stub: PlaceStub,
  geometry: AreaGeometry | undefined,
  onSpeciesBatch?: (done: number, total: number) => void,
): Promise<PlaceDataResult> {
  try {
    if (stub.place.kind === "zone") {
      const unit = stub.unit ?? stub.place.set;
      const key = stub.zoneKey ?? stub.place.keys[0];
      const scores = zonePlaceScores(boot, unit, key);
      const species = ctx ? await zonePlaceSpecies(ctx, unit, key) : null;
      return { scores, species, error: null };
    }
    if (stub.place.kind === "geom" && geometry && ctx) {
      const scores = await customPlaceScores(ctx, boot, geometry);
      const species = await customPlaceSpecies(ctx, geometry, onSpeciesBatch);
      return { scores, species, error: null };
    }
    if (stub.place.kind === "upload") {
      return {
        scores: null,
        species: null,
        error:
          "this place was drawn too large to carry in the link and only its name was saved — " +
          "re-add it from the Places panel to include it in a report.",
      };
    }
    return { scores: null, species: null, error: "no geometry to analyse." };
  } catch (err) {
    return {
      scores: null,
      species: null,
      error: err instanceof Error ? err.message : "this place could not be analysed.",
    };
  }
}

/** boots the engine once, memoised by `getDataEngine` itself -- exported so `Report.svelte` never
 * imports `places/dataEngine.ts` directly (one seam, easier to stub in a test). */
export function bootEngine(ver: string, boot: Record<string, unknown>): Promise<DataEngineContext> {
  return getDataEngine({ ver, boot });
}

/**
 * The provenance block's `tables` list -- ONLY the objects this particular report actually reads
 * (§8: "the digests of every table read"), not a fixed list that would claim `cell` was fetched
 * for a report with only zone places. `getDataEngine()`'s own `coreTables()` always loads
 * `taxon`/`zone_taxon`/`taxonomy` (and `model` on a `mdl_key` release) the moment ANY place needs
 * species -- see `analysis/sources.ts#coreTables`'s header -- so those are unconditional once an
 * engine boots at all; `cell` is added only when a custom (drawn) place is present.
 */
export function tablesReadFor(
  boot: unknown,
  stubs: readonly PlaceStub[],
  engineBooted: boolean,
): string[] {
  if (!engineBooted) return [];
  const idField = (boot as { id_field?: unknown } | null)?.id_field;
  const tables = ["taxon", "zone_taxon", "taxonomy"];
  if (idField === "mdl_key") tables.push("model");
  if (stubs.some((s) => s.place.kind === "geom")) tables.push("cell");
  return tables;
}

/** the `sql/*.sql` twins that actually ran, verbatim -- §8's "the SQL that ran (collapsed)". */
export function sqlRunFor(ctx: DataEngineContext | null, stubs: readonly PlaceStub[]): SqlRun[] {
  if (!ctx) return [];
  const t = ctx.sources.templates;
  const out: SqlRun[] = [];
  if (stubs.some((s) => s.place.kind === "geom")) {
    out.push({ name: "cells_in_study_area", sql: t.cells_in_study_area });
    out.push({ name: "scores_for_cells", sql: t.scores_for_cells });
    out.push({ name: "species_for_cells", sql: t.species_for_cells });
  }
  if (stubs.some((s) => s.place.kind === "zone")) {
    out.push({ name: "species_for_zone", sql: t.species_for_zone });
  }
  out.push({ name: "species_shares", sql: t.species_shares });
  return out;
}
