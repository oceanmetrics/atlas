// atlas-4 addition to atlas-map's zones.ts (an ADD, never a restructure — docs/map.md): the
// clicked-zone highlight line, filtered against the unit's own vector source.
import { describe, expect, it } from "vitest";
import {
  ZONE_HIGHLIGHT_LINE_WIDTH,
  zoneHighlightId,
  zoneHighlightLayer,
} from "../../src/lib/map/layers/zones";
import { SELECTION_COLOR, SELECTION_LINE_WIDTH } from "../../src/lib/map/style";
import type { ZoneUnitSpec } from "../../src/lib/map/types";

const PRA: ZoneUnitSpec = {
  unit: "programarea",
  pmtiles: "https://s3.example/marine-atlas/zones/programarea_2026-01/zones.pmtiles",
  sourceLayer: "programarea",
};

describe("zoneHighlightLayer", () => {
  it("is null with no highlightKey", () => {
    expect(zoneHighlightLayer(PRA)).toBeNull();
  });

  it("filters on the unit's own key property and paints the selection colour", () => {
    const layer = zoneHighlightLayer({ ...PRA, highlightKey: "GAA" });
    expect(layer).toEqual({
      id: "programarea_highlight_ln",
      type: "line",
      source: "programarea_src",
      "source-layer": "programarea",
      filter: ["==", ["get", "programarea_key"], "GAA"],
      paint: { "line-color": "#ff00aa", "line-width": 4 },
    });
  });

  it("id helper matches the layer's own id", () => {
    expect(zoneHighlightId("ecoregion")).toBe("ecoregion_highlight_ln");
  });

  it("stays pinned equal to style.ts's selection colour/width (no import cycle, so this is data)", () => {
    expect(SELECTION_COLOR).toBe("#ff00aa");
    expect(ZONE_HIGHLIGHT_LINE_WIDTH).toBe(SELECTION_LINE_WIDTH);
  });
});
