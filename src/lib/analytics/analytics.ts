// Port of `msens::ga_js()` (analytics.R:283-448): GA4 config + a batched Sheet-log beacon, driven
// entirely from the browser so nothing here ever blocks on network I/O. Every browser global this
// needs (navigator, document, window, localStorage, sessionStorage, gtag, the clock) is injected
// with a guarded default, so `createAnalytics()` runs under Node with zero DOM and sends nothing
// unless a test hands it a fake transport — see transport.ts's header and this repo's "No network
// call in tests: inject the transport" contract.
//
// Differences from the R original, both required by atlas's URL-as-state design (plan D8):
//   1. `page_location`/the Sheet's `page` column are REBUILT via pageLocation.ts, never read off
//      the live page location's own href/pathname+search fields directly.
//   2. `navigator.webdriver` sessions are excluded ENTIRELY (no GA4 config call, no queued row) —
//      the Shiny apps have no analogous concept; this keeps Playwright/CI runs out of both legs.
//
// FIX ROUND 1 (privacy leak, real defect): setting a sanitized `page_location` on OUR OWN events was
// not enough. `gtag("config", ID, {...})` with no `send_page_view: false` fires gtag.js's OWN
// automatic page_view, whose `page_location` field gtag.js fills in internally from the live page
// location's href — INCLUDING the fragment — unless told otherwise. The fix has four parts, all
// below: (a) `send_page_view: false` on every config call, so that automatic hit never fires; (b) we
// fire our OWN `page_view` event immediately after, carrying our sanitized fields; (c) `page_location`
// (and `page_title`, which is a fixed string, never the live document title — see pageLocation.ts's
// `buildPageTitle`) is attached EXPLICITLY to every single gtag call this module makes — config,
// page_view, and every `track()`-driven event — so nothing ever falls back to gtag.js's own default;
// (d) `updateLocation()` lets the state layer (which owns `history.replaceState`, see
// src/lib/state/) tell this module the URL changed, so those explicit fields stay current across an
// SPA navigation without this module ever reading the live location itself. See docs/analytics.md
// for the one thing code here cannot enforce: GA4's "Enhanced Measurement: page changes based on
// browser history events" property setting, which — if left ON — makes gtag.js re-read the live
// page location on its own for `pushState`/`replaceState`/`popstate`, bypassing all of the above.
//
// tests/analytics/noRawLocation.wiring.test.ts source-scans this whole directory for the live page
// location's `href`/hash-fragment fields and for the document's own URL/location globals — nothing
// under src/lib/analytics may reference any of them, by name, anywhere, including in a comment (which
// is why this file's prose above spells them out instead of writing the literal dotted form).
//
// OUT OF SCOPE here: inserting the `<script async src="https://www.googletagmanager.com/gtag/js?...">`
// loader tag. That is wiring into a real page (this phase ships "plain TypeScript modules ... nothing
// added to the entry's static graph yet") and belongs to whichever later phase mounts this into
// index.html/report.html. `gtag`/`window.dataLayer` are still installed the same way `ga_js()`'s
// inline script does, so `track()` calls made before that loader tag lands simply queue into
// `dataLayer` the way GA4's own snippet already expects.
import { EVENT_NAMES, type EventName, type EventParamsMap } from "./events";
import { hasBrowserGlobals } from "./env";
import { GA_MAX_PARAM_CHARS, msEvent } from "./msEvent";
import { sanitizeParams } from "./sanitize";
import {
  buildPageLocation,
  buildPagePath,
  buildPageTitle,
  type LocationLike,
} from "./pageLocation";
import { createBrowserTransport, noopTransport, type Transport } from "./transport";

/** `app`/`app_name` on every event — content_group is what varies with preview mode (below), not
 * this (plan atlas-2 `analytics/` contract: "content_group atlas / atlas-preview"). */
const APP_NAME = "atlas";

const DEFAULT_BATCH = 10; // .MS_LOG_BATCH, analytics.R:47
const DEFAULT_INTERVAL_MS = 15000; // .MS_LOG_INTERVAL_MS, analytics.R:48

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type GtagFn = (...args: unknown[]) => void;

