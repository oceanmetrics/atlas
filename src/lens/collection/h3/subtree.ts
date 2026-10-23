// The WoRMS subtree, in the page (obis-hex parity rows 7, 10, 11): `taxon=aphia:<id>` (or `taxon=<rank>:<name>` the
// release has no layer for) computed in the browser from the release's species table, as obis-hex's h3t service did
// on a server. Pure rules (Node-tested by tests/obis/subtree.test.ts against DuckDB-WASM's own engine); the runner
// (`subtreeRun.ts`, lazy) feeds them to the atlas's DuckDB-WASM and hands the cells to the map package's worker.
//
//   the taxa      the species lookup's `lineage` (self first, then the ancestors): `list_contains(lineage, <id>)`
//   the files     `species/res=<r>/class=<c>/data_0.parquet` for the classes those taxa fall in (a NULL class is
//                 `_none`); a decade reads `species_decade/res=<r>/decade=<d>/class=<c>/` (res 3 and 4)
//   the cells     per cell: n, sp (distinct name_key), shannon, simpson, ES(50), obisindicators' own SQL
//                 (`.h3t_indicators_sql()` over `obis_h3_species_subtree_sql()`'s source), ported as it is
//   the cap       res 5 at most (the species table's finest; 4 with a decade), the view's box at res 5, res 1
//                 and 2 rolled up from res 3 by the parent's cell_id bits (the counts summed, never the indicators),
//                 a set of files over 25 MB (the engine's materialize guard) refused with its byte estimate
import { cellIdOf, lonLatToTile, mergeRanges, tileRanges, zoomToRes } from "@oceanmetrics/map";
import type { SentencePart } from "./paint";
import { commonName } from "./taxa";
import type { WormsRecord } from "./worms";

/** the species table's finest resolution, the subtree's cap */
export const SUBTREE_MAX_RES = 5;
/** the resolution from which the subtree is the view's box, not the world */
export const BOX_RES = 5;
/** the bytes one subtree may read at once (the engine's `MATERIALIZE_MAX_BYTES`) */
export const SUBTREE_MAX_BYTES = 25 * 1024 * 1024;
/** obisindicators' expected sample size for ES(n) */
export const ESN = 50;
/** the box around the view: a quarter of its size on each side, rounded out to half degrees (obis-hex
 * `subtreeBbox`), so a small pan keeps the cells computed */
export const BOX_MARGIN = 0.25;
export const BOX_STEP = 0.5;

// ---- the table -------------------------------------------------------------------------------------------------

export interface SubtreeTable {
  /** `.../species/res={res}/class={class}/data_0.parquet` */
  template: string;
  resolutions: number[];
  /** the species lookup (aphiaid, name_key, class, lineage, records) */
  lookup: string;
  /** the partition value of a NULL class */
  nullClass: string;
  /** the per-decade table, when the release has one */
  decade: { template: string; resolutions: number[]; decades: string[] } | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const ints = (v: unknown): number[] =>
  Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x)).sort((a, b) => a - b) : [];

/** what the subtree reads, from the collection document (`h3:species_table` with `{res}` and `{class}` and its lookup's
 * `lineage_column`; `obis:species.null_class` and `.decade`); null when the release has no such table. */
export function subtreeTableOf(c: Record<string, unknown> | null | undefined): SubtreeTable | null {
  const t = c?.["h3:species_table"];
  if (!isRecord(t)) return null;
  const template = str(t.href_template);
  const lk = isRecord(t.lookup) ? t.lookup : null;
  const lookup = lk ? str(lk.href) : null;
  if (!template || !template.includes("{class}") || !template.includes("{res}") || !lookup)
    return null;
  if (!str(lk?.lineage_column)) return null;
  const sp = isRecord(c?.["obis:species"]) ? (c!["obis:species"] as Record<string, unknown>) : {};
  const d = isRecord(sp.decade) ? sp.decade : null;
  const dt = d ? str(d.href_template) : null;
  return {
    template,
    resolutions: ints(t.resolutions),
    lookup,
    nullClass: str(sp.null_class) ?? "_none",
    decade:
      d && dt && dt.includes("{decade}")
        ? {
            template: dt,
            resolutions: ints(d.resolutions),
            decades: Array.isArray(d.decades) ? d.decades.map(String) : [],
          }
        : null,
  };
}

/** a partition value as it is in the url: DuckDB writes a hive value with its reserved bytes percent-encoded
 * (`Apicomplexa incertae sedis` is the folder `class=Apicomplexa%20incertae%20sedis`), and the url encodes that
 * folder name again (`%2520`), as `taxon_groups.parquet`'s `url_path` holds it. */
