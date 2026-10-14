// The catalog loader: `catalog.json` -> child collections (own and external) -> items, lazily.
//
// NOTHING HERE THROWS. Every public function resolves to a `{ ok, value } | { ok, error }` result in
// the same shape `lens/species/data/shards.ts` uses, with four failure kinds so a caller can say
// something honest: `network` (the request itself failed -- offline, CORS, timeout), `http` (a
// non-2xx answer), `parse` (a 200 that is not JSON), `schema` (JSON, but not the STAC object the app
// depends on). An EXTERNAL collection that fails never takes the catalog down: it becomes an
// "unavailable" row (`status: "unavailable"`, with its error) so the picker can say it is there but
// not reachable, and the rest of the catalog works.
//
// The catalog lists its own collections with relative `child` hrefs and external ones (the
// MarineSensitivity STAC, https://file.marinesensitivity.org/stac/) with absolute hrefs. A child that
// is itself a PARENT of collections (the v7 `collection.json`: no items, only `child` links) is
// flattened into its children, which keep the parent's group. Items are fetched only when a
// collection is opened (`loadItems`), a few at a time, and cached per collection.
import { catalogUrl, resolveHref, resolveCatalogBase } from "./base";
import { mstTitle } from "./mst/kinds";
import type { StacAsset, StacCatalog, StacCollection, StacItem, StacLink } from "./types";

// --- result shape -------------------------------------------------------------------------------

export type LoadErrorKind = "network" | "http" | "parse" | "schema";

export interface LoadError {
  kind: LoadErrorKind;
  message: string;
  url: string;
  /** the HTTP status, for `kind: "http"`. */
  status?: number;
}

export type Loaded<T> = { ok: true; value: T } | { ok: false; error: LoadError };

function fail<T>(kind: LoadErrorKind, url: string, message: string, status?: number): Loaded<T> {
  return { ok: false, error: { kind, url, message, ...(status === undefined ? {} : { status }) } };
}

// --- model --------------------------------------------------------------------------------------

/** which picker group a collection belongs to. */
export type CatalogGroup = "oceanmetrics" | "mst-v7" | "mst-v8" | "external";

export const GROUP_LABEL: Record<CatalogGroup, string> = {
  oceanmetrics: "OceanMetrics",
  "mst-v7": "MarineSensitivity v7",
  "mst-v8": "MarineSensitivity v8",
  external: "Other",
};

/** the order groups appear in the picker. */
export const GROUP_ORDER: readonly CatalogGroup[] = [
  "oceanmetrics",
  "mst-v7",
  "mst-v8",
  "external",
];

export interface CollectionEntry {
  /** the collection's own `id` (or, for an unavailable one, derived from its href). */
  id: string;
  title: string;
  /** absolute URL of this collection's `collection.json`. */
  href: string;
  group: CatalogGroup;
  /** `true` for a collection outside the catalog's own base (the MarineSensitivity STAC). */
  external: boolean;
  status: "ok" | "unavailable";
  collection: StacCollection | null;
  error: LoadError | null;
}

export interface AtlasCatalog {
  /** the base the catalog was read from (`base.ts`). */
  base: string;
  catalog: StacCatalog;
  /** every collection, in the catalog's own `child` order (parents flattened in place). */
  entries: CollectionEntry[];
}

export interface ItemSet {
  items: StacItem[];
  /** items listed by the collection that could not be loaded (skipped, never fatal). */
  failed: LoadError[];
}

export interface LoadOptions {
  /** the catalog base; default `resolveCatalogBase()`. */
  base?: string;
  /** injectable for tests; default the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** per-request timeout; default 20 s. */
  timeoutMs?: number;
  /** how many item files are fetched at once; default 8. */
  concurrency?: number;
  /** request/result cache; default one shared module cache. Pass a fresh `new Map()` in tests. */
  cache?: CatalogCache;
}

export type CatalogCache = Map<string, Promise<unknown>>;

const DEFAULT_CACHE: CatalogCache = new Map();
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_CONCURRENCY = 8;
/** how deep a parent collection may nest children (v7 -> collections is one level). */
const MAX_PARENT_DEPTH = 2;

/** drop every cached request/result (tests; an explicit "reload the catalog"). */
export function clearCatalogCache(cache: CatalogCache = DEFAULT_CACHE): void {
  cache.clear();
}

// --- transport ----------------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

async function fetchJson(url: string, opts: LoadOptions): Promise<Loaded<unknown>> {
  const fetchImpl = opts.fetchImpl ?? (typeof fetch === "function" ? fetch : undefined);
  if (!fetchImpl) return fail("network", url, "fetch is not available in this environment");
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let res: Response;
  try {
    const signal =
      typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
        ? AbortSignal.timeout(timeoutMs)
        : undefined;
    res = await fetchImpl(url, signal ? { signal } : undefined);
  } catch (e) {
    return fail("network", url, e instanceof Error ? e.message : String(e));
  }
  if (!res.ok) return fail("http", url, `HTTP ${res.status}`, res.status);
  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return fail("parse", url, "the response is not valid JSON");
  }
  return { ok: true, value: raw };
}

