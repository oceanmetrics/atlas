// The `zone_style` table is DATA (atlas-4 §6.2 / msens zone_style.R:22-55). One assertion per row,
// so a restyle shows up as exactly the row that changed.
import { describe, expect, it } from "vitest";
import {
  ZONE_LINE_STYLE_DEFAULT,
  unitFromFld,
  zoneFillLayer,
  zoneLabelLayer,
  zoneLabelStyle,
  zoneLabelsFromBoot,
  zoneLineLayer,
  zoneLineStyle,
  zoneQueryLayerIds,
  zoneSources,
  zoneUnitsFromBoot,
  zoneUnitsWithOutline,
  zonesNeedGlyphs,
} from "../../src/lib/map/layers/zones";
import type { ZoneUnitSpec } from "../../src/lib/map/types";

const PRA: ZoneUnitSpec = {
  unit: "programarea",
  pmtiles: "https://s3.example/marine-atlas/zones/programarea_2026-01/zones.pmtiles",
  sourceLayer: "programarea",
};

const ECO: ZoneUnitSpec = {
  unit: "ecoregion",
  pmtiles: "https://s3.example/marine-atlas/zones/ecoregion_2026-01/zones.pmtiles",
  sourceLayer: "ecoregion",
};

describe("zoneLineStyle — one case per row of the table", () => {
  it("programarea: white, 1 px, opacity 1, solid", () => {
    expect(zoneLineStyle("programarea")).toEqual({ color: "#ffffff", width: 1, opacity: 1 });
  });

  it("planarea styles like programarea (v1 reports on Planning Areas)", () => {
    expect(zoneLineStyle("planarea")).toEqual({ color: "#ffffff", width: 1, opacity: 1 });
  });

  it("ecoregion: black, 3 px, opacity 1", () => {
    expect(zoneLineStyle("ecoregion")).toEqual({ color: "#000000", width: 3, opacity: 1 });
  });

  it("subregion: #d9d9d9, 2 px, opacity 0.7, dashed [3,3]", () => {
    expect(zoneLineStyle("subregion")).toEqual({
      color: "#d9d9d9",
      width: 2,
      opacity: 0.7,
      dash: [3, 3],
    });
  });

  it("an unknown unit falls back to the table's own 'anything else' row, never throws", () => {
    expect(zoneLineStyle("seamount")).toEqual(ZONE_LINE_STYLE_DEFAULT);
    expect(ZONE_LINE_STYLE_DEFAULT).toEqual({ color: "#ffffff", width: 0.5, opacity: 0.45 });
  });
});

describe("zoneLabelStyle", () => {
  it("programarea: white 12 px on a dark halo", () => {
    expect(zoneLabelStyle("programarea")).toEqual({
      color: "#ffffff",
      size: 12,
      haloColor: "rgba(0,0,0,0.75)",
      haloWidth: 1,
    });
  });

  it("ecoregion: black 16 px on a light halo", () => {
    expect(zoneLabelStyle("ecoregion")).toEqual({
      color: "#000000",
      size: 16,
      haloColor: "rgba(255,255,255,0.85)",
      haloWidth: 1.5,
    });
  });

  it("subregion has NO labels (the R table's NULL row)", () => {
    expect(zoneLabelStyle("subregion")).toBeNull();
  });

  it("an unknown unit gets no labels rather than a guessed style", () => {
    expect(zoneLabelStyle("seamount")).toBeNull();
  });
});

describe("sources and ids", () => {
  it("a vector source per unit, addressed through the pmtiles:// protocol", () => {
    expect(zoneSources([PRA])).toEqual({
      programarea_src: { type: "vector", url: `pmtiles://${PRA.pmtiles}` },
    });
  });

  it("a unit with labels also gets a geojson point source", () => {
    const labels = {
      points: { type: "FeatureCollection" as const, features: [] },
      textProperty: "key",
    };
    expect(Object.keys(zoneSources([{ ...PRA, labels }]))).toEqual([
      "programarea_src",
      "programarea_lbl_src",
    ]);
  });

  it("query layers put fills before lines (a click inside a polygon is the polygon)", () => {
    const withFill: ZoneUnitSpec = {
      ...PRA,
      fill: {
        keyProperty: "programarea_key",
        stops: [{ key: "GAA", color: "#111111" }],
        defaultColor: "lightgrey",
        opacity: 0.7,
        outlineColor: "white",
      },
    };
    expect(zoneQueryLayerIds([withFill])).toEqual(["programarea_fill", "programarea_ln"]);
  });
});