export interface AnalyticsOptions {
  /** the deployed build's git short SHA (ms_track's `app_version`). */
  appVersion: string;
  /** true on the preview host -> `content_group = "atlas-preview"`; false -> `"atlas"`. */
  preview: boolean;
  /** the GA4 measurement id (`VITE_GA_ID`, see `gaId.ts`); unset/empty -> the GA4 leg is OFF: no
   * `gtag` call is ever made. No id ships in this repo. The Sheet-log leg is independent of it. */
  measurementId?: string;
  /** `VITE_LOG_URL`; unset/empty -> the Sheet leg is a silent no-op (GA4 still receives events if
   * not a webdriver session). */
  logUrl?: string;
  /** injected so tests never touch the network; defaults to a guarded `sendBeacon`/`fetch`
   * implementation that is a true no-op under Node (no DOM). */
  transport?: Transport;
  /** injected for tests; defaults to reading the real `navigator.webdriver`, guarded for a Node
   * environment with no `navigator`. */
  isWebdriver?: () => boolean;
  now?: () => number;
  /** defaults to `window.localStorage`, guarded; pass `null` explicitly (or a fake) in a test. */
  clientStore?: KeyValueStore | null;
  /** defaults to `window.sessionStorage`, guarded. */
  sessionStore?: KeyValueStore | null;
  /** the INITIAL location only, read once at construction; defaults to a guarded reader (returns
   * empty strings under Node). Call the returned `Analytics`'s `updateLocation()` after every
   * `history.replaceState` to keep it current — this module never re-reads it on its own. */
  location?: () => LocationLike;
  /** injected GA4 sink; defaults to installing `window.dataLayer`/`window.gtag` the same way
   * `ga_js()`'s inline script does, guarded to a no-op under Node. */
  gtag?: GtagFn;
  batchSize?: number;
  flushIntervalMs?: number;
  /** wires `flush()` to `visibilitychange -> hidden` and `pagehide`; defaults to a guarded DOM
   * listener, no-op under Node. Returns a teardown function used by `destroy()`. */
  addVisibilityListener?: (flush: () => void) => (() => void) | void;
}

export interface Analytics {
  track<E extends EventName>(event: E, params: EventParamsMap[E]): void;
  /** call this right after `history.replaceState` changes the URL (the state layer's job — see
   * src/lib/state/ — never this module's: it holds only what it is explicitly given). Updates the
   * sanitized `page_location`/`page_title` fields attached to every subsequent gtag call and Sheet
   * row, and refreshes gtag's own persistent per-hit fields via `gtag("set", ...)` so nothing —
   * including a later automatic hit gtag.js might fire on its own — falls back to a stale or live
   * value. A no-op for a `navigator.webdriver` session, same as `track()`. */
  updateLocation(loc: LocationLike): void;
  /** R3-B15 (Opus eyes-on review, 2026-09-25): `preview` is only known once `resolveSession()`
   * (an async preview-host session check, none exists in OceanMetrics Atlas) settles — `createAnalytics()`'s own `opts.preview`
   * is necessarily a guess (`Shell.svelte`/`Report.svelte` both construct with `preview: false`,
   * before the session fetch has even started) that must be corrected once the real answer is in,
   * or `content_group` reads `"atlas"` on the review host for the rest of the session. Updates
   * `content_group`/`page_title` (`pageLocation.ts#buildPageTitle`) for every event from this call
   * on, and refreshes gtag's own persistent per-hit `content_group` the same way `updateLocation()`
   * refreshes `page_location`. A no-op for a `navigator.webdriver` session, same as `track()`. */
  updatePreview(preview: boolean): void;
  /** flushes the queued Sheet-log rows immediately (normally called on the batch/interval/visibility
   * triggers below); a no-op when the queue is empty or `logUrl` is unset. */
  flush(): void;
  /** tears down the interval timer and any DOM listeners — call this if an `Analytics` is ever
   * replaced within one page lifetime (tests always call it in `afterEach`). */
  destroy(): void;
}

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// `stored()` (analytics.R:348-354): read-or-create a persisted id, "na" on any storage failure
// (private mode, storage disabled) or when no store is available at all.
function stored(store: KeyValueStore | null, key: string): string {
  if (!store) return "na";
  try {
    let v = store.getItem(key);
    if (!v) {
      v = uid();
      store.setItem(key, v);
    }
    return v;
  } catch {
    return "na";
  }
}

