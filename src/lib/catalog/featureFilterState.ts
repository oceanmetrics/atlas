// What a collection's overlay feature filters (`atlas:overlay_filters`, `featureFilters.ts`) do right now: the
// URL's choice per filter (`cff=<id>:<value>;...`), the Item they may follow, and the MapLibre filter each one
// adds to the overlays it lists. Pure; reached through the overlays' lazy chunk (`lens/collection/overlayRuntime.ts`).
//
//   select     `cff=<id>:all` = no filter; `cff=<id>:<option value>` = that option; absent (or an unknown value)
//              = the default: with `follow_dim`, the option whose `dim_value` is the Item's `atlas:dims[follow_dim]`
//              (none matches, e.g. "annual": no filter), else no filter. Filter: ["==", ["get", field], value].
//   range      `cff=<id>:<from>-<to>`, inclusive, swapped when from > to, clamped to [min, max]; absent, invalid or
//              the whole range = no filter. Filter: [">=", get, from] AND ["<=", get, to].
//   overlays   an overlay's filters are every ACTIVE filter that lists it (`filtersByOverlay`); the layer builder
//              ANDs them with the "Only features matching the selected layer" token filter.
import type { FilterSpecification } from "maplibre-gl";
import { FILTER_VALUE_RE, type FeatureFilterSpec, type FilterOption } from "./featureFilters";

export type FilterChoice =
  /** the default of a `follow_dim` select: the followed option, or `null` when the Item's value matches none */
  | { kind: "follow"; option: FilterOption | null }
  | { kind: "all" }
  | { kind: "option"; option: FilterOption }
  | { kind: "range"; from: number; to: number };

export interface FeatureFilterView {
  spec: FeatureFilterSpec;
  choice: FilterChoice;
  /** the filter narrows something right now (an option, a followed option, a range short of the whole). */
  active: boolean;
  /** the follow entry's label: "Follow the map (July)", "Follow the map (all)"; "" for no follow_dim. */
  followLabel: string;
}

const RANGE_RE = /^(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)$/;

/** the `cff=` value of a range. */
export const rangeToken = (from: number, to: number): string => `${from}-${to}`;

/** the token that names `option` in the URL. */
export const optionToken = (option: FilterOption): string => String(option.value);

function resolveOne(
  spec: FeatureFilterSpec,
  token: string | undefined,
  dims: Readonly<Record<string, string>>,
): FeatureFilterView {
  if (spec.type === "range") {
    const m = token !== undefined ? RANGE_RE.exec(token) : null;
    let from = m ? Number(m[1]) : spec.min;
    let to = m ? Number(m[2]) : spec.max;
    if (from > to) [from, to] = [to, from];
    from = Math.max(from, spec.min);
    to = Math.min(to, spec.max);
    // a range entirely outside [min, max] keeps nothing; say so rather than silently filtering all out
    if (from > to) [from, to] = [spec.min, spec.max];
    const active = from > spec.min || to < spec.max;
    return { spec, choice: { kind: "range", from, to }, active, followLabel: "" };
  }
  const followed = spec.followDim
    ? (spec.options.find((o) => o.dimValue !== null && o.dimValue === dims[spec.followDim!]) ??
      null)
    : null;
  const followLabel = spec.followDim ? `Follow the map (${followed ? followed.label : "all"})` : "";
  if (token === "all") return { spec, choice: { kind: "all" }, active: false, followLabel };
  const chosen =
    token !== undefined ? spec.options.find((o) => optionToken(o) === token) : undefined;
  if (chosen)
    return { spec, choice: { kind: "option", option: chosen }, active: true, followLabel };
  if (spec.followDim) {
    return {
      spec,
      choice: { kind: "follow", option: followed },
      active: followed !== null,
      followLabel,
    };
  }
  return { spec, choice: { kind: "all" }, active: false, followLabel };
}

/** every filter's current choice, in the collection's order. `dims` = the selected Item's `atlas:dims`. */
export function resolveFeatureFilters(
  specs: readonly FeatureFilterSpec[],
  cff: Readonly<Record<string, string>> | undefined,
  dims: Readonly<Record<string, string>> | null | undefined,
): FeatureFilterView[] {
  return specs.map((s) => resolveOne(s, cff?.[s.id], dims ?? {}));
}

/** the MapLibre filter one view adds, or null when it narrows nothing. */
export function filterExpression(view: FeatureFilterView): FilterSpecification | null {
  if (!view.active) return null;
  const get = ["get", view.spec.field];
  const c = view.choice;
  if (c.kind === "range") {
    return ["all", [">=", get, c.from], ["<=", get, c.to]] as unknown as FilterSpecification;
  }
  const option = c.kind === "option" || c.kind === "follow" ? c.option : null;
  return option ? (["==", get, option.value] as unknown as FilterSpecification) : null;
}

/** overlay id -> the filters that apply to it (every active view that lists it), in the collection's order. */
export function filtersByOverlay(
  views: readonly FeatureFilterView[],
): Map<string, FilterSpecification[]> {
  const out = new Map<string, FilterSpecification[]>();
  for (const v of views) {
    const expr = filterExpression(v);
    if (!expr) continue;
    for (const id of v.spec.overlays) out.set(id, [...(out.get(id) ?? []), expr]);
  }
  return out;
}

/** `Sel.cff` after setting filter `id` to `token` (`undefined` = back to its default): `undefined` when empty. */
export function cffWith(
  cff: Readonly<Record<string, string>> | undefined,
  id: string,
  token: string | undefined,
): Record<string, string> | undefined {
  const next: Record<string, string> = { ...(cff ?? {}) };
  if (token === undefined || !FILTER_VALUE_RE.test(token)) delete next[id];
  else next[id] = token;
  return Object.keys(next).length > 0 ? next : undefined;
}
