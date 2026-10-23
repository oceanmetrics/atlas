// The Cell pane's species list (build week 4, step 5; obis-hex `cell/species.ts` without h3t): the species behind
// a hexagon's records, read from the release's own species table, never a service. The flat copies of the table
// (`species_flat/`: `cell_id, name_key, aphiaid, n, year_min, year_max`, sorted by cell id in small row groups)
// hold every species of every cell of their resolution, so (`cellPlan`, from the collection's `obis:species.flat`):
//   - a hexagon at a flat resolution reads its own rows (one cell id): res 3 the file of its res-1 parent
//     (`parent_template` `species_flat/res=3/p={parent}.parquet`, `parent_res` `{"3": 1}`: 842 files, 828 of them
//     whole in the 256 KiB tail, one request), and the whole `res=3.parquet` only when the collection has no split;
//   - a hexagon coarser than a split table whose children all lie in one split file (res 1 and 2 of a release that
//     splits res 3 by res 1) reads that file: res 1 its own (`p=<the cell>`, every res-3 row under it), res 2 its
//     res-1 parent's, the rows under it (one contiguous cell-id range, `childRange`, the row groups by `cell_id`
//     statistics), summed by species in the browser: `n` added, `year_min` the least, `year_max` the greatest, which is
//     how obisindicators 0.12 derived `res=1.parquet` and `res=2.parquet` (a test holds the two equal). The
//     whole-resolution files (`species_flat/res={res}.parquet`: 9.0 and 14.6 MB, a footer then row groups, two or three
//     requests) stay the way when the collection has no `parent_template`;
//   - a coarser hexagon (res 0, whose children lie in several split files, or res 1 and 2 of a 0.11 release that has res 3 only) reads its children at the
//     next flat resolution, one contiguous cell-id range (`childRange`), summed by species: the records add up and
//     the species are the union, so the list is the hexagon's own, exactly;
//   - a finer hexagon (res 4 to 7) has no flat copy: the list is its res-3 parent's (in that parent's res-1 file),
//     and says so.
// The split files are read as files, never as a hive dataset: `res=3/p=<parent>` are path segments, not columns (a
// DuckDB reader of them passes `hive_partitioning = false`). The names and ranks come from the lookup
// (`species/species.parquet`), read whole once per page (`lookup.ts`: one request beats its column chunks' many). A
// taxon layer of
// rank phylum, class, order or family filters the list by that rank column, an EOV layer by the lookup's `eov`
// column (`obis:species.eov`, 0.12); the heads above class are not a column of the lookup, so their list is every
// taxon's, and says so. Pure functions plus the readers; Node-tested (tests/obis/cellSpecies.test.ts, on a synthetic
// table).
import {
  COMPRESSORS,
  cellIdOf,
  cellIdRes,
  childRange,
  h3OfCellId,
  openRangeFile,
  parentId,
  speciesForCell,
  type ReadStats,
  type ReleaseReader,
} from "@oceanmetrics/map";
import type { AsyncBuffer } from "hyparquet";
import type { H3SpeciesFlat, H3Spec } from "../../../lib/catalog/h3";

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

/** what a hexagon reads of the flat tables: the file (its resolution's own, or its res-1 parent's at a split
 * resolution), and the rows (its own id, its children's range, or its parent's id). */
export interface CellPlan {
  res: number;
  tableRes: number;
  scope: CellSpeciesList["scope"];
  range: [bigint, bigint];
  /** the file read */
  url: string;
  /** the parent the file is split by (its id at `parentRes`, hex), null for a whole resolution's file */
  split: { parentRes: number; parent: string } | null;
}

/** the parent at `parentRes` of an H3 cell, as the split files name it (`p=8129bffffffffff`) */
export const flatParentOf = (h3: string, parentRes: number): string =>
  h3OfCellId(parentId(cellIdOf(h3), parentRes));

/** which file and which rows of the flat tables a hexagon reads (see the head of this file). A bare list of
 * resolutions is a release with no split. */
