// The colour ramp of a catalog collection and the value domain it spans.
//
// A collection MAY publish `styles/default.json`: a MapLibre fill layer whose `fill-color` is an
// `interpolate` expression over `["feature-state","value"]` (the hex-painting contract). The ramp is
// read OUT of that expression (its stop colours, in order, evenly respaced across the item's own
// value domain), never re-implemented; a collection with no style gets Spectral reversed. The
// colours themselves are never defined here: the default comes from `raster/ramps.ts`, the one file
// allowed to hold a ramp (tests/raster/ramps.wiring.test.ts).
import {
  colorForValue,
  legendStops,
  paletteStopsWithFallback,
  type LegendStop,
} from "../raster/ramps";
import type { StacCollection, StacItem } from "./types";

const HEX6 = /^#[0-9a-f]{6}$/i;

/** every colour output of the first `interpolate`/`step` expression found inside `node`, in order. */
function stopColors(node: unknown): string[] | null {
  if (!Array.isArray(node)) return null;
  const op = node[0];
  if (op === "interpolate" || op === "interpolate-hcl" || op === "interpolate-lab") {
    // ["interpolate", type, input, stop0, out0, stop1, out1, ...]
    const out: string[] = [];
    for (let i = 4; i < node.length; i += 2) if (typeof node[i] === "string") out.push(node[i]);
    return out.length > 0 ? out : null;
  }
  if (op === "step") {
    // ["step", input, out0, stop1, out1, ...]
    const out: string[] = [];
    if (typeof node[2] === "string") out.push(node[2]);
    for (let i = 4; i < node.length; i += 2) if (typeof node[i] === "string") out.push(node[i]);
    return out.length > 0 ? out : null;
  }
  for (const child of node) {
    const found = stopColors(child);
    if (found) return found;
  }
  return null;
}

/**
 * The ramp colours of a MapLibre style document (the `styles/default.json` of a collection): the
 * outputs of the `interpolate` expression inside `paint["fill-color"]` (also a bare layer or a
 * `{layers:[...]}` style). Only 6-digit hex colours are kept (the ramp helpers interpolate in sRGB);
 * `null` when there is no usable ramp (fewer than two such colours).
 */
export function rampFromStyle(style: unknown): string[] | null {
  if (!style || typeof style !== "object") return null;
  const doc = style as { paint?: Record<string, unknown>; layers?: unknown };
  let layers: { paint?: Record<string, unknown> }[] = [];
  if (doc.paint) layers = [doc];
  else if (Array.isArray(doc.layers)) layers = doc.layers as typeof layers;
  for (const layer of layers) {
    const colors = stopColors(layer.paint?.["fill-color"])?.filter((c) => HEX6.test(c)) ?? null;
    if (colors && colors.length >= 2) return colors;
  }
  return null;
}

/** the ramp to paint with: the collection's own style when it has a usable one, else Spectral
 * reversed (11 stops, low = purple-blue, high = dark red). */
export function collectionRamp(style: unknown | null): string[] {
  return [...(rampFromStyle(style) ?? paletteStopsWithFallback(null, "spectral_r") ?? [])];
}

export type ValueDomain = [number, number];

function asRange(v: unknown): ValueDomain | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [lo, hi] = v;
  return typeof lo === "number" &&
    typeof hi === "number" &&
    Number.isFinite(lo) &&
    Number.isFinite(hi)
    ? [lo, hi]
    : null;
}

/**
 * The value domain the ramp spans for `item`: its own observed `atlas:value_range` (what the legend
 * shows, so legend and colours always agree), else the declared `sdm:value_range`, else the
 * collection's, else `[0, 1]`. A degenerate range (min >= max) is widened by 1 so the ramp has a
 * span to colour.
 */
export function valueDomain(item: StacItem | null, collection: StacCollection | null): ValueDomain {
  const range =
    asRange(item?.properties?.["atlas:value_range"]) ??
    asRange(item?.properties?.["sdm:value_range"]) ??
    asRange(collection?.["sdm:value_range"]) ??
    ([0, 1] as ValueDomain);
  const [lo, hi] = range;
  return hi > lo ? [lo, hi] : [lo, lo + 1];
}

/** the legend stops for `colors` over `domain`: evenly spaced, colour + value (`legendStops`). */
export function rampStops(colors: readonly string[], domain: ValueDomain): LegendStop[] {
  return legendStops(colors, domain[0], domain[1]);
}

/** the colour a value gets on the ramp (continuous sRGB blend; clamped to the ends). */
export function lookupColor(colors: readonly string[], value: number, domain: ValueDomain): string {
  return colorForValue(colors, value, domain[0], domain[1]);
}