export function hiveSegment(v: string): string {
  const disk = Array.from(new TextEncoder().encode(v))
    .map((b) =>
      /[A-Za-z0-9_.-]/.test(String.fromCharCode(b))
        ? String.fromCharCode(b)
        : `%${b.toString(16).toUpperCase().padStart(2, "0")}`,
    )
    .join("");
  return encodeURIComponent(disk);
}

/** the url of one class file at a resolution (and decade) */
export function classFileUrl(
  table: SubtreeTable,
  res: number,
  cls: string,
  decade: string | null = null,
): string {
  const t = decade && table.decade ? table.decade.template : table.template;
  return t
    .replaceAll("{res}", String(res))
    .replaceAll("{class}", hiveSegment(cls))
    .replaceAll("{decade}", decade ?? "");
}

// ---- the URL ---------------------------------------------------------------------------------------------------

export type SubtreeAsk =
  { kind: "aphia"; id: number } | { kind: "name"; rank: string; name: string };

/** what a `taxon=` value asks of WoRMS: an AphiaID, or a rank and a name; null for none */
export function subtreeAsk(param: string | undefined): SubtreeAsk | null {
  if (!param) return null;
  const m = /^aphia:(\d+)$/.exec(param);
  if (m) return Number(m[1]) > 0 ? { kind: "aphia", id: Number(m[1]) } : null;
  const i = param.indexOf(":");
  if (i <= 0 || i === param.length - 1) return null;
  return { kind: "name", rank: param.slice(0, i), name: param.slice(i + 1) };
}

/** the resolution the subtree is computed at, the species table's resolution it reads, and the note when the ask was
 * past the cap: auto draws the zoom's resolution up to the cap; a pin is clamped to it. Res 1 and 2 read res 3. */
export function subtreeRes(o: {
  res: "auto" | number;
  zoom: number;
  /** a decade is chosen: its table is res 3 and 4 */
  decade: boolean;
  /** the table's resolutions (3, 4, 5; a decade's 3, 4) */
  tableRes: readonly number[];
}): { res: number; tableRes: number; cap: number; note: string | null } {
  const cap = Math.min(SUBTREE_MAX_RES, Math.max(...o.tableRes));
  const min = Math.min(...o.tableRes);
  const want = o.res === "auto" ? zoomToRes(Math.floor(Math.max(0, o.zoom))) : o.res;
  const res = Math.max(1, Math.min(cap, want));
  const tableRes = Math.max(min, res);
  let note: string | null = null;
  if (want > cap)
    note =
      o.res === "auto"
        ? `A WoRMS subtree is computed up to res ${cap}${o.decade ? " for a decade" : ""} (the species table's finest): zoomed in, the res-${cap} hexagons of the view are shown.`
        : `A WoRMS subtree is computed up to res ${cap}${o.decade ? " for a decade" : ""} (the species table's finest): res ${o.res} is shown as res ${cap}.`;
  return { res, tableRes, cap, note };
}

// ---- the SQL ---------------------------------------------------------------------------------------------------

const RES_MASK = 15n << 52n;
const finerThan = (r: number) => (1n << BigInt(3 * (15 - r))) - 1n;
const int64 = (b: bigint) => BigInt.asIntN(64, b).toString();

/** the parent at `r` of an H3 cell id column of a finer resolution, by its bits (DuckDB-WASM has no h3 extension):
 * the resolution field set to `r`, the digits finer than `r` set to 7 (h3Bits `parentId`) */
export function parentIdSql(expr: string, r: number): string {
  const keep = ~(RES_MASK | finerThan(r));
  const set = (BigInt(r) << 52n) | finerThan(r);
  return `((${expr} & ${int64(keep)}::BIGINT) | ${int64(set)}::BIGINT)`;
}

/** the classes the subtree's taxa fall in (a NULL class as the null partition), with their taxa and records */
export function subtreeClassesSql(lookup: string, aphiaid: number, nullClass = "_none"): string {
  return `SELECT coalesce(class, '${nullClass.replaceAll("'", "''")}') AS class, count(*)::INTEGER AS taxa, sum(records)::DOUBLE AS records
FROM ${lookup}
WHERE list_contains(lineage, ${Math.trunc(aphiaid)})
GROUP BY 1 ORDER BY 1`;
}

