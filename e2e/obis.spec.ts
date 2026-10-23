// The OBIS layer in the built app (build week 4, step 5, second pass; obis-hex's parity rows 32, 41, 56, 76, 92, 95,
// 97, 98, 119). HERMETIC: the catalog links the obis-h3 collection, served with every release file from the trimmed
// fixture release `tests/fixtures/obis_h3/` (Range answered as S3 does); the basemap, glyphs and gazetteer are the
// shared fixtures. Chromium only (WebGL). Run: `npx playwright test --project=chromium e2e/obis.spec.ts`.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";
import { ATLAS_BASE, GAZETTEER_BASE, routeBucket, waitForHydration } from "./hermetic";
import { fulfillRanged } from "./map-hermetic";
import { safeRoute } from "./routeSafety";

test.skip(({ browserName }) => browserName !== "chromium", "WebGL: chromium only");
test.use({ viewport: { width: 1280, height: 900 } });

const OBIS = "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/obis-h3/";
const REL = `${OBIS}v20261012/`;
const FIX = fileURLToPath(new URL("../tests/fixtures/obis_h3/", import.meta.url));
const STAGING = "https://staging.example.org/atlas/";

/** a release file of the fixture tree, or 404 (a file the trimmed release does not carry is no cells) */
function serveRelease(route: Route, rel: string, rewrite?: (json: string) => string) {
  const path = `${FIX}${decodeURIComponent(rel.split("?")[0])}`;
  if (!existsSync(path)) return route.fulfill({ status: 404, body: "" });
  if (path.endsWith(".json")) {
    const text = readFileSync(path, "utf8");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: rewrite ? rewrite(text) : text,
    });
  }
  return fulfillRanged(route, readFileSync(path));
}

const catalogLinking = (href: string) => ({
  type: "Catalog",
  id: "atlas",
  stac_version: "1.1.0",
  description: "fixture",
  links: [{ rel: "child", href, type: "application/json", "atlas:group": "obis" }],
});

async function boot(
  page: Page,
  path: string,
  requests: string[] = [],
  setup?: (page: Page) => Promise<void>,
) {
  await routeBucket(page);
  // later routes win: the catalog links only the OBIS collection, the release is the fixture tree
  await page.route(
    `${ATLAS_BASE}catalog.json`,
    safeRoute((route) =>
      route.fulfill({ status: 200, json: catalogLinking(`${OBIS}collection.json`) }),
    ),
  );
  await page.route(
    (url) => url.href.startsWith(OBIS),
    safeRoute((route) => {
      const href = route.request().url();
      requests.push(href);
      if (href.startsWith(`${OBIS}collection.json`)) return serveRelease(route, "collection.json");
      if (href.startsWith(REL)) return serveRelease(route, href.slice(REL.length));
      return route.fulfill({ status: 404, body: "" });
    }),
  );
  await setup?.(page);
  await page.goto(path);
  await waitForHydration(page);
  await page.waitForFunction(
    () => !!(window as unknown as { __atlasMap?: unknown }).__atlasMap,
    null,
    {
      timeout: 15_000,
    },
  );
  await expect(page.getByTestId("h3-controls")).toBeVisible({ timeout: 30_000 });
}

const Q = "/?c=obis_h3&i=all&dim.indicator=es&res=2&map=-120,30,2.5&tour=off";

test("the layer's words: the sentence chips, the EOV list, the footer with the release", async ({
  page,
}) => {
  await boot(page, Q);
  await expect(page.getByTestId("h3-sentence")).toHaveText(
    "All taxa, all years, worldwide, ~86,800 km² hexagons: ES(50)",
  );
  await expect(page.getByTestId("h3-footer")).toContainText(
    "OBIS 2026-10-11 · WoRMS 2026-10-01 · release v20261012 · res 2 (fixed)",
  );
  await expect(page.getByTestId("h3-layer-row").nth(1)).toContainText("Fish");
  await expect(page.getByTestId("h3-layer-row").nth(1)).toContainText("64M");
  await expect(page.getByRole("link", { name: "What defines each EOV? ↗" })).toHaveAttribute(
    "href",
    "https://github.com/ioos/marine_life_data_network/tree/main/eov_taxonomy",
  );
  // the chip opens its field
  await page.locator('[data-chip="indicator"]').click();
  await expect(
    page
      .locator('[data-control-field="indicator"] select, [data-control-field="indicator"] button')
      .first(),
  ).toBeFocused();
});

