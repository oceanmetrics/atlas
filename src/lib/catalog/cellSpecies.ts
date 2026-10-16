// The species of a clicked RASTER cell: a collection that declares `atlas:cell_species` publishes a tiled
// cell -> species table (one Parquet per 5 degree tile of the 0.05 degree grid, rows `cell_id, <species>, <suit>`,
// sorted by cell so a click reads one row group) and a species lookup. This is the raster counterpart of the hex
// collections' `species.ts`; the descriptor is the whole contract, nothing here names a collection.
//
//   descriptor   parseCellSpecies        the `atlas:cell_species` field + its two assets, URLs resolved
//   grid         cellOf, tileHref        a lon/lat -> cell id and tile (row-major from the top-left, 1-based)
//   area, share  cellAreaKm2, shareOf    the spherical band area and the species' share of its global habitat
//   reading      readTile, readLookup    hyparquet behind a DYNAMIC import (scripts/size-budget-core.mjs keeps it
//                                        out of the static graph, like values.ts); a missing tile is an empty cell
//   view         joinRows, sortRows, filterRows, counts, countLine, linksFor, cellSpeciesCsv
//
// Every rule is a pure function so a test asserts it with a handful of rows.
import { toCsv } from "../download/csv";
import { formatSel, parseSel } from "../state/codec";
import { DEFAULT_SEL, type MapView, type Representation, type Sel } from "../state/types";
import { assetUrl, type LoadError, type Loaded } from "./load";
import type { StacCollection } from "./types";

// --- the descriptor -----------------------------------------------------------------------------------

export interface CellGrid {
  ncol: number;
  nrow: number;
  /** the west edge (degrees). */
  x0: number;
  /** the north edge (degrees). */
  y0: number;
  /** cell size (degrees). */
  res: number;
}

export interface CellSpeciesLinkSpec {
  label: string;
  /** a lookup column that holds the URL. */
  column?: string;
  /** `?c=aquamaps_native&sp={sp_key}`: `{name}` is filled from the lookup row. */
  hrefTemplate?: string;
  /** true = a URL of this app, followed in place (the camera stays). */
  sameApp: boolean;
}

