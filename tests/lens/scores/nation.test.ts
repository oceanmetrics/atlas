// v10 P6 -- the "Across the nation" mode, end to end over the v10-shaped fixture (fixtures.ts
// BOOT_V10): the flower (components from the scope, the ring at 100, a hollow petal for a component
// a zone does not report, a scale above 100), the Program-Area table (two labelled values per
// component), the legend subtitle, the tooltips -- and, beside each, that the ecoregion mode is
// exactly what it was.
import { describe, expect, it } from "vitest";
import {
  effectiveScope,
  metricLabelsFromManifest,
  layerScope,
  nationFlowerScale,
  scopeComponentKeys,
  zoneRows,
} from "../../../src/lens/scores/boot";
import {
  cellFlowerComponents,
  dedupeFlowerComponents,
  zoneFlowerComponents,
  type FlowerScopeOptions,
} from "../../../src/lens/scores/flower";
import { hasWorldShare, zonesTableRows } from "../../../src/lens/scores/zonesTable";
import { cellPopupText, zonePopupText } from "../../../src/lens/scores/popup";
import { effectiveLyr } from "../../../src/lens/scores/fallback";
import { scoresLegendUnit, scoresMapInputs } from "../../../src/lens/scores/mapInputs";
import { legendTitle } from "../../../src/lib/map/legendTitle";
import {
  NATION_AVERAGE,
  computeFlowerGeometry,
  computeFlowerMarkRing,
  computeFlowerReferenceRing,
  petalLabelText,
  petalTooltipText,
} from "../../../src/lib/ui/flowerGeometry";
import { componentMetricKeys } from "../../../src/lib/analysis/queries";
import {
  NOT_REPORTABLE_NOTE,
  niceCeil,
  percentile95,
  stripScopeSuffix,
} from "../../../src/lib/analysis/scope";
import {
  BOOT_V10,
  BOOT_V9,
  MANIFEST_V10,
  V10_COMPOSITE_ECOREGION,
  V10_COMPOSITE_NATION,
} from "./fixtures";

const LABELS = metricLabelsFromManifest(MANIFEST_V10);
const NATIONAL: FlowerScopeOptions = {
  scope: "nation",
  componentKeys: scopeComponentKeys(BOOT_V10, "nation"),
  metricLabels: LABELS,
  compositeKey: V10_COMPOSITE_NATION,
};