test("empty cell pane", async ({ page }) => {
  await boot(page, Q);
  await page.locator('[data-control="rail-details"]').click();
  await expect(page.getByTestId("h3-cell-empty")).toHaveText(
    "Click a hexagon on the map to see all five indicators and the species recorded in it.",
  );
});

test("strip fold: the period bars fold, and stay folded on the next page", async ({ page }) => {
  await boot(page, Q);
  const fold = page.getByTestId("h3-strip-fold");
  await expect(page.getByTestId("h3-strip")).toBeVisible();
  await fold.click();
  await expect(page.getByTestId("h3-strip")).toBeHidden();
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await page.reload();
  await expect(page.getByTestId("h3-strip-fold")).toHaveText("Show the bars", { timeout: 30_000 });
  await expect(page.getByTestId("h3-strip")).toBeHidden();
  // the strip resizes between 48 and 240 px
  await page.getByTestId("h3-strip-fold").click();
  const css = await page.getByTestId("h3-strip").evaluate((el) => {
    const s = getComputedStyle(el);
    return [s.resize, s.minHeight, s.maxHeight];
  });
  expect(css).toEqual(["vertical", "48px", "240px"]);
});

test("pan back, no new request: the release's file and row groups are read once", async ({
  page,
}) => {
  const requests: string[] = [];
  await boot(page, Q, requests);
  const data = () => requests.filter((u) => u.includes("/all/res="));
  await expect.poll(() => data().length, { timeout: 30_000 }).toBeGreaterThan(0);
  // the first view's tiles are in (an idle that already fired is not waited for)
  await page.waitForFunction(
    () =>
      (
        window as never as { __atlasMap: { handle: { map: { areTilesLoaded: () => boolean } } } }
      ).__atlasMap.handle.map.areTilesLoaded(),
    null,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(500);
  const before = data().length;
  const jump = (lng: number) =>
    page.evaluate(
      (lng) =>
        new Promise((r) => {
          const m = (
            window as never as {
              __atlasMap: {
                handle: {
                  map: { jumpTo: (o: object) => void; once: (e: string, f: () => void) => void };
                };
              };
            }
          ).__atlasMap.handle.map;
          m.once("idle", () => r(null));
          m.jumpTo({ center: [lng, 30], zoom: 2.5 });
        }),
      lng,
    );
  await jump(60);
  await jump(-120);
  expect(data().length).toBe(before);
});

test("help entries: the layer's sources, citation and keys; g toggles the globe", async ({
  page,
}) => {
  await boot(page, Q);
  await page.locator('[data-control="help"]').click();
  await expect(page.locator("#help-menu")).toContainText("g — globe or flat map (hexagon layers)");
  await page.getByTestId("help-h3-layer").click();
  await expect(page.getByTestId("h3-sources")).toHaveAttribute("open", "");
  await expect(page.getByTestId("h3-sources")).toContainText("WoRMS");
  await expect(page.getByTestId("h3-sources")).toContainText("doi:10.14284/170");
  const proj = () => new URL(page.url()).searchParams.get("proj");
  const was = proj();
  await page.locator("body").press("g");
  await expect.poll(proj).not.toBe(was);
});

test("about names the release", async ({ page }) => {
  await boot(page, Q);
  await page.locator('[data-control="about"], button[aria-label="About"]').first().click();
  await expect(page.getByTestId("about-layer")).toContainText(
    "Release v20261012, built 2026-10-12 from the OBIS snapshot of 2026-10-11, WoRMS 2026-10-01, obisindicators 0.11.0.",
  );
});

test("download png: the figure is named for the layer and the release", async ({ page }) => {
  await boot(page, Q);
  await page.locator('[data-control="download"]').first().click();
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    page.getByRole("menuitem", { name: /PNG/ }).click(),
  ]);
  expect(dl.suggestedFilename()).toMatch(
    /^[a-z-]+_collection_all-taxa-es-50_v20261012_\d{8}\.png$/,
  );
  const bytes = readFileSync((await dl.path())!);
  expect(bytes.subarray(1, 4).toString()).toBe("PNG");
});