export interface CellSpeciesDescriptor {
  /** the tile Parquet URL with `{tile}` left in, absolute. */
  tileTemplate: string;
  /** the species lookup Parquet, absolute. */
  lookupUrl: string;
  tileDeg: number;
  grid: CellGrid;
  keyColumn: string;
  speciesColumn: string;
  lookupKey: string;
  valueColumn: string;
  valueUnit: string;
  valueRange: [number, number];
  valueLabel: string;
  /** the lookup column that groups species (the EOV), and the cube dimension it is. */
  groupColumn: string | null;
  groupDimension: string | null;
  /** the lookup column holding a species' total suitable area, when shares are published. */
  totalColumn: string | null;
  links: CellSpeciesLinkSpec[];
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const posNum = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
const finiteNum = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** a relative template resolved against `base` with its `{tile}` placeholder kept (URL resolution would escape it). */
function resolveTemplate(base: string, template: string): string | null {
  try {
    return new URL(template.replace("{tile}", "__TILE__"), base).href.replace("__TILE__", "{tile}");
  } catch {
    return null;
  }
}

/**
 * The collection's `atlas:cell_species`, or null when it declares none or an unusable one (a missing grid, key
 * column or lookup asset, an unknown layout). The tile template and lookup are resolved against the collection's URL.
 */
export function parseCellSpecies(
  collection: StacCollection | null | undefined,
): CellSpeciesDescriptor | null {
  const d = collection?.["atlas:cell_species"];
  if (!collection || !isObj(d)) return null;
  if (d.layout !== "tiles") return null;
  const template = str(d.href_template);
  const base = typeof collection["atlas:url"] === "string" ? collection["atlas:url"] : null;
  const lookupAsset = collection.assets?.[str(d.lookup_asset) ?? ""];
  const lookupUrl = lookupAsset ? assetUrl(collection, lookupAsset) : null;
  const g = isObj(d.grid) ? d.grid : null;
  const grid: CellGrid | null =
    g &&
    posNum(g.ncol) &&
    posNum(g.nrow) &&
    posNum(g.res) &&
    finiteNum(g.x0) !== null &&
    finiteNum(g.y0) !== null
      ? {
          ncol: g.ncol as number,
          nrow: g.nrow as number,
          x0: g.x0 as number,
          y0: g.y0 as number,
          res: g.res as number,
        }
      : null;
  const keyColumn = str(d.key_column);
  const speciesColumn = str(d.species_column);
  const valueColumn = str(d.value_column);
  const tileDeg = posNum(d.tile_deg);
  if (!template || !base || !lookupUrl || !grid || !keyColumn || !speciesColumn || !valueColumn)
    return null;
  if (!tileDeg || !template.includes("{tile}")) return null;
  const tileTemplate = resolveTemplate(base, template);
  if (!tileTemplate) return null;

  const range = Array.isArray(d.value_range) ? d.value_range : [];
  const valueRange: [number, number] =
    range.length === 2 && finiteNum(range[0]) !== null && finiteNum(range[1]) !== null
      ? [range[0] as number, range[1] as number]
      : [0, 100];
  const share = isObj(d.share) ? d.share : null;
  const links: CellSpeciesLinkSpec[] = (Array.isArray(d.links) ? d.links : []).flatMap((l) => {
    if (!isObj(l)) return [];
    const label = str(l.label);
    const column = str(l.column) ?? undefined;
    const hrefTemplate = str(l.href_template) ?? undefined;
    if (!label || (!column && !hrefTemplate)) return [];
    return [
      {
        label,
        ...(column ? { column } : {}),
        ...(hrefTemplate ? { hrefTemplate } : {}),
        sameApp: l.same_app === true,
      },
    ];
  });
  return {
    tileTemplate,
    lookupUrl,
    tileDeg,
    grid,
    keyColumn,
    speciesColumn,
    lookupKey: str(d.lookup_key) ?? speciesColumn,
    valueColumn,
    valueUnit: str(d.value_unit) ?? "",
    valueRange,
    valueLabel: str(d.value_label) ?? "Value",
    groupColumn: str(d.group_column),
    groupDimension: str(d.group_dimension),
    totalColumn: share ? str(share.total_column) : null,
    links,
  };
}

// --- the grid --------------------------------------------------------------------------------------------

export interface CellRef {
  /** 1-based, row-major from the top-left corner of the grid. */
  cellId: number;
  /** the tile (`tileDeg` square) holding the cell, row-major from the top-left. */
  tile: number;
  /** the cell centre. */
  lat: number;
  lon: number;
  row: number;
  col: number;
}

// a point exactly on a cell edge must not fall into the neighbour through float error (-85.05/0.05 = 1701.0000000000002)
const EDGE_EPS = 1e-9;

/**
 * The cell of a position: `col = floor((lon - x0) / res)`, `row = floor((y0 - lat) / res)`, `cellId = row * ncol +
 * col + 1`, `tile = floor(row / n) * (ncol / n) + floor(col / n)` with `n = tileDeg / res` cells per tile side.
 * Longitude wraps; a position outside the grid (north of y0, south of the last row) or not finite is `null`.
 */
export function cellOf(lon: number, lat: number, grid: CellGrid, tileDeg = 5): CellRef | null {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const span = grid.ncol * grid.res;
  const wrapped = ((((lon - grid.x0) % span) + span) % span) + grid.x0;
  const col = Math.floor((wrapped - grid.x0) / grid.res + EDGE_EPS);
  const row = Math.floor((grid.y0 - lat) / grid.res + EDGE_EPS);
  if (col < 0 || col >= grid.ncol || row < 0 || row >= grid.nrow) return null;
  const side = Math.round(tileDeg / grid.res);
  const tilesPerRow = Math.ceil(grid.ncol / side);
  return {
    cellId: row * grid.ncol + col + 1,
    tile: Math.floor(row / side) * tilesPerRow + Math.floor(col / side),
    lat: grid.y0 - (row + 0.5) * grid.res,
    lon: grid.x0 + (col + 0.5) * grid.res,
    row,
    col,
  };
}

/** `./cell_species/tile={tile}/data_0.parquet` + 954 -> `./cell_species/tile=954/data_0.parquet`. */
export function tileHref(template: string, tile: number): string {
  return template.replace("{tile}", String(tile));
}

const EARTH_RADIUS_KM = 6371.0088;

/** the area (km²) of the cell whose centre is at `lat`: a spherical band, `R² · dlon · (sin(lat1) - sin(lat2))`
 * with `R` = 6371.0088 km, `dlon = res` degrees in radians and `lat1`/`lat2` the cell's north and south edges. */
export function cellAreaKm2(lat: number, res = 0.05): number {
  const rad = Math.PI / 180;
  const north = (lat + res / 2) * rad;
  const south = (lat - res / 2) * rad;
  return EARTH_RADIUS_KM ** 2 * (res * rad) * (Math.sin(north) - Math.sin(south));
}

/**
 * The cell's fraction (0-1) of a species' global suitable habitat: `suit · area_km2(lat) / total` (total is summed with suitability on the 1-100 scale), with
 * `total` the species' published total suitable area (the same weighting, in the same unit, as the product).
 * `null` when the total is missing or not positive.
 */
export function shareOf(
  suit: number,
  lat: number,
  totalSuitArea: number | null | undefined,
  res = 0.05,
): number | null {
  if (typeof totalSuitArea !== "number" || !Number.isFinite(totalSuitArea) || totalSuitArea <= 0)
    return null;
  // total_suit_area is the sum of v * area with v on the 1-100 scale, so suit stays on that scale too
  return (suit * cellAreaKm2(lat, res)) / totalSuitArea;
}

// --- reading ---------------------------------------------------------------------------------------------

/** hyparquet returns BigInt for int64 and may return strings; reduce to a finite number or null. */
function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
const text = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());

