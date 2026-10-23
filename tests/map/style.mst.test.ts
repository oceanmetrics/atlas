// composeStyle with a release's zone units (the MarineSensitivity instance): moved from
// MarineSensitivity/atlas 0.10.93's tests/map/style.test.ts; tests/map/style.test.ts covers the same
// module for an instance without zones (scripts/instance-modules.mjs runs each under its instance).
// composeStyle + the declared layer order + applyStyle. The order table is the gate that replaces
// the Shiny app's `before_id` chain (atlas-4 §2.4/§11.4: "layer order is declared, so a missing
// `before` layer can never cascade").
//
// composeStyle stays SYNCHRONOUS (atlas-map basemap fix): the default basemap reads whatever
// `layers/basemap.ts#loadBasemapStyle()` has already cached for the theme, never awaiting the
// fetch inline (style.ts's own header explains the measured regression that made this the rule).
// Every test below that is not itself ABOUT the basemap passes `basemap: null` so it never touches
// the cache/network at all (CLAUDE.md "Testing pyramid": unit tests are "no DOM and no network");
// the tests that ARE about the basemap inject a `basemapStyle` fixture instead of the real fetch.
import { describe, expect, it, vi } from "vitest";
import {
  BASEMAP_LAYER_PREFIX,
  DRAW_LAYER_PREFIX,
  LAYER_ORDER,
  SELECTION_COLOR,
  SELECTION_FILL_OPACITY_DEFAULT,
  applyStyle,
  cartoStyleHasSymbolLayer,
  composeStyle as composeStyleParts,
  mergeCartoStyle,
  orderLayers,
  preserveDrawLayers,
  rankForStack,
  type LayerRole,
  type RoledLayer,
} from "../../src/lib/map/style";
import type { CartoStyleLike } from "../../src/lib/map/layers/basemap";
import {
  composeZoneStyle,
  zoneUnitsFromBoot,
  zoneUnitsWithOutline,
} from "../../src/lib/map/layers/zones";
import {
  OUTSIDE_PRA_COLORMAP,
  titilerMaskTileTemplate,
  titilerTileTemplate,
} from "../../src/lib/map/layers/titiler";
import { OVERLAY_RASTER_OPACITY, SCORE_RASTER_OPACITY } from "../../src/lib/map/layers/raster";
import type {
  SourceSpecification,
  StyleSpecification,
  ZoneUnitSpec,
} from "../../src/lib/map/types";
import {
  MISTAGGED_BASEMAP_LAYER,
  UNGROUPED_BASEMAP_LAYER,
  UNORDERED_ROLED_LAYER,
} from "../fixtures/map/faults";
import { defaultLayerStackEntries, moveLayerStackEntry } from "../../src/lib/map/layerStack";

// MarineSensitivity/atlas 0.10.93 passed `zones` to composeStyle; composeStyle now takes the zone
// units as style parts (`zoneStyle`, from `layers/zones.ts#composeZoneStyle`, reached through the
// instance module table), so the cases below compose them the way the shell does
function composeStyle(
  input: Parameters<typeof composeStyleParts>[0] & { zones?: readonly ZoneUnitSpec[] },
): StyleSpecification {
  const { zones, ...rest } = input;
  return composeStyleParts({
    ...rest,
    zoneStyle: zones ? composeZoneStyle(zones, rest.theme) : rest.zoneStyle,
  });
}

const PRA: ZoneUnitSpec = {
  unit: "programarea",
  pmtiles: "https://s3.example/zones/programarea/zones.pmtiles",
  sourceLayer: "programarea",
};
const ECO: ZoneUnitSpec = {
  unit: "ecoregion",
  pmtiles: "https://s3.example/zones/ecoregion/zones.pmtiles",
  sourceLayer: "ecoregion",
};

const SCORE = {
  id: "r_lyr",
  tiles: [
    titilerTileTemplate({
      url: "https://s3.example/cog/usa05/d2.tif",
      colormapName: "spectral_r",
      rescaleMin: 0,
      rescaleMax: 90,
    }),
  ],
  opacity: SCORE_RASTER_OPACITY,
};

/** a minimal CARTO-shaped style — one background layer (id "background", colliding with
 * composeStyle's OWN synthetic background layer on purpose) and one "water" fill on the "carto"
 * vector source, plus a sprite/glyphs pair — enough to exercise the real merge without a fetch. */
const FAKE_CARTO_STYLE: CartoStyleLike = {
  sources: { carto: { type: "vector", url: "https://tiles.example/tiles.json" } },
  sprite: "https://tiles.example/gl/dark-matter-gl-style/sprite",
  glyphs: "https://tiles.example/fonts/{fontstack}/{range}.pbf",
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#101820" } },
    { id: "water", type: "fill", source: "carto", "source-layer": "water", paint: {} },
  ],
};

