// The taxa registry: one row per taxon (AquaMaps: per model with a native COG), read ONCE from the
// registry Parquet and kept as a Map by key. The file is about 1 MB, so reading it whole is simpler
// than a filtered read per taxon (and every later pick is then instant). The Parquet reader is a
// DYNAMIC import (scripts/size-budget-core.mjs keeps it out of the static graph), exactly like
// `../values.ts`; everything else here is a pure conversion a test can feed a handful of rows.
import type { Loaded } from "../load";

export interface RegistryRow {
  /** the taxon's key in the registry (the Item id; `?sp=`). */
  key: string;
  scientificName: string;
  commonName: string | null;
  /** `sp_cat`; `null` when the model has no taxon match. */
  group: string | null;
  /** accepted WoRMS AphiaID, BOTW id, IUCN Red List code: `null` when the registry has none. */
  aphiaId: number | null;
  botwId: number | null;
  redlistCode: string | null;
  /** the native 0.5 degree COG (the surface the collection draws). */
  cogUrl: string;
  /** the same model's global 0.05 degree COG (MarineSensitivity v8 downscale; the native-vs-downscaled switch). */
  cogUrl005: string | null;
  /** `[west, south, east, north]` of the native COG; `null` when absent or malformed. */
  bboxNative: [number, number, number, number] | null;
  /** the same for the 0.05 degree COG. */
  bbox005: [number, number, number, number] | null;
  /** the model's key in the MarineSensitivity v8 tables (`am|<key>`). */
  mdlKey: string | null;
  /** the key the species had in the v7 registry (an old `?sp=` link); `null` when v7 had none. */
  spKeyV7: string | null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function text(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/** a `bbox` list column -> `[w, s, e, n]`, or `null` unless it is four finite numbers with west < east
 * and south < north (a wrong box is worse than none: the lens then asks the tile server for the
 * footprint instead). */
export function bboxOfRow(v: unknown): [number, number, number, number] | null {
  if (v === null || v === undefined || typeof v === "string") return null;
  const a = Array.from(v as ArrayLike<unknown>, num);
  if (a.length !== 4 || a.some((x) => x === null)) return null;
  const [w, s, e, n] = a as number[];
  return w < e && s < n ? [w, s, e, n] : null;
}

/** one Parquet record -> a row; `null` for a record with no key or no native COG (nothing to draw). */
export function rowFromRecord(
  rec: Record<string, unknown>,
  keyColumn = "sp_key",
): RegistryRow | null {
  const key = text(rec[keyColumn]);
  const cogUrl = text(rec.cog_url);
  if (!key || !cogUrl) return null;
  return {
    key,
    scientificName: text(rec.scientific_name) ?? key,
    commonName: text(rec.common_name),
    group: text(rec.sp_cat),
    aphiaId: num(rec.aphia_id),
    botwId: num(rec.botw_id),
    redlistCode: text(rec.redlist_code),
    cogUrl,
    cogUrl005: text(rec.cog_url_005),
    bboxNative: bboxOfRow(rec.bbox_native),
    bbox005: bboxOfRow(rec.bbox_005),
    mdlKey: text(rec.mdl_key),
    spKeyV7: text(rec.sp_key_v7),
  };
}

export type RegistryRows = Map<string, RegistryRow>;

/** the row an old v7 key (`?sp=Fis-49220` of a v7-era link) stands for: the row whose `sp_key_v7` it is, or
 * `null`. Built per lookup over the Map (a rare, one-off scan of ~19,000 rows, not an index kept in memory). */
export function rowOfV7Key(rows: RegistryRows, v7Key: string): RegistryRow | null {
  for (const r of rows.values()) if (r.spKeyV7 === v7Key) return r;
  return null;
}

/** the registry key an `?sp=` value stands for: itself when the registry has it, else the v8 key of the row
 * that had it as its v7 key, else itself again (an unknown key; the lens then says so). */
export function resolveRegistryKey(rows: RegistryRows, sp: string): string {
  return rows.has(sp) ? sp : (rowOfV7Key(rows, sp)?.key ?? sp);
}

export function rowsFromRecords(
  records: readonly Record<string, unknown>[],
  keyColumn = "sp_key",
): RegistryRows {
  const out: RegistryRows = new Map();
  for (const rec of records) {
    const row = rowFromRecord(rec, keyColumn);
    if (row) out.set(row.key, row);
  }
  return out;
}

/** the registry rows keyed by taxon key, from the Parquet at `url` (or an in-memory buffer, for
 * tests). Cached per URL for the session; a failure is not cached. Never throws. */
const cache = new Map<string, Promise<Loaded<RegistryRows>>>();

export function clearRegistryRowsCache(): void {
  cache.clear();
}

export function readRegistryRows(
  source: string | ArrayBuffer,
  keyColumn = "sp_key",
): Promise<Loaded<RegistryRows>> {
  const url = typeof source === "string" ? source : "(buffer)";
  const hit = typeof source === "string" ? cache.get(`${url}#${keyColumn}`) : undefined;
  if (hit) return hit;
  const p = (async (): Promise<Loaded<RegistryRows>> => {
    try {
      const [{ asyncBufferFromUrl, parquetReadObjects }, { compressors }] = await Promise.all([
        import("hyparquet"),
        import("hyparquet-compressors"),
      ]);
      const file = typeof source === "string" ? await asyncBufferFromUrl({ url: source }) : source;
      const records = (await parquetReadObjects({ file, compressors })) as Record<
        string,
        unknown
      >[];
      return { ok: true, value: rowsFromRecords(records, keyColumn) };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const kind = /fetch|http|network/i.test(message) ? "network" : "parse";
      return { ok: false, error: { kind, url, message } };
    }
  })();
  if (typeof source === "string") {
    cache.set(`${url}#${keyColumn}`, p);
    void p.then((r) => {
      if (!r.ok) cache.delete(`${url}#${keyColumn}`);
    });
  }
  return p;
}
