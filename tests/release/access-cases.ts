// The ONE case table for the release-access gate (plan D6), plus the module-side driver.
//
// Two copies of these rules exist and must stay identical: the modules under src/lib/release/ and
// the hand-kept plain-JS copy inside index.html's inline early-fetch script (which has to run
// before any bundle parses, so it cannot import them). tests/release/access.test.ts drives the
// modules through this table; tests/release/inline-early-fetch.test.ts runs the REAL inline script
// in a node:vm sandbox through the very same table. A rule changed in one copy and not the other
// fails in exactly one of those two files.
//
// Every expectation is stated as an OBSERVABLE: which URLs were requested (literally — a relative
// base fails the equality), what version resolves, what denial is recorded. "Never renders a
// restricted release on the public host" is asserted as "no request whose URL mentions that
// release", which is the property that actually matters.
import {
  decideAccess,
  normalizeRegistry,
  requiresSession,
  type DenialReason,
  type VersionRow,
} from "../../src/lib/release/access";
import { PUBLIC_DATA_BASE, dataUrl, registryUrl } from "../../src/lib/release/dataBase";
import { resolveSession, type SessionResponseLike } from "../../src/lib/release/session";
import { previewVer } from "../../src/lib/release/resolveVer";
import { isVersionLabel, versionFromPath, versionFromQuery } from "../../src/lib/release/version";

export const LATEST_URL = registryUrl("latest.txt");
export const VERSIONS_URL = registryUrl("versions.json");
export const SESSION_URL = "session.json"; // same-origin, relative on purpose (plan D6)

/** the registry as it stands today (orchestrator-verified 2026-09-21): v7b/v8/v9 restricted. */
export const REGISTRY_ROWS: VersionRow[] = [
  { ver: "v7", status: "release", access: "public", prev: "v6", released: "2026-09-12" },
  { ver: "v7b", status: "prerelease", access: "restricted", prev: "v7", released: "2026-09-20" },
  { ver: "v8", status: "prerelease", access: "restricted", prev: "v7", released: "2026-08-02" },
  { ver: "v9", status: "prerelease", access: "restricted", prev: "v8", released: "2026-09-05" },
];

/**
 * **The LIVE `versions.json` body, verbatim** — `curl -s
 * https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/versions.json`, fetched
 * 2026-09-21. It is a `{"versions":[…]}` WRAPPER, not a bare array, and 11 rows: v7b/v9/v8
 * prerelease+restricted, v7 released+public, v6…v1 retired+public.
 *
 * It is here as data, not as a shape assertion, because the atlas-2 review's finding 1 was exactly
 * that both copies of the gate accepted only a bare array — so the real file read as
 * `registry-unreadable`, hiding public v1–v6 and locking the preview host out of v7b/v8/v9. Both
 * copies are now driven through this body.
 */
export const LIVE_VERSIONS_BODY = {
  versions: [
    {
      ver: "v7b",
      status: "prerelease",
      access: "restricted",
      released: "2026-09-20",
      title: "v7.1: turtle core habitat + coverage floor",
      prev: "v7",
    },
    {
      ver: "v9",
      status: "prerelease",
      access: "restricted",
      released: "2026-08-27",
      title: "AquaX supersedes AquaMaps in US waters",
      prev: null,
    },
    {
      ver: "v8",
      status: "prerelease",
      access: "restricted",
      released: "2026-07-28",
      title: "Marine Atlas",
      prev: null,
    },
    {
      ver: "v7",
      status: "released",
      access: "public",
      released: "2026-06-12",
      title: "Validity decoupled from Program Areas",
      prev: null,
    },
    {
      ver: "v6",
      status: "retired",
      access: "public",
      released: "2026-04-09",
      title: "IUCN range outside US EEZ",
      prev: null,
    },
    {
      ver: "v5",
      status: "retired",
      access: "public",
      released: "2026-03-24",
      title: "MMPA spatial floor",
      prev: null,
    },
    {
      ver: "v4b",
      status: "retired",
      access: "public",
      released: "2026-03-19",
      title: "Turtle multiplicative merge",
      prev: null,
    },
    {
      ver: "v4",
      status: "retired",
      access: "public",
      released: "2026-03-01",
      title: "SWOT sea turtles",
      prev: null,
    },
    {
      ver: "v3",
      status: "retired",
      access: "public",
      released: "2026-02-01",
      title: "Merged models + extinction risk",
      prev: null,
    },
    {
      ver: "v2",
      status: "retired",
      access: "public",
      released: "2026-01-01",
      title: "Program Areas",
      prev: null,
    },
    {
      ver: "v1",
      status: "retired",
      access: "public",
      released: "2023-09-01",
      title: "Planning Areas",
      prev: null,
    },
  ],
};

