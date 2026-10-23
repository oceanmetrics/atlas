// `buildReport()`'s non-numeric contract: the header and its permalink, the Parameters section,
// place expansion, the flowers (and the one place where the drawn ring and the table legitimately
// disagree), progressive rendering, the sources and the provenance block.
//
// The numbers themselves are `numbers.test.ts`'s job, against R.
import { describe, expect, it } from "vitest";
import { buildReport, expandPlaces, DEFAULT_TITLE } from "../../../src/lib/report/model";
import { citations, citedDatasets } from "../../../src/lib/release/cite";
import { reproduceInR, tablesRead } from "../../../src/lib/report/provenance";
import { rampDomain } from "../../../src/lib/report/ramp";
import type { GeomPlace, Place } from "../../../src/lib/geo/placeCodec";
import type { ReportComponent } from "../../../src/lib/report/scores";
import type { SpeciesRow } from "../../../src/lib/analysis/queries";

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
          extrisk_fish_ecoregion_rescaled: 30,
          extrisk_fish_ecoregion_rescaled_prepctareaweighting: 60,
          score_extriskspcat_primprod_ecoregionrescaled_equalweights: 40,
        },
      },
      { key: "GAB", name: "Gulf B", n_cells: 1, area_km2: 2, metrics: {} },
    ],
  },
  tables: {
    cell: { href: "https://example.test/v9/app/cell", digest: "d-cell", bytes: 10 },
  },
  datasets: [
    { ds_key: "b", name_display: "B", citation: "B et al.", sort_order: 2 },
    { ds_key: "a", name_display: "A", citation: "A et al.", sort_order: 1 },
    { ds_key: "z", name_display: "Z", citation: null, sort_order: null },
  ],
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

const comp = (component: string, score: number, coverage: number | null = 1): ReportComponent => ({
  metric_key: `extrisk_${component}_ecoregion_rescaled`,
  component,
  score,
  even: 1,
  coverage,
  mean_where_present: coverage === null ? null : score / coverage,
});

function build(overrides: Partial<Parameters<typeof buildReport>[0]> = {}) {
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
          nCells: 5781,
          areaKm2: 47512.5,
          nCellsTouched: 6000,
        },
        species: null,
      },
    ],
    tables: ["cell", "cell_model"],
    now: NOW,
    appSha: "deadbee",
    ...overrides,
  });
}

describe("header", () => {
  it("defaults to the old report's own title", () => {
    expect(build().header.title).toBe(DEFAULT_TITLE);
    // #8: agency-neutral -- the seal lockup names the agency, never the default title
    expect(DEFAULT_TITLE).toBe("Marine Sensitivity Report");
    expect(DEFAULT_TITLE).not.toMatch(/BOEM|MMA/);
  });

  it("the release chip is ver · status · access", () => {
    expect(build().header.releaseChip).toBe("v9 · prerelease · restricted");
  });

  it("a restricted release carries the PREVIEW banner and the PREVIEW_ file prefix (§0)", () => {
    const h = build().header;
    expect(h.previewBanner).toBe("PREVIEW — not for citation or distribution");
    expect(h.filePrefix).toBe("PREVIEW_");
    expect(h.fileStem).toBe("PREVIEW_MarineSensitivity_marine-sensitivity-report_v9_2026-09-22");
  });

  it("a public release carries neither", () => {
    const h = build({
      boot: { ...BOOT, release: { status: "released", access: "public" } },
    }).header;
    expect(h.previewBanner).toBeNull();
    expect(h.filePrefix).toBe("");
  });

  it("`preview` is the access gate's answer, not a guess from `access`", () => {
    expect(build().header.preview).toBe(false);
    expect(build({ preview: true }).header.preview).toBe(true);
  });

  it("the permalink puts ver in the query and the title+places in the HASH (state/codec.ts)", () => {
    const h = build({
      title: "Gulf draft",
      permalink: { origin: "https://marinesensitivity.org", path: "/atlas/report.html" },
    }).header;
    expect(h.permalink.search).toBe("?ver=v9");
    // `formatSel`'s own percent-encoding, not this module's: the token's `%20` becomes `%2520` in
    // the URL and `parseSel` decodes it back, exactly as it does for the map app's own `#pl=`.
    // Asserting the RAW token here would be asserting a second, report-only encoding.
    expect(h.permalink.hash).toContain("pl=g1.My%2520box.AAAA");
    expect(h.permalink.hash).toContain("t=Gulf");
    expect(h.permalink.href).toBe(
      `https://marinesensitivity.org/atlas/report.html${h.permalink.search}${h.permalink.hash}`,
    );
  });

  it("several places join their tokens with `~`, the codec's own separator", () => {
    const m = build({
      places: [
        { place: SQUARE, token: "tokA", name: "A", scores: null },
        { place: SQUARE, token: "tokB", name: "B", scores: null },
      ],
    });
    // `~` is percent-encoded by `formatSel` (it is not one of `prettyEncode`'s kept characters);
    // `parseSel`/`decodePlaces` see the `~` back, which is what matters.
    expect(m.header.permalink.hash).toContain("pl=tokA%7EtokB");
  });

  it("the generated stamp names its zone -- a browser's clock is not the server's", () => {
    expect(build().header.generatedLabel).toBe("2026-09-22 18:04 UTC");
    expect(build().header.generatedAt).toBe("2026-09-22T18:04:05Z");
  });
});

