// The app's own colours for a browser-drawn COG (build week 6 step 5), where the asset's `atlas:colormap` (one of
// @oceanmetrics/map's named ramps) cannot say them: the release's palette stops (cividis and magma are not among
// the package's ramps, and a ramp the package does not know falls back to viridis) and a mask's exact value ->
// colour table. `paintFor` turns a `CogPaint` into what `cog.ts` `cogRasterSource` takes (`CogPainted`: the url's
// `#color:` hash and the protocol's colour function). Imported by the lazy `releaseCog.ts` only, so none of it is
// on the static path.
import { cogRange, colorAt, type CogAsset } from "@oceanmetrics/map";
import type { CogPainted } from "./cog";

/** an RGBA colour, 0-255 each. */
export type Rgba = readonly [number, number, number, number];

/** how a source is coloured when the asset's `atlas:colormap` (one of the package's named ramps) is not enough:
 * `stops`, the app's own palette (the legend's 11 stops, `raster/ramps.ts`) spread over the domain, as titiler
 * spreads its named colormap over `rescale` (cividis and magma are not among the package's ramps, and a ramp the
 * package does not know falls back to viridis); `classes`, an exact value -> colour table, every other value
 * transparent, as titiler's explicit `colormap={"1":[34,34,34,255]}` paints a mask. */
export type CogPaint =
  | { kind: "stops"; stops: readonly string[] }
  | { kind: "classes"; classes: Readonly<Record<number, Rgba>> };

const hexRgb = (h: string): [number, number, number] => {
  const s = h.replace("#", "");
  const f =
    s.length === 3
      ? s
          .split("")
          .map((c) => c + c)
          .join("")
      : s.slice(0, 6);
  return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)];
};
const rgbHex = (c: readonly number[]): string =>
  `#${c
    .slice(0, 3)
    .map((v) => Math.round(v).toString(16).padStart(2, "0"))
    .join("")}`;

/** a pixel the protocol must leave transparent: NaN, infinite, the band's STAC nodata or the file's own. */
function isNodata(v: number, nd: number | null, fileNodata: number | undefined): boolean {
  if (v !== v || !Number.isFinite(v)) return true;
  if (nd !== null && (v === nd || v === Math.fround(nd))) return true;
  return fileNodata !== undefined && v === fileNodata;
}

export type ColorFunction = (
  pixel: ArrayLike<number>,
  color: Uint8ClampedArray,
  metadata?: { noData?: number },
) => void;

/** the protocol's colour function for `stops` over [min, max] (clamped at both ends, interpolated in RGB as
 * MapLibre and the package's ramps are), nodata transparent. */
export function stopsColorFunction(o: {
  stops: readonly string[];
  min: number;
  max: number;
  band?: number;
  nodata?: number | null;
}): ColorFunction {
  const rgb = o.stops.map(hexRgb);
  const span = o.max > o.min ? o.max - o.min : 1;
  const nd = o.nodata ?? null;
  const k = (o.band ?? 1) - 1;
  return (pixel, color, metadata = {}) => {
    const v = pixel[k];
    if (isNodata(v, nd, metadata.noData)) {
      color[3] = 0;
      return;
    }
    const [r, g, b] = colorAt(rgb, (v - o.min) / span);
    color[0] = r;
    color[1] = g;
    color[2] = b;
    color[3] = 255;
  };
}

/** the protocol's colour function for an exact value -> colour table: a value in it takes its colour, every
 * other value (and nodata) is transparent. */
export function classColorFunction(o: {
  classes: Readonly<Record<number, Rgba>>;
  band?: number;
  nodata?: number | null;
}): ColorFunction {
  const table = new Map(Object.entries(o.classes).map(([k, c]) => [Number(k), c]));
  const nd = o.nodata ?? null;
  const k = (o.band ?? 1) - 1;
  return (pixel, color, metadata = {}) => {
    const v = pixel[k];
    const c = isNodata(v, nd, metadata.noData) ? undefined : table.get(v);
    if (!c) {
      color[3] = 0;
      return;
    }
    color[0] = c[0];
    color[1] = c[1];
    color[2] = c[2];
    color[3] = c[3];
  };
}

/** the `#color:` hash of a painted source: the protocol's custom-colours grammar, so the tiles a request makes
 * before the colour function is set are already in the paint's colours, and so MapLibre's tile cache (keyed by
 * the url) tells two paints of one file apart. */
export function paintHash(paint: CogPaint, range: [number, number]): string {
  if (paint.kind === "stops") {
    return `color:${JSON.stringify(paint.stops.map((s) => s.toLowerCase()))},${range[0]},${range[1]},c`;
  }
  const keys = Object.keys(paint.classes)
    .map(Number)
    .sort((a, b) => a - b);
  const colors = keys.map((k) => rgbHex(paint.classes[k]));
  return `color:${JSON.stringify(colors)},${keys[0]},${keys[keys.length - 1]},c`;
}

/** the paint as `cogRasterSource` takes it, for `asset` (its band, its nodata) over `domain` (else the asset's
 * own range: its rescale or its band statistics, a mask's [1, 1]). */
export function paintFor(
  paint: CogPaint,
  asset: CogAsset,
  domain: [number, number] | null,
): CogPainted {
  const range = domain ?? cogRange(asset) ?? [0, 1];
  const band = typeof asset["atlas:bidx"] === "number" ? asset["atlas:bidx"] : 1;
  const nd = nodataOf(asset, band);
  const colorFunction =
    paint.kind === "stops"
      ? stopsColorFunction({ stops: paint.stops, min: range[0], max: range[1], band, nodata: nd })
      : classColorFunction({ classes: paint.classes, band, nodata: nd });
  const hash = paintHash(paint, range);
  return { key: hash, hash, colorFunction };
}

/** the band's STAC nodata as a number (`"nan"` -> NaN), null when none. */
function nodataOf(a: CogAsset, band: number): number | null {
  const bands = (a.bands ?? a["raster:bands"] ?? []) as { nodata?: unknown }[];
  const v = bands[band - 1]?.nodata;
  if (typeof v === "number") return v;
  if (v === "nan") return NaN;
  return null;
}
