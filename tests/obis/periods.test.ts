// The period strip (`atlas:period_strip`, build week 4, step 5): decades and years from `h3:periods`, each bar the
// release's count of hexagons with records at res 3 (stats.parquet), the keys, the words when it is off.
import { describe, expect, it } from "vitest";
import {
  periodBars,
  readPeriodRows,
  shortCount,
  stepPeriod,
  stripMessage,
  STRIP_RES,
} from "../../src/lens/collection/h3/periods";
import { releaseTarget } from "../../src/lens/collection/h3/view";
import { buffer, item, spec } from "./support";

const S = spec();

describe("the period strip from stats", () => {
  it("the period strip from stats: one bar per decade and year of the sets, oldest first", async () => {
    const t = releaseTarget(S, "obis_h3", item("all"))!;
    const rows = await readPeriodRows(buffer("stats.parquet"), t.periods, t.item);
    expect(rows.every((r) => r.res === STRIP_RES && r.variable === "n")).toBe(true);
    const bars = periodBars(rows, t.periods, t.item);
    expect(bars.map((b) => b.token)).toEqual([
      "1960s",
      "1970s",
      "1980s",
      "1990s",
      "2000s",
      "2010s",
      "2020s",
      "1990",
      "2015",
      "2020",
    ]);
    expect(bars.every((b) => b.cells > 0)).toBe(true);
    // heights are per grain, the largest 1
    expect(Math.max(...bars.filter((b) => b.grain === "decade").map((b) => b.height))).toBe(1);
    expect(Math.max(...bars.filter((b) => b.grain === "year").map((b) => b.height))).toBe(1);
  });
  it("an EOV reads its own rows; a layer with no rows has flat bars, not none", async () => {
    const t = releaseTarget(S, "obis_h3", item("fish"))!;
    const rows = await readPeriodRows(buffer("stats.parquet"), t.periods, t.item);
    expect(new Set(rows.map((r) => r.layer))).toEqual(new Set(["decade_eov", "year_eov"]));
    expect(rows.every((r) => r.key === "fish")).toBe(true);
    const none = periodBars([], t.periods, t.item);
    expect(none.length).toBe(10);
    expect(none.every((b) => b.cells === 0 && b.height === 0)).toBe(true);
  });
  it("a layer with no period sets reads nothing", async () => {
    expect(
      await readPeriodRows(buffer("stats.parquet"), [], { layer: "taxon", key: "Aves" }),
    ).toEqual([]);
  });
});

describe("the strip's words and keys", () => {
  it("strip message words", () => {
    expect(stripMessage({ kind: "taxon", sets: 0, label: "Aves" })).toBe(
      "Periods: all taxa and the EOVs only. Aves is shown over all years.",
    );
    expect(stripMessage({ kind: "all", sets: 2, label: "All taxa" })).toBeNull();
    expect(stripMessage({ kind: "eov", sets: 0, label: "x" })).toBe(
      "This layer publishes no periods.",
    );
  });
  it("←/→ step within a grain and stop at its ends", () => {
    const t = releaseTarget(S, "obis_h3", item("all"))!;
    const bars = periodBars([], t.periods, t.item);
    expect(stepPeriod(bars, "1990s", 1)).toBe("2000s");
    expect(stepPeriod(bars, "1960s", -1)).toBeNull();
    expect(stepPeriod(bars, "2020s", 1)).toBeNull(); // not into the years
    expect(stepPeriod(bars, "2015", 1)).toBe("2020");
  });
  it("bar labels (k, M)", () => {
    expect([12, 1234, 12345, 1234567, 12345678].map(shortCount)).toEqual([
      "12",
      "1.2k",
      "12k",
      "1.2M",
      "12M",
    ]);
  });
});
