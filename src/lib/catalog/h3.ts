// The `h3` hook: a collection of the platform `h3` profile (1.0 or 1.1, `@oceanmetrics/catalog`
// `schemas/h3.schema.json`) is drawn as H3 hexagons from its own Parquet, by the map package's release
// provider (`h3ReleaseSlot`, in MapLibre's worker) behind the Collections lens' layer seam. This module only
// PARSES what the profile says into the shape the lazy H3 layer (`src/lens/collection/h3/`) reads; it imports
// nothing, so the static path pays for the parser alone. Never a collection id: the profile is the hook.
//
// What it reads, all from the collection document:
//   - the profile itself: `stac_extensions` names `.../schemas/h3/v1.x.y/schema.json`, or the collection
//     carries `h3:resolutions` and `h3:layout.template` (a document that predates the extension url);
//   - `h3:resolutions`, `h3:layout` (`template`, `parent_template`, `parent_res`, `row_group_rows`);
//   - `h3:periods`: one set (1.0) or a list of sets (1.1), each `{grain, values, placeholder, resolutions,
//     template}`; a set without a placeholder is dropped (the profile's own rule);
//   - `table:columns`: the numeric columns other than the cell id are the indicators, labelled and ordered
//     by the cube dimension whose values they are (`cube:dimensions.<k>.values`), the default `atlas:metric`;
//   - the view dimensions: the cube dimension of the indicator columns, the temporal one holding the period
//     values, the one holding `h3:resolutions` (the `dim.<key>=` URL keys, `Sel.dim`; they select no Item);
//   - the assets by role: `legend` (stats.parquet), `search` (taxon_groups.parquet), the species lookup
//     (`h3:species_table.lookup.href`), the heads (`h3:heads`);
//   - `h3:species_table` (the species x cell x count table: resolutions, columns, lookup) and the producer's
//     flat cell-sorted copy for one cell's list (`obis:species.flat`, obisindicators 0.11; 0.12: one file per
//     resolution 1 to 3, res 3 split by res-1 parent), the lineage alone and the lookup's EOV column
//     (`obis:species.lineage`, `.eov`, 0.12), and the per-kind parent split (`obis:layers.<kind>.parent_res`: the
//     taxon layers split by res-0 parent, not res 2).
import type { StacCollection } from "./types";

export const H3_HOOK = "h3" as const;

const PROFILE_URL_RE = /\/schemas\/h3\/v1\.\d+\.\d+\/schema\.json$/;

export interface H3PeriodSet {
  grain: string;
  values: string[];
  placeholder: string;
  resolutions: number[];
  template?: string;
}

export interface H3Indicator {
  /** the column name (`es`, `sp`, `shannon`, `simpson`, `n`). */
  value: string;
  label: string;
}

export interface H3SpeciesTable {
  hrefTemplate: string;
  resolutions: number[];
  partitionBy: string[];
  columns: {
    cell: string;
    species: string;
    count: string;
    nameKey: string | null;
    yearMin: string | null;
    yearMax: string | null;
  };
  lookup: {
    href: string;
    key: string;
    lineageColumn: string | null;
    rankColumns: Record<string, string>;
    nameColumn: string;
  } | null;
}

export interface H3SpeciesFlat {
  hrefTemplate: string;
  resolutions: number[];
  /** `.../species_flat/res={res}/p={parent}.parquet`, absolute */
  parentTemplate?: string;
  /** the split resolutions and their parents' resolution (`{"3": 1}`) */
  parentRes?: Record<string, number>;
}