describe("orderLayers", () => {
  it("sorts by the declared order regardless of the order layers were built in", () => {
    const roled: RoledLayer[] = [
      { role: "zone-line", layer: { id: "a_ln", type: "line", source: "s" } },
      { role: "background", layer: { id: "bg", type: "background" } },
      { role: "raster", layer: { id: "r", type: "raster", source: "s" } },
    ];
    expect(orderLayers(roled).map((l) => l.id)).toEqual(["bg", "r", "a_ln"]);
  });

  it("is stable within a role (boot's unit order survives)", () => {
    const roled: RoledLayer[] = [
      { role: "zone-line", layer: { id: "programarea_ln", type: "line", source: "s" } },
      { role: "zone-line", layer: { id: "ecoregion_ln", type: "line", source: "s" } },
    ];
    expect(orderLayers(roled).map((l) => l.id)).toEqual(["programarea_ln", "ecoregion_ln"]);
  });

  it("SEEDED FAULT: a layer whose role is not in LAYER_ORDER throws, naming the layer", () => {
    expect(() => orderLayers([UNORDERED_ROLED_LAYER])).toThrowError(/bathymetry/);
  });

  // R3 (round-2 plan §5 U4): the SAME throw mechanism now also covers a basemap layer tagged with a
  // plausible-but-undeclared STACK group (`tests/fixtures/map/faults.ts` FAULT 5) — proving
  // "every basemap layer is assigned to exactly one group" has teeth, not just that
  // `classifyBasemapLayer` happens to be total.
  it("SEEDED FAULT: a layer tagged with an undeclared basemap stack group throws, naming the layer", () => {
    expect(() => orderLayers([UNGROUPED_BASEMAP_LAYER])).toThrowError(/basemap-seafloor-relief/);
  });

  it("SEEDED FAULT: a basemap layer mistagged with a later role sorts AFTER the zone data it should sit under", () => {
    const roled: RoledLayer[] = [
      { role: "basemap-land", layer: { id: "basemap-background", type: "background" } },
      MISTAGGED_BASEMAP_LAYER,
      { role: "zone-fill", layer: { id: "programarea_fill", type: "fill", source: "s" } },
    ];
    const ids = orderLayers(roled).map((l) => l.id);
    // proves the order gate has teeth: if composeStyle's merge loop ever tagged a CARTO layer with
    // the wrong role, it would land AFTER the zone data instead of under it — exactly the "CARTO
    // layers placed after the zone layers" regression this fixture stands in for.
    expect(ids.indexOf("basemap-water")).toBeGreaterThan(ids.indexOf("programarea_fill"));
  });

  it("the declared order is the documented one (basemap first, selection on top, background at the bottom)", () => {
    expect(LAYER_ORDER[0]).toBe("background");
    // R3: the single "basemap" bucket is now five sub-roles (`basemap-land` first — everything the
    // old flat bucket held sat where THIS sub-role now sits, see style.ts's own header).
    expect(LAYER_ORDER[1]).toBe("basemap-land");
    // the shared LAYER_ORDER ends with the Collections lens' clicked-cell highlight, over the places
    // selection (tests/map/style.test.ts); the zone highlight is a `selection-line` below it
    expect(LAYER_ORDER[LAYER_ORDER.length - 1]).toBe("highlight-ring");
    expect(LAYER_ORDER.indexOf("zone-label")).toBeLessThan(LAYER_ORDER.indexOf("selection-line"));
    expect(LAYER_ORDER.indexOf("basemap-land")).toBeLessThan(LAYER_ORDER.indexOf("raster"));
    expect(LAYER_ORDER.indexOf("basemap-labels")).toBeLessThan(LAYER_ORDER.indexOf("raster"));
    expect(LAYER_ORDER.indexOf("raster")).toBeLessThan(LAYER_ORDER.indexOf("zone-fill"));
    expect(LAYER_ORDER.indexOf("zone-fill")).toBeLessThan(LAYER_ORDER.indexOf("zone-line"));
    expect(LAYER_ORDER.indexOf("zone-line")).toBeLessThan(LAYER_ORDER.indexOf("zone-label"));
  });
});

describe("mergeCartoStyle", () => {
  it("namespaces every source id with the basemap prefix and rewrites layers' `source` to match", () => {
    const sources: Record<string, SourceSpecification> = {};
    const merged = mergeCartoStyle(FAKE_CARTO_STYLE, sources);
    expect(Object.keys(sources)).toEqual([`${BASEMAP_LAYER_PREFIX}carto`]);
    const water = merged.layers.find((l) => l.id === `${BASEMAP_LAYER_PREFIX}water`);
    expect(water && "source" in water ? water.source : null).toBe(`${BASEMAP_LAYER_PREFIX}carto`);
  });

  it("prefixes every layer id — including CARTO's own literal \"background\", which would otherwise collide with composeStyle's synthetic background layer", () => {
    const merged = mergeCartoStyle(FAKE_CARTO_STYLE, {});
    expect(merged.layers.map((l) => l.id)).toEqual([
      `${BASEMAP_LAYER_PREFIX}background`,
      `${BASEMAP_LAYER_PREFIX}water`,
    ]);
  });

  it("namespaces around a real id collision instead of overwriting the existing source", () => {
    const taken = { type: "raster", tiles: [] } as unknown as SourceSpecification;
    const sources: Record<string, SourceSpecification> = {
      [`${BASEMAP_LAYER_PREFIX}carto`]: taken,
    };
    mergeCartoStyle(FAKE_CARTO_STYLE, sources);
    expect(sources[`${BASEMAP_LAYER_PREFIX}carto`]).toBe(taken); // untouched
    expect(sources[`${BASEMAP_LAYER_PREFIX}carto-x`]).toBeDefined(); // the CARTO source landed here
  });

  it("carries sprite/glyphs over verbatim", () => {
    const merged = mergeCartoStyle(FAKE_CARTO_STYLE, {});
    expect(merged.sprite).toBe(FAKE_CARTO_STYLE.sprite);
    expect(merged.glyphs).toBe(FAKE_CARTO_STYLE.glyphs);
  });

  it("an empty (fallback) CARTO style merges in zero sources/layers", () => {
    const sources: Record<string, SourceSpecification> = {};
    const merged = mergeCartoStyle({ sources: {}, layers: [] }, sources);
    expect(Object.keys(sources)).toEqual([]);
    expect(merged.layers).toEqual([]);
  });

  // UI-21 (round-3 review, Ben's ask): basemap labels in English.
  it('rewrites a plain `["get","name"]` symbol text-field to prefer name_en, falling back to name', () => {
    const carto: CartoStyleLike = {
      sources: { carto: { type: "vector", url: "https://tiles.example/tiles.json" } },
      layers: [
        {
          id: "place-label",
          type: "symbol",
          source: "carto",
          "source-layer": "place",
          layout: { "text-field": ["get", "name"] },
        } as unknown as NonNullable<CartoStyleLike["layers"]>[number],
      ],
    };
    const merged = mergeCartoStyle(carto, {});
    const layers = merged.layers as unknown as Array<{
      id: string;
      layout?: Record<string, unknown>;
    }>;
    const label = layers.find((l) => l.id === `${BASEMAP_LAYER_PREFIX}place-label`);
    expect(label?.layout?.["text-field"]).toEqual([
      "coalesce",
      ["get", "name_en"],
      ["get", "name"],
    ]);
  });

  it('rewrites the legacy `"{name}"` token string the same way', () => {
    const carto: CartoStyleLike = {
      sources: {},
      layers: [
        {
          id: "place-label",
          type: "symbol",
          layout: { "text-field": "{name}" },
        } as unknown as NonNullable<CartoStyleLike["layers"]>[number],
      ],
    };
    const merged = mergeCartoStyle(carto, {});
    const label = merged.layers[0] as unknown as { layout: Record<string, unknown> };
    expect(label.layout["text-field"]).toEqual(["coalesce", ["get", "name_en"], ["get", "name"]]);
  });

  it("never touches a DIFFERENT field, e.g. water_name — CARTO's own water-body labels stay as published", () => {
    const carto: CartoStyleLike = {
      sources: {},
      layers: [
        {
          id: "water-label",
          type: "symbol",
          layout: { "text-field": ["get", "water_name"] },
        } as unknown as NonNullable<CartoStyleLike["layers"]>[number],
      ],
    };
    const merged = mergeCartoStyle(carto, {});
    const label = merged.layers[0] as unknown as { layout: Record<string, unknown> };
    expect(label.layout["text-field"]).toEqual(["get", "water_name"]);
  });

  it("leaves a non-symbol layer's fields untouched entirely", () => {
    const merged = mergeCartoStyle(FAKE_CARTO_STYLE, {});
    const water = merged.layers.find((l) => l.id === `${BASEMAP_LAYER_PREFIX}water`);
    expect(water).toEqual({
      id: `${BASEMAP_LAYER_PREFIX}water`,
      type: "fill",
      source: `${BASEMAP_LAYER_PREFIX}carto`,
      "source-layer": "water",
      paint: {},
    });
  });
});

