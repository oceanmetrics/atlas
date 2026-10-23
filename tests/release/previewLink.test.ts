import { describe, expect, it } from "vitest";
import {
  previewAtlasRouteEnabled,
  previewLinkFor,
  previewScoresLinkFor,
  previewSpeciesLinkFor,
} from "../../src/lib/release/previewLink";

describe("previewLinkFor (D15)", () => {
  it("path-based ver, current query + hash carried, never ?ver= on Pages", () => {
    expect(previewLinkFor("v9", { search: "?area=GA", hash: "#pl=abc" })).toBe(
      "https://preview.marinesensitivity.org/v9/atlas/?area=GA#pl=abc",
    );
  });

  it("no query/hash: a bare path", () => {
    expect(previewLinkFor("v9", { search: "", hash: "" })).toBe(
      "https://preview.marinesensitivity.org/v9/atlas/",
    );
  });

  it("a stray ?ver= in the current query is carried verbatim (harmless: path beats query)", () => {
    expect(previewLinkFor("v9", { search: "?ver=v7", hash: "" })).toBe(
      "https://preview.marinesensitivity.org/v9/atlas/?ver=v7",
    );
  });
});

// round 2, Q4 (P8 item 8, deferred): the preview-host Atlas link is gated on atlas-9 actually
// having deployed the route it points at. Builder tests for BOTH values of the flag -- the
// Playwright half (e2e/scores.versionPicker.spec.ts) only exercises the unset/default build.
describe("previewAtlasRouteEnabled (round 2, Q4)", () => {
  it('exactly "1" enables it', () => {
    expect(previewAtlasRouteEnabled("1")).toBe(true);
  });

  it("unset (undefined) fails closed", () => {
    expect(previewAtlasRouteEnabled(undefined)).toBe(false);
  });

  it('"0" fails closed', () => {
    expect(previewAtlasRouteEnabled("0")).toBe(false);
  });

  it("any other value fails closed (never guesses at a truthy-looking string)", () => {
    expect(previewAtlasRouteEnabled("true")).toBe(false);
    expect(previewAtlasRouteEnabled("yes")).toBe(false);
    expect(previewAtlasRouteEnabled("")).toBe(false);
  });
});

describe("previewScoresLinkFor / previewSpeciesLinkFor (round 2, Q4 fallback links)", () => {
  it("Scores app for a version, no query/hash (the Atlas's own params name nothing there)", () => {
    expect(previewScoresLinkFor("v9")).toBe("https://preview.marinesensitivity.org/v9/scores/");
  });

  it("Species app for a version", () => {
    expect(previewSpeciesLinkFor("v9")).toBe("https://preview.marinesensitivity.org/v9/species/");
  });
});
