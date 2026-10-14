// The hex layer: the pure feature-state mapping, the ramp expression, the style objects, the
// painter's apply/re-apply rules (a fake map records every call) and the hover/click helpers.
import { describe, expect, it } from "vitest";
import {
  HEX_FILL_ID,
  HEX_FILL_OPACITY,
  HEX_OUTSIDE_OPACITY,
  HEX_SELECTED_ID,
  HEX_SOURCE_ID,
  createHexPainter,
  fidOfFeatures,
  hexColorExpression,
  hexFeatureStates,
  hexFillLayer,
  hexHoverText,
  hexSelectedLayer,
  hexSource,
  type HexLayerSpec,
  type HexPaintMap,
} from "../../src/lib/map/layers/hex";
import { composeStyle } from "../../src/lib/map/style";
import type { ValueColumn } from "../../src/lib/catalog/values";

const SPEC: HexLayerSpec = {
  pmtiles: "https://atlas.test/atlas/biotrack_indicators/hex.pmtiles",
  sourceLayer: "hex",
  idField: "FID",
  colors: ["#000000", "#808080", "#ffffff"],
  domain: [0, 1],
};

describe("hexFeatureStates: value column -> {id, state} pairs", () => {
  it("one pair per row, state.value the item's value", () => {
    expect(hexFeatureStates({ fids: [101, 102], values: [0.5, 0.25] })).toEqual([
      { id: 101, state: { value: 0.5 } },
      { id: 102, state: { value: 0.25 } },
    ]);
  });

  it("a missing value is state null (drawn transparent), not 0", () => {
    expect(hexFeatureStates({ fids: [1], values: [null] })).toEqual([
      { id: 1, state: { value: null } },
    ]);
  });

  it("a non-finite fid is skipped; non-finite value becomes null", () => {
    expect(
      hexFeatureStates({ fids: [Number.NaN, 2], values: [1, Number.POSITIVE_INFINITY] }),
    ).toEqual([{ id: 2, state: { value: null } }]);
  });

  it("mismatched lengths use the shorter; empty is empty", () => {
    expect(hexFeatureStates({ fids: [1, 2, 3], values: [1] })).toHaveLength(1);
    expect(hexFeatureStates({ fids: [], values: [] })).toEqual([]);
  });
});

describe("hexColorExpression: feature-state value through the ramp", () => {
  it("interpolates over evenly spaced stops spanning the domain; no state -> transparent", () => {
    expect(hexColorExpression(["#000000", "#808080", "#ffffff"], [10, 20])).toEqual([
      "case",
      ["==", ["typeof", ["feature-state", "value"]], "number"],
      [
        "interpolate",
        ["linear"],
        ["feature-state", "value"],
        10,
        "#000000",
        15,
        "#808080",
        20,
        "#ffffff",
      ],
      "rgba(0,0,0,0)",
    ]);
  });

  it("a malformed ramp or domain degrades to one flat colour instead of an invalid style", () => {
    const flat = hexColorExpression(["#123456"], [0, 1]);
    expect(JSON.stringify(flat)).not.toContain("interpolate");
    const flat2 = hexColorExpression(["#000000", "#ffffff"], [5, 5]);
    expect(JSON.stringify(flat2)).not.toContain("interpolate");
  });
});

describe("the style objects", () => {
  it("the source is the PMTiles archive with promoteId: FID (feature id = FID)", () => {
    expect(hexSource(SPEC)).toEqual({
      type: "vector",
      url: `pmtiles://${SPEC.pmtiles}`,
      promoteId: "FID",
    });
  });

  it("the fill layer reads the source layer and paints by feature state", () => {
    const l = hexFillLayer(SPEC) as {
      id: string;
      source: string;
      "source-layer": string;
      paint: Record<string, unknown>;
    };
    expect(l).toMatchObject({ id: HEX_FILL_ID, source: HEX_SOURCE_ID, "source-layer": "hex" });
    expect(JSON.stringify(l.paint["fill-color"])).toContain("feature-state");
  });

  it("the selected-cell outline is zero-width unless the cell's `selected` state is set", () => {
    const l = hexSelectedLayer(SPEC) as { id: string; paint: Record<string, unknown> };
    expect(l.id).toBe(HEX_SELECTED_ID);
    expect(JSON.stringify(l.paint["line-width"])).toContain('"selected"');
  });

  it("composeStyle folds the hex source+layers into the ONE style, above the basemap and below the selection", () => {
    const s = composeStyle({
      theme: "navy",
      basemap: null,
      hex: SPEC,
      selection: { features: { type: "FeatureCollection", features: [] } },
    });
    expect(s.sources[HEX_SOURCE_ID]).toMatchObject({ type: "vector", promoteId: "FID" });
    expect(s.layers.map((l) => l.id)).toEqual([
      "background",
      HEX_FILL_ID,
      HEX_SELECTED_ID,
      "selection-fill",
      "selection-line",
    ]);
  });

  it("no hex input: nothing is composed (switching collections removes exactly the hex layers)", () => {
    const s = composeStyle({ theme: "navy", basemap: null, hex: null });
    expect(s.sources[HEX_SOURCE_ID]).toBeUndefined();
    expect(s.layers.map((l) => l.id)).toEqual(["background"]);
  });
});

