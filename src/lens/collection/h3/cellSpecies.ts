// The Cell pane's species list (build week 4, step 5; obis-hex `cell/species.ts` without h3t): the species behind
// a hexagon's records, read from the release's own species table, never a service. The flat copy of the table
// (`species_flat/res=3.parquet`: `cell_id, name_key, aphiaid, n, year_min, year_max`, sorted by cell id in small
// row groups) holds every species of every res-3 cell, so:
//   - a res-3 hexagon reads its own rows (one cell id);
//   - a coarser hexagon (res 1, 2) reads its res-3 children, one contiguous cell-id range (`childRange`), summed
//     by species: the records add up and the species are the union, so the list is the hexagon's own, exactly
//     (81197ffffffffff, res 1: 16,499,270 records of 8,963 species, as the map's `n` and `sp`);
//   - a finer hexagon (res 4 to 7) has no flat copy: the list is its res-3 parent's, and says so.
// The names and ranks come from the lookup (`species/species.parquet`), read once per page (only the columns the
// list shows). A taxon layer of rank phylum, class, order or family filters the list by that rank column; the EOVs
// and the heads above class are not a column of the lookup, so their list is every taxon's, and says so. Pure
// functions plus the readers; Node-tested (tests/obis/cellSpecies.test.ts, on a synthetic table).
import {
  COMPRESSORS,
  cellIdOf,
  cellIdRes,
  childRange,
  openRangeFile,
  parentId,
  speciesForCell,
  type ReadStats,
  type ReleaseReader,
} from "@oceanmetrics/map";
import type { H3Spec } from "../../../lib/catalog/h3";

export interface SpeciesRow {
  aphiaid: number;
  nameKey: number | null;
  species: string;
  phylum: string | null;
  class: string | null;
  order: string | null;
  family: string | null;
  records: number;
  yearMin: number | null;
  yearMax: number | null;
}

export interface CellSpeciesList {
  h3: string;
  res: number;
  /** the resolution of the table read and how the hexagon relates to it */
  tableRes: number;
  scope: "cell" | "children" | "parent";
  rows: SpeciesRow[];
  /** sum of records, and the distinct names (richness counts names), over `rows` */
  records: number;
  names: number;
  notes: string[];
  /** the bytes and requests of the species table's read (the footer too on the page's first hexagon) */
  bytes: number;
  requests: number;
  /** row groups read and skipped by the `cell_id` statistics */
  groupsRead: number;
  groupsSkipped: number;
  /** the lookup's bytes when this hexagon's read was the page's first (the names, once per page), else 0 */
  lookupBytes: number;
  ms: number;
}

export const TOP_SPECIES = 10;
export const MAX_ROWS = 500;
/** the lists kept (a revisited hexagon reads nothing) */
export const CACHE_MAX = 32;

export const wormsUrl = (aphiaid: number) =>
  `https://www.marinespecies.org/aphia.php?p=taxdetails&id=${aphiaid}`;

/** which rows of the flat table a hexagon reads: its own id, its children's range, or its parent's id. */
export function cellPlan(
  h3: string,
  flatRes: readonly number[],
): {
  res: number;
  tableRes: number;
  scope: CellSpeciesList["scope"];
  range: [bigint, bigint];
} | null {
  if (!/^[0-9a-f]{15}$/.test(h3) || flatRes.length === 0) return null;
  const id = cellIdOf(h3);
  const res = cellIdRes(id);
  if (flatRes.includes(res)) return { res, tableRes: res, scope: "cell", range: [id, id] };
  const finer = flatRes.filter((r) => r > res).sort((a, b) => a - b)[0];
  if (finer !== undefined)
    return { res, tableRes: finer, scope: "children", range: childRange(id, finer) };
  const coarser = flatRes.filter((r) => r < res).sort((a, b) => b - a)[0];
  const p = parentId(id, coarser);
  return { res, tableRes: coarser, scope: "parent", range: [p, p] };
}