describe("intro and in-app links are RELATIVE (CLAUDE.md's relative-base rule)", () => {
  it("the intro links to ./index.html at this release, carrying the report's OWN place token (UI-7)", () => {
    const href = build().intro.appHref;
    expect(href.startsWith("./index.html?ver=v9")).toBe(true);
    // same `pl=` value the header's own permalink hash carries (UI-7: "Open this release in the
    // Atlas" must not drop the report's places) -- asserted via `toContain` for the same reason
    // the permalink hash assertion above is: `formatSel`'s own percent-encoding, not re-derived.
    expect(href).toContain("pl=g1.My%2520box.AAAA");
    expect(build().intro.text).toContain("release v9");
  });

  it("an empty report (no places) links to the plain release, with no `pl=` at all", () => {
    expect(build({ places: [] }).intro.appHref).toBe("./index.html?ver=v9");
  });

  it("a top-20 row links to the Species lens in this release, relatively", () => {
    const species = [
      {
        sp_cat: "fish",
        sp_common: "Sei",
        sp_scientific: "Aaa",
        taxon_id: "1",
        taxon_authority: "worms",
        er_code: "IUCN:VU",
        er_score: 0.05,
        is_mmpa: false,
        is_mbta: false,
        mdl_key: "ms_merge|WORMS:1",
        area_km2: 1,
        avg_suit: 0.5,
        suit_er: 0.025,
        suit_er_area: 0.025,
        cat_suit_er_area: 0.025,
        pct_cat: 1,
      } as SpeciesRow,
    ];
    const m = build({
      places: [{ place: SQUARE, token: "t", name: "My box", scores: null, species }],
    });
    const href = m.species[0].top!.hrefs[0];
    expect(href.startsWith("./index.html?")).toBe(true);
    expect(href).toContain("sp=ms_merge%7CWORMS:1"); // formatSel's encoding, shared with the app
    expect(href).not.toContain("://");
  });
});

describe(
  "species counts summary -- Opus eyes-on desktop-17/18: 'Category: turtle'/'mammal' " +
    "lowercase; describeCounts() has the same raw-sp_cat bug V2 fixed for the flower narrative",
  () => {
    it("names the largest category through categoryLabel(), not the raw sp_cat", () => {
      const species = [
        {
          sp_cat: "turtle",
          sp_common: "Leatherback",
          sp_scientific: "Dermochelys coriacea",
          taxon_id: "1",
          taxon_authority: "worms",
          er_code: "IUCN:CR",
          er_score: 0.5,
          is_mmpa: false,
          is_mbta: false,
          mdl_key: "ms_merge|WORMS:1",
          area_km2: 1,
          avg_suit: 0.5,
          suit_er: 0.5,
          suit_er_area: 0.5,
          cat_suit_er_area: 0.5,
          pct_cat: 1,
        } as SpeciesRow,
      ];
      const m = build({
        places: [{ place: SQUARE, token: "t", name: "My box", scores: null, species }],
      });
      expect(m.species[0].summary).toContain("Turtle 1");
      expect(m.species[0].summary).not.toContain("turtle 1");
    });
  },
);