describe("the national flower's inputs", () => {
  it("one slot per national component, in the release's order, labelled by the manifest", () => {
    const flower = zoneFlowerComponents(zoneRows(BOOT_V10, "programarea"), "ALA", NATIONAL)!;
    // the mode's own words are stripped ("Birds, across the nation" -> "Birds"); the full label is the tooltip
    expect(flower.components.map((c) => [c.key, c.score, c.label, c.fullLabel])).toEqual([
      ["bird", 351.9, "Birds", "Birds, across the nation"],
      ["mammal", 187, "Mammals", "Mammals, across the nation"],
      ["turtle", 12.5, "Sea turtles", "Sea turtles, across the nation"],
      ["primprod", 120.3, "Primary production", "Primary production, across the nation"],
    ]);
  });

  it("productivity (zone-only) is in the set, and the centre is the zone's PUBLISHED composite", () => {
    const ala = zoneFlowerComponents(zoneRows(BOOT_V10, "programarea"), "ALA", NATIONAL)!;
    expect(ala.center).toBe(167.9); // not the mean of the petals
    const gaa = zoneFlowerComponents(zoneRows(BOOT_V10, "programarea"), "GAA", NATIONAL)!;
    expect(gaa.center).toBe(97.97);
    // without a composite key (or a composite value) the centre is left to the mean
    const noKey = zoneFlowerComponents(zoneRows(BOOT_V10, "programarea"), "GAA", {
      ...NATIONAL,
      compositeKey: undefined,
    })!;
    expect(noKey.center).toBeUndefined();
  });

  it("in the national scope productivity and the Flora species term are distinct, never folded", () => {
    const keys = [...NATIONAL.componentKeys, "extrisk_primary_producer_v10_global"];
    const zone = [
      {
        key: "Z",
        n_taxa: 1,
        metrics: { primprod_v10: 88, score_v10_equalweights_global: 88 } as Record<string, number>,
      },
    ];
    const flower = zoneFlowerComponents(zone, "Z", { ...NATIONAL, componentKeys: keys })!;
    const prod = flower.components.find((c) => c.key === "primprod")!;
    const flora = flower.components.find((c) => c.key === "flora")!;
    expect(prod.score).toBe(88); // present productivity is not hidden behind the absent species term
    expect(flora.score).toBeNull();
    expect(flora.color).toBe("--cat-mangrove");
    expect(flower.droppedLabels).toEqual([]);
    // and the geometry draws both without a category collision
    expect(() => computeFlowerGeometry(flower.components)).not.toThrow();
    // atlas 0.6.1: the ecoregion rule now agrees -- two components, never folded
    const eco = dedupeFlowerComponents([
      { key: "primary producer", score: null, preferred: true },
      { key: "primprod", score: 5, preferred: false },
    ]);
    expect(eco.components).toHaveLength(2);
    expect(eco.droppedLabels).toEqual([]);
  });

  it("a component the zone does not report keeps its slot: score null + the not-reportable note", () => {
    const flower = zoneFlowerComponents(zoneRows(BOOT_V10, "programarea"), "GAA", NATIONAL)!;
    const turtle = flower.components.find((c) => c.key === "turtle")!;
    expect(turtle.score).toBeNull();
    expect(turtle.note).toBe(NOT_REPORTABLE_NOTE);
    expect(NOT_REPORTABLE_NOTE).toBe("Not reportable: covers < 5 % of the area");
    expect(flower.components).toHaveLength(4); // absent is a slot, not a missing petal
  });

  it("the ecoregion flower of the same v10 bundle never sees a national key", () => {
    const flower = zoneFlowerComponents(zoneRows(BOOT_V10, "programarea"), "GAA")!;
    expect(flower.components.map((c) => c.key).sort()).toEqual([
      "bird",
      "mammal",
      "primprod",
      "turtle",
    ]);
    expect(flower.components.find((c) => c.key === "bird")!.score).toBe(59.09);
    expect(flower.components.every((c) => c.label === undefined && c.note === undefined)).toBe(
      true,
    );
  });

  it("without `national` options a bundle with no scope is read exactly as before", () => {
    const eco = zoneFlowerComponents(zoneRows(BOOT_V9, "programarea"), "ALA");
    expect(eco).toEqual(zoneFlowerComponents(zoneRows(BOOT_V9, "programarea"), "ALA", undefined));
  });

  it("a clicked cell's rows take the manifest label too, and carry no note", () => {
    const flower = cellFlowerComponents(
      [
        { metric_key: "extrisk_bird_v10_global", val: 210, component: "bird" },
        { metric_key: "extrisk_turtle_v10_global", val: null, component: "turtle" },
      ],
      { metricLabels: LABELS, center: 177 },
    );
    expect(flower.components).toEqual([
      { key: "bird", score: 210, label: "Birds", fullLabel: "Birds, across the nation" },
      {
        key: "turtle",
        score: null,
        label: "Sea turtles",
        fullLabel: "Sea turtles, across the nation",
      },
    ]);
    expect(flower.center).toBe(177); // the cell's own composite
  });

  it("the cell SQL names only the active scope's columns", () => {
    expect(componentMetricKeys(BOOT_V10, "nation")).toEqual([
      "extrisk_bird_v10_global",
      "extrisk_mammal_v10_global",
      "extrisk_turtle_v10_global",
    ]);
  });
});

