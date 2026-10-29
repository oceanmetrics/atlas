// v10 P6 -- the scoring scope ("Within ecoregion" | "Across the nation") of the Scores lens: which
// layers the picker and the default belong to, how a mode switch re-targets the layer, which
// component keys feed the flower / table / cell SQL, and that a bundle with NO `scope` field (every
// v1-v9 bundle on S3) behaves exactly as before.
import { describe, expect, it } from "vitest";
import {
  compareSelPatch,
  defaultLayerKey,
  effectiveScope,
  hasNationScope,
  layerGroups,
  retargetLayerKey,
  nationFlowerScale,
  scopeComponentKeys,
} from "../../../src/lens/scores/boot";
import { effectiveLyr } from "../../../src/lens/scores/fallback";
import { componentLabel } from "../../../src/lens/scores/flower";
import { componentMetricKeys } from "../../../src/lib/analysis/queries";
import { companionKey, rowScope } from "../../../src/lib/analysis/scope";
import {
  BOOT_V10,
  BOOT_V7,
  BOOT_V9,
  V10_COMPOSITE_ECOREGION,
  V10_COMPOSITE_NATION,
} from "./fixtures";

describe("rowScope", () => {
  it("a composite/component row without `scope` is ecoregion (every bundle before msens 0.60.2)", () => {
    expect(rowScope({ category: "composite" })).toBe("ecoregion");
    expect(rowScope({ category: "component", scope: undefined })).toBe("ecoregion");
    expect(rowScope({ category: "component", scope: null })).toBe("ecoregion");
  });
  it("only the exact string 'nation' is national; an unknown value never throws", () => {
    expect(rowScope({ category: "component", scope: "nation" })).toBe("nation");
    expect(rowScope({ category: "component", scope: "galaxy" })).toBe("ecoregion");
  });
  it("a raw row has no scope at all, whatever the field says", () => {
    expect(rowScope({ category: "raw" })).toBeNull();
    expect(rowScope({ category: "raw", scope: "nation" })).toBeNull();
    expect(rowScope(null)).toBeNull();
  });
});

describe("a bundle with no `scope` field (v7, v9 on S3 today) is unchanged", () => {
  for (const [name, boot] of [
    ["v7", BOOT_V7],
    ["v9", BOOT_V9],
  ] as const) {
    it(`${name}: no national mode, and the scoped readers equal the unscoped ones`, () => {
      expect(hasNationScope(boot)).toBe(false);
      expect(effectiveScope(true, boot)).toBe("ecoregion"); // a stale ?cmp=nation is harmless
      expect(layerGroups(boot, "ecoregion")).toEqual(layerGroups(boot));
      expect(defaultLayerKey(boot, "ecoregion")).toBe(defaultLayerKey(boot));
      expect(componentMetricKeys(boot, "ecoregion")).toEqual(componentMetricKeys(boot, "all"));
      expect(effectiveLyr(undefined, boot, "ecoregion")).toBe(defaultLayerKey(boot));
    });
  }
  it("a layer of the bundle stays itself under the ecoregion scope", () => {
    expect(effectiveLyr("extrisk_bird_ecoregion_rescaled", BOOT_V7, "ecoregion")).toBe(
      "extrisk_bird_ecoregion_rescaled",
    );
    expect(effectiveLyr("primprod", BOOT_V7, "ecoregion")).toBe("primprod"); // raw
  });
});