describe("cartoStyleHasSymbolLayer", () => {
  it("false for a style with no symbol layer", () => {
    expect(cartoStyleHasSymbolLayer(FAKE_CARTO_STYLE)).toBe(false);
  });

  it("true once a symbol layer is present", () => {
    expect(
      cartoStyleHasSymbolLayer({
        ...FAKE_CARTO_STYLE,
        layers: [...(FAKE_CARTO_STYLE.layers ?? []), { id: "place_label", type: "symbol" }],
      }),
    ).toBe(true);
  });
});

describe("composeStyle", () => {
  it("a bare style (basemap: null) is background only", () => {
    const s = composeStyle({ theme: "paper", basemap: null });
    expect(s.layers.map((l) => l.id)).toEqual(["background"]);
    expect(s.sources).toEqual({});
  });

  it("the default basemap merges CARTO's sources/sprite/glyphs/layers, FIRST in the basemap slot", () => {
    const s = composeStyle({ theme: "navy", basemapStyle: FAKE_CARTO_STYLE });
    expect(s.layers.map((l) => l.id)).toEqual([
      "background",
      `${BASEMAP_LAYER_PREFIX}background`,
      `${BASEMAP_LAYER_PREFIX}water`,
    ]);
    expect(s.sources[`${BASEMAP_LAYER_PREFIX}carto`]).toBeDefined();
    expect(s.sprite).toBe(FAKE_CARTO_STYLE.sprite);
  });

  it("an un-warmed basemap (no `basemapStyle` override, nothing cached yet) falls back to background only", () => {
    // no network in a unit test: the default theme's real cache is never warmed here, so this
    // exercises the SAME fallback path a live app takes before loadBasemapStyle() resolves.
    const s = composeStyle({ theme: "navy" });
    expect(s.layers.map((l) => l.id)).toEqual(["background"]);
  });

  it("`basemap: null` still composes with zones/raster — the report's print surface", () => {
    const s = composeStyle({ theme: "paper", basemap: null, zones: [PRA] });
    expect(s.layers.map((l) => l.id)).toEqual(["background", "programarea_ln"]);
    expect(s.sources.basemap).toBeUndefined();
  });

  it("defaults to the globe projection and carries it IN the style (plan atlas-4 §5.3)", () => {
    expect(composeStyle({ theme: "navy", basemap: null }).projection).toEqual({ type: "globe" });
    expect(
      composeStyle({ theme: "navy", basemap: null, projection: "mercator" }).projection,
    ).toEqual({ type: "mercator" });
  });

  it("removing the raster removes exactly that layer — nothing cascades", () => {
    const withRaster = composeStyle({ theme: "navy", basemap: null, raster: SCORE, zones: [PRA] });
    const without = composeStyle({ theme: "navy", basemap: null, raster: null, zones: [PRA] });
    expect(withRaster.layers.map((l) => l.id)).toEqual(["background", "r_lyr", "programarea_ln"]);
    expect(without.layers.map((l) => l.id)).toEqual(["background", "programarea_ln"]);
  });

  it("orders the full stack: basemap, raster, overlay, fills, lines, labels, selection", () => {
    const s = composeStyle({
      theme: "navy",
      basemapStyle: FAKE_CARTO_STYLE,
      raster: SCORE,
      overlays: [
        {
          id: "outside_pra_lyr",
          tiles: [
            titilerMaskTileTemplate({
              url: "https://s3.example/cog/usa05/mask.tif",
              colormap: OUTSIDE_PRA_COLORMAP,
            }),
          ],
          opacity: OVERLAY_RASTER_OPACITY,
          visible: false,
        },
      ],
      zones: [
        {
          ...PRA,
          fill: {
            keyProperty: "programarea_key",
            stops: [{ key: "GAA", color: "#111111" }],
            defaultColor: "lightgrey",
            opacity: 0.7,
            outlineColor: "white",
          },
          labels: {
            points: { type: "FeatureCollection", features: [] },
            textProperty: "key",
          },
        },
        ECO,
      ],
      selection: { features: { type: "FeatureCollection", features: [] } },
    });
    expect(s.layers.map((l) => l.id)).toEqual([
      "background",
      "basemap-background",
      "basemap-water",
      "r_lyr",
      "outside_pra_lyr",
      "programarea_fill",
      "programarea_ln",
      "ecoregion_ln",
      "programarea_lbl",
      "selection-fill",
      "selection-line",
    ]);
  });

  it("the selection is #ff00aa and sits above every data layer", () => {
    const s = composeStyle({
      theme: "navy",
      basemap: null,
      zones: [PRA],
      selection: { features: { type: "FeatureCollection", features: [] } },
    });
    const line = s.layers.find((l) => l.id === "selection-line");
    expect(line && "paint" in line ? line.paint : null).toMatchObject({
      "line-color": SELECTION_COLOR,
    });
    expect(s.layers[s.layers.length - 1].id).toBe("selection-line");
  });

  // atlas-6 Deliverable 2's "show analysis cells" toggle: a data-driven fill-opacity instead of
  // the flat default, so a lightly-covered cell paints fainter than a fully-covered one.
  it("selection-fill's fill-opacity is the flat default without `cellOpacity`", () => {
    const s = composeStyle({
      theme: "navy",
      basemap: null,
      selection: { features: { type: "FeatureCollection", features: [] } },
    });
    const fill = s.layers.find((l) => l.id === "selection-fill");
    expect(fill && "paint" in fill ? fill.paint : null).toMatchObject({
      "fill-opacity": SELECTION_FILL_OPACITY_DEFAULT,
    });
  });

  it("selection-fill's fill-opacity reads each feature's own `opacity` property when `cellOpacity` is set", () => {
    const s = composeStyle({
      theme: "navy",
      basemap: null,
      selection: { features: { type: "FeatureCollection", features: [] }, cellOpacity: true },
    });
    const fill = s.layers.find((l) => l.id === "selection-fill");
    expect(fill && "paint" in fill ? fill.paint : null).toMatchObject({
      "fill-opacity": ["get", "opacity"],
    });
  });

  it("no basemap and no zone labels: glyphs is undefined (no stray font fetch)", () => {
    expect(composeStyle({ theme: "navy", basemap: null, zones: [PRA] }).glyphs).toBeUndefined();
  });

  it("a zone label alone sets glyphs, even with no basemap", () => {
    const withLabels = composeStyle({
      theme: "navy",
      basemap: null,
      zones: [
        {
          ...PRA,
          labels: { points: { type: "FeatureCollection", features: [] }, textProperty: "key" },
        },
      ],
    });
    expect(withLabels.glyphs).toContain("{fontstack}");
  });

  const CARTO_WITH_LABELS: CartoStyleLike = {
    ...FAKE_CARTO_STYLE,
    layers: [...(FAKE_CARTO_STYLE.layers ?? []), { id: "place_label", type: "symbol" }],
  };

  it("the basemap alone sets glyphs (CARTO's own place/road labels), even with no zone labels", () => {
    const s = composeStyle({ theme: "navy", basemapStyle: CARTO_WITH_LABELS, zones: [PRA] });
    expect(s.glyphs).toBe(CARTO_WITH_LABELS.glyphs);
  });

  it("a basemap with NO symbol layer of its own sets no glyphs (no stray font fetch)", () => {
    const s = composeStyle({ theme: "navy", basemapStyle: FAKE_CARTO_STYLE });
    expect(s.glyphs).toBeUndefined();
  });

  it("a `glyphs` override wins over the basemap's own", () => {
    const s = composeStyle({
      theme: "navy",
      basemapStyle: CARTO_WITH_LABELS,
      glyphs: "https://override.example/{fontstack}/{range}.pbf",
    });
    expect(s.glyphs).toBe("https://override.example/{fontstack}/{range}.pbf");
  });

  it("`basemap: null` composes a map with no basemap at all (the report's print surface)", () => {
    const s = composeStyle({ theme: "paper", basemap: null, zones: [PRA] });
    expect(s.layers.map((l) => l.id)).toEqual(["background", "programarea_ln"]);
    expect(s.sources.basemap).toBeUndefined();
  });

  it("the raster resamples NEAREST, so a probed pixel is the cell's own value", () => {
    const s = composeStyle({ theme: "navy", basemap: null, raster: SCORE });
    const r = s.layers.find((l) => l.id === "r_lyr");
    expect(r && "paint" in r ? r.paint : null).toEqual({
      "raster-opacity": SCORE_RASTER_OPACITY,
      "raster-resampling": "nearest",
    });
  });
});