/** a v8 row with no `access` key at all — must be treated as restricted, never as public. */
export const ROWS_MISSING_ACCESS: VersionRow[] = [
  { ver: "v7", status: "release", access: "public" },
  { ver: "v8", status: "prerelease" },
];

export interface MockRoute {
  reject?: boolean;
  ok?: boolean;
  status?: number;
  textBody?: string;
  jsonBody?: unknown;
  jsonThrows?: boolean;
}

export type Routes = Record<string, MockRoute>;

export interface AccessCase {
  name: string;
  pathname: string;
  search: string;
  routes: Routes;
  expect: {
    /** the release that renders, or null for "render nothing". */
    ver: string | null;
    /** the recorded denial, so the UI can later say why. */
    denied: { ver: string; reason: DenialReason } | null;
    /** the exact manifest URL requested, or null for "no manifest request at all". */
    manifestUrl: string | null;
    /** substrings that must appear in NO requested URL (the gate's real property). */
    forbidden?: string[];
  };
}

const PUBLIC_HOST = { pathname: "/atlas/", search: "" };
const ok = (jsonBody: unknown): MockRoute => ({ ok: true, jsonBody });
const text = (textBody: string): MockRoute => ({ ok: true, textBody });
const missing = (): MockRoute => ({ ok: false, status: 404 });

/** latest.txt = v7 and the real registry, the baseline both hosts start from. */
const REGISTRY: Routes = { [LATEST_URL]: text("v7"), [VERSIONS_URL]: ok(REGISTRY_ROWS) };
const manifestOf = (ver: string, base = PUBLIC_DATA_BASE) => `${base}${ver}/manifest.json`;
const withManifests = (routes: Routes): Routes => ({
  ...routes,
  [manifestOf("v7")]: ok({ ver: "v7" }),
  [manifestOf("v9")]: ok({ ver: "v9" }),
  [manifestOf("v8")]: ok({ ver: "v8" }),
});
/** the live registry lists v1…v9; the retired public ones need manifests too. */
const liveManifests = (routes: Routes): Routes => ({
  ...withManifests(routes),
  [manifestOf("v6")]: ok({ ver: "v6" }),
  [manifestOf("v7b")]: ok({ ver: "v7b" }),
});