describe("a v10-shaped bundle: two scopes", () => {
  it("has a national scope, and the mode only becomes national when asked", () => {
    expect(hasNationScope(BOOT_V10)).toBe(true);
    expect(effectiveScope(false, BOOT_V10)).toBe("ecoregion");
    expect(effectiveScope(true, BOOT_V10)).toBe("nation");
  });

  it("the picker's composite and component groups filter by scope; raw is unchanged", () => {
    const keys = (scope: "ecoregion" | "nation", category: string) =>
      layerGroups(BOOT_V10, scope)
        .find((g) => g.category === category)
        ?.layers.map((l) => l.metric_key);
    expect(keys("nation", "composite")).toEqual([V10_COMPOSITE_NATION]);
    expect(keys("ecoregion", "composite")).toEqual([V10_COMPOSITE_ECOREGION]);
    // `primprod_v10` is zone-only on a real v10 bundle: no layer, so the picker never lists it
    expect(keys("nation", "component")).toEqual([
      "extrisk_bird_v10_global",
      "extrisk_mammal_v10_global",
      "extrisk_turtle_v10_global",
    ]);
    expect(keys("ecoregion", "component")).toEqual([
      "extrisk_bird_ecoregion_rescaled",
      "extrisk_mammal_ecoregion_rescaled",
      "extrisk_turtle_ecoregion_rescaled",
      "primprod_ecoregion_rescaled",
    ]);
    expect(keys("nation", "raw")).toEqual(keys("ecoregion", "raw"));
    expect(keys("nation", "raw")).toEqual(["primprod", "extrisk_bird_pct_world"]);
  });

  it("the component group is headed by the scope", () => {
    const label = (s: "ecoregion" | "nation") =>
      layerGroups(BOOT_V10, s).find((g) => g.category === "component")?.label;
    expect(label("ecoregion")).toBe("Rescaled by ecoregion");
    expect(label("nation")).toBe("Across the nation");
  });

  it("the default layer is the first composite OF THE ACTIVE SCOPE", () => {
    expect(defaultLayerKey(BOOT_V10, "nation")).toBe(V10_COMPOSITE_NATION);
    expect(defaultLayerKey(BOOT_V10, "ecoregion")).toBe(V10_COMPOSITE_ECOREGION);
  });

  it("switching mode re-targets the layer: composite -> composite, component -> same category", () => {
    expect(retargetLayerKey(BOOT_V10, V10_COMPOSITE_ECOREGION, "nation")).toBe(
      V10_COMPOSITE_NATION,
    );
    expect(retargetLayerKey(BOOT_V10, V10_COMPOSITE_NATION, "ecoregion")).toBe(
      V10_COMPOSITE_ECOREGION,
    );
    expect(retargetLayerKey(BOOT_V10, "extrisk_bird_ecoregion_rescaled", "nation")).toBe(
      "extrisk_bird_v10_global",
    );
    // productivity: the national twin is no layer (zone-only), so the composite is the target
    expect(retargetLayerKey(BOOT_V10, "primprod_ecoregion_rescaled", "nation")).toBe(
      V10_COMPOSITE_NATION,
    );
    // a raw layer and a layer already in scope stay
    expect(retargetLayerKey(BOOT_V10, "extrisk_bird_pct_world", "nation")).toBe(
      "extrisk_bird_pct_world",
    );
    expect(retargetLayerKey(BOOT_V10, "extrisk_bird_v10_global", "nation")).toBe(
      "extrisk_bird_v10_global",
    );
    // no counterpart (an unknown key) -> the scope's composite
    expect(retargetLayerKey(BOOT_V10, "nope", "nation")).toBe(V10_COMPOSITE_NATION);
    expect(retargetLayerKey(BOOT_V10, undefined, "nation")).toBe(V10_COMPOSITE_NATION);
  });

  it("a component with no counterpart in the new scope falls to that scope's composite", () => {
    const boot = {
      layers: [
        { metric_key: "extrisk_fish_ecoregion_rescaled", category: "component", order: 1 },
        { metric_key: "extrisk_bird_v10_global", category: "component", scope: "nation", order: 2 },
        { metric_key: "s_eco", category: "composite", order: 3 },
        { metric_key: "s_nat", category: "composite", scope: "nation", order: 4 },
      ],
    };
    expect(retargetLayerKey(boot, "extrisk_fish_ecoregion_rescaled", "nation")).toBe("s_nat");
  });

  it("the Compare switch writes the mode and the re-targeted layer, but never a scope's default layer", () => {
    // composite -> the other scope's composite = that scope's default: no lyr=
    expect(compareSelPatch(BOOT_V10, V10_COMPOSITE_ECOREGION, "nation")).toEqual({
      cmp: "nation",
      lyr: undefined,
    });
    expect(compareSelPatch(BOOT_V10, V10_COMPOSITE_NATION, "ecoregion")).toEqual({
      cmp: "region",
      lyr: undefined,
    });
    // a component keeps its twin, which is not a default: it is written
    expect(compareSelPatch(BOOT_V10, "extrisk_bird_ecoregion_rescaled", "nation")).toEqual({
      cmp: "nation",
      lyr: "extrisk_bird_v10_global",
    });
  });

  it("effectiveLyr resolves a link whose lyr belongs to the other scope", () => {
    expect(effectiveLyr("extrisk_bird_ecoregion_rescaled", BOOT_V10, "nation")).toBe(
      "extrisk_bird_v10_global",
    );
    expect(effectiveLyr(undefined, BOOT_V10, "nation")).toBe(V10_COMPOSITE_NATION);
    expect(effectiveLyr(undefined, BOOT_V10, "ecoregion")).toBe(V10_COMPOSITE_ECOREGION);
    expect(effectiveLyr("nope", BOOT_V10, "nation")).toBe(V10_COMPOSITE_NATION);
  });

  it("the cell SQL reads the scope's component LAYERS; the flower and table read the wider SET", () => {
    expect(componentMetricKeys(BOOT_V10, "nation")).toEqual([
      "extrisk_bird_v10_global",
      "extrisk_mammal_v10_global",
      "extrisk_turtle_v10_global",
    ]);
    expect(componentMetricKeys(BOOT_V10)).toEqual(componentMetricKeys(BOOT_V10, "ecoregion"));
    expect(componentMetricKeys(BOOT_V10, "all")).toHaveLength(7);
    // the set adds the zone-only productivity, after the layers (a real v10 has no primprod_v10 layer)
    expect(scopeComponentKeys(BOOT_V10, "nation")).toEqual([
      "extrisk_bird_v10_global",
      "extrisk_mammal_v10_global",
      "extrisk_turtle_v10_global",
      "primprod_v10",
    ]);
    expect(scopeComponentKeys(BOOT_V10, "nation")).not.toContain("extrisk_bird_ecoregion_rescaled");
  });

  it("ONE national petal scale per release: niceCeil(max(200, p95 of the zones' component values))", () => {
    // programarea components: 142.7 63.2 88 351.9 187 12.5 120.3 -> p95 about 330 -> 500
    expect(nationFlowerScale(BOOT_V10)).toBe(500);
  });
});

describe("national component keys", () => {
  it("read as their ecoregion twins' category", () => {
    expect(componentLabel("extrisk_bird_v10_global")).toBe("bird");
    expect(componentLabel("primprod_v10")).toBe("primprod");
    expect(componentLabel("extrisk_primary_producer_v10_global")).toBe("primary producer");
    expect(componentLabel("extrisk_bird_ecoregion_rescaled")).toBe("bird");
  });
  it("companions are derived from the component key", () => {
    expect(companionKey("extrisk_bird_v10_global", "pct_world")).toBe("extrisk_bird_pct_world");
    expect(companionKey("primprod_v10", "coverage")).toBe("primprod_coverage");
    // productivity is no species range: no share of the world's
    expect(companionKey("primprod_v10", "pct_world")).toBeNull();
    expect(companionKey("extrisk_bird_ecoregion_rescaled", "pct_world")).toBeNull();
  });
});
