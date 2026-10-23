// The H3 layer's view (build week 4, step 5): what the URL (`Sel`) and the active Item ask of an `h3` collection,
// resolved against what the collection publishes. Pure, plain module (Node-tested by tests/obis/view.test.ts); the
// lazy layer (`layer.svelte.ts`) calls it, the map package draws what it returns.
//
//   Sel                                 -> H3View
//   ?i=<item>                           -> the Item (all, an EOV): its data, decade and year assets
//   &taxon=<rank>:<name>                -> a taxon layer of `taxon_groups.parquet` (`url_path`), filtering all
//   &dim.indicator=es|sp|shannon|...    -> the fill column (every tile carries all five: no refetch)
//   &dim.period=all|1990s|2015          -> the period set (`h3:periods`) and its value, else all time
//   &res=auto|1..7                      -> the resolution rule: auto by zoom, or pinned and clamped to the ladder
//
// A request the layer cannot serve is clamped, never an error, and says so (`notes`): a period on a taxon layer
// (the release has periods for all taxa and the EOVs only), a pinned resolution past the period's ladder.
import type { H3CollectionLike, H3PeriodSetLike, H3ReleaseItem } from "@oceanmetrics/map";
import type { H3PeriodSet, H3Spec } from "../../../lib/catalog/h3";
import type { StacItem } from "../../../lib/catalog/types";
import type { Sel } from "../../../lib/state/types";

/** a taxon layer of the search asset (`taxon_groups.parquet`): `kind` taxon (or eov), the rank and name, the
 * records, and its path under the release (`url_path`, url-ready: a space is `%2520`, as the store holds it). */
export interface TaxonRow {
  kind: string;
  rank: string;
  taxon: string;
  label: string;
  n: number;
  urlPath: string;
}

/** a head (`heads.json`): a taxon above class served by a pre-aggregated layer. */
export interface HeadRow {
  aphiaid: number;
  name: string;
  rank: string;
  servedBy: string;
  /** the layer path (`taxon/rank=kingdom/taxon=Animalia`, or `all`). */
  layer: string;
}

/** what the slot draws: the collection as the map package reads it (templates resolved for the Item or the taxon),
 * the item for its legend row in stats.parquet, and the kind of layer. */
export interface ReleaseTarget {
  collection: H3CollectionLike;
  item: H3ReleaseItem;
  /** `all`, `eov` (an Item of the cube), `taxon` (a row of the search asset) */
  kind: string;
  /** the label of the layer (the Item's title, the taxon's label) */
  label: string;
  /** the period sets this layer publishes (none for a taxon layer) */
  periods: H3PeriodSet[];
}

export interface H3View {
  indicator: string;
  /** the URL token of the period (`all`, `1990s`, `2015`) */
  period: string;
  /** the set and value the token names; null for all time */
  periodRef: { grain: string; value: string } | null;
  /** the resolutions this layer and period publish */
  ladder: number[];
  res: "auto" | number;
  notes: string[];
}

const trimSlash = (s: string) => s.replace(/\/+$/, "");