export function cellPlan(h3: string, flat: H3SpeciesFlat | readonly number[]): CellPlan | null {
  const f: H3SpeciesFlat = Array.isArray(flat)
    ? { hrefTemplate: "", resolutions: [...flat] }
    : (flat as H3SpeciesFlat);
  const flatRes = f.resolutions;
  if (!/^[0-9a-f]{15}$/.test(h3) || flatRes.length === 0) return null;
  const id = cellIdOf(h3);
  const res = cellIdRes(id);
  let plan: Omit<CellPlan, "url" | "split">;
  // a hexagon coarser than a split table (res 1 and 2 of the res-3 split by res 1) whose children all lie in ONE
  // split file reads that file, not its own whole-resolution file: res 1 the file of its own id (every res-3 row
  // under it), res 2 the file of its res-1 parent (the rows under it, one contiguous cell-id range), the rows
  // summed by species. The whole files (`res=1`, `res=2`: 9.0 and 14.6 MB, a footer and row groups) stay the way
  // for a collection with no `parent_template` and for res 0, whose children lie in several split files.
  const splitRes = f.parentTemplate
    ? flatRes
        .filter(
          (r) => r > res && f.parentRes?.[String(r)] !== undefined && f.parentRes[String(r)] <= res,
        )
        .sort((a, b) => a - b)[0]
    : undefined;
  if (splitRes !== undefined)
    plan = { res, tableRes: splitRes, scope: "children", range: childRange(id, splitRes) };
  else if (flatRes.includes(res)) plan = { res, tableRes: res, scope: "cell", range: [id, id] };
  else {
    const finer = flatRes.filter((r) => r > res).sort((a, b) => a - b)[0];
    if (finer !== undefined)
      plan = { res, tableRes: finer, scope: "children", range: childRange(id, finer) };
    else {
      const coarser = flatRes.filter((r) => r < res).sort((a, b) => b - a)[0];
      const p = parentId(id, coarser);
      plan = { res, tableRes: coarser, scope: "parent", range: [p, p] };
    }
  }
  const whole = f.hrefTemplate.replaceAll("{res}", String(plan.tableRes));
  const parentRes = f.parentRes?.[String(plan.tableRes)];
  // a split file holds the rows of one parent: the hexagon's own parent, unless the hexagon is coarser than the
  // parent (its children lie in several files), which reads the whole resolution's file
  if (f.parentTemplate && parentRes !== undefined && parentRes <= res) {
    const parent = flatParentOf(h3, parentRes);
    return {
      ...plan,
      url: f.parentTemplate
        .replaceAll("{res}", String(plan.tableRes))
        .replaceAll("{parent}", parent),
      split: { parentRes, parent },
    };
  }
  return { ...plan, url: whole, split: null };
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
  /** the EOV whose layer counts this aphiaid (`obis:species.eov`), null when none or when the lookup has no column */
  eov?: string | null;
}

/** the rank columns a taxon layer filters by (the lookup's `rank_columns`) */
export const FILTER_RANKS = ["phylum", "class", "order", "family"] as const;

/** the list's rows: the summed species joined to the lookup, most records first; a taxon layer of a rank the
 * lookup has keeps its own species, an EOV layer the species the lookup's `eov` column gives that EOV. */
