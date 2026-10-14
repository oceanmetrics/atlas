// The registry's search index (`registry_index.json`: `[key, scientific_name, common_name, group]`
// per taxon, about 300 KB gzip for AquaMaps' 17,499) and the search over it.
//
// The ranking is the Species picker's, not a copy of it: the index becomes the picker's own
// `TaxaIndex` rows, so `foldText` (case, diacritics, apostrophes) and `rankRow` (exact > prefix >
// word-start > substring, scientific before common) decide the order, and the same `SpeciesPicker`
// component renders the result. A taxon with no group (a model with no taxon match) is listed under
// "other". The index loads lazily (at idle or when the search is focused) and is cached per URL.
import {
  foldText,
  pickerLabel,
  searchTaxa,
  type PickerRow,
  type SearchMatch,
  type TaxaIndex,
} from "../../../lens/species/data/picker";
import type { Loaded } from "../load";

/** the group a taxon with no `sp_cat` is listed under. */
export const OTHER_GROUP = "other";

/** `[key, sci, common, group][]` -> the picker's index, or a string naming the first violation. */
export function parseRegistryIndex(raw: unknown, ver = "registry"): TaxaIndex | string {
  if (!Array.isArray(raw)) return "not an array";
  const rows: PickerRow[] = [];
  const byKey = new Map<string, PickerRow>();
  const cats = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    if (!Array.isArray(r) || r.length < 2) return `row ${i} is not [key, scientific_name, ...]`;
    const [key, sci, common, group] = r as unknown[];
    if (typeof key !== "string" || key === "") return `row ${i} has no key`;
    if (typeof sci !== "string" || sci === "") return `row ${i} has no scientific name`;
    const commonName = typeof common === "string" && common.trim() ? common.trim() : null;
    const cat = typeof group === "string" && group.trim() ? group.trim() : OTHER_GROUP;
    cats.add(cat);
    const label = pickerLabel(cat, sci, commonName);
    const row: PickerRow = {
      key,
      sci,
      common: commonName,
      cat,
      // there is no "US waters" notion in a global registry: every taxon is offered
      validUsa: true,
      validGlobal: true,
      label,
      ord: i,
      nSci: foldText(sci),
      nCommon: commonName ? foldText(commonName) : "",
      nLabel: foldText(label),
    };
    rows.push(row);
    byKey.set(key, row);
  }
  return { ver, cats: [...cats].sort(), rows, byKey };
}

/** the best matches for `query` over the registry index, the Species picker's ranking. An empty query
 * is the plain list. */
export function searchRegistry(index: TaxaIndex, query: string, limit = 50): SearchMatch[] {
  return searchTaxa(index, query, { usOnly: false, limit });
}

/** the default taxon: *Dermochelys coriacea* (the atlas' stock example) when the registry has it, else
 * the first row. `null` for an empty registry. */
export const DEFAULT_REGISTRY_TAXON = "Dermochelys coriacea";

export function defaultRegistryKey(
  rows: Iterable<{ key: string; scientificName?: string; sci?: string }>,
): string | null {
  let first: string | null = null;
  for (const r of rows) {
    if (first === null) first = r.key;
    if ((r.scientificName ?? r.sci) === DEFAULT_REGISTRY_TAXON) return r.key;
  }
  return first;
}

export type FetchJson = (url: string) => Promise<unknown>;

async function builtinFetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const indexCache = new Map<string, Promise<Loaded<TaxaIndex>>>();

export function clearRegistryIndexCache(): void {
  indexCache.clear();
}

/** the search index at `url`: fetched once per URL (a concurrent second ask shares the request), a
 * failure is not cached. Never throws. */
export function loadRegistryIndex(
  url: string,
  fetchJson: FetchJson = builtinFetchJson,
  cache: Map<string, Promise<Loaded<TaxaIndex>>> = indexCache,
): Promise<Loaded<TaxaIndex>> {
  const hit = cache.get(url);
  if (hit) return hit;
  const p = (async (): Promise<Loaded<TaxaIndex>> => {
    let raw: unknown;
    try {
      raw = await fetchJson(url);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        error: { kind: /HTTP/.test(message) ? "http" : "network", url, message },
      };
    }
    const parsed = parseRegistryIndex(raw);
    if (typeof parsed === "string") {
      return { ok: false, error: { kind: "schema", url, message: `registry index: ${parsed}` } };
    }
    return { ok: true, value: parsed };
  })();
  cache.set(url, p);
  void p.then((r) => {
    if (!r.ok) cache.delete(url);
  });
  return p;
}
