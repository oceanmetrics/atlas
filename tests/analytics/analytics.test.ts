import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAnalytics as createAnalyticsRaw,
  type Analytics,
  type AnalyticsOptions,
  type KeyValueStore,
} from "../../src/lib/analytics/analytics";
import type { Transport } from "../../src/lib/analytics/transport";
import type { LocationLike } from "../../src/lib/analytics/pageLocation";

// GA is OFF unless a measurement id is configured (`VITE_GA_ID`); these tests exercise the GA leg, so
// they configure a made-up one. The "no id -> no GA leg" rule has its own describe block below.
const GA_TEST_ID = "G-TEST000000";
function createAnalytics(opts: AnalyticsOptions): Analytics {
  return createAnalyticsRaw({ measurementId: GA_TEST_ID, ...opts });
}

function fakeTransport() {
  const sent: { url: string; body: string }[] = [];
  const transport: Transport = { send: (url, body) => void sent.push({ url, body }) };
  return { transport, sent };
}

function fakeGtag() {
  const calls: unknown[][] = [];
  return { gtag: (...args: unknown[]) => void calls.push(args), calls };
}

function fakeStore(): KeyValueStore {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
  };
}

const LOC: LocationLike = {
  origin: "https://oceanmetrics.io",
  pathname: "/atlas/",
  search: "?proj=mercator",
};

let live: Analytics[] = [];
function register(a: Analytics): Analytics {
  live.push(a);
  return a;
}

afterEach(() => {
  for (const a of live) a.destroy();
  live = [];
  vi.useRealTimers();
});

describe("createAnalytics — no network call ever, in any test here (transport is always injected)", () => {
  it("sends nothing through the injected transport for a plain open_about event without a logUrl", () => {
    const { transport, sent } = fakeTransport();
    const { gtag } = fakeGtag();
    const a = register(
      createAnalytics({
        appVersion: "abc123",
        preview: false,
        transport,
        gtag,
        isWebdriver: () => false,
        location: () => LOC,
        clientStore: fakeStore(),
        sessionStore: fakeStore(),
      }),
    );
    a.track("open_about", {});
    a.flush();
    expect(sent).toEqual([]); // seeded fault: the beacon firing when VITE_LOG_URL is unset
  });

  it("seeded fault: the beacon never fires when logUrl is unset, even past the batch size", () => {
    const { transport, sent } = fakeTransport();
    const a = register(
      createAnalytics({
        appVersion: "v1",
        preview: false,
        transport,
        gtag: fakeGtag().gtag,
        isWebdriver: () => false,
        location: () => LOC,
        clientStore: null,
        sessionStore: null,
        // logUrl intentionally omitted
      }),
    );
    for (let i = 0; i < 25; i++) a.track("zoom_to_layer", {});
    a.flush();
    expect(sent).toEqual([]);
  });

  it("queues and flushes a Sheet-log row once logUrl is set, batched at 10 events", () => {
    const { transport, sent } = fakeTransport();
    const a = register(
      createAnalytics({
        appVersion: "v1",
        preview: false,
        logUrl: "https://log.example.test/exec",
        transport,
        gtag: fakeGtag().gtag,
        isWebdriver: () => false,
        location: () => LOC,
        clientStore: null,
        sessionStore: null,
        now: () => 0,
      }),
    );
    for (let i = 0; i < 9; i++) a.track("zoom_to_layer", {});
    expect(sent).toEqual([]); // under the batch size, no flush yet
    a.track("zoom_to_layer", {}); // 10th event triggers an automatic flush
    expect(sent).toHaveLength(1);
    const rows = JSON.parse(sent[0].body).rows;
    expect(rows).toHaveLength(10);
    expect(rows[0].event).toBe("zoom_to_layer");
  });

  it("flushes on the 15s interval even under the batch size (fake timers)", () => {
    vi.useFakeTimers();
    const { transport, sent } = fakeTransport();
    const a = register(
      createAnalytics({
        appVersion: "v1",
        preview: false,
        logUrl: "https://log.example.test/exec",
        transport,
        gtag: fakeGtag().gtag,
        isWebdriver: () => false,
        location: () => LOC,
        clientStore: null,
        sessionStore: null,
      }),
    );
    a.track("open_about", {});
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(15000);
    expect(sent).toHaveLength(1);
  });
});