describe("parameters", () => {
  it("a custom place reports its vertex count, bbox, area, N cells and token", () => {
    const p = build().parameters[0];
    expect(p).toMatchObject({
      name: "My box",
      kind: "geom",
      zoneKeys: null,
      vertexCount: 5,
      bbox: [-90, 27, -89, 28],
      areaKm2: 47512.5,
      nCells: 5781,
      token: "g1.My%20box.AAAA",
    });
  });

  it("D7b's share is DERIVED from the clipped and touched counts", () => {
    expect(build().parameters[0].studyAreaPct).toBeCloseTo((5781 / 6000) * 100, 12);
  });

  it("a zone place reports its keys and no vertex count", () => {
    const zone: Place = { kind: "zone", set: "pa", keys: ["GAA"] };
    const m = build({
      places: [
        { place: zone, zoneKey: "GAA", token: "z.pa.GAA", name: "Gulf of America", scores: null },
      ],
    });
    expect(m.parameters[0]).toMatchObject({ kind: "zone", zoneKeys: ["GAA"], vertexCount: null });
  });
});

describe("expandPlaces -- a multi-key zone place becomes one reported area per key", () => {
  it("splits keys, names them 'Full Name (KEY)' from boot (P3: paLabel), and re-encodes a one-key token each", () => {
    const stubs = expandPlaces([{ kind: "zone", set: "pa", keys: ["GAA", "GAB"] }], BOOT);
    expect(stubs.map((s) => s.name)).toEqual(["Gulf of America (GAA)", "Gulf B (GAB)"]);
    expect(stubs.map((s) => s.zoneKey)).toEqual(["GAA", "GAB"]);
    expect(stubs[0].token).not.toBe(stubs[1].token);
    expect(stubs[0].token.startsWith("z.pa.GAA")).toBe(true);
  });

  it("a key boot does not publish still gets a row, named by its key", () => {
    const stubs = expandPlaces([{ kind: "zone", set: "pa", keys: ["RETIRED"] }], BOOT);
    expect(stubs).toHaveLength(1);
    expect(stubs[0].name).toBe("RETIRED");
  });

  it("a custom place passes through untouched, with its encoded token", () => {
    const stubs = expandPlaces([SQUARE], BOOT);
    expect(stubs).toHaveLength(1);
    expect(stubs[0].name).toBe("My box");
    expect(stubs[0].token.startsWith("g1.")).toBe(true);
  });

  // V1 fix (Opus eyes-on review, 2026-09-24): a real release's boot publishes NO `name` on any
  // `zones.programarea` row -- the report's place pill/lines/flower title must still show the
  // full name via the app-side PROGRAM_AREA_NAMES fallback, unit-scoped so an er/sr place sharing
  // the same key is unaffected.
  it("falls back to PROGRAM_AREA_NAMES for a Program Area key boot doesn't publish a name for", () => {
    const stubs = expandPlaces([{ kind: "zone", set: "pa", keys: ["ALA"] }], BOOT);
    expect(stubs[0].name).toBe("Aleutian Arc (ALA)");
  });

  it("does not apply the Program Area table to a same-keyed subregion/ecoregion place", () => {
    const stubs = expandPlaces(
      [
        { kind: "zone", set: "sr", keys: ["ALA"] },
        { kind: "zone", set: "er", keys: ["ALA"] },
      ],
      BOOT,
    );
    expect(stubs.map((s) => s.name)).toEqual(["ALA", "ALA"]);
  });
});

