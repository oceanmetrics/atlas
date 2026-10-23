// The inline early-fetch script (MarineSensitivity/atlas 0.10.93's index.html and report.html, moved
// here so the two pages carry ONE copy): for an instance with a release registry (instance.json
// `release`), the build writes this file into both pages' <head> at `<!--instance:early-fetch-->`
// (scripts/instance.mjs#renderInstanceHtml), with `%release.registry%` filled from the instance. An
// instance without a release gets nothing. It is plain ES5 so it runs before any bundle parses.
//
// It kicks off the registry (latest.txt, versions.json) and session.json before the app bundle even
// starts parsing, then chains {ver}/manifest.json and {ver}/app/boot.json off the release this host
// is allowed to render. Everything lands on window.__early as promises; nothing here throws -- a
// missing file (GitHub Pages has no session.json) or a network error is swallowed and resolved to a
// safe default, never an unhandled rejection.
//
// Two rules this script exists to enforce, both security-shaped:
//
// 1. Release files are ABSOLUTE bucket URLs (DATA_BASE below, `dataBase()`), never same-origin and
//    never relative: the app is mounted at /atlas/ on one host and /{ver}/atlas/ on the other, so a
//    relative `fetch(ver + "/manifest.json")` both 404s and makes the data origin depend on the mount
//    point. session.json is the ONE same-origin fetch, by design.
// 2. The public host renders PUBLIC releases only. A restricted release (versions.json `access`) is
//    fetched only when the same-origin session says `preview: true`; otherwise the request is never
//    made and the app falls through to latest.txt's release, recording the denial on
//    window.__early.denied. Unknown version, a row with no `access`, or an unreadable versions.json
//    all fail CLOSED.
//
// This duplicates src/lib/release/{version,session,access,dataBase}.ts on purpose: it must run with
// zero bundle before any `import` is possible. Those modules are the source of truth; this copy is
// driven through the SAME case table by tests/release/inline-early-fetch.test.ts (which runs the
// script the build writes, in a node:vm sandbox), so the two cannot drift silently.
(function () {
  var VERSION_RE = /^v[0-9]+[a-z]?$/;
  // derived from VERSION_RE, not a second hardcoded literal — see
  // src/lib/release/version.ts's PATH_VERSION_RE for why (drift).
  var PATH_VERSION_RE = new RegExp("^/(" + VERSION_RE.source.slice(1, -1) + ")/");
  // the instance's release registry (instance.json `release.registry`, written in by the build:
  // scripts/instance.mjs#earlyFetchScript); mirrors PUBLIC_DATA_BASE in src/lib/release/dataBase.ts
  var DATA_BASE = "%release.registry%";

  function versionFromPath(pathname) {
    var m = PATH_VERSION_RE.exec(pathname);
    return m ? m[1] : null;
  }
  function versionFromQuery(search) {
    var v = new URLSearchParams(search).get("ver");
    return v && VERSION_RE.test(v) ? v : null;
  }
  function fetchJSON(url) {
    return fetch(url, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(url + " " + r.status);
      return r.json();
    });
  }

  // --- registry (bucket, starts immediately) ----------------------------------------
  var latest = fetch(DATA_BASE + "latest.txt", { cache: "no-cache" })
    .then(function (r) {
      if (!r.ok) throw new Error("latest.txt " + r.status);
      return r.text();
    })
    .then(function (t) {
      t = t.trim();
      // never stash something that isn't actually a version label — a misconfigured host
      // returning e.g. an error page for a missing latest.txt must not leak into
      // window.__early.version (see src/lib/release/version.ts's isVersionLabel).
      if (!VERSION_RE.test(t)) throw new Error("latest.txt is not a version label");
      return t;
    })
    .catch(function () {
      return null;
    });
  // mirrors src/lib/release/access.ts's normalizeRegistry(): the LIVE file is
  // {"versions":[...]}; a bare array is accepted too; anything else is unreadable (not
  // "empty"), which fails closed to latest.txt's version alone.
  function normalizeRegistry(body) {
    if (Array.isArray(body)) return body;
    if (body && typeof body === "object" && Array.isArray(body.versions)) {
      return body.versions;
    }
    return null;
  }
  var versions = fetchJSON(DATA_BASE + "versions.json")
    .then(normalizeRegistry)
    .catch(function () {
      return null;
    });

  // --- session.json: the one same-origin fetch, and the one door into preview (D6) ----
  // started now, but only AWAITED when a restricted release is in play (below), so the
  // public path never blocks on it. 404 / network error / bad JSON / no preview key = public.
  var session = fetch("session.json", { cache: "no-cache" })
    .then(function (r) {
      if (!r.ok) return { preview: false, raw: null };
      return r
        .json()
        .then(function (body) {
          return {
            preview: !!(body && typeof body === "object" && body.preview === true),
            raw: body,
          };
        })
        .catch(function () {
          return { preview: false, raw: null };
        });
    })
    .catch(function () {
      return { preview: false, raw: null };
    });

  // --- the access gate (mirrors src/lib/release/access.ts) ----------------------------
  function accessOf(rows, ver) {
    if (!ver || !Array.isArray(rows)) return "unknown";
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (row && typeof row === "object" && row.ver === ver) {
        return row.access === "public" ? "public" : "restricted";
      }
    }
    return "unknown";
  }
  // pathVer: the path names a version (`/v9/atlas/`) — the PREVIEW host's URL shape, the only
  // place Caddy serves session.json. session.ver outranks the path (see previewVer below), so
  // the session must be read there even for a public candidate. The PUBLIC host's own shape
  // (`/atlas/`, with or without ?ver=) still never waits unless a restricted release is in play.
  function requiresSession(rows, requested, lat, pathVer) {
    if (pathVer) return true;
    if (!Array.isArray(rows)) return false; // unreadable: latest.txt only, session irrelevant
    return accessOf(rows, requested) === "restricted" || accessOf(rows, lat) === "restricted";
  }
  // mirrors src/lib/release/resolveVer.ts's previewVer()/candidateVer(): in preview mode the
  // version is the one in session.ver and the path AND ?ver= are both ignored — Caddy already
  // decided which release this path may show by routing here at all, so re-deriving it from
  // the URL would let a stray ?ver= on a preview tab ask for a DIFFERENT release. Not trusted
  // unless it is itself a well-formed label, and it still goes through check() below: a
  // session cannot name a version the registry does not list.
  function previewVer(sess) {
    if (!sess || sess.preview !== true) return null;
    var raw = sess.raw;
    if (!raw || typeof raw !== "object") return null;
    var v = raw.ver;
    return typeof v === "string" && VERSION_RE.test(v) ? v : null;
  }
  // returns null when allowed, else the denial reason
  function check(ver, rows, lat, sess) {
    if (!ver) return "unknown-version";
    if (!Array.isArray(rows)) return ver && ver === lat ? null : "registry-unreadable";
    var a = accessOf(rows, ver);
    if (a === "public") return null;
    if (a === "unknown") return "unknown-version";
    return sess && sess.preview === true ? null : "restricted";
  }
  function decide(requested, lat, rows, sess) {
    var candidate = previewVer(sess) || requested || lat;
    if (!candidate) return { ver: null, denied: null };
    var reason = check(candidate, rows, lat, sess);
    if (!reason) return { ver: candidate, denied: null };
    var denied = { ver: candidate, reason: reason };
    if (lat && lat !== candidate && !check(lat, rows, lat, sess)) {
      return { ver: lat, denied: denied }; // fall through to latest, denial recorded
    }
    return { ver: null, denied: denied };
  }

  // --- dataBase (mirrors src/lib/release/dataBase.ts) ---------------------------------
  function normalizeDataBase(value) {
    if (typeof value !== "string" || !value) return null;
    var url;
    try {
      url = new URL(value);
    } catch (e) {
      return null; // relative or unparseable would mean same-origin: never accepted
    }
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (url.search || url.hash) return null;
    return url.pathname.slice(-1) === "/" ? url.href : url.href + "/";
  }
  function dataBase(ver, sess) {
    if (!sess || sess.preview !== true) return DATA_BASE;
    var raw = sess.raw;
    if (!raw || typeof raw !== "object") return DATA_BASE;
    var d = raw.data;
    if (typeof d === "string") return normalizeDataBase(d) || DATA_BASE;
    if (d && typeof d === "object" && ver) return normalizeDataBase(d[ver]) || DATA_BASE;
    return DATA_BASE;
  }

  // --- resolve, gate, then (and only then) fetch the release --------------------------
  var pathVer = versionFromPath(location.pathname);
  var requested = pathVer || versionFromQuery(location.search);

  var decision = Promise.all([latest, versions]).then(function (r) {
    var lat = r[0];
    var rows = r[1];
    var gated = requiresSession(rows, requested, lat, pathVer) ? session : Promise.resolve(null);
    return gated.then(function (sess) {
      var d = decide(requested, lat, rows, sess);
      d.base = dataBase(d.ver, sess);
      return d;
    });
  });

  function releaseJSON(path) {
    return decision
      .then(function (d) {
        return d.ver ? fetchJSON(d.base + d.ver + "/" + path) : null;
      })
      .catch(function () {
        return null; // {ver}/app/boot.json does not exist until atlas-1: a quiet null
      });
  }

  window.__early = {
    version: decision.then(function (d) {
      return d.ver;
    }),
    denied: decision.then(function (d) {
      return d.denied;
    }),
    base: decision.then(function (d) {
      return d.base;
    }),
    versions: versions,
    session: session,
    manifest: releaseJSON("manifest.json"),
    boot: releaseJSON("app/boot.json"),
  };
})();
