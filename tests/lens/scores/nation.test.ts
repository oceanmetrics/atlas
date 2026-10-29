// v10 P6 -- the "Across the nation" mode, end to end over the v10-shaped fixture (fixtures.ts
// BOOT_V10): the flower (components from the scope, the ring at 100, a hollow petal for a component
// a zone does not report, a scale above 100), the Program-Area table (two labelled values per
// component), the legend subtitle, the tooltips -- and, beside each, that the ecoregion mode is
// exactly what it was.
import { describe, expect, it } from "vitest";
import {
  effectiveScope,
  metricLabelsFromManifest,
  scopeComponentKeys,
  scopeScaleMax,
  zoneRows,
} from "../../../src/lens/scores/boot";
import {
  cellFlowerComponents,
  zoneFlowerComponents,
  type FlowerScopeOptions,
} from "../../../src/lens/scores/flower";
import { zonesTableRows } from "../../../src/lens/scores/zonesTable";
import { cellPopupText, zonePopupText } from "../../../src/lens/scores/popup";
import { zoneTooltip } from "../../../src/lens/scores/zoneFill";
import { scoresLegendUnit, scoresMapInputs } from "../../../src/lens/scores/mapInputs";
import { legendTitle } from "../../../src/lib/map/legendTitle";
import {
  NATION_AVERAGE,
  computeFlowerGeometry,
  computeFlowerMarkRing,
  computeFlowerReferenceRing,
  nationFlowerScaleMax,
} from "../../../src/lib/ui/flowerGeometry";
import { componentMetricKeys } from "../../../src/lib/analysis/queries";
import { NOT_REPORTABLE_NOTE } from "../../../src/lib/analysis/scope";
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
};

describe("the national flower's inputs", () => {
  it("one slot per national component, in the release's order, labelled by the manifest", () => {
    const flower = zoneFlowerComponents(zoneRows(BOOT_V10, "programarea"), "ALA", NATIONAL)!;
    expect(flower.components.map((c) => [c.key, c.score, c.label])).toEqual([
      ["bird", 351.9, "Birds, across the nation"],
      ["mammal", 187, "Mammals, across the nation"],
      ["turtle", 12.5, "Sea turtles, across the nation"],
      ["primprod", 120.3, "Primary production, across the nation"],
    ]);
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
      { metricLabels: LABELS },
    );
    expect(flower.components).toEqual([
      { key: "bird", score: 210, label: "Birds, across the nation" },
      { key: "turtle", score: null, label: "Sea turtles, across the nation" },
    ]);
  });

  it("the cell SQL names only the active scope's columns", () => {
    expect(componentMetricKeys(BOOT_V10, "nation")).toEqual([
      "extrisk_bird_v10_global",
      "extrisk_mammal_v10_global",
      "extrisk_turtle_v10_global",
      "primprod_v10",
    ]);
  });
});

describe("the national flower's geometry", () => {
  const scale = nationFlowerScaleMax(scopeScaleMax(BOOT_V10, "nation"), [351.9, 187, null]);

  it("the scale is the published p99 (402.1), or the place's largest component when larger, never below 100", () => {
    expect(scale).toBe(402.1);
    expect(nationFlowerScaleMax(402.1, [999])).toBe(999);
    expect(nationFlowerScaleMax(null, [12])).toBe(NATION_AVERAGE);
    expect(nationFlowerScaleMax(50, [])).toBe(NATION_AVERAGE);
  });

  it("a score above 100 is drawn at its true radius, not clamped to the ecoregion 0-100 flower", () => {
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
    const g = computeFlowerGeometry([{ key: "bird", score: 900 }], { scaleMax: 402.1 });
    expect(g.petals[0].score).toBe(402.1);
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
    // the ring's value is signif3'd for its label ("max 402"), as the ecoregion ring's always was
    expect(ring.radius).toBeCloseTo(100, 1);
    expect(ring.value).toBe(402);
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
  const nationKeys = componentMetricKeys(BOOT_V10, "nation");
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
      ["primprod", 120.3, null], // no primprod_pct_world companion -> "—"
    ]);
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

  const state = (scope: "ecoregion" | "nation", lyr: string, unit: string) =>
    scoresMapInputs({
      boot: BOOT_V10,
      overlays: null,
      unit,
      lyr,
      scope,
      palette: "spectral_r",
      showOutsidePra: false,
      selection: null,
      metricLabels: LABELS,
    }).legend;

  it("scoresMapInputs marks the legend national only in the national scope", () => {
    expect(state("nation", V10_COMPOSITE_NATION, "cell")).toMatchObject({
      kind: "raster",
      scope: "nation",
      title: "Overall score, across the nation",
    });
    expect(state("nation", V10_COMPOSITE_NATION, "programarea")).toMatchObject({
      kind: "zone",
      scope: "nation",
    });
    expect(state("ecoregion", "extrisk_bird_ecoregion_rescaled", "cell")).not.toHaveProperty(
      "scope",
    );
  });

  it("the legend unit (card and Download footer) is x national avg only for a national layer", () => {
    expect(scoresLegendUnit(state("nation", V10_COMPOSITE_NATION, "cell"))).toBe("× national avg");
    expect(scoresLegendUnit(state("ecoregion", V10_COMPOSITE_ECOREGION, "cell"))).toBe("score");
    expect(scoresLegendUnit(null)).toBe("score");
  });

  it("a national tooltip anchors the number; an ecoregion one is the old text", () => {
    const v = { key: "GAA", name: "Gulf of America, Eastern", value: 97.97 };
    expect(zoneTooltip(v, "nation")).toBe("Gulf of America, Eastern: 98 (national avg = 100)");
    expect(zoneTooltip(v)).toBe("Gulf of America, Eastern: 98");
    expect(zoneTooltip(v, "ecoregion")).toBe("Gulf of America, Eastern: 98");
  });

  it("the popups carry the anchor in the national scope only", () => {
    const cell = { cellId: 5, lon: -90, lat: 28, layerLabel: "Birds", value: 142.4 };
    expect(cellPopupText({ ...cell, scope: "nation" })).toContain("(national avg = 100)");
    expect(cellPopupText(cell)).not.toContain("national avg");
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