describe("the national flower's geometry", () => {
  const scale = nationFlowerScale(BOOT_V10);

  it("the scale is niceCeil(max(200, p95)) of the zones' values -- one per release", () => {
    expect(scale).toBe(500);
    expect(niceCeil(1)).toBe(1);
    expect(niceCeil(201)).toBe(500);
    expect(niceCeil(500)).toBe(500);
    expect(niceCeil(501)).toBe(1000);
    expect(niceCeil(0)).toBe(1);
    expect(percentile95([1, 2, 3, 4, 5])).toBeCloseTo(4.8, 9);
    expect(percentile95([])).toBeNaN();
  });

  it("real v10 magnitudes (zones 3 to 800) give a scale where petals are not stubs; a floor of 200", () => {
    const zones = Array.from({ length: 20 }, (_, i) => ({
      key: `Z${i}`,
      n_taxa: 1,
      metrics: { extrisk_bird_v10_global: 3 + (i * 797) / 19 },
    }));
    const boot = {
      units: [{ fld: "programarea_key", label: "PA" }],
      layers: [
        { metric_key: "extrisk_bird_v10_global", category: "component", scope: "nation", order: 1 },
      ],
      zones: { programarea: zones },
    };
    expect(nationFlowerScale(boot)).toBe(1000); // p95 of 3..800 is ~760
    // a cell p99 (about 2000) or a cell's own 2.7 M never enters it
    expect(nationFlowerScale({ ...boot, zones: { programarea: zones.slice(0, 2) } })).toBe(200);
  });

  it("every place shares the scale: petal lengths are comparable between a zone and a cell", () => {
    const zone = computeFlowerGeometry([{ key: "bird", score: 250 }], { scaleMax: scale });
    const cell = computeFlowerGeometry([{ key: "bird", score: 250 }], { scaleMax: scale });
    expect(cell.petals[0].radius).toBe(zone.petals[0].radius);
    // a cell far above the scale clips; it does not shrink the other petals
    const huge = computeFlowerGeometry(
      [
        { key: "bird", score: 2_700_000 },
        { key: "mammal", score: 250 },
      ],
      { scaleMax: scale },
    );
    expect(huge.petals[1].radius).toBe(zone.petals[0].radius);
    expect(huge.petals[0].radius).toBeCloseTo(100, 9);
    expect(huge.petals[0].clipped).toEqual({ actual: 2_700_000 });
    expect(huge.petals[1].clipped).toBeUndefined();
    // the label and the tooltip carry the TRUE number, not the clamped one
    expect(petalLabelText(huge.petals[0])).toMatch(/2,?700,?000/);
  });

  it("the tooltip keeps the full label when the petal shows the short one", () => {
    const g = computeFlowerGeometry([
      { key: "bird", score: 50, label: "Birds", fullLabel: "Birds, across the nation" },
    ]);
    expect(petalLabelText(g.petals[0])).toBe("Birds: 50.0");
    expect(petalTooltipText(g.petals[0])).toBe("Birds, across the nation: 50.0");
  });

  it("the mode's words are stripped from a label and only those", () => {
    expect(stripScopeSuffix("Birds, across the nation")).toBe("Birds");
    expect(stripScopeSuffix("Primary production, across the nation")).toBe("Primary production");
    expect(stripScopeSuffix("Overall score")).toBe("Overall score");
    expect(stripScopeSuffix("Across the nation")).toBe("Across the nation"); // never to nothing
  });

  it("a score above 100 (below the scale) is drawn at its true radius, not clamped to the ecoregion 0-100 flower", () => {
    const components = [
      { key: "bird", score: 351.9 },
      { key: "mammal", score: 100 },
    ];
    const national = computeFlowerGeometry(components, { scaleMax: scale });
    const [bird, mammal] = national.petals;
    expect(bird.score).toBe(351.9);
    expect(bird.radius).toBeCloseTo(24 + (351.9 / scale) * 76, 6);
    expect(bird.radius).toBeGreaterThan(mammal.radius);
    // the ecoregion flower still clamps at 100
    const eco = computeFlowerGeometry(components);
    expect(eco.petals[0].score).toBe(100);
    expect(eco.petals[0].radius).toBeCloseTo(100, 6);
  });

  it("a score above the ceiling is clamped to the rim", () => {
    const g = computeFlowerGeometry([{ key: "bird", score: 900 }], { scaleMax: 500 });
    expect(g.petals[0].score).toBe(500);
    expect(g.petals[0].radius).toBeCloseTo(100, 6);
  });

  it("the ring at 100 sits where a petal of exactly 100 ends", () => {
    const ring = computeFlowerMarkRing(NATION_AVERAGE, { scaleMax: scale });
    const g = computeFlowerGeometry([{ key: "bird", score: 100 }], { scaleMax: scale });
    expect(ring.value).toBe(100);
    expect(ring.radius).toBeCloseTo(g.petals[0].radius, 9);
    expect(ring.radius).toBeGreaterThan(24);
    expect(ring.radius).toBeLessThan(100);
  });

  it("the outer ring marks the ceiling at the rim", () => {
    const ring = computeFlowerReferenceRing(scale, { scaleMax: scale });
    expect(ring.radius).toBeCloseTo(100, 6);
    expect(ring.value).toBe(500);
  });

  it("an absent component draws a HOLLOW slot: an outline path, no petal, out of the mean", () => {
    const flower = zoneFlowerComponents(zoneRows(BOOT_V10, "programarea"), "GAA", NATIONAL)!;
    const g = computeFlowerGeometry(flower.components, { scaleMax: scale, hollowAbsent: true });
    expect(g.petals.map((p) => p.key)).toEqual(["bird", "mammal", "primprod"]);
    expect(g.noData).toHaveLength(1);
    expect(g.noData[0].key).toBe("turtle");
    expect(g.noData[0].note).toBe(NOT_REPORTABLE_NOTE);
    expect(g.noData[0].outlinePath).toMatch(/^M /);
    // the centre is the mean of the PRESENT components: (142.7 + 63.2 + 88) / 3
    expect(g.centerValue).toBeCloseTo((142.7 + 63.2 + 88) / 3, 9);
    expect(g.sliceCount).toBe(4);
  });

  it("the ecoregion flower draws no outline for an absent slot (unchanged)", () => {
    const g = computeFlowerGeometry([
      { key: "bird", score: 50 },
      { key: "mammal", score: null },
    ]);
    expect(g.noData[0].outlinePath).toBeUndefined();
  });

  it("with scaleMax 100 the geometry is the pre-P6 geometry, byte for byte", () => {
    const comps = [
      { key: "bird", score: 56.8 },
      { key: "coral", score: 10.4 },
      { key: "fish", score: null },
      { key: "mammal", score: 100 },
    ];
    expect(computeFlowerGeometry(comps, { scaleMax: 100 })).toEqual(computeFlowerGeometry(comps));
  });
});

