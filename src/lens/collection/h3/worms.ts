// The WoRMS REST API for the OBIS layer's subtree (obis-hex parity rows 7, 9, 10): "Search all of WoRMS" by name
// (`AphiaRecordsByName/<name>?like=true`, CORS-open), the record of one AphiaID (`AphiaRecordByAphiaID/<id>`: the
// name, rank, status and the accepted name of a synonym, for the taxon line), and a `taxon=<rank>:<name>` the release
// has no layer for resolved to its AphiaID. The descendants are never asked of WoRMS: the species lookup's `lineage`
// (self first, then the ancestors) holds them (`subtree.ts`). Pure parsers plus fetch-injectable calls; no service
// of our own (obis-hex's h3t taxon search is gone). Node-tested (tests/obis/worms.test.ts) over recorded answers.

/** the WoRMS REST base, ending in "/" */
export const WORMS_REST = "https://www.marinespecies.org/rest/";
/** a search needs at least this many letters (obis-hex `SEARCH_MIN`) */
export const SEARCH_MIN = 2;
/** the search waits this long after the last key (obis-hex AphiaSearch) */
export const SEARCH_DEBOUNCE_MS = 250;
/** hits shown (obis-hex's `limit=20`) */
export const SEARCH_LIMIT = 20;

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

/** one WoRMS record, as the layer uses it */
export interface WormsRecord {
  id: number;
  name: string;
  authority: string;
  /** WoRMS's rank, as written ("Infraorder") */
  rank: string;
  /** "accepted", "unaccepted", "alternate representation", ... */
  status: string;
  /** the accepted AphiaID: `id` itself for an accepted name */
  acceptedId: number;
  acceptedName: string;
  kingdom: string | null;
  phylum: string | null;
  class: string | null;
}

const int = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null;
const text = (v: unknown): string => (typeof v === "string" ? v : "");
const textOrNull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** a WoRMS record (`AphiaRecordByAphiaID`, a row of `AphiaRecordsByName`), or null when malformed. */
export function parseWormsRecord(json: unknown): WormsRecord | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  const id = int(o.AphiaID);
  const name = text(o.scientificname);
  if (id === null || !name) return null;
  const acceptedId = int(o.valid_AphiaID) ?? id;
  return {
    id,
    name,
    authority: text(o.authority),
    rank: text(o.rank),
    status: text(o.status),
    acceptedId,
    acceptedName: text(o.valid_name) || name,
    kingdom: textOrNull(o.kingdom),
    phylum: textOrNull(o.phylum),
    class: textOrNull(o.class),
  };
}

export const isSynonym = (r: Pick<WormsRecord, "id" | "acceptedId">) => r.acceptedId !== r.id;

/** the hits of a name search: malformed rows skipped, one row per AphiaID, the accepted names first (status
 * "accepted"; WoRMS's order kept within each part), at most `limit`. Never throws. */
export function parseWormsRecords(json: unknown, limit = SEARCH_LIMIT): WormsRecord[] {
  if (!Array.isArray(json)) return [];
  const seen = new Set<number>();
  const rows: WormsRecord[] = [];
  for (const r of json.map(parseWormsRecord)) {
    if (!r || seen.has(r.id)) continue;
    seen.add(r.id);
    rows.push(r);
  }
  const acc = rows.filter((r) => r.status === "accepted");
  const syn = rows.filter((r) => r.status !== "accepted");
  return [...acc, ...syn].slice(0, limit);
}

/** the search url: the trimmed text as a name prefix (`like=true`), marine names only (WoRMS's default) */
export const wormsSearchUrl = (q: string, base = WORMS_REST) =>
  `${base}AphiaRecordsByName/${encodeURIComponent(q.trim())}?like=true&marine_only=true&offset=1`;

/** the record of one AphiaID */
export const wormsRecordUrl = (id: number, base = WORMS_REST) =>
  `${base}AphiaRecordByAphiaID/${id}`;

/** an exact name, any environment (a rank:name link names it exactly) */
export const wormsNameUrl = (name: string, base = WORMS_REST) =>
  `${base}AphiaRecordsByName/${encodeURIComponent(name.trim())}?like=false&marine_only=false&offset=1`;

