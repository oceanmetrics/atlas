// The overlay feature-filters hook: a collection that declares `atlas:overlay_filters` lets a viewer narrow its
// own vector overlays (`atlas:overlays`) by a property: sightings by species, sightings and effort by month or by
// year. Each filter names the overlays it applies to. Pure parser, static (`hooks.ts` registers it); what is
// selected (`cff=`), what it filters and the MapLibre expression are `featureFilterState.ts`, in the overlays'
// lazy chunk. Never a collection id: the hook is the field.
//
//   select   {id, title, type: "select", field, overlays, options: [{value, label, count?, layers?, dim_value?}],
//            follow_dim?}: "All" or one option (`["==", ["get", field], value]`); with `follow_dim`, the default
//            follows the selected Item's `atlas:dims[follow_dim]` to the option whose `dim_value` it equals.
//   range    {id, title, type: "range", field, overlays, min, max}: an inclusive [from, to], default the whole range.
//
// An entry without an id, a field, an overlay or (a select) a usable option is dropped; unknown keys are ignored.
import { COV_ID_RE, FILTER_VALUE_RE } from "../gazetteer/overlayUrl";
import type { StacCollection } from "./types";

/** the collection property this module is the hook for (registered in `hooks.ts`). */
export const OVERLAY_FILTERS_HOOK = "atlas:overlay_filters";

export type FilterValue = number | string;

export interface FilterOption {
  value: FilterValue;
  label: string;
  /** how many features carry it (shown as "label (count)"); `null` when the producer gives none. */
  count: number | null;
  /** values of the collection's taxon dimension (`atlas:taxon_dim`) that model this option ("Show model"). */
  layers: string[];
  /** the value of the `follow_dim` dimension this option stands for (`"07"` for July); `null` for none. */
  dimValue: string | null;
}

interface FilterBase {
  /** a URL token (`cff=<id>:<value>`). */
  id: string;
  title: string;
  /** the feature property it tests. */
  field: string;
  /** the ids of the `atlas:overlays` it applies to. */
  overlays: string[];
}

export interface SelectFilterSpec extends FilterBase {
  type: "select";
  options: FilterOption[];
  /** the Item dimension the default follows; `null` = the default is "All". */
  followDim: string | null;
}

export interface RangeFilterSpec extends FilterBase {
  type: "range";
  min: number;
  max: number;
}

export type FeatureFilterSpec = SelectFilterSpec | RangeFilterSpec;

export { FILTER_VALUE_RE };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : [];
const finite = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function parseOption(raw: unknown): FilterOption | null {
  if (!isRecord(raw)) return null;
  const v = raw.value;
  const value = typeof v === "number" && Number.isFinite(v) ? v : str(v);
  // `all` is the URL's word for "no filter", never an option's value
  if (value === null || !FILTER_VALUE_RE.test(String(value)) || value === "all") return null;
  const count = finite(raw.count);
  return {
    value,
    label: str(raw.label) ?? String(value),
    count,
    layers: strings(raw.layers),
    dimValue: str(raw.dim_value),
  };
}

function parseOne(raw: unknown, seen: Set<string>): FeatureFilterSpec | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const field = str(raw.field);
  const overlays = strings(raw.overlays);
  if (!id || !COV_ID_RE.test(id) || seen.has(id) || !field || overlays.length === 0) return null;
  const base = { id, title: str(raw.title) ?? id, field, overlays };
  if (raw.type === "select") {
    const options: FilterOption[] = [];
    for (const o of Array.isArray(raw.options) ? raw.options : []) {
      const opt = parseOption(o);
      // one option per value (the URL names an option by its value)
      if (opt && !options.some((x) => String(x.value) === String(opt.value))) options.push(opt);
    }
    if (options.length === 0) return null;
    seen.add(id);
    return { ...base, type: "select", options, followDim: str(raw.follow_dim) };
  }
  if (raw.type === "range") {
    const a = finite(raw.min);
    const b = finite(raw.max);
    if (a === null || b === null) return null;
    seen.add(id);
    return { ...base, type: "range", min: Math.min(a, b), max: Math.max(a, b) };
  }
  return null;
}

/** the collection's usable `atlas:overlay_filters`, in its order, or null when it declares none usable. */
export function parseOverlayFilters(
  collection: StacCollection | null | undefined,
): FeatureFilterSpec[] | null {
  const list = collection?.[OVERLAY_FILTERS_HOOK];
  if (!Array.isArray(list)) return null;
  const seen = new Set<string>();
  const out = list
    .map((raw) => parseOne(raw, seen))
    .filter((s): s is FeatureFilterSpec => s !== null);
  return out.length > 0 ? out : null;
}
