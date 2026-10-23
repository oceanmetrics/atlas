// The OBIS layer's colours and legend (build week 4, step 5): viridis over the release's p02 to p98 of the layer,
// period, resolution and indicator (stats.parquet), records on a log scale, ES(50) under 50 records not drawn.
import { describe, expect, it } from "vitest";
import {
  interpolateColors,
  readReleaseStats,
  releaseFilter,
  releaseLayer,
  type StatsRow,
} from "@oceanmetrics/map";
import {
  domainAt,
  h3FillColor,
  legendStops,
  legendSubtitle,
  RAMP_STOPS,
  resAtZoom,
  scaleOf,
} from "../../src/lens/collection/h3/paint";
import { releaseTarget } from "../../src/lens/collection/h3/view";
import { item, localFetch, REL, spec } from "./support";

const S = spec();
const rowsOf = async (layer: string, key = "") =>
  readReleaseStats(
    `${REL}stats.parquet`,
    { layer, key, rank: "", period: null },
    { fetch: localFetch() },
  );
const layer = (res: "auto" | number = "auto") =>
  releaseLayer(releaseTarget(S, "obis_h3", item("all"))!.collection, { res });

describe("the legend's source is stats.parquet", () => {
  it("domain from stats: p02 to p98 of the resolution and indicator", async () => {
    const rows = await rowsOf("all");
    expect(domainAt(rows, "es", 2)).toEqual([4.242509752375761, 47.2920844926707]);
    expect(domainAt(rows, "n", 2)).toEqual([4, 216050.4199999988]);
    expect(domainAt(rows, "es", 9)).toBeNull();
    expect(domainAt(null, "es", 2)).toBeNull();
  });
  it("min to max when the quantiles meet; a log domain starts at 1", () => {
    const rows: StatsRow[] = [
      { res: 3, variable: "es", min: 2, p02: 5, p50: 5, p98: 5, max: 9, n_cells: 3 },
      { res: 3, variable: "n", min: 0, p02: 0, p50: 1, p98: 50, max: 90, n_cells: 3 },
    ];
    expect(domainAt(rows, "es", 3)).toEqual([2, 9]);
    expect(domainAt(rows, "n", 3)).toEqual([1, 50]);
  });
});

describe("the fill", () => {
  it("viridis stops and clamp: nine stops from #440154 to #FDE725 over [p02, p98]", async () => {
    const rows = await rowsOf("all");
    const fill = h3FillColor(layer(2), "es", rows) as unknown[];
    expect(fill[0]).toBe("interpolate");
    expect(fill[2]).toEqual(["to-number", ["get", "es"]]);
    const stops = fill.slice(3);
    expect(stops.length).toBe(RAMP_STOPS * 2);
    expect(stops[0]).toBeCloseTo(4.2425, 3);
    expect(stops[1]).toBe(interpolateColors(RAMP_STOPS, "viridis")[0]);
    expect(String(stops[1]).toLowerCase()).toBe("#440154");
    expect(String(stops[stops.length - 1]).toLowerCase()).toBe("#fde725");
    expect(stops[stops.length - 2]).toBeCloseTo(47.292, 2);
  });
  it("records on a log scale: the ramp is on ln n over [ln p02, ln p98]", async () => {
    const rows = await rowsOf("all");
    const fill = h3FillColor(layer(2), "n", rows) as unknown[];
    expect(scaleOf("n")).toBe("log");
    expect(fill[2]).toEqual(["ln", ["max", ["to-number", ["get", "n"]], 1]]);
    expect(fill[3]).toBeCloseTo(Math.log(4), 9);
    expect(fill[3 + 2 * (RAMP_STOPS - 1)]).toBeCloseTo(Math.log(216050.4199999988), 9);
    // the other four stay linear
    for (const i of ["es", "sp", "shannon", "simpson"]) expect(scaleOf(i)).toBe("linear");
  });
  it("auto is a step on the zoom, each resolution on its own domain (the release's ladder, no roll-up)", async () => {
    const rows = await rowsOf("all");
    const fill = h3FillColor(layer("auto"), "es", rows) as unknown[];
    expect(fill[0]).toBe("step");
    expect(fill[1]).toEqual(["zoom"]);
    // zoom 3 starts res 2, zoom 4 res 3 (obis-hex's breaks on the tile zoom)
    const zooms = fill.slice(3).filter((_, i) => i % 2 === 0);
    expect(zooms).toEqual([3, 4, 5, 6, 7, 9]);
    const res2 = fill[4] as unknown[];
    expect(res2[3]).toBeCloseTo(4.2425, 3);
  });
  it("the resolution drawn at a zoom: auto by the breaks, the pin whatever the zoom", () => {
    expect([0, 2, 3, 4, 5, 6, 7, 8, 9, 12].map((z) => resAtZoom(layer(), z))).toEqual([
      1, 1, 2, 3, 4, 5, 6, 6, 7, 7,
    ]);
    expect(resAtZoom(layer(4), 9)).toBe(4);
  });
  it("null cells are transparent: a hexagon without the indicator is filtered out", () => {
    expect(releaseFilter("es")).toEqual(["has", "es"]);
  });
});