describe("createAnalytics — navigator.webdriver exclusion (seeded fault)", () => {
  it("seeded fault: a webdriver session logs NOTHING to either leg, not even the GA4 config call", () => {
    const { transport, sent } = fakeTransport();
    const { gtag, calls } = fakeGtag();
    const a = register(
      createAnalytics({
        appVersion: "v1",
        preview: false,
        logUrl: "https://log.example.test/exec",
        transport,
        gtag,
        isWebdriver: () => true, // Playwright/CI
        location: () => LOC,
        clientStore: null,
        sessionStore: null,
      }),
    );
    a.track("select_species", {
      mdl_key: "ms_merge|WORMS:137209",
      scientific_name: "Dermochelys coriacea",
    });
    a.flush();
    expect(calls).toEqual([]); // no gtag("js", ...) / gtag("config", ...) / gtag("event", ...) at all
    expect(sent).toEqual([]);
  });

  it("a non-webdriver session DOES call gtag('config', ...) with atlas's content_group", () => {
    const { gtag, calls } = fakeGtag();
    register(
      createAnalytics({
        appVersion: "deadbee",
        preview: false,
        transport: fakeTransport().transport,
        gtag,
        isWebdriver: () => false,
        location: () => LOC,
        clientStore: null,
        sessionStore: null,
      }),
    );
    const configCall = calls.find((c) => c[0] === "config");
    expect(configCall).toBeDefined();
    expect(configCall?.[1]).toBe(GA_TEST_ID);
    expect(configCall?.[2]).toMatchObject({
      content_group: "atlas",
      app_name: "atlas",
      app_version: "deadbee",
    });
  });

  it("preview: true flips content_group to 'atlas-preview'", () => {
    const { gtag, calls } = fakeGtag();
    register(
      createAnalytics({
        appVersion: "v1",
        preview: true,
        transport: fakeTransport().transport,
        gtag,
        isWebdriver: () => false,
        location: () => LOC,
        clientStore: null,
        sessionStore: null,
      }),
    );
    const configCall = calls.find((c) => c[0] === "config");
    expect(configCall?.[2]).toMatchObject({ content_group: "atlas-preview" });
  });
});

describe("createAnalytics — pl/t never reach a payload via track() (end to end, seeded fault)", () => {
  it("strips a 'pl' param passed to an open place-event bag before it reaches GA4 or the beacon", () => {
    const { transport, sent } = fakeTransport();
    const { gtag, calls } = fakeGtag();
    const a = register(
      createAnalytics({
        appVersion: "v1",
        preview: false,
        logUrl: "https://log.example.test/exec",
        transport,
        gtag,
        isWebdriver: () => false,
        location: () => LOC,
        clientStore: null,
        sessionStore: null,
      }),
    );
    // "count" (not "n_places") deliberately: a substring check for the stripped key name below would
    // false-positive on a param name like "n_places", which itself contains the letters "pl".
    a.track("place_share", { pl: "z.pa.1,2,3", t: "My Sensitive Report", count: 1 });
    a.flush();

    const eventCall = calls.find((c) => c[0] === "event");
    expect(eventCall).toBeDefined();
    const gaParams = eventCall?.[2] as Record<string, unknown>;
    expect(gaParams).not.toHaveProperty("pl");
    expect(gaParams).not.toHaveProperty("t");
    expect(JSON.stringify(gaParams)).not.toContain('"pl"');
    expect(JSON.stringify(gaParams)).not.toContain("z.pa.1");
    expect(JSON.stringify(gaParams)).not.toContain("My Sensitive Report");

    expect(sent).toHaveLength(1);
    const row = JSON.parse(sent[0].body).rows[0];
    expect(row.params).not.toContain('"pl"');
    expect(row.params).not.toContain("z.pa.1");
    expect(row.params).not.toContain("My Sensitive Report");
  });
});

describe("createAnalytics — the queued row's page never carries the hash", () => {
  it("uses buildPagePath(location) for the Sheet log's page column", () => {
    const { transport, sent } = fakeTransport();
    const a = register(
      createAnalytics({
        appVersion: "v1",
        preview: false,
        logUrl: "https://log.example.test/exec",
        transport,
        gtag: fakeGtag().gtag,
        isWebdriver: () => false,
        location: () => ({ ...LOC, search: "?proj=mercator&secret=xyz" }),
        clientStore: null,
        sessionStore: null,
      }),
    );
    a.track("open_about", {});
    a.flush();
    const row = JSON.parse(sent[0].body).rows[0];
    expect(row.page).toBe("/atlas/?proj=mercator");
    expect(row.page).not.toContain("secret");
  });
});