/** the subtree's own aphiaids (the Cell pane keeps their species) */
export const subtreeTaxaSql = (lookup: string, aphiaid: number) =>
  `SELECT aphiaid FROM ${lookup} WHERE list_contains(lineage, ${Math.trunc(aphiaid)})`;

/** a cell_id filter: inside one of the ranges (inclusive) */
export function rangesSql(expr: string, ranges: readonly (readonly [bigint, bigint])[]): string {
  return ranges.length
    ? `(${ranges.map(([a, b]) => `${expr} BETWEEN ${int64(a)} AND ${int64(b)}`).join(" OR ")})`
    : "FALSE";
}

/**
 * obisindicators' `.h3t_indicators_sql()` (R/h3t.R: the one SQL translation of `calc_indicators()` every precomputed
 * layer and the Parquet export use), ported as it is, with no keys: `src` yields `cell_id`, `species` and `ni`
 * (records of that species in that cell), one row per (cell_id, species). ES(esn) is NULL for a cell with n < esn.
 * PARITY: change it only with obisindicators' own.
 */
export function indicatorsSql(src: string, esn = ESN): string {
  const e = Math.trunc(esn);
  return `WITH src AS (
      ${src}),
    tot AS (
      SELECT cell_id, SUM(ni) AS n FROM src GROUP BY cell_id),
    per AS (
      SELECT s.cell_id, s.ni, t.n,
        CASE
          WHEN t.n - s.ni >= ${e} THEN 1 - exp(
                 lgamma(t.n - s.ni + 1) + lgamma(t.n - ${e} + 1)
               - lgamma(t.n - s.ni - ${e} + 1) - lgamma(t.n + 1))
          WHEN t.n >= ${e} THEN 1
          ELSE NULL END AS esi
      FROM src s JOIN tot t USING (cell_id))
    SELECT cell_id,
      ANY_VALUE(n)                                       AS n,
      COUNT(*)                                           AS sp,
      -SUM((ni::DOUBLE / n) * ln(ni::DOUBLE / n))        AS shannon,
      SUM((ni::DOUBLE / n) * (ni::DOUBLE / n))           AS simpson,
      SUM(esi)                                           AS es
    FROM per GROUP BY cell_id`;
}

/**
 * A WoRMS subtree's cells, as obisindicators' `obis_h3_species_subtree_sql()` computes them from the exported
 * species table (R/species.R): the rows joined to the lookup, the aphiaids whose `lineage` holds the taxon, `n`
 * summed per (cell, name_key) (richness counts names, as h3t does), then the indicators. `rows` and `lookup` are
 * table expressions (`read_parquet(...)`); the rows are of `tableRes`, and a coarser `res` takes the parent's cell id
 * (the counts summed, the indicators recomputed); `ranges` keeps the rows of the view's box (res-`tableRes` ids).
 * Columns `cell_id, n, sp, shannon, simpson, es`, ordered by cell_id (what the map package's reader prunes by).
 */
export function subtreeSql(o: {
  rows: string;
  lookup: string;
  aphiaid: number;
  res: number;
  tableRes: number;
  ranges?: readonly (readonly [bigint, bigint])[] | null;
  esn?: number;
}): string {
  const cell = o.res < o.tableRes ? parentIdSql("s.cell_id", o.res) : "s.cell_id";
  const box = o.ranges ? ` AND ${rangesSql("s.cell_id", o.ranges)}` : "";
  const src = `SELECT ${cell} AS cell_id, l.name_key AS species, SUM(s.n) AS ni
      FROM ${o.rows} s
      JOIN ${o.lookup} l USING (aphiaid)
      WHERE (list_contains(l.lineage, ${Math.trunc(o.aphiaid)}))${box}
      GROUP BY 1, 2`;
  return `SELECT cell_id, n::BIGINT AS n, sp::BIGINT AS sp, shannon, simpson, es
FROM (${indicatorsSql(src, o.esn ?? ESN)}) _i
ORDER BY cell_id`;
}

/** the computed cells' legend and coverage: per indicator p02 and p98 (`quantile_cont`, the rule of the release's
 * stats.parquet and of `dom=view`), min and max, the cells with a value, and all cells */
export function subtreeSummarySql(table: string, indicators: readonly string[]): string {
  const cols = indicators.flatMap((k) => [
    `quantile_cont(${k}, 0.02)::DOUBLE AS "${k}_p02"`,
    `quantile_cont(${k}, 0.98)::DOUBLE AS "${k}_p98"`,
    `min(${k})::DOUBLE AS "${k}_min"`,
    `max(${k})::DOUBLE AS "${k}_max"`,
    `count(${k})::INTEGER AS "${k}_cells"`,
  ]);
  return `SELECT count(*)::INTEGER AS cells, ${cols.join(", ")} FROM ${table}`;
}