export interface H3Spec {
  resolutions: number[];
  layout: {
    template: string;
    parentTemplate?: string;
    parentRes?: Record<string, number>;
    rowGroupRows?: number;
  };
  periods: H3PeriodSet[];
  indicators: H3Indicator[];
  defaultIndicator: string;
  /** the cube dimension keys of the view dimensions (`dim.<key>=`), null when the cube has none. */
  viewDims: { indicator: string | null; period: string | null; res: string | null };
  /** the period dimension's labels by value (`1990s` -> "1990s", `all` -> "All years"). */
  periodLabels: Record<string, string>;
  /** the cube's own token for all time (`all`), else "all". */
  allPeriod: string;
  /** stats.parquet (the legend's source, role `legend`), absolute. */
  stats: string | null;
  /** taxon_groups.parquet (the taxa to search, role `search`), absolute. */
  taxonGroups: string | null;
  /** heads.json and the layer kind the heads are served under (`h3:heads`). */
  heads: { href: string; layer: string } | null;
  speciesTable: H3SpeciesTable | null;
  /** one file per resolution sorted by cell id, for one cell's species (`{res}` in the template); obisindicators 0.12
   * splits a resolution by a coarser parent (`parent_template` with `{res}` and `{parent}`, `parent_res` `{"3": 1}`). */
  speciesFlat: H3SpeciesFlat | null;
  /** the lineage alone (`obis:species.lineage`: `aphiaid, name_key, lineage`, sorted by aphiaid), obisindicators 0.12 */
  speciesLineage: { href: string; key: string; column: string } | null;
  /** the lookup's EOV column (`obis:species.eov`: the EOV whose layer counts the aphiaid) and its taxa per EOV */
  speciesEov: { column: string; counts: Record<string, number> } | null;
  /** the parent split per layer kind (`all`, `eov`, `taxon`) when the producer states it. */
  parentResByKind: Record<string, Record<string, number>>;
  /** the release id (`obis:release`), for file names and the cite line. */
  release: string | null;
  /** the release's metadata (`release.json`: the asset `release`, else the `related` link to a release.json), absolute. */
  releaseMeta: string | null;
  /** the release's file manifest (`files.parquet`, the asset `files`), absolute: the Reproduce snippet lists from it. */
  files: string | null;
  /** the collection's own citation (`sci:citation`), when it publishes one. */
  citation: string | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const ints = (v: unknown): number[] =>
  Array.isArray(v)
    ? v.filter((x): x is number => Number.isInteger(x) && x >= 0 && x <= 15).sort((a, b) => a - b)
    : [];
const resMap = (v: unknown): Record<string, number> | undefined => {
  if (!isRecord(v)) return undefined;
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v)) if (Number.isInteger(n)) out[k] = n as number;
  return Object.keys(out).length ? out : undefined;
};

/** a document of the `h3` profile: the extension url, or the profile's two required fields. */
export function isH3Collection(c: StacCollection | null | undefined): boolean {
  if (!c) return false;
  const ext = (c as { stac_extensions?: unknown }).stac_extensions;
  if (Array.isArray(ext) && ext.some((e) => typeof e === "string" && PROFILE_URL_RE.test(e)))
    return true;
  const layout = (c as Record<string, unknown>)["h3:layout"];
  return (
    ints((c as Record<string, unknown>)["h3:resolutions"]).length > 0 &&
    isRecord(layout) &&
    !!str(layout.template)
  );
}

/** `h3:periods` as sets (one set is a list of one; a set without a placeholder or values is dropped). */
export function periodSetsOf(c: Record<string, unknown>, fallbackRes: number[]): H3PeriodSet[] {
  const raw = c["h3:periods"];
  const list = Array.isArray(raw) ? raw : isRecord(raw) ? [raw] : [];
  const out: H3PeriodSet[] = [];
  for (const s of list) {
    if (!isRecord(s)) continue;
    const grain = str(s.grain);
    const placeholder = str(s.placeholder);
    const values = Array.isArray(s.values)
      ? s.values.filter((v): v is string => typeof v === "string")
      : [];
    if (!grain || !placeholder || values.length === 0) continue;
    const resolutions = ints(s.resolutions);
    const template = str(s.template);
    out.push({
      grain,
      placeholder,
      values,
      resolutions: resolutions.length ? resolutions : fallbackRes,
      ...(template ? { template } : {}),
    });
  }
  return out;
}

/** an asset's href made absolute against the collection's own url (`atlas:url`, else its `self` link), its
 * template braces kept (`new URL` percent-encodes `{res}`). */