// every default below is gated on `hasBrowserGlobals()` (env.ts), not a piecemeal `typeof navigator`/
// `typeof location` check — Node 24 (this repo's Vitest environment) ships real, working `navigator`
// and `fetch` globals of its own, so checking those alone would silently pick up Node's stand-ins
// under a unit test instead of resolving to "not in a browser".
function defaultIsWebdriver(): boolean {
  return hasBrowserGlobals() && typeof navigator !== "undefined" && navigator.webdriver === true;
}

function defaultLocation(): LocationLike {
  if (!hasBrowserGlobals() || typeof location === "undefined") {
    return { origin: "", pathname: "", search: "" };
  }
  return { origin: location.origin, pathname: location.pathname, search: location.search };
}

function defaultGtag(): GtagFn {
  if (!hasBrowserGlobals()) return () => {};
  const w = window as unknown as { dataLayer?: unknown[]; gtag?: GtagFn };
  w.dataLayer = w.dataLayer || [];
  const fn: GtagFn = (...args) => {
    w.dataLayer!.push(args);
  };
  w.gtag = w.gtag || fn;
  return w.gtag;
}

function defaultStore(pick: (w: Window) => Storage | undefined): KeyValueStore | null {
  if (!hasBrowserGlobals()) return null;
  try {
    const s = pick(window);
    return s ?? null;
  } catch {
    return null; // storage access can throw (private mode) before a single getItem is even tried
  }
}

function defaultVisibilityListener(flush: () => void): (() => void) | undefined {
  if (!hasBrowserGlobals()) return undefined;
  const onVisibility = () => {
    if (document.visibilityState === "hidden") flush();
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", flush);
  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", flush);
  };
}

function defaultReferrer(): string {
  return hasBrowserGlobals() ? document.referrer || "" : "";
}

function defaultUserAgent(): string {
  return hasBrowserGlobals() && typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
}

/** builds one `Analytics` instance. Nothing here is a module-level singleton — the caller (a later
 * phase's app entry) owns the instance and its lifetime. */
