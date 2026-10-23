// tests/lib/report/faults.ts -- the six SEEDED FAULTS of atlas-7 step 1.
//
// "Every gate in this repo ships with a seeded fault; a check that cannot fail is not a check"
// (CLAUDE.md). The build-time checkers get theirs as committed red fixture BUILDS; a pure function
// cannot be broken by a fixture, so each fault here is a deliberately-wrong REIMPLEMENTATION of one
// rule, kept beside the real one. `faults.test.ts` runs each against the SAME R fixture the real
// implementation is held to and asserts it DISAGREES -- which is the proof that the corresponding
// assertion in `numbers.test.ts` is load-bearing and not vacuously true.
//
// Each fault is the smallest realistic mistake for its rule: a transposed ER arm, a missing
// `if (equal) widen`, a weighted mean instead of a plain one, a neighbouring column in a sort, a
// dropped footnote, a bypassed clip. None is a strawman that could not have been written by
// accident.
import { ER_CAT_ORDER, type ErCategory } from "../../../src/lib/report/er";
import { formatCoveragePct, formatScore0 } from "../../../src/lib/report/format";
import { sortSpeciesRows } from "../../../src/lib/report/species";
import type { ReportComponent, ScoresTablePlace } from "../../../src/lib/report/scores";
import type { SpeciesRow } from "../../../src/lib/analysis/queries";

// ---- FAULT 1: er_consolidate maps one code wrong ---------------------------------------------
// `IUCN:VU` answers `IUCN:NT(2)`: two adjacent arms of the same `case_when`, the exact slip a
// hand-transcription of the R block makes.
export function erConsolidateFaulty(code: string | null | undefined): ErCategory {
  const raw = code === null || code === undefined ? "NA" : code;
  const parts = raw.split(":");
  const authority = parts[0];
  const status = parts.length > 1 ? parts[1] : null;
  if (authority === "FWS" || authority === "NMFS") {
    if (status === "EN") return "USA:EN(100)";
    if (status === "TN") return "USA:TN(50)";
    if (status === "LC") return "USA:LC(1)";
  }
  if (authority === "IUCN") {
    if (status === "CR") return "IUCN:CR(50)";
    if (status === "EN") return "IUCN:EN(25)";
    if (status === "VU") return "IUCN:NT(2)"; // <-- THE FAULT (correct: IUCN:VU(5))
    if (status === "NT") return "IUCN:NT(2)";
  }
  return "other(1)";
}

/** the counts table built on the faulty mapping, in the same shape `speciesCounts()` returns. */
export function countsWithFaultyEr(
  rows: readonly Pick<SpeciesRow, "mdl_key" | "sp_cat" | "er_code">[],
): { columns: ErCategory[]; totals: number[] } {
  const seen = new Set<string>();
  const byEr = new Map<ErCategory, number>();
  for (const r of rows) {
    const cat = erConsolidateFaulty(r.er_code);
    const triple = `${r.mdl_key}\u0000${r.sp_cat}\u0000${cat}`;
    if (seen.has(triple)) continue;
    seen.add(triple);
    byEr.set(cat, (byEr.get(cat) ?? 0) + 1);
  }
  const columns = ER_CAT_ORDER.filter((c) => byEr.has(c));
  return { columns, totals: columns.map((c) => byEr.get(c) ?? 0) };
}

// ---- FAULT 2: the ramp is not widened when every place agrees --------------------------------
// `range()` ported without report.qmd:160's `if (diff == 0) rng + c(-0.5, 0.5)`.
export function rampDomainFaulty(values: readonly (number | null)[]): [number, number] | null {
  const present = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (present.length === 0) return null;
  return [Math.min(...present), Math.max(...present)];
}

// ---- FAULT 3: Overall as a WEIGHTED mean -----------------------------------------------------
// weighted by `coverage` rather than by `even` -- defensible-sounding ("weight each component by
// how much of the place it covers") and wrong: msens::mean_score() weights by `even`, which is 1.
export function overallScoreFaulty(components: readonly ReportComponent[]): number | null {
  let num = 0;
  let den = 0;
  for (const c of components) {
    const w = c.coverage ?? 1; // <-- THE FAULT (correct: c.even, always 1)
    if (!Number.isFinite(c.score) || !Number.isFinite(w)) continue;
    num += c.score * w;
    den += w;
  }
  return den === 0 ? null : num / den;
}

// ---- FAULT 4: the top 20 sorted by the wrong column ------------------------------------------
// `avg_suit` instead of `suit_er_area` -- the column immediately before it in the frame, and the
// one whose name reads like "the score".
export function topSpeciesFaulty(rows: readonly SpeciesRow[], limit = 20): string[] {
  const ordered = sortSpeciesRows(rows);
  const seen = new Set<string>();
  const distinct: SpeciesRow[] = [];
  for (const r of ordered) {
    if (seen.has(r.mdl_key)) continue;
    seen.add(r.mdl_key);
    distinct.push(r);
  }
  distinct.sort((a, b) => b.avg_suit - a.avg_suit); // <-- THE FAULT (correct: b.suit_er_area - a...)
  return distinct.slice(0, limit).map((r) => r.mdl_key);
}

// ---- FAULT 5: a coverage footnote is suppressed ----------------------------------------------
// the threshold written as "< 90 %" ("don't footnote trivial gaps") rather than P4's real "< 99 %"
// floor: the components D7b exists for -- turtle at 1.4 % or 42 % in a fixture's Aleutian box --
// still footnote, but a component in the 90-99 % band (v9 gulf_rectangle's ~96.9 %, v7's aleutian
// ~98.7 %) silently does not, and the table again implies the score holds everywhere.
export function footnotesFaulty(places: readonly ScoresTablePlace[]): string[] {
  const out: string[] = [];
  for (const p of places) {
    for (const c of p.components) {
      if (c.coverage !== null && c.coverage < 0.9) {
        // <-- THE FAULT (correct: < 0.99, P4's COVERAGE_FOOTNOTE_FLOOR_PCT)
        out.push(
          `${p.name}, ${c.component}: scored over ${formatCoveragePct(c.coverage)} of the place` +
            (c.mean_where_present !== null
              ? `, where its mean is ${formatScore0(c.mean_where_present)}.`
              : "."),
        );
      }
    }
  }
  return out;
}

// ---- FAULT 6: the D7b clip bypassed for a custom place ---------------------------------------
// the caller hands the TOUCHED cell count (and its area) instead of the study-area-clipped one, and
// claims the whole place is inside the study area. This is the shape of the real bug atlas-6 fix
// round 1 found in "show analysis cells" (places/results.ts's `placeCellsInStudyArea` header):
// calling the raw coverage instead of asking the engine for the clip.
export function bypassD7bClip(scores: {
  nCells: number | null;
  nCellsTouched?: number | null;
  areaKm2: number | null;
}): { nCells: number | null; nCellsTouched: number | null; studyAreaPct: number } {
  return {
    nCells: scores.nCellsTouched ?? scores.nCells,
    nCellsTouched: scores.nCellsTouched ?? null,
    studyAreaPct: 100,
  };
}
