// The collection-overlays hook: a collection that declares `atlas:overlays` gets extra VECTOR layers
// drawn over its Item (vessel sightings over effort tracklines over the survey hexagons, say), each one a
// PMTiles archive among the collection's own assets, listed in the Layers panel's "Collection layers"
// group and clickable for every attribute of a feature. Pure: no DOM, no network, nothing
// collection-specific (the hook is the field, never a collection id).
//
//   atlas:overlays          [{id, title, asset, source_layer, geometry, color, default, label_field,
//                             fields, field_labels, filter_field}] on the Collection. Array order is the
//                             panel order AND the draw order, the FIRST entry drawn on top.
//   atlas:overlay_filter    {field, token} on an Item: "Only features matching the selected layer" keeps
//                             the features of each overlay whose `filter_field` is `field` and whose
//                             `|`-delimited property holds `|token|` (`lib/map/layers/collectionOverlays.ts`).
//
// An entry that cannot be drawn (no id, an asset the collection does not list, an unknown geometry) is
// dropped; unknown keys are ignored; a collection whose list leaves nothing usable has no hook (null).
// This file is the parser (static: `hooks.ts` registers it); which overlays are on and the filter state are
// `overlayState.ts`, loaded with the overlays' own lazy chunk (`lens/collection/overlayRuntime.ts`).
import { COV_ID_RE } from "../gazetteer/overlayUrl";
import { assetUrl } from "./load";
import type { StacCollection } from "./types";

/** the collection property this module is the hook for (registered in `hooks.ts`). */
export const OVERLAYS_HOOK = "atlas:overlays";
/** the Item property naming what "Only features matching the selected layer" keeps. */
export const OVERLAY_FILTER_FIELD = "atlas:overlay_filter";

export const OVERLAY_GEOMETRIES = ["point", "line", "polygon"] as const;
export type OverlayGeometry = (typeof OVERLAY_GEOMETRIES)[number];

/** drawn when an entry names no colour, or one MapLibre could not parse (it would reject the whole style). */
export const OVERLAY_FALLBACK_COLOR = "rgb(51, 136, 255)";

export interface CollectionOverlaySpec {
  /** the overlay's id: a URL token (`cov=`), so letters, digits, `_`, `-` and `.` only. */
  id: string;
  title: string;
  /** the key of `collection.assets` the archive is. */
  asset: string;
  /** absolute URL of the PMTiles archive (the asset's href, resolved against the collection.json). */
  url: string;
  /** the vector layer inside the archive. */
  sourceLayer: string;
  geometry: OverlayGeometry;
  color: string;
  /** visible when the collection opens with no `cov=` in the URL. */
  default: boolean;
  /** the property shown on hover and as a popup heading; `null` = the overlay title alone. */
  labelField: string | null;
  /** the popup's row order (the other properties follow); `null` = the feature's own order. */
  fields: readonly string[] | null;
  /** property name -> display label. */
  fieldLabels: Readonly<Record<string, string>>;
  /** the `|`-delimited string property "Only features matching the selected layer" filters on. */
  filterField: string | null;
}

/** what an Item's `atlas:overlay_filter` says: keep features whose `field` holds `|token|`. */
export interface OverlayFilter {
  field: string;
  token: string;
}

/** the colours MapLibre parses for certain: hex (3, 4, 6, 8 digits) and the functional rgb/hsl forms. */
const COLOR_RE = /^(#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|(rgb|hsl)a?\([0-9.,%\s/+-]+\))$/i;
const PMTILES_TYPE = "application/vnd.pmtiles";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function parseOne(
  raw: unknown,
  collection: StacCollection,
  seen: Set<string>,
): CollectionOverlaySpec | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  if (!id || !COV_ID_RE.test(id) || seen.has(id)) return null;
  const asset = str(raw.asset);
  const a = asset ? collection.assets?.[asset] : undefined;
  if (!asset || !a || (a.type !== undefined && a.type !== PMTILES_TYPE)) return null;
  const url = assetUrl(collection, a);
  const geometry = raw.geometry as OverlayGeometry;
  if (!url || !OVERLAY_GEOMETRIES.includes(geometry)) return null;
  const sourceLayer = str(raw.source_layer) ?? str(a["pmtiles:layers"]?.[0]);
  if (!sourceLayer) return null;
  const color = str(raw.color);
  const fields = Array.isArray(raw.fields)
    ? raw.fields.filter((f): f is string => typeof f === "string" && f !== "")
    : null;
  const fieldLabels: Record<string, string> = {};
  if (isRecord(raw.field_labels)) {
    for (const [k, v] of Object.entries(raw.field_labels)) if (str(v)) fieldLabels[k] = str(v)!;
  }
  seen.add(id);
  return {
    id,
    title: str(raw.title) ?? id,
    asset,
    url,
    sourceLayer,
    geometry,
    color: color && COLOR_RE.test(color) ? color : OVERLAY_FALLBACK_COLOR,
    default: raw.default === true,
    labelField: str(raw.label_field),
    fields: fields && fields.length > 0 ? fields : null,
    fieldLabels,
    filterField: str(raw.filter_field),
  };
}

/** the collection's usable `atlas:overlays`, in its own order, or null when it declares none (or none usable). */
export function parseOverlays(
  collection: StacCollection | null | undefined,
): CollectionOverlaySpec[] | null {
  const list = collection?.[OVERLAYS_HOOK];
  if (!collection || !Array.isArray(list)) return null;
  const seen = new Set<string>();
  const out = list
    .map((raw) => parseOne(raw, collection, seen))
    .filter((s): s is CollectionOverlaySpec => s !== null);
  return out.length > 0 ? out : null;
}
