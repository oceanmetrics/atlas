// v10 phase P6 -- the scoring SCOPE of a release's composite/component layers. A release scores in
// one or two scopes: "ecoregion" (v1-v9: each component rescaled 0-100 within its ecoregion) and,
// from v10, "nation" (a location quotient, 100 = the national average, unbounded above; msens
// `app_boot()` stamps `layers[].scope`, `.metric_scope()` in app_bundle.R). The Atlas never names a
// release: a bundle that carries a `nation` layer offers the "Across the nation" mode, one that does
// not (every bundle published before msens 0.60.2 has no `scope` field at all) stays "ecoregion".
//
// Pure and import-free so the SQL layer (`queries.ts`), the lens readers (`lens/scores/boot.ts`) and
// the tests share ONE definition of what a scope's component keys look like -- the same regexes
// msens classifies with, in one place.

export type Scope = "ecoregion" | "nation";

export const DEFAULT_SCOPE: Scope = "ecoregion";

interface ScopedRow {
  category?: unknown;
  scope?: unknown;
}

/**
 * The scope a boot layer row belongs to: only a `composite` or `component` row has one (a `raw` row
 * is scope-less, `null`). A MISSING or null `scope` on such a row is `"ecoregion"` -- every v1-v9
 * bundle already on S3 publishes none -- and an unrecognized value never throws: only the exact
 * string `"nation"` is national.
 */
export function rowScope(row: ScopedRow | null | undefined): Scope | null {
  if (!row || (row.category !== "composite" && row.category !== "component")) return null;
  return row.scope === "nation" ? "nation" : "ecoregion";
}

/** the metric keys that are a scope's COMPONENTS (a zone's `metrics` map, a cell column), by shape. */
const COMPONENT_KEY: Record<Scope, RegExp> = {
  ecoregion: /_ecoregion_rescaled$/,
  nation: /^(?:extrisk_[a-z_]+_v10_global|primprod_v10)$/,
};

/** {@link COMPONENT_KEY} as the RE2 source `sql/*.sql`'s `metric_pattern` takes. The ecoregion one
 * is `queries.ts#METRIC_PATTERN` verbatim. */
export const COMPONENT_SQL_PATTERN: Record<Scope, string> = {
  ecoregion: "_ecoregion_rescaled$",
  nation: "(^extrisk_[a-z_]+_v10_global$|^primprod_v10$)",
};

export function isComponentKey(metricKey: string, scope: Scope): boolean {
  return COMPONENT_KEY[scope].test(metricKey);
}

/** `extrisk_bird_v10_global` -> `extrisk_bird_pct_world` (a national component's companion raw key,
 * msens `score_share_metrics`); `primprod_v10` -> `primprod_pct_world`; `null` for any other key. */
export function companionKey(metricKey: string, suffix: string): string | null {
  const m = /^extrisk_([a-z_]+)_v10_global$/.exec(metricKey);
  if (m) return `extrisk_${m[1]}_${suffix}`;
  return metricKey === "primprod_v10" ? `primprod_${suffix}` : null;
}

/** the toggle's labels (the method page, section 12: a "Compare" switch, not a metric picker). */
export const SCOPE_LABEL: Record<Scope, string> = {
  ecoregion: "Within ecoregion",
  nation: "Across the nation",
};

/** the component group's heading in the layer picker, per scope. */
export const SCOPE_COMPONENT_GROUP_LABEL: Record<Scope, string> = {
  ecoregion: "Rescaled by ecoregion",
  nation: "Across the nation",
};

/** the unit a national value is in, and the sentence that anchors it. */
export const NATION_UNIT = "× national avg";
export const NATION_AVG_NOTE = "100 = national average";
export const NATION_TOOLTIP_SUFFIX = "(national avg = 100)";
export const NOT_REPORTABLE_NOTE = "Not reportable: covers < 5 % of the area";
export const NATION_RING_LABEL = "national average";
export const NATION_SCORE_HEADER = "vs national avg";
export const WORLD_SHARE_HEADER = "% of world range";
