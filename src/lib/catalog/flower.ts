// The generic flower hook: a collection that declares `atlas:flower {dimension, composite}` gets a flower
// plot for a clicked raster pixel. The petals are the sibling ITEMS across `dimension` for the current values
// of every other dimension (the EOVs of the selected metric); each petal's value is the band of the SAME
// COG pixel that the sibling names with `atlas:bidx`, read from ONE `/cog/point` response
// (`raster/point.ts#ValueSource.pointValues`, so a click costs one request however many petals there are).
// The centre is the `composite` item's own band value; the producer defines it as the mean of the reportable
// petals, which a test asserts on the fixture.
//
// Pure: no DOM, no network, nothing collection-specific. What the hook does NOT know is a collection id: the
// EOV keys below only choose a colour, and an unknown key gets `--cat-other`.
//
//   nodata        a null value, the band's declared `raster:bands[].nodata`, or a value outside the item's
//                 `atlas:value_range` (a Byte 255 must never be clamped into a full petal) -> a null petal:
//                 its slot is kept, no petal is drawn, it is left out of the mean.
//   atlas:absent  an item that has no data by construction (AquaMaps models no seabirds) -> a null petal with
//                 a note ("(not in AquaMaps)") instead of "No data": absent, not zero, not missing.
import type { FlowerComponentInput } from "../ui/flowerGeometry";
import { rasterAssetOf } from "./assets";
import { dimsOf, resolveItem } from "./dims";
import type { CollectionEntry } from "./load";
import type { StacCollection, StacItem } from "./types";

/** the empty-slot text of an `atlas:absent` item that gives none of its own (`atlas:absent_note`). */
export const ABSENT_NOTE = "(not in AquaMaps)";

/** EOV key -> the `--cat-*` token it is drawn with (never a resolved colour); anything else `--cat-other`. */
export const FLOWER_COLORS: Readonly<Record<string, string>> = {
  fish: "--cat-fish",
  hardCorals: "--cat-coral",
  mangroves: "--cat-mangrove",
  marineMammals: "--cat-mammal",
  seabirds: "--cat-bird",
  seagrasses: "--cat-primprod",
  seaTurtles: "--cat-turtle",
};

export const FLOWER_FALLBACK_COLOR = "--cat-other";

export function flowerColorFor(key: string): string {
  return Object.hasOwn(FLOWER_COLORS, key) ? FLOWER_COLORS[key] : FLOWER_FALLBACK_COLOR;
}

export interface FlowerSpec {
  /** the `cube:dimensions` key whose values are the petals. */
  dimension: string;
  /** the value of that dimension whose item is the centre (not a petal). */
  composite: string;
}

/** the collection's `atlas:flower`, or null when it declares none (or an unusable one). */
export function flowerSpecOf(collection: StacCollection | null | undefined): FlowerSpec | null {
  const f = collection?.["atlas:flower"] as Partial<FlowerSpec> | undefined;
  if (!f || typeof f.dimension !== "string" || typeof f.composite !== "string") return null;
  return f.dimension && f.composite ? { dimension: f.dimension, composite: f.composite } : null;
}

/** the part of a `/cog/point` answer this reads (`raster/point.ts#PointValues`): `values[i]` is band `i + 1`. */
export interface PointBands {
  values: readonly (number | null)[];
}

/**
 * The value of `item`'s own band in an all-band point read, or null for nodata: band = the COG asset's
 * `atlas:bidx` (1 when absent), nodata = null / non-finite / the band's declared `raster:bands` nodata / outside
 * the item's `atlas:value_range`.
 */
export function bandValueOf(item: StacItem | null, point: PointBands | null): number | null {
  const cog = rasterAssetOf(item);
  if (!item || !cog || !point) return null;
  const raw = point.values[(cog.bidx ?? 1) - 1];
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  if (cog.nodata !== undefined && raw === cog.nodata) return null;
  const range = item.properties?.["atlas:value_range"];
  if (Array.isArray(range) && range.length === 2 && (raw < range[0] || raw > range[1])) return null;
  return raw;
}

export interface FlowerView {
  spec: FlowerSpec;
  /** one per value of the flower dimension except the composite, in the dimension's order. */
  components: FlowerComponentInput[];
  /** the composite item's band value (the centre number); null = no data. */
  center: number | null;
  /** the composite value's label ("All EOVs (mean)"). */
  compositeLabel: string;
  /** the labels of the OTHER dimensions' current values, " · "-joined ("Risk-weighted share"): the flower's subject. */
  subject: string;
}

/**
 * The flower for the clicked pixel: `null` when the collection has no `atlas:flower`, its dimension is not in
 * the cube, or the point read has not arrived (`pointValues` null). `selected` is the lens's current selection
 * (one value per dimension); the petals take every other dimension from it.
 */
export function flowerPetalsFor(
  entry: Pick<CollectionEntry, "collection"> | null,
  items: readonly StacItem[],
  selected: Readonly<Record<string, string>>,
  pointValues: PointBands | null,
): FlowerView | null {
  const spec = flowerSpecOf(entry?.collection);
  if (!entry?.collection || !spec || !pointValues) return null;
  const dims = dimsOf(entry.collection, items);
  const dim = dims.find((d) => d.key === spec.dimension);
  if (!dim) return null;

  const at = (value: string): StacItem | null =>
    resolveItem(items, { ...selected, [spec.dimension]: value });

  const components: FlowerComponentInput[] = dim.values
    .filter((v) => v.value !== spec.composite)
    .map((v) => {
      const sibling = at(v.value);
      const base = { key: v.value, label: v.label, color: flowerColorFor(v.value) };
      if (sibling?.properties?.["atlas:absent"] === true) {
        const own = sibling.properties["atlas:absent_note"];
        return {
          ...base,
          score: null,
          note: typeof own === "string" && own.trim() ? own.trim() : ABSENT_NOTE,
        };
      }
      return { ...base, score: bandValueOf(sibling, pointValues) };
    });

  const subject = dims
    .filter((d) => d.key !== spec.dimension)
    .map((d) => d.values.find((v) => v.value === selected[d.key])?.label ?? selected[d.key])
    .filter((s): s is string => typeof s === "string" && s !== "")
    .join(" · ");

  return {
    spec,
    components,
    center: bandValueOf(at(spec.composite), pointValues),
    compositeLabel: dim.values.find((v) => v.value === spec.composite)?.label ?? spec.composite,
    subject,
  };
}