// G-25 fix (docs/parity.html): `Sel.out` used to round-trip in the URL with nothing reading it --
// `out=none` still drew the Program-Area outline. `Shell.svelte` now runs every `zones` array
// through `zoneUnitsWithOutline()` before it reaches `composeStyle()` (rule-level cases live in
// tests/map/zones.test.ts); this is the integration proof, on the REAL composed style, of the
// task's own acceptance rule: "out=none -> no zone line layer (or visibility: none), the default
// -> present".
describe("composeStyle + zoneUnitsWithOutline (G-25: Sel.out reaches the rendered style)", () => {
  it('out="none": the zone-line layer is present in the style but visibility: "none" (never removed -- CLAUDE.md: no addLayer/setLayoutProperty after the fact)', () => {
    const s = composeStyle({
      theme: "navy",
      basemap: null,
      zones: zoneUnitsWithOutline([PRA], "none"),
    });
    const line = s.layers.find((l) => l.id === "programarea_ln");
    expect(line).toBeDefined();
    expect(line && "layout" in line ? line.layout : null).toEqual({ visibility: "none" });
  });

  it('the default outline ("programarea" for the scores lens) renders the line, visible', () => {
    const s = composeStyle({
      theme: "navy",
      basemap: null,
      zones: zoneUnitsWithOutline([PRA], "programarea"),
    });
    const line = s.layers.find((l) => l.id === "programarea_ln");
    expect(line).toBeDefined();
    expect(line && "layout" in line ? line.layout : null).toEqual({ visibility: "visible" });
  });

  it("a hidden outline never hides the SAME unit's choropleth fill (a separate layer/paint property)", () => {
    const s = composeStyle({
      theme: "navy",
      basemap: null,
      zones: zoneUnitsWithOutline(
        [
          {
            ...PRA,
            fill: {
              keyProperty: "programarea_key",
              stops: [{ key: "GAA", color: "#111111" }],
              defaultColor: "lightgrey",
              opacity: 0.7,
              outlineColor: "white",
            },
          },
        ],
        "none",
      ),
    });
    const fill = s.layers.find((l) => l.id === "programarea_fill");
    const line = s.layers.find((l) => l.id === "programarea_ln");
    expect(fill).toBeDefined();
    expect(line && "layout" in line ? line.layout : null).toEqual({ visibility: "none" });
  });

  // m8 (review round 1): "no release ever publishes a second, ecoregion-outline unit" is scoped to
  // SELECTABLE units (`boot.units[]`, what `zoneUnitsWithOutline`/`out=` picks from) -- it is not a
  // claim about ecoregion PMTiles existing at all. R3 orchestrator audit item 2 separately draws a
  // standalone, always-on ecoregion outline read from the release's MANIFEST
  // (`ecoregionZoneUnitFromManifest`, `Shell.svelte`'s `ecoregionUnit`), appended OUTSIDE this
  // function's `zones` input entirely (see `e2e/layers.spec.ts`'s "ecoregion boundaries" describe
  // block) -- `composeStyle` here never sees it, so this test's claim is unaffected by it.
  it('out="ecoregion" on a release that only publishes programarea: the SAME hidden-line result as "none" -- not a bug, plan D17 (no release ever publishes a second, SELECTABLE ecoregion-outline unit)', () => {
    const s = composeStyle({
      theme: "navy",
      basemap: null,
      zones: zoneUnitsWithOutline([PRA], "ecoregion"),
    });
    const line = s.layers.find((l) => l.id === "programarea_ln");
    expect(line).toBeDefined();
    expect(line && "layout" in line ? line.layout : null).toEqual({ visibility: "none" });
    // no ecoregion unit was ever IN `zones` to begin with -- nothing composed, not merely hidden.
    expect(s.layers.some((l) => l.id === "ecoregion_ln")).toBe(false);
  });
});

