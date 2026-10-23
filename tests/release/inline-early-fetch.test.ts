// Drift guard: index.html's inline early-fetch script is a hand-kept plain-JS copy of
// src/lib/release/{version,session,access,dataBase}.ts (it has to run before any bundle parses, so
// it cannot `import` them). Nothing stops the two from silently diverging — so this test extracts
// the ACTUAL script text from the source file, runs it for real in a node:vm sandbox with a
// stubbed location/fetch, and drives it through the SAME case table the modules are driven
// through (tests/release/access-cases.ts), plus the version/session cases. A rule changed in one
// copy and not the other fails here.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import {
  earlyFetchScript,
  instanceHtmlExtras,
  loadInstance,
  readEarlyFetch,
  readMark,
  renderInstanceHtml,
} from "../../scripts/instance.mjs";
import { describe, expect, it } from "vitest";
import { VERSION_RE } from "../../src/lib/release/version";
import { PUBLIC_DATA_BASE } from "../../src/lib/release/dataBase";
import type { VersionRow } from "../../src/lib/release/access";
import {
  ACCESS_CASES,
  LATEST_URL,
  SESSION_URL,
  VERSIONS_URL,
  makeFetch,
  type MockRoute,
  type Routes,
} from "./access-cases";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function extractEarlyFetchScript(html: string): string {
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const found = blocks.find((b) => b.includes("VERSION_RE"));
  if (!found) throw new Error("no inline script containing VERSION_RE found");
  return found;
}

function extractInlineVersionRe(script: string): RegExp {
  const m = /var VERSION_RE\s*=\s*(\/(?:\\.|[^\\/])*\/[a-z]*)\s*;/.exec(script);
  if (!m) throw new Error("VERSION_RE literal not found in inline script");
  // m[1] is a regex literal captured from our own index.html, not external input.
  return eval(m[1]);
}

function extractInlineDataBase(script: string): string {
  const m = /var DATA_BASE\s*=\s*"([^"]+)"\s*;/.exec(script);
  if (!m) throw new Error("DATA_BASE literal not found in inline script");
  return m[1];
}

interface Early {
  version: Promise<string | null>;
  denied: Promise<{ ver: string; reason: string } | null>;
  base: Promise<string>;
  versions: Promise<unknown>;
  session: Promise<{ preview: boolean; raw: unknown }>;
  manifest: Promise<unknown>;
  boot: Promise<unknown>;
}

function runEarlyFetch(opts: {
  pathname: string;
  search: string;
  routes?: Routes;
  requested?: string[];
  fetchImpl?: (url: string) => Promise<unknown>;
  /** which extracted script text to run -- defaults to index.html's. atlas-7 step 2 passes
   * report.html's own copy through the SAME cases below. */
  script?: string;
}): Early {
  const sandbox: Record<string, unknown> = {
    location: { pathname: opts.pathname, search: opts.search },
    fetch: opts.fetchImpl ?? makeFetch(opts.routes ?? {}, opts.requested),
    URLSearchParams,
    URL,
  };
  sandbox.window = sandbox;
  const ctx = createContext(sandbox);
  runInContext(opts.script ?? script, ctx);
  return (sandbox.window as { __early: Early }).__early;
}

// the pages as the build writes them for this instance: the early-fetch script is
// src/lib/release/earlyFetch.inline.js, written into both pages at `<!--instance:early-fetch-->`
// with the instance's registry (scripts/instance.mjs); this project runs for an instance with one
const INSTANCE_JSON = loadInstance(undefined, ROOT);
const render = (file: string) =>
  renderInstanceHtml(
    readFileSync(resolve(ROOT, file), "utf8"),
    INSTANCE_JSON,
    readMark(INSTANCE_JSON, ROOT),
    instanceHtmlExtras(INSTANCE_JSON, ROOT),
  );
const html = render("index.html");
const script = extractEarlyFetchScript(html);

// atlas-7 step 2: report.html must refuse a restricted `ver` on the public host exactly as
// index.html does -- it carries the SAME script (duplicated for the same reason index.html's is:
// it must run before any bundle parses), never a shortened or re-derived copy.
const reportHtml = render("report.html");
const reportScript = extractEarlyFetchScript(reportHtml);

/** a registry where everything is public, so version-resolution cases aren't gated by access. */
function allPublic(...vers: string[]): VersionRow[] {
  return vers.map((ver) => ({ ver, status: "release", access: "public" }));
}
const OPEN_REGISTRY: VersionRow[] = allPublic("v3", "v6", "v7", "v9");
const openRoutes = (latest: MockRoute): Routes => ({
  [LATEST_URL]: latest,
  [VERSIONS_URL]: { ok: true, jsonBody: OPEN_REGISTRY },
  [SESSION_URL]: { ok: false, status: 404 },
});

