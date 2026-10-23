import { expect, test, type Page } from "@playwright/test";

// the oceanmetrics instance's analytics, in a real browser on its real build: GA4 is the bar's (`<om-nav data-ga>`),
// never this repo's module as well (one config, one page_view per location), and nothing of the URL's query or
// fragment (a place polygon `#pl=`, a report title `#t=`, a search) reaches a gtag() call or a request. gtag.js itself
// is never fetched: every request off the page's origin is aborted and recorded, so the spec is hermetic.
// docs/analytics.md covers what no code can enforce: the GA4 property's Enhanced Measurement history setting.

const FORBIDDEN = ["pl=", "g1.", "AAAA", "secret", "my+search"];
const DIRTY = "?c=obis_h3&q=my+search&map=-119.75,33.725,8.38#pl=g1.test.AAAA&t=secret";

function assertClean(label: string, text: string) {
  for (const token of FORBIDDEN)
    expect(text, `${label} must not contain "${token}"`).not.toContain(token);
}

async function open(page: Page, port: number) {
  const offsite: string[] = [];
  const origin = `http://localhost:${port}`;
  // a reader's browser, not an automated one: src/lib/analytics skips a `navigator.webdriver` session entirely, which
  // would hide a second GA4 leg (the module's own config) from this spec
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "webdriver", { get: () => false }),
  );
  await page.route("**/*", (route) => {
    const r = route.request();
    if (r.url().startsWith(origin)) return route.continue();
    offsite.push(`${r.url()} ${r.postData() ?? ""}`);
    return route.abort();
  });
  await page.goto(`${origin}/${DIRTY}`, { waitUntil: "domcontentloaded" });
  // the bar is a lazy chunk: wait for it to be defined, so `data-ga` has had its chance
  await page.waitForFunction(() => !!customElements.get("om-nav"), null, { timeout: 30_000 });
  await page.waitForTimeout(500);
  const calls = async () =>
    (await page.evaluate(() =>
      ((window as unknown as { dataLayer?: ArrayLike<unknown>[] }).dataLayer ?? []).map((a) =>
        Array.from(a),
      ),
    )) as unknown[][];
  const tags = () =>
    page.$$eval('script[src*="googletagmanager.com"]', (s) =>
      s.map((x) => (x as HTMLScriptElement).src),
    );
  return { offsite, calls, tags };
}

test("without VITE_GA_ID: the bar carries no data-ga, no gtag.js tag, no dataLayer, no GA request", async ({
  page,
}) => {
  const { offsite, tags } = await open(page, 4384);
  expect(await page.locator("om-nav").getAttribute("data-ga")).toBeNull();
  expect(await tags()).toEqual([]);
  expect(await page.evaluate(() => "dataLayer" in window)).toBe(false);
  expect(
    offsite.filter((u) => /google-analytics|googletagmanager|analytics\.google/.test(u)),
  ).toEqual([]);
});

test("with VITE_GA_ID=G-TEST000000: one tag, anonymized, one config, and no hit carries the query or fragment", async ({
  page,
}) => {
  const { offsite, calls, tags } = await open(page, 4385);
  expect(await page.locator("om-nav").getAttribute("data-ga")).toBe("G-TEST000000");
  expect(await tags()).toEqual(["https://www.googletagmanager.com/gtag/js?id=G-TEST000000"]);

  // the atlas's own URL-as-state writes, and a hand edit of the hash: none may leak
  await page.evaluate(() => {
    history.replaceState(
      null,
      "",
      `${location.pathname}?c=obis_h3&t=secret#pl=g1.test.BAAAA&t=secret`,
    );
    history.pushState(null, "", `${location.pathname}?q=my+search#pl=g1.test.CAAAA`);
    location.hash = "#pl=g1.test.DAAAA&t=secret";
  });
  await page.waitForTimeout(300);

  const all = await calls();
  const configs = all.filter((c) => c[0] === "config");
  expect(configs.length, "one gtag config: the bar's, never the module's as well").toBe(1);
  expect(configs[0][1]).toBe("G-TEST000000");
  expect(configs[0][2]).toMatchObject({
    anonymize_ip: true,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    send_page_view: false,
  });
  const views = all.filter((c) => c[0] === "event" && c[1] === "page_view");
  expect(
    views.length,
    "one page_view on load (the history moves keep the same rebuilt location)",
  ).toBe(1);
  for (const v of views) {
    const loc = String((v[2] as { page_location: string }).page_location);
    expect(loc).toBe("http://localhost:4385/");
  }
  assertClean("every gtag() call", JSON.stringify(all));
  assertClean("every request off the origin", offsite.join("\n"));
});