/** a fake map: a `hex` source that can be present/absent/replaced, recording every state write. */
function fakeMap() {
  const calls: { id: number; state: Record<string, unknown> }[] = [];
  let source: object | null = null;
  const listeners = new Set<() => void>();
  const map: HexPaintMap = {
    getSource: (id) => (id === HEX_SOURCE_ID ? source : undefined),
    setFeatureState: (f, state) => {
      expect(f.source).toBe(HEX_SOURCE_ID);
      expect(f.sourceLayer).toBe("hex");
      calls.push({ id: f.id, state });
    },
    on: (_t, fn) => void listeners.add(fn),
    off: (_t, fn) => void listeners.delete(fn),
  };
  return {
    map,
    calls,
    listeners,
    addSource: () => {
      source = {};
      for (const l of [...listeners]) l();
    },
    replaceSource: () => {
      source = {};
      for (const l of [...listeners]) l();
    },
  };
}

const COL_A: ValueColumn = { fids: [1, 2, 3], values: [0.1, 0.2, 0.3] };
const COL_B: ValueColumn = { fids: [1, 2, 3], values: [0.9, 0.8, 0.7] };

describe("createHexPainter: feature state on a live map", () => {
  it("apply before the source exists writes nothing, then paints when the source lands (styledata)", () => {
    const f = fakeMap();
    const p = createHexPainter(f.map, "hex");
    p.apply(COL_A);
    expect(f.calls).toEqual([]);
    f.addSource();
    expect(f.calls.map((c) => c.id)).toEqual([1, 2, 3]);
    expect(f.calls[0].state).toEqual({ value: 0.1 });
  });

  it("switching items re-applies states ONLY, for the same source (the geometry is never touched)", () => {
    const f = fakeMap();
    const p = createHexPainter(f.map, "hex");
    f.addSource();
    p.apply(COL_A);
    const n = f.calls.length;
    p.apply(COL_B);
    expect(f.calls.slice(n).map((c) => c.state)).toEqual([
      { value: 0.9 },
      { value: 0.8 },
      { value: 0.7 },
    ]);
    // the same column twice is a no-op, and unrelated styledata events never re-write states
    const m = f.calls.length;
    p.apply(COL_B);
    for (const l of [...f.listeners]) l();
    expect(f.calls.length).toBe(m);
  });

  it("an FID the previous column had and the new one lacks is set to null", () => {
    const f = fakeMap();
    const p = createHexPainter(f.map, "hex");
    f.addSource();
    p.apply({ fids: [1, 2], values: [0.1, 0.2] });
    p.apply({ fids: [1], values: [0.5] });
    const last = f.calls.slice(-2);
    expect(last).toEqual([
      { id: 1, state: { value: 0.5 } },
      { id: 2, state: { value: null } },
    ]);
  });

  it("a source MapLibre re-created (a collection switch) is detected by identity and repainted", () => {
    const f = fakeMap();
    const p = createHexPainter(f.map, "hex");
    f.addSource();
    p.apply(COL_A);
    const n = f.calls.length;
    f.replaceSource();
    expect(f.calls.length).toBe(n + 3);
  });

  it("apply(null) clears the painted values", () => {
    const f = fakeMap();
    const p = createHexPainter(f.map, "hex");
    f.addSource();
    p.apply(COL_A);
    p.apply(null);
    expect(f.calls.slice(-3).every((c) => c.state.value === null)).toBe(true);
  });

  it("setSelected outlines one cell and un-outlines the previous", () => {
    const f = fakeMap();
    const p = createHexPainter(f.map, "hex");
    f.addSource();
    p.setSelected(2);
    p.setSelected(3);
    p.setSelected(null);
    expect(f.calls).toEqual([
      { id: 2, state: { selected: true } },
      { id: 2, state: { selected: false } },
      { id: 3, state: { selected: true } },
      { id: 3, state: { selected: false } },
    ]);
  });

  it("destroy stops listening", () => {
    const f = fakeMap();
    const p = createHexPainter(f.map, "hex");
    expect(f.listeners.size).toBe(1);
    p.destroy();
    expect(f.listeners.size).toBe(0);
  });
});