/** the flat rows summed by species: records add, the first year is the least, the last the greatest. */
export function sumBySpecies(cols: {
  aphiaid: ArrayLike<number>;
  n: ArrayLike<number>;
  name_key?: ArrayLike<number>;
  year_min?: ArrayLike<number>;
  year_max?: ArrayLike<number>;
}): Map<
  number,
  { n: number; nameKey: number | null; yearMin: number | null; yearMax: number | null }
> {
  const out = new Map<
    number,
    { n: number; nameKey: number | null; yearMin: number | null; yearMax: number | null }
  >();
  const fin = (v: number | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  for (let i = 0; i < cols.aphiaid.length; i++) {
    const a = cols.aphiaid[i];
    const n = fin(cols.n[i]) ?? 0;
    const y0 = fin(cols.year_min?.[i]);
    const y1 = fin(cols.year_max?.[i]);
    const nk = fin(cols.name_key?.[i]);
    const hit = out.get(a);
    if (!hit) out.set(a, { n, nameKey: nk, yearMin: y0, yearMax: y1 });
    else {
      hit.n += n;
      if (y0 !== null) hit.yearMin = hit.yearMin === null ? y0 : Math.min(hit.yearMin, y0);
      if (y1 !== null) hit.yearMax = hit.yearMax === null ? y1 : Math.max(hit.yearMax, y1);
    }
  }
  return out;
}

export interface LookupRow {
  species: string;
  phylum: string | null;
  class: string | null;
  order: string | null;
  family: string | null;
}

/** the rank columns a taxon layer filters by (the lookup's `rank_columns`) */
export const FILTER_RANKS = ["phylum", "class", "order", "family"] as const;

/** the list's rows: the summed species joined to the lookup, most records first; a taxon layer of a rank the
 * lookup has keeps its own species. */
export function speciesRows(
  summed: ReturnType<typeof sumBySpecies>,
  lookup: ReadonlyMap<number, LookupRow>,
  taxon: { rank: string; taxon: string } | null,
  /** a WoRMS subtree's aphiaids (the lookup's lineage): only their species */
  keep: ReadonlySet<number> | null = null,
): SpeciesRow[] {
  const rank =
    taxon && (FILTER_RANKS as readonly string[]).includes(taxon.rank) ? taxon.rank : null;
  const out: SpeciesRow[] = [];
  for (const [aphiaid, v] of summed) {
    if (keep && !keep.has(aphiaid)) continue;
    const l = lookup.get(aphiaid);
    if (rank && (l?.[rank as keyof LookupRow] ?? null) !== taxon!.taxon) continue;
    out.push({
      aphiaid,
      nameKey: v.nameKey,
      species: l?.species ?? `AphiaID ${aphiaid}`,
      phylum: l?.phylum ?? null,
      class: l?.class ?? null,
      order: l?.order ?? null,
      family: l?.family ?? null,
      records: v.n,
      yearMin: v.yearMin,
      yearMax: v.yearMax,
    });
  }
  return out.sort((a, b) => b.records - a.records || a.species.localeCompare(b.species));
}

/** the sum of records and the distinct names of a list (richness counts names: a name may carry two aphiaids). */
export function totalsOf(rows: readonly SpeciesRow[]): { records: number; names: number } {
  let records = 0;
  const names = new Set<string>();
  for (const r of rows) {
    records += r.records;
    names.add(r.nameKey !== null ? `k${r.nameKey}` : `s${r.species}`);
  }
  return { records, names: names.size };
}

/** the note when the list does not add up to the hexagon on the map (obis-hex `totalsNote`). */
export function totalsNote(
  list: { records: number; names: number },
  cell: { n?: number | null; sp?: number | null },
  filtered: boolean,
): string | null {
  if (filtered) return null;
  const n = cell.n ?? null;
  const sp = cell.sp ?? null;
  if (n === null || sp === null) return null;
  if (list.records === n && list.names === sp) return null;
  return `The species list (${fmt(list.records)} records of ${fmt(list.names)} species) does not add up to the hexagon's ${fmt(n)} records of ${fmt(sp)} species.`;
}

/** what the Cell pane prints under the list: the species table's bytes and requests (the footer is in them on a
 * page's first hexagon), the row groups read of those the table has, the names once per page, and the time. */
export function readLine(
  l: Pick<
    CellSpeciesList,
    "bytes" | "requests" | "groupsRead" | "groupsSkipped" | "lookupBytes" | "ms"
  >,
): string {
  const kb = (b: number) => `${fmt(Math.round(b / 1024))} KB`;
  const groups = l.groupsRead + l.groupsSkipped;
  const parts = [
    `Read ${kb(l.bytes)} of the species table in ${l.requests} ${l.requests === 1 ? "request" : "requests"}`,
    ...(groups > 0 ? [`${l.groupsRead} of ${groups} row groups`] : []),
    ...(l.lookupBytes > 0 ? [`plus the names, ${kb(l.lookupBytes)}, once per page`] : []),
  ];
  return `${parts.join(", ")}; ${l.ms} ms.`;
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/** the rows whose first-last years overlap a period (a decade `1990` spans 1990 to 1999, a year itself). */
export function overlapsPeriod(
  r: Pick<SpeciesRow, "yearMin" | "yearMax">,
  ref: { grain: string; value: string } | null,
): boolean {
  if (!ref) return true;
  const y = Number(ref.value);
  const [lo, hi] = ref.grain === "decade" ? [y, y + 9] : [y, y];
  if (r.yearMin === null || r.yearMax === null) return false;
  return r.yearMin <= hi && r.yearMax >= lo;
}

// ---- the expanded table: filter, sort, share, csv ----------------------------------------------------------

/** every word must match the name, class, family, order or phylum (case and accents ignored) */
export function filterSpecies(rows: readonly SpeciesRow[], query: string): SpeciesRow[] {
  const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...rows];
  return rows.filter((r) => {
    const hay = fold([r.species, r.class, r.family, r.order, r.phylum].filter(Boolean).join(" "));
    return words.every((w) => hay.includes(w));
  });
}

export type SpeciesSortKey = "species" | "class" | "family" | "records" | "yearMin" | "yearMax";

/** sort by a column, empty values last whatever the direction */
export function sortSpecies(
  rows: readonly SpeciesRow[],
  key: SpeciesSortKey,
  dir: "asc" | "desc",
): SpeciesRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    if (x === null || x === undefined) return y === null || y === undefined ? 0 : 1;
    if (y === null || y === undefined) return -1;
    return (
      (typeof x === "number" && typeof y === "number"
        ? x - y
        : String(x).localeCompare(String(y))) * sign
    );
  });
}