/** one cached request: the SAME promise for the same key, so two callers never fetch twice. */
function cached<T>(cache: CatalogCache, key: string, make: () => Promise<T>): Promise<T> {
  const hit = cache.get(key) as Promise<T> | undefined;
  if (hit) return hit;
  const p = make();
  cache.set(key, p);
  return p;
}

// --- validators: only the structure the app depends on --------------------------------------------

function linksOf(raw: Record<string, unknown>): StacLink[] {
  const links = raw.links;
  if (!Array.isArray(links)) return [];
  return links.filter(
    (l): l is StacLink => isRecord(l) && typeof l.rel === "string" && typeof l.href === "string",
  );
}

function asCatalog(raw: unknown, url: string): Loaded<StacCatalog> {
  if (!isRecord(raw) || raw.type !== "Catalog") {
    return fail("schema", url, 'not a STAC Catalog (expected type "Catalog")');
  }
  if (typeof raw.id !== "string" || !Array.isArray(raw.links)) {
    return fail("schema", url, "a STAC Catalog needs a string id and a links array");
  }
  return { ok: true, value: { ...raw, links: linksOf(raw) } as StacCatalog };
}

/** a collection OR a catalog-of-collections (a parent): both carry `id` + `links`. */
function asCollection(raw: unknown, url: string): Loaded<StacCollection> {
  if (!isRecord(raw) || (raw.type !== "Collection" && raw.type !== "Catalog")) {
    return fail("schema", url, 'not a STAC Collection (expected type "Collection")');
  }
  if (typeof raw.id !== "string" || !Array.isArray(raw.links)) {
    return fail("schema", url, "a STAC Collection needs a string id and a links array");
  }
  return {
    ok: true,
    value: { ...raw, type: "Collection", links: linksOf(raw), "atlas:url": url } as StacCollection,
  };
}

function asItem(raw: unknown, url: string): Loaded<StacItem> {
  if (!isRecord(raw) || raw.type !== "Feature") {
    return fail("schema", url, 'not a STAC Item (expected type "Feature")');
  }
  if (typeof raw.id !== "string") return fail("schema", url, "a STAC Item needs a string id");
  const properties = isRecord(raw.properties) ? raw.properties : {};
  const assets = isRecord(raw.assets) ? raw.assets : {};
  return {
    ok: true,
    value: {
      ...raw,
      properties,
      assets,
      links: linksOf(raw),
      "atlas:url": url,
    } as unknown as StacItem,
  };
}

// --- grouping -----------------------------------------------------------------------------------

/** which group a collection at `url` belongs to: under the catalog's own base -> OceanMetrics;
 * the MarineSensitivity STAC by path (`/stac/v7/`, `/stac/v8/`); anything else is external. */
export function groupOf(url: string, base: string): CatalogGroup {
  if (url.startsWith(base)) return "oceanmetrics";
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return "external";
  }
  if (/\/stac\/v7(\/|$)/.test(path)) return "mst-v7";
  if (/\/stac\/v8(\/|$)/.test(path)) return "mst-v8";
  return "external";
}

/** an id for a collection we could not load: the path segment before `collection.json`. */
function idFromUrl(url: string): string {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    if (parts[parts.length - 1]?.endsWith(".json")) parts.pop();
    return parts[parts.length - 1] ?? url;
  } catch {
    return url;
  }
}

function unavailable(
  link: StacLink,
  url: string,
  group: CatalogGroup,
  base: string,
  error: LoadError,
): CollectionEntry {
  const id = idFromUrl(url);
  return {
    id,
    title: link.title?.trim() || id,
    href: url,
    group,
    external: !url.startsWith(base),
    status: "unavailable",
    collection: null,
    error,
  };
}

// --- the catalog --------------------------------------------------------------------------------

async function loadEntries(
  link: StacLink,
  url: string,
  group: CatalogGroup,
  base: string,
  depth: number,
  opts: LoadOptions,
  cache: CatalogCache,
): Promise<CollectionEntry[]> {
  const res = await cached(cache, `collection:${url}`, async () => {
    const raw = await fetchJson(url, opts);
    return raw.ok ? asCollection(raw.value, url) : raw;
  });
  if (!res.ok) return [unavailable(link, url, group, base, res.error)];
  const coll = res.value;
  const hasItems = coll.links.some((l) => l.rel === "item");
  const children = coll.links.filter((l) => l.rel === "child");
  if (!hasItems && children.length > 0 && depth < MAX_PARENT_DEPTH) {
    const kids = await Promise.all(
      children.map(async (child) => {
        const childUrl = resolveHref(url, child.href);
        if (!childUrl) {
          const error: LoadError = {
            kind: "schema",
            url,
            message: `child href "${child.href}" cannot be resolved`,
          };
          return [unavailable(child, url, group, base, error)];
        }
        return loadEntries(child, childUrl, group, base, depth + 1, opts, cache);
      }),
    );
    return kids.flat();
  }
  return [
    {
      id: coll.id,
      // MarineSensitivity collections are listed under the atlas' own wording where the STAC's is
      // ambiguous ("AquaMaps SDM" is the downscaled 0.05 degree collection: catalog/mst/kinds.ts)
      title: mstTitle(coll.id, coll.title?.trim() || link.title?.trim() || coll.id),
      href: url,
      group,
      external: !url.startsWith(base),
      status: "ok",
      collection: coll,
      error: null,
    },
  ];
}

