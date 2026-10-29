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
 * msens `score_share_metrics`); `primprod_v10` has only `primprod_coverage`; `null` for any other key. */
export function companionKey(metricKey: string, suffix: string): string | null {
  const m = /^extrisk_([a-z_]+)_v10_global$/.exec(metricKey);
  if (m) return `extrisk_${m[1]}_${suffix}`;
  // productivity is an environmental layer, not a species range: it has a coverage but no share of
  // the world's range (`pct_world`, `share_global`, `n_species` are species companions)
  return metricKey === "primprod_v10" && suffix === "coverage" ? "primprod_coverage" : null;
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

// ---- the national component SET and the release-level petal scale ------------------------------

/** the zone rows of every unit of a boot (`boot.zones[unit][*]`), as `[unit, metrics]` pairs. */
function zoneMetricMaps(boot: unknown, onlyUnit?: string): Record<string, unknown>[] {
  const zones = (boot as { zones?: Record<string, unknown> } | null | undefined)?.zones;
  if (!zones || typeof zones !== "object") return [];
  const out: Record<string, unknown>[] = [];
  for (const [unit, rows] of Object.entries(zones)) {
    if (onlyUnit !== undefined && unit !== onlyUnit) continue;
    if (!Array.isArray(rows)) continue;
    for (const r of rows as { metrics?: unknown }[]) {
      if (r && typeof r === "object" && r.metrics && typeof r.metrics === "object")
        out.push(r.metrics as Record<string, unknown>);
    }
  }
  return out;
}

/**
 * A scope's component `metric_key`s for the zone flower and the zones table. A release publishes a
 * `boot.layers` row only for a metric with cell rows, so a zone-only component (v10's
 * `primprod_v10`) is no layer: the national set is the boot's national component LAYERS (in their
 * own `order`) plus every national-pattern key found in any zone's `metrics`, appended
 * alphabetically. The layer picker keeps listing only drawable layers; this is the set a place's
 * flower and the table read. The ecoregion set is its layers (the ecoregion flower reads zone
 * metrics by pattern, unchanged).
 */
export function scopeComponentSet(
  layers: readonly { metric_key: string; order: number; category: string; scope?: unknown }[],
  boot: unknown,
  scope: Scope,
): string[] {
  const fromLayers = layers
    .filter((l) => l.category === "component" && rowScope(l) === scope)
    .sort((a, b) => a.order - b.order)
    .map((l) => l.metric_key);
  if (scope !== "nation") return fromLayers;
  const seen = new Set(fromLayers);
  const extra = new Set<string>();
  for (const metrics of zoneMetricMaps(boot))
    for (const k of Object.keys(metrics))
      if (!seen.has(k) && isComponentKey(k, "nation")) extra.add(k);
  return [...fromLayers, ...[...extra].sort()];
}

/** the smallest 1, 2 or 5 times a power of ten that is at least `v`. */
export function niceCeil(v: number): number {
  if (!(v > 0) || !Number.isFinite(v)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

/** the 95th percentile (linear interpolation) of `values`; `NaN` for none. */
export function percentile95(values: readonly number[]): number {
  if (!values.length) return NaN;
  const v = [...values].sort((a, b) => a - b);
  const pos = 0.95 * (v.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

/** the floor of the national petal scale: the national average (100) must sit well inside the plot. */
export const NATION_SCALE_FLOOR = 200;

/**
 * v10 P6, the ONE national petal scale of a release, shared by every zone flower and every cell
 * flower so petal lengths compare between places: `niceCeil(max(200, p95))` over every national
 * component value of the drawable unit's zones (`componentKeys`, `unit`). A cell's own maximum (up
 * to millions) and a layer's cell p99 (about 2000 on v10, against zone values of 3 to 800) never
 * set it: a value above the scale is drawn to the rim and marked.
 */
export function nationScaleMax(
  boot: unknown,
  unit: string,
  componentKeys: readonly string[],
): number {
  const keys = new Set(componentKeys);
  const values: number[] = [];
  for (const metrics of zoneMetricMaps(boot, unit))
    for (const [k, v] of Object.entries(metrics))
      if (keys.has(k) && typeof v === "number" && Number.isFinite(v)) values.push(v);
  const p95 = percentile95(values);
  return niceCeil(Math.max(NATION_SCALE_FLOOR, Number.isFinite(p95) ? p95 : 0));
}

/** v10 P6: a national label inside its own mode loses the scope's suffix ("Birds, across the nation" ->
 * "Birds"); the full label stays in tooltips. The suffix is the toggle's own words. */
const SCOPE_SUFFIX_RE = new RegExp(`,?\\s*${SCOPE_LABEL.nation.toLowerCase()}\\s*$`, "i");
export function stripScopeSuffix(label: string): string {
  const out = label.replace(SCOPE_SUFFIX_RE, "").trim();
  return out || label;
}