describe("map", () => {
  it("fills by the composite ROUNDED to 1 dp (report.qmd:152)", () => {
    expect(build().map.places[0].score).toBe(42);
  });

  it("a one-place report's ramp is widened ±0.5 -- never a zero-width domain", () => {
    expect(build().map.domain).toEqual([41.5, 42.5]);
    expect(rampDomain([42])).toEqual([41.5, 42.5]);
  });

  it("the legend is the old report's own title", () => {
    expect(build().map.legendTitle).toBe("Mean score");
  });

  it(
    "the summary spells 'colored' (American), matching the static map narrative -- Opus eyes-on: " +
      "the caption spelled 'coloured' while the desktop map intro spelled 'colored' in the same report",
    () => {
      expect(build().map.summary).toContain("colored by mean score");
      expect(build().map.summary).not.toContain("coloured");
      expect(build().map.narrative).toContain("colored by mean sensitivity score");
    },
  );

  // W4 fix (design call noted twice by reviewers, then Ben's phone report, "ramp 33 to 34"): a
  // lone place has no "highest"/"lowest" to contrast and the ±0.5 widened domain is fake precision
  // for a single value -- the caption states the place's own value instead of a degenerate ramp.
  it("a lone place's summary states its own score, not a fabricated 'ramp X to Y'", () => {
    expect(build().map.summary).toBe("Map: 1 place colored by mean score; My box scored 42.");
    expect(build().map.summary).not.toContain("ramp");
    expect(build().map.summary).not.toContain("highest");
  });

  it("two (or more) places keep the ramp/highest/lowest phrasing -- no regression from the one-place fix", () => {
    const m = build({
      places: [
        {
          place: SQUARE,
          token: "t1",
          name: "P",
          scores: { components: [comp("bird", 80)], nCells: 1, areaKm2: 1 },
          species: null,
        },
        {
          place: SQUARE,
          token: "t2",
          name: "Q",
          scores: { components: [comp("bird", 20)], nCells: 1, areaKm2: 1 },
          species: null,
        },
      ],
    });
    expect(m.map.domain).toEqual([20, 80]);
    expect(m.map.summary).toBe(
      "Map: 2 places colored by mean score, ramp 20 to 80 (red = high); highest P 80, lowest Q 20.",
    );
    expect(m.map.single).toBeNull();
  });

  // spectral_r's REAL production order (tests/lens/scores/fixtures.ts's own BOOT_V7, fetched from a
  // live v7 bundle): index 0 = LOW (blue/purple), index 10 = HIGH (red) -- "red = high" (the
  // caption's own claim). A lone place's `single.color` must land on the EXACT middle stop, the
  // same math `colorForValue` always gives a value sitting dead-centre in a ±0.5 widened domain --
  // proving the "sensible mid colour" the fix promises, not merely "some non-nodata colour".
  const SPECTRAL_R = [
    "#5E4EA1",
    "#3287BD",
    "#66C1A5",
    "#ABDDA4",
    "#E5F498",
    "#FFFFBF",
    "#FEDF8B",
    "#FDAD60",
    "#F36C43",
    "#D43E4E",
    "#9E0041",
  ] as const;

  it("a lone place resolves `map.single` to the exact middle ramp stop, never null/nodata", () => {
    const m = build({ boot: { ...BOOT, palettes: { spectral_r: SPECTRAL_R } } });
    // colorForValue() round-trips hex through its own rgbToHex (lowercase) -- SPECTRAL_R[5] itself
    // is the same value, just uppercase, so lowercase it here rather than assert on case.
    expect(m.map.single).toEqual({ name: "My box", score: 42, color: SPECTRAL_R[5].toLowerCase() });
  });

  it("`map.single` is null when the release publishes no spectral_r stops (no boot.palettes)", () => {
    // BOOT (this file's default fixture) carries no `palettes` key at all -- `single` must degrade
    // to null, never throw, matching `paletteStopsFromBoot`'s own "fail closed" contract.
    expect(build().map.single).toBeNull();
  });
});