export interface TileRow {
  speciesId: number;
  suit: number;
}

export interface TileColumns {
  keyColumn: string;
  speciesColumn: string;
  valueColumn: string;
}

/** Parquet rows -> tile rows; a row without a finite species id or value is dropped. */
export function tileRowsOf(rows: readonly Record<string, unknown>[], cols: TileColumns): TileRow[] {
  const out: TileRow[] = [];
  for (const r of rows) {
    const speciesId = toNumber(r[cols.speciesColumn]);
    const suit = toNumber(r[cols.valueColumn]);
    if (speciesId !== null && suit !== null) out.push({ speciesId, suit });
  }
  return out;
}

function errorOf(url: string, e: unknown): LoadError {
  const message = e instanceof Error ? e.message : String(e);
  // hyparquet's own transport errors: "fetch failed 500", "fetch head failed 403", "fetch with range failed 500"
  const status = /fetch[\w ]* failed (\d{3})/i.exec(message);
  if (status) return { kind: "http", url, message, status: Number(status[1]) };
  return { kind: /fetch|network|failed to/i.test(message) ? "network" : "parse", url, message };
}

// the footer of a tile is read once per file: later clicks in the same tile only fetch their row group
type AsyncBuf = Awaited<ReturnType<typeof import("hyparquet").asyncBufferFromUrl>>;
const fileCache = new Map<string, Promise<AsyncBuf>>();

async function fileOf(url: string): Promise<AsyncBuf> {
  let hit = fileCache.get(url);
  if (!hit) {
    hit = import("hyparquet").then(async ({ asyncBufferFromUrl, cachedAsyncBuffer }) =>
      cachedAsyncBuffer(await asyncBufferFromUrl({ url })),
    );
    fileCache.set(url, hit);
    hit.catch(() => fileCache.delete(url)); // a failure is retried on the next click
  }
  return hit;
}

/**
 * The rows of ONE cell in a tile file (`source`: an absolute URL read by range, or an in-memory buffer for tests).
 * `filter: {cell_id}` lets hyparquet skip every row group whose column statistics exclude the cell, so a sorted
 * tile costs one row group. A tile that does not exist (404, or the 403 a public S3 bucket without list rights
 * answers for a missing key) is an EMPTY cell, not an error; any other failure is a `LoadError`.
 */
export async function readTile(
  source: string | ArrayBuffer,
  cellId: number,
  cols: TileColumns,
): Promise<Loaded<TileRow[]>> {
  const url = typeof source === "string" ? source : "(buffer)";
  try {
    const [{ parquetReadObjects }, { compressors }] = await Promise.all([
      import("hyparquet"),
      import("hyparquet-compressors"),
    ]);
    const file = typeof source === "string" ? await fileOf(source) : source;
    const rows = (await parquetReadObjects({
      file,
      columns: [cols.keyColumn, cols.speciesColumn, cols.valueColumn],
      filter: { [cols.keyColumn]: cellId } as never, // an equality filter; hyparquet types the $-operators only
      rowFormat: "object",
      compressors,
    })) as Record<string, unknown>[];
    return { ok: true, value: tileRowsOf(rows, cols) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/\b(404|403)\b/.test(message) && /fetch|http/i.test(message))
      return { ok: true, value: [] };
    return { ok: false, error: errorOf(url, e) };
  }
}

