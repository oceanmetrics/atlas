import { describe, expect, it } from "vitest";
import { zoneRows } from "../../../src/lens/scores/boot";
import { zoneChoropleth, zoneTooltip, zoneValuesFor } from "../../../src/lens/scores/zoneFill";
import { BOOT_V7 } from "./fixtures";

const COMPOSITE = "score_extriskspcat_primprod_ecoregionrescaled_equalweights";

describe("zoneValuesFor", () => {
  // V4 fix (owner phone report, 2026-09-24, docs fact-check item 3): `name` now goes through
  // `paLabel()` -- "Full Name (KEY)", the same label the Zones table already shows -- so the
  // map's own hover/click tooltip (`zoneTooltip`) agrees with it instead of reading the bare
  // published name.
  it("only zones carrying a finite value for the metric, name paLabel-formatted", () => {
    const values = zoneValuesFor(zoneRows(BOOT_V7, "programarea"), COMPOSITE);
    expect(values).toEqual([
      { key: "GAA", name: "Gulf of America, Eastern (GAA)", value: 33.09 },
      { key: "GEO", name: "Georgia (GEO)", value: 12 },
    ]);
  });

  it("a metric no zone carries: []", () => {
    expect(zoneValuesFor(zoneRows(BOOT_V7, "programarea"), "nope")).toEqual([]);
  });
});

describe("zoneChoropleth", () => {
  it("empty values: the Inf/-Inf guard — no fill, no legend, empty:true", () => {
    const out = zoneChoropleth("programarea", [], BOOT_V7, "spectral_r");
    expect(out).toEqual({ fill: null, legend: null, empty: true });
  });

  it("one stop per zone, keyProperty named for the unit, legend range rounded to 1 decimal", () => {
    const values = zoneValuesFor(zoneRows(BOOT_V7, "programarea"), COMPOSITE);
    const out = zoneChoropleth("programarea", values, BOOT_V7, "spectral_r");
    expect(out.empty).toBe(false);
    expect(out.fill!.keyProperty).toBe("programarea_key");
    expect(out.fill!.stops.map((s) => s.key)).toEqual(["GAA", "GEO"]);
    expect(out.fill!.defaultColor).toBe("lightgrey");
    expect(out.fill!.opacity).toBe(0.7);
    expect(out.legend).toEqual({
      min: 12,
      max: 33.1,
      stops: expect.arrayContaining([expect.stringMatching(/^#/)]),
    });
  });

  it("min == max: every zone gets the same (top) bin colour, never a division by zero", () => {
    const values = [
      { key: "A", name: "A", value: 10 },
      { key: "B", name: "B", value: 10 },
    ];
    const out = zoneChoropleth("programarea", values, BOOT_V7, "spectral_r");
    expect(out.fill!.stops[0].color).toBe(out.fill!.stops[1].color);
  });

  it("the 11-bin rule: exact stop colours at the low/mid/high end, pinned against boot.palettes itself", () => {
    // spectral_r's own 11 stops (BOOT_V7 fixture) — index 0 = bin 1 (lowest), index 5 = bin 6
    // (middle), index 10 = bin 11 (highest). An off-by-one in choroplethBin shifts EVERY one of
    // these to a neighbouring stop, which this pins directly rather than only checking structure.
    const stops = BOOT_V7.palettes.spectral_r;
    const values = [
      { key: "LOW", name: "LOW", value: 0 },
      { key: "MID", name: "MID", value: 50 },
      { key: "HIGH", name: "HIGH", value: 100 },
    ];
    const out = zoneChoropleth("programarea", values, BOOT_V7, "spectral_r");
    const colorOf = (key: string) => out.fill!.stops.find((s) => s.key === key)!.color;
    expect(colorOf("LOW")).toBe(stops[0]);
    expect(colorOf("MID")).toBe(stops[5]);
    expect(colorOf("HIGH")).toBe(stops[10]);
  });

  // M2 fix (docs/usability.md): picking Viridis/Cividis/Magma (no release publishes stops for
  // them, BOOT_V7's own fixture included) used to draw every zone `lightgrey` with `legend: null` —
  // a real Program Area choropleth going flat the moment the picker offered a palette no release
  // happened to publish. `zoneChoropleth` now falls back to ramps.ts's own fixed ramp.
  it("falls back to ramps.ts's own ramp when the release has not published stops for the palette", () => {
    const values = zoneValuesFor(zoneRows(BOOT_V7, "programarea"), COMPOSITE);
    const out = zoneChoropleth("programarea", values, BOOT_V7, "viridis");
    expect(out.empty).toBe(false);
    // still a real legend, with the SAME rounded range spectral_r would have produced.
    expect(out.legend).toEqual({
      min: 12,
      max: 33.1,
      stops: expect.arrayContaining([expect.stringMatching(/^#/)]),
    });
    // NOT every zone painted the flat default colour anymore -- a real (if approximate) gradient.
    expect(out.fill!.stops.every((s) => s.color === "lightgrey")).toBe(false);
    expect(new Set(out.fill!.stops.map((s) => s.color)).size).toBeGreaterThan(1);
  });
});

describe("zoneTooltip", () => {
  it('"{name}: {round(value)}" — half-even, matching R round()', () => {
    expect(zoneTooltip({ key: "GAA", name: "Gulf of America, Eastern", value: 33.09 })).toBe(
      "Gulf of America, Eastern: 33",
    );
    expect(zoneTooltip({ key: "X", name: "X", value: 2.5 })).toBe("X: 2"); // half-even, not half-up
  });
});
