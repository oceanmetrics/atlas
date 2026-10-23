// tests/lib/report/fixtures.ts -- the loader for `tests/fixtures/report/{ver}/report_{place}.json`,
// the R reference for atlas-7's numbers gate.
//
// The fixtures are COLUMNAR (see scripts/parity/report_fixtures.R's `species_columnar`): the GAA
// species list is ~6,300 rows and repeating 16 keys per row triples a committed file for nothing.
// This module is the only place that shape is understood; every test sees plain `SpeciesRow[]`.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SpeciesRow } from "../../../src/lib/analysis/queries";
import type { ReportComponent } from "../../../src/lib/report/scores";

const DIR = fileURLToPath(new URL("../../fixtures/report/", import.meta.url));

// v7 only: v9 is a restricted release, and its reference numbers stay out of this public repo
// (MarineSensitivity/atlas 0.10.93 carried both; the v7 set is the public one)
export const VERSIONS = ["v7"] as const;
export const PLACES = ["gaa", "gulf_rectangle", "aleutian_dateline"] as const;
export type FixtureVer = (typeof VERSIONS)[number];
export type FixturePlace = (typeof PLACES)[number];

export interface FixtureCounts {
  columns: string[];
  rows: { category: string; counts: number[]; total: number }[];
  total_row: { counts: number[]; total: number };
  n_species: number;
}

export interface FixtureTop {
  mdl_key: string;
  sp_cat: string;
  sp_common: string | null;
  sp_scientific: string;
  er_code: string | null;
  er_score: number;
  suit_er_area: number;
}

export interface ReportFixture {
  ver: string;
  msens: string;
  grid_id: string;
  id_field: string;
  place: string;
  kind: "zone" | "geom";
  name: string;
  zone_set?: string;
  zone_keys?: string[];
  input: {
    n_cells: number;
    n_cells_touched?: number;
    area_km2: number;
    study_area_pct: number;
    components: ReportComponent[];
    species: { n: number; columns: string[]; values: Record<string, unknown[]> };
    /** zone fixtures only: the raw `boot.zones[unit][key]` row. */
    boot_zone?: { key: string; n_cells: number; area_km2: number; metrics: Record<string, number> };
  };
  expected: {
    composite: number;
    published_composite?: number;
    n_species: number;
    counts: FixtureCounts | null;
    top20: FixtureTop[];
    full_order: string[];
  };
  traced_as_custom_place?: {
    n_cells_touched: number;
    n_cells_study_area: number;
    area_km2: number;
    composite: number;
    delta_vs_published: number;
    components: ReportComponent[];
  };
}

export function loadFixture(ver: FixtureVer, place: FixturePlace): ReportFixture {
  return JSON.parse(readFileSync(`${DIR}${ver}/report_${place}.json`, "utf8")) as ReportFixture;
}

/** every (version, place) pair, for a `describe.each` that names the cell that failed. */
export function everyFixture(): { ver: FixtureVer; place: FixturePlace; fx: ReportFixture }[] {
  return VERSIONS.flatMap((ver) =>
    PLACES.map((place) => ({ ver, place, fx: loadFixture(ver, place) })),
  );
}

/** columnar -> the row shape `buildReport()` takes. `null` stays `null` (a species with no common
 * name or no ER code is ordinary data and `er_consolidate` has a rule for it). */
export function speciesRows(fx: ReportFixture): SpeciesRow[] {
  const { n, columns, values } = fx.input.species;
  const out: SpeciesRow[] = [];
  for (let i = 0; i < n; i++) {
    const row: Record<string, unknown> = {};
    for (const c of columns) row[c] = values[c]?.[i] ?? null;
    out.push(row as unknown as SpeciesRow);
  }
  return out;
}

/**
 * A deterministic permutation, so the model's own sorts are what the order assertions measure.
 *
 * Without this the fixture's rows arrive already in R's order and "the top 20 is in the right
 * order" would pass for a model that simply sliced the first 20 rows it was handed. mulberry32 is
 * used rather than `Math.random` because a flaky ordering gate is worse than none.
 */
export function shuffled<T>(rows: readonly T[], seed = 0x9e3779b9): T[] {
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...rows];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** a minimal `boot.json` carrying only what `buildReport()` reads, built from the fixture itself so
 * no test invents a release. */
export function bootFor(fx: ReportFixture): Record<string, unknown> {
  const zones: Record<string, unknown> = {};
  if (fx.input.boot_zone) zones.programarea = [fx.input.boot_zone];
  return {
    ver: fx.ver,
    built_at: "2026-09-22T22:12:48Z",
    msens: fx.msens,
    id_field: fx.id_field,
    grid: { grid_id: fx.grid_id },
    release: { status: "released", access: "public" },
    zones,
    tables: {
      cell: { href: `https://example.test/${fx.ver}/app/cell`, digest: "cell-digest", bytes: 1 },
      zone_taxon: {
        href: `https://example.test/${fx.ver}/app/zone_taxon.parquet`,
        digest: "zt-digest",
        bytes: 2,
      },
    },
    datasets: [
      {
        ds_key: "am",
        name_display: "AquaMaps SDM",
        citation: "Kaschner, K. et al. 2019. AquaMaps.",
        link_info: "https://www.aquamaps.org",
        sort_order: 3,
      },
      { ds_key: "ms_merge", name_display: "Merged model", citation: null, sort_order: 1 },
    ],
  };
}
