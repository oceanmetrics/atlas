import { describe, expect, it } from "vitest";
import { effectiveLyr, effectiveUnit } from "../../../src/lens/scores/fallback";
import { BOOT_V7 } from "./fixtures";

describe("effectiveUnit — the unknown-unit gate", () => {
  it("cell always passes through", () => {
    expect(effectiveUnit("cell", BOOT_V7)).toBe("cell");
  });

  it("the release's own unit passes through", () => {
    expect(effectiveUnit("programarea", BOOT_V7)).toBe("programarea");
  });

  it("an unknown/retired unit falls back to cell, never a blank map", () => {
    expect(effectiveUnit("ecoregion", BOOT_V7)).toBe("cell");
    expect(effectiveUnit("subregion", BOOT_V7)).toBe("cell");
    expect(effectiveUnit("bogus", BOOT_V7)).toBe("cell");
  });
});

describe("effectiveLyr — the unknown-layer gate", () => {
  it("a real metric_key passes through", () => {
    expect(effectiveLyr("primprod", BOOT_V7)).toBe("primprod");
  });

  it("an unknown layer falls back to the composite default", () => {
    expect(effectiveLyr("not-a-real-metric", BOOT_V7)).toBe(
      "score_extriskspcat_primprod_ecoregionrescaled_equalweights",
    );
  });

  it("undefined falls back to the composite default", () => {
    expect(effectiveLyr(undefined, BOOT_V7)).toBe(
      "score_extriskspcat_primprod_ecoregionrescaled_equalweights",
    );
  });
});