export interface SubtreeDomain {
  p02: number;
  p98: number;
  min: number;
  max: number;
  cells: number;
}

/** the summary row as domains per indicator ([p02, p98], or [min, max] when they meet: the package's rule) */
export function domainsOf(
  row: Record<string, unknown> | undefined,
  indicators: readonly string[],
): { cells: number; byIndicator: Record<string, SubtreeDomain | null> } {
  const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : NaN);
  const out: Record<string, SubtreeDomain | null> = {};
  for (const k of indicators) {
    const d = {
      p02: num(row?.[`${k}_p02`]),
      p98: num(row?.[`${k}_p98`]),
      min: num(row?.[`${k}_min`]),
      max: num(row?.[`${k}_max`]),
      cells: num(row?.[`${k}_cells`]) || 0,
    };
    out[k] = d.cells > 0 && Number.isFinite(d.p02) && Number.isFinite(d.p98) ? d : null;
  }
  return { cells: num(row?.cells) || 0, byIndicator: out };
}

/** the colour domain of one indicator: [p02, p98], else [min, max] when the two quantiles meet */
export const rangeOf = (d: SubtreeDomain | null): [number, number] | null =>
  d ? (d.p98 > d.p02 ? [d.p02, d.p98] : [d.min, d.max]) : null;

// ---- the view's box --------------------------------------------------------------------------------------------

export type Box = [number, number, number, number];

/** the view's bounds grown by BOX_MARGIN and rounded out to BOX_STEP, latitudes clamped; null for a view a world
 * wide (the box is then the world: no filter) */
export function viewBox(b: Box, margin = BOX_MARGIN, step = BOX_STEP): Box | null {
  const [w0, s0, e0, n0] = b;
  if (![w0, s0, e0, n0].every(Number.isFinite) || !(e0 > w0) || !(n0 > s0)) return null;
  const dx = (e0 - w0) * margin;
  const dy = (n0 - s0) * margin;
  const down = (x: number) => Math.floor(x / step) * step;
  const up = (x: number) => Math.ceil(x / step) * step;
  const w = down(w0 - dx);
  const e = up(e0 + dx);
  if (e - w >= 360) return null;
  return [w, Math.max(-85, down(s0 - dy)), e, Math.min(85, up(n0 + dy))];
}

/** is the view inside a box computed before (so its cells serve it) */
export const boxHolds = (box: Box | null, b: Box) =>
  box === null || (b[0] >= box[0] && b[2] <= box[2] && b[1] >= box[1] && b[3] <= box[3]);

/** the most tiles a box is formed from (past it the box is the world) */
export const BOX_MAX_TILES = 256;

/**
 * The res-`res` cell_id ranges of a box, as the map package's worker forms a tile's (`tileRanges`): the parents at
 * res `res - 2` of the cells that touch each tile of the box at the tile zoom `z`, each the range of its children.
 * A box crossing the antimeridian (w < -180 or e > 180) wraps. null when the box needs more than BOX_MAX_TILES.
 */
export function boxRanges(box: Box, res: number, z: number): [bigint, bigint][] | null {
  const tz = Math.max(0, Math.min(14, Math.floor(z)));
  const n = 2 ** tz;
  const wrapLon = (x: number) => ((((x + 180) % 360) + 360) % 360) - 180;
  const [x0, y0] = lonLatToTile(wrapLon(box[0]), box[3], tz);
  const [x1, y1] = lonLatToTile(wrapLon(box[2] - 1e-9), box[1], tz);
  const xs: number[] = [];
  if (box[2] - box[0] >= 360) for (let x = 0; x < n; x++) xs.push(x);
  else
    for (let x = x0; ; x = (x + 1) % n) {
      xs.push(x);
      if (x === x1 || xs.length > n) break;
    }
  if (xs.length * (y1 - y0 + 1) > BOX_MAX_TILES) return null;
  const all: [bigint, bigint][] = [];
  const parentRes = Math.max(0, res - 2);
  for (const x of xs)
    for (let y = y0; y <= y1; y++) all.push(...tileRanges(tz, x, y, res, parentRes).ranges);
  return mergeRanges(all);
}

/** a cell's id as SQL can compare it */
export const cellIdSql = (h3: string) => int64(cellIdOf(h3));