describe("the legend", () => {
  it("nine stops coloured as the map; geometric for records", () => {
    const lin = legendStops([0, 40], "es");
    expect(lin.map((s) => s.value)).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40]);
    const log = legendStops([1, 1e8], "n");
    expect(log[0].value).toBeCloseTo(1);
    expect(log[4].value).toBeCloseTo(1e4, 0);
    expect(log[8].value).toBeCloseTo(1e8, -2);
    expect(log.map((s) => s.color)).toEqual(lin.map((s) => s.color));
  });
  it("the subtitle says which domain, the resolution rule and the scale", () => {
    expect(legendSubtitle({ period: "All years", res: 3, auto: true, indicator: "es" })).toBe(
      "All years · release p02–p98 · res 3 (auto)",
    );
    expect(legendSubtitle({ period: "1990s", res: 4, auto: false, indicator: "n" })).toBe(
      "1990s · release p02–p98 · res 4 (fixed) · log scale",
    );
  });
});

describe("the loaded hexagons' domain (dom=view)", () => {
  it("view domain equals duckdb quantile_cont", async () => {
    const { quantileSorted, viewDomain } = await import("../../src/lens/collection/h3/share");
    // duckdb: SELECT quantile_cont(x, 0.02), quantile_cont(x, 0.98) FROM (SELECT unnest([...]::DOUBLE[]) x)
    const xs = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8, 9, 7, 9, 32, 0.5, 12, 7.25, 4];
    const d = viewDomain([...xs, null, "", Number.NaN])!;
    expect(d[0]).toBeCloseTo(0.69, 12);
    expect(d[1]).toBeCloseTo(24.4, 12);
    // 1..100: 2.98 and 98.02
    const r = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(viewDomain(r)).toEqual([2.98, 98.02].map((v) => expect.closeTo(v, 12)) as never);
    expect(quantileSorted([5], 0.5)).toBe(5);
    // the quantiles meet: min to max; a log indicator starts at 1; nothing loaded, no domain
    expect(viewDomain([4, 4, 4, 4, 4])).toEqual([4, 4]);
    expect(viewDomain(Array(60).fill(4).concat([9]))).toEqual([4, 9]);
    expect(viewDomain([0, 0.5, 300], true)![0]).toBe(1);
    expect(viewDomain([])).toBeNull();
  });
  it("the subtitle says the loaded hexagons when the domain is theirs", async () => {
    const { legendSubtitle } = await import("../../src/lens/collection/h3/paint");
    expect(
      legendSubtitle({ period: "1990s", res: 4, auto: true, indicator: "es", domain: "view" }),
    ).toBe("1990s · loaded hexagons p02–p98 · res 4 (auto)");
  });
});
