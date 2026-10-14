// Ben's ask (round-3 review, folded in as UI-L2): the Legend should name which layer is displayed.
import { describe, expect, it } from "vitest";
import { legendChipTitle, legendTitle } from "../../../src/lib/map/legendTitle";

describe("legendTitle: collection", () => {
  it("the item's label as the title; 'collection title · value unit' as the subtitle", () => {
    expect(
      legendTitle({
        lens: "collection",
        itemLabel: "Richness of sharks, summer",
        collectionTitle: "MBON BioTrack biodiversity indicators",
        valueUnit: "unitless",
      }),
    ).toEqual({
      title: "Richness of sharks, summer",
      subtitle: "MBON BioTrack biodiversity indicators · unitless",
    });
  });

  it("a missing clause just drops, never a blank one", () => {
    expect(
      legendTitle({ lens: "collection", itemLabel: "Richness", collectionTitle: "BioTrack" }),
    ).toEqual({ title: "Richness", subtitle: "BioTrack" });
    expect(legendTitle({ lens: "collection", itemLabel: "Richness" }).subtitle).toBeNull();
  });

  it("no item label at all: falls back to 'Layer'", () => {
    expect(legendTitle({ lens: "collection" }).title).toBe("Layer");
  });
});

describe("legendTitle: species", () => {
  it("'{common} ({sci})' title, 'input · representation · semantics' subtitle", () => {
    expect(
      legendTitle({
        lens: "species",
        commonName: "Leatherback turtle",
        scientificName: "Dermochelys coriacea",
        inputLabel: "Merged model",
        representation: "raster",
        valueSemantics: "habitat suitability 1-100",
      }),
    ).toEqual({
      title: "Leatherback turtle (Dermochelys coriacea)",
      subtitle: "Merged model · raster · habitat suitability 1-100",
    });
  });

  it("only a scientific name (no common name yet): title is the binomial alone", () => {
    expect(legendTitle({ lens: "species", scientificName: "Dermochelys coriacea" }).title).toBe(
      "Dermochelys coriacea",
    );
  });

  it("no name at all: a safe fallback, never a blank/undefined title", () => {
    expect(legendTitle({ lens: "species" }).title).toBe("Species");
  });

  it("no subtitle context at all: null, not an empty string", () => {
    expect(legendTitle({ lens: "species", commonName: "Walrus" }).subtitle).toBeNull();
  });
});

describe("legendChipTitle", () => {
  it("the title alone -- the chip's short form", () => {
    expect(
      legendChipTitle({
        lens: "collection",
        itemLabel: "Richness of sharks, summer",
        collectionTitle: "BioTrack",
      }),
    ).toBe("Richness of sharks, summer");
  });
});
