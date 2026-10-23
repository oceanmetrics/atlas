// THE one place a data origin is formed (plan D6: "`dataBase(ver)` is the one place a data origin
// is formed, and it prefers `session.data` when present").
//
// Why this module exists at all: the app is served from two hosts (`/atlas/` on GitHub Pages and
// `/{ver}/atlas/` on the preview host) but the release files live in neither — they live in the
// bucket. Forming a release URL relatively (`fetch(ver + "/manifest.json")`) resolves against
// whatever path the app happens to be mounted at, which under `/v9/atlas/` produces the doubled
// `/v9/atlas/v9/manifest.json` (a 404 on every host) and, worse, makes the app's data origin
// depend on where it is mounted. Release keys are absolute, always, and they are built here.
//
// `session.json` remains the only same-origin fetch in the app (plan D6, `session.ts`).
import { RELEASE_REGISTRY_BASE } from "../catalog/base";

/**
 * The public registry/data prefix (`catalog/base.ts#RELEASE_REGISTRY_BASE`, the instance's
 * `release.registry`). `latest.txt`, `versions.json` and every published release live
 * directly under it (`{base}latest.txt`, `{base}{ver}/manifest.json`). Path-style S3 URL: the
 * bucket answers CORS for `Origin`/`Range` this way, and the bare `…/{ver}/…` path without the
 * `marine-atlas/` prefix answers 403 (plan "Ground truth", Addendum 2026-09-21).
 */
export const PUBLIC_DATA_BASE = RELEASE_REGISTRY_BASE;

/**
 * A data origin offered by a signed-in `session.json` (plan D6's committed follow-up: a restricted
 * release published under an unguessable prefix "that only the signed-in `session.json` reveals").
 * Either one prefix for every release, or a per-version map — the unguessable-prefix plan is
 * per-release, which is also why {@link dataBase} takes `ver`.
 */
export type SessionData = string | Record<string, string>;

export interface SessionLike {
  preview: boolean;
  raw?: unknown;
}

/**
 * Validate a candidate data prefix. Deliberately strict, because this value arrives as data (from
 * a JSON body) and becomes the origin every release byte is read from:
 *
 * - a non-empty string only (no object, number, null);
 * - parseable as an absolute URL — a relative value like `"./data/"` would resolve same-origin,
 *   which is exactly the failure this module exists to prevent;
 * - `https:` only (never `http:`, never `blob:`/`data:`/`file:`);
 * - no embedded credentials (`https://user:pass@host/`);
 * - no query string and no fragment (a prefix, not a request);
 * - normalized to end in `/` so `base + ver + "/…"` is always well-formed.
 *
 * Anything else is ignored — never thrown on, never partially honoured (the caller falls back to
 * {@link PUBLIC_DATA_BASE}).
 */
export function normalizeDataBase(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null; // relative or unparseable: never accepted, it would mean same-origin
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.search || url.hash) return null;
  return url.pathname.endsWith("/") ? url.href : `${url.href}/`;
}

/**
 * The prefix `session.data` offers for `ver`, or null. Honoured ONLY when the session is preview
 * (plan D6: `session.json` is the sole door into preview mode; a public session's body must never
 * be able to redirect where the app reads data from).
 */
export function sessionDataBase(ver: string | null, session?: SessionLike | null): string | null {
  if (!session || session.preview !== true) return null;
  const raw = session.raw;
  if (!raw || typeof raw !== "object") return null;
  const data = (raw as { data?: unknown }).data;
  if (typeof data === "string") return normalizeDataBase(data);
  if (data && typeof data === "object" && ver) {
    return normalizeDataBase((data as Record<string, unknown>)[ver]);
  }
  return null;
}

/**
 * The base URL under which `ver`'s keys live: `dataBase(ver, session) + ver + "/manifest.json"`.
 * Prefers a valid `session.data` prefix on a preview session (D6), else the public bucket.
 */
export function dataBase(ver: string | null, session?: SessionLike | null): string {
  return sessionDataBase(ver, session) ?? PUBLIC_DATA_BASE;
}

/** An absolute URL for a key inside a release, e.g. `dataUrl("v9", "manifest.json")`. */
export function dataUrl(ver: string, path: string, session?: SessionLike | null): string {
  return `${dataBase(ver, session)}${ver}/${path.replace(/^\/+/, "")}`;
}

/** An absolute URL for a registry file (`latest.txt`, `versions.json`) — always the public base. */
export function registryUrl(path: string): string {
  return `${PUBLIC_DATA_BASE}${path.replace(/^\/+/, "")}`;
}