// ---- the plan and its words ------------------------------------------------------------------------------------

export interface SubtreeFile {
  url: string;
  /** the file's size (Content-Length), null when unknown */
  bytes: number | null;
  cls: string;
}

const mb = (b: number) => `${(b / 1024 / 1024).toFixed(b < 10 * 1024 * 1024 ? 2 : 1)} MB`;

/** the read's estimate and verdict: the files' sizes summed; over `max` refused, with the words */
export function subtreePlan(o: {
  name: string;
  res: number;
  files: readonly SubtreeFile[];
  max?: number;
  /** the sizes of the same classes at the coarser table resolutions, to say which would serve */
  coarser?: { res: number; bytes: number }[];
}): { bytes: number; over: boolean; line: string | null } {
  const max = o.max ?? SUBTREE_MAX_BYTES;
  const bytes = o.files.reduce((a, f) => a + (f.bytes ?? 0), 0);
  if (bytes <= max) return { bytes, over: false, line: null };
  const fits = (o.coarser ?? []).filter((c) => c.bytes <= max).sort((a, b) => b.res - a.res)[0];
  const n = o.files.length;
  return {
    bytes,
    over: true,
    line: `The subtree of ${o.name} at res ${o.res} would read ${mb(bytes)} of the species table (${n} file${n === 1 ? "" : "s"}), over the ${mb(max)} the page reads at once${fits ? `: pin res ${fits.res} (${mb(fits.bytes)}) or coarser` : ""}.`,
  };
}

/** the line under the taxon: what the map shows and how it was computed */
export const subtreeLine = (name: string, cap = SUBTREE_MAX_RES) =>
  `subtree of ${name} (computed in the browser from the species table, res ≤ ${cap})`;

/** what a computation read: "Read 0.51 MB of the species table (2 files) and the lookup (3.90 MB, once per page);
 * 4,567 hexagons in 1,234 ms." */
export function readLine(o: {
  bytes: number;
  files: number;
  lookupBytes: number;
  cells: number;
  ms: number;
}): string {
  const look = o.lookupBytes > 0 ? ` and the lookup (${mb(o.lookupBytes)}, once per page)` : "";
  return `Read ${mb(o.bytes)} of the species table (${o.files} file${o.files === 1 ? "" : "s"})${look}; ${o.cells.toLocaleString("en-US")} hexagons in ${Math.round(o.ms).toLocaleString("en-US")} ms.`;
}

/** the taxon's line (obis-hex `.taxon-line`): name and authority, rank, status, the accepted name of a synonym, the
 * subtree's records when known */
export function taxonLine(r: WormsRecord, records: number | null): string {
  const parts = [
    r.authority ? `${r.name} ${r.authority}` : r.name,
    r.rank.toLowerCase(),
    r.status || "status unknown",
  ];
  if (r.acceptedId !== r.id)
    parts.push(`accepted name ${r.acceptedName} (AphiaID ${r.acceptedId}), whose subtree is shown`);
  if (records !== null) parts.push(`${Math.round(records).toLocaleString("en-US")} records`);
  return parts.join(" · ");
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** the sentence's taxon chip (obis-hex `taxonPart` of an aphia layer): "Whales and dolphins (infraorder Cetacea,
 * WoRMS)", else "Megaptera novaeangliae (species, WoRMS)" */
export function subtreeTaxonPart(name: string, rank: string | null): SentencePart {
  const r = (rank || "taxon").toLowerCase();
  const cn = commonName(name);
  return cn
    ? { label: cap(cn), qual: `(${r} ${name}, WoRMS)`, control: "taxon" }
    : { label: name, qual: `(${r}, WoRMS)`, control: "taxon" };
}

/** the place chip of a subtree in the view's box */
export const boxPart = (res: number): SentencePart => ({
  label: "in view",
  qual: `(the view's box at res ${res})`,
  control: "place",
});

/** the coverage line of the computed cells */
export function subtreeCoverage(o: {
  indicator: string;
  valued: number;
  cells: number;
  esn?: number;
}): string {
  const f = (x: number) => x.toLocaleString("en-US");
  if (o.indicator === "es")
    return `${f(o.valued)} of ${f(o.cells)} hexagons of the subtree have ≥ ${o.esn ?? ESN} records`;
  return o.valued !== o.cells
    ? `${f(o.valued)} of ${f(o.cells)} hexagons of the subtree have a value`
    : `${f(o.cells)} hexagons of the subtree`;
}