/**
 * Fetch `catalog.json`, then every child collection in parallel. Resolves `ok: false` only when
 * `catalog.json` itself cannot be loaded; a collection that fails (own or external) is an
 * "unavailable" entry, never an error here.
 */
export async function loadCatalog(opts: LoadOptions = {}): Promise<Loaded<AtlasCatalog>> {
  const base = opts.base ?? resolveCatalogBase();
  const cache = opts.cache ?? DEFAULT_CACHE;
  const url = catalogUrl(base);
  const root = await cached(cache, `catalog:${url}`, async () => {
    const raw = await fetchJson(url, opts);
    return raw.ok ? asCatalog(raw.value, url) : raw;
  });
  if (!root.ok) return root;
  const catalog = root.value;
  const children = catalog.links.filter((l) => l.rel === "child");
  const groups = await Promise.all(
    children.map(async (link) => {
      const childUrl = resolveHref(url, link.href);
      if (!childUrl) {
        const error: LoadError = {
          kind: "schema",
          url,
          message: `child href "${link.href}" cannot be resolved`,
        };
        return [unavailable(link, url, "oceanmetrics", base, error)];
      }
      return loadEntries(link, childUrl, groupOf(childUrl, base), base, 0, opts, cache);
    }),
  );
  return { ok: true, value: { base, catalog, entries: groups.flat() } };
}

// --- items --------------------------------------------------------------------------------------

/** run `fn` over `inputs` with at most `limit` in flight, keeping the input order. */
async function pool<T, R>(
  inputs: readonly T[],
  limit: number,
  fn: (x: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(inputs.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, inputs.length)) }, async () => {
    while (next < inputs.length) {
      const i = next++;
      out[i] = await fn(inputs[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * The items of `entry`'s collection (every `item` link, fetched a few at a time), cached per
 * collection. An unavailable collection -> `ok: false`. A collection with no item links -> an empty
 * set. Items that fail are listed in `failed` and skipped; only when EVERY listed item failed is the
 * whole result `ok: false`.
 */
export function loadItems(
  entry: CollectionEntry,
  opts: LoadOptions = {},
): Promise<Loaded<ItemSet>> {
  const cache = opts.cache ?? DEFAULT_CACHE;
  return cached(cache, `items:${entry.href}`, async (): Promise<Loaded<ItemSet>> => {
    if (!entry.collection) {
      return {
        ok: false,
        error: entry.error ?? {
          kind: "schema",
          url: entry.href,
          message: "this collection is unavailable",
        },
      };
    }
    const links = entry.collection.links.filter((l) => l.rel === "item");
    const results = await pool(links, opts.concurrency ?? DEFAULT_CONCURRENCY, async (link) => {
      const url = resolveHref(entry.href, link.href);
      if (!url) {
        const error: LoadError = {
          kind: "schema",
          url: entry.href,
          message: `item href "${link.href}" cannot be resolved`,
        };
        return { ok: false, error } as Loaded<StacItem>;
      }
      const raw = await cached(cache, `item:${url}`, () => fetchJson(url, opts));
      return raw.ok ? asItem(raw.value, url) : (raw as Loaded<StacItem>);
    });
    const items: StacItem[] = [];
    const failed: LoadError[] = [];
    for (const r of results) {
      if (r.ok) items.push(r.value);
      else failed.push(r.error);
    }
    if (items.length === 0 && failed.length > 0) {
      return {
        ok: false,
        error: {
          ...failed[0],
          message: `none of the ${failed.length} items could be loaded (${failed[0].message})`,
        },
      };
    }
    return { ok: true, value: { items, failed } };
  });
}

// --- hrefs inside a loaded object ---------------------------------------------------------------

/** an owner whose own URL the loader recorded (`atlas:url`): a collection or an item. */
export interface UrlOwner {
  "atlas:url"?: unknown;
}

/** the absolute URL of `asset`, resolved against the document that lists it (`owner`), so a
 * relative `../values.parquet` inside an item means the collection's file. `null` when the owner has
 * no recorded URL and the href is relative, or the href is unusable. */
export function assetUrl(owner: UrlOwner, asset: Pick<StacAsset, "href">): string | null {
  const from = typeof owner["atlas:url"] === "string" ? (owner["atlas:url"] as string) : null;
  if (typeof asset.href !== "string") return null;
  if (!from) return /^https?:\/\//.test(asset.href) ? asset.href : null;
  return resolveHref(from, asset.href);
}
