// fix round 2 (Opus review), item 1 + item 2: the four static section narratives (map/flower/
// table/species) and D7b's own disclosure for a drawn place. Reuses model.test.ts's own BOOT/
// SQUARE fixtures and `build()` shape so these stay in sync with the model's real contract.
import { describe, expect, it } from "vitest";
import { buildReport, type BuildReportInput } from "../../../src/lib/report/model";
import type { GeomPlace } from "../../../src/lib/geo/placeCodec";
import type { ReportComponent } from "../../../src/lib/report/scores";

const NOW = new Date("2026-09-22T18:04:05Z");

const BOOT = {
  ver: "v9",
  built_at: "2026-09-22T22:12:48Z",
  msens: "0.43.0",
  grid: { grid_id: "global05" },
  release: { status: "prerelease", access: "restricted" },
  zones: {
    programarea: [
      {
        key: "GAA",
        name: "Gulf of America",
        n_cells: 14238,
        area_km2: 1234.5,
        metrics: {
          extrisk_bird_ecoregion_rescaled: 50,
          extrisk_bird_ecoregion_rescaled_prepctareaweighting: 50,
        },
      },
    ],
  },
  tables: {},
  datasets: [],
};

const SQUARE: GeomPlace = {
  kind: "geom",
  name: "My box",
  geometry: {
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
  },
};

const comp = (component: string, score: number): ReportComponent => ({
  metric_key: `extrisk_${component}_ecoregion_rescaled`,
  component,
  score,
  even: 1,
  coverage: 1,
  mean_where_present: score,
});

function build(overrides: Partial<BuildReportInput> = {}) {
  return buildReport({
    ver: "v9",
    boot: BOOT,
    places: [
      {
        place: SQUARE,
        token: "g1.My%20box.AAAA",
        name: "My box",
        geometry: SQUARE.geometry,
        scores: {
          components: [comp("bird", 71), comp("turtle", 3), comp("fish", 52)],
          nCells: 100,
          areaKm2: 10,
        },
        species: null,
      },
    ],
    tables: [],
    now: NOW,
    appSha: "deadbee",
    ...overrides,
  });
}

describe("item 1: the four static section narratives", () => {
  it("map narrative is present and describes the Spectral ramp/ecoregion rescale", () => {
    const m = build();
    expect(m.map.narrative).toContain("Spectral color ramp");
    expect(m.map.narrative).toContain("BOEM Ecoregion");
  });

  it("table narrative is present and describes N cells / component rescaling", () => {
    const m = build();
    expect(m.scores.narrative).toContain("N cells");
    expect(m.scores.narrative).toContain("ecoregionally rescaled");
  });

  it("species narrative (section-level) carries the ER-consolidation note", () => {
    const m = build();
    expect(m.speciesNarrative).toContain("top 20");
    expect(m.speciesNarrative).toContain('"USA"');
    expect(m.speciesNarrative).toContain("IUCN:DD");
  });

  describe("flower narrative", () => {
    it("names exactly this release's components, and neither 'reptile' nor 'other'", () => {
      const m = build();
      const narrative = m.flowers[0].narrative;
      // P round V2 fix: this sentence is printed VISIBLY in the report, so each raw component key
      // now reads through categoryLabel() -- "Bird, Turtle, Fish", not the raw lowercase spelling.
      expect(narrative).toContain("Bird, Turtle, Fish");
      expect(narrative).not.toContain("reptile");
      expect(narrative).not.toMatch(/\bother\b/);
      expect(narrative).toContain("mean of the equally weighted components");
    });

    it("SEEDED FAULT: a hardcoded 'reptile, other' component list is exactly what this test catches", () => {
      const stale =
        "Flower plots where each petal represents a species category (bird, coral, fish, " +
        "invertebrate, mammal, reptile, other, primary productivity).";
      expect(stale).toContain("reptile");
      expect(stale).toMatch(/\bother\b/);
      // the real narrative must never look like this
      expect(build().flowers[0].narrative).not.toBe(stale);
    });

    it("names a folded (duplicate) component when the ring dropped one", () => {
      const m = build({
        places: [
          {
            place: SQUARE,
            token: "g1.My%20box.AAAA",
            name: "My box",
            geometry: SQUARE.geometry,
            scores: {
              components: [
                {
                  ...comp("primary producer", 10),
                  metric_key: "extrisk_primary_producer_ecoregion_rescaled",
                },
                { ...comp("primprod", 90), metric_key: "primprod_ecoregion_rescaled" },
              ],
              nCells: 100,
              areaKm2: 10,
            },
            species: null,
          },
        ],
      });
      expect(m.flowers[0].droppedLabels.length).toBeGreaterThan(0);
      expect(m.flowers[0].narrative).toContain("folded into the total");
    });

    it("names no fold when nothing was dropped", () => {
      expect(build().flowers[0].narrative).not.toContain("folded");
    });
  });
});

describe("item 2: D7b's disclosure for a drawn (geom) place", () => {
  it("is present for a geom place", () => {
    const note = build().parameters[0].d7bNote;
    expect(note).not.toBeNull();
    expect(note).toContain("U.S. study area");
    expect(note).toContain("differ slightly");
  });

  it("is ABSENT for a zone place -- a published zone IS the study area, nothing to disclose", () => {
    const m = build({
      places: [
        {
          place: { kind: "zone", set: "pa", keys: ["GAA"] },
          zoneKey: "GAA",
          token: "z.pa.GAA",
          name: "Gulf of America",
          scores: { components: [comp("bird", 50)], nCells: 14238, areaKm2: 1234.5 },
          species: null,
        },
      ],
    });
    expect(m.parameters[0].d7bNote).toBeNull();
  });
});
