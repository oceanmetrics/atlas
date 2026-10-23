// The tour's stops for an h3 layer (src/shell/tourH3.ts `H3_TOUR_STEPS`, a lazy chunk; obis-hex `help/tour.ts` TOUR_STOPS that apply):
// inserted after the Collections tour's "layers" stop, each one's target stamped in the lazy h3 controls.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COLLECTION_TOUR_STEPS, tourStepsForLens } from "../../src/shell/tour";
import { H3_TOUR_STEPS } from "../../src/shell/tourH3";

describe("the tour", () => {
  it("obis stops exist and their targets are in the layer", () => {
    const controls = readFileSync("src/lens/collection/h3/H3Controls.svelte", "utf8");
    expect(H3_TOUR_STEPS.map((s) => s.id)).toEqual([
      "h3-sentence",
      "h3-layer",
      "h3-taxon",
      "h3-indicator",
      "h3-period",
      "h3-res",
      "h3-share",
    ]);
    for (const s of H3_TOUR_STEPS) {
      const m = /^\[data-tour="([^"]+)"\]$/.exec(s.element);
      expect(m, s.element).not.toBeNull();
      expect(controls).toContain(`data-tour="${m![1]}"`);
      expect(s.before).toBeTypeOf("function");
    }
  });
  it("an h3 layer's tour is the Collections tour with its stops after Layers; any other layer's is unchanged", () => {
    const ids = tourStepsForLens("collection", H3_TOUR_STEPS).map((s) => s.id);
    expect(ids).toEqual([
      "map",
      "lenses",
      "layers",
      ...H3_TOUR_STEPS.map((s) => s.id),
      "click",
      "table",
      "places",
    ]);
    expect(tourStepsForLens("collection")).toBe(COLLECTION_TOUR_STEPS);
    expect(tourStepsForLens("species", H3_TOUR_STEPS).map((s) => s.id)).not.toContain("h3-layer");
  });
});

describe("lazy", () => {
  it("the h3 stops are a dynamic import of the shell, never a static one", () => {
    const shell = readFileSync("src/shell/Shell.svelte", "utf8");
    expect(shell).toContain('(await import("./tourH3")).H3_TOUR_STEPS');
    expect(shell).not.toMatch(/import [^;]*from "\.\/tourH3"/);
  });
});
