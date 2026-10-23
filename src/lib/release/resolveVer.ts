// The production version-resolution pipeline (plan atlas-2 Step 2's `resolveVer()`), composing
// version.ts's precedence, session.ts's preview detection and access.ts's D6 gate into the one
// function later phases call. Everything here is a PURE function over already-resolved inputs (the
// registry, the session, the current location) — nothing fetches, and nothing renders (plan atlas-2:
// "no UI in this phase"). index.html's inline early-fetch script performs the actual fetching today;
// wiring it to call through this module is later phases' work.
import { versionFromPath, versionFromQuery, isVersionLabel, type LocationLike } from "./version";
import { decideAccess, type AccessDecision, type SessionState, type VersionRow } from "./access";
import type { SessionInfo } from "./session";

/**
 * `session.raw.ver` — the preview host's Caddy writes this from the URL path it routed
 * (`/{ver}/atlas/`), so a valid preview session always names the version Access already authorized
 * for this path. Not trusted unless it is itself a well-formed version label (never surfaced as
 * garbage — same fail-closed posture as every other value read out of session.json).
 */
export function previewVer(session: SessionInfo): string | null {
  if (session.preview !== true) return null;
  const raw = session.raw;
  if (!raw || typeof raw !== "object") return null;
  const ver = (raw as Record<string, unknown>).ver;
  return typeof ver === "string" && isVersionLabel(ver) ? ver : null;
}

/** `session.raw.user` — the signed-in reviewer's identity, when the preview session names one. */
export function previewUser(session: SessionInfo): string | undefined {
  if (session.preview !== true) return undefined;
  const raw = session.raw;
  if (!raw || typeof raw !== "object") return undefined;
  const user = (raw as Record<string, unknown>).user;
  return typeof user === "string" && user.length > 0 ? user : undefined;
}

/**
 * The version explicitly NAMED by this request, before falling through to `latest.txt` — that
 * fall-through is `decideAccess()`'s job (access.ts), so it can tell "an explicit request" from "we
 * defaulted to latest" apart in its `source` field. In preview mode `session.ver` is authoritative and
 * the path AND `?ver=` are both ignored outright (plan atlas-2 Step 2: "the version is the one in
 * `session.ver` ... and `?ver=` is ignored") — Caddy already decided which release this path may show
 * by routing here at all, so re-deriving the version from the URL would let a stray `?ver=` on a
 * preview tab ask for a DIFFERENT release than the one Access just authorized. In public mode the
 * existing path-beats-query precedence applies unchanged (version.ts), with no `latest.txt` fallback
 * baked in here.
 */
export function candidateVer(loc: LocationLike, session: SessionInfo): string | null {
  const pv = previewVer(session);
  if (pv) return pv;
  return versionFromPath(loc.pathname) ?? versionFromQuery(loc.search);
}

export interface ResolveVerInput {
  loc: LocationLike;
  session: SessionInfo;
  latest: string | null;
  versions: VersionRow[] | null;
}

/**
 * `resolveVer()`: candidate selection (above), gated through `decideAccess()` (access.ts) — the
 * label must both match `VERSION_RE` and exist in `versions.json`; an unknown label is denied exactly
 * like a malformed one (falls through to `latest.txt`), and a restricted release only resolves for a
 * preview session. A row missing `access` derives fail-closed (`accessOf`, access.ts) — for the
 * headline case the plan cites, a `prerelease` row with no `access` key, this is EXACTLY
 * `msens::atlas_versions()`'s own derivation (`../msens/R/version.R:134-158`, `atlas_access_default()`
 * at :174-175: `status == "prerelease" -> restricted`). For a `released`/`retired` row missing
 * `access`, msens derives `public`; access.ts stays restricted instead (a deliberate, MORE
 * conservative choice made in atlas-0's review, F1 — see access.ts's own docstring) rather than
 * guessing a legacy row is safe to show. That divergence is intentional and not touched here.
 */
export function resolveVer(input: ResolveVerInput): AccessDecision {
  const candidate = candidateVer(input.loc, input.session);
  const session: SessionState = { preview: input.session.preview === true };
  return decideAccess({
    requested: candidate,
    latest: input.latest,
    versions: input.versions,
    session,
  });
}