describe("flowers", () => {
  it("the text summary is the accessibility gate's own phrasing", () => {
    // P round V2 fix: this sentence is printed VISIBLY in the report (never sr-only), so the raw
    // "bird"/"turtle" component keys now read through categoryLabel() -- "Bird"/"Turtle".
    expect(build().flowers[0].summary).toBe(
      "My box: highest component Bird 71, lowest Turtle 3; overall 42.",
    );
  });

  it("the centre is the TABLE's Overall, so the ring and the table cannot disagree", () => {
    // v8/v9 publish `primary producer` AND `primprod`, which collapse to one drawn petal: the
    // drawn petals' own mean is then 40, while the table's Overall over all four components is 45.
    const m = build({
      places: [
        {
          place: SQUARE,
          token: "t",
          name: "P",
          scores: {
            components: [
              comp("bird", 60),
              {
                ...comp("primary producer", 20),
                metric_key: "extrisk_primary_producer_ecoregion_rescaled",
              },
              { ...comp("primprod", 60), metric_key: "primprod_ecoregion_rescaled" },
              comp("fish", 40),
            ],
            nCells: 1,
            areaKm2: 1,
          },
        },
      ],
    });
    const f = m.flowers[0];
    expect(f.droppedLabels).toEqual(["primprod"]);
    expect(f.geometry.petals).toHaveLength(3);
    expect(f.centreOfDrawnPetals).toBe(40);
    expect(f.centre).toBe(45);
    expect(m.scores.rows[0].overall).toBe(45);
  });

  it("every component keeps its slot; a null score draws nothing and never enters the mean", () => {
    const m = build({
      places: [
        {
          place: SQUARE,
          token: "t",
          name: "P",
          scores: {
            components: [comp("bird", 40), { ...comp("fish", 0), score: Number.NaN }],
            nCells: 1,
            areaKm2: 1,
          },
        },
      ],
    });
    expect(m.flowers[0].geometry.noData.map((s) => s.key)).toEqual(["fish"]);
    expect(m.flowers[0].centre).toBe(40);
  });
});

describe("progressive rendering -- every query result may still be null", () => {
  it("a place with no scores yet has no components, no overall, and no map score", () => {
    const m = build({ places: [{ place: SQUARE, token: "t", name: "P", scores: null }] });
    expect(m.scores.rows[0].overall).toBeNull();
    expect(m.map.domain).toBeNull();
    expect(m.flowers[0].geometry.petals).toEqual([]);
    expect(m.parameters[0].nCells).toBeNull();
  });

  it("a place with no species yet shows neither the tables nor the empty-case string", () => {
    const s = build().species[0];
    expect(s.counts).toBeNull();
    expect(s.top).toBeNull();
    expect(s.full).toBeNull();
    expect(s.empty).toBeNull();
  });

  it("a place whose species query RAN and found none shows §6c's sentence", () => {
    const m = build({
      places: [{ place: SQUARE, token: "t", name: "P", scores: null, species: [] }],
    });
    expect(m.species[0].empty).toBe("No species found for this area.");
    expect(m.species[0].counts).toBeNull();
    expect(m.species[0].full).toEqual([]);
  });

  it("the CSV filename carries the place, the release and the date (and PREVIEW_ when restricted)", () => {
    expect(build().species[0].csvFilename).toBe("PREVIEW_species_my-box_v9_2026-09-22.csv");
  });
});

describe("sources", () => {
  it("citations come through the one release/cite.ts path, in sort_order", () => {
    expect(citations(BOOT).map((c) => c.dsKey)).toEqual(["a", "b", "z"]);
    expect(build().sources.citations.map((c) => c.dsKey)).toEqual(["a", "b"]);
    expect(citedDatasets(BOOT).map((c) => c.dsKey)).toEqual(["a", "b"]);
  });

  it("a release with no datasets block yields no citations, never a throw", () => {
    expect(citations({})).toEqual([]);
    expect(citations(null)).toEqual([]);
  });

  it("links to this release's docs", () => {
    expect(build().sources.docsHref).toBe("https://marinesensitivity.org/docs/v9/");
  });

  // P3 fix (Opus eyes-on review, 2026-09-24): "modelled" -> "modeled" -- this app's own copy is
  // US spelling throughout; this line was the one holdout.
  it("US spelling: 'modeled', never 'modelled'", () => {
    const text = build().sources.text.join(" ");
    expect(text).toContain("weighted by modeled habitat suitability");
    expect(text).not.toContain("modelled");
  });
});

