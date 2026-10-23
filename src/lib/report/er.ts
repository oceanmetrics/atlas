// report/er.ts -- `er_consolidate()` and the "Category x ER category" counts table, ported EXACTLY
// from the old report (`api/report_area_child.qmd:45-95`), atlas-7 §6(a).
//
// R twin (verbatim, the whole rule):
//   authority %in% c("FWS","NMFS") & status == "EN" ~ "USA:EN(100)"
//   authority %in% c("FWS","NMFS") & status == "TN" ~ "USA:TN(50)"
//   authority %in% c("FWS","NMFS") & status == "LC" ~ "USA:LC(1)"
//   authority == "IUCN" & status == "CR"            ~ "IUCN:CR(50)"
//   authority == "IUCN" & status == "EN"            ~ "IUCN:EN(25)"
//   authority == "IUCN" & status == "VU"            ~ "IUCN:VU(5)"
//   authority == "IUCN" & status == "NT"            ~ "IUCN:NT(2)"
//   TRUE                                            ~ "other(1)"
// Pinned by: tests/fixtures/report/{v7,v9}/report_*.json (`expected.counts`), which
// scripts/parity/report_fixtures.R produced by running that R block itself, not a re-derivation.
//
// NA HANDLING IS TWO STEPS, and both matter. R first rewrites a NULL `er_code` to the literal
// string "NA" (report_area_child.qmd:33-34) and only then splits it on ":", so `str_split_i("NA",
// ":", 2)` is NA, every predicate is false, and the row lands in `other(1)`. `IUCN:LC` and
// `IUCN:DD` land there too -- the rule has no IUCN:LC/DD arm at all. A port that special-cased NA
// before splitting would agree on the answer and disagree on the reason; this one splits the same
// string R splits.
//
// The weights in the labels (100/50/1/50/25/5/2/1) are the `er_score` scale these categories stand
// for (msens/R/listings.R:38-79); they are part of the LABEL, never recomputed here.
import type { SpeciesIdentity } from "../analysis/combine";

/** the fixed left-to-right column order (report_area_child.qmd:62-65), by descending score
 * priority. A category no species in this place falls into is dropped, never shown empty. */
export const ER_CAT_ORDER = [
  "USA:EN(100)",
  "USA:TN(50)",
  "USA:LC(1)",
  "IUCN:CR(50)",
  "IUCN:EN(25)",
  "IUCN:VU(5)",
  "IUCN:NT(2)",
  "other(1)",
] as const;

export type ErCategory = (typeof ER_CAT_ORDER)[number];

/** #8 (2026-10-16): a counts column label split for its two-line header -- `"USA:EN(100)"` ->
 * `{code: "USA:EN", weight: "(100)"}` -- so the table's eleven columns fit the report width
 * instead of scrolling (on screen) or being cut (in print). The label itself is unchanged (the
 * CSV and the R twin keep `"USA:EN(100)"`); a label without a trailing `(n)` is `weight: null`. */
export function erColumnParts(col: string): { code: string; weight: string | null } {
  const m = /^(.*?)(\(\d+\))$/.exec(col);
  return m ? { code: m[1]!, weight: m[2]! } : { code: col, weight: null };
}

const USA_AUTHORITIES = new Set(["FWS", "NMFS"]);

/**
 * One `er_code` -> its consolidated category.
 *
 * `split(":")` then `[0]`/`[1]` is `stringr::str_split_i(code, ":", 1|2)`, including for a code
 * carrying more than one colon (part 2 is the SECOND field, not "everything after the first").
 */
export function erConsolidate(code: string | null | undefined): ErCategory {
  // R's `ifelse(is.na(er_code), "NA", er_code)` -- the literal string, then the same split.
  const raw = code === null || code === undefined ? "NA" : code;
  const parts = raw.split(":");
  const authority = parts[0];
  const status = parts.length > 1 ? parts[1] : null;
  if (USA_AUTHORITIES.has(authority)) {
    if (status === "EN") return "USA:EN(100)";
    if (status === "TN") return "USA:TN(50)";
    if (status === "LC") return "USA:LC(1)";
  }
  if (authority === "IUCN") {
    if (status === "CR") return "IUCN:CR(50)";
    if (status === "EN") return "IUCN:EN(25)";
    if (status === "VU") return "IUCN:VU(5)";
    if (status === "NT") return "IUCN:NT(2)";
  }
  return "other(1)";
}

/** the minimum a row needs to be counted: the model id, its species category and its ER code. */
export type ErCountInput = Pick<SpeciesIdentity, "mdl_key" | "sp_cat" | "er_code">;

export interface SpeciesCountsRow {
  /** the `sp_cat` value, verbatim (`categories.ts` supplies the display label). */
  category: string;
  /** one count per entry of {@link SpeciesCounts.columns}, same order. */
  counts: number[];
  /** `rowSums` over `counts` only (report_area_child.qmd:79). */
  total: number;
}

export interface SpeciesCounts {
  /** `ER_CAT_ORDER` intersected with what this place actually has, in `ER_CAT_ORDER`'s order. */
  columns: ErCategory[];
  /** one row per `sp_cat`, ascending (R's `arrange(Category)`). */
  rows: SpeciesCountsRow[];
  /** `colSums` over the body -- the Total ROW (report_area_child.qmd:80-83). */
  totalRow: { counts: number[]; total: number };
  /** `n_distinct(mdl_key)` -- the caption's "(N species)" (report_area_child.qmd:41). */
  nSpecies: number;
}

/**
 * `distinct(mdl_key, sp_cat, er_cat) |> count(sp_cat, er_cat) |> pivot_wider(values_fill = 0)`,
 * plus the Total column and Total row.
 *
 * The DISTINCT is on the triple, not on `mdl_key` alone: a model that somehow appeared under two
 * categories would be counted in both, exactly as R counts it. `nSpecies` is still
 * `n_distinct(mdl_key)`, so the caption and the Total cell can legitimately differ -- and do not,
 * on any released data, which is why both are asserted separately against R.
 */
export function speciesCounts(rows: readonly ErCountInput[]): SpeciesCounts {
  const seenTriples = new Set<string>();
  const byCat = new Map<string, Map<ErCategory, number>>();
  const presentCats = new Set<ErCategory>();
  const models = new Set<string>();

  for (const r of rows) {
    const erCat = erConsolidate(r.er_code);
    models.add(r.mdl_key);
    const triple = `${r.mdl_key}\u0000${r.sp_cat}\u0000${erCat}`;
    if (seenTriples.has(triple)) continue;
    seenTriples.add(triple);
    presentCats.add(erCat);
    let byEr = byCat.get(r.sp_cat);
    if (!byEr) {
      byEr = new Map();
      byCat.set(r.sp_cat, byEr);
    }
    byEr.set(erCat, (byEr.get(erCat) ?? 0) + 1);
  }

  const columns = ER_CAT_ORDER.filter((c) => presentCats.has(c));
  // R's arrange(Category): ascending, C locale. Scientific/category strings here are ASCII, where
  // JS's UTF-16 code-unit order and C byte order agree.
  const categories = [...byCat.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const out: SpeciesCountsRow[] = categories.map((category) => {
    const byEr = byCat.get(category)!;
    const counts = columns.map((c) => byEr.get(c) ?? 0);
    return { category, counts, total: counts.reduce((a, b) => a + b, 0) };
  });

  const totalCounts = columns.map((_, i) => out.reduce((a, r) => a + r.counts[i], 0));
  return {
    columns,
    rows: out,
    totalRow: {
      counts: totalCounts,
      total: totalCounts.reduce((a, b) => a + b, 0),
    },
    nSpecies: models.size,
  };
}
