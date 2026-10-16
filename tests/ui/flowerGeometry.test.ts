// atlas-3 step 2b: the flower plot's geometry -- equal angular widths, "absent is not zero",
// clamping, and the mean rule. Each is the seeded-fault gate for one line of docs/design/spec.md /
// the plan: "a null component drawn as a zero-length petal or counted in the mean" and "petals
// given unequal widths" must each turn one of these tests red if reintroduced.
import { describe, expect, it } from "vitest";
import {
  FLOWER_MAX_FALLBACK,
  computeFlowerGeometry,
  computeFlowerReferenceRing,
  describeFlowerSummary,
  flowerReferenceRingLabel,
  flowerViewBox,
  petalLabelText,
  sectorPath,
  type FlowerComponentInput,
} from "../../src/lib/ui/flowerGeometry";
import { categoryFor } from "../../src/lib/ui/categories";

const EIGHT: FlowerComponentInput[] = [
  { key: "bird", score: 62 },
  { key: "coral", score: 18 },
  { key: "fish", score: 40 },
  { key: "invertebrate", score: 55 },
  { key: "mammal", score: 70 },
  { key: "other", score: 5 },
  { key: "primprod", score: 33 },
  { key: "turtle", score: 12 },
];

describe("computeFlowerGeometry: petal count (7 vs 8, parity scores app.md:826-830)", () => {
  it("8 components (v8/v9): every slot is 45 degrees wide", () => {
    const g = computeFlowerGeometry(EIGHT);
    expect(g.sliceCount).toBe(8);
    expect(g.petals).toHaveLength(8);
    for (const p of g.petals) expect(p.endAngle - p.startAngle).toBeCloseTo(45, 10);
  });

  it("7 components (v7, no primprod raster component): every slot is 360/7 degrees wide", () => {
    const seven = EIGHT.slice(0, 7);
    const g = computeFlowerGeometry(seven);
    expect(g.sliceCount).toBe(7);
    expect(g.petals).toHaveLength(7);
    for (const p of g.petals) expect(p.endAngle - p.startAngle).toBeCloseTo(360 / 7, 10);
  });

  it("slots tile the full circle exactly once, with no gap or overlap", () => {
    const g = computeFlowerGeometry(EIGHT);
    expect(g.petals[0].startAngle).toBe(0);
    expect(g.petals[g.petals.length - 1].endAngle).toBeCloseTo(360, 10);
    for (let i = 1; i < g.petals.length; i++) {
      expect(g.petals[i].startAngle).toBeCloseTo(g.petals[i - 1].endAngle, 10);
    }
  });
});

describe("equal angular widths, regardless of score (the seeded fault: unequal widths)", () => {
  it("a 0-score and a 100-score petal are exactly the same angular width", () => {
    const g = computeFlowerGeometry([
      { key: "bird", score: 0 },
      { key: "coral", score: 100 },
      { key: "fish", score: 50 },
    ]);
    const widths = g.petals.map((p) => p.endAngle - p.startAngle);
    expect(widths[0]).toBeCloseTo(widths[1], 10);
    expect(widths[1]).toBeCloseTo(widths[2], 10);
    expect(widths[0]).toBeCloseTo(120, 10); // 360 / 3
  });
});

describe("a null component draws no petal ('absent is not zero')", () => {
  it("is excluded from petals[] entirely -- not a zero-length petal", () => {
    const g = computeFlowerGeometry([
      { key: "bird", score: 62 },
      { key: "coral", score: null },
      { key: "fish", score: 40 },
    ]);
    expect(g.petals.map((p) => p.key)).toEqual(["bird", "fish"]);
    expect(g.noData.map((s) => s.key)).toEqual(["coral"]);
  });

  it("still reserves its angular slot (the ring's layout does not shift)", () => {
    const g = computeFlowerGeometry([
      { key: "bird", score: 62 },
      { key: "coral", score: null },
      { key: "fish", score: 40 },
    ]);
    expect(g.sliceCount).toBe(3);
    // "fish" is slot index 2 of 3 -> [240, 360), not shifted to [120, 240) as it would be if the
    // null slot were simply dropped before computing angles
    const fish = g.petals.find((p) => p.key === "fish")!;
    expect(fish.startAngle).toBeCloseTo(240, 10);
    expect(fish.endAngle).toBeCloseTo(360, 10);
  });

  it("is NEVER counted in the mean (the seeded fault: counting a null as 0)", () => {
    const g = computeFlowerGeometry([
      { key: "bird", score: 10 },
      { key: "coral", score: null },
      { key: "fish", score: 90 },
    ]);
    // mean of the PRESENT values only: (10 + 90) / 2 = 50 -- NOT (10 + 0 + 90) / 3 = 33.33
    expect(g.centerValue).toBeCloseTo(50, 10);
  });
});

