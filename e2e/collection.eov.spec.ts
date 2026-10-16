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

async function boot(page: Page, pointRequests: string[], path = "/") {
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
  await page.goto(path);
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

// the fixture's tile 954 holds cells 9844265-9844267; (-86.73, 21.62) is cell 9844266 (six species)
async function clickCancun(page: Page) {
  await page.evaluate(() => {
    (
      window as unknown as {
        __atlasMap: { handle: { map: { fire(type: string, props: object): void } } };
      }
    ).__atlasMap.handle.map.fire("click", {
      lngLat: { lng: -86.73, lat: 21.62 },
      point: { x: 0, y: 0 },
    });
  });
  await page.locator("[data-atlas-open-details]").first().click();
}

test("a click lists the species of the cell, with an Atlas link that keeps the camera", async ({
  page,
}) => {
  const files: string[] = [];
  page.on("request", (r) => {
    if (/\.parquet(\?|$)/.test(r.url()) && r.method() === "GET") files.push(r.url());
  });
  await boot(page, []);
  await clickCancun(page);
  const panel = page.getByTestId("raster-cell-species");
  await expect(panel.getByTestId("raster-cell-species-count")).toHaveText(
    "6 species in this cell",
    { timeout: 15_000 },
  );
  const rows = panel.getByTestId("raster-cell-species-row");
  await expect(rows).toHaveCount(6);
  // suitability high to low
  await expect(rows.first()).toContainText("Thunnus albacares");
  await expect(rows.first()).toContainText("Yellowfin tuna");
  await expect(rows.first()).toContainText("95%");
  await expect(rows.last()).toContainText("Chelonia mydas");
  // the Atlas link: this app, the taxon on the 0.05 degree surface, the current camera
  const atlas = rows.first().getByRole("link", { name: "Atlas" });
  const href = (await atlas.getAttribute("href")) ?? "";
  expect(href.startsWith("?")).toBe(true);
  const q = new URLSearchParams(href);
  expect([q.get("c"), q.get("sp"), q.get("rep")]).toEqual(["aquamaps_native", "Fis-24082", "005"]);
  expect(q.get("map")).toMatch(/^-?[\d.]+,-?[\d.]+,[\d.]+/);
  const worms = rows.first().getByRole("link", { name: "WoRMS" });
  await expect(worms).toHaveAttribute("target", "_blank");
  await expect(worms).toHaveAttribute("href", /marinespecies\.org.*id=100001/);
  // one tile and the lookup, each read once
  expect(files.filter((u) => u.includes("/cell_species/tile=954/"))).not.toHaveLength(0);
  expect(files.filter((u) => u.endsWith("/species.parquet"))).toHaveLength(1);
  // the filter narrows the list
  await panel.getByTestId("raster-cell-species-filter").fill("coral");
  await expect(rows).toHaveCount(2);
});

test("an EOV item lists that EOV first, with a toggle for all of them", async ({ page }) => {
  await boot(page, [], "/?i=hardCorals_risk");
  await clickCancun(page);
  const panel = page.getByTestId("raster-cell-species");
  const rows = panel.getByTestId("raster-cell-species-row");
  await expect(rows).toHaveCount(2, { timeout: 15_000 });
  await expect(panel.getByTestId("raster-cell-species-count")).toHaveText("6 species in this cell");
  await panel.getByRole("button", { name: "Show all groups" }).click();
  await expect(rows).toHaveCount(6);
});

test("the zoom toggle is the auto-zoom preference, and an Atlas link leaves a way back", async ({
  page,
}) => {
  await boot(page, []);
  await clickCancun(page);
  const panel = page.getByTestId("raster-cell-species");
  const rows = panel.getByTestId("raster-cell-species-row");
  await expect(rows.first()).toBeVisible({ timeout: 15_000 });
  // one preference: on by default, off is the browser's stored choice (the Layers panel's switch reads the same)
  const toggle = panel.getByTestId("cell-species-autozoom");
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  expect(await page.evaluate(() => localStorage.getItem("atlas.autozoom"))).toBe("off");
  await expect(page.getByTestId("collection-back")).toHaveCount(0);
  // following the link keeps the clicked point's panel and offers the way back to the layer we left
  await rows.first().getByRole("link", { name: "Atlas" }).click();
  expect(new URL(page.url()).searchParams.get("c")).toBe("aquamaps_native");
  const back = page.getByTestId("collection-back");
  await expect(back).toHaveText(/Back to .*Risk-weighted share/);
  await expect(panel).toBeVisible();
  await back.click();
  await expect(back).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("c")).not.toBe("aquamaps_native");
  expect(new URL(page.url()).searchParams.get("sp")).toBeNull();
  await expect(panel.getByTestId("raster-cell-species-count")).toHaveText("6 species in this cell");
  await expect(toggle).not.toBeChecked();
});
