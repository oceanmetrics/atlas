// atlas-4 step 2 — orchestrates the engine calls behind the species table / composition treemap,
// so `TablePanel.svelte` stays wiring. The three paths (parity doc §7.3): nothing selected ->
// `species_for_zone(subregion_key, zoneAllKey)`; a zone -> `species_for_zone(<unit>_key, key)`; a
// cell -> the study-area-clipped, batched `species_for_cells` path (D7b). `coreTables()` (taxon,
// zone_taxon, taxonomy) is fetched ONCE per release, memoised here — every later call, whichever
// path it takes, reuses it.
//
// atlas-8 review round 2, item 3a: the single-CELL branch builds the SAME shared `cell`/
// `place_cell`/`place_cell_sa`/`species_agg` objects a place analysis builds
// (`src/places/results.ts`), so the whole build-then-read sequence now runs inside
// `exclusive(sources.db, ...)` -- usability B1's rule (`src/lib/analysis/exclusive.ts`). Split
// into `loadSpeciesRowsFor` (takes an already-resolved `AnalysisSources`, so
// `tests/analysis/concurrentCellClick.test.ts` can drive it against a real, node-harnessed engine
// alongside a real place analysis) and `loadSpeciesRows` (the production entry point, resolving
// `sources` through the lens' memoised singleton first).
import { getAnalysisSources } from "./engine";
import { exclusive } from "../../lib/analysis/exclusive";
import {
  composition,
  createPlaceCells,
  createStudyAreaCells,
  speciesForCells,
  speciesForZone,
  type SpeciesRow,
} from "../../lib/analysis/queries";
import type { AnalysisSources } from "../../lib/analysis/sources";
import type { CompositionRow } from "./composition";
import { gridFromBoot, tileOf } from "../../lib/grid/grid";
import { zoneKeyProperty } from "../../lib/map/layers/zones";
import type { ScoresSelection } from "./selection";

let coreLoadedFor: string | null = null;

async function ensureCore(ver: string, boot: Record<string, unknown>) {
  const sources = await getAnalysisSources(ver, boot);
  if (coreLoadedFor !== ver) {
    await sources.coreTables();
    coreLoadedFor = ver;
  }
  return sources;
}

export interface SpeciesLoadOptions {
  selection: ScoresSelection;
  zoneAllKey: string;
}

/**
 * The species table's rows for the current selection, given an already-resolved `sources` — the
 * whole build-then-read sequence runs as ONE unit on `sources.db` (usability B1's rule): a cell
 * click's own value fetch (`cellClick.ts#fetchCellValue`) or another place's analysis
 * (`places/results.ts`) sharing this engine can no longer interleave with it. Throws (never
 * silently returns `[]`) on a genuine failure — the caller (`TablePanel.svelte`) turns that into
 * the "unavailable" header the parity doc's `tryCatch` branch shows, rather than an empty-looking
 * table.
 */
export function loadSpeciesRowsFor(
  sources: AnalysisSources,
  boot: Record<string, unknown>,
  opts: SpeciesLoadOptions,
): Promise<SpeciesRow[]> {
  return exclusive(sources.db, async () => {
    if (!opts.selection) {
      return speciesForZone(sources.db, sources.templates, {
        zoneFld: "subregion_key",
        zoneValue: opts.zoneAllKey,
      });
    }
    if (opts.selection.kind === "zone") {
      return speciesForZone(sources.db, sources.templates, {
        zoneFld: zoneKeyProperty(opts.selection.unit),
        zoneValue: opts.selection.key,
      });
    }
    const grid = gridFromBoot(boot);
    const tile = tileOf(opts.selection.cellId, grid);
    await sources.cellTiles([tile]); // no-op if this tile is already registered (digest-keyed)
    await createPlaceCells(sources.db, [{ cell_id: opts.selection.cellId, pct: 100 }]);
    await createStudyAreaCells(sources.db, sources.templates);
    const batches = sources.batches([tile]);
    try {
      return await speciesForCells(sources.db, sources.templates, {
        batches,
        mount: (tiles) => sources.mountCellModel(tiles),
        unmount: () => sources.unmountCellModel(),
      });
    } finally {
      await sources.unmountCellModel();
    }
  });
}

/** the production entry point — resolves `sources` through the lens' memoised singleton
 * (`ensureCore`), then {@link loadSpeciesRowsFor}. */
export async function loadSpeciesRows(
  ver: string,
  boot: Record<string, unknown>,
  opts: SpeciesLoadOptions,
): Promise<SpeciesRow[]> {
  const sources = await ensureCore(ver, boot);
  return loadSpeciesRowsFor(sources, boot, opts);
}

/** the composition treemap's rows, over whichever species table `loadSpeciesRows` most recently
 * populated (`species_sel`, `sql/species_shares.sql`'s own view — see `analysis/queries.ts`). */
export async function loadCompositionRows(
  ver: string,
  boot: Record<string, unknown>,
): Promise<CompositionRow[]> {
  const sources = await ensureCore(ver, boot);
  const rows = await composition(sources.db, sources.templates);
  return rows as unknown as CompositionRow[];
}
