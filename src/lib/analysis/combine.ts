// analysis/combine.ts -- the bounded-memory combine (atlas-2 Step 3b).
//
// `sql/species_for_cells.sql` answers ONE batch of <= 8 `cell_model` tiles with PARTIAL sums, so
// the batch's buffers can be dropped before the next one is fetched. This module is the other half:
// it folds the partials back into msens::species_for_cells()'s own `area_km2` and `avg_suit`.
//
// WHY IT IS EXACT, and therefore why the batch size is a memory dial and never a number that can
// move an answer (`tests/analysis/batching.test.ts` asserts batched == unbatched to 1e-12):
//
//   area_km2 = sum over cells of (area * pct / 100)      -- a SUM, so it partitions
//   avg_suit = sum(val * pct) / sum(pct) / 100           -- a RATIO OF SUMS, so both partition
//
// Each cell belongs to exactly one tile and therefore to exactly one batch, so no term is counted
// twice and none is missed. The only inexactness is floating-point ASSOCIATIVITY (a different
// summation order gives a different last bit), which is why the fixture's tolerance is 1e-12 rather
// than 0 -- see calc.R:506-507 for the two expressions being reproduced.
//
// No engine, no network: a pure function over plain rows, so the property above is provable under
// Node with no DuckDB at all.

/** the identity columns `sql/species_for_cells.sql` carries on every partial row. */
export interface SpeciesIdentity {
  sp_cat: string;
  sp_common: string | null;
  sp_scientific: string;
  taxon_id: string | null;
  taxon_authority: string | null;
  er_code: string | null;
  er_score: number | null;
  is_mmpa: boolean | null;
  is_mbta: boolean | null;
  mdl_key: string;
}

/** one batch's partial sums for one species. */
export interface SpeciesPartial extends SpeciesIdentity {
  /** sum(area_km2 * pct_covered / 100) */
  sum_area: number;
  /** sum(val * pct_covered) */
  sum_val_pct: number;
  /** sum(pct_covered) */
  sum_pct: number;
}

/** the shape msens::species_for_cells() produces before `.species_shares()` runs. */
export interface SpeciesAgg extends SpeciesIdentity {
  area_km2: number;
  avg_suit: number;
}

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Fold every batch's partials into one row per `mdl_key`.
 *
 * `mdl_key` is the key, not the scientific name: it is the model id (v8+ `mdl_key`, v1-v7 the
 * stringified `mdl_seq`), which is what R groups by too (calc.R:505, `GROUP BY ... 10`). Two models
 * of the same species stay two rows, exactly as they do in R.
 *
 * Batch order does not matter to the result beyond floating-point associativity, but it IS made
 * deterministic here (insertion order = the order the batches arrived, which the caller derives
 * from the ascending tile list), so two runs of the same place give bit-identical numbers.
 */
export function combineSpeciesPartials(
  batches: readonly (readonly SpeciesPartial[])[],
): SpeciesAgg[] {
  const acc = new Map<string, { id: SpeciesIdentity; area: number; valPct: number; pct: number }>();
  for (const batch of batches) {
    for (const row of batch) {
      let e = acc.get(row.mdl_key);
      if (!e) {
        e = { id: identityOf(row), area: 0, valPct: 0, pct: 0 };
        acc.set(row.mdl_key, e);
      }
      e.area += n(row.sum_area);
      e.valPct += n(row.sum_val_pct);
      e.pct += n(row.sum_pct);
    }
  }
  const out: SpeciesAgg[] = [];
  for (const e of acc.values()) {
    out.push({
      ...e.id,
      area_km2: e.area,
      // the /100 that `sql/species_for_cells.sql` deliberately left to the combine (calc.R:507)
      avg_suit: e.pct === 0 ? 0 : e.valPct / e.pct / 100,
    });
  }
  return out;
}

function identityOf(row: SpeciesIdentity): SpeciesIdentity {
  return {
    sp_cat: row.sp_cat,
    sp_common: row.sp_common,
    sp_scientific: row.sp_scientific,
    taxon_id: row.taxon_id,
    taxon_authority: row.taxon_authority,
    er_code: row.er_code,
    er_score: row.er_score,
    is_mmpa: row.is_mmpa,
    is_mbta: row.is_mbta,
    mdl_key: row.mdl_key,
  };
}