// R3 (round-2 plan §5 U4, docs/usability.md §7 R3): the layer STACK — reordering basemap sub-roles
// relative to the data, and dimming/hiding a whole group. `composeStyle` still returns ONE style
// object (CLAUDE.md's "one composed style" rule); `layerStack` is one more plain input, exactly
// like `zones`/`raster`/`selection` above.
describe("composeStyle + layerStack (R3: the layer stack model)", () => {
  // a fuller CARTO-shaped fixture than FAKE_CARTO_STYLE — one layer per basemap sub-role, so a
  // reorder/opacity/visibility assertion below can tell every bucket apart.
  const CARTO_FULL: CartoStyleLike = {
    sources: { carto: { type: "vector", url: "https://tiles.example/tiles.json" } },
    layers: [
      { id: "background", type: "background", paint: { "background-color": "#101820" } },
      { id: "water", type: "fill", source: "carto", "source-layer": "water", paint: {} },
      {
        id: "boundary_state",
        type: "line",
        source: "carto",
        "source-layer": "boundary",
        paint: {},
      },
      { id: "road_major", type: "line", source: "carto", "source-layer": "road", paint: {} },
      {
        id: "place_label",
        type: "symbol",
        source: "carto",
        "source-layer": "place",
        layout: {},
      },
    ],
  };

  // M1 fix (Opus 5.5 review): CARTO's OWN dark-matter/positron style.json interleaves its layer
  // TYPES (a boundary line sits between two land/water fills, a country boundary sits between a
  // road layer and a label layer) rather than grouping them by our 5 sub-roles — verified live
  // against both real styles (dark-matter: water/water_shadow under boundary_county/boundary_state
  // and country boundaries under roads; positron: waterway_label over tunnels). A bucketed sort
  // (one rank per SUB-ROLE) would hoist every "land" layer before every "boundaries" layer
  // regardless of this real interleaving; the shared-run rank (`rankForStack`) instead reproduces
  // CARTO's own order exactly, because every layer in one contiguous basemap run shares ONE rank
  // and the stable sort falls through to original insertion index — this fixture is the review's
  // own literal example.
  it("M1: a real CARTO-shaped interleaving is UNCHANGED, with or without an explicit default layerStack", () => {
    const cartoInterleaved: CartoStyleLike = {
      sources: { carto: { type: "vector", url: "https://tiles.example/tiles.json" } },
      layers: [
        { id: "background", type: "background", paint: {} },
        { id: "boundary_state", type: "line", source: "carto", "source-layer": "boundary" },
        { id: "water", type: "fill", source: "carto", "source-layer": "water" },
        { id: "road", type: "line", source: "carto", "source-layer": "road" },
        { id: "boundary_country", type: "line", source: "carto", "source-layer": "boundary" },
        { id: "place_label", type: "symbol", source: "carto", "source-layer": "place" },
      ],
    };
    // OUR own synthetic "background" layer is always first, unconditionally; then every CARTO
    // layer in EXACTLY its own original order (the review's own fixture) — never regrouped by
    // sub-role.
    const expected = [
      "background",
      `${BASEMAP_LAYER_PREFIX}background`,
      `${BASEMAP_LAYER_PREFIX}boundary_state`,
      `${BASEMAP_LAYER_PREFIX}water`,
      `${BASEMAP_LAYER_PREFIX}road`,
      `${BASEMAP_LAYER_PREFIX}boundary_country`,
      `${BASEMAP_LAYER_PREFIX}place_label`,
    ];

    const withoutStack = composeStyle({ theme: "navy", basemapStyle: cartoInterleaved });
    expect(withoutStack.layers.map((l) => l.id)).toEqual(expected);

    const withDefaultStack = composeStyle({
      theme: "navy",
      basemapStyle: cartoInterleaved,
      layerStack: defaultLayerStackEntries(),
    });
    expect(withDefaultStack.layers.map((l) => l.id)).toEqual(expected);
  });

  it("no `layerStack` input: byte-identical to the pre-R3 default (backward compatible)", () => {
    const withDefault = composeStyle({
      theme: "navy",
      basemapStyle: CARTO_FULL,
      raster: SCORE,
      layerStack: defaultLayerStackEntries(),
    });
    const withoutInput = composeStyle({ theme: "navy", basemapStyle: CARTO_FULL, raster: SCORE });
    expect(withoutInput).toEqual(withDefault);
  });

  // m10 (review round 1): a `layerStack` input missing a WHOLE group used to make `orderLayers`
  // throw the moment a layer whose role belongs to that group was composed ("has a role ... which
  // is not in the declared stack order") -- `parseLayerStack` already repairs a well-formed but
  // partial `layers=` URL token, but `composeStyle` takes `layerStack` directly, so a hand-built
  // array (bypassing the URL layer, e.g. a future caller or a test) had no such repair.
  // `normalizeLayerStack` fixes it at the one call site instead.
  it("m10: a layerStack MISSING a whole group no longer throws -- it composes as if that group were never removed", () => {
    // review round 2: normalizeLayerStack now inserts a missing group at its own DEFAULT position
    // (the same fix parseLayerStack's M2 already had), not appended at the array's end -- so a
    // `layerStack` missing data-raster entirely composes BYTE IDENTICAL to the real default, not
    // merely "somewhere, without crashing" (the weaker claim this test used to make, back when a
    // missing group really did land in the wrong place -- after data-places/selection instead of
    // before it).
    const opts = {
      theme: "navy" as const,
      basemapStyle: CARTO_FULL,
      raster: SCORE,
      selection: { features: { type: "FeatureCollection" as const, features: [] } },
    };
    const partialStack = defaultLayerStackEntries().filter((e) => e.id !== "data-raster");
    expect(() => composeStyle({ ...opts, layerStack: partialStack })).not.toThrow();

    const withPartial = composeStyle({ ...opts, layerStack: partialStack });
    const withDefault = composeStyle({ ...opts, layerStack: defaultLayerStackEntries() });

    expect(withPartial.layers.map((l) => l.id)).toEqual(withDefault.layers.map((l) => l.id));
    const idx = (s: typeof withPartial, id: string) => s.layers.findIndex((l) => l.id === id);
    expect(idx(withPartial, "r_lyr")).toBeLessThan(idx(withPartial, "selection-line"));
  });

  it("default order: every basemap sub-role (including labels) sits UNDER the raster — today's rendering", () => {
    const s = composeStyle({ theme: "navy", basemapStyle: CARTO_FULL, raster: SCORE });
    const ids = s.layers.map((l) => l.id);
    expect(ids.indexOf(`${BASEMAP_LAYER_PREFIX}place_label`)).toBeLessThan(ids.indexOf("r_lyr"));
    expect(ids.indexOf(`${BASEMAP_LAYER_PREFIX}boundary_state`)).toBeLessThan(ids.indexOf("r_lyr"));
    expect(ids.indexOf(`${BASEMAP_LAYER_PREFIX}road_major`)).toBeLessThan(ids.indexOf("r_lyr"));
  });

  it("Ben's example: moving basemap-labels above data-raster puts the label layer AFTER r_lyr in the composed order", () => {
    const stack = moveLayerStackEntry(defaultLayerStackEntries(), 4, 5); // basemap-labels <-> data-raster
    const s = composeStyle({
      theme: "navy",
      basemapStyle: CARTO_FULL,
      raster: SCORE,
      layerStack: stack,
    });
    const ids = s.layers.map((l) => l.id);
    expect(ids.indexOf(`${BASEMAP_LAYER_PREFIX}place_label`)).toBeGreaterThan(ids.indexOf("r_lyr"));
    // roads/boundaries/land did NOT move — only the moved group changed position.
    expect(ids.indexOf(`${BASEMAP_LAYER_PREFIX}road_major`)).toBeLessThan(ids.indexOf("r_lyr"));
    expect(ids.indexOf(`${BASEMAP_LAYER_PREFIX}boundary_state`)).toBeLessThan(ids.indexOf("r_lyr"));
  });

  it("`background` is always bottom regardless of the stack order passed in", () => {
    const stack = [...defaultLayerStackEntries()].reverse();
    const s = composeStyle({
      theme: "navy",
      basemapStyle: CARTO_FULL,
      raster: SCORE,
      layerStack: stack,
    });
    expect(s.layers[0].id).toBe("background");
  });

  it("hiding a group sets layout.visibility=none on every one of its layers — never removes them", () => {
    const stack = defaultLayerStackEntries().map((e) =>
      e.id === "basemap-labels" ? { ...e, visible: false } : e,
    );
    const s = composeStyle({ theme: "navy", basemapStyle: CARTO_FULL, layerStack: stack });
    const label = s.layers.find((l) => l.id === `${BASEMAP_LAYER_PREFIX}place_label`);
    expect(label).toBeDefined(); // still present
    expect(label && "layout" in label ? label.layout : null).toMatchObject({ visibility: "none" });
  });

  // B1 fix (Opus 5.5 review): the group's opacity SCALES the layer's own existing opacity, it never
  // REPLACES it — SCORE's own `opacity: SCORE_RASTER_OPACITY` (0.6) at a 0.25 stack opacity is
  // 0.6 * 0.25 = 0.15, never the bare 0.25 the old (replacing) behaviour produced. A replacing
  // implementation would also be non-monotonic (raster-opacity 0.6 at 100% stack opacity but a
  // LARGER 0.95 at a 95% stack opacity) — this fixture's own math is the regression test for that.
  it("dimming the data-raster group SCALES raster-opacity (0.6 spec x 0.25 stack = 0.15), never replaces it", () => {
    const stack = defaultLayerStackEntries().map((e) =>
      e.id === "data-raster" ? { ...e, opacity: 0.25 } : e,
    );
    const s = composeStyle({ theme: "navy", basemap: null, raster: SCORE, layerStack: stack });
    const r = s.layers.find((l) => l.id === "r_lyr");
    expect(r && "paint" in r ? r.paint : null).toMatchObject({ "raster-opacity": 0.15 });
  });

  // M5 fix (Opus 5.5 review): a REAL choropleth fill (`stops.length > 0`) classifies as role
  // "choropleth" -> group `data-raster` ("the lens's data"), NOT `data-zones` (the outline) — in
  // zone/choropleth mode the choropleth IS the visible data, and the "Data" row must control it
  // exactly like it controls the raster in cell mode. `data-zones` now only ever holds the
  // OUTLINE/labels/query-fill-placeholder, so dimming it scales the LINE alone.
  it("M5: dimming data-zones scales the outline LINE only — a real choropleth fill is data-raster's concern now", () => {
    const stack = defaultLayerStackEntries().map((e) =>
      e.id === "data-zones" ? { ...e, opacity: 0.4 } : e,
    );
    const s = composeStyle({
      theme: "navy",
      basemap: null,
      layerStack: stack,
      zones: [
        {
          ...PRA,
          fill: {
            keyProperty: "programarea_key",
            stops: [{ key: "GAA", color: "#111111" }],
            defaultColor: "lightgrey",
            opacity: 0.7,
            outlineColor: "white",
          },
        },
      ],
    });
    const fill = s.layers.find((l) => l.id === "programarea_fill");
    const line = s.layers.find((l) => l.id === "programarea_ln");
    const fillPaint = fill && "paint" in fill ? (fill.paint as Record<string, number>) : null;
    const linePaint = line && "paint" in line ? (line.paint as Record<string, number>) : null;
    // the choropleth fill is UNTOUCHED by data-zones' opacity (it belongs to data-raster now,
    // still at its own default 1 in this test) -- its own spec opacity (0.7) survives unscaled.
    expect(fillPaint?.["fill-opacity"]).toBe(0.7);
    // the line's own opacity for "programarea" is 1 (ZONE_LINE_STYLE.programarea), so 1 x 0.4 = 0.4.
    expect(linePaint?.["line-opacity"]).toBeCloseTo(0.4);
  });

  it("M5: a real choropleth fill IS scaled by dimming data-raster (the Data row), not data-zones", () => {
    const stack = defaultLayerStackEntries().map((e) =>
      e.id === "data-raster" ? { ...e, opacity: 0.4 } : e,
    );
    const s = composeStyle({
      theme: "navy",
      basemap: null,
      layerStack: stack,
      zones: [
        {
          ...PRA,
          fill: {
            keyProperty: "programarea_key",
            stops: [{ key: "GAA", color: "#111111" }],
            defaultColor: "lightgrey",
            opacity: 0.7,
            outlineColor: "white",
          },
        },
      ],
    });
    const fill = s.layers.find((l) => l.id === "programarea_fill");
    const line = s.layers.find((l) => l.id === "programarea_ln");
    const fillPaint = fill && "paint" in fill ? (fill.paint as Record<string, number>) : null;
    const linePaint = line && "paint" in line ? (line.paint as Record<string, number>) : null;
    // toBeCloseTo, not toBe: 0.7 * 0.4 floats to 0.27999999999999997 in JS, and the property under
    // test is "scaled, not replaced" -- not byte-exact float reproduction.
    expect(fillPaint?.["fill-opacity"]).toBeCloseTo(0.28);
    // the outline LINE is untouched (data-zones stays at its own default opacity 1 here).
    expect(linePaint?.["line-opacity"]).toBe(1);
  });

  it("M5: the INVISIBLE query-fill placeholder (no real fill spec) stays zone-fill/data-zones, unlike a real choropleth", () => {
    const stack = defaultLayerStackEntries().map((e) =>
      e.id === "data-zones" ? { ...e, opacity: 0.5 } : e,
    );
    const queryFillUnit = zoneUnitsFromBoot({
      units: [{ fld: "programarea_key", pmtiles: PRA.pmtiles, source_layer: "programarea" }],
    })[0];
    const s = composeStyle({
      theme: "navy",
      basemap: null,
      layerStack: stack,
      zones: [queryFillUnit],
    });
    const fill = s.layers.find((l) => l.id === "programarea_fill");
    // fill-opacity 0 x 0.5 = 0 -- scaled by data-zones (its own group), proving the placeholder is
    // classified "zone-fill", not "choropleth".
    expect(fill && "paint" in fill ? fill.paint : null).toMatchObject({ "fill-opacity": 0 });
  });

  // review round 2 ("new observation" on M5): hiding "Zone outlines" (data-zones) used to ALSO
  // hide the invisible query-fill placeholder (`layout.visibility: "none"`), which MapLibre
  // excludes from `queryRenderedFeatures` -- so zone click/pick silently stopped working the
  // moment a viewer hid the outline row, even though the placeholder was never visible anyway.
  // Decision: the query fill stays COMPOSED and queryable regardless of data-zones' own
  // visibility; `fill-opacity: 0` alone already keeps it invisible.
  it("M5 decision: hiding data-zones does NOT hide the invisible query fill -- it stays queryable (no layout.visibility)", () => {
    const stack = defaultLayerStackEntries().map((e) =>
      e.id === "data-zones" ? { ...e, visible: false } : e,
    );
    const queryFillUnit = zoneUnitsFromBoot({
      units: [{ fld: "programarea_key", pmtiles: PRA.pmtiles, source_layer: "programarea" }],
    })[0];
    const s = composeStyle({
      theme: "navy",
      basemap: null,
      layerStack: stack,
      zones: [queryFillUnit],
    });
    const fill = s.layers.find((l) => l.id === "programarea_fill");
    expect(fill).toBeDefined();
    expect((fill as { layout?: { visibility?: string } } | undefined)?.layout?.visibility).not.toBe(
      "none",
    );
    // the REAL outline line, by contrast, DOES respect data-zones' own visibility -- only the
    // always-invisible query fill gets the exception.
    const line = s.layers.find((l) => l.id === "programarea_ln");
    expect((line as { layout?: { visibility?: string } } | undefined)?.layout?.visibility).toBe(
      "none",
    );
  });

  // the OTHER half of the same decision: a REAL choropleth (unlike the query fill) is simply
  // hidden when the viewer hides "Data" (data-raster) -- no exception, since nothing else depends
  // on reading through it the way pick-mode depends on the query fill.
  it('M5 decision: hiding data-raster ("Data") DOES hide a real choropleth fill -- no exception, it is the visible data', () => {
    const stack = defaultLayerStackEntries().map((e) =>
      e.id === "data-raster" ? { ...e, visible: false } : e,
    );
    const s = composeStyle({
      theme: "navy",
      basemap: null,
      layerStack: stack,
      zones: [
        {
          ...PRA,
          fill: {
            keyProperty: "programarea_key",
            stops: [{ key: "GAA", color: "#111111" }],
            defaultColor: "lightgrey",
            opacity: 0.7,
            outlineColor: "white",
          },
        },
      ],
    });
    const fill = s.layers.find((l) => l.id === "programarea_fill");
    expect((fill as { layout?: { visibility?: string } } | undefined)?.layout?.visibility).toBe(
      "none",
    );
  });

  // B1 fix, the exact regression the review names: EVERY zone unit (including one with no `fill`
  // spec at all) carries an INVISIBLE query fill (`layers/zones.ts#queryFillFor`, B3 0.10.26:
  // `fill-opacity: 0`, `defaultColor: QUERY_FILL_COLOR` -- a near-black placeholder so pick-mode can
  // query a zone's interior). A REPLACING opacity implementation turns that `0` into the stack's own
  // opacity, painting every such zone visibly in `QUERY_FILL_COLOR` -- this asserts it stays 0 at any
  // stack opacity, using `zoneUnitsFromBoot`'s own placeholder (no explicit `fill` spec passed in).
  it("B1 regression: a zone's own INVISIBLE query fill (fill-opacity 0) stays 0 at any data-zones opacity — never painted visible", () => {
    const stack = defaultLayerStackEntries().map((e) =>
      e.id === "data-zones" ? { ...e, opacity: 0.5 } : e,
    );
    const queryFillUnit = zoneUnitsFromBoot({
      units: [{ fld: "programarea_key", pmtiles: PRA.pmtiles, source_layer: "programarea" }],
    })[0];
    expect(queryFillUnit.fill?.opacity).toBe(0); // sanity: the placeholder really is invisible
    const s = composeStyle({
      theme: "navy",
      basemap: null,
      layerStack: stack,
      zones: [queryFillUnit],
    });
    const fill = s.layers.find((l) => l.id === "programarea_fill");
    expect(fill && "paint" in fill ? fill.paint : null).toMatchObject({ "fill-opacity": 0 });
  });

  // B1 fix: the selection ring's per-CELL `["get","opacity"]` expression (places/cellSquares.ts's
  // "show analysis cells" toggle, atlas-6 Deliverable 2) must still be evaluated PER FEATURE after
  // dimming — a replacing implementation collapses it to a single flat number, losing the per-cell
  // coverage-weighted opacity entirely.
  it("B1 regression: dimming data-places wraps the per-cell cellOpacity expression, never replaces it", () => {
    const stack = defaultLayerStackEntries().map((e) =>
      e.id === "data-places" ? { ...e, opacity: 0.5 } : e,
    );
    const s = composeStyle({
      theme: "navy",
      basemap: null,
      layerStack: stack,
      selection: { features: { type: "FeatureCollection", features: [] }, cellOpacity: true },
    });
    const fill = s.layers.find((l) => l.id === "selection-fill");
    expect(fill && "paint" in fill ? fill.paint : null).toMatchObject({
      "fill-opacity": ["*", ["get", "opacity"], 0.5],
    });
  });
});