/** one row of the species lookup, reduced to what the table needs; `raw` keeps every column for links. */
export interface SpeciesRecord {
  id: number;
  scientificName: string;
  commonName: string;
  group: string;
  redlist: string;
  weight: number | null;
  totalArea: number | null;
  raw: Record<string, unknown>;
}

/** lookup Parquet rows -> species by id; a row without a finite id is dropped. */
export function lookupOf(
  rows: readonly Record<string, unknown>[],
  d: Pick<CellSpeciesDescriptor, "lookupKey" | "groupColumn" | "totalColumn">,
): Map<number, SpeciesRecord> {
  const out = new Map<number, SpeciesRecord>();
  for (const r of rows) {
    const id = toNumber(r[d.lookupKey]);
    if (id === null) continue;
    out.set(id, {
      id,
      scientificName: text(r.scientific_name),
      commonName: text(r.common_name),
      group: d.groupColumn ? text(r[d.groupColumn]) : "",
      redlist: text(r.redlist_code).toUpperCase(),
      weight: toNumber(r.weight),
      totalArea: d.totalColumn ? toNumber(r[d.totalColumn]) : null,
      raw: r,
    });
  }
  return out;
}

/** the whole species lookup (a few thousand rows; read once per collection by `createCellSpeciesStore`). */
export async function readLookup(
  source: string | ArrayBuffer,
  d: Pick<CellSpeciesDescriptor, "lookupKey" | "groupColumn" | "totalColumn">,
): Promise<Loaded<Map<number, SpeciesRecord>>> {
  const url = typeof source === "string" ? source : "(buffer)";
  try {
    const [{ asyncBufferFromUrl, parquetReadObjects }, { compressors }] = await Promise.all([
      import("hyparquet"),
      import("hyparquet-compressors"),
    ]);
    const file = typeof source === "string" ? await asyncBufferFromUrl({ url: source }) : source;
    const rows = (await parquetReadObjects({ file, compressors })) as Record<string, unknown>[];
    if (rows.length > 0 && !(d.lookupKey in rows[0])) {
      return {
        ok: false,
        error: { kind: "schema", url, message: `column "${d.lookupKey}" is not in the lookup` },
      };
    }
    return { ok: true, value: lookupOf(rows, d) };
  } catch (e) {
    return { ok: false, error: errorOf(url, e) };
  }
}

// --- the table ------------------------------------------------------------------------------------------

export interface CellSpeciesRow {
  speciesId: number;
  scientificName: string;
  commonName: string;
  /** the group (EOV) value, "" when unknown. */
  group: string;
  suit: number;
  /** the cell's fraction (0-1) of the species' global habitat; null when the total is unknown. */
  share: number | null;
  /** Red List code, "" when none. */
  redlist: string;
  weight: number | null;
  /** every lookup column, for link templates. */
  columns: Record<string, unknown>;
}

/** tile rows + lookup -> table rows. A species missing from the lookup stays (named by its id): the cell has it. */
export function joinRows(
  tile: readonly TileRow[],
  lookup: ReadonlyMap<number, SpeciesRecord>,
  lat: number,
  res = 0.05,
): CellSpeciesRow[] {
  return tile.map((t) => {
    const s = lookup.get(t.speciesId);
    return {
      speciesId: t.speciesId,
      scientificName: s?.scientificName || `Species ${t.speciesId}`,
      commonName: s?.commonName ?? "",
      group: s?.group ?? "",
      suit: t.suit,
      share: s ? shareOf(t.suit, lat, s.totalArea, res) : null,
      redlist: s?.redlist ?? "",
      weight: s?.weight ?? null,
      columns: s?.raw ?? {},
    };
  });
}

/** most threatened first; anything else (none, NE) last. */
export const REDLIST_ORDER = ["EX", "EW", "CR", "EN", "VU", "NT", "LC", "DD"] as const;
/** the codes the count chips show (D13). */
export const THREATENED_CODES = ["CR", "EN", "VU", "NT"] as const;

const redlistRank = (code: string): number => {
  const i = (REDLIST_ORDER as readonly string[]).indexOf(code);
  return i < 0 ? REDLIST_ORDER.length : i;
};

export type SortKey = "suit" | "name" | "redlist" | "group" | "share";