/** the url of an Item asset folder (`../eov/eov=fish/`) made absolute against the Item's own url, braces kept. */
function itemHref(item: StacItem, href: string): string | null {
  if (/^https?:\/\//i.test(href)) return href;
  const base = item["atlas:url"] as string | undefined;
  if (!base) return null;
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

/** an asset's folder + its `h3:template` (or `h3:parent_template`), or null when the Item has no such asset. */
function assetTemplate(item: StacItem, key: string, field = "h3:template"): string | null {
  const a = item.assets?.[key] as Record<string, unknown> | undefined;
  const folder = a && typeof a.href === "string" ? itemHref(item, a.href) : null;
  const t = a?.[field];
  return folder && typeof t === "string" ? `${trimSlash(folder)}/${t}` : null;
}

/** the kind and key of an Item from its data folder's last segment: `all/` -> all, `eov/eov=fish/` -> eov, fish */
export function itemKindOf(item: StacItem): { layer: string; key?: string } {
  const href = (item.assets?.data as { href?: string } | undefined)?.href ?? "";
  const seg = trimSlash(href).split("/").pop() ?? "";
  const eq = seg.indexOf("=");
  if (eq > 0) return { layer: seg.slice(0, eq), key: seg.slice(eq + 1) };
  return { layer: seg || "all" };
}

/** the period sets of an Item: the collection's sets whose placeholder an Item asset's template carries, with
 * that asset's template (`decade={decade}/res={res}/data_0.parquet` under `../decade/eov/eov=fish/`). */
function itemPeriods(spec: H3Spec, item: StacItem): H3PeriodSet[] {
  const out: H3PeriodSet[] = [];
  for (const set of spec.periods) {
    for (const key of Object.keys(item.assets ?? {})) {
      const t = assetTemplate(item, key);
      if (t && t.includes(`{${set.placeholder}}`)) {
        out.push({ ...set, template: t });
        break;
      }
    }
  }
  return out;
}

function likeOf(
  spec: H3Spec,
  id: string,
  layout: H3CollectionLike["h3:layout"],
  periods: H3PeriodSet[],
): H3CollectionLike {
  const cols = spec.indicators.map((i) => ({ name: i.value, type: "DOUBLE" }));
  return {
    id,
    ...(spec.stats ? { assets: { stats: { href: spec.stats, roles: ["legend"] } } } : {}),
    "h3:resolutions": spec.resolutions,
    "h3:cell_column": "h3",
    "h3:cell_type": "string",
    "h3:layout": layout,
    "h3:periods": periods.map((p): H3PeriodSetLike => ({
      grain: p.grain,
      values: p.values,
      placeholder: p.placeholder,
      resolutions: p.resolutions,
      ...(p.template ? { template: p.template } : {}),
    })),
    // the cell id first: an int64 the reader prunes row groups by
    "table:columns": [{ name: "cell_id", type: "BIGINT" }, ...cols],
  };
}

/** the folder the search asset's `url_path` values are relative to (taxon_groups.parquet's own folder). */
export function searchBase(spec: H3Spec): string | null {
  if (!spec.taxonGroups) return null;
  return spec.taxonGroups.slice(0, spec.taxonGroups.lastIndexOf("/") + 1);
}

/** what the slot draws for the active Item, or for a taxon layer filtering it. */
export function releaseTarget(
  spec: H3Spec,
  collectionId: string,
  item: StacItem,
  taxon: TaxonRow | null = null,
): ReleaseTarget | null {
  const data = assetTemplate(item, "data");
  const parent = assetTemplate(item, "data", "h3:parent_template");
  if (taxon) {
    const base = searchBase(spec);
    const tmpl = (item.assets?.data as Record<string, unknown> | undefined)?.["h3:template"];
    if (!base || typeof tmpl !== "string") return null;
    const ptmpl = (item.assets?.data as Record<string, unknown> | undefined)?.[
      "h3:parent_template"
    ];
    const folder = `${base}${taxon.urlPath}`;
    const parentRes = spec.parentResByKind[taxon.kind] ?? spec.layout.parentRes;
    return {
      collection: likeOf(
        spec,
        collectionId,
        {
          template: `${folder}/${tmpl}`,
          ...(typeof ptmpl === "string" && parentRes
            ? { parent_template: `${folder}/${ptmpl}`, parent_res: parentRes }
            : {}),
        },
        [],
      ),
      item: { layer: taxon.kind, key: taxon.taxon, rank: taxon.rank },
      kind: taxon.kind,
      label: taxon.label,
      periods: [],
    };
  }
  if (!data) return null;
  const k = itemKindOf(item);
  const periods = itemPeriods(spec, item);
  const parentRes = spec.parentResByKind[k.layer] ?? spec.layout.parentRes;
  const title = item.properties?.title;
  return {
    collection: likeOf(
      spec,
      collectionId,
      {
        template: data,
        ...(parent && parentRes ? { parent_template: parent, parent_res: parentRes } : {}),
      },
      periods,
    ),
    item: k.key ? { layer: k.layer, key: k.key } : { layer: k.layer },
    kind: k.layer,
    label: typeof title === "string" && title.trim() ? title.trim() : item.id,
    periods,
  };
}

/** the set and value a URL period token names among `sets`: a decade is written `<yyy0>s` (the cube's token for
 * the decade set's `1990`), a year as itself; null for all time or a token no set has. */
export function periodRefOf(
  sets: readonly H3PeriodSet[],
  token: string | undefined,
): { set: H3PeriodSet; value: string } | null {
  if (!token) return null;
  for (const set of sets) {
    const v = set.grain === "decade" ? (token.endsWith("s") ? token.slice(0, -1) : null) : token;
    if (v !== null && set.values.includes(v)) return { set, value: v };
  }
  return null;
}

/** the URL token of a period (`1990s` for the decade 1990, `2015` for the year). */
export const periodToken = (grain: string, value: string) =>
  grain === "decade" ? `${value}s` : value;

/** the view the URL asks of the target, clamped to what it publishes. */
export function h3ViewOf(
  sel: Pick<Sel, "dim" | "res">,
  spec: H3Spec,
  target: ReleaseTarget,
): H3View {
  const notes: string[] = [];
  const dims = sel.dim ?? {};
  const ik = spec.viewDims.indicator ?? "indicator";
  const pk = spec.viewDims.period ?? "period";
  const wantInd = dims[ik];
  const indicator =
    wantInd && spec.indicators.some((i) => i.value === wantInd) ? wantInd : spec.defaultIndicator;
  const token = dims[pk];
  let period = spec.allPeriod;
  let periodRef: H3View["periodRef"] = null;
  let ladder = spec.resolutions;
  if (token && token !== spec.allPeriod) {
    const ref = periodRefOf(target.periods, token);
    if (ref) {
      period = token;
      periodRef = { grain: ref.set.grain, value: ref.value };
      ladder = ref.set.resolutions;
    } else if (periodRefOf(spec.periods, token)) {
      notes.push(`Periods: all taxa and the EOVs only. ${target.label} is shown over all years.`);
    } else {
      notes.push(`The release has no period ${token}: all years are shown.`);
    }
  }
  let res: H3View["res"] = "auto";
  if (sel.res !== undefined) {
    const max = Math.max(...ladder);
    const min = Math.min(...ladder);
    res = Math.min(max, Math.max(min, sel.res));
    if (res !== sel.res)
      notes.push(
        periodRef
          ? `A ${periodRef.grain} layer is published up to res ${max}: res ${sel.res} is shown as res ${res}.`
          : `This layer is published at res ${min} to ${max}: res ${sel.res} is shown as res ${res}.`,
      );
  }
  return { indicator, period, periodRef, ladder, res, notes };
}

/** the `taxon=` value of a row (`class:Aves`) and the row a `taxon=` value names (rank and name exact). */
export const taxonParam = (r: Pick<TaxonRow, "rank" | "taxon">) => `${r.rank}:${r.taxon}`;

export function taxonRowOf(rows: readonly TaxonRow[], param: string | undefined): TaxonRow | null {
  if (!param || param.startsWith("aphia:")) return null;
  const i = param.indexOf(":");
  if (i <= 0) return null;
  const rank = param.slice(0, i);
  const name = param.slice(i + 1);
  return rows.find((r) => r.kind !== "eov" && r.rank === rank && r.taxon === name) ?? null;
}

/**
 * `taxon=aphia:<id>`: the head that serves it (`heads.json` `served_by`): a head layer or a rank layer is the taxon
 * row of its path, the all-taxa layer is no taxon at all (`all`). A WoRMS id that is not a head is a subtree the page
 * computes from the species table (`subtree: true`, `subtree.ts`).
 */
export function headRowOf(
  heads: readonly HeadRow[],
  rows: readonly TaxonRow[],
  param: string | undefined,
): {
  row: TaxonRow | null;
  all: boolean;
  head: HeadRow | null;
  reason: string | null;
  subtree: boolean;
} {
  const m = /^aphia:(\d+)$/.exec(param ?? "");
  if (!m) return { row: null, all: false, head: null, reason: null, subtree: false };
  const id = Number(m[1]);
  const head = heads.find((h) => h.aphiaid === id) ?? null;
  if (!head) return { row: null, all: false, head: null, reason: null, subtree: true };
  if (head.layer === "all" || head.servedBy === "all")
    return { row: null, all: true, head, reason: null, subtree: false };
  const row =
    rows.find(
      (r) => r.urlPath === head.layer || `taxon/rank=${r.rank}/taxon=${r.taxon}` === head.layer,
    ) ?? null;
  return row
    ? { row, all: false, head, reason: null, subtree: false }
    : {
        row: null,
        all: false,
        head,
        reason: `${head.name} is served by ${head.layer}, which this release does not list.`,
        subtree: false,
      };
}

/** what the slot draws for a WoRMS subtree: the cells computed in the page, one resolution in one Parquet (a `blob:`
 * url, the map package's reader opens it by Range like a release file), no stats.parquet (the legend is the computed
 * cells' own), the decades of the species table's decade variant as its periods. */
export function subtreeTarget(
  spec: H3Spec,
  collectionId: string,
  o: {
    href: string;
    res: number;
    name: string;
    rank: string | null;
    decades: readonly string[];
    decadeRes: readonly number[];
  },
): ReleaseTarget {
  const cols = spec.indicators.map((i) => ({
    name: i.value,
    type: i.value === "n" || i.value === "sp" ? "BIGINT" : "DOUBLE",
  }));
  const decadeSet = spec.periods.find((p) => p.grain === "decade");
  return {
    collection: {
      id: collectionId,
      "h3:resolutions": [o.res],
      "h3:cell_column": "h3",
      "h3:cell_type": "string",
      "h3:layout": { template: o.href },
      "h3:periods": [],
      "table:columns": [{ name: "cell_id", type: "BIGINT" }, ...cols],
    },
    item: { layer: "subtree", key: o.name, ...(o.rank ? { rank: o.rank.toLowerCase() } : {}) },
    kind: "subtree",
    label: o.name,
    periods:
      decadeSet && o.decades.length
        ? [
            {
              grain: "decade",
              values: [...o.decades],
              placeholder: decadeSet.placeholder,
              resolutions: [...o.decadeRes],
            },
          ]
        : [],
  };
}