describe("rankForStack", () => {
  it("defaults to a rank consistent with the flat LAYER_ORDER's relative order", () => {
    const rank = rankForStack();
    expect(rank.get("background")).toBe(0);
    for (let i = 1; i < LAYER_ORDER.length; i++) {
      expect(rank.get(LAYER_ORDER[i])!).toBeGreaterThanOrEqual(rank.get(LAYER_ORDER[i - 1])!);
    }
    // every role is present.
    expect(new Set(rank.keys())).toEqual(new Set(LAYER_ORDER));
  });

  // M1 fix (Opus 5.5 review): the five DEFAULT basemap sub-roles are one contiguous run, so they
  // all share ONE rank -- exactly the property `orderLayers`'s stable sort then uses to reproduce
  // CARTO's own original layer order within that run (see `composeStyle`'s own M1 test below).
  it("the five basemap sub-roles share ONE rank in the default stack (one contiguous run)", () => {
    const rank = rankForStack();
    const basemapRoles: LayerRole[] = [
      "basemap-land",
      "basemap-bathymetry",
      "basemap-boundaries",
      "basemap-roads",
      "basemap-labels",
    ];
    const ranks = new Set(basemapRoles.map((r) => rank.get(r)));
    expect(ranks.size).toBe(1);
  });

  it("moving basemap-labels above data-raster SPLITS the run: labels get their OWN rank, after raster's", () => {
    const custom = moveLayerStackEntry(defaultLayerStackEntries(), 4, 5).map((e) => e.id);
    const rank = rankForStack(custom);
    expect(rank.get("basemap-labels")!).toBeGreaterThan(rank.get("raster")!);
    // the OTHER four basemap sub-roles still share one rank with each other (still one run)...
    const stillTogether: LayerRole[] = [
      "basemap-land",
      "basemap-bathymetry",
      "basemap-boundaries",
      "basemap-roads",
    ];
    expect(new Set(stillTogether.map((r) => rank.get(r))).size).toBe(1);
    // ...distinct from basemap-labels' own, now-separate rank.
    expect(rank.get("basemap-land")).not.toBe(rank.get("basemap-labels"));
  });

  it("every role from the custom stack is present, none gained or lost", () => {
    const custom = moveLayerStackEntry(defaultLayerStackEntries(), 4, 5).map((e) => e.id);
    const rank = rankForStack(custom);
    expect(new Set(rank.keys())).toEqual(new Set(LAYER_ORDER));
  });
});

