// The species lookup's reads, each made ONCE per page and shared by whoever asks:
//   - `loadLookup(href)`: a file whole, kept as one ArrayBuffer: the Cell pane's names, ranks and EOV
//     (`species/species.parquet`, 4.5 MB in one request: on the storage host one whole read, 0.3 to 0.5 s, beats the
//     column chunks' ranges, 2.3 MB in 18 to 69 requests, 0.6 to 1.2 s), and the WoRMS subtree's lineage
//     (`species/lineage.parquet`, 1.68 MB, obisindicators 0.12: `aphiaid, name_key, lineage`; a release without it
//     hands the whole lookup instead), registered in DuckDB-WASM from a copy (`subtreeRun.ts`);
//   - `loadColumns(href, columns)`: some columns of a file by range reads (their column chunks, merged across small
//     gaps, asked at once): the subtree's `aphiaid, class, records` of the lookup (the classes whose files it reads,
//     the records of its taxon line), unless the page holds the whole lookup already (`hasLookup`).
// Whoever asks second (or at the same moment) is handed the first one's promise, so a page makes one read of each;
// a failed read is forgotten so the next ask retries. Lazy with the layer (imported by the H3 layer's chunk only).
import { newReadStats } from "@oceanmetrics/map";
import { readColumns } from "./cellSpecies";

export interface SharedLookup {
  /** the file's bytes (a reader that hands them to a worker copies them first: a transfer would detach this) */
  buffer: ArrayBuffer;
  bytes: number;
  /** the bytes THIS call fetched: `bytes` for the call that started the read, 0 for every later one (the read lines
   * say "once per page" and print the bytes only once) */
  fetched: number;
}

const kept = new Map<string, Promise<{ buffer: ArrayBuffer; bytes: number }>>();

async function fetchWhole(href: string, f: typeof fetch) {
  const r = await f(href);
  if (!r.ok) throw new Error(`${href}: HTTP ${r.status}`);
  const buffer = await r.arrayBuffer();
  return { buffer, bytes: buffer.byteLength };
}

/** the page holds (or is reading) the whole file */
export const hasLookup = (href: string) => kept.has(href);

/** a file's bytes, fetched at most once per page per url */
export function loadLookup(href: string, f: typeof fetch = fetch): Promise<SharedLookup> {
  let p = kept.get(href);
  const mine = !p;
  if (!p) {
    p = fetchWhole(href, f);
    kept.set(href, p);
    p.catch(() => kept.delete(href));
  }
  return p.then((r) => ({ ...r, fetched: mine ? r.bytes : 0 }));
}

export interface SharedColumns {
  rows: Record<string, unknown>[];
  /** the bytes and requests of the read; `fetched` and `requests` are 0 for every call but the one that read */
  bytes: number;
  fetched: number;
  requests: number;
}

const keptColumns = new Map<
  string,
  Promise<{ rows: Record<string, unknown>[]; bytes: number; requests: number }>
>();

/** some columns of a file, read at most once per page per url and column set */
export function loadColumns(
  href: string,
  columns: readonly string[],
  f?: typeof fetch,
): Promise<SharedColumns> {
  const key = `${href}|${[...new Set(columns)].sort().join(",")}`;
  let p = keptColumns.get(key);
  const mine = !p;
  if (!p) {
    const stats = newReadStats();
    p = readColumns(href, columns, stats, f).then((rows) => ({
      rows,
      bytes: stats.bytes,
      requests: stats.requests,
    }));
    keptColumns.set(key, p);
    p.catch(() => keptColumns.delete(key));
  }
  return p.then((r) => ({
    rows: r.rows,
    bytes: r.bytes,
    fetched: mine ? r.bytes : 0,
    requests: mine ? r.requests : 0,
  }));
}

/** forget what was read (tests) */
export const forgetLookups = () => {
  kept.clear();
  keptColumns.clear();
};
