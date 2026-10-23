import { beforeEach, describe, expect, it } from "vitest";
import {
  bboxFromRenderedFeatures,
  buildReportMapStyle,
  captureRejectionReason,
  combinedBbox,
  luminanceStatsFromRgba,
  ringsFromRenderedFeatures,
  scoreColorExpression,
  unionBounds,
  zoneKeyColors,
  zoneMatchColorExpression,
  zonePolygonLayers,
} from "../../src/report/reportMap";
import { REPORT_MAP_OUTLINE, REPORT_NODATA_COLOR } from "../../src/report/colors";
import { loadBasemapStyle, resetBasemapStyleCacheForTests } from "../../src/lib/map/layers/basemap";

describe("combinedBbox", () => {
  it("null when no place carries a geometry or point", () => {
    expect(combinedBbox([{ name: "a", score: null }])).toBeNull();
  });

  it("unions a polygon bbox and a point's small box", () => {
    const box = combinedBbox([
      {
        name: "square",
        score: 50,
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-10, -10],
              [10, -10],
              [10, 10],
              [-10, 10],
              [-10, -10],
            ],
          ],
        },
      },
      { name: "zone", score: 30, point: [20, 20] },
    ]);
    expect(box).toEqual([
      [-10, -10],
      [20.5, 20.5],
    ]);
  });
});

// ---- P4: zone places' REAL Program-Area polygon, from the release's own PMTiles -----------------

describe("zoneKeyColors", () => {
  const stops = ["#000000", "#ffffff"];

  it("scores a real per-key color from the report's own ramp domain", () => {
    const out = zoneKeyColors([{ key: "GAA", score: 100 }], [0, 100], stops);
    expect(out).toEqual({ GAA: "#ffffff" });
  });

  it("a null score gets the no-data fallback, not a ramp lookup", () => {
    const out = zoneKeyColors([{ key: "GAA", score: null }], [0, 100], stops);
    expect(out).toEqual({ GAA: REPORT_NODATA_COLOR });
  });

  it("no domain/paletteStops (not yet resolved) falls back the same way as a null score", () => {
    expect(zoneKeyColors([{ key: "GAA", score: 50 }], null, stops)).toEqual({
      GAA: REPORT_NODATA_COLOR,
    });
    expect(zoneKeyColors([{ key: "GAA", score: 50 }], [0, 100], null)).toEqual({
      GAA: REPORT_NODATA_COLOR,
    });
  });
});

describe("zoneMatchColorExpression", () => {
  it("builds a match expression, one label/output pair per key, ending in the fallback", () => {
    const expr = zoneMatchColorExpression(
      "programarea_key",
      { GAA: "#111111", ALA: "#222222" },
      REPORT_NODATA_COLOR,
    );
    expect(expr).toEqual([
      "match",
      ["get", "programarea_key"],
      "GAA",
      "#111111",
      "ALA",
      "#222222",
      REPORT_NODATA_COLOR,
    ]);
  });

  // B3's own precedent (lib/map/layers/zones.ts#zoneFillLayer): a `match` needs >= 1 pair before
  // its fallback -- an EMPTY keyColors must return the literal fallback, not an invalid 2-arg match.
  it("an empty keyColors returns the literal fallback, never an invalid 2-argument match", () => {
    expect(zoneMatchColorExpression("programarea_key", {}, REPORT_NODATA_COLOR)).toBe(
      REPORT_NODATA_COLOR,
    );
  });
});

describe("zonePolygonLayers", () => {
  const group = {
    unit: {
      unit: "programarea",
      pmtiles: "https://example.test/z.pmtiles",
      sourceLayer: "programarea",
    },
    keyColors: { GAA: "#111111" },
  };

  it("a fill + line pair, filtered to exactly this report's keys, never the whole unit", () => {
    const layers = zonePolygonLayers(group);
    expect(layers.map((l) => l.type)).toEqual(["fill", "line"]);
    for (const l of layers) {
      const generic = l as unknown as { source: string; "source-layer": string; filter: unknown };
      expect(generic.source).toBe("programarea_src");
      expect(generic["source-layer"]).toBe("programarea");
      expect(generic.filter).toEqual(["in", ["get", "programarea_key"], ["literal", ["GAA"]]]);
    }
    const fill = layers[0] as { paint: Record<string, unknown> };
    expect(fill.paint["fill-color"]).toEqual([
      "match",
      ["get", "programarea_key"],
      "GAA",
      "#111111",
      REPORT_NODATA_COLOR,
    ]);
    expect(fill.paint["fill-outline-color"]).toBe(REPORT_MAP_OUTLINE);
  });
});

