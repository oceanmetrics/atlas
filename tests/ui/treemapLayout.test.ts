// atlas-3 step 2b: the squarified treemap layout -- pure, synchronous, no d3 dependency (see the
// module header). Two invariants hold for ANY valid input and are asserted generically as well as
// with hand-derived fixtures: every rect's area sums to width*height, and every rect nests inside
// the container.
import { describe, expect, it } from "vitest";
import {
  describeTreemapSummary,
  formatTreemapValue,
  squarify,
  treemapPercent,
  type TreemapLeafInput,
} from "../../src/lib/ui/treemapLayout";

function totalArea(rects: { width: number; height: number }[]): number {
  return rects.reduce((s, r) => s + r.width * r.height, 0);
}

describe("squarify: base cases", () => {
  it("empty input returns no rects", () => {
    expect(squarify([], 0, 0, 100, 100)).toEqual([]);
  });

  it("a single leaf fills the entire container", () => {
    const rects = squarify([{ id: "a", value: 42 }], 0, 0, 100, 60);
    expect(rects).toEqual([{ id: "a", value: 42, x: 0, y: 0, width: 100, height: 60 }]);
  });

  it("a zero-width or zero-height container returns no rects", () => {
    expect(squarify([{ id: "a", value: 1 }], 0, 0, 0, 100)).toEqual([]);
    expect(squarify([{ id: "a", value: 1 }], 0, 0, 100, 0)).toEqual([]);
  });

  it("leaves with value <= 0 are dropped, not given zero/negative-area rects", () => {
    const rects = squarify(
      [
        { id: "a", value: 10 },
        { id: "b", value: 0 },
        { id: "c", value: -5 },
      ],
      0,
      0,
      100,
      100,
    );
    expect(rects.map((r) => r.id)).toEqual(["a"]);
  });

  it("every leaf non-positive returns no rects", () => {
    expect(
      squarify(
        [
          { id: "a", value: 0 },
          { id: "b", value: -1 },
        ],
        0,
        0,
        100,
        100,
      ),
    ).toEqual([]);
  });
});

describe("squarify: two equal-value leaves in a square container (hand-derived)", () => {
  it("splits into two equal 100x50 horizontal bands, stacked vertically", () => {
    const rects = squarify(
      [
        { id: "a", value: 50 },
        { id: "b", value: 50 },
      ],
      0,
      0,
      100,
      100,
    );
    expect(rects).toEqual([
      { id: "a", value: 50, x: 0, y: 0, width: 100, height: 50 },
      { id: "b", value: 50, x: 0, y: 50, width: 100, height: 50 },
    ]);
  });
});

describe("squarify: invariants (hold for any valid input)", () => {
  const fixtures: { name: string; leaves: TreemapLeafInput[]; w: number; h: number }[] = [
    {
      name: "4 unequal leaves",
      leaves: [
        { id: "a", value: 40 },
        { id: "b", value: 30 },
        { id: "c", value: 20 },
        { id: "d", value: 10 },
      ],
      w: 100,
      h: 60,
    },
    {
      name: "8 category-sized leaves",
      leaves: [
        { id: "bird", value: 229 },
        { id: "coral", value: 783 },
        { id: "fish", value: 6290 },
        { id: "invertebrate", value: 9424 },
        { id: "mammal", value: 75 },
        { id: "other", value: 1 },
        { id: "primprod", value: 319 },
        { id: "turtle", value: 6 },
      ],
      w: 400,
      h: 240,
    },
    {
      name: "one dominant leaf among many small ones",
      leaves: [
        { id: "a", value: 1000 },
        { id: "b", value: 1 },
        { id: "c", value: 1 },
        { id: "d", value: 1 },
        { id: "e", value: 1 },
      ],
      w: 300,
      h: 150,
    },
  ];

  for (const { name, leaves, w, h } of fixtures) {
    it(`${name}: total area equals width*height`, () => {
      const rects = squarify(leaves, 0, 0, w, h);
      expect(totalArea(rects)).toBeCloseTo(w * h, 6);
    });

    it(`${name}: every rect nests entirely inside the container`, () => {
      const rects = squarify(leaves, 10, 20, w, h); // non-zero origin, on purpose
      for (const r of rects) {
        expect(r.x).toBeGreaterThanOrEqual(10 - 1e-9);
        expect(r.y).toBeGreaterThanOrEqual(20 - 1e-9);
        expect(r.x + r.width).toBeLessThanOrEqual(10 + w + 1e-9);
        expect(r.y + r.height).toBeLessThanOrEqual(20 + h + 1e-9);
        expect(r.width).toBeGreaterThan(0);
        expect(r.height).toBeGreaterThan(0);
      }
    });

    it(`${name}: one rect per positive-value leaf, no duplicates`, () => {
      const rects = squarify(leaves, 0, 0, w, h);
      expect(new Set(rects.map((r) => r.id)).size).toBe(leaves.length);
    });
  }
});

