// The species lookup (`species/species.parquet`, 4.09 MB), read ONCE per page and shared by its two readers:
//   - the WoRMS subtree (`subtreeRun.ts`): the whole file, registered in DuckDB-WASM for the lineage filter;
//   - the Cell pane (`cellSpecies.ts` `readLookup`): the name and rank columns, parsed out of the same bytes.
// The file is fetched whole and kept as one ArrayBuffer; whoever asks second (a Cell pane after a subtree, a subtree
// after a Cell pane, two at once) is handed the first one's promise, so the page makes one request. Before this the
// subtree read the file whole (4.09 MB) and the Cell pane read its name columns again (1.97 MB). A failed read is
// forgotten so the next ask retries. Lazy with the layer (this module is imported by the H3 layer's chunk only).

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

/** the lookup's bytes, fetched at most once per page per url */
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

/** forget what was read (tests) */
export const forgetLookups = () => kept.clear();