// Fix round 1: gtag.js's OWN automatic page_view (fired by a bare `gtag("config", ...)`) reads the
// live page location internally — fragment and all — unless the config call explicitly disables it
// and every hit carries its own explicit page_location. These four tests are the coordinator's named
// seeded faults; each is written so reverting the corresponding line in analytics.ts turns it red
// (verified by hand: commenting out `send_page_view: false` fails test 2, deleting the
// `page_location`/`page_title` fields from the config call fails test 1, deleting them from track()'s
// gaParams fails test 3, and making page_title read a real `document.title` fails test 4).
describe("createAnalytics — privacy fix round 1: no hit ever falls back to gtag.js's own defaults", () => {
  it("seeded fault: the config call carries an explicit, non-empty page_location", () => {
    const { gtag, calls } = fakeGtag();
    register(
      createAnalytics({
        appVersion: "v1",
        preview: false,
        transport: fakeTransport().transport,
        gtag,
        isWebdriver: () => false,
        location: () => LOC,
        clientStore: null,
        sessionStore: null,
      }),
    );
    const configCall = calls.find((c) => c[0] === "config");
    const configParams = configCall?.[2] as Record<string, unknown>;
    expect(configParams.page_location).toBe("https://oceanmetrics.io/atlas/?proj=mercator");
    expect(configParams.page_location).toBeTruthy();
  });

  it("seeded fault: the config call sets send_page_view: false (suppresses gtag.js's own automatic hit)", () => {
    const { gtag, calls } = fakeGtag();
    register(
      createAnalytics({
        appVersion: "v1",
        preview: false,
        transport: fakeTransport().transport,
        gtag,
        isWebdriver: () => false,
        location: () => LOC,
        clientStore: null,
        sessionStore: null,
      }),
    );
    const configCall = calls.find((c) => c[0] === "config");
    expect((configCall?.[2] as Record<string, unknown>).send_page_view).toBe(false);
  });

  it("fires our OWN page_view event (replacing the suppressed automatic one) with an explicit page_location", () => {
    const { gtag, calls } = fakeGtag();
    register(
      createAnalytics({
        appVersion: "v1",
        preview: false,
        transport: fakeTransport().transport,
        gtag,
        isWebdriver: () => false,
        location: () => LOC,
        clientStore: null,
        sessionStore: null,
      }),
    );
    const pageViewCall = calls.find((c) => c[0] === "event" && c[1] === "page_view");
    expect(pageViewCall).toBeDefined();
    const params = pageViewCall?.[2] as Record<string, unknown>;
    expect(params.page_location).toBe("https://oceanmetrics.io/atlas/?proj=mercator");
  });

  it("seeded fault: EVERY track()-driven event carries an explicit page_location, never left implicit", () => {
    const { gtag, calls } = fakeGtag();
    const a = register(
      createAnalytics({
        appVersion: "v1",
        preview: false,
        transport: fakeTransport().transport,
        gtag,
        isWebdriver: () => false,
        location: () => LOC,
        clientStore: null,
        sessionStore: null,
      }),
    );
    a.track("open_about", {});
    const customEventCall = calls.find((c) => c[0] === "event" && c[1] === "open_about");
    expect(customEventCall).toBeDefined();
    const params = customEventCall?.[2] as Record<string, unknown>;
    expect(params.page_location).toBe("https://oceanmetrics.io/atlas/?proj=mercator");
    expect(params.page_title).toBeTruthy();
  });

  it("seeded fault: page_title is a fixed label, NEVER a live document title — even a hostile one", () => {
    // simulate a stray part of the app having stashed the report title (from #t=) onto the real
    // document.title global; page_title must be unaffected because this module never reads it.
    const fakeDocument = { title: "#t=secret-report-title" };
    (globalThis as unknown as { document: unknown }).document = fakeDocument;
    try {
      const { gtag, calls } = fakeGtag();
      const a = register(
        createAnalytics({
          appVersion: "v1",
          preview: false,
          transport: fakeTransport().transport,
          gtag,
          isWebdriver: () => false,
          location: () => LOC,
          clientStore: null,
          sessionStore: null,
        }),
      );
      a.track("open_about", {});
      for (const call of calls) {
        const params = call[call.length - 1];
        if (params && typeof params === "object") {
          expect(JSON.stringify(params)).not.toContain("secret-report-title");
        }
      }
    } finally {
      delete (globalThis as unknown as { document?: unknown }).document;
    }
  });

  it("updateLocation() refreshes page_location on every later gtag call and Sheet row, without ever reading a live location itself", () => {
    const { transport, sent } = fakeTransport();
    const { gtag, calls } = fakeGtag();
    const a = register(
      createAnalytics({
        appVersion: "v1",
        preview: false,
        logUrl: "https://log.example.test/exec",
        transport,
        gtag,
        isWebdriver: () => false,
        location: () => LOC,
        clientStore: null,
        sessionStore: null,
      }),
    );
    a.updateLocation({
      origin: "https://oceanmetrics.io",
      pathname: "/atlas/",
      search: "?lens=species&proj=mercator",
    });

    const setCall = calls.find((c) => c[0] === "set");
    expect((setCall?.[1] as Record<string, unknown>).page_location).toBe(
      "https://oceanmetrics.io/atlas/?lens=species&proj=mercator",
    );

    a.track("open_about", {});
    const eventCall = calls.find((c) => c[0] === "event" && c[1] === "open_about");
    expect((eventCall?.[2] as Record<string, unknown>).page_location).toBe(
      "https://oceanmetrics.io/atlas/?lens=species&proj=mercator",
    );

    a.flush();
    const row = JSON.parse(sent[0].body).rows[0];
    expect(row.page).toBe("/atlas/?lens=species&proj=mercator");
  });

  it("updateLocation() is a no-op leg-wise for a webdriver session (still tracks the new location, never calls gtag)", () => {
    const { gtag, calls } = fakeGtag();
    const a = register(
      createAnalytics({
        appVersion: "v1",
        preview: false,
        transport: fakeTransport().transport,
        gtag,
        isWebdriver: () => true,
        location: () => LOC,
        clientStore: null,
        sessionStore: null,
      }),
    );
    a.updateLocation({ origin: "https://x.test", pathname: "/atlas/", search: "?pal=magma" });
    expect(calls).toEqual([]);
  });
});

