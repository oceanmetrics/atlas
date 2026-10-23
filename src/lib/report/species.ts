// report/species.ts -- the Summary of Species section's two derived tables and its CSV frame
// (atlas-7 §6b/§6c).
//
// R twins:
//   full list  -- .species_shares()'s `arrange(sp_cat, sp_scientific)` (msens/R/calc.R:578), the
//                 SAME order `sql/species_shares.sql`'s ORDER BY produces.
//   top 20     -- report_area_child.qmd:99-104:
//                 distinct(mdl_key, sp_cat, sp_common, sp_scientific, er_code, er_score,
//                          suit_er_area) |> arrange(desc(suit_er_area)) |> head(20)
// Pinned by: tests/fixtures/report/{v7,v9}/report_*.json (`expected.top20`, `expected.full_order`).
//
// THE MODEL SORTS; IT DOES NOT TRUST ITS INPUT'S ORDER. The rows arrive from a SQL twin that
// already ordered them, so re-sorting looks redundant -- but "already ordered" is a property of the
// caller, and a report that silently reorders its CSV because a future caller combined two batches
// differently is exactly the kind of drift a fixture cannot catch if the model just passes the
// array through. The numbers test shuffles the fixture's rows with a seeded permutation before
// calling `buildReport`, so these two sorts are what it actually measures.
//
// dplyr's `arrange()` has used the C locale since 1.1.0, and DuckDB's ORDER BY collates binary, so
// the byte comparator below is the right twin. Scientific names and `sp_cat` values are ASCII,
// where JS's UTF-16 code-unit order and C byte order agree; a non-ASCII name would need
// `Intl.Collator` on BOTH sides, and neither side has one.
import type { SpeciesRow } from "../analysis/queries";

/** C-locale / binary string order -- never `localeCompare`, which is locale- and ICU-dependent. */
export function compareBytes(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** `arrange(sp_cat, sp_scientific)` -- the full species list's order, and the CSV's. */
export function sortSpeciesRows<T extends { sp_cat: string; sp_scientific: string }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort(
    (a, b) => compareBytes(a.sp_cat, b.sp_cat) || compareBytes(a.sp_scientific, b.sp_scientific),
  );
}

/** the six columns the Top 20 prints (§6b), in order. */
export interface TopSpeciesRow {
  /** `sp_cat` -- column 1, "Category". */
  sp_cat: string;
  /** column 2, "Common" (links to the Species lens; the href is built by the model). */
  sp_common: string | null;
  /** column 3, "Scientific". */
  sp_scientific: string;
  /** column 4, "ER code". */
  er_code: string | null;
  /** column 5, "ER score" -- a 0-1 FRACTION here, printed as an integer percent. */
  er_score: number | null;
  /** column 6, "Score" -- `avg_suit x er_score x area_km2`, printed comma-grouped at 0 dp. */
  suit_er_area: number;
  /** not a column: the model id, for the Species-lens link. */
  mdl_key: string;
}

const DISTINCT_KEYS = [
  "mdl_key",
  "sp_cat",
  "sp_common",
  "sp_scientific",
  "er_code",
  "er_score",
  "suit_er_area",
] as const;

/**
 * `distinct(<the seven columns>) |> arrange(desc(suit_er_area)) |> head(limit)`.
 *
 * The input is sorted by `sortSpeciesRows` FIRST, because that is the order `d` is in when R takes
 * the distinct, and both the distinct ("keep the first") and the descending sort (stable, dplyr's
 * radix order; `Array.prototype.sort` is stable too) inherit their tie-breaking from it. Without
 * that step two species with an identical `suit_er_area` could come back in either order and the
 * fixture's exact-order assertion would be flaky rather than wrong.
 */
export function topSpecies(rows: readonly SpeciesRow[], limit = 20): TopSpeciesRow[] {
  const ordered = sortSpeciesRows(rows);
  const seen = new Set<string>();
  const distinct: TopSpeciesRow[] = [];
  for (const r of ordered) {
    const key = DISTINCT_KEYS.map((k) => String(r[k] ?? "\u0000")).join("\u0001");
    if (seen.has(key)) continue;
    seen.add(key);
    distinct.push({
      sp_cat: r.sp_cat,
      sp_common: r.sp_common,
      sp_scientific: r.sp_scientific,
      er_code: r.er_code,
      er_score: r.er_score,
      suit_er_area: n(r.suit_er_area),
      mdl_key: r.mdl_key,
    });
  }
  // stable descending: `Array.prototype.sort` is required to be stable (ES2019), so rows tied on
  // `suit_er_area` keep their (sp_cat, sp_scientific) order, which is R's.
  distinct.sort((a, b) => b.suit_er_area - a.suit_er_area);
  return distinct.slice(0, limit);
}

/** the CSV's columns, in `msens::species_for_cells()`'s own order (spec §7 "Links & downloads"):
 * the RAW frame, never the display strings. */
export const SPECIES_CSV_COLUMNS = [
  "sp_cat",
  "sp_common",
  "sp_scientific",
  "taxon_id",
  "taxon_authority",
  "er_code",
  "er_score",
  "is_mmpa",
  "is_mbta",
  "mdl_key",
  "area_km2",
  "avg_suit",
  "suit_er",
  "suit_er_area",
  "cat_suit_er_area",
  "pct_cat",
] as const;
