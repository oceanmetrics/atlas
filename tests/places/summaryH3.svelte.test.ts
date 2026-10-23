// The Places tool on an h3 layer (the OBIS layer's place filter, build week 4 step 5): the "Only inside places"
// switch is offered, its line says what the filter keeps, and the summary says where the numbers are (the layer's
// panel, the Place page) instead of "Pick a layer the map can draw". The REAL summaries store (runes project).
import { flushSync } from "svelte";
import { describe, expect, it } from "vitest";
import { createPlaceSummaries, type SummaryLens } from "../../src/places/summary.svelte";

const { createSelStore } = await import("../../src/lib/state/sel.svelte");

function lens(drawsH3: boolean): SummaryLens {
  return {
    entry: null,
    item: null,
    itemTitle: null,
    mapInputs: { hex: null, cogUrl: null, cogBidx: null } as never,
    values: null,
    valuesLoading: false,
    drawsH3,
  } as unknown as SummaryLens;
}
const placesMap = { gazGeometry: () => undefined, gazEntry: () => undefined };

describe("the place summaries on an h3 layer", () => {
  it("offers the filter and says where the numbers are", () => {
    const selStore = createSelStore({
      search: "?c=obis_h3&filter=places",
      hash: "",
      pathname: "/",
    });
    let s!: ReturnType<typeof createPlaceSummaries>;
    const stop = $effect.root(() => {
      s = createPlaceSummaries({ selStore, lens: lens(true), placesMap: placesMap as never });
    });
    flushSync();
    expect(s.h3).toBe(true);
    expect(s.filterOn).toBe(true);
    expect(s.unavailable).toMatch(
      /^This layer is summarised per hexagon: turn on “Only inside places”/,
    );
    expect(s.filterNote).toBe("Add a place to see its hexagons.");
    stop();
  });
  it("any other layer keeps its own words", () => {
    const selStore = createSelStore({ search: "?filter=places", hash: "", pathname: "/" });
    let s!: ReturnType<typeof createPlaceSummaries>;
    const stop = $effect.root(() => {
      s = createPlaceSummaries({ selStore, lens: lens(false), placesMap: placesMap as never });
    });
    flushSync();
    expect(s.h3).toBe(false);
    expect(s.unavailable).toBe("Pick a layer the map can draw to summarise it over your places.");
    expect(s.filterNote).toBe("The filter works on hex-grid layers; this layer isn't one.");
    stop();
  });
});