describe("all components null", () => {
  it("draws no petals and the centre value is null (not 0, not NaN)", () => {
    const g = computeFlowerGeometry([
      { key: "bird", score: null },
      { key: "coral", score: null },
    ]);
    expect(g.petals).toEqual([]);
    expect(g.noData).toHaveLength(2);
    expect(g.centerValue).toBeNull();
  });
});

describe("values clamped to 0-100", () => {
  it("clamps a score above 100 down to 100", () => {
    const g = computeFlowerGeometry([{ key: "bird", score: 150 }]);
    expect(g.petals[0].score).toBe(100);
  });

  it("clamps a negative score up to 0 (and draws no path -- degenerate, not an error)", () => {
    const g = computeFlowerGeometry([{ key: "bird", score: -10 }]);
    expect(g.petals[0].score).toBe(0);
    expect(g.petals[0].path).toBe("");
  });

  it("the mean is computed from CLAMPED values, not raw out-of-range ones", () => {
    const g = computeFlowerGeometry([
      { key: "bird", score: 150 }, // clamped to 100
      { key: "coral", score: -50 }, // clamped to 0
    ]);
    expect(g.centerValue).toBeCloseTo(50, 10);
  });
});

describe("the mean rule: centre = mean of the non-null components (even weights)", () => {
  it("with every weight equal (even = 1), weighted.mean reduces to a plain mean", () => {
    const g = computeFlowerGeometry([
      { key: "bird", score: 20 },
      { key: "coral", score: 40 },
      { key: "fish", score: 60 },
    ]);
    expect(g.centerValue).toBeCloseTo(40, 10);
  });
});

describe("computeFlowerGeometry refuses two components that share one category", () => {
  // categories.test.ts already proves "primprod" and "primary producer" resolve to the SAME
  // category (--cat-primprod) -- exactly why they must never BOTH appear as separate flower
  // components: two petals with the identical color/label is not a rendering choice, it is
  // caller data that collapsed two distinct slots onto one category (the gallery's own fixture
  // had this bug: both spellings, listed as if they were different components).
  it("throws when the two primary-producer spellings both appear", () => {
    expect(() =>
      computeFlowerGeometry([
        { key: "primprod", score: 50 },
        { key: "primary producer", score: 50 },
      ]),
    ).toThrow(/primprod.*primary producer|primary producer.*primprod/);
  });

  it("throws even when the literal raw key is repeated verbatim", () => {
    expect(() =>
      computeFlowerGeometry([
        { key: "bird", score: 10 },
        { key: "bird", score: 20 },
      ]),
    ).toThrow(/both resolve to category "bird"/);
  });

  it("does NOT throw for several unrecognized (nodata) categories -- that shape is ordinary data", () => {
    expect(() =>
      computeFlowerGeometry([
        { key: "unknown-a", score: 10 },
        { key: "unknown-b", score: 20 },
      ]),
    ).not.toThrow();
  });

  it("does not throw for the normal eight-category fixture (one of each)", () => {
    expect(() => computeFlowerGeometry(EIGHT)).not.toThrow();
  });
});

