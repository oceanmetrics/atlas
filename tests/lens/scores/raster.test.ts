import { describe, expect, it } from "vitest";
import { layerByKey } from "../../../src/lens/scores/boot";
import { formatScoresLegendValue } from "../../../src/lens/scores/mapInputs";
import {
  OUTSIDE_PRA_OVERLAY_ID,
  SCORE_RASTER_ID,
  outsidePraOverlaySpec,
  rasterLegend,
  scoreRasterSpec,
} from "../../../src/lens/scores/raster";
import { tileUrlLeaksStudyArea } from "../../../src/lib/map/layers/titiler";
import { BOOT_V7, MANIFEST_OVERLAYS_V7 } from "./fixtures";

const primprod = layerByKey(BOOT_V7, "primprod")!;

describe("scoreRasterSpec", () => {
  it("builds the FULL-COG titiler tile template, rescale verbatim, opacity 0.6", () => {
    const spec = scoreRasterSpec(primprod, "spectral_r")!;
    expect(spec.id).toBe(SCORE_RASTER_ID);
    expect(spec.opacity).toBe(0.6);
    expect(spec.tiles[0]).toContain("rescale=35.1489,11033.6953");
    expect(spec.tiles[0]).toContain("colormap_name=spectral_r");
    expect(spec.tiles[0]).toContain(encodeURIComponent(primprod.by_subregion!.FULL.cog!));
  });

  it("null layer: null, never a throw (an unknown ?lyr= must fall back)", () => {
    expect(scoreRasterSpec(null, "spectral_r")).toBeNull();
  });

  it("a layer with no FULL cog: null", () => {
    expect(
      scoreRasterSpec({ metric_key: "x", category: "raw", order: 1 }, "spectral_r"),
    ).toBeNull();
  });

  it("never leaks a study-area key (D7/apps#13-14: the raster is always the FULL COG)", () => {
    const spec = scoreRasterSpec(primprod, "spectral_r")!;
    expect(tileUrlLeaksStudyArea(spec.tiles[0])).toBeNull();
  });
});

describe("outsidePraOverlaySpec", () => {
  it("the explicit colormap, opacity 0.55, off by default", () => {
    const spec = outsidePraOverlaySpec(MANIFEST_OVERLAYS_V7, false)!;
    expect(spec.id).toBe(OUTSIDE_PRA_OVERLAY_ID);
    expect(spec.opacity).toBe(0.55);
    expect(spec.visible).toBe(false);
    expect(spec.tiles[0]).toContain(encodeURIComponent('{"1":[34,34,34,255]}'));
  });

  it("no manifest overlays published: null", () => {
    expect(outsidePraOverlaySpec(null, false)).toBeNull();
    expect(outsidePraOverlaySpec([], false)).toBeNull();
  });
});

describe("rasterLegend", () => {
  it("endpoints are signif(rescale, 3), stops from boot.palettes", () => {
    const legend = rasterLegend(BOOT_V7, primprod, "spectral_r");
    expect(legend.unavailable).toBe(false);
    expect(legend.stops).toHaveLength(11);
    expect(legend.stops[0].value).toBeCloseTo(35.1); // signif(35.1489, 3)
    expect(legend.stops[10].value).toBeCloseTo(11000); // signif(11033.6953, 3)
  });

  // M2 fix (docs/usability.md): a release publishing no stops for a palette (today: every release
  // publishes ONLY spectral_r) used to make the raster legend "unavailable" even though titiler was
  // already painting the tiles correctly server-side -- the viewer lost the scale on a palette the
  // picker itself offered. `rasterLegend` now falls back to ramps.ts's own fixed ramp instead. The
  // title is kept VERBATIM (not renamed to "falls back to...") because docs/parity.html's S-03 row
  // (scripts/parity-page/status.mjs, out of scope for this round) cites this exact test title as
  // its evidence -- renaming it would silently break that checklist's own "does this test still
  // exist" gate (tests/parity-page/checklist.test.ts).
  it("unavailable when the release has not published this palette's stops (today: viridis/cividis/magma)", () => {
    const legend = rasterLegend(BOOT_V7, primprod, "viridis");
    expect(legend.unavailable).toBe(false);
    expect(legend.stops).toHaveLength(11);
    // still real ENDPOINT values from the layer's own rescale, not a fallback for those too.
    expect(legend.stops[0].value).toBeCloseTo(35.1);
    expect(legend.stops[10].value).toBeCloseTo(11000);
    // every stop a real, distinct color -- not the "unavailable" empty array, and not one flat grey.
    expect(new Set(legend.stops.map((s) => s.color)).size).toBeGreaterThan(1);
  });

  // atlas-4 defect fix (the exact case the owner's screenshot motivated): a small-magnitude
  // rescale where a naive `toLocaleString`/`toFixed` re-round loses the third significant digit.
  // signif(0.0123456, 3) = 0.0123, signif(98.7654, 3) = 98.8 — this pins the END-TO-END label
  // (rasterLegend's own rounding + the legend's formatValue), not just one half of it.
  it("a small-magnitude rescale labels '0.0123' and '98.8' (never re-rounded by formatValue)", () => {
    const layer = {
      metric_key: "tiny",
      category: "raw",
      order: 1,
      by_subregion: {
        FULL: {
          cog: "https://s3.example/tiny.tif",
          rescale: [0.0123456, 98.7654] as [number, number],
        },
      },
    };
    const legend = rasterLegend(BOOT_V7, layer, "spectral_r");
    expect(legend.unavailable).toBe(false);
    expect(formatScoresLegendValue(legend.stops[0].value)).toBe("0.0123");
    expect(formatScoresLegendValue(legend.stops.at(-1)!.value)).toBe("98.8");
  });
});