describe("index.html's inline literals", () => {
  it("VERSION_RE equals src/lib/release/version.ts's VERSION_RE.source exactly", () => {
    expect(extractInlineVersionRe(script).source).toBe(VERSION_RE.source);
  });

  it("DATA_BASE equals src/lib/release/dataBase.ts's PUBLIC_DATA_BASE exactly", () => {
    expect(extractInlineDataBase(script)).toBe(PUBLIC_DATA_BASE);
  });
});

describe("report.html carries the IDENTICAL early-fetch script as index.html", () => {
  it("is byte-for-byte the same script text (change one without the other and this goes red)", () => {
    expect(reportScript).toBe(script);
  });

  it("VERSION_RE/DATA_BASE in report.html's copy equal the same source-of-truth values", () => {
    expect(extractInlineVersionRe(reportScript).source).toBe(VERSION_RE.source);
    expect(extractInlineDataBase(reportScript)).toBe(PUBLIC_DATA_BASE);
  });

  it("runs the shared access case table identically to index.html's copy", async () => {
    for (const c of ACCESS_CASES) {
      const early = runEarlyFetch({
        pathname: c.pathname,
        search: c.search,
        routes: c.routes,
        script: reportScript,
      });
      await expect(early.version).resolves.toBe(c.expect.ver);
      await expect(early.denied).resolves.toEqual(c.expect.denied);
    }
  });
});

describe("inline early-fetch script: version resolution (mirrors tests/release/version.test.ts)", () => {
  it("path beats query beats latest.txt", async () => {
    const early = runEarlyFetch({
      pathname: "/v9/atlas/",
      search: "?ver=v3",
      routes: openRoutes({ ok: true, textBody: "v6" }),
    });
    await expect(early.version).resolves.toBe("v9");
  });

  it("query beats latest.txt when the path has no version", async () => {
    const early = runEarlyFetch({
      pathname: "/atlas/",
      search: "?ver=v3",
      routes: openRoutes({ ok: true, textBody: "v6" }),
    });
    await expect(early.version).resolves.toBe("v3");
  });

  it("falls back to latest.txt when neither path nor query name a version", async () => {
    const early = runEarlyFetch({
      pathname: "/atlas/",
      search: "",
      routes: openRoutes({ ok: true, textBody: "v7" }),
    });
    await expect(early.version).resolves.toBe("v7");
  });

  it("a malformed path/query value falls through rather than being accepted (v9ab: the [a-z]? vs [a-z]* case)", async () => {
    const early = runEarlyFetch({
      pathname: "/v9ab/atlas/",
      search: "?ver=v9ab",
      routes: openRoutes({ ok: true, textBody: "v7" }),
    });
    await expect(early.version).resolves.toBe("v7");
  });

  it("a malformed latest.txt body resolves to null, never propagated as a version", async () => {
    const early = runEarlyFetch({
      pathname: "/atlas/",
      search: "",
      routes: openRoutes({ ok: true, textBody: "not-a-version" }),
    });
    await expect(early.version).resolves.toBeNull();
  });

  it("latest.txt unreachable (network error) resolves to null, not a throw", async () => {
    const early = runEarlyFetch({
      pathname: "/atlas/",
      search: "",
      routes: openRoutes({ reject: true }),
    });
    await expect(early.version).resolves.toBeNull();
  });

  it("reads latest.txt and versions.json from the bucket, not same-origin", async () => {
    const requested: string[] = [];
    const early = runEarlyFetch({
      pathname: "/v9/atlas/",
      search: "",
      routes: openRoutes({ ok: true, textBody: "v7" }),
      requested,
    });
    await early.version;
    expect(requested).toContain(LATEST_URL);
    expect(requested).toContain(VERSIONS_URL);
    expect(requested.filter((u) => u === "latest.txt" || u === "versions.json")).toEqual([]);
  });
});

