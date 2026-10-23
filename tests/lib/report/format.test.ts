// The report's display formats (atlas-7 §5/§6b): "0 dp except N cells (comma)", `scales::comma`,
// `scales::percent(accuracy = 1)` on a 0-1 fraction. Display only -- nothing here feeds a number
// back into the model, which is why the CSV writes the RAW frame instead.
import { describe, expect, it } from "vitest";
import {
  formatCommonName,
  formatCount,
  formatCoveragePct,
  formatCoveragePctFloor,
  formatErScore,
  formatScore0,
  isoInstant,
  round1HalfEven,
  slugify,
  utcStamp,
} from "../../../src/lib/report/format";

describe("formatCount / formatScore0 -- comma-grouped, 0 dp", () => {
  it.each([
    [67835, "67,835"],
    [1505, "1,505"],
    [0, "0"],
    [999, "999"],
  ])("%s -> %s", (v, want) => {
    expect(formatCount(v)).toBe(want);
  });

  it("rounds a score to 0 dp", () => {
    expect(formatScore0(40.4484)).toBe("40");
    expect(formatScore0(40.5484)).toBe("41");
    expect(formatScore0(873050.8)).toBe("873,051");
  });

  it("a missing number is an empty cell, never 'NaN' or '0'", () => {
    expect(formatCount(null)).toBe("");
    expect(formatScore0(undefined)).toBe("");
    expect(formatScore0(Number.NaN)).toBe("");
  });
});

describe("formatErScore -- a 0-1 fraction as an integer percent", () => {
  it.each([
    [1, "100%"],
    [0.5, "50%"],
    [0.05, "5%"],
    [0.02, "2%"],
    [0.01, "1%"],
  ])("%s -> %s", (v, want) => {
    expect(formatErScore(v)).toBe(want);
  });
});

describe("formatCoveragePct -- the footnote's share", () => {
  it.each([
    [1, "100%"],
    [0.9987, "99.9%"],
    [0.0141, "1.4%"],
    [0.5, "50%"],
  ])("%s -> %s", (v, want) => {
    expect(formatCoveragePct(v)).toBe(want);
  });
});

// fix round 2, item 4: `formatCoveragePct(0.998740)` rounds UP to "99.9%" -- fine as a neutral
// display value, but a FALSE claim in the footnote's "scored over 99.9% of the place" sentence,
// since the place's actual 99.874% coverage does not exceed 99.9%. formatCoveragePctFloor is the
// one this sentence must use instead.
describe("formatCoveragePctFloor -- never overstates an 'over X%' claim", () => {
  it("floors 0.998740 to 99.8%, not round()'s 99.9%", () => {
    expect(formatCoveragePctFloor(0.99874)).toBe("99.8%");
    expect(formatCoveragePct(0.99874)).toBe("99.9%"); // the seeded fault, spelled out: round() lies here
  });

  it.each([
    [1, "100%"],
    [0.5, "50%"],
    [0.0141, "1.4%"],
  ])("%s -> %s (agrees with the rounded form off an exact tenth)", (v, want) => {
    expect(formatCoveragePctFloor(v)).toBe(want);
  });

  it("a missing value is empty, never '0%'", () => {
    expect(formatCoveragePctFloor(null)).toBe("");
    expect(formatCoveragePctFloor(Number.NaN)).toBe("");
  });
});

describe("round1HalfEven -- R's round(x, 1), which the map's fill value goes through", () => {
  it("rounds half to EVEN, the way R does and Math.round does not", () => {
    expect(round1HalfEven(0.25)).toBe(0.2);
    expect(round1HalfEven(0.35)).toBe(0.4);
    expect(Math.round(0.25 * 10) / 10).toBe(0.3); // the difference, spelled out
  });

  it("is ordinary rounding everywhere else", () => {
    expect(round1HalfEven(40.4484)).toBe(40.4);
    expect(round1HalfEven(40.4984)).toBe(40.5);
    expect(round1HalfEven(-3.14)).toBe(-3.1);
  });
});

// P round V5 fix (Opus eyes-on desktop-15: lowercase "great hammerhead shark"/"sicklefin devil
// ray" in the Top-20 table) -- sentence-case, not title-case: only the first letter changes, so a
// name like "great hammerhead shark" reads "Great hammerhead shark", never "Great Hammerhead Shark".
describe("formatCommonName -- sentence-cases a source common name for DISPLAY only", () => {
  it.each([
    ["great hammerhead shark", "Great hammerhead shark"],
    ["sicklefin devil ray", "Sicklefin devil ray"],
    ["Walrus", "Walrus"],
    ["", ""],
    ["  leatherback turtle  ", "Leatherback turtle"],
  ])("%o -> %o", (input, want) => {
    expect(formatCommonName(input)).toBe(want);
  });
});

describe("stamps and slugs", () => {
  const now = new Date("2026-09-22T18:04:05.123Z");

  it("the ISO instant drops milliseconds", () => {
    expect(isoInstant(now)).toBe("2026-09-22T18:04:05Z");
  });

  it("the header stamp names UTC explicitly", () => {
    expect(utcStamp(now)).toBe("2026-09-22 18:04 UTC");
  });

  it.each([
    ["Gulf of America draft", "gulf-of-america-draft"],
    ["  Spaces  &  symbols!  ", "spaces-symbols"],
    ["", "report"],
    ["!!!", "report"],
  ])("slugify(%o) -> %o", (input, want) => {
    expect(slugify(input)).toBe(want);
  });
});