// R3-B15 (Opus eyes-on review, 2026-09-25): `Shell.svelte`/`Report.svelte` both construct with
// `preview: false` (the session fetch that would know better is still in flight) — `updatePreview()`
// is how the real, async answer corrects `content_group` once `resolveSession()` settles.
describe("createAnalytics — updatePreview() (R3-B15)", () => {
  it("flips content_group from 'atlas' to 'atlas-preview' on every later gtag call and Sheet row", () => {
    const { transport, sent } = fakeTransport();
    const { gtag, calls } = fakeGtag();
    const a = register(
      createAnalytics({
        appVersion: "v1",
        preview: false,
        logUrl: "https://log.example.test/exec",
        transport,
        gtag,
        isWebdriver: () => false,
        location: () => LOC,
        clientStore: null,
        sessionStore: null,
      }),
    );
    // the constructor's own config call, before updatePreview(), is still the public group.
    const configCall = calls.find((c) => c[0] === "config");
    expect(configCall?.[2]).toMatchObject({ content_group: "atlas" });

    a.updatePreview(true);
    const setCall = calls.find((c) => c[0] === "set");
    expect(setCall?.[1]).toMatchObject({ content_group: "atlas-preview" });

    a.track("open_about", {});
    const eventCall = calls.find((c) => c[0] === "event" && c[1] === "open_about");
    expect((eventCall?.[2] as Record<string, unknown>).content_group).toBe("atlas-preview");

    a.flush();
    // the Sheet leg carries no content_group column of its own (see LOG_HEADER), but proves the
    // call went through with the new state live rather than throwing.
    expect(sent).toHaveLength(1);
  });

  it("flips back to 'atlas' when called with false (a public session resolving after a false start)", () => {
    const { gtag, calls } = fakeGtag();
    const a = register(
      createAnalytics({
        appVersion: "v1",
        preview: true,
        transport: fakeTransport().transport,
        gtag,
        isWebdriver: () => false,
        location: () => LOC,
        clientStore: null,
        sessionStore: null,
      }),
    );
    a.updatePreview(false);
    const setCall = calls.find((c) => c[0] === "set");
    expect(setCall?.[1]).toMatchObject({ content_group: "atlas" });
  });

  it("is a no-op leg-wise for a webdriver session (never calls gtag)", () => {
    const { gtag, calls } = fakeGtag();
    const a = register(
      createAnalytics({
        appVersion: "v1",
        preview: false,
        transport: fakeTransport().transport,
        gtag,
        isWebdriver: () => true,
        location: () => LOC,
        clientStore: null,
        sessionStore: null,
      }),
    );
    a.updatePreview(true);
    expect(calls).toEqual([]);
  });
});

describe("createAnalytics — GA is OFF unless a measurement id is configured (no id ships in the repo)", () => {
  it("with no measurementId, no gtag call is ever made, for any method", () => {
    const { gtag, calls } = fakeGtag();
    const a = register(
      createAnalyticsRaw({
        appVersion: "v1",
        preview: false,
        gtag,
        transport: fakeTransport().transport,
        isWebdriver: () => false,
        location: () => LOC,
        clientStore: null,
        sessionStore: null,
      }),
    );
    a.track("open_about", {});
    a.updateLocation({ ...LOC, search: "?pal=magma" });
    a.updatePreview(true);
    expect(calls).toEqual([]); // seeded fault: a GA id baked back into the module
  });

  it("the Sheet-log leg still works without a GA id (it is keyed on logUrl alone)", () => {
    const { transport, sent } = fakeTransport();
    const a = register(
      createAnalyticsRaw({
        appVersion: "v1",
        preview: false,
        logUrl: "https://example.test/exec",
        transport,
        gtag: fakeGtag().gtag,
        isWebdriver: () => false,
        location: () => LOC,
        clientStore: null,
        sessionStore: null,
      }),
    );
    a.track("open_about", {});
    a.flush();
    expect(sent).toHaveLength(1);
  });
});
