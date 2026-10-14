import { describe, expect, it } from "vitest";
import { creditsOf } from "../../../src/lib/catalog/credits";
import { licenseModelOf } from "../../../src/lib/catalog/licenses";
import { noteFromText, noteOf } from "../../../src/lib/catalog/note";
import {
  AM005_COLLECTION_URL,
  AQUAMAPS_ATTRIBUTION,
  CC_BY_NC_3_URL,
  downscaledCredits,
  registryAttribution,
  withCitedLicense,
} from "../../../src/lib/catalog/registry/credits";
import { buildCard, taxaCountOf } from "../../../src/catalog/model";
import type { CollectionEntry } from "../../../src/lib/catalog/load";
import type { StacCollection } from "../../../src/lib/catalog/types";
import { am005Collection, nativeCollection } from "./support";

describe("the note rendering helper (atlas:note)", () => {
  it("AquaMaps' note is present and flagged non-commercial", () => {
    const n = noteOf(nativeCollection())!;
    expect(n.text).toMatch(/^Non-commercial use only \(CC BY-NC 3\.0\)/);
    expect(n.nonCommercial).toBe(true);
  });
  it("collapses whitespace; a note about something else is not flagged", () => {
    expect(noteFromText("  Prototype\n  data  ")).toEqual({
      text: "Prototype data",
      nonCommercial: false,
    });
    expect(noteFromText("Noncommercial only")?.nonCommercial).toBe(true);
    expect(noteFromText("non commercial")?.nonCommercial).toBe(true);
  });
  it("absent, blank or non-string -> null", () => {
    expect(noteOf(null)).toBeNull();
    expect(noteOf({ type: "Collection", id: "x", links: [] })).toBeNull();
    expect(noteFromText("   ")).toBeNull();
    expect(noteFromText(5)).toBeNull();
  });
  it("the credits strip and the License modal carry it", () => {
    const c = nativeCollection();
    expect(creditsOf(c).note?.text).toBe(noteOf(c)!.text);
    expect(licenseModelOf(c)?.note).toBe(noteOf(c)!.text);
    expect(creditsOf({ type: "Collection", id: "x", links: [] }).note).toBeNull();
    expect(licenseModelOf({ ...c, "atlas:note": undefined })?.note).toBeNull();
  });
  it("the catalog card shows the note and the taxa count, not `0 items`", () => {
    const entry: CollectionEntry = {
      id: "aquamaps_native",
      title: "AquaMaps native",
      href: "https://x.test/aquamaps_native/collection.json",
      group: "oceanmetrics",
      external: false,
      status: "ok",
      collection: nativeCollection(),
      error: null,
    };
    const card = buildCard(entry);
    expect(card.taxaCount).toBe(17499);
    expect(card.credits?.note?.nonCommercial).toBe(true);
    expect(card.openInMap).toBe("./index.html?c=aquamaps_native");
  });
  it("taxaCountOf: summaries first, then the registry's row_count, else null", () => {
    const c = nativeCollection();
    expect(taxaCountOf(c)).toBe(17499);
    expect(taxaCountOf({ ...c, summaries: { "atlas:taxa": [12] } })).toBe(12);
    expect(taxaCountOf({ ...c, summaries: {} })).toBe(17499);
    expect(taxaCountOf({ type: "Collection", id: "x", links: [] })).toBeNull();
  });
});

describe("map attribution", () => {
  it("names AquaMaps and the license while the layer is on, nothing otherwise", () => {
    expect(AQUAMAPS_ATTRIBUTION).toBe("AquaMaps (Kaschner et al. 2019), CC BY-NC 3.0");
    expect(registryAttribution(true)).toBe(AQUAMAPS_ATTRIBUTION);
    expect(registryAttribution(false)).toBeNull();
  });
});

describe("credits for the downscaled surface (MarineSensitivity v7 am_0.05)", () => {
  it("the MST collection's license field contradicts its citation (the defect this works around)", () => {
    const am = am005Collection();
    expect(am.license).toBe("CC-BY-4.0");
    expect(am["sci:citation"]).toMatch(/Attribution-NonCommercial 3\.0/);
    expect(AM005_COLLECTION_URL).toBe(am["atlas:url"]);
  });
  it("shows the citation's CC BY-NC 3.0 license, with a license link to the legal code", () => {
    const c = withCitedLicense(am005Collection());
    expect(c.license).toBe("CC-BY-NC-3.0");
    expect(c.links.filter((l) => l.rel === "license")).toEqual([
      expect.objectContaining({ href: CC_BY_NC_3_URL }),
    ]);
    expect(licenseModelOf(c)?.info.id).toBe("CC-BY-NC-3.0");
  });
  it("a citation that does not say NonCommercial leaves the license alone; an NC license stays", () => {
    const plain = { ...am005Collection(), "sci:citation": "Someone (2020)." };
    expect(withCitedLicense(plain).license).toBe("CC-BY-4.0");
    const nc = { ...nativeCollection() };
    expect(withCitedLicense(nc)).toBe(nc);
  });
  it("the credits of the 0.05 surface: MST's citation, the NC license, the native note, a clear title", () => {
    const credits = creditsOf(downscaledCredits(am005Collection(), nativeCollection()));
    expect(credits.citation).toMatch(/AquaMaps: Predicted range maps/);
    expect(credits.license).toBe("CC-BY-NC-3.0");
    expect(credits.note?.nonCommercial).toBe(true);
    expect(credits.title).toMatch(/downscaled 0\.05 degree/);
  });
  it("with no citation of its own it borrows the native collection's", () => {
    const am: StacCollection = { ...am005Collection() };
    delete am["sci:citation"];
    expect(creditsOf(downscaledCredits(am, nativeCollection())).citation).toMatch(/Kaschner/);
  });
});