describe("inline early-fetch script: session/preview mode (mirrors tests/release/session.test.ts)", () => {
  const sessionRoutes = (session: MockRoute): Routes => ({
    ...openRoutes({ ok: true, textBody: "v7" }),
    [SESSION_URL]: session,
  });

  it("a 404 is public", async () => {
    const early = runEarlyFetch({
      pathname: "/atlas/",
      search: "",
      routes: sessionRoutes({ ok: false, status: 404 }),
    });
    await expect(early.session).resolves.toEqual({ preview: false, raw: null });
  });

  it("a network error is public", async () => {
    const early = runEarlyFetch({
      pathname: "/atlas/",
      search: "",
      routes: sessionRoutes({ reject: true }),
    });
    await expect(early.session).resolves.toEqual({ preview: false, raw: null });
  });

  it("a 200 with an unparsable body is public", async () => {
    const early = runEarlyFetch({
      pathname: "/atlas/",
      search: "",
      routes: sessionRoutes({ ok: true, jsonThrows: true }),
    });
    await expect(early.session).resolves.toEqual({ preview: false, raw: null });
  });

  it("a 200 without preview:true is public", async () => {
    const early = runEarlyFetch({
      pathname: "/atlas/",
      search: "",
      routes: sessionRoutes({ ok: true, jsonBody: { preview: false } }),
    });
    await expect(early.session.then((s) => s.preview)).resolves.toBe(false);
  });

  it("a 200 with an empty body is public", async () => {
    const early = runEarlyFetch({
      pathname: "/atlas/",
      search: "",
      routes: sessionRoutes({ ok: true, jsonBody: {} }),
    });
    await expect(early.session.then((s) => s.preview)).resolves.toBe(false);
  });

  it("only a 200 with preview:true is preview", async () => {
    const early = runEarlyFetch({
      pathname: "/atlas/",
      search: "",
      routes: sessionRoutes({ ok: true, jsonBody: { preview: true } }),
    });
    await expect(early.session.then((s) => s.preview)).resolves.toBe(true);
  });
});

describe("inline early-fetch script: session.json is never awaited on the public path", () => {
  // the one property a request list cannot show: a session.json that never answers (a hung
  // same-origin request) must not hold up a PUBLIC release's manifest, and must absolutely hold
  // up a restricted one's.

  it("a public release's manifest resolves while session.json is still pending", async () => {
    const routes = {
      [LATEST_URL]: { ok: true, textBody: "v7" },
      [VERSIONS_URL]: { ok: true, jsonBody: allPublic("v7") },
      [`${PUBLIC_DATA_BASE}v7/manifest.json`]: { ok: true, jsonBody: { ver: "v7" } },
    } satisfies Routes;
    const inner = makeFetch(routes);
    const early = runEarlyFetch({
      pathname: "/atlas/",
      search: "",
      fetchImpl: (url) => (url === SESSION_URL ? new Promise(() => {}) : inner(url)),
    });
    await expect(early.manifest).resolves.toEqual({ ver: "v7" });
  });

  it("a restricted release requests nothing while session.json is still pending", async () => {
    const requested: string[] = [];
    const routes = {
      [LATEST_URL]: { ok: true, textBody: "v7" },
      [VERSIONS_URL]: {
        ok: true,
        jsonBody: [
          { ver: "v7", access: "public" },
          { ver: "v9", access: "restricted" },
        ],
      },
      [`${PUBLIC_DATA_BASE}v9/manifest.json`]: { ok: true, jsonBody: { ver: "v9" } },
      [`${PUBLIC_DATA_BASE}v7/manifest.json`]: { ok: true, jsonBody: { ver: "v7" } },
    } satisfies Routes;
    const inner = makeFetch(routes, requested);
    const early = runEarlyFetch({
      pathname: "/v9/atlas/",
      search: "",
      fetchImpl: (url) => {
        if (url === SESSION_URL) {
          requested.push(url);
          return new Promise(() => {});
        }
        return inner(url);
      },
    });
    // let every settled promise drain; the gate is still waiting on session.json
    const drained = await Promise.race([
      early.version.then(() => "resolved"),
      new Promise((r) => setTimeout(() => r("pending"), 20)),
    ]);
    expect(drained).toBe("pending");
    expect(requested.filter((u) => u.includes("/v9/") || u.includes("/v7/"))).toEqual([]);
  });
});

describe("the shared access case table, run against index.html's REAL inline script", () => {
  for (const c of ACCESS_CASES) {
    it(c.name, async () => {
      const requested: string[] = [];
      const early = runEarlyFetch({
        pathname: c.pathname,
        search: c.search,
        routes: c.routes,
        requested,
      });

      await expect(early.version).resolves.toBe(c.expect.ver);
      await expect(early.denied).resolves.toEqual(c.expect.denied);
      await early.manifest;
      await early.boot;
      await early.session;

      const manifests = requested.filter((u) => u.endsWith("/manifest.json"));
      expect(manifests).toEqual(c.expect.manifestUrl ? [c.expect.manifestUrl] : []);

      for (const forbidden of c.expect.forbidden ?? []) {
        expect(requested.filter((u) => u.includes(forbidden))).toEqual([]);
      }

      // session.json is the ONLY same-origin (relative) request; everything else is absolute.
      for (const url of requested) {
        if (url === SESSION_URL) continue;
        expect(url.startsWith("https://")).toBe(true);
      }
    });
  }

  it("boot.json's absence (it does not exist until atlas-1) is a quiet null, not a throw", async () => {
    const early = runEarlyFetch({
      pathname: "/atlas/",
      search: "",
      routes: {
        [LATEST_URL]: { ok: true, textBody: "v7" },
        [VERSIONS_URL]: { ok: true, jsonBody: allPublic("v7") },
        [`${PUBLIC_DATA_BASE}v7/manifest.json`]: { ok: true, jsonBody: { ver: "v7" } },
        [`${PUBLIC_DATA_BASE}v7/app/boot.json`]: { ok: false, status: 404 },
      },
    });
    await expect(early.boot).resolves.toBeNull();
    await expect(early.manifest).resolves.toEqual({ ver: "v7" });
  });
});

