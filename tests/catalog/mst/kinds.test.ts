import { describe, expect, it } from "vitest";
import { mstRefOf, mstTitle } from "../../../src/lib/catalog/mst/kinds";

describe("mstRefOf: which collections are drawn as MarineSensitivity ones", () => {
  it("a v7 collection is a taxon collection keyed by its dataset", () => {
    expect(mstRefOf({ id: "msens-v7-am_0.05", group: "mst-v7" })).toEqual({
      kind: "taxon",
      dsKey: "am_0.05",
      ver: "v7",
    });
    expect(mstRefOf({ id: "msens-v7-ms_merge", group: "mst-v7" })?.dsKey).toBe("ms_merge");
  });
  it("nc and gm are the v8 dimension cubes", () => {
    expect(mstRefOf({ id: "msens-v8-nc", group: "mst-v8" })?.kind).toBe("nc");
    expect(mstRefOf({ id: "msens-v8-gm", group: "mst-v8" })?.kind).toBe("gm");
  });
  it("regression: a catalog-own collection that reuses an MST id is not hijacked", () => {
    expect(mstRefOf({ id: "msens-v8-nc", group: "oceanmetrics" })).toBeNull();
    expect(mstRefOf({ id: "msens-v7-bl", group: "oceanmetrics" })).toBeNull();
  });
  it("anything else is not MST", () => {
    expect(mstRefOf({ id: "biotrack_indicators", group: "oceanmetrics" })).toBeNull();
    expect(mstRefOf({ id: "msens-v8-other", group: "mst-v8" })).toBeNull();
    expect(mstRefOf(null)).toBeNull();
  });
});

describe("mstTitle", () => {
  it("names the downscaled AquaMaps for what it is", () => {
    expect(mstTitle("msens-v7-am_0.05", "AquaMaps SDM")).toBe(
      "AquaMaps habitat suitability (0.05 degree)",
    );
  });
  it("leaves every other STAC title alone", () => {
    expect(mstTitle("msens-v7-rng_iucn", "IUCN Range")).toBe("IUCN Range");
  });
});