/** the taxon's page on marinespecies.org (the taxon line's "in WoRMS" link) */
export const wormsPageUrl = (id: number) =>
  `https://www.marinespecies.org/aphia.php?p=taxdetails&id=${id}`;

async function getJson(url: string, fetchFn: FetchLike, signal?: AbortSignal): Promise<unknown> {
  const r = await fetchFn(url, signal ? { signal } : undefined);
  // WoRMS answers 204 (no body) for no match
  if (r.status === 204) return null;
  if (!r.ok) throw new Error(`WoRMS answered HTTP ${r.status}`);
  return r.json();
}

/** "Search all of WoRMS": the hits for a text of at least SEARCH_MIN letters ([] below it, and for no match) */
export async function searchWorms(
  q: string,
  fetchFn: FetchLike = fetch,
  signal?: AbortSignal,
): Promise<WormsRecord[]> {
  if (q.trim().length < SEARCH_MIN) return [];
  return parseWormsRecords(await getJson(wormsSearchUrl(q), fetchFn, signal));
}

/** the record of one AphiaID; null when WoRMS has none */
export async function wormsRecord(
  id: number,
  fetchFn: FetchLike = fetch,
): Promise<WormsRecord | null> {
  return parseWormsRecord(await getJson(wormsRecordUrl(id), fetchFn));
}

/** a `<rank>:<name>` resolved by WoRMS: the record of that exact name and rank (case aside), accepted first; null
 * when WoRMS has no such name at that rank */
export async function wormsByName(
  rank: string,
  name: string,
  fetchFn: FetchLike = fetch,
): Promise<WormsRecord | null> {
  const rows = parseWormsRecords(await getJson(wormsNameUrl(name), fetchFn), 50);
  const want = rank.toLowerCase();
  return (
    rows.find((r) => r.name === name && r.rank.toLowerCase() === want && !isSynonym(r)) ??
    rows.find((r) => r.name === name && r.rank.toLowerCase() === want) ??
    null
  );
}

/** a hit's words in the search list: "Cetacea · infraorder · accepted", a synonym with "→ <accepted> (<id>)" */
export function hitLabel(r: WormsRecord): string {
  const base = `${r.name} · ${r.rank.toLowerCase()} · ${r.status || "status unknown"}`;
  return isSynonym(r) ? `${base} → ${r.acceptedName} (${r.acceptedId})` : base;
}

/**
 * The debounced search behind the field: `set(text)` waits SEARCH_DEBOUNCE_MS after the last call, then asks WoRMS
 * (a newer text aborts the older request), and reports `{ phase, hits, error }`. Under SEARCH_MIN letters it reports
 * idle at once and asks nothing.
 */
export function createWormsSearch(o: {
  fetch?: FetchLike;
  delay?: number;
  onresult: (r: {
    phase: "idle" | "searching" | "ready" | "error";
    hits: WormsRecord[];
    error: string | null;
  }) => void;
}): { set(q: string): void; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let ctl: AbortController | null = null;
  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    ctl?.abort();
    ctl = null;
  };
  return {
    set(q) {
      stop();
      const term = q.trim();
      if (term.length < SEARCH_MIN) {
        o.onresult({ phase: "idle", hits: [], error: null });
        return;
      }
      timer = setTimeout(() => {
        const c = new AbortController();
        ctl = c;
        o.onresult({ phase: "searching", hits: [], error: null });
        searchWorms(term, o.fetch ?? fetch, c.signal).then(
          (hits) => {
            if (!c.signal.aborted)
              o.onresult({
                phase: "ready",
                hits,
                error: hits.length ? null : "No WoRMS name matches.",
              });
          },
          (e: unknown) => {
            if (!c.signal.aborted)
              o.onresult({
                phase: "error",
                hits: [],
                error: `The WoRMS search failed: ${e instanceof Error ? e.message : String(e)}`,
              });
          },
        );
      }, o.delay ?? SEARCH_DEBOUNCE_MS);
    },
    cancel: stop,
  };
}