describe("provenance -- what replaces session_info()", () => {
  it("names the release, its status/access, the app SHA and the timestamp", () => {
    const p = build({ duckdbWasm: "1.32.0" }).provenance;
    expect(p).toMatchObject({
      ver: "v9",
      status: "prerelease",
      access: "restricted",
      appSha: "deadbee",
      duckdbWasm: "1.32.0",
      generatedAt: "2026-09-22T18:04:05Z",
      releaseBuiltAt: "2026-09-22T22:12:48Z",
      msens: "0.43.0",
    });
  });

  it("carries a digest for every table read, and an explicit null for one boot does not publish", () => {
    expect(build().provenance.tables).toEqual([
      { name: "cell", href: "https://example.test/v9/app/cell", digest: "d-cell", bytes: 10 },
      { name: "cell_model", href: null, digest: null, bytes: null },
    ]);
    expect(tablesRead({}, ["cell"])).toEqual([
      { name: "cell", href: null, digest: null, bytes: null },
    ]);
  });

  it("quotes the SQL that ran, verbatim", () => {
    const p = build({ sql: [{ name: "scores_for_cells", sql: "SELECT 1" }] }).provenance;
    expect(p.sql).toEqual([{ name: "scores_for_cells", sql: "SELECT 1" }]);
  });

  it("the Reproduce-in-R snippet carries the REAL token and the release's own grid", () => {
    const snippet = build().provenance.reproduceInR[0];
    expect(snippet).toContain('msens::place_decode("g1.My%20box.AAAA")[[1]]$geometry');
    expect(snippet).toContain('msens::grid_spec_for("global05")');
    expect(snippet).toContain("blend = TRUE");
    expect(snippet).toContain('denominator = "study_area"');
  });

  // fix round 2 (Opus review): `cells_in_study_area()` used to run as its own extra step, but
  // `scores_for_cells(..., denominator = "study_area")` already clips to the study area internally
  // -- the extra call recomputed the same clip a second time for nothing. Regression test named
  // after the fix: this line must never come back.
  it("never calls cells_in_study_area() as a redundant second clip", () => {
    expect(build().provenance.reproduceInR[0]).not.toContain("cells_in_study_area");
  });

  // fix round 2 (Opus review): three of these functions are unexported on `main` as of this
  // writing -- "paste this into R" silently fails without knowing which msens checkout to build.
  it("names the msens version the snippet requires, from boot.msens", () => {
    const snippet = build().provenance.reproduceInR[0];
    expect(snippet).toContain("# requires msens >= 0.43.0");
  });

  it("no msens version on the boot -> no requires line (never a bare '>= null')", () => {
    const snippet = reproduceInR({ ver: "v9", gridId: "global05", token: "g1.x.AAAA" }, null);
    expect(snippet).not.toContain("requires msens");
  });

  it("a zone place gets the PRECOMPUTED path instead -- the one the document itself used", () => {
    const snippet = reproduceInR({
      ver: "v9",
      gridId: "global05",
      zoneFld: "programarea_key",
      zoneKeys: ["GAA"],
    });
    expect(snippet).toContain('msens::scores_for_pra(con, "GAA")');
    expect(snippet).toContain('msens::species_for_zone(con, "programarea_key", "GAA")');
    expect(snippet).not.toContain("place_decode");
  });
});

describe("summaries -- the accessibility gate reads this array", () => {
  it("every figure has one, in document order", () => {
    const m = build();
    expect(m.summaries[0]).toBe(m.map.summary);
    expect(m.summaries[1]).toBe(m.flowers[0].summary);
    expect(m.summaries[2]).toBe(m.scores.summary);
    expect(m.summaries.every((s) => typeof s === "string" && s.length > 0)).toBe(true);
  });
});