describe("the Program-Area table in the national scope", () => {
  // the table reads the SAME set (and order) as the flower: layers plus the zone-only productivity
  const nationKeys = scopeComponentKeys(BOOT_V10, "nation");
  const rows = zonesTableRows(zoneRows(BOOT_V10, "programarea"), V10_COMPOSITE_NATION, nationKeys, {
    nation: true,
  });

  it("ranks by the national composite", () => {
    expect(rows.map((r) => r.key)).toEqual(["ALA", "GAA"]);
    expect(rows[0].value).toBe(167.9);
  });

  it("each component carries TWO values: the quotient and the share of the world's range", () => {
    const ala = rows.find((r) => r.key === "ALA")!;
    expect(ala.components.map((c) => [c.label, c.score, c.world])).toEqual([
      ["bird", 351.9, 9.7],
      ["mammal", 187, 4.5],
      ["turtle", 12.5, 0.2],
      ["primprod", 120.3, null], // no primprod_pct_world companion
    ]);
    // so its column pair is one column: productivity has no share of the world's range
    expect(hasWorldShare("primprod_v10")).toBe(false);
    expect(hasWorldShare("extrisk_bird_v10_global")).toBe(true);
    expect(hasWorldShare(undefined)).toBe(false);
    expect(ala.components[0].key).toBe("extrisk_bird_v10_global");
  });

  it("an absent component is null (a dash), never zero", () => {
    const gaa = rows.find((r) => r.key === "GAA")!;
    const turtle = gaa.components.find((c) => c.label === "turtle")!;
    expect(turtle.score).toBeNull();
  });

  it("the ecoregion table has the old one-value shape", () => {
    const eco = zonesTableRows(
      zoneRows(BOOT_V10, "programarea"),
      "score_extriskspcat_primprod_ecoregionrescaled_equalweights",
      componentMetricKeys(BOOT_V10, "ecoregion"),
    );
    expect(eco[0].components[0]).toEqual({ label: "bird", score: expect.any(Number) });
    expect(Object.keys(eco[0].components[0]).sort()).toEqual(["label", "score"]);
  });
});

