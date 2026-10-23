import { describe, expect, it } from "vitest";
import { computeFlowerGeometry } from "../../src/lib/ui/flowerGeometry";
import { flowerStandaloneSvg } from "../../src/report/flowerSvg";

describe("flowerStandaloneSvg", () => {
  const geometry = computeFlowerGeometry([
    { key: "fish", score: 71 },
    { key: "turtle", score: null },
  ]);

  it("resolves every petal's CSS var color to a concrete value, and draws no petal for a no-data slot", () => {
    const svg = flowerStandaloneSvg("GAA", geometry, 42, {
      resolveColor: (name) => `#resolved(${name})`,
    });
    expect(svg).toContain("#resolved(--cat-fish)");
    expect(svg.match(/<path/g)?.length).toBe(1); // only the ONE present component
  });

  it("centre text is the caller's override (table Overall), not geometry.centerValue", () => {
    // geometry.centerValue here is 71 (the mean of the single present petal); the caller passes 42
    // (model.ts's rule: centre = round(table Overall), which can legitimately differ).
    const svg = flowerStandaloneSvg("GAA", geometry, 42, { resolveColor: () => "#000" });
    expect(svg).toContain(">42<");
    expect(svg).not.toContain(">71<");
  });

  it("prints an em dash when there is no overall at all", () => {
    const svg = flowerStandaloneSvg("GAA", geometry, null, { resolveColor: () => "#000" });
    expect(svg).toContain(">—<");
  });
});