describe("ringsFromRenderedFeatures / bboxFromRenderedFeatures", () => {
  const square = {
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-96, 24],
          [-84, 24],
          [-84, 30],
          [-96, 30],
          [-96, 24],
        ],
      ],
    },
  };

  it("null when the query found nothing -- the caller falls back, never treats it as the whole world", () => {
    expect(bboxFromRenderedFeatures([])).toBeNull();
    expect(ringsFromRenderedFeatures([])).toEqual([]);
  });

  it("a Polygon feature's bbox, via the SAME bboxOf() combinedBbox uses -- no second algorithm", () => {
    expect(bboxFromRenderedFeatures([square])).toEqual([
      [-96, 24],
      [-84, 30],
    ]);
  });

  it("a MultiPolygon feature's every polygon counts toward the combined bbox", () => {
    const multi = {
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          square.geometry.coordinates,
          [
            [
              [10, 10],
              [12, 10],
              [12, 12],
              [10, 12],
              [10, 10],
            ],
          ],
        ],
      },
    };
    expect(bboxFromRenderedFeatures([multi])).toEqual([
      [-96, 10],
      [12, 30],
    ]);
  });
});

describe("unionBounds", () => {
  const a: [[number, number], [number, number]] = [
    [-10, -10],
    [0, 0],
  ];
  const b: [[number, number], [number, number]] = [
    [5, 5],
    [20, 20],
  ];

  it("plain min/max union of two boxes", () => {
    expect(unionBounds(a, b)).toEqual([
      [-10, -10],
      [20, 20],
    ]);
  });

  it("either side null just returns the other -- never throws, never collapses to null", () => {
    expect(unionBounds(a, null)).toEqual(a);
    expect(unionBounds(null, b)).toEqual(b);
    expect(unionBounds(null, null)).toBeNull();
  });
});

describe("scoreColorExpression", () => {
  const stops = ["#000000", "#ffffff"];

  it("falls back to the no-data color when hasScore is false", () => {
    const expr = scoreColorExpression(stops, [0, 100]) as unknown[];
    expect(expr[0]).toBe("case");
    expect(expr[1]).toEqual(["==", ["get", "hasScore"], false]);
  });

  it("interpolates over the given domain, not a fixed 0-100", () => {
    const expr = scoreColorExpression(stops, [10, 20]) as unknown[];
    const interpolate = expr[3] as unknown[];
    expect(interpolate[0]).toBe("interpolate");
    expect(interpolate.slice(3)).toEqual([10, "#000000", 20, "#ffffff"]);
  });
});

// fix round 2, item 6: `captureMapPng` used to reject only pure black/white; a reviewer's captured
// map (896x360, one flat colour, mid-range luminance) sailed through. `luminanceStatsFromRgba` and
// `captureRejectionReason` are the pure halves of that rule (this repo's vitest environment is
// `node`, so no real <canvas> exists here to draw a fixture into -- the DOM-touching half,
// `luminanceStats`, just calls these with a real ImageData buffer).
function solidRgba(r: number, g: number, b: number, count: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return data;
}

function gradientRgba(count: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) {
    const v = Math.round((i / (count - 1)) * 255);
    data[i * 4] = v;
    data[i * 4 + 1] = 255 - v;
    data[i * 4 + 2] = (v * 37) % 256;
    data[i * 4 + 3] = 255;
  }
  return data;
}