export const ACCESS_CASES: AccessCase[] = [
  {
    name: "public release on the public host renders, from the bucket",
    ...PUBLIC_HOST,
    routes: withManifests({ ...REGISTRY, [SESSION_URL]: missing() }),
    expect: { ver: "v7", denied: null, manifestUrl: manifestOf("v7") },
  },
  {
    name: "restricted ?ver= on the public host: never requests that release, falls through to latest",
    pathname: "/atlas/",
    search: "?ver=v9",
    routes: withManifests({ ...REGISTRY, [SESSION_URL]: missing() }),
    expect: {
      ver: "v7",
      denied: { ver: "v9", reason: "restricted" },
      manifestUrl: manifestOf("v7"),
      forbidden: ["/v9/"],
    },
  },
  {
    name: "restricted ?ver= with a preview session renders it",
    pathname: "/atlas/",
    search: "?ver=v9",
    routes: withManifests({ ...REGISTRY, [SESSION_URL]: ok({ preview: true }) }),
    expect: { ver: "v9", denied: null, manifestUrl: manifestOf("v9") },
  },
  {
    name: "restricted ?ver= with a session that is not preview is denied",
    pathname: "/atlas/",
    search: "?ver=v9",
    routes: withManifests({ ...REGISTRY, [SESSION_URL]: ok({ preview: false }) }),
    expect: {
      ver: "v7",
      denied: { ver: "v9", reason: "restricted" },
      manifestUrl: manifestOf("v7"),
      forbidden: ["/v9/"],
    },
  },
  {
    name: "an unknown version is denied even with a preview session (fail closed)",
    pathname: "/atlas/",
    search: "?ver=v42",
    routes: withManifests({ ...REGISTRY, [SESSION_URL]: ok({ preview: true }) }),
    expect: {
      ver: "v7",
      denied: { ver: "v42", reason: "unknown-version" },
      manifestUrl: manifestOf("v7"),
      forbidden: ["/v42/"],
    },
  },
  {
    name: "unreadable versions.json allows only latest.txt's version",
    pathname: "/atlas/",
    search: "?ver=v9",
    routes: withManifests({
      [LATEST_URL]: text("v7"),
      [VERSIONS_URL]: { ok: false, status: 500 },
      [SESSION_URL]: missing(),
    }),
    expect: {
      ver: "v7",
      denied: { ver: "v9", reason: "registry-unreadable" },
      manifestUrl: manifestOf("v7"),
      forbidden: ["/v9/"],
    },
  },
  {
    name: "unreadable versions.json is not widened by a preview session",
    pathname: "/v9/atlas/",
    search: "",
    routes: withManifests({
      [LATEST_URL]: text("v7"),
      [VERSIONS_URL]: { reject: true },
      [SESSION_URL]: ok({ preview: true }),
    }),
    expect: {
      ver: "v7",
      denied: { ver: "v9", reason: "registry-unreadable" },
      manifestUrl: manifestOf("v7"),
      forbidden: ["/v9/"],
    },
  },
  // --- the registry's two accepted shapes, and everything else staying unreadable -------------
  {
    name: 'LIVE versions.json ({"versions":[…]}) on the public host: ?ver=v6 renders v6',
    pathname: "/atlas/",
    search: "?ver=v6",
    routes: liveManifests({
      [LATEST_URL]: text("v7"),
      [VERSIONS_URL]: ok(LIVE_VERSIONS_BODY),
      [SESSION_URL]: missing(),
    }),
    expect: { ver: "v6", denied: null, manifestUrl: manifestOf("v6") },
  },
  {
    name: "LIVE versions.json on the public host: ?ver=v9 is denied and falls through to latest",
    pathname: "/atlas/",
    search: "?ver=v9",
    routes: liveManifests({
      [LATEST_URL]: text("v7"),
      [VERSIONS_URL]: ok(LIVE_VERSIONS_BODY),
      [SESSION_URL]: missing(),
    }),
    expect: {
      ver: "v7",
      denied: { ver: "v9", reason: "restricted" },
      manifestUrl: manifestOf("v7"),
      forbidden: ["/v9/"],
    },
  },
  {
    name: "LIVE versions.json + a preview session on /v9/atlas/ renders v9",
    pathname: "/v9/atlas/",
    search: "",
    routes: liveManifests({
      [LATEST_URL]: text("v7"),
      [VERSIONS_URL]: ok(LIVE_VERSIONS_BODY),
      [SESSION_URL]: ok({ preview: true, ver: "v9" }),
    }),
    expect: { ver: "v9", denied: null, manifestUrl: manifestOf("v9") },
  },
  {
    name: 'a versions.json whose "versions" is a string is unreadable, not empty',
    pathname: "/atlas/",
    search: "?ver=v9",
    routes: withManifests({
      [LATEST_URL]: text("v7"),
      [VERSIONS_URL]: ok({ versions: "x" }),
      [SESSION_URL]: ok({ preview: true }),
    }),
    expect: {
      ver: "v7",
      denied: { ver: "v9", reason: "registry-unreadable" },
      manifestUrl: manifestOf("v7"),
      forbidden: ["/v9/"],
    },
  },
  {
    name: 'a versions.json whose "versions" is null is unreadable',
    pathname: "/atlas/",
    search: "?ver=v9",
    routes: withManifests({
      [LATEST_URL]: text("v7"),
      [VERSIONS_URL]: ok({ versions: null }),
      [SESSION_URL]: ok({ preview: true }),
    }),
    expect: {
      ver: "v7",
      denied: { ver: "v9", reason: "registry-unreadable" },
      manifestUrl: manifestOf("v7"),
      forbidden: ["/v9/"],
    },
  },
  {
    name: "an object with no versions key at all is unreadable",
    pathname: "/atlas/",
    search: "?ver=v9",
    routes: withManifests({
      [LATEST_URL]: text("v7"),
      [VERSIONS_URL]: ok({}),
      [SESSION_URL]: ok({ preview: true }),
    }),
    expect: {
      ver: "v7",
      denied: { ver: "v9", reason: "registry-unreadable" },
      manifestUrl: manifestOf("v7"),
      forbidden: ["/v9/"],
    },
  },
  {
    name: "a row with no access key is treated as restricted on the public host",
    pathname: "/atlas/",
    search: "?ver=v8",
    routes: withManifests({
      [LATEST_URL]: text("v7"),
      [VERSIONS_URL]: ok(ROWS_MISSING_ACCESS),
      [SESSION_URL]: missing(),
    }),
    expect: {
      ver: "v7",
      denied: { ver: "v8", reason: "restricted" },
      manifestUrl: manifestOf("v7"),
      forbidden: ["/v8/"],
    },
  },
  {
    name: "a row with no access key still renders for a preview session",
    pathname: "/atlas/",
    search: "?ver=v8",
    routes: withManifests({
      [LATEST_URL]: text("v7"),
      [VERSIONS_URL]: ok(ROWS_MISSING_ACCESS),
      [SESSION_URL]: ok({ preview: true }),
    }),
    expect: { ver: "v8", denied: null, manifestUrl: manifestOf("v8") },
  },
  {
    name: "/v9/atlas/ on the preview host requests v9's manifest from the bucket (no doubled segment)",
    pathname: "/v9/atlas/",
    search: "",
    routes: withManifests({ ...REGISTRY, [SESSION_URL]: ok({ preview: true }) }),
    expect: { ver: "v9", denied: null, manifestUrl: manifestOf("v9") },
  },
  {
    name: "/v9/atlas/ without a session (session.json 404) requests nothing under v9",
    pathname: "/v9/atlas/",
    search: "",
    routes: withManifests({ ...REGISTRY, [SESSION_URL]: missing() }),
    expect: {
      ver: "v7",
      denied: { ver: "v9", reason: "restricted" },
      manifestUrl: manifestOf("v7"),
      forbidden: ["/v9/"],
    },
  },
  {
    name: "a public release named by the path renders even when session.json rejects",
    pathname: "/v7/atlas/",
    search: "",
    routes: withManifests({ ...REGISTRY, [SESSION_URL]: { reject: true } }),
    expect: { ver: "v7", denied: null, manifestUrl: manifestOf("v7") },
  },

  // --- session.ver outranks the path and ?ver= in preview mode (resolveVer.ts's candidateVer) ---
  {
    name: "a preview session's session.ver wins over the path",
    pathname: "/v7/atlas/", // path says v7 …
    search: "",
    routes: withManifests({
      ...REGISTRY,
      [SESSION_URL]: ok({ preview: true, ver: "v9" }), // … the session says v9
    }),
    expect: { ver: "v9", denied: null, manifestUrl: manifestOf("v9") },
  },
  {
    name: "a preview session's session.ver wins over ?ver= too",
    pathname: "/v8/atlas/",
    search: "?ver=v8",
    routes: withManifests({ ...REGISTRY, [SESSION_URL]: ok({ preview: true, ver: "v9" }) }),
    expect: { ver: "v9", denied: null, manifestUrl: manifestOf("v9") },
  },
  {
    name: "session.ver still goes through the access check: a version the registry does not list is denied",
    pathname: "/v7/atlas/",
    search: "",
    routes: withManifests({ ...REGISTRY, [SESSION_URL]: ok({ preview: true, ver: "v42" }) }),
    expect: {
      ver: "v7",
      denied: { ver: "v42", reason: "unknown-version" },
      manifestUrl: manifestOf("v7"),
      forbidden: ["/v42/"],
    },
  },
  {
    name: "a malformed session.ver is ignored and the path is used",
    pathname: "/v7/atlas/",
    search: "",
    routes: withManifests({ ...REGISTRY, [SESSION_URL]: ok({ preview: true, ver: "v9ab" }) }),
    expect: { ver: "v7", denied: null, manifestUrl: manifestOf("v7") },
  },
  {
    name: "a NON-preview session's ver is ignored entirely",
    pathname: "/v7/atlas/",
    search: "",
    routes: withManifests({ ...REGISTRY, [SESSION_URL]: ok({ preview: false, ver: "v9" }) }),
    expect: { ver: "v7", denied: null, manifestUrl: manifestOf("v7"), forbidden: ["/v9/"] },
  },
  {
    name: "when the fall-through target is itself restricted, nothing renders",
    pathname: "/atlas/",
    search: "?ver=v8",
    routes: withManifests({
      [LATEST_URL]: text("v9"),
      [VERSIONS_URL]: ok(REGISTRY_ROWS),
      [SESSION_URL]: missing(),
    }),
    expect: {
      ver: null,
      denied: { ver: "v8", reason: "restricted" },
      manifestUrl: null,
      forbidden: ["/v8/", "/v9/"],
    },
  },
  {
    name: "no version resolves at all (latest.txt missing): no manifest request",
    ...PUBLIC_HOST,
    routes: withManifests({
      [LATEST_URL]: missing(),
      [VERSIONS_URL]: ok(REGISTRY_ROWS),
      [SESSION_URL]: missing(),
    }),
    expect: { ver: null, denied: null, manifestUrl: null },
  },
  {
    name: "a malformed latest.txt body is not a version (no manifest request)",
    ...PUBLIC_HOST,
    routes: withManifests({
      [LATEST_URL]: text("<!doctype html>"),
      [VERSIONS_URL]: ok(REGISTRY_ROWS),
      [SESSION_URL]: missing(),
    }),
    expect: { ver: null, denied: null, manifestUrl: null },
  },
  {
    name: "a malformed ?ver= falls through to latest.txt, as before the gate existed",
    pathname: "/atlas/",
    search: "?ver=v9ab",
    routes: withManifests({ ...REGISTRY, [SESSION_URL]: missing() }),
    expect: { ver: "v7", denied: null, manifestUrl: manifestOf("v7") },
  },
  {
    name: "session.data redirects the data origin for a preview session (plan D6 follow-up)",
    pathname: "/v9/atlas/",
    search: "",
    routes: withManifests({
      ...REGISTRY,
      [SESSION_URL]: ok({ preview: true, data: "https://data.example.org/secret-prefix" }),
      [manifestOf("v9", "https://data.example.org/secret-prefix/")]: ok({ ver: "v9" }),
    }),
    expect: {
      ver: "v9",
      denied: null,
      manifestUrl: manifestOf("v9", "https://data.example.org/secret-prefix/"),
    },
  },
  {
    name: "session.data as a per-version map is honoured for that version only",
    pathname: "/v9/atlas/",
    search: "",
    routes: withManifests({
      ...REGISTRY,
      [SESSION_URL]: ok({ preview: true, data: { v8: "https://other.example.org/x/" } }),
    }),
    expect: { ver: "v9", denied: null, manifestUrl: manifestOf("v9") },
  },
  {
    name: "a non-https session.data is ignored (falls back to the public bucket)",
    pathname: "/v9/atlas/",
    search: "",
    routes: withManifests({
      ...REGISTRY,
      [SESSION_URL]: ok({ preview: true, data: "http://data.example.org/x/" }),
    }),
    expect: { ver: "v9", denied: null, manifestUrl: manifestOf("v9") },
  },
  {
    name: "a relative session.data is ignored (it would mean same-origin)",
    pathname: "/v9/atlas/",
    search: "",
    routes: withManifests({
      ...REGISTRY,
      [SESSION_URL]: ok({ preview: true, data: "./data/" }),
    }),
    expect: { ver: "v9", denied: null, manifestUrl: manifestOf("v9") },
  },
  {
    name: "session.data on a non-preview session is ignored entirely",
    pathname: "/atlas/",
    search: "",
    routes: withManifests({
      ...REGISTRY,
      [SESSION_URL]: ok({ preview: false, data: "https://data.example.org/x/" }),
    }),
    expect: { ver: "v7", denied: null, manifestUrl: manifestOf("v7") },
  },
];