describe("layers", () => {
  it("the line layer carries the table's paint and a dash only where the table has one", () => {
    expect(zoneLineLayer(PRA, "navy")).toMatchObject({
      id: "programarea_ln",
      type: "line",
      source: "programarea_src",
      "source-layer": "programarea",
      paint: { "line-color": "#ffffff", "line-width": 1, "line-opacity": 1 },
    });
    expect(zoneLineLayer(PRA, "navy").paint).not.toHaveProperty("line-dasharray");
    const sub = zoneLineLayer({ ...PRA, unit: "subregion" }, "navy");
    expect(sub.paint).toMatchObject({ "line-dasharray": [3, 3] });
  });

  // R9 (owner, 2026-09-24): white reads fine on the dark-matter basemap the zone_style table was
  // designed against, but is near-invisible on the paper theme's light one -- programarea/planarea
  // (and the "anything else" default row) recolor by theme; ecoregion (already black) and
  // subregion (already grey) do not, because they were never the near-basemap case.
  it("paper substitutes brand navy ink for a white stroke; navy is unchanged", () => {
    expect(zoneLineLayer(PRA, "paper").paint).toMatchObject({ "line-color": "#001a57" });
    expect(zoneLineLayer(PRA, "navy").paint).toMatchObject({ "line-color": "#ffffff" });
    expect(zoneLineLayer({ ...PRA, unit: "planarea" }, "paper").paint).toMatchObject({
      "line-color": "#001a57",
    });
    const fallback = zoneLineLayer({ ...PRA, unit: "some-future-unit" }, "paper");
    expect(fallback.paint).toMatchObject({ "line-color": "#001a57" }); // the default row is white too
  });

  it("ecoregion (black) and subregion (grey) do not change with theme", () => {
    expect(zoneLineLayer(ECO, "paper").paint).toMatchObject({ "line-color": "#000000" });
    expect(zoneLineLayer(ECO, "navy").paint).toMatchObject({ "line-color": "#000000" });
    const sub = zoneLineLayer({ ...PRA, unit: "subregion" }, "paper");
    expect(sub.paint).toMatchObject({ "line-color": "#d9d9d9" });
  });

  it("no fill layer unless the lens supplied values (outline-only is the default)", () => {
    expect(zoneFillLayer(PRA)).toBeNull();
  });

  it("the fill is a `match` on the unit's key property with a default colour last", () => {
    const layer = zoneFillLayer({
      ...PRA,
      fill: {
        keyProperty: "programarea_key",
        stops: [
          { key: "GAA", color: "#111111" },
          { key: "MDA", color: "#222222" },
        ],
        defaultColor: "lightgrey",
        opacity: 0.7,
        outlineColor: "white",
      },
    });
    expect(layer?.paint).toEqual({
      "fill-color": [
        "match",
        ["get", "programarea_key"],
        "GAA",
        "#111111",
        "MDA",
        "#222222",
        "lightgrey",
      ],
      "fill-opacity": 0.7,
      "fill-outline-color": "white",
    });
  });

  it("a label layer exists only where the table allows one", () => {
    const labels = {
      points: { type: "FeatureCollection" as const, features: [] },
      textProperty: "key",
    };
    expect(zoneLabelLayer({ ...PRA, labels })).toMatchObject({
      id: "programarea_lbl",
      type: "symbol",
      layout: { "text-size": 12, "text-allow-overlap": true },
    });
    expect(zoneLabelLayer({ ...PRA, unit: "subregion", labels })).toBeNull();
    expect(zonesNeedGlyphs([{ ...PRA, unit: "subregion", labels }])).toBe(false);
    expect(zonesNeedGlyphs([{ ...PRA, labels }])).toBe(true);
    expect(zonesNeedGlyphs([PRA])).toBe(false);
  });
});

