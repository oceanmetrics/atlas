// R3-W2: the Download menu, on the REAL shell (Collections lens), hermetic.
//
// The default view is the fixture catalog's hex collection (no COG, so "Data layer · GeoTIFF" is
// disabled with its reason). The GeoTIFF case opens a raster item of the NOAA NCCOS seabird density
// (`?c=msens-v8-nc&i=...`): its collection, titiler's `/cog/statistics` (the display range) and
// `/cog/info.geojson` (the COG's footprint) and the COG itself are routed to fixtures, so the item
// resolves through the SAME `collectionLens.mapInputs.cogUrl` the real app uses (Shell.svelte's
// `downloadCogUrl`), never a test-only shortcut.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { routeBucket, waitForHydration } from "./hermetic";
import { blockWasm, routeBasemapStyle, routeGlyphs, routeTitilerTiles } from "./map-hermetic";
import { safeRoute } from "./routeSafety";

const TILER = "https://titiler-v8.marinesensitivity.org";
const NC_COLLECTION = "https://file.marinesensitivity.org/stac/v8/nc/collection.json";
const NC_COG = "https://file.marinesensitivity.org/cog/sdm/raw/nc_atl_birds_dens/ARTE_summer.tif";
const NC_ITEM = "atlantic.ARTE.summer.n_per_km2";

test.use({ viewport: { width: 1280, height: 800 } });

async function gotoShell(page: Page, path = "/") {
  await blockWasm(page);
  await routeBucket(page);
  await routeBasemapStyle(page);
  await routeTitilerTiles(page);
  await routeGlyphs(page);
  await page.goto(path);
  await waitForHydration(page);
  // the shell has settled once its top bar is up
  await expect(page.locator(".topbar")).toBeVisible();
}

