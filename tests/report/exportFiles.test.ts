// exportFiles.ts's pure file-builder, against a small synthetic ReportModel (same fixture shape as
// tests/lib/report/model.test.ts) -- proves the ZIP's contents without ever touching fflate.
import { describe, expect, it } from "vitest";
import { buildReport } from "../../src/lib/report/model";
import {
  buildDataPackageFiles,
  citationMarkdown,
  placesGeoJson,
  readmeMarkdown,
  scoresCsv,
  speciesCsv,
} from "../../src/report/exportFiles";
import type { ReportPlaceInput } from "../../src/lib/report/model";
import type { GeomPlace } from "../../src/lib/geo/placeCodec";
import type { SpeciesRow } from "../../src/lib/analysis/queries";

const NOW = new Date("2026-09-22T18:04:05Z");

const BOOT = {
  ver: "v9",
  built_at: "2026-09-22T22:12:48Z",
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
  datasets: [{ ds_key: "a", name_display: "A", citation: "A et al.", sort_order: 1 }],
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

const SPECIES: SpeciesRow[] = [
  {
    sp_cat: "fish",
    sp_common: "Red Fish",
    sp_scientific: "Rubrus piscis",
    taxon_id: "t1",
    taxon_authority: "FWS",
    er_code: "FWS:EN",
    er_score: 1,
    is_mmpa: false,
    is_mbta: false,
    mdl_key: "m1",
    area_km2: 10,
    avg_suit: 0.5,
    suit_er: 0.5,
    suit_er_area: 5,
    cat_suit_er_area: 5,
    pct_cat: 100,
  },
];

const PLACES: ReportPlaceInput[] = [
  {
    place: { kind: "zone", set: "pa", keys: ["GAA"] },
    zoneKey: "GAA",
    token: "z.pa.GAA",
    name: "Gulf of America",
    scores: {
      components: [
        {
          metric_key: "extrisk_bird_ecoregion_rescaled",
          component: "bird",
          score: 50,
          even: 1,
          coverage: 1,
          mean_where_present: 50,
        },
      ],
      nCells: 14238,
      areaKm2: 1234.5,
    },
    species: SPECIES,
  },
  {
    place: SQUARE,
    token: "g1.box.abc",
    name: "My box",
    geometry: SQUARE.geometry,
    scores: { components: [], nCells: 10, areaKm2: 5 },
    species: [],
  },
];

const model = buildReport({
  ver: "v9",
  boot: BOOT,
  places: PLACES,
  tables: ["cell"],
  now: NOW,
  appSha: "abc123",
  permalink: { origin: "https://marinesensitivity.org", path: "/atlas/report.html" },
});

describe("scoresCsv", () => {
  it("lists every present component plus a final Overall row", () => {
    const csv = scoresCsv(model, 0);
    expect(csv).toContain("component,score");
    expect(csv).toContain("bird,50");
    expect(csv).toContain("Overall,50");
  });

  it("a place with no components prints the Overall row plus a Note for the absent one (P4: the footnote the screen's <sup> also carries)", () => {
    const csv = scoresCsv(model, 1);
    expect(csv.trim().split("\r\n")).toEqual([
      "component,score",
      "Overall,",
      "Note,My box: bird not scored (coverage below the 5% floor).",
    ]);
  });
});

describe("speciesCsv", () => {
  it("reuses the app's own CSV columns/serializer", () => {
    const csv = speciesCsv(model, 0);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe(model.species[0].csvColumns.join(","));
    expect(lines[1]).toContain("Rubrus piscis");
  });

  it("an empty species list still prints the header row only", () => {
    const csv = speciesCsv(model, 1);
    expect(csv.trim().split("\r\n").length).toBe(1);
  });
});

describe("placesGeoJson", () => {
  it("includes only the geometry-carrying (custom) place, not the zone place", () => {
    const geojson = JSON.parse(placesGeoJson(PLACES));
    expect(geojson.features).toHaveLength(1);
    expect(geojson.features[0].properties.name).toBe("My box");
  });
});

describe("citationMarkdown / readmeMarkdown", () => {
  it("citations list every cited dataset", () => {
    expect(citationMarkdown(model)).toContain("A et al.");
  });

  it("the README carries the exact permalink", () => {
    expect(readmeMarkdown(model)).toContain(model.header.permalink.href);
  });
});

describe("buildDataPackageFiles", () => {
  it("has one scores/species csv pair per place plus the fixed files", () => {
    const files = buildDataPackageFiles(model, PLACES).map((f) => f.path);
    expect(files).toContain("README.md");
    expect(files).toContain("CITATION.md");
    expect(files).toContain("provenance.json");
    expect(files).toContain("places.geojson");
    expect(files).toContain("scores_gulf-of-america.csv");
    expect(files).toContain("species_my-box.csv");
  });
});
