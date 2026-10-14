import { describe, expect, it } from "vitest";
import {
  cogFileName,
  mapFigureName,
  placesFileName,
  slugKey,
  yyyymmdd,
} from "../../src/lib/download/filename";

const CLOCK = () => new Date("2026-09-25T12:00:00Z");

describe("yyyymmdd", () => {
  it("formats UTC as YYYYMMDD with no separators", () => {
    expect(yyyymmdd(CLOCK)).toBe("20260925");
  });
});

describe("slugKey", () => {
  it("lowercases and collapses non-alphanumerics to one dash", () => {
    expect(slugKey("Sensitivity (Ecoregion Rescaled)")).toBe("sensitivity-ecoregion-rescaled");
  });

  it("strips leading/trailing dashes", () => {
    expect(slugKey("  Walrus!! ")).toBe("walrus");
  });

  it("returns an empty string for an unsanitizable label, never throws", () => {
    expect(slugKey("###")).toBe("");
  });
});

describe("mapFigureName", () => {
  it("builds the collection PNG name", () => {
    expect(mapFigureName("collection", "Richness", "v9", "png", CLOCK)).toBe(
      "oceanmetrics-atlas_collection_richness_v9_20260925.png",
    );
  });

  it("builds the species SVG name", () => {
    expect(mapFigureName("species", "Odobenus rosmarus", "v9", "svg", CLOCK)).toBe(
      "oceanmetrics-atlas_species_odobenus-rosmarus_v9_20260925.svg",
    );
  });

  it("falls back to the lens's own word when the key sanitizes to nothing", () => {
    expect(mapFigureName("species", "", "v9", "png", CLOCK)).toBe(
      "oceanmetrics-atlas_species_species_v9_20260925.png",
    );
    expect(mapFigureName("collection", "###", "v9", "png", CLOCK)).toBe(
      "oceanmetrics-atlas_collection_layer_v9_20260925.png",
    );
  });
});

describe("cogFileName", () => {
  it("keeps a metric_key verbatim", () => {
    expect(cogFileName("collection", "shark_summer_richness")).toBe(
      "oceanmetrics-atlas_collection_shark_summer_richness.tif",
    );
  });

  it("swaps `|` in a mdl_key for `-` (filesystem-unsafe on some hosts)", () => {
    expect(cogFileName("species", "am|Fis-29291")).toBe(
      "oceanmetrics-atlas_species_am-Fis-29291.tif",
    );
  });
});

describe("placesFileName", () => {
  it("names by version and date, distinct from places/download.ts's own default", () => {
    expect(placesFileName("v9", CLOCK)).toBe("oceanmetrics-atlas_places_v9_20260925.geojson");
  });
});