export function createAnalytics(opts: AnalyticsOptions): Analytics {
  const webdriver = (opts.isWebdriver ?? defaultIsWebdriver)();
  const measurementId = opts.measurementId ?? "";
  // R3-B15: mutable — `updatePreview()` below corrects both once the real, async session answer
  // is in (see that method's own doc on `Analytics`).
  let contentGroup = opts.preview ? "atlas-preview" : "atlas";
  const logUrl = opts.logUrl ?? "";
  const transport = opts.transport ?? (logUrl ? createBrowserTransport() : noopTransport());
  const now = opts.now ?? Date.now;
  // no measurement id -> the GA4 leg is a true no-op (and `window.gtag`/`dataLayer` are never installed)
  const gtag: GtagFn = measurementId ? (opts.gtag ?? defaultGtag()) : () => {};
  const batchSize = opts.batchSize ?? DEFAULT_BATCH;
  const flushIntervalMs = opts.flushIntervalMs ?? DEFAULT_INTERVAL_MS;

  const clientStore =
    "clientStore" in opts ? opts.clientStore! : defaultStore((w) => w.localStorage);
  const sessionStoreOpt =
    "sessionStore" in opts ? opts.sessionStore! : defaultStore((w) => w.sessionStorage);
  const clientId = stored(clientStore, "msens_client_id");
  const sessionId = stored(sessionStoreOpt, "msens_session_id");

  // FIX ROUND 1: the ONE place this module holds "where we are" — set once at construction from the
  // injected/guarded initial reader, updated ONLY through updateLocation() thereafter. Every gtag
  // call and every Sheet row reads the SANITIZED strings derived from this, never the live location
  // itself (see the module header and pageLocation.ts).
  let currentLocation: LocationLike = (opts.location ?? defaultLocation)();
  // R3-B15: mutable — see `contentGroup` above; `updatePreview()` keeps the two in lockstep
  // (`buildPageTitle()` is a pure function of `preview` alone, same as the constructor's own call).
  let pageTitle = buildPageTitle(opts.preview);
  function pageLocationStr(): string {
    return buildPageLocation(currentLocation);
  }

  let queue: Record<string, unknown>[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;
  let removeVisibility: (() => void) | undefined;

  function flush(): void {
    if (!logUrl || queue.length === 0) return;
    const rows = queue;
    queue = [];
    try {
      transport.send(logUrl, JSON.stringify({ rows }));
    } catch {
      /* logging must never surface to the user */
    }
  }

  // webdriver sessions get NEITHER leg: no GA4 config call, no interval, no listeners, and
  // track() below becomes a full no-op for them too (the seeded fault this guards against:
  // "navigator.webdriver sessions logged").
  if (!webdriver) {
    timer = setInterval(flush, flushIntervalMs);
    removeVisibility =
      (opts.addVisibilityListener ?? defaultVisibilityListener)(flush) ?? undefined;
    try {
      gtag("js", new Date(now()));
      // FIX ROUND 1 (privacy leak): `send_page_view: false` stops gtag.js firing its OWN automatic
      // page_view here — that automatic hit fills in its `page_location` from the live page location
      // internally, fragment and all, and no per-call override on THIS config call can be trusted to
      // reliably suppress that for every gtag.js version. We fire our own page_view immediately below
      // instead, with explicit, sanitized fields. `page_location`/`page_title` are ALSO passed here
      // (not just on the page_view) because gtag.js treats a config call's fields as the persistent
      // per-hit defaults for every later hit under this measurement id — setting them here is the
      // first line of defense; every individual event call below repeats them as a second line, so
      // nothing ever depends on that persistent-field behavior alone.
      gtag("config", measurementId, {
        content_group: contentGroup,
        app_name: APP_NAME,
        app_version: opts.appVersion,
        page_location: pageLocationStr(),
        page_title: pageTitle,
        send_page_view: false,
      });
      gtag("event", "page_view", {
        content_group: contentGroup,
        app_name: APP_NAME,
        app_version: opts.appVersion,
        page_location: pageLocationStr(),
        page_title: pageTitle,
      });
    } catch {
      /* GA must never break the app */
    }
  }

  function updateLocation(loc: LocationLike): void {
    currentLocation = loc;
    if (webdriver) return;
    try {
      // refreshes gtag.js's own persistent per-hit fields too (defense in depth beyond the explicit
      // per-event fields below — see docs/analytics.md for the one thing this still cannot force:
      // GA4's Enhanced Measurement history-based page view setting, which must be OFF).
      gtag("set", { page_location: pageLocationStr(), page_title: pageTitle });
    } catch {
      /* GA must never break the app */
    }
  }

  // R3-B15: see `Analytics.updatePreview`'s own doc.
  function updatePreview(preview: boolean): void {
    contentGroup = preview ? "atlas-preview" : "atlas";
    pageTitle = buildPageTitle(preview);
    if (webdriver) return;
    try {
      gtag("set", { content_group: contentGroup, page_title: pageTitle });
    } catch {
      /* GA must never break the app */
    }
  }

  function track<E extends EventName>(event: E, params: EventParamsMap[E]): void {
    if (webdriver) return;
    if (!EVENT_NAMES.includes(event)) return; // defensive: an unknown name from untyped call sites

    const clean = sanitizeParams(params as Record<string, unknown>);
    const payload = msEvent(event, clean);

    try {
      const gaParams: Record<string, unknown> = {
        content_group: contentGroup,
        app_name: APP_NAME,
        app_version: opts.appVersion,
        // FIX ROUND 1: explicit on EVERY event, never left for gtag.js to fill in on its own.
        page_location: pageLocationStr(),
        page_title: pageTitle,
      };
      for (const [k, v] of Object.entries(payload.params)) {
        gaParams[k] = v.length > GA_MAX_PARAM_CHARS ? v.slice(0, GA_MAX_PARAM_CHARS) : v;
      }
      gtag("event", payload.event, gaParams);
    } catch {
      /* GA must never break the app */
    }

    if (!logUrl) return;
    queue.push({
      timestamp: new Date(now()).toISOString(),
      ip: "", // no server leg in a static app; kept for LOG_HEADER column parity
      session: "",
      event: payload.event,
      params: JSON.stringify(payload.params),
      n_rows: payload.metrics.n_rows ?? "",
      ms: payload.metrics.ms ?? "",
      status: payload.metrics.status ?? "",
      error: payload.metrics.error ?? "",
      app_version: opts.appVersion,
      app: APP_NAME,
      client_id: clientId,
      session_id: sessionId,
      page: buildPagePath(currentLocation),
      referrer: defaultReferrer(),
      user_agent: defaultUserAgent(),
    });
    if (queue.length >= batchSize) flush();
  }

  function destroy(): void {
    if (timer) clearInterval(timer);
    removeVisibility?.();
  }

  return { track, updateLocation, updatePreview, flush, destroy };
}