describe("sectorPath", () => {
  it("a full quarter circle (90deg, radius 10) starts and ends on the expected axis points", () => {
    const d = sectorPath(0, 0, 10, 0, 90);
    expect(d).toContain("M 0 0");
    // start at angle 0 (12 o'clock): (0, -10); end at angle 90 (3 o'clock): (10, 0)
    expect(d).toMatch(/L 0\.000 -10\.000/);
    expect(d).toMatch(/10\.000 0\.000 Z$/);
  });

  it("radius 0 draws nothing", () => {
    expect(sectorPath(0, 0, 0, 0, 90)).toBe("");
  });

  it("a span > 180deg sets the SVG large-arc-flag", () => {
    const d = sectorPath(0, 0, 10, 0, 200);
    expect(d).toMatch(/A 10 10 0 1 1/);
  });

  it("a span <= 180deg clears the large-arc-flag", () => {
    const d = sectorPath(0, 0, 10, 0, 180);
    expect(d).toMatch(/A 10 10 0 0 1/);
  });
});

describe("describeFlowerSummary (SC 1.1.1: the text summary must not contradict the mean it describes)", () => {
  // the exact seeded fault this closes: "mean 45 across 7 components" over a geometry that only
  // drew 6 petals plus one "no data" slot -- the OLD summary counted every INPUT component
  // (components.length), not the number the mean was actually averaged over.
  it("the component count is the number of DRAWN petals, never the no-data ones too", () => {
    const geometry = computeFlowerGeometry([
      { key: "bird", score: 62 },
      { key: "coral", score: null },
      { key: "fish", score: 40 },
      { key: "invertebrate", score: 55 },
      { key: "mammal", score: 70 },
      { key: "primprod", score: 33 },
      { key: "turtle", score: 12 },
    ]);
    const text = describeFlowerSummary("Program Area: GEO", geometry);
    expect(text).toContain("across 6 components");
    expect(text).not.toContain("across 7 components");
  });

  it("names the absent component in its own sentence, separate from the count", () => {
    const geometry = computeFlowerGeometry([
      { key: "bird", score: 62 },
      { key: "coral", score: null },
    ]);
    const text = describeFlowerSummary("Cell 123", geometry);
    expect(text).toContain("No data for Coral");
  });

  it("says nothing about absent components when there are none", () => {
    const geometry = computeFlowerGeometry(EIGHT);
    expect(describeFlowerSummary("Full study area", geometry)).not.toContain("No data for");
  });

  it("singular 'component' for exactly one drawn petal", () => {
    const geometry = computeFlowerGeometry([{ key: "bird", score: 62 }]);
    expect(describeFlowerSummary("Cell 1", geometry)).toContain("across 1 component:");
  });

  it("an all-null flower reports no mean and names every absent component", () => {
    const geometry = computeFlowerGeometry([
      { key: "bird", score: null },
      { key: "coral", score: null },
    ]);
    const text = describeFlowerSummary("Cell 99999", geometry);
    expect(text).toContain("Composite mean: no data");
    expect(text).toContain("Bird");
    expect(text).toContain("Coral");
  });

  it("the mean in the text is the SAME rounded value the hub renders (they read off one geometry)", () => {
    const geometry = computeFlowerGeometry([
      { key: "bird", score: 60 },
      { key: "coral", score: 61 },
    ]);
    const roundedCenter = Math.round(geometry.centerValue!);
    expect(describeFlowerSummary("Cell 1", geometry)).toContain(`mean ${roundedCenter}`);
  });
});

// atlas-4 fix round 3 (owner, phone/dark/Scores/Flower, 2026-09-24): "Flower plot should be
// centered", a stray focus rectangle, no petal values on tap/hover, values in prose instead of a
// list. `flowerViewBox`/`petalLabelText` are the two pure pieces of that fix vitest CAN exercise
// directly -- this repo's vitest runs under `environment: "node"` (vitest.config.ts), so it cannot
// render Flower.svelte itself to check the CSS centering rule or the DOM outline; those are
// e2e/scores.flower.spec.ts's job.
describe("flowerViewBox (the SVG's fixed drawing-coordinate box, independent of the `size` CSS prop)", () => {
  it("defaults to '0 0 200 200' -- outerRadius 100, matching Flower.svelte's own petal math", () => {
    expect(flowerViewBox()).toBe("0 0 200 200");
  });

  it("scales with a custom outerRadius (2x every dimension)", () => {
    expect(flowerViewBox(50)).toBe("0 0 100 100");
  });
});