export interface PipelineResult {
  ver: string | null;
  denied: { ver: string; reason: DenialReason } | null;
  /** every URL the pipeline requested, in order. */
  requested: string[];
}

/** a fetch stub over a {@link Routes} table; shared by the module driver and the vm sandbox. */
export function makeFetch(routes: Routes, requested?: string[]) {
  return async (url: string) => {
    requested?.push(url);
    const r = routes[url] ?? { ok: false, status: 404 };
    if (r.reject) throw new Error("network error");
    return {
      ok: r.ok ?? true,
      status: r.status ?? (r.ok ? 200 : 404),
      text: async () => r.textBody ?? "",
      json: async () => {
        if (r.jsonThrows) throw new Error("bad json");
        return r.jsonBody;
      },
    };
  };
}

/**
 * The module-side pipeline: the same sequence index.html's inline script performs, but assembled
 * out of the exported functions. Keeping it here (rather than inside one test file) is what lets
 * the module test and the vm test assert the identical expectations from the identical inputs.
 */
export async function runModulePipeline(c: AccessCase): Promise<PipelineResult> {
  const requested: string[] = [];
  const fetchImpl = makeFetch(c.routes, requested);

  const pathVer = versionFromPath(c.pathname);
  const asked = pathVer ?? versionFromQuery(c.search);

  const latest = await fetchImpl(LATEST_URL)
    .then(async (r) => {
      if (!r.ok) throw new Error("latest.txt");
      const t = (await r.text()).trim();
      return isVersionLabel(t) ? t : null;
    })
    .catch(() => null);

  // BOTH accepted shapes, one rule: access.ts's normalizeRegistry(). index.html's inline copy has
  // the byte-equivalent function, and this table drives both.
  const versions = await fetchImpl(VERSIONS_URL)
    .then(async (r) => {
      if (!r.ok) throw new Error("versions.json");
      return normalizeRegistry(await r.json());
    })
    .catch(() => null);

  // session.json is started unconditionally but awaited ONLY when a candidate release is
  // restricted, or when the PATH names a version (the preview host's shape, where session.ver
  // outranks the path) — the public host's own `/atlas/` shape must never wait on it (plan D6).
  const sessionPromise = resolveSession(
    () => fetchImpl(SESSION_URL) as Promise<SessionResponseLike>,
  );
  const sessionInfo = requiresSession(versions, asked, latest, { pathNamesVersion: !!pathVer })
    ? await sessionPromise
    : null;
  const session = sessionInfo;

  // candidateVer()'s rule (resolveVer.ts): in preview mode session.ver is authoritative and both
  // the path and ?ver= are ignored. It is still gated by decideAccess() below.
  const candidate = (sessionInfo ? previewVer(sessionInfo) : null) ?? asked;

  const decision = decideAccess({ requested: candidate, latest, versions, session });
  if (decision.ver) {
    await fetchImpl(dataUrl(decision.ver, "manifest.json", session)).catch(() => null);
    await fetchImpl(dataUrl(decision.ver, "app/boot.json", session)).catch(() => null);
  }
  await sessionPromise; // settle the unawaited promise so the request list is complete

  return { ver: decision.ver, denied: decision.denied, requested };
}