describe("applyStyle", () => {
  it("calls setStyle(style, {diff:true}) — and nothing else, when the fake has no getStyle", () => {
    const setStyle = vi.fn();
    const style = composeStyle({ theme: "navy", basemap: null });
    applyStyle({ setStyle }, style);
    expect(setStyle).toHaveBeenCalledTimes(1);
    expect(setStyle).toHaveBeenCalledWith(style, { diff: true });
  });

  // P7 fix (0.10.46, "drawn places vanish from the map after the second draw"): terra-draw adds
  // its OWN `td-*` sources/layers straight to the live map (draw.ts's own header), never through
  // composeStyle -- so a plain `setStyle(diff:true)` with no knowledge of them silently deleted
  // terra-draw's own edit chrome on every recompose. `applyStyle` now reads the map's CURRENT style
  // (`getStyle()`) and preserves any `td-`-prefixed entry the new style doesn't already carry.
  it("preserves a live td-* source/layer setStyle's own composed style never mentions", () => {
    const setStyle = vi.fn();
    const current = {
      version: 8 as const,
      sources: {
        "basemap-carto": { type: "vector", tiles: ["x"] },
        "td-point": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      },
      layers: [
        { id: "basemap-carto-water", type: "background" },
        { id: "td-point", type: "circle", source: "td-point" },
      ],
    } as unknown as StyleSpecification;
    const getStyle = vi.fn(() => current);
    const next = composeStyle({ theme: "navy", basemap: null });
    applyStyle({ setStyle, getStyle }, next);

    expect(getStyle).toHaveBeenCalledTimes(1);
    const applied = setStyle.mock.calls[0][0] as StyleSpecification;
    expect(applied.sources["td-point"]).toEqual(current.sources["td-point"]);
    expect(applied.layers.at(-1)).toEqual(current.layers[1]); // appended, on top
    expect(setStyle.mock.calls[0][1]).toEqual({ diff: true });
    // nothing composeStyle itself declared moved or changed.
    expect(applied.layers.slice(0, -1)).toEqual(next.layers);
  });

  it("does not touch a td-* entry the new style already carries (no duplicate)", () => {
    const setStyle = vi.fn();
    const current = {
      version: 8 as const,
      sources: {
        "td-point": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      },
      layers: [{ id: "td-point", type: "circle", source: "td-point" }],
    } as unknown as StyleSpecification;
    const next = {
      version: 8 as const,
      sources: {
        "td-point": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      },
      layers: [{ id: "td-point", type: "circle", source: "td-point" }],
    } as unknown as StyleSpecification;
    applyStyle({ setStyle, getStyle: () => current }, next);
    expect((setStyle.mock.calls[0][0] as StyleSpecification).layers).toHaveLength(1);
  });

  it("is a no-op when nothing td-*-prefixed is live (the common case)", () => {
    const setStyle = vi.fn();
    const current = composeStyle({ theme: "navy", basemap: null });
    const next = composeStyle({ theme: "paper", basemap: null });
    applyStyle({ setStyle, getStyle: () => current }, next);
    expect(setStyle).toHaveBeenCalledWith(next, { diff: true });
  });
});

describe("preserveDrawLayers", () => {
  const emptyStyle = { version: 8 as const, sources: {}, layers: [] } as StyleSpecification;

  it("current === undefined (blank first style, or a fake with no getStyle) is a no-op", () => {
    expect(preserveDrawLayers(undefined, emptyStyle)).toBe(emptyStyle);
  });

  it("only copies entries whose id has the terra-draw prefix", () => {
    const current = {
      version: 8 as const,
      sources: {
        "not-td": { type: "geojson", data: null },
        [`${DRAW_LAYER_PREFIX}x`]: { type: "geojson", data: null },
      },
      layers: [
        { id: "not-td", type: "circle", source: "not-td" },
        { id: `${DRAW_LAYER_PREFIX}x`, type: "circle", source: `${DRAW_LAYER_PREFIX}x` },
      ],
    } as unknown as StyleSpecification;
    const result = preserveDrawLayers(current, emptyStyle);
    expect(Object.keys(result.sources)).toEqual([`${DRAW_LAYER_PREFIX}x`]);
    expect(result.layers.map((l) => l.id)).toEqual([`${DRAW_LAYER_PREFIX}x`]);
  });
});