describe("squarify: order independence (the function sorts internally)", () => {
  it("shuffling the input order produces the SAME set of rects", () => {
    const leaves: TreemapLeafInput[] = [
      { id: "a", value: 40 },
      { id: "b", value: 30 },
      { id: "c", value: 20 },
      { id: "d", value: 10 },
    ];
    const shuffled = [leaves[2], leaves[0], leaves[3], leaves[1]];
    const a = squarify(leaves, 0, 0, 100, 60);
    const b = squarify(shuffled, 0, 0, 100, 60);
    const byId = (rects: typeof a) => [...rects].sort((x, y) => x.id.localeCompare(y.id));
    expect(byId(a)).toEqual(byId(b));
  });
});

describe("formatTreemapValue", () => {
  it("rounds to 0 dp, comma-grouped — REGRESSION for G-23 (docs/parity.html)", () => {
    // the exact reported defect: a raw suit_er_area sum printed via toLocaleString()'s default
    // (up to 3 fraction digits) as "210,671,300.041". formatTreemapValue must round it away.
    expect(formatTreemapValue(210671300.041)).toBe("210,671,300");
  });

  it("an already-integer value (a literal species count) is unaffected", () => {
    expect(formatTreemapValue(9424)).toBe("9,424");
  });
});

describe("treemapPercent", () => {
  it("rounds a share to the nearest whole percent", () => {
    expect(treemapPercent(1, 3)).toBe(33);
  });

  it("a non-positive total never divides by zero — 0, not NaN/Infinity", () => {
    expect(treemapPercent(5, 0)).toBe(0);
    expect(treemapPercent(0, 0)).toBe(0);
  });
});

describe("describeTreemapSummary", () => {
  it("no leaves: a plain, unit-agnostic 'no data' sentence", () => {
    expect(describeTreemapSummary("Composition", [], "species")).toBe("Composition. No data.");
  });

  it("uses the caller's valueLabel and rounds the total — REGRESSION for G-23", () => {
    // the reported bug, reproduced: a suit_er_area sum with a fractional remainder, summed
    // across 7 categories, previously rendered "210,671,300.041 species across 7 categories".
    const leaves = [
      { label: "Fish", value: 90161001.02 },
      { label: "Invertebrate", value: 60161000.001 },
      { label: "Mammal", value: 30161000.01 },
      { label: "Coral", value: 15161000.005 },
      { label: "Bird", value: 10161000.002 },
      { label: "Turtle", value: 3161000.003 },
      { label: "Primary producer", value: 1665299.0 },
    ];
    const text = describeTreemapSummary(
      "Composition",
      leaves,
      "combined suitability x extinction-risk x area",
    );
    expect(text).not.toContain("species");
    expect(text).not.toContain(".041");
    expect(text).toContain(
      "210,631,300 combined suitability x extinction-risk x area across 7 categories",
    );
    expect(text).toContain("Fish 90,161,001 (43%)");
  });

  it("a literal species count caller (the gallery fixture) still reads naturally", () => {
    const text = describeTreemapSummary(
      "Species composition — full study area",
      [
        { label: "Invertebrate", value: 9424 },
        { label: "Fish", value: 6290 },
      ],
      "species",
    );
    expect(text).toBe(
      "Species composition — full study area. 15,714 species across 2 categories: " +
        "Invertebrate 9,424 (60%), Fish 6,290 (40%).",
    );
  });

  it("sorts leaves by descending value, independent of input order", () => {
    const text = describeTreemapSummary(
      "T",
      [
        { label: "Small", value: 1 },
        { label: "Big", value: 9 },
      ],
      "species",
    );
    expect(text).toBe("T. 10 species across 2 categories: Big 9 (90%), Small 1 (10%).");
  });
});