export function speciesRows(
  summed: ReturnType<typeof sumBySpecies>,
  lookup: ReadonlyMap<number, LookupRow>,
  taxon: { rank: string; taxon: string } | null,
  /** a WoRMS subtree's aphiaids (the lookup's lineage): only their species */
  keep: ReadonlySet<number> | null = null,
  /** an EOV layer's key (`fish`): only the species whose `eov` is it */
  eov: string | null = null,
): SpeciesRow[] {
  const rank =
    taxon && (FILTER_RANKS as readonly string[]).includes(taxon.rank) ? taxon.rank : null;
  const out: SpeciesRow[] = [];
  for (const [aphiaid, v] of summed) {
    if (keep && !keep.has(aphiaid)) continue;
    const l = lookup.get(aphiaid);
    if (rank && (l?.[rank as keyof LookupRow] ?? null) !== taxon!.taxon) continue;
    if (eov !== null && (l?.eov ?? null) !== eov) continue;
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

/** the lookup's columns the list shows: the key, the name, the four ranks and, when the release has it, `eov` */
export function lookupColumnsOf(spec: H3Spec): string[] {
  const lk = spec.speciesTable?.lookup;
  if (!lk) return [];
  const col = (rank: string) => lk.rankColumns[rank] ?? rank;
  return [
    lk.key,
    lk.nameColumn,
    col("phylum"),
    col("class"),
    col("order"),
    col("family"),
    ...(spec.speciesEov ? [spec.speciesEov.column] : []),
  ];
}

/** the lookup's rows by AphiaID from its column objects (as `parquetReadObjects` gives them) */
export function lookupRowsOf(
  spec: H3Spec,
  rows: readonly Record<string, unknown>[],
): Map<number, LookupRow> {
  const lk = spec.speciesTable?.lookup;
  const out = new Map<number, LookupRow>();
  if (!lk) return out;
  const col = (rank: string) => lk.rankColumns[rank] ?? rank;
  const eov = spec.speciesEov?.column ?? null;
  const s = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));
  for (const r of rows)
    out.set(Number(r[lk.key]), {
      species: String(r[lk.nameColumn] ?? ""),
      phylum: s(r[col("phylum")]),
      class: s(r[col("class")]),
      order: s(r[col("order")]),
      family: s(r[col("family")]),
      ...(eov ? { eov: s(r[eov]) } : {}),
    });
  return out;
}

/** a fetch that bypasses the browser's HTTP cache: Chromium's cache lets one request per url write its entry at a
 * time, so the column chunks of one file, asked at once, would come back one after another (69 ranges of the live
 * lookup took 12 s, about 180 ms each, measured 2026-10-24); uncached they come back together */
export const uncachedFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, cache: "no-store" });

/** the gap of unasked bytes below which two column chunks are fetched as one range: the lookup's small chunks (`eov`,
 * the next row group's `aphiaid`) merge, its 60 KB `lineage` chunks are skipped (the subtree's class columns of the
 * live lookup: 36 requests, 0.55 MB; a 64 KiB gap took the lineage in: 25 requests, 1.13 MB, slower) */
export const COLUMN_GAP = 16_384;

/** the byte ranges `[start, end)` of some columns' chunks in every row group, merged where they lie within `gap`
 * bytes of each other */
export function columnRanges(
  metadata: {
    row_groups: {
      columns: {
        meta_data?: {
          path_in_schema: string[];
          data_page_offset: bigint;
          dictionary_page_offset?: bigint;
          total_compressed_size: bigint;
        };
      }[];
    }[];
  },
  columns: readonly string[],
  gap = COLUMN_GAP,
): [number, number][] {
  const want = new Set(columns);
  const raw: [number, number][] = [];
  for (const g of metadata.row_groups)
    for (const c of g.columns) {
      const m = c.meta_data;
      if (!m || !want.has(m.path_in_schema[0])) continue;
      const dict = m.dictionary_page_offset !== undefined ? Number(m.dictionary_page_offset) : NaN;
      const start =
        dict > 0 ? Math.min(dict, Number(m.data_page_offset)) : Number(m.data_page_offset);
      raw.push([start, start + Number(m.total_compressed_size)]);
    }
  raw.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const r of raw) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + gap) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/** a file whose `ranges` are fetched at once (in parallel); a slice inside one is served from it, any other is read */
function prefetched(file: AsyncBuffer, ranges: readonly [number, number][]): AsyncBuffer {
  const got = ranges.map(([a, b]) => Promise.resolve(file.slice(a, b)));
  return {
    byteLength: file.byteLength,
    slice(start: number, end = file.byteLength) {
      const k = ranges.findIndex(([a, b]) => a <= start && end <= b);
      if (k < 0) return file.slice(start, end);
      const a = ranges[k][0];
      return got[k].then((buf) => buf.slice(start - a, end - a));
    },
  };
}

/** some columns of a Parquet file (a url, by range reads: only those columns' chunks, merged across small gaps and
 * asked at once; or the file's bytes), the columns the file does not have left out */