describe("luminanceStatsFromRgba / captureRejectionReason", () => {
  it("a flat mid-grey fill has zero variance", () => {
    const stats = luminanceStatsFromRgba(solidRgba(128, 128, 128, 400));
    expect(stats.stdev).toBe(0);
    expect(stats.mean).toBeGreaterThan(1);
    expect(stats.mean).toBeLessThan(254);
  });

  it("real, varying map imagery (a gradient) is accepted", () => {
    const reason = captureRejectionReason(luminanceStatsFromRgba(gradientRgba(400)));
    expect(reason).toBeNull();
  });

  it("an all-black capture is rejected", () => {
    const reason = captureRejectionReason(luminanceStatsFromRgba(solidRgba(0, 0, 0, 400)));
    expect(reason).toContain("all-black/all-white");
  });

  it("an all-white capture is rejected", () => {
    const reason = captureRejectionReason(luminanceStatsFromRgba(solidRgba(255, 255, 255, 400)));
    expect(reason).toContain("all-black/all-white");
  });

  it("SEEDED FAULT: a flat, single-colour capture is rejected even though its luminance is mid-range -- a mean-only check (the pre-fix-round-2 rule) would have accepted it", () => {
    const flat = luminanceStatsFromRgba(solidRgba(140, 140, 140, 400));
    const meanOnlyWouldAccept = flat.mean >= 1 && flat.mean <= 254;
    expect(meanOnlyWouldAccept).toBe(true); // the exact gap the old rule had
    expect(captureRejectionReason(flat)).toContain("flat, single-colour");
  });
});

// R3-B11 (Opus eyes-on review, 2026-09-25, desktop-13b-report-map): CARTO's own basemap place-name
// labels ("LOUISIANA") were clipped at the fitted map's own edge -- the report draws its own place
// labels, so the fix drops the basemap's own `symbol` (text) layers entirely rather than chasing a
// padding number that a longer label could still beat.
describe("buildReportMapStyle: the basemap's own place-name labels are dropped", () => {
  beforeEach(() => {
    resetBasemapStyleCacheForTests();
  });

  function fakeCartoStyleWithLabels() {
    return {
      sources: { carto: { type: "vector", url: "https://tiles.example/tiles.json" } },
      sprite: "https://tiles.example/sprite",
      glyphs: "https://tiles.example/fonts/{fontstack}/{range}.pbf",
      layers: [
        { id: "water", type: "fill", source: "carto", "source-layer": "water", paint: {} },
        { id: "roads", type: "line", source: "carto", "source-layer": "roads", paint: {} },
        // #8: CARTO's own city/town label layers are KEPT (a report map needs towns for context)
        {
          id: "place_city_r6",
          type: "symbol",
          source: "carto",
          "source-layer": "place",
          paint: {},
        },
        { id: "place_town", type: "symbol", source: "carto", "source-layer": "place", paint: {} },
        { id: "place_state", type: "symbol", source: "carto", "source-layer": "place", paint: {} },
        {
          id: "watername_ocean",
          type: "symbol",
          source: "carto",
          "source-layer": "water_name",
          paint: {},
        },
        {
          id: "place-label",
          type: "symbol",
          source: "carto",
          "source-layer": "place",
          layout: { "text-field": ["get", "name"] },
          paint: {},
        },
      ],
    };
  }

  it("keeps every non-symbol basemap layer and the city/town labels, drops every other basemap symbol layer, and still draws the report's OWN place-labels layer", async () => {
    await loadBasemapStyle("paper", () =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(fakeCartoStyleWithLabels()),
      } as never),
    );
    const { style } = await buildReportMapStyle({
      theme: "paper",
      places: [{ name: "GOA Program Area A (GAA)", score: 33, point: [-150, 58] }],
      domain: [0, 100],
      paletteStops: ["#000000", "#ffffff"],
    });
    // composeStyle()/mergeCartoStyle() prefixes every CARTO layer id with "basemap-"
    // (BASEMAP_LAYER_PREFIX, lib/map/style.ts) to keep it from colliding with an app id.
    const ids = style.layers.map((l) => l.id);
    expect(ids).toContain("basemap-water");
    expect(ids).toContain("basemap-roads");
    expect(ids).not.toContain("basemap-place-label"); // the basemap's own symbol layer
    const symbolLayers = style.layers.filter((l) => l.type === "symbol");
    // the symbol layers left: CARTO's city + town labels (#8) and the report's own place labels;
    // never a state, ocean or country name (R3-B11's clipping failure).
    expect(symbolLayers.map((l) => l.id)).toEqual([
      "basemap-place_city_r6",
      "basemap-place_town",
      "place-labels",
    ]);
  });
});
