// The public species list of a hex collection (WP3): which species are Likely / Very likely in a
// clicked cell, per season, for the item's group. Two small Parquet assets of the collection:
//
//   `cell_species`  long table  FID, season, aphia_id, prob, class   (Likely + Very likely rows only)
//   `species`       lookup      aphia_id, scientific_name, abbreviation, iucn_code, redlisted,
//                               group1, group2, common_name (blank when WoRMS has no English name)
//
// Both are fetched ONCE (cell_species is ~0.8 MB, species 7 KB) and kept in memory; every rule below is
// a pure function of that data so a test can assert it with a handful of rows. hyparquet and its
// compressors are DYNAMIC imports (scripts/size-budget-core.mjs keeps them out of the static graph),
// the same as `values.ts`.
import { toCsv } from "../download/csv";
import { assetUrl, type Loaded } from "./load";
import type { StacCollection } from "./types";

/** the class label of a row at or above this probability is Likely (0.6-0.8) or Very likely (0.8+). */
export const LIKELY_MIN_PROB = 0.6;

export interface SpeciesInfo {
  aphiaId: number;
  scientificName: string;
  commonName: string;
  /** IUCN Red List code (`LC`, `VU`, ...); "" when unknown. */
  iucnCode: string;
  redlisted: boolean;
  /** the coarse group (`Fish`, `Shark`, ...). */
  group: string;
}

/** a long-table row, columns stored as parallel arrays (248,834 rows: objects would cost a lot). */
export interface CellSpeciesColumns {
  fid: Int32Array;
  /** index into `seasons`. */
  season: Uint8Array;
  aphiaId: Int32Array;
  prob: Float32Array;
  /** true = Very likely, false = Likely. */
  veryLikely: Uint8Array;
  seasons: string[];
}

export interface SpeciesData {
  /** aphia_id -> species. */
  species: Map<number, SpeciesInfo>;
  /** the long table plus `rowsOf`: season -> fid -> row indices. */
  cells: CellSpeciesColumns;
  rowsOf: Map<string, Map<number, number[]>>;
}

export interface CellSpecies extends SpeciesInfo {
  prob: number;
  /** "Very likely" | "Likely". */
  cls: string;
}

// --- asset lookup ----------------------------------------------------------------------------------

export interface SpeciesAssets {
  cellSpeciesUrl: string;
  speciesUrl: string;
}

/** the collection's public species-list assets (`cell_species` + `species`); `null` unless BOTH exist. */
export function speciesAssetsOf(collection: StacCollection | null): SpeciesAssets | null {
  const cs = collection?.assets?.cell_species;
  const sp = collection?.assets?.species;
  if (!collection || !cs || !sp) return null;
  const cellSpeciesUrl = assetUrl(collection, cs);
  const speciesUrl = assetUrl(collection, sp);
  return cellSpeciesUrl && speciesUrl ? { cellSpeciesUrl, speciesUrl } : null;
}

// --- parsing ---------------------------------------------------------------------------------------

function num(v: unknown): number {
  return typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : Number(v);
}

