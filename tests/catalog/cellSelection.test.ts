import { describe, expect, it } from "vitest";
import { createCellSelection, type CellSelection } from "../../src/lib/catalog/cellSelection";

const SEL: CellSelection = {
  collection: "biotrack_indicators",
  item: "all_summer_richness",
  fid: 101,
  value: 0.42,
  lngLat: [-80, 25],
};

describe("cellSelection store (the contract WP3's species-list panel reads)", () => {
  it("starts empty; set/get round trip", () => {
    const s = createCellSelection();
    expect(s.get()).toBeNull();
    s.set(SEL);
    expect(s.get()).toEqual(SEL);
    s.set(null);
    expect(s.get()).toBeNull();
  });

  it("follows the Svelte store contract: subscribe calls back at once and on every set, and unsubscribes", () => {
    const s = createCellSelection();
    const seen: (CellSelection | null)[] = [];
    const off = s.subscribe((v) => seen.push(v));
    s.set(SEL);
    off();
    s.set(null);
    expect(seen).toEqual([null, SEL]); // the post-unsubscribe set is not delivered
  });

  it("a click on a cell with no value carries value: null (not 0)", () => {
    const s = createCellSelection();
    s.set({ ...SEL, value: null });
    expect(s.get()?.value).toBeNull();
  });
});
