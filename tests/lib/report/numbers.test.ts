// THE NUMBERS GATE (atlas-7 step 1, "the Gates' first line"): every figure the report model derives
// equals what R produces for the same places -- scores within 1e-9, counts and the top-20 order
// EXACTLY -- per place, per version.
//
// The reference is `tests/fixtures/report/{v7,v9}/report_{gaa,gulf_rectangle,aleutian_dateline}.json`,
// written by `scripts/parity/report_fixtures.R` from `~/_big/msens/derived/{v7,v9}/sdm.duckdb` and
// the published app bundles (read-only). R is the truth: if this file goes red, the TypeScript is
// wrong until proven otherwise -- the fixture is never "fixed" to match.
//
// WHAT IS UNDER TEST HERE is the MODEL's derivation, not the SQL twins: `scripts/parity/run.mjs`
// already gates `sql/*.sql` against msens at 1e-9, so the fixture hands this file those twins'
// OUTPUT (the component rows, the species rows) and asserts what `buildReport()` makes of it. Rows
// are SHUFFLED first (`shuffled()`), so the ordering assertions measure the model's own sorts.
import { describe, expect, it } from "vitest";
import { buildReport, zoneComponents, type ReportPlaceInput } from "../../../src/lib/report/model";
import { bootFor, everyFixture, loadFixture, shuffled, speciesRows } from "./fixtures";
import type { AreaGeometry } from "../../../src/lib/geo/types";
import type { Place } from "../../../src/lib/geo/placeCodec";

const TOL = 1e-9;
const NOW = new Date("2026-09-22T18:04:05Z");

/** a stand-in ring for a drawn place. Nothing in the model re-derives a number from geometry (the
 * engine already counted the cells); it only feeds `vertexCount`/`bbox` in the Parameters section,
 * which `model.test.ts` covers directly. */
const STAND_IN_RING: AreaGeometry = {
  type: "Polygon",
  coordinates: [
    [
      [-90, 27],
      [-89, 27],
      [-89, 28],
      [-90, 28],
      [-90, 27],
    ],
  ],
};

/** the place union the fixture describes -- a zone place carries keys, a drawn one a polygon. */
function placeOf(kind: "zone" | "geom", name: string, keys?: string[]): Place {
  return kind === "zone"
    ? { kind: "zone", set: "pa", keys: keys ?? [] }
    : { kind: "geom", name, geometry: STAND_IN_RING };
}

describe.each(everyFixture())("$ver / $place -- R is the reference", ({ ver, fx }) => {
  const rows = speciesRows(fx);
  const input: ReportPlaceInput = {
    place: placeOf(fx.kind, fx.name, fx.zone_keys),
    zoneKey: fx.zone_keys?.[0],
    token: "t-fixture",
    name: fx.name,
    geometry: fx.kind === "geom" ? STAND_IN_RING : undefined,
    scores: {
      components: shuffled(fx.input.components, 0x1234),
      nCells: fx.input.n_cells,
      areaKm2: fx.input.area_km2,
      studyAreaPct: fx.input.study_area_pct,
      nCellsTouched: fx.input.n_cells_touched ?? null,
    },
    species: shuffled(rows, 0xabcdef),
  };
  const model = buildReport({
    ver,
    boot: bootFor(fx),
    places: [input],
    tables: ["cell", "zone_taxon"],
    now: NOW,
    appSha: "abcdef0",
  });

  it("Overall equals msens::mean_score() within 1e-9", () => {
    const overall = model.scores.rows[0].overall;
    expect(overall).not.toBeNull();
    expect(Math.abs((overall as number) - fx.expected.composite)).toBeLessThan(TOL);
  });

  it("every component score survives the model untouched (1e-9)", () => {
    const byLabel = new Map(fx.input.components.map((c) => [c.component, c]));
    expect(model.scores.components.length).toBe(fx.input.components.length);
    for (const cell of model.scores.rows[0].cells) {
      const r = byLabel.get(cell.component);
      expect(r, `no R row for component ${cell.component}`).toBeDefined();
      expect(Math.abs((cell.score as number) - (r as { score: number }).score)).toBeLessThan(TOL);
    }
  });

  it("N cells and area are the D7b-clipped ones R computed", () => {
    expect(model.scores.rows[0].nCells).toBe(fx.input.n_cells);
    expect(Math.abs((model.scores.rows[0].areaKm2 as number) - fx.input.area_km2)).toBeLessThan(
      TOL,
    );
  });

  it("Parameters states D7b's share inside the study area, derived from the two counts", () => {
    const share = model.parameters[0].studyAreaPct as number;
    expect(Math.abs(share - fx.input.study_area_pct)).toBeLessThan(1e-9);
  });

  it("the species counts table matches R EXACTLY (columns, every cell, both totals)", () => {
    const got = model.species[0].counts;
    const want = fx.expected.counts;
    expect(want, "the fixture has no counts table").not.toBeNull();
    expect(got).not.toBeNull();
    expect(got!.columns).toEqual(want!.columns);
    expect(got!.rows.map((r) => r.category)).toEqual(want!.rows.map((r) => r.category));
    expect(got!.rows.map((r) => r.counts)).toEqual(want!.rows.map((r) => r.counts));
    expect(got!.rows.map((r) => r.total)).toEqual(want!.rows.map((r) => r.total));
    expect(got!.totalRow.counts).toEqual(want!.total_row.counts);
    expect(got!.totalRow.total).toEqual(want!.total_row.total);
  });

  it("N species matches n_distinct(mdl_key)", () => {
    expect(model.species[0].counts!.nSpecies).toBe(fx.expected.n_species);
  });

  it("the top 20 is in R's EXACT order, with R's numbers", () => {
    const got = model.species[0].top!.rows;
    expect(got.map((r) => r.mdl_key)).toEqual(fx.expected.top20.map((r) => r.mdl_key));
    got.forEach((r, i) => {
      const want = fx.expected.top20[i];
      expect(r.sp_scientific).toBe(want.sp_scientific);
      expect(r.sp_cat).toBe(want.sp_cat);
      expect(r.er_code ?? null).toBe(want.er_code ?? null);
      expect(Math.abs(r.suit_er_area - want.suit_er_area)).toBeLessThan(TOL);
      expect(Math.abs((r.er_score ?? 0) - want.er_score)).toBeLessThan(TOL);
    });
  });

  it("the full species list (the CSV's rows) is in R's EXACT order", () => {
    expect(model.species[0].full!.map((r) => r.mdl_key)).toEqual(fx.expected.full_order);
  });

  it("the flower's centre is the table's Overall, rounded", () => {
    const f = model.flowers[0];
    expect(f.centre).toBe(Math.round(fx.expected.composite));
  });
});

