// The gazetteer collections toggled on in the Layers panel's "Place layers" group: one PMTiles vector
// source per collection, drawn as a faint fill under a line (polygons), a line (lines) or circles
// (points). Pure, like layers/gazetteer.ts: a `PlaceOverlaySpec` in, plain source/layer objects out;
// `composeStyle` folds them into the ONE style (never `addLayer`) and the `pmtiles://` protocol is
// registered once by map.ts.
//
// Each source carries the collection's `attribution` (MapLibre's own source field), the same string
// `places/overlays.ts#overlayCreditLine` hands the shell's credit line, so the credit is on screen
// exactly while the overlay is.
import type { PlaceOverlaySpec, LayerSpecification, SourceSpecification } from "../types";

/** a faint fill: the outline carries the shape, the fill only says "inside" and takes the hover. */
export const OVERLAY_FILL_OPACITY = 0.12;
export const OVERLAY_CIRCLE_RADIUS = 4;

export const overlaySourceId = (slug: string): string => `ov-${slug}`;
export const overlayFillId = (slug: string): string => `ov-${slug}-fill`;
export const overlayLineId = (slug: string): string => `ov-${slug}-line`;
export const overlayCircleId = (slug: string): string => `ov-${slug}-circle`;

export function overlaySource(spec: PlaceOverlaySpec): SourceSpecification {
  return {
    type: "vector",
    url: `pmtiles://${spec.pmtiles}`,
    ...(spec.attribution ? { attribution: spec.attribution } : {}),
  };
}

export function overlayFillLayer(spec: PlaceOverlaySpec): LayerSpecification {
  return {
    id: overlayFillId(spec.slug),
    type: "fill",
    source: overlaySourceId(spec.slug),
    "source-layer": spec.sourceLayer,
    paint: { "fill-color": spec.fillColor, "fill-opacity": OVERLAY_FILL_OPACITY },
  };
}

export function overlayLineLayer(spec: PlaceOverlaySpec): LayerSpecification {
  return {
    id: overlayLineId(spec.slug),
    type: "line",
    source: overlaySourceId(spec.slug),
    "source-layer": spec.sourceLayer,
    paint: { "line-color": spec.lineColor, "line-width": spec.lineWidth },
  };
}

export function overlayCircleLayer(spec: PlaceOverlaySpec): LayerSpecification {
  return {
    id: overlayCircleId(spec.slug),
    type: "circle",
    source: overlaySourceId(spec.slug),
    "source-layer": spec.sourceLayer,
    paint: {
      "circle-color": spec.fillColor,
      "circle-radius": OVERLAY_CIRCLE_RADIUS,
      "circle-stroke-color": spec.lineColor,
      "circle-stroke-width": 1,
    },
  };
}

/** the `[role, layer]` pairs of one overlay, by geometry kind (the roles are `style.ts` roles). */
export function overlayLayers(spec: PlaceOverlaySpec): {
  role: "place-overlay-fill" | "place-overlay-line" | "place-overlay-circle";
  layer: LayerSpecification;
}[] {
  if (spec.kind === "point") {
    return [{ role: "place-overlay-circle", layer: overlayCircleLayer(spec) }];
  }
  if (spec.kind === "line") {
    return [{ role: "place-overlay-line", layer: overlayLineLayer(spec) }];
  }
  return [
    { role: "place-overlay-fill", layer: overlayFillLayer(spec) },
    { role: "place-overlay-line", layer: overlayLineLayer(spec) },
  ];
}

/** the layer ids a hover or click should query: the one a feature is hit on, per overlay (the fill
 * of a polygon, the line of a line, the circle of a point). */
export function overlayHitLayerIds(specs: readonly PlaceOverlaySpec[]): string[] {
  return specs.map((s) =>
    s.kind === "point"
      ? overlayCircleId(s.slug)
      : s.kind === "line"
        ? overlayLineId(s.slug)
        : overlayFillId(s.slug),
  );
}