export async function readColumns(
  source: string | ArrayBuffer,
  columns: readonly string[],
  stats?: ReadStats,
  f: typeof fetch = uncachedFetch,
): Promise<Record<string, unknown>[]> {
  const { parquetMetadataAsync, parquetReadObjects, parquetSchema } = await import("hyparquet");
  const opened =
    typeof source === "string" ? await openRangeFile(source, { stats, fetch: f }) : source;
  if (!opened) throw new Error(`${String(source)}: not found`);
  const metadata = await parquetMetadataAsync(opened, { initialFetchSize: 65_536 });
  const have = new Set(parquetSchema(metadata).children.map((c) => c.element.name));
  const cols = [...new Set(columns)].filter((c) => have.has(c));
  const file =
    typeof source === "string" ? prefetched(opened, columnRanges(metadata, cols)) : opened;
  return (await parquetReadObjects({
    file,
    columns: cols,
    compressors: COMPRESSORS,
    metadata,
  })) as Record<string, unknown>[];
}

/** the lookup's rows by AphiaID, only the columns the list shows (`lookupColumnsOf`). */
export async function readLookup(
  spec: H3Spec,
  source?: string | ArrayBuffer,
  stats?: ReadStats,
): Promise<Map<number, LookupRow>> {
  const src = source ?? spec.speciesTable?.lookup?.href;
  if (!spec.speciesTable?.lookup || !src) return new Map();
  return lookupRowsOf(spec, await readColumns(src, lookupColumnsOf(spec), stats));
}

/** the suffix a resolution's whole flat file is opened with: its footer in one request (the live 0.12 files'
 * footers are 68,486 B at res 1 and 117,567 B at res 2; a 0.11 `res=3.parquet`'s 245,010 B costs one more) */
export const SPECIES_TAIL = 131_072;
/** the suffix a split file is opened with, and so the size up to which a split file is read in ONE request
 * (`res=3/p=<parent>.parquet`, 256 KiB): the first request asks for the file's last 256 KiB, which is the whole file
 * when the file is no larger (828 of the 842 live files, the median 9.6 KB, Monterey's parent 135 KB; two requests of
 * about 0.2 s each became one), and its response's Content-Range gives the size of a larger one (the largest is 626 KB),
 * whose footer is in the tail and whose row groups of the hexagon are then read by range. The size is not known before
 * the first request (the pane does not load the release's `files.parquet`, 842 rows of paths for the Reproduce
 * snippet), so there is no earlier decision to take. */
export const SPLIT_TAIL = 262_144;

/** the summed flat rows of a hexagon (`speciesForCell`: only the row groups of its range; the reader keeps the
 * file's footer between hexagons), with the requests and bytes of this read. A split file is read by `split` (a
 * reader with the 256 KiB tail), a whole resolution's file by `reader`. */
export async function readCellRows(
  spec: H3Spec,
  h3: string,
  reader: ReleaseReader,
  split: ReleaseReader = reader,
): Promise<{
  plan: CellPlan;
  summed: ReturnType<typeof sumBySpecies>;
  requests: number;
  bytes: number;
  groupsRead: number;
  groupsSkipped: number;
} | null> {
  const flat = spec.speciesFlat;
  const plan = flat ? cellPlan(h3, flat) : null;
  if (!flat || !plan) return null;
  const cols = spec.speciesTable?.columns;
  const colAphia = cols?.species ?? "aphiaid";
  const colN = cols?.count ?? "n";
  const want = [colAphia, colN, cols?.nameKey, cols?.yearMin, cols?.yearMax].filter(
    (c): c is string => !!c,
  );
  const r = plan.split ? split : reader;
  const before = { requests: r.stats.requests, bytes: r.stats.bytes };
  const got = await speciesForCell(plan.url, h3, {
    res: plan.tableRes,
    id: cols?.cell ?? "cell_id",
    columns: want,
    reader: r,
  });
  // a split file the release does not have holds no records (no file is written for a parent with none): an empty
  // list; a whole resolution's file that is missing is not a table of this hexagon
  if (!got && plan.split)
    return {
      plan,
      summed: new Map(),
      requests: r.stats.requests - before.requests,
      bytes: r.stats.bytes - before.bytes,
      groupsRead: 0,
      groupsSkipped: 0,
    };
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
