// THE one place a catalog data origin is formed (CLAUDE.md: "Data origins are formed in exactly one
// place, absolute"). Every catalog URL the app fetches -- `catalog.json`, a collection, an item, a
// Parquet values file, the PMTiles hex grid -- is resolved from the base returned here; nothing else
// concatenates an origin by hand.
//
// The default is the public bucket read PATH-STYLE
// (`https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/atlas/`) because the friendly host
// `https://storage.oceanmetrics.io/atlas/` currently 302s to S3 without CORS headers, which a
// browser `fetch`/range read cannot follow (om TODO 2026-10-08). Swap the constant once the storage
// host answers CORS.
//
// Two overrides, both validated (https only, no credentials, no query/fragment, normalised to end in
// `/`) so a bad value can never redirect the app's data reads somewhere unintended:
//   - `?catalog=<https url>` -- a run-time override for one session, e.g. a local staging folder
//     served over https with CORS + Range. It lives in `Sel.catalog` (state/types.ts), so the link
//     that carries it reproduces the same view.
//   - `VITE_CATALOG_BASE` -- a build-time override (`.github/workflows/pages.yml`). Being set by whoever
//     builds the app (never by a link), it may ALSO be a plain-http loopback URL
//     (`http://localhost:8080/atlas/`) for developing against a local staging folder served with
//     CORS + Range, where https is awkward; a `?catalog=` link can never be.
// Precedence: `?catalog=` > `VITE_CATALOG_BASE` > the default. A malformed override is ignored (it
// falls through to the next), never thrown on.

import { INSTANCE } from "../brand/instance";

/** the instance's default catalog base (`catalog.base` in instances/<id>/instance.json). */
export const CATALOG_BASE = INSTANCE.catalog.base;

/** the MarineSensitivity release registry the Species lens reads its pinned release from on an
 * instance without a registry of its own (path-style S3: the bare `…/{ver}/…` path without the
 * `marine-atlas/` prefix answers 403). */
const MST_RELEASE_REGISTRY =
  "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/";

/** the release registry base (`latest.txt`, `versions.json`, `{ver}/...`): the instance's
 * `release.registry`, else the MarineSensitivity registry the pinned Species release lives in
 * (`release/mst.ts`). `release/dataBase.ts` forms every release URL from it; the inline early-fetch
 * script is written with the same value (scripts/instance.mjs). */
export const RELEASE_REGISTRY_BASE = INSTANCE.release?.registry ?? MST_RELEASE_REGISTRY;

/**
 * Validate a candidate catalog base. Strict, because the value arrives as data (a query string):
 * a non-empty string; parseable as an absolute URL; `https:` only (`allowLoopbackHttp` additionally
 * admits `http://localhost`, `127.0.0.1` and `[::1]`, for the build-time override only); no embedded
 * credentials; no query string or fragment (a prefix, not a request). Returns the normalised
 * absolute prefix (ending in `/`) or `null`.
 */
export function validateCatalogBase(
  value: unknown,
  opts: { allowLoopbackHttp?: boolean } = {},
): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (v.length === 0) return null;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return null; // relative or unparseable: never accepted, it would mean same-origin
  }
  const loopback =
    url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (
    url.protocol !== "https:" &&
    !(opts.allowLoopbackHttp && url.protocol === "http:" && loopback)
  ) {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.search || url.hash) return null;
  return url.pathname.endsWith("/") ? url.href : `${url.href}/`;
}

/**
 * Validate `?collection=<url of a collection.json>` (WP11 item 6): ONE extra collection read into the
 * picker as "unlisted", e.g. a restricted per-species collection previewed through a private link
 * before it is public. Strict like {@link validateCatalogBase}: `https:` only (no loopback http, a link
 * can never be one), no embedded credentials, no fragment, and the path must end in `.json`. A QUERY is
 * allowed (a signed link carries its signature there). Returns the normalised absolute URL or `null`.
 */
export function validateCollectionUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (v.length === 0) return null;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.hash) return null;
  if (!url.pathname.toLowerCase().endsWith(".json")) return null;
  return url.href;
}

/** the effective catalog base: `?catalog=` (`override`) > `VITE_CATALOG_BASE` (`env`) > the default. */
export function resolveCatalogBase(
  override?: string | null,
  env: string | null | undefined = import.meta.env.VITE_CATALOG_BASE as string | undefined,
): string {
  return (
    validateCatalogBase(override) ??
    validateCatalogBase(env, { allowLoopbackHttp: true }) ??
    CATALOG_BASE
  );
}

/** an absolute URL for `href` -- already absolute, or resolved against `from` (the URL of the
 * document that mentions it: a collection's own `collection.json`, an item's own file). Resolving
 * against the referring document, never against the page, is what makes `../values.parquet` in an
 * item mean the collection's file. `null` for an href that cannot be resolved. */
export function resolveHref(from: string, href: string): string | null {
  try {
    return new URL(href, from).href;
  } catch {
    return null;
  }
}

/** `catalog.json` under `base`. */
export function catalogUrl(base: string): string {
  return resolveHref(base, "catalog.json") ?? `${base}catalog.json`;
}
