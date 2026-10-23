// Which release the app renders. Resolution order (plan atlas-0 Deliverable 2, "Version for that
// script"): a version segment in the URL PATH beats a `?ver=` query parameter, which beats
// `latest.txt` — Cloudflare Access scopes its reviewer policy by path (plan D2), so once a version
// is baked into the path (the preview host, `/{ver}/atlas/`) it has to win over anything a query
// string could smuggle in. A malformed `ver`, in either the path or the query, is treated as
// *absent* and falls through to the next tier rather than surfacing as an error. The label shape
// mirrors `msens::atlas_resolve_ver()` exactly: `^v[0-9]+[a-z]?$` (`v8`, `v9`, `v4b` — never a free
// string, since it becomes a URL path segment).
export const VERSION_RE = /^v[0-9]+[a-z]?$/;

// derived from VERSION_RE.source (strip the ^ and $ anchors, wrap in a capture group between
// slashes) rather than a second hardcoded literal: two independently-typed copies of the same
// shape are exactly how this drifts silently (see tests/release/version.test.ts's regex-source
// assertion and the ^v[0-9]+[a-z]?$ vs ^v[0-9]+[a-z]*$ case it exists to catch).
const PATH_VERSION_RE = new RegExp(`^/(${VERSION_RE.source.slice(1, -1)})/`);

export function isVersionLabel(v: string | null | undefined): v is string {
  return typeof v === "string" && VERSION_RE.test(v);
}

/** the leading `/v9/` (etc.) path segment, if there is one — the preview host's shape. */
export function versionFromPath(pathname: string): string | null {
  const m = PATH_VERSION_RE.exec(pathname);
  return m ? m[1] : null;
}

/** `?ver=` on the query string; a malformed value is treated as absent, not surfaced as an error. */
export function versionFromQuery(search: string): string | null {
  const v = new URLSearchParams(search).get("ver");
  return isVersionLabel(v) ? v : null;
}

export interface LocationLike {
  pathname: string;
  search: string;
}

/**
 * Resolve the version to show: path beats query beats `latest.txt`.
 *
 * `fetchLatest` is injected so this stays unit-testable with no network, and so the inline
 * early-fetch script in index.html — a hand-kept plain-JS copy of this same logic, since it has to
 * run before any bundle parses and so cannot `import` this module — is exercised by the same test
 * cases (see tests/release/version.test.ts).
 */
export async function resolveVersion(
  loc: LocationLike,
  fetchLatest: () => Promise<string>,
): Promise<string | null> {
  const fromPath = versionFromPath(loc.pathname);
  if (fromPath) return fromPath;

  const fromQuery = versionFromQuery(loc.search);
  if (fromQuery) return fromQuery;

  try {
    const latest = await fetchLatest();
    return isVersionLabel(latest) ? latest : null; // a malformed latest.txt is "unresolved", not garbage
  } catch {
    return null; // no path, no query, no network: nothing to resolve to
  }
}
