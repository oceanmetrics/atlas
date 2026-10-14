// atlas-3: the bespoke glyphs. The flower plot has its own icon (Ben, 2026-09-21: "a simplified
// icon with a circle and radiating petals of different lengths"), so its path exists in two
// places — the committed SVG and the icon table in docs/design/spec.md that the Step 2 generator is
// built from. These assert the two can never drift, and that the path is real path data rather
// than something that merely looks like it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { glyphPathFromSpec, glyphPathFromSvg, parsePathD } from "../scripts/svg-path-core.mjs";

const FLOWER_SVG = readFileSync("src/lib/brand/glyphs/flower.svg", "utf8");
const SPEC = readFileSync("docs/design/spec.md", "utf8");

const flowerPath = glyphPathFromSvg(FLOWER_SVG);

describe("the flower glyph", () => {
  it("parses as SVG path data", () => {
    const commands = parsePathD(flowerPath);
    expect(commands.length).toBeGreaterThan(8);
    expect(commands[0].command.toLowerCase()).toBe("m");
  });

  it("is a centre circle plus eight petals of DIFFERENT lengths", () => {
    // one subpath for the hub, one per component score
    const subpaths = flowerPath.split(/(?=M)/).filter(Boolean);
    expect(subpaths).toHaveLength(9);
    // each petal's tip is its middle "Q ... x y" endpoint; they must not all be the same radius
    const radii = subpaths.slice(1).map((sp: string) => {
      const tip = sp.match(/Q[^Q]*?([\d.]+) ([\d.]+)Q/);
      const [x, y] = [Number(tip![1]), Number(tip![2])];
      return Math.round(Math.hypot(x - 12, y - 12) * 10) / 10;
    });
    expect(new Set(radii).size).toBe(8);
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(3); // "clearly different"
  });

  it("uses currentColor and no literal color, and stays inside the 24x24 box", () => {
    expect(FLOWER_SVG).toMatch(/fill="currentColor"/);
    expect(FLOWER_SVG).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(FLOWER_SVG).toMatch(/viewBox="0 0 24 24"/);
    // every ABSOLUTE coordinate sits inside the box (relative arc deltas may be negative)
    const absolute = parsePathD(flowerPath)
      .filter((c) => c.command === c.command.toUpperCase())
      .flatMap((c) => c.args);
    expect(Math.min(...absolute)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...absolute)).toBeLessThanOrEqual(24);
  });

  it("is quoted in docs/design/spec.md byte-identically (the Step 2 icon map is built from it)", () => {
    expect(glyphPathFromSpec(SPEC, "flower")).toBe(flowerPath);
  });
});

describe("the path parser can actually fail", () => {
  it("rejects a command with too few numbers", () => {
    expect(() => parsePathD("M12 12Q1 2 3")).toThrow(/needs 4 number/);
  });

  it("rejects data that does not start with a moveto", () => {
    expect(() => parsePathD("L1 2")).toThrow(/must start with a moveto/);
  });

  it("rejects a stray character", () => {
    expect(() => parsePathD("M1 2 L3 4 ?")).toThrow(/unexpected/);
  });

  it("rejects an empty path", () => {
    expect(() => parsePathD("   ")).toThrow(/empty/);
  });

  it("accepts implicit repeats and relative commands", () => {
    expect(parsePathD("m1 2l3 4 5 6z")).toHaveLength(4);
  });
});