function absolute(c: Record<string, unknown>, href: string | null): string | null {
  if (!href) return null;
  if (/^https?:\/\//i.test(href)) return href;
  const self = Array.isArray(c.links)
    ? (c.links as { rel?: string; href?: string }[]).find((l) => l?.rel === "self")?.href
    : undefined;
  const base = str(c["atlas:url"]) ?? str(self);
  if (!base) return null;
  try {
    return new URL(href, base).href.replace(/%7B/gi, "{").replace(/%7D/gi, "}");
  } catch {
    return null;
  }
}

function assetByRole(c: Record<string, unknown>, role: string): string | null {
  const assets = c.assets;
  if (!isRecord(assets)) return null;
  for (const a of Object.values(assets)) {
    if (isRecord(a) && Array.isArray(a.roles) && a.roles.includes(role))
      return absolute(c, str(a.href));
  }
  return null;
}

function speciesTableOf(c: Record<string, unknown>): H3SpeciesTable | null {
  const t = c["h3:species_table"];
  if (!isRecord(t) || !str(t.href_template) || !isRecord(t.columns)) return null;
  const cols = t.columns;
  const cell = str(cols.cell);
  const species = str(cols.species);
  const count = str(cols.count);
  if (!cell || !species || !count) return null;
  const lk = isRecord(t.lookup) ? t.lookup : null;
  const rankColumns: Record<string, string> = {};
  if (lk && isRecord(lk.rank_columns))
    for (const [k, v] of Object.entries(lk.rank_columns))
      if (typeof v === "string") rankColumns[k] = v;
  return {
    hrefTemplate: absolute(c, str(t.href_template))!,
    resolutions: ints(t.resolutions),
    partitionBy: Array.isArray(t.partition_by)
      ? t.partition_by.filter((x): x is string => typeof x === "string")
      : [],
    columns: {
      cell,
      species,
      count,
      nameKey: str(cols.name_key),
      yearMin: str(cols.year_min),
      yearMax: str(cols.year_max),
    },
    lookup:
      lk && str(lk.href) && str(lk.key)
        ? {
            href: absolute(c, str(lk.href))!,
            key: str(lk.key)!,
            lineageColumn: str(lk.lineage_column),
            rankColumns,
            nameColumn: str(lk.name_column) ?? "species",
          }
        : null,
  };
}

/** the h3 profile's view of a collection, or null when it is not one (or has nothing to draw). */
export function parseH3(collection: StacCollection | null | undefined): H3Spec | null {
  if (!isH3Collection(collection)) return null;
  const c = collection as unknown as Record<string, unknown>;
  const resolutions = ints(c["h3:resolutions"]);
  const lay = c["h3:layout"] as Record<string, unknown>;
  const template = absolute(c, str(lay.template));
  if (!template || resolutions.length === 0) return null;
  const parentTemplate = absolute(c, str(lay.parent_template));
  const parentRes = resMap(lay.parent_res);
  const rgr = lay.row_group_rows;

  // indicators: the numeric table columns but the cell ids, in the cube's order and words
  const columns = Array.isArray(c["table:columns"]) ? (c["table:columns"] as unknown[]) : [];
  const numeric = columns
    .filter(isRecord)
    .filter((col) =>
      /^(BIGINT|INTEGER|SMALLINT|DOUBLE|FLOAT|REAL|DECIMAL|HUGEINT|INT\d*|UINT\d*)/i.test(
        String(col.type ?? ""),
      ),
    )
    .map((col) => String(col.name))
    .filter((n) => n !== "cell_id" && n !== str(c["h3:cell_column"]));
  const cube = isRecord(c["cube:dimensions"])
    ? (c["cube:dimensions"] as Record<string, Record<string, unknown>>)
    : {};
  const periods = periodSetsOf(c, resolutions);
  const periodTokens = new Set(periods.flatMap((s) => s.values.flatMap((v) => [v, `${v}s`])));
  let indicatorDim: string | null = null;
  let periodDim: string | null = null;
  let resDim: string | null = null;
  for (const [k, d] of Object.entries(cube)) {
    const vals = Array.isArray(d?.values) ? d.values.map(String) : [];
    if (!indicatorDim && vals.length > 0 && vals.every((v) => numeric.includes(v)))
      indicatorDim = k;
    else if (!periodDim && d?.type === "temporal" && vals.some((v) => periodTokens.has(v)))
      periodDim = k;
    else if (!resDim && vals.length > 0 && vals.every((v) => resolutions.includes(Number(v))))
      resDim = k;
  }
  const labelsOf = (k: string | null): Record<string, string> =>
    k && isRecord(cube[k]?.["atlas:labels"])
      ? (cube[k]["atlas:labels"] as Record<string, string>)
      : {};
  const indLabels = labelsOf(indicatorDim);
  const order = indicatorDim ? (cube[indicatorDim].values as unknown[]).map(String) : numeric;
  const indicators = order
    .filter((v) => numeric.includes(v))
    .map((value) => ({ value, label: indLabels[value] ?? value }));
  if (indicators.length === 0) return null;
  const metric = str(c["atlas:metric"]);
  const allPeriod = periodDim
    ? ((cube[periodDim].values as unknown[]).map(String).find((v) => !periodTokens.has(v)) ?? "all")
    : "all";

  const headsRaw = c["h3:heads"];
  const heads =
    isRecord(headsRaw) && str(headsRaw.href) && str(headsRaw.layer)
      ? { href: absolute(c, str(headsRaw.href))!, layer: str(headsRaw.layer)! }
      : null;
  const sp = isRecord(c["obis:species"]) ? (c["obis:species"] as Record<string, unknown>) : null;
  const flat = sp && isRecord(sp.flat) ? sp.flat : null;
  const parentResByKind: Record<string, Record<string, number>> = {};
  if (isRecord(c["obis:layers"]))
    for (const [k, v] of Object.entries(c["obis:layers"] as Record<string, unknown>)) {
      const pr = isRecord(v) ? resMap(v.parent_res) : undefined;
      if (pr) parentResByKind[k] = pr;
    }
  const speciesTable = speciesTableOf(c);
  return {
    resolutions,
    layout: {
      template,
      ...(parentTemplate ? { parentTemplate } : {}),
      ...(parentRes ? { parentRes } : {}),
      ...(Number.isInteger(rgr) ? { rowGroupRows: rgr as number } : {}),
    },
    periods,
    indicators,
    defaultIndicator:
      metric && indicators.some((i) => i.value === metric) ? metric : indicators[0].value,
    viewDims: { indicator: indicatorDim, period: periodDim, res: resDim },
    periodLabels: labelsOf(periodDim),
    allPeriod,
    stats: assetByRole(c, "legend"),
    taxonGroups: assetByRole(c, "search"),
    heads,
    speciesTable,
    speciesFlat: flat ? speciesFlatOf(c, flat) : null,
    speciesLineage: sp ? speciesLineageOf(c, sp.lineage) : null,
    speciesEov: sp ? speciesEovOf(sp.eov) : null,
    parentResByKind,
    release: str(c["obis:release"]),
    releaseMeta: assetByKey(c, "release") ?? relatedReleaseJson(c),
    files: assetByKey(c, "files"),
    citation: str(c["sci:citation"]),
  };
}

function speciesFlatOf(
  c: Record<string, unknown>,
  flat: Record<string, unknown>,
): H3SpeciesFlat | null {
  const hrefTemplate = absolute(c, str(flat.href_template));
  if (!hrefTemplate) return null;
  const parentTemplate = absolute(c, str(flat.parent_template));
  const parentRes = resMap(flat.parent_res);
  return {
    hrefTemplate,
    resolutions: ints(flat.resolutions),
    ...(parentTemplate && parentTemplate.includes("{parent}") && parentRes
      ? { parentTemplate, parentRes }
      : {}),
  };
}

function speciesLineageOf(c: Record<string, unknown>, v: unknown): H3Spec["speciesLineage"] {
  if (!isRecord(v)) return null;
  const href = absolute(c, str(v.href));
  return href
    ? { href, key: str(v.key) ?? "aphiaid", column: str(v.lineage_column) ?? "lineage" }
    : null;
}

function speciesEovOf(v: unknown): H3Spec["speciesEov"] {
  if (!isRecord(v) || !str(v.column)) return null;
  const counts: Record<string, number> = {};
  if (isRecord(v.n))
    for (const [k, n] of Object.entries(v.n)) if (Number.isInteger(n)) counts[k] = n as number;
  return { column: str(v.column)!, counts };
}

function assetByKey(c: Record<string, unknown>, key: string): string | null {
  const a = isRecord(c.assets) ? c.assets[key] : null;
  return isRecord(a) ? absolute(c, str(a.href)) : null;
}

function relatedReleaseJson(c: Record<string, unknown>): string | null {
  const l = Array.isArray(c.links)
    ? (c.links as { rel?: string; href?: string }[]).find(
        (x) => x?.rel === "related" && /release\.json$/.test(String(x?.href ?? "")),
      )
    : undefined;
  return l ? absolute(c, str(l.href)) : null;
}