// v7 (public): the v9 reference numbers stay out of this repo (a restricted release); the v7 GAA
// fixture carries the same published-vs-traced pair
describe("v7 GAA -- the two numbers that look like one (model.ts header, note 1)", () => {
  const fx = loadFixture("v7", "gaa");

  it("a ZONE place reports the PUBLISHED zone_metric composite, exactly", () => {
    expect(fx.expected.published_composite).toBeDefined();
    expect(
      Math.abs(fx.expected.composite - (fx.expected.published_composite as number)),
    ).toBeLessThan(TOL);
  });

  it("the SAME area traced as a custom place reads a little higher, and the fixture says which is which", () => {
    const traced = fx.traced_as_custom_place!;
    // the atlas-6 reviewer measured 40.4982 traced vs 40.4484 published on v9 (+0.05); v7's pair is
    // +0.008. Either way the traced place reads higher, by less than D7b's bound below.
    expect(traced.composite).toBeGreaterThan(fx.expected.published_composite as number);
    expect(traced.delta_vs_published).toBeGreaterThan(0);
    // master plan D7b's own bound: "a traced Program Area still reproduces its published composite
    // within 0.08 points".
    expect(Math.abs(traced.delta_vs_published)).toBeLessThan(0.08);
  });

  it("the D7b clip is visible in the trace: fewer cells than the geometry touched", () => {
    const traced = fx.traced_as_custom_place!;
    expect(traced.n_cells_study_area).toBeLessThanOrEqual(traced.n_cells_touched);
  });
});

describe.each(["v7"] as const)(
  "%s GAA -- zoneComponents() derives coverage from boot.zones the way R does",
  (ver) => {
    const fx = loadFixture(ver, "gaa");

    it("reproduces every published component and its post/pre coverage within 1e-9", () => {
      const got = zoneComponents(bootFor(fx), "programarea", fx.zone_keys![0]);
      expect(got.map((c) => c.metric_key)).toEqual(fx.input.components.map((c) => c.metric_key));
      got.forEach((c, i) => {
        const want = fx.input.components[i];
        expect(Math.abs(c.score - want.score)).toBeLessThan(TOL);
        expect(Math.abs((c.coverage as number) - (want.coverage as number))).toBeLessThan(TOL);
        expect(
          Math.abs((c.mean_where_present as number) - (want.mean_where_present as number)),
        ).toBeLessThan(TOL);
      });
    });

    it("drops the `_prepctareaweighting` twins -- 8 components, never 16", () => {
      const got = zoneComponents(bootFor(fx), "programarea", fx.zone_keys![0]);
      expect(got.length).toBe(8);
      expect(got.some((c) => /prepctareaweighting/.test(c.metric_key))).toBe(false);
    });
  },
);