/** a record share as a percentage ("12.3%", "<0.1%") */
export function shareText(records: number, total: number): string {
  if (!(total > 0)) return "";
  const p = (100 * records) / total;
  return p > 0 && p < 0.1 ? "<0.1%" : `${p.toFixed(1)}%`;
}

/** the first and last year in words ("1998–2021", "2004", "") */
export function yearsText(r: Pick<SpeciesRow, "yearMin" | "yearMax">): string {
  if (r.yearMin === null && r.yearMax === null) return "";
  if (r.yearMin === r.yearMax || r.yearMax === null) return String(r.yearMin);
  if (r.yearMin === null) return String(r.yearMax);
  return `${r.yearMin}–${r.yearMax}`;
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const SPECIES_CSV_COLUMNS = [
  "h3",
  "res",
  "species",
  "aphiaid",
  "phylum",
  "class",
  "order",
  "family",
  "records",
  "share_of_records",
  "year_min",
  "year_max",
] as const;

/** every species of the list as CSV (obis-hex `speciesCsv`'s columns) */
export function speciesCsv(list: Pick<CellSpeciesList, "h3" | "res" | "rows" | "records">): string {
  const lines = [SPECIES_CSV_COLUMNS.join(",")];
  for (const r of list.rows)
    lines.push(
      [
        list.h3,
        list.res,
        r.species,
        r.aphiaid,
        r.phylum,
        r.class,
        r.order,
        r.family,
        r.records,
        list.records > 0 ? (r.records / list.records).toFixed(6) : "",
        r.yearMin,
        r.yearMax,
      ]
        .map(csvCell)
        .join(","),
    );
  return `${lines.join("\n")}\n`;
}

/** `<prefix>_species_<h3>_<layer>_<period>_<release>.csv`, every part made file-safe */
export function speciesCsvName(o: {
  prefix: string;
  h3: string;
  layer: string;
  period: string;
  release: string | null;
}): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${[o.prefix, "species", o.h3, o.layer, o.period, o.release ?? "release"].map(safe).join("_")}.csv`;
}

// ---- readers ------------------------------------------------------------------------------------------------

/** the lookup's rows by AphiaID, only the columns the list shows (read once; a failed read is retried later). */
export async function readLookup(
  spec: H3Spec,
  source?: string | ArrayBuffer,
  stats?: ReadStats,
): Promise<Map<number, LookupRow>> {
  const lk = spec.speciesTable?.lookup;
  const src = source ?? lk?.href;
  if (!lk || !src) return new Map();
  const { parquetMetadataAsync, parquetReadObjects } = await import("hyparquet");
  const compressors = COMPRESSORS;
  const file = typeof src === "string" ? await openRangeFile(src, { stats }) : src;
  if (!file) throw new Error(`${String(src)}: not found`);
  const metadata = await parquetMetadataAsync(file, { initialFetchSize: 65_536 });
  const col = (rank: string) => lk.rankColumns[rank] ?? rank;
  const columns = [lk.key, lk.nameColumn, col("phylum"), col("class"), col("order"), col("family")];
  const rows = (await parquetReadObjects({
    file,
    columns,
    compressors,
    metadata,
  })) as Record<string, unknown>[];
  const out = new Map<number, LookupRow>();
  const s = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));
  for (const r of rows)
    out.set(Number(r[lk.key]), {
      species: String(r[lk.nameColumn] ?? ""),
      phylum: s(r[col("phylum")]),
      class: s(r[col("class")]),
      order: s(r[col("order")]),
      family: s(r[col("family")]),
    });
  return out;
}

/** the suffix the species table is opened with: the live `species_flat/res=3.parquet` footer is 245 KB, so a 64 KiB
 * tail costs a second request for it; 256 KiB reads it in one (the map package's README, "The species of a cell"). */
export const SPECIES_TAIL = 262_144;

/** the summed flat rows of a hexagon (`speciesForCell`: only the row groups of its range; the reader keeps the
 * table's footer between hexagons), with the requests and bytes of this read. */
export async function readCellRows(
  spec: H3Spec,
  h3: string,
  reader: ReleaseReader,
): Promise<{
  plan: NonNullable<ReturnType<typeof cellPlan>>;
  summed: ReturnType<typeof sumBySpecies>;
  requests: number;
  bytes: number;
  groupsRead: number;
  groupsSkipped: number;
} | null> {
  const flat = spec.speciesFlat;
  const plan = flat ? cellPlan(h3, flat.resolutions) : null;
  if (!flat || !plan) return null;
  const cols = spec.speciesTable?.columns;
  const url = flat.hrefTemplate.replace("{res}", String(plan.tableRes));
  const colAphia = cols?.species ?? "aphiaid";
  const colN = cols?.count ?? "n";
  const want = [colAphia, colN, cols?.nameKey, cols?.yearMin, cols?.yearMax].filter(
    (c): c is string => !!c,
  );
  const got = await speciesForCell(url, h3, {
    res: plan.tableRes,
    id: cols?.cell ?? "cell_id",
    columns: want,
    reader,
  });
  if (!got) return null;
  const col = (name: string | undefined) =>
    name ? got.rows.map((r) => (typeof r[name] === "number" ? (r[name] as number) : NaN)) : [];
  return {
    plan,
    summed: sumBySpecies({
      aphiaid: col(colAphia),
      n: col(colN),
      ...(cols?.nameKey ? { name_key: col(cols.nameKey) } : {}),
      ...(cols?.yearMin ? { year_min: col(cols.yearMin) } : {}),
      ...(cols?.yearMax ? { year_max: col(cols.yearMax) } : {}),
    }),
    requests: got.requests,
    bytes: got.bytes,
    groupsRead: got.groupsRead,
    groupsSkipped: got.groupsSkipped,
  };
}