const byName = (a: CellSpeciesRow, b: CellSpeciesRow) =>
  a.scientificName.localeCompare(b.scientificName);

/** a sorted copy: suitability high to low (the default), name A-Z, Red List most threatened first, group A-Z,
 * share high to low (unknown last). Ties fall back to the name, so the order is deterministic. */
export function sortRows(rows: readonly CellSpeciesRow[], key: SortKey = "suit"): CellSpeciesRow[] {
  const cmp: Record<SortKey, (a: CellSpeciesRow, b: CellSpeciesRow) => number> = {
    suit: (a, b) => b.suit - a.suit,
    name: byName,
    redlist: (a, b) => redlistRank(a.redlist) - redlistRank(b.redlist),
    group: (a, b) => a.group.localeCompare(b.group),
    share: (a, b) => (b.share ?? -1) - (a.share ?? -1),
  };
  return [...rows].sort((a, b) => cmp[key](a, b) || byName(a, b));
}

/** rows of one group (`null` = all) whose scientific name, common name, group or Red List code contains `query`. */
export function filterRows(
  rows: readonly CellSpeciesRow[],
  opts: { group?: string | null; query?: string } = {},
): CellSpeciesRow[] {
  const q = (opts.query ?? "").trim().toLowerCase();
  return rows.filter(
    (r) =>
      (!opts.group || r.group === opts.group) &&
      (!q ||
        [r.scientificName, r.commonName, r.group, r.redlist].some((s) =>
          s.toLowerCase().includes(q),
        )),
  );
}

/** species per group, in first-seen order of `order` (when given) then the rest; empty groups are omitted. */
export function groupCounts(
  rows: readonly CellSpeciesRow[],
  order: readonly string[] = [],
): { group: string; count: number }[] {
  const n = new Map<string, number>();
  for (const r of rows) n.set(r.group, (n.get(r.group) ?? 0) + 1);
  const known = order.filter((g) => n.has(g));
  const rest = [...n.keys()].filter((g) => !order.includes(g)).sort();
  return [...known, ...rest].map((group) => ({ group, count: n.get(group) ?? 0 }));
}

/** CR / EN / VU / NT counts (only the codes present, in that order). */
export function redlistCounts(rows: readonly CellSpeciesRow[]): { code: string; count: number }[] {
  return THREATENED_CODES.map((code) => ({
    code,
    count: rows.filter((r) => r.redlist === code).length,
  })).filter((c) => c.count > 0);
}

/** "12 species in this cell" ("1 species in this cell"). */
export function countLine(n: number): string {
  return `${n} species in this cell`;
}

/**
 * The group the list starts on: the selected group when the item is ONE group (an EOV item), none (all) for the
 * composite item or a collection without the group dimension. `composite` is the flower's composite value.
 */
export function defaultGroup(
  d: Pick<CellSpeciesDescriptor, "groupDimension">,
  selected: Readonly<Record<string, string>>,
  composite: string | null,
): string | null {
  const v = d.groupDimension ? selected[d.groupDimension] : undefined;
  return v && v !== composite ? v : null;
}

/** the share as text: "0.0042%" -> three significant figures, "<0.0001%" below that, "" when unknown. */
export function formatShare(share: number | null): string {
  if (share === null) return "";
  const pct = share * 100;
  if (pct === 0) return "0%";
  if (pct < 0.0001) return "<0.0001%";
  return `${Number(pct.toPrecision(3))}%`;
}

// --- links -----------------------------------------------------------------------------------------------

export interface CellSpeciesLink {
  label: string;
  href: string;
  /** true = this app: follow it in place with `patch` (the camera stays), not by loading the page again. */
  sameApp: boolean;
  /** the `Sel` fields a same-app link sets. */
  patch?: Partial<Sel>;
}

const fill = (template: string, columns: Record<string, unknown>): string | null => {
  let ok = true;
  const out = template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = text(columns[name]);
    if (!v) ok = false;
    return encodeURIComponent(v);
  });
  return ok ? out : null;
};

/** an external link must be http(s): the URL comes from a data file, never a `javascript:` or `data:` one. */
const isWebUrl = (u: string): boolean => /^https?:\/\/[^\s]+$/i.test(u);

/** the 0.05 degree surface is what the product was computed on; the lens switches to it with `rep=005`. */
const PRODUCT_REPRESENTATION: Representation = "005";

