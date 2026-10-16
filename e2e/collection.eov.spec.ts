// The AquaMaps EOV share product is the catalog's FIRST collection (0.2.0): the bare URL opens it at
// `all` x `risk`, and a click on the map shows a flower whose petals are the EOV bands of that pixel, all read
// from ONE /cog/point answer. HERMETIC: the catalog is the fixture tree (`e2e/hermetic.ts`, served with the
// files' own world frame), every titiler route answers from here, nothing reaches the live network.
import { expect, test, type Page } from "@playwright/test";
import { routeAtlasData, routeBucket, waitForHydration } from "./hermetic";
import { blockWasm, routeBasemapStyle, routeGlyphs, routeTitilerTiles } from "./map-hermetic";
import { safeRoute } from "./routeSafety";

test.skip(({ browserName }) => browserName !== "chromium", "WebGL gate: chromium only (S2)");
test.use({ viewport: { width: 1280, height: 900 } });

// bands 1..9 = all, fish, hardCorals, mangroves, marineMammals, seabirds, seagrasses, seaTurtles, n_eov;
// `all` (50) is the mean of the five reportable EOVs, seabirds/seagrasses are masked (no AquaMaps taxa)
const BANDS = [50, 80, 60, 40, 20, null, null, 50, 5];
const TILER = "https://titiler-v8.marinesensitivity.org";

async function boot(page: Page, pointRequests: string[]) {
  await blockWasm(page);
  await routeBucket(page);
  await routeAtlasData(page, { frameEov: false });
  await routeBasemapStyle(page);
  await routeGlyphs(page);
  await routeTitilerTiles(page);
  // registered after the catch-all PNG route, so it wins for these paths
  await page.route(
    (url) => url.href.startsWith(TILER) && url.pathname.startsWith("/cog/point/"),
    safeRoute((route) => {
      pointRequests.push(route.request().url());
      return route.fulfill({
        status: 200,
        json: { values: BANDS, band_names: BANDS.map((_, i) => `b${i + 1}`) },
      });
    }),
  );
  await page.route(
    (url) => url.href.startsWith(TILER) && url.pathname === "/cog/statistics",
    safeRoute((route) =>
      route.fulfill({
        status: 200,
        json: {
          b1: { histogram: [Array(10).fill(1), Array.from({ length: 11 }, (_, i) => i * 10)] },
        },
      }),
    ),
  );
  await page.goto("/");
  await waitForHydration(page);
  await page.waitForFunction(() => !!(window as unknown as { __atlasMap?: unknown }).__atlasMap, {
    timeout: 15_000,
  });
}

test("the bare URL opens the AquaMaps EOV share at All EOVs x Risk-weighted share", async ({
  page,
}) => {
  await boot(page, []);
  const field = page.getByTestId("collection-field");
  await expect(field.locator("select").first()).toHaveValue("aquamaps_eov");
  // the layer is titled from the dimension labels, not from a per-item title
  await expect(page.getByTestId("collection-data-controls")).toContainText(
    "All EOVs (mean) · Risk-weighted share",
  );
  expect(new URL(page.url()).search).toBe("");
});

test("a click shows the flower: one /cog/point request, petals from bands, absent EOVs labelled", async ({
  page,
}) => {
  const points: string[] = [];
  await boot(page, points);
  await page.evaluate(() => {
    (
      window as unknown as {
        __atlasMap: { handle: { map: { fire(type: string, props: object): void } } };
      }
    ).__atlasMap.handle.map.fire("click", { lngLat: { lng: -70, lat: 40 }, point: { x: 0, y: 0 } });
  });
  await page.locator("[data-atlas-open-details]").first().click();
  const flower = page.getByTestId("collection-flower");
  await expect(flower).toBeVisible({ timeout: 15_000 });
  // five EOVs with a value draw a petal, the two absent ones leave their slot empty
  await expect(flower.locator("path.petal")).toHaveCount(5);
  // the centre is the composite band (`all`), the table names the empty slots
  await expect(flower.locator(".hub-text")).toHaveText("50");
  await expect(flower.getByRole("row", { name: /Seabirds/ })).toContainText("(not in AquaMaps)");
  await expect(flower.getByRole("row", { name: /Seagrasses/ })).toContainText("(not in AquaMaps)");
  await expect(flower.getByRole("row", { name: /Hard corals/ })).toContainText("60");
  // ONE read served the value line and all seven petals, and it asked for every band (no bidx)
  expect(points).toHaveLength(1);
  expect(points[0]).not.toContain("bidx");
});