// WAS `describe.skip` — the gap it named is closed (atlas-2 phase review, fix round 1, ruling 2).
// src/lib/release/resolveVer.ts's candidateVer() makes session.ver AUTHORITATIVE in preview mode and
// ignores the path AND ?ver= outright (Caddy already decided which release a path may show by
// routing there at all); the inline script now carries the same rule, and the shared case table
// (`ACCESS_CASES`) drives both copies through it.
describe("the inline early-fetch script prefers session.ver in preview mode (candidateVer's rule)", () => {
  const CONFLICTING_ROUTES: Routes = {
    [LATEST_URL]: { ok: true, textBody: "v7" },
    [VERSIONS_URL]: {
      ok: true,
      jsonBody: [
        { ver: "v7", access: "public" },
        { ver: "v9", access: "restricted" },
      ],
    },
    [SESSION_URL]: { ok: true, jsonBody: { preview: true, ver: "v9" } }, // session says v9
  };

  it("a preview session whose session.ver disagrees with the path resolves to session.ver", async () => {
    const early = runEarlyFetch({
      pathname: "/v7/atlas/", // path says v7
      search: "",
      routes: CONFLICTING_ROUTES,
    });
    await expect(early.version).resolves.toBe("v9");
  });

  it("the path naming a version is what makes the session readable at all (the preview host's shape)", async () => {
    // the same session, but at the PUBLIC host's URL shape (`/atlas/`, no version segment) and with
    // a public candidate: the session is never awaited there, so session.ver cannot apply. This is
    // the half of D6 that must not regress — the public host never waits on a same-origin round
    // trip unless a restricted release is in play.
    const requested: string[] = [];
    const inner = makeFetch(CONFLICTING_ROUTES, requested);
    const early = runEarlyFetch({
      pathname: "/atlas/",
      search: "",
      fetchImpl: (url) => {
        if (url === SESSION_URL) {
          requested.push(url);
          return new Promise(() => {}); // a session.json that never answers
        }
        return inner(url);
      },
    });
    await expect(early.version).resolves.toBe("v7");
  });
});

// the build's storage rule reaches the inline script: `%release.registry%` is filled through the same rule as
// RELEASE_REGISTRY_BASE (src/lib/release; decision D7), the node twin of onStorage (scripts/instance.mjs)
describe("%release.registry% is filled through the storage rule", () => {
  const S3_REGISTRY = "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/";
  const STORAGE_REGISTRY = "https://storage.oceanmetrics.io/marine-atlas/";
  const source = readEarlyFetch(ROOT);
  const instanceWith = (registry: string) => ({ ...INSTANCE_JSON, release: { registry } });
  const dataBaseOf = (env: Record<string, string>, registry: string) =>
    extractInlineDataBase(earlyFetchScript(instanceWith(registry), source, env));

  it("an S3 registry reads the chosen store: VITE_OM_STORAGE=storage writes storage.oceanmetrics.io", () => {
    expect(dataBaseOf({ VITE_OM_STORAGE: "storage" }, S3_REGISTRY)).toBe(STORAGE_REGISTRY);
  });

  it("the default build writes the storage host (catalog 0.6.0), whichever storage host the instance names", () => {
    expect(dataBaseOf({}, S3_REGISTRY)).toBe(STORAGE_REGISTRY);
    expect(dataBaseOf({}, STORAGE_REGISTRY)).toBe(STORAGE_REGISTRY);
  });

  it("VITE_OM_STORAGE=s3 (the rollback) writes path-style S3", () => {
    expect(dataBaseOf({ VITE_OM_STORAGE: "s3" }, STORAGE_REGISTRY)).toBe(S3_REGISTRY);
  });

  it("REGRESSION: a registry on another host is written as it is, on either storage setting", () => {
    const other = "https://registry.example.test/marine-atlas/";
    expect(dataBaseOf({ VITE_OM_STORAGE: "storage" }, other)).toBe(other);
    expect(dataBaseOf({}, other)).toBe(other);
  });
});