describe("the 'Only inside places' filter (feature state `inside`)", () => {
  const insideCalls = (f: ReturnType<typeof fakeMap>) =>
    f.calls.filter((c) => "inside" in c.state).map((c) => [c.id, c.state.inside]);

  it("the fill dims a cell whose inside state is exactly false (0.15) and leaves the rest at full opacity", () => {
    const op = (hexFillLayer(SPEC).paint as Record<string, unknown>)["fill-opacity"] as unknown[];
    expect(op[0]).toBe("case");
    expect(JSON.stringify(op[1])).toBe('["==",["feature-state","inside"],false]');
    expect(op[2]).toBe(HEX_OUTSIDE_OPACITY);
    expect(op[3]).toBe(HEX_FILL_OPACITY);
    expect(HEX_OUTSIDE_OPACITY).toBe(0.15);
  });

  it("flags every painted cell: true inside, false outside", () => {
    const f = fakeMap();
    f.addSource();
    const p = createHexPainter(f.map, "hex");
    p.apply(COL_A);
    p.setInside(new Set([2]));
    expect(insideCalls(f)).toEqual([
      [1, false],
      [2, true],
      [3, false],
    ]);
  });

  it("clearing the filter writes inside: null for every cell it flagged (the dim goes away)", () => {
    const f = fakeMap();
    f.addSource();
    const p = createHexPainter(f.map, "hex");
    p.apply(COL_A);
    p.setInside(new Set([2]));
    f.calls.length = 0;
    p.setInside(null);
    expect(insideCalls(f)).toEqual([
      [1, null],
      [2, null],
      [3, null],
    ]);
    f.calls.length = 0;
    p.setInside(null); // already clear: nothing to write
    expect(insideCalls(f)).toEqual([]);
  });

  it("switching items keeps the filter: the new column's cells are flagged too", () => {
    const f = fakeMap();
    f.addSource();
    const p = createHexPainter(f.map, "hex");
    p.apply(COL_A);
    p.setInside(new Set([1]));
    f.calls.length = 0;
    p.apply({ fids: [1, 4], values: [0.5, 0.6] });
    expect(insideCalls(f)).toEqual([
      [1, true],
      [4, false],
      [2, null],
      [3, null],
    ]);
  });

  it("a filter set before the source lands is applied when it does", () => {
    const f = fakeMap();
    const p = createHexPainter(f.map, "hex");
    p.apply(COL_A);
    p.setInside(new Set([3]));
    expect(insideCalls(f)).toEqual([]);
    f.addSource();
    expect(insideCalls(f)).toEqual([
      [1, false],
      [2, false],
      [3, true],
    ]);
  });
});

describe("hover and click helpers", () => {
  it("hexHoverText shows the cell and its value; no value reads 'no value'", () => {
    expect(hexHoverText(101, 0.4237, (v) => v.toFixed(2))).toBe("Cell 101: 0.42");
    expect(hexHoverText(101, null)).toBe("Cell 101: no value");
    expect(hexHoverText(101, undefined)).toBe("Cell 101: no value");
    expect(hexHoverText(5, 0)).toBe("Cell 5: 0"); // zero is a value
  });

  it("fidOfFeatures takes the first numeric (or numeric-string) feature id", () => {
    expect(fidOfFeatures([{ id: 7 }])).toBe(7);
    expect(fidOfFeatures([{ id: "8" }])).toBe(8);
    expect(fidOfFeatures([{ id: null }, { id: undefined }, { id: 9 }])).toBe(9);
    expect(fidOfFeatures([{ id: "abc" }])).toBeNull();
    expect(fidOfFeatures([])).toBeNull();
    expect(fidOfFeatures(undefined)).toBeNull();
  });
});

describe("the module imports no parquet reader (hyparquet stays a lazy chunk)", () => {
  it("hex.ts never statically imports hyparquet", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/map/layers/hex.ts", "utf8");
    expect(src).not.toMatch(/from\s+["']hyparquet/);
  });
});