function str(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

/** species Parquet rows -> lookup; a row with no finite `aphia_id` is dropped. */
export function speciesLookup(rows: readonly Record<string, unknown>[]): Map<number, SpeciesInfo> {
  const out = new Map<number, SpeciesInfo>();
  for (const r of rows) {
    const aphiaId = num(r.aphia_id);
    if (!Number.isFinite(aphiaId)) continue;
    out.set(aphiaId, {
      aphiaId,
      scientificName: str(r.scientific_name),
      commonName: str(r.common_name),
      iucnCode: str(r.iucn_code),
      redlisted: r.redlisted === true || r.redlisted === "true",
      group: str(r.group2),
    });
  }
  return out;
}

/** cell_species Parquet rows -> columns + the season -> fid -> rows index. Rows with a non-finite FID,
 * AphiaID or probability are dropped. */
export function cellSpeciesIndex(
  rows: readonly Record<string, unknown>[],
): Pick<SpeciesData, "cells" | "rowsOf"> {
  const n = rows.length;
  const cells: CellSpeciesColumns = {
    fid: new Int32Array(n),
    season: new Uint8Array(n),
    aphiaId: new Int32Array(n),
    prob: new Float32Array(n),
    veryLikely: new Uint8Array(n),
    seasons: [],
  };

  const rowsOf = new Map<string, Map<number, number[]>>();
  let k = 0;
  for (const r of rows) {
    const fid = num(r.FID);
    const aphiaId = num(r.aphia_id);
    const prob = num(r.prob);
    if (!Number.isFinite(fid) || !Number.isFinite(aphiaId) || !Number.isFinite(prob)) continue;
    const season = str(r.season);
    let si = cells.seasons.indexOf(season);
    if (si < 0) si = cells.seasons.push(season) - 1;
    cells.fid[k] = fid;
    cells.season[k] = si;
    cells.aphiaId[k] = aphiaId;
    cells.prob[k] = prob;
    cells.veryLikely[k] = str(r.class) === "Very likely" ? 1 : 0;
    let bySeason = rowsOf.get(season);
    if (!bySeason) {
      bySeason = new Map();
      rowsOf.set(season, bySeason);
    }
    const list = bySeason.get(fid);
    if (list) list.push(k);
    else bySeason.set(fid, [k]);
    k++;
  }
  if (k < n) {
    cells.fid = cells.fid.slice(0, k);
    cells.season = cells.season.slice(0, k);
    cells.aphiaId = cells.aphiaId.slice(0, k);
    cells.prob = cells.prob.slice(0, k);
    cells.veryLikely = cells.veryLikely.slice(0, k);
  }
  return { cells, rowsOf };
}

/** build `SpeciesData` from the two tables' rows (the pure half of `readSpeciesData`). */
export function speciesDataFromRows(
  cellRows: readonly Record<string, unknown>[],
  speciesRows: readonly Record<string, unknown>[],
): SpeciesData {
  return { species: speciesLookup(speciesRows), ...cellSpeciesIndex(cellRows) };
}

/** read both Parquet files in full (they are small). Never throws: a failure is a `network` / `parse` error. */
export async function readSpeciesData(assets: SpeciesAssets): Promise<Loaded<SpeciesData>> {
  try {
    const [{ asyncBufferFromUrl, parquetReadObjects }, { compressors }] = await Promise.all([
      import("hyparquet"),
      import("hyparquet-compressors"),
    ]);
    const read = async (url: string) =>
      (await parquetReadObjects({
        file: await asyncBufferFromUrl({ url }),
        compressors,
      })) as Record<string, unknown>[];
    const [cellRows, speciesRows] = await Promise.all([
      read(assets.cellSpeciesUrl),
      read(assets.speciesUrl),
    ]);
    return { ok: true, value: speciesDataFromRows(cellRows, speciesRows) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: {
        kind: /fetch|http|network/i.test(message) ? "network" : "parse",
        url: assets.cellSpeciesUrl,
        message,
      },
    };
  }
}

// --- the group rule ----------------------------------------------------------------------------------

/**
 * Whether a species belongs to an item's `group` dimension: `all` (or no group) is everything,
 * `redlisted` is `redlisted == true`, anything else is the species' coarse group compared
 * case-insensitively (`shark` matches `Shark`; the cube lowercases what the table capitalizes).
 */
export function inGroup(species: SpeciesInfo, group: string | undefined): boolean {
  const g = (group ?? "all").trim().toLowerCase();
  if (g === "" || g === "all") return true;
  if (g === "redlisted") return species.redlisted;
  return species.group.toLowerCase() === g;
}

/** how many species the models cover in `group` (the M of "N likely of M modeled"). */
export function modeledCount(data: SpeciesData, group: string | undefined): number {
  let n = 0;
  for (const sp of data.species.values()) if (inGroup(sp, group)) n++;
  return n;
}

// --- a cell's list -----------------------------------------------------------------------------------

export function classLabel(veryLikely: boolean): string {
  return veryLikely ? "Very likely" : "Likely";
}

export type ClassTone = "very" | "likely";

/** the pill a class string maps to; `null` for anything that is not Likely / Very likely. */
export function classPill(cls: string): { label: string; tone: ClassTone } | null {
  if (cls === "Very likely") return { label: "Very likely", tone: "very" };
  if (cls === "Likely") return { label: "Likely", tone: "likely" };
  return null;
}

/** the species Likely / Very likely in cell `fid` in `season`, filtered by `group`, highest probability
 * first (ties by scientific name, so the order is stable). A species missing from the lookup keeps its
 * AphiaID as its name rather than vanishing. */
export function speciesInCell(
  data: SpeciesData,
  fid: number,
  season: string,
  group: string | undefined,
): CellSpecies[] {
  const rows = data.rowsOf.get(season)?.get(fid) ?? [];
  const out: CellSpecies[] = [];
  for (const k of rows) {
    const aphiaId = data.cells.aphiaId[k];
    const info = data.species.get(aphiaId) ?? {
      aphiaId,
      scientificName: `AphiaID ${aphiaId}`,
      commonName: "",
      iucnCode: "",
      redlisted: false,
      group: "",
    };
    if (data.species.has(aphiaId) && !inGroup(info, group)) continue;
    out.push({
      ...info,
      prob: Math.round(data.cells.prob[k] * 1000) / 1000, // stored as float32; the source has 3 decimals
      cls: classLabel(data.cells.veryLikely[k] === 1),
    });
  }
  return out.sort(
    (a, b) => b.prob - a.prob || a.scientificName.localeCompare(b.scientificName, "en"),
  );
}

export interface GroupShare {
  /** percent (0-100) of the modeled species that are Very likely / Likely here; `rest` is the remainder. */
  veryLikely: number;
  likely: number;
  rest: number;
}

/** the share-by-group bar: % Very likely, % Likely, and the rest (modeled but not likely), of `modeled`.
 * `modeled` of 0 yields an all-rest bar; the three always sum to 100. */
export function shareByGroup(list: readonly CellSpecies[], modeled: number): GroupShare {
  if (!(modeled > 0)) return { veryLikely: 0, likely: 0, rest: 100 };
  const very = list.filter((s) => s.cls === "Very likely").length;
  const likely = list.filter((s) => s.cls === "Likely").length;
  const v = Math.min(100, (very / modeled) * 100);
  const l = Math.min(100 - v, (likely / modeled) * 100);
  return { veryLikely: v, likely: l, rest: Math.max(0, 100 - v - l) };
}

/** "12 species likely (prob >= 0.6) of 37 modeled in this group". */
export function countLine(likely: number, modeled: number): string {
  return `${likely} species likely (prob >= ${LIKELY_MIN_PROB}) of ${modeled} modeled in this group`;
}

// --- hover ---------------------------------------------------------------------------------------------

/**
 * fid -> number of likely species in `season` for `group`: the in-memory index hover reads (no fetch, no
 * filtering per hover). A cell with none is absent (hover shows "0 likely species" via `?? 0` at the
 * call site only when the data is loaded).
 */
export function likelyCountIndex(
  data: SpeciesData,
  season: string,
  group: string | undefined,
): Map<number, number> {
  const out = new Map<number, number>();
  const bySeason = data.rowsOf.get(season);
  if (!bySeason) return out;
  const g = (group ?? "all").trim().toLowerCase();
  const all = g === "" || g === "all";
  for (const [fid, rows] of bySeason) {
    let n = 0;
    for (const k of rows) {
      if (all) {
        n++;
        continue;
      }
      const info = data.species.get(data.cells.aphiaId[k]);
      if (!info || inGroup(info, group)) n++;
    }
    if (n > 0) out.set(fid, n);
  }
  return out;
}

/** the hover suffix: "12 likely species". */
export function likelySpeciesText(n: number): string {
  return `${n} likely species`;
}

// --- csv -------------------------------------------------------------------------------------------------

/** the list as CSV (raw probabilities, never the display rounding). */
export function speciesCsv(list: readonly CellSpecies[], fid: number, season: string): string {
  return toCsv(list, [
    { key: "fid", value: () => fid },
    { key: "season", value: () => season },
    { key: "aphia_id", value: (s: CellSpecies) => s.aphiaId },
    { key: "scientific_name", value: (s: CellSpecies) => s.scientificName },
    { key: "common_name", value: (s: CellSpecies) => s.commonName },
    { key: "prob", value: (s: CellSpecies) => s.prob },
    { key: "class", value: (s: CellSpecies) => s.cls },
    { key: "iucn_code", value: (s: CellSpecies) => s.iucnCode },
  ]);
}