test("catalog override: a staging catalog's release opens (a dry run), nothing read from the stable one", async ({
  page,
}) => {
  const requests: string[] = [];
  await routeBucket(page);
  await page.route(
    (url) => url.href.startsWith(STAGING),
    safeRoute((route) => {
      const href = route.request().url();
      requests.push(href);
      const rel = href.slice(STAGING.length);
      if (rel === "catalog.json")
        return route.fulfill({ status: 200, json: catalogLinking("obis-h3/collection.json") });
      const toStaging = (t: string) =>
        t
          .replaceAll(REL, `${STAGING}obis-h3/v20990101/`)
          .replaceAll(`${OBIS}collection.json`, `${STAGING}obis-h3/collection.json`)
          .replaceAll('"v20261012"', '"v20990101"');
      if (rel === "obis-h3/collection.json")
        return serveRelease(route, "collection.json", toStaging);
      if (rel.startsWith("obis-h3/v20990101/"))
        return serveRelease(route, rel.slice("obis-h3/v20990101/".length), toStaging);
      return route.fulfill({ status: 404, body: "" });
    }),
  );
  await page.route(
    (url) => url.href.startsWith(OBIS),
    safeRoute((route) => {
      requests.push(route.request().url());
      return route.fulfill({ status: 404, body: "" });
    }),
  );
  await page.goto(
    `/?catalog=${encodeURIComponent(STAGING)}&c=obis_h3&i=all&res=2&map=-120,30,2.5&tour=off`,
  );
  await waitForHydration(page);
  await expect(page.getByTestId("h3-footer")).toContainText("release v20990101", {
    timeout: 30_000,
  });
  expect(requests.some((u) => u.startsWith(OBIS))).toBe(false);
  expect(requests.some((u) => u.startsWith(`${STAGING}obis-h3/v20990101/all/res=2/`))).toBe(true);
});

test("a sea clears the place and flies", async ({ page }) => {
  await boot(page, `${Q}&filter=places#pl=p.NMS%253ACINMS.Channel%2520Islands`);
  await page.getByTestId("h3-place").locator("select").selectOption("gulf-maine");
  const centre = () =>
    page.evaluate(() => {
      const m = (
        window as never as {
          __atlasMap: {
            handle: {
              map: { getCenter: () => { lng: number; lat: number }; getZoom: () => number };
            };
          };
        }
      ).__atlasMap.handle.map;
      const c = m.getCenter();
      return [
        Math.round(c.lng * 10) / 10,
        Math.round(c.lat * 10) / 10,
        Math.round(m.getZoom() * 10) / 10,
      ];
    });
  await expect.poll(centre, { timeout: 15_000 }).toEqual([-68.5, 42.8, 6.2]);
  await expect.poll(() => new URL(page.url()).searchParams.get("map")).toBe("-68.5,42.8,6.2");
  expect(new URL(page.url()).hash).not.toContain("pl=");
  expect(new URL(page.url()).searchParams.get("filter")).toBeNull();
});

