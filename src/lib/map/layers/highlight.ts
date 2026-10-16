// The clicked raster position, kept on the map: a ring at the point and, when the grid is known, the cell's
// square. Pure, like `layers/raster.ts`: plain source and layer specs for `composeStyle`, which owns the style
// (the lens never calls `addLayer`). White strokes over a dark, wider halo so the marker reads on any ramp.
import { HIGHLIGHT_COLOR, HIGHLIGHT_HALO_COLOR } from "../colors";
import type { HighlightSpec, LayerSpecification, SourceSpecification } from "../types";

export const HIGHLIGHT_SOURCE_ID = "cell_highlight";
export const HIGHLIGHT_RING_RADIUS = 7;
export const HIGHLIGHT_LINE_WIDTH = 2;

export function highlightSource(spec: HighlightSpec): SourceSpecification {
  const features: GeoJSON.Feature[] = [
    { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: spec.lngLat } },
  ];
  if (spec.cell)
    features.push({
      type: "Feature",
      properties: {},
      geometry: { type: "Polygon", coordinates: [spec.cell] },
    });
  return { type: "geojson", data: { type: "FeatureCollection", features } };
}

/** the cell's outline (halo, then line) and the point's ring (halo, then ring); each pair in draw order. */
export function highlightLayers(): { line: LayerSpecification[]; ring: LayerSpecification[] } {
  const polygon = ["==", ["geometry-type"], "Polygon"] as never;
  const point = ["==", ["geometry-type"], "Point"] as never;
  return {
    line: [
      {
        id: "cell-highlight-line-halo",
        type: "line",
        source: HIGHLIGHT_SOURCE_ID,
        filter: polygon,
        paint: {
          "line-color": HIGHLIGHT_HALO_COLOR,
          "line-opacity": 0.7,
          "line-width": HIGHLIGHT_LINE_WIDTH + 3,
        },
      },
      {
        id: "cell-highlight-line",
        type: "line",
        source: HIGHLIGHT_SOURCE_ID,
        filter: polygon,
        paint: { "line-color": HIGHLIGHT_COLOR, "line-width": HIGHLIGHT_LINE_WIDTH },
      },
    ],
    ring: [
      {
        id: "cell-highlight-ring-halo",
        type: "circle",
        source: HIGHLIGHT_SOURCE_ID,
        filter: point,
        paint: {
          "circle-radius": HIGHLIGHT_RING_RADIUS,
          "circle-opacity": 0,
          "circle-stroke-color": HIGHLIGHT_HALO_COLOR,
          "circle-stroke-opacity": 0.7,
          "circle-stroke-width": HIGHLIGHT_LINE_WIDTH + 3,
        },
      },
      {
        id: "cell-highlight-ring",
        type: "circle",
        source: HIGHLIGHT_SOURCE_ID,
        filter: point,
        paint: {
          "circle-radius": HIGHLIGHT_RING_RADIUS,
          "circle-opacity": 0,
          "circle-stroke-color": HIGHLIGHT_COLOR,
          "circle-stroke-width": HIGHLIGHT_LINE_WIDTH,
        },
      },
    ],
  };
}