describe("the legend and the tooltips", () => {
  it("the national legend subtitle says what 100 is; the ecoregion one does not", () => {
    const nat = legendTitle({
      lens: "scores",
      branch: "raster",
      metricLabel: "Overall score, across the nation",
      nationScope: true,
      zoomRegionLabel: "All US waters",
      release: "v10",
    });
    expect(nat.subtitle).toBe("Raster cells · 100 = national average · All US waters · v10");
    const zone = legendTitle({ lens: "scores", branch: "zone", nationScope: true, release: "v10" });
    expect(zone.subtitle).toBe("Program Areas · 100 = national average · v10");
    const eco = legendTitle({ lens: "scores", branch: "raster", release: "v10" });
    expect(eco.subtitle).toBe("Raster cells · v10");
  });

  const state = (lyr: string, unit: string) =>
    scoresMapInputs({
      boot: BOOT_V10,
      overlays: null,
      unit,
      lyr,
      palette: "spectral_r",
      showOutsidePra: false,
      selection: null,
      metricLabels: LABELS,
    }).legend;

  it("the legend is national when the SELECTED LAYER is: a national composite, cells and zones", () => {
    expect(state(V10_COMPOSITE_NATION, "cell")).toMatchObject({
      kind: "raster",
      scope: "nation",
      title: "Overall score, across the nation",
    });
    expect(state(V10_COMPOSITE_NATION, "programarea")).toMatchObject({
      kind: "zone",
      scope: "nation",
    });
    expect(state("extrisk_bird_ecoregion_rescaled", "cell")).not.toHaveProperty("scope");
  });

  it("a RAW layer selected under the national mode keeps the plain unit and subtitle (label follows the layer)", () => {
    // `cmp=nation` + a raw layer: effectiveLyr keeps the raw layer, which has no scope
    for (const raw of ["primprod", "extrisk_bird_pct_world"]) {
      expect(effectiveLyr(raw, BOOT_V10, "nation")).toBe(raw);
      expect(layerScope(BOOT_V10, raw)).toBeNull();
      const legend = state(raw, "cell");
      expect(legend).not.toHaveProperty("scope");
      expect(scoresLegendUnit(legend)).toBe("score");
      const zone = state(raw, "programarea");
      expect(scoresLegendUnit(zone)).toBe("score");
    }
    expect(layerScope(BOOT_V10, V10_COMPOSITE_NATION)).toBe("nation");
    expect(layerScope(BOOT_V10, "extrisk_bird_ecoregion_rescaled")).toBe("ecoregion");
    expect(layerScope(BOOT_V10, "nope")).toBeNull();
  });

  it("the legend unit (card and Download footer) is x national avg only for a national layer", () => {
    expect(scoresLegendUnit(state(V10_COMPOSITE_NATION, "cell"))).toBe("× national avg");
    expect(scoresLegendUnit(state(V10_COMPOSITE_ECOREGION, "cell"))).toBe("score");
    expect(scoresLegendUnit(null)).toBe("score");
  });

  it("the popups carry the anchor for a national layer only", () => {
    const cell = { cellId: 5, lon: -90, lat: 28, layerLabel: "Birds", value: 142.4 };
    expect(cellPopupText({ ...cell, scope: "nation" })).toContain("(national avg = 100)");
    expect(cellPopupText(cell)).not.toContain("national avg");
    expect(cellPopupText({ ...cell, scope: "ecoregion" })).not.toContain("national avg");
    const zone = {
      zones: zoneRows(BOOT_V10, "programarea"),
      lyr: V10_COMPOSITE_NATION,
      zone: { key: "ALA", name: "Aleutian Arc" },
    };
    expect(zonePopupText({ ...zone, scope: "nation" })).toContain("(national avg = 100)");
    expect(zonePopupText(zone)).not.toContain("national avg");
  });
});

describe("effectiveScope", () => {
  it("ecoregion unless nation is asked for and published", () => {
    expect(effectiveScope(false, BOOT_V10)).toBe("ecoregion");
    expect(effectiveScope(true, BOOT_V10)).toBe("nation");
    expect(effectiveScope(true, BOOT_V9)).toBe("ecoregion");
  });
});