/** the NOAA NCCOS seabird density collection and everything its raster item reads, as fixtures. */
async function routeNcRaster(page: Page) {
  await page.route(
    NC_COLLECTION,
    safeRoute((route) =>
      route.fulfill({
        status: 200,
        json: {
          type: "Collection",
          id: "msens-v8-nc",
          title: "NOAA NCCOS (density)",
          description: "fixture",
          license: "proprietary",
          links: [],
        },
      }),
    ),
  );
  await page.route(
    `${TILER}/cog/statistics?*`,
    safeRoute((route) =>
      route.fulfill({
        status: 200,
        json: { b1: { min: 0.0004, max: 0.8, percentile_98: 0.008 } },
      }),
    ),
  );
  await page.route(
    `${TILER}/cog/info.geojson?*`,
    safeRoute((route) => route.fulfill({ status: 200, json: { bbox: [-87, 23, -52, 53] } })),
  );
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test.describe("R3-W2: Download menu", () => {
  test("opens by click, closes by Escape, and returns focus to the trigger", async ({ page }) => {
    await gotoShell(page);
    const trigger = page.locator('[data-control="download"]');
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    const menu = page.getByRole("menu", { name: "Download" });
    await expect(menu).toBeVisible();
    // opening the menu moves focus to its first item (Menu.svelte's own `openMenu()`).
    await expect(menu.getByRole("menuitem").first()).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(trigger).toBeFocused();
  });

  test("ArrowDown/ArrowUp move focus within the menu, wrapping at both ends", async ({ page }) => {
    await gotoShell(page);
    await page.locator('[data-control="download"]').click();
    const items = page.getByRole("menu", { name: "Download" }).getByRole("menuitem");
    // the menu's own chunk loads asynchronously (lazy) -- wait for the first item to actually be
    // focused (Menu.svelte's own `openMenu()` behaviour) before counting, rather than a synchronous
    // `.count()` right after the click, which can race the import.
    await expect(items.first()).toBeFocused();
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(3); // PNG, SVG, GeoTIFF at minimum

    await page.keyboard.press("ArrowDown");
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(items.first()).toBeFocused();
    // wrap backward past the first item to the last.
    await page.keyboard.press("ArrowUp");
    await expect(items.last()).toBeFocused();
  });

  test("outside click closes the menu", async ({ page }) => {
    await gotoShell(page);
    await page.locator('[data-control="download"]').click();
    const menu = page.getByRole("menu", { name: "Download" });
    await expect(menu).toBeVisible();
    await page.mouse.click(10, 10);
    await expect(menu).toBeHidden();
  });

  test("'Map view · PNG' downloads a real, non-trivial PNG", async ({ page }) => {
    await gotoShell(page);
    await page.locator('[data-control="download"]').click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("menuitem", { name: "Map view · PNG" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^oceanmetrics-atlas_collection_.*_\d{8}\.png$/);
    const path = await download.path();
    expect(path).toBeTruthy();
    const bytes = readFileSync(path!);
    // a real PNG signature and a non-trivial size (a 1x1 placeholder would be under 100 bytes;
    // the composited map+footer+legend is comfortably larger).
    expect(bytes.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    expect(bytes.length).toBeGreaterThan(2000);
  });

  test("'Map view · SVG' downloads a well-formed SVG with the footer and legend", async ({
    page,
  }) => {
    await gotoShell(page);
    await page.locator('[data-control="download"]').click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("menuitem", { name: "Map view · SVG" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^oceanmetrics-atlas_collection_.*_\d{8}\.svg$/);
    const path = await download.path();
    const svg = readFileSync(path!, "utf8");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("<image");
    expect(svg).toContain("OceanMetrics Atlas");
    expect(svg).toContain("linearGradient"); // the legend gradient (the collection publishes a ramp)
  });

  test("'Data layer · GeoTIFF' is disabled, with its reason, for a hex collection", async ({
    page,
  }) => {
    await gotoShell(page);
    await page.locator('[data-control="download"]').click();
    const item = page.getByRole("menuitem", { name: /Data layer · GeoTIFF/ });
    await expect(item).toBeDisabled();
    await expect(item).toContainText("no COG published for this layer");
  });

  test("'Data layer · GeoTIFF' fetches the routed COG fixture of a raster item and saves it", async ({
    page,
  }) => {
    await blockWasm(page);
    await routeBucket(page);
    await routeBasemapStyle(page);
    await routeTitilerTiles(page);
    await routeGlyphs(page);
    // registered AFTER the tile route: Playwright tries the newest matching route first
    await routeNcRaster(page);
    let cogRequested = false;
    await page.route(
      NC_COG,
      safeRoute((route) => {
        cogRequested = true;
        return route.fulfill({
          status: 200,
          contentType: "image/tiff",
          body: Buffer.from("FAKE-GEOTIFF-BYTES"),
        });
      }),
    );
    await page.goto(`/?c=msens-v8-nc&i=${NC_ITEM}`);
    await waitForHydration(page);

    // the raster draws (and `cogUrl` exists) once its display range has been read
    await expect(page.getByTestId("collection-legend")).toBeVisible();
    await page.locator('[data-control="download"]').click();
    const item = page.getByRole("menuitem", { name: /Data layer · GeoTIFF/ });
    await expect(item).toBeEnabled();
    const [download] = await Promise.all([page.waitForEvent("download"), item.click()]);
    expect(cogRequested).toBe(true);
    expect(download.suggestedFilename()).toMatch(/^oceanmetrics-atlas_collection_.*\.tif$/);
    const bytes = readFileSync((await download.path())!, "utf8");
    expect(bytes).toBe("FAKE-GEOTIFF-BYTES");
  });

  test("phone: the ⋯ menu's 'Download…' item opens the same item list in a Modal", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoShell(page);
    await page.locator('[data-control="more-menu"]').click();
    await page.getByRole("menuitem", { name: "Download…" }).click();
    const dialog = page.getByRole("dialog", { name: "Download" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Map view · PNG/ })).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Map view · SVG/ })).toBeVisible();
  });
});