/**
 * The links of one row, in the descriptor's order; a link whose URL column or placeholder is empty is left out.
 * A `same_app` link (`?c=aquamaps_native&sp={sp_key}`) becomes this app's own URL for that taxon on the 0.05 degree
 * surface (`rep=005`, unless the template sets `rep`), carrying the CURRENT `map=` camera so the view stays where
 * it is: `?map=<lon,lat,zoom>&sp=<sp_key>&rep=005&c=aquamaps_native`, written by the app's own `formatSel`.
 */
export function linksFor(
  row: CellSpeciesRow,
  d: Pick<CellSpeciesDescriptor, "links">,
  map?: MapView,
): CellSpeciesLink[] {
  const out: CellSpeciesLink[] = [];
  for (const l of d.links) {
    if (l.hrefTemplate && l.sameApp) {
      const q = fill(l.hrefTemplate, row.columns);
      if (!q) continue;
      const parsed = parseSel({ search: q.startsWith("?") ? q : `?${q}`, hash: "" });
      const rep = new URLSearchParams(q.replace(/^\?/, "")).has("rep")
        ? parsed.rep
        : PRODUCT_REPRESENTATION;
      const target: Sel = {
        ...DEFAULT_SEL,
        c: parsed.c,
        sp: parsed.sp,
        rep,
        ...(map ? { map } : {}),
      };
      out.push({
        label: l.label,
        href: formatSel(target).search,
        sameApp: true,
        patch: { c: parsed.c, sp: parsed.sp, rep, i: undefined, ...(map ? { map } : {}) },
      });
      continue;
    }
    const href = l.column
      ? text(row.columns[l.column])
      : (fill(l.hrefTemplate ?? "", row.columns) ?? "");
    if (href && isWebUrl(href)) out.push({ label: l.label, href, sameApp: false });
  }
  return out;
}

/** the table as CSV: raw values (suitability in the unit of the descriptor, share as a fraction ×100). */
export function cellSpeciesCsv(
  rows: readonly CellSpeciesRow[],
  cellId: number,
  d: Pick<CellSpeciesDescriptor, "valueLabel">,
): string {
  return toCsv(rows, [
    { key: "cell_id", value: () => cellId },
    { key: "aphia_id", value: (r) => r.speciesId },
    { key: "scientific_name", value: (r) => r.scientificName },
    { key: "common_name", value: (r) => r.commonName },
    { key: "group", value: (r) => r.group },
    { key: d.valueLabel.toLowerCase().replace(/\W+/g, "_"), value: (r) => r.suit },
    { key: "share_pct", value: (r) => (r.share === null ? "" : r.share * 100) },
    { key: "redlist", value: (r) => r.redlist },
    { key: "weight", value: (r) => r.weight },
  ]);
}

// --- the store (what the panel holds) ------------------------------------------------------------------

export interface CellSpeciesStoreDeps {
  readTile?: typeof readTile;
  readLookup?: typeof readLookup;
}

export interface CellSpeciesStore {
  /** the species lookup, read once per store. */
  lookup(): Promise<Loaded<Map<number, SpeciesRecord>>>;
  /** the rows of one cell, read once per cell (a click in the same tile reuses the file's footer). */
  cell(ref: Pick<CellRef, "cellId" | "tile">): Promise<Loaded<TileRow[]>>;
}

/** one store per descriptor: the lookup once, every cell once. A failed read is NOT kept, so a retry asks again. */
export function createCellSpeciesStore(
  d: CellSpeciesDescriptor,
  deps: CellSpeciesStoreDeps = {},
): CellSpeciesStore {
  const rt = deps.readTile ?? readTile;
  const rl = deps.readLookup ?? readLookup;
  let lookup: Promise<Loaded<Map<number, SpeciesRecord>>> | null = null;
  const cells = new Map<number, Promise<Loaded<TileRow[]>>>();
  const keep = <T>(p: Promise<Loaded<T>>, drop: () => void) => {
    void p.then((r) => {
      if (!r.ok) drop();
    });
    return p;
  };
  return {
    lookup() {
      lookup ??= keep(rl(d.lookupUrl, d), () => (lookup = null));
      return lookup;
    },
    cell(ref) {
      let hit = cells.get(ref.cellId);
      if (!hit) {
        hit = keep(rt(tileHref(d.tileTemplate, ref.tile), ref.cellId, d), () =>
          cells.delete(ref.cellId),
        );
        cells.set(ref.cellId, hit);
      }
      return hit;
    },
  };
}