describe("petalLabelText (the tap/hover/focus label -- one decimal, the SAME text as the petal's own accessible name)", () => {
  it("formats 'Category: score' with formatScore's one-decimal rule, never a raw double", () => {
    const bird = computeFlowerGeometry([{ key: "bird", score: 45.6671707107685 }]).petals[0];
    expect(petalLabelText(bird)).toBe("Bird: 45.7");
  });

  it("a whole-number score still gets exactly one decimal place ('10' -> '10.0')", () => {
    const coral = computeFlowerGeometry([{ key: "coral", score: 10 }]).petals[0];
    expect(petalLabelText(coral)).toBe("Coral: 10.0");
  });

  it("uses the category's own label, not the raw input key", () => {
    // "primary producer" normalizes to the SAME category as "primprod" (categories.ts) -- the
    // label in the text must be the canonical one ("Primary production", owner review item 8),
    // not whatever spelling the caller happened to pass in.
    const petal = computeFlowerGeometry([{ key: "primary producer", score: 5 }]).petals[0];
    expect(petalLabelText(petal)).toBe(`${categoryFor("primprod").label}: 5.0`);
  });
});

// P round deliverable 2 (Ben, live-review of 0.10.62, 2026-09-24): "needs a reference outer circle
// ... based on the maximum component score for given version". The seeded fault this guards
// against: a ring pinned at the fixed outer edge (100) regardless of `maxScore` -- `radius`/`value`
// below must move with it, not sit at the fallback.
describe("computeFlowerReferenceRing / flowerReferenceRingLabel", () => {
  it("no maxScore (null/undefined): falls back to FLOWER_MAX_FALLBACK (100), at the outer edge", () => {
    for (const maxScore of [null, undefined] as const) {
      const ring = computeFlowerReferenceRing(maxScore);
      expect(ring.isFallback).toBe(true);
      expect(ring.value).toBe(FLOWER_MAX_FALLBACK);
      expect(ring.value).toBe(100);
      expect(ring.radius).toBe(100); // innerRadius(24) + 100/100 * (100-24) = 100, the outer edge
      expect(flowerReferenceRingLabel(ring)).toBe(
        "max 100 (no published maximum for this release)",
      );
    }
  });

  it("a real maxScore: value/radius move with it (the seeded fault: pinned at 100 regardless)", () => {
    const ring = computeFlowerReferenceRing(93.456);
    expect(ring.isFallback).toBe(false);
    // signif3'd the SAME way the raster legend's own endpoints are (93.456 -> 93.5, 3 sig figs).
    expect(ring.value).toBe(93.5);
    expect(ring.radius).toBeCloseTo(24 + (93.5 / 100) * (100 - 24), 10); // 95.06
    // the property the fault breaks: a REAL, smaller-than-100 max draws a ring strictly INSIDE the
    // outer edge, never at the fallback's own radius.
    expect(ring.radius).toBeLessThan(100);
    expect(flowerReferenceRingLabel(ring)).toBe("max 93.5");
  });

  it("a non-finite or non-positive maxScore (NaN, 0, negative) also falls back, never a degenerate ring", () => {
    for (const bad of [NaN, 0, -5]) {
      expect(computeFlowerReferenceRing(bad).isFallback).toBe(true);
    }
  });

  it("respects a custom innerRadius/outerRadius (the SAME options computeFlowerGeometry takes)", () => {
    const ring = computeFlowerReferenceRing(50, { outerRadius: 50, innerRadius: 10 });
    expect(ring.radius).toBeCloseTo(10 + (50 / 100) * (50 - 10), 10); // 30
  });

  it("no petal ever draws past the ring, for a real release max -- equality at the max, strictly less below it", () => {
    const ring = computeFlowerReferenceRing(70); // EIGHT's own maximum (mammal, 70)
    const g = computeFlowerGeometry(EIGHT);
    for (const p of g.petals) expect(p.radius).toBeLessThanOrEqual(ring.radius);
    // mammal (score 70) is the max: its own petal reaches EXACTLY the ring, never past it.
    const mammal = g.petals.find((p) => p.key === "mammal")!;
    expect(mammal.radius).toBeCloseTo(ring.radius, 10);
    // and the ring itself sits strictly inside the full 100-unit edge (proving it is NOT the
    // fallback/pinned-at-100 case the seeded fault reverts to).
    expect(ring.radius).toBeLessThan(100);
  });
});