describe("boot.json readers", () => {
  it("`fld` becomes the unit type", () => {
    expect(unitFromFld("programarea_key")).toBe("programarea");
    expect(unitFromFld("ecoregion_key")).toBe("ecoregion");
  });

  it("reads boot.units in boot's own order", () => {
    const boot = {
      units: [
        {
          fld: "programarea_key",
          label: "Program areas",
          pmtiles: "https://a",
          source_layer: "programarea",
        },
        {
          fld: "ecoregion_key",
          label: "Ecoregions",
          pmtiles: "https://b",
          source_layer: "ecoregion",
        },
      ],
    };
    expect(zoneUnitsFromBoot(boot).map((u) => u.unit)).toEqual(["programarea", "ecoregion"]);
  });

  it("SKIPS a row missing pmtiles or source_layer rather than guessing one", () => {
    const boot = {
      units: [
        { fld: "programarea_key", pmtiles: "https://a" }, // no source_layer
        { fld: "ecoregion_key", source_layer: "ecoregion" }, // no pmtiles
        { fld: "subregion_key", pmtiles: "https://c", source_layer: "subregion" },
      ],
    };
    expect(zoneUnitsFromBoot(boot).map((u) => u.unit)).toEqual(["subregion"]);
  });

  it("a release with no units (or no boot at all) yields none, never a throw", () => {
    expect(zoneUnitsFromBoot(null)).toEqual([]);
    expect(zoneUnitsFromBoot({})).toEqual([]);
    expect(zoneUnitsFromBoot({ units: "nope" })).toEqual([]);
  });

  // B3 (docs/usability.md): pick mode could resolve a click on a Program Area's 1-px BORDER but
  // never its interior, because `zoneQueryLayerIds` only includes a unit's `_fill` layer id when
  // `u.fill` is set, and outline-only units carried none. Every unit `zoneUnitsFromBoot` returns
  // now gets an invisible (`opacity: 0`) query fill by default, so the `_fill` layer always exists
  // in the composed style and pick mode can query it -- ON SCREEN this is unchanged (opacity 0),
  // proven by `zoneFillLayer`'s own empty-stops case (below) painting a flat, invisible colour.
  it("every unit gets an invisible query fill by default (B3) -- visually still outline-only", () => {
    const boot = {
      units: [
        {
          fld: "programarea_key",
          label: "Program areas",
          pmtiles: "https://a",
          source_layer: "programarea",
        },
      ],
    };
    const [u] = zoneUnitsFromBoot(boot);
    expect(u.fill).toEqual({
      keyProperty: "programarea_key",
      stops: [],
      defaultColor: "#000000",
      opacity: 0,
      outlineColor: "#000000",
    });
    // the layer this makes queryable is the SAME one pick mode needs, and it is invisible.
    expect(zoneQueryLayerIds([u])).toEqual(["programarea_fill", "programarea_ln"]);
    // a FLAT colour, not a `match` expression with zero label/output pairs -- MapLibre rejects
    // `["match", input, fallback]` at runtime (`Expected at least 4 arguments, but found only 2`,
    // caught only by a real browser: e2e/scores.palettes.spec.ts, which also explains why the
    // SAME broken style silently starved the raster layer behind it in
    // e2e/scores.firstpaint.spec.ts and the pick query in e2e/places.pick.spec.ts before this).
    expect(zoneFillLayer(u)?.paint).toEqual({
      "fill-color": "#000000",
      "fill-opacity": 0,
      "fill-outline-color": "#000000",
    });
  });

  it("label points come back as a FeatureCollection keyed by `key`", () => {
    const boot = {
      zones: {
        programarea: [
          { key: "GAA", name: "Gulf of America", label_pt: [-89.1, 26.3] },
          { key: "MDA", name: "Mid Atlantic", label_pt: { lng: -73.5, lat: 38.2 } },
        ],
      },
    };
    const labels = zoneLabelsFromBoot(boot, "programarea");
    expect(labels?.textProperty).toBe("key");
    expect(labels?.points.features).toHaveLength(2);
    expect(labels?.points.features[1].properties).toEqual({ key: "MDA", name: "Mid Atlantic" });
  });

  it("unshifts a cached 0-360 label longitude back into -180..180 (ALA lng = 187.5)", () => {
    const boot = { zones: { programarea: [{ key: "ALA", label_pt: [187.5, 55.2] }] } };
    const f = zoneLabelsFromBoot(boot, "programarea")?.points.features[0];
    expect(f?.geometry).toEqual({ type: "Point", coordinates: [-172.5, 55.2] });
  });

  it("a unit with no label points at all is null, not an empty layer", () => {
    expect(
      zoneLabelsFromBoot({ zones: { programarea: [{ key: "GAA" }] } }, "programarea"),
    ).toBeNull();
    expect(zoneLabelsFromBoot(null, "programarea")).toBeNull();
  });
});

// G-25 fix (docs/parity.html): `Sel.out` was parsed and round-tripped in the URL but nothing read
// it -- the species map always drew the Program-Area outline regardless of `out=none`/`out=
// ecoregion`. `zoneUnitsWithOutline` is the ONE function `Shell.svelte` calls on whichever
// `zones` array reaches `composeStyle()`; these are its own rule-level cases.
describe("zoneUnitsWithOutline (G-25: Sel.out's map-side effect)", () => {
  it('out="none" hides every unit\'s outline, regardless of type', () => {
    const out = zoneUnitsWithOutline([PRA, ECO], "none");
    expect(out.map((u) => u.lineVisible)).toEqual([false, false]);
  });

  it('out="programarea" keeps only the matching unit visible', () => {
    const out = zoneUnitsWithOutline([PRA, ECO], "programarea");
    expect(out.find((u) => u.unit === "programarea")?.lineVisible).toBe(true);
    expect(out.find((u) => u.unit === "ecoregion")?.lineVisible).toBe(false);
  });

  it('out="ecoregion" keeps only the matching unit visible, even if the release has not published it', () => {
    // PRA only -- no ecoregion unit in this release yet. Never throws; simply nothing to show.
    const out = zoneUnitsWithOutline([PRA], "ecoregion");
    expect(out).toEqual([{ ...PRA, lineVisible: false }]);
  });

  it("never touches any other field on the unit (fill, labels, highlightKey survive untouched)", () => {
    const withFill: ZoneUnitSpec = {
      ...PRA,
      fill: {
        keyProperty: "programarea_key",
        stops: [],
        defaultColor: "lightgrey",
        opacity: 0.7,
        outlineColor: "white",
      },
      highlightKey: "GAA",
    };
    const [out] = zoneUnitsWithOutline([withFill], "none");
    expect(out.fill).toEqual(withFill.fill);
    expect(out.highlightKey).toBe("GAA");
    expect(out.lineVisible).toBe(false);
  });

  it("an empty units list stays empty", () => {
    expect(zoneUnitsWithOutline([], "programarea")).toEqual([]);
  });
});