test("a whole collection as the filter: the select writes filter=coll:<slug>, the words say its title", async ({
  page,
}) => {
  // the gazetteer's `places` collection with its H3 membership (the fixture release's trimmed copy)
  await boot(page, Q, [], async (page) => {
    await page.route(
      `${GAZETTEER_BASE}index/layers.json`,
      safeRoute((route) =>
        route.fulfill({
          status: 200,
          json: {
            layers: [
              {
                slug: "places",
                collection: "places",
                title: "Ocean Metrics places",
                geom_type: "MultiPolygon",
                n: 18,
                h3: "https://storage.oceanmetrics.io/gazetteer/places/h3/membership.json",
              },
              { slug: "calcofi_lines", title: "CalCOFI lines", geom_type: "LineString", h3: null },
            ],
          },
        }),
      ),
    );
    await page.route(
      (url) => url.href.startsWith(`${GAZETTEER_BASE}places/h3/`),
      safeRoute((route) => {
        const rel = route
          .request()
          .url()
          .slice(GAZETTEER_BASE.length + "places/".length);
        // the fixture keeps the manifest beside `h3/`, as membership.json's own paths say
        const file = decodeURIComponent(rel.split("?")[0]);
        const path = `${FIX}membership/${file === "h3/membership.json" ? "membership.json" : file}`;
        return existsSync(path)
          ? path.endsWith(".json")
            ? route.fulfill({
                status: 200,
                contentType: "application/json",
                body: readFileSync(path),
              })
            : fulfillRanged(route, readFileSync(path))
          : route.fulfill({ status: 404, body: "" });
      }),
    );
  });
  const select = page.getByTestId("h3-place").getByLabel("Only inside a collection");
  // only the polygon collection with a build is offered
  await expect(select.locator("option")).toHaveText([
    "Only inside a collection…",
    "Ocean Metrics places",
  ]);
  await select.selectOption("places");
  await expect.poll(() => new URL(page.url()).searchParams.get("filter")).toBe("coll:places");
  await expect(page.getByTestId("h3-filter-note")).toContainText(
    /res-2 hexagons of Ocean Metrics places/,
    { timeout: 30_000 },
  );
  await expect(page.getByTestId("h3-sentence")).toContainText("in Ocean Metrics places");
  await expect(page.getByTestId("h3-coverage")).toContainText(/hexagons in Ocean Metrics places/, {
    timeout: 30_000,
  });
  // off again
  await select.selectOption("");
  await expect.poll(() => new URL(page.url()).searchParams.get("filter")).toBeNull();
});

test("a collection over the read cap says 'filter by one place instead' and reads none of its files", async ({
  page,
}) => {
  const gaz: string[] = [];
  await boot(page, `${Q}&filter=coll:big_efh`, [], async (page) => {
    await page.route(
      `${GAZETTEER_BASE}index/layers.json`,
      safeRoute((route) =>
        route.fulfill({
          status: 200,
          json: {
            layers: [
              {
                slug: "big_efh",
                collection: "big_efh",
                title: "Essential Fish Habitat",
                geom_type: "MultiPolygon",
                n: 782,
                h3: "https://storage.oceanmetrics.io/gazetteer/big_efh/h3/membership.json",
              },
            ],
          },
        }),
      ),
    );
    await page.route(
      (url) => url.href.startsWith(`${GAZETTEER_BASE}big_efh/h3/`),
      safeRoute((route) => {
        gaz.push(route.request().url());
        // NOAA EFH's res-2 size, scaled to the cap's edge: 500,001 rows
        return route.fulfill({
          status: 200,
          json: {
            min_share: 0.01,
            res: [2],
            parent_res: {},
            files: [
              {
                res: 2,
                parent: null,
                path: "h3/res=2/membership.parquet",
                rows: 500_001,
                bytes: 1,
              },
            ],
          },
        });
      }),
    );
  });
  await expect(page.getByTestId("h3-filter-note")).toContainText("filter by one place instead", {
    timeout: 30_000,
  });
  await expect(page.getByTestId("h3-filter-note")).toContainText("Essential Fish Habitat");
  expect(gaz).toEqual([
    "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/gazetteer/big_efh/h3/membership.json",
  ]);
});
