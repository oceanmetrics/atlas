// P2 / D5 (phone first view): at 390x844 the sheet and the floating legend chip cover the lower part
// of the map, so the FIRST view must frame the data inside the FREE area (below the top bar, above
// the sheet and the chip), not behind chrome and not as empty sky.
//
// The OceanMetrics Atlas first view is the Collections lens' own: it fits the collection's
// `extent.spatial.bbox` with the live chrome padding (`lens/collection/state.svelte.ts`,
// `lib/map/chromePadding.ts#phoneLiveChromePadding`). The inherited MarineSensitivity-era checks of
// the hard-coded US `PHONE_DEFAULT_BOUNDS` and its "sky band" probe described a camera this shell no
// longer shows on first load, so they are replaced by the same two questions asked of the extent:
// does it sit inside the free area, and does its south edge clear the legend chip.
import { expect, test, type Page } from "@playwright/test";
import { BIOTRACK_BBOX, routeBucket, waitForHydration } from "./hermetic";
import { routeBasemapStyle, routeGlyphs } from "./map-hermetic";

type Px = { x: number; y: number };

/** `detent`, when given, is written to the sheet's own persisted localStorage key BEFORE the page's
 * own script runs, so the sheet boots at that detent exactly as for a visitor who left it there. */
async function gotoPhone(page: Page, path = "/", detent?: "peek" | "half" | "full") {
  if (detent) {
    await page.addInitScript((d) => window.localStorage.setItem("atlas.sheet.shell", d), detent);
  }
  await routeBucket(page);
  await routeBasemapStyle(page);
  await routeGlyphs(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(path);
  await waitForHydration(page);
  await page.waitForFunction(() => !!(window as unknown as { __atlasMap?: unknown }).__atlasMap, {
    timeout: 15_000,
  });
}

const project = (page: Page, ll: [number, number]) =>
  page.evaluate((point) => {
    const w = window as unknown as {
      __atlasMap: { handle: { map: { project(ll: [number, number]): Px } } };
    };
    const p = w.__atlasMap.handle.map.project(point);
    return { x: p.x, y: p.y };
  }, ll);

const [WEST, SOUTH, EAST, NORTH] = BIOTRACK_BBOX;

test.describe("P2: the phone first view frames the collection's extent in the free area", () => {
  for (const detent of ["half", "peek"] as const) {
    test(`the extent's centre projects inside the free area at the ${detent} detent`, async ({
      page,
    }) => {
      await gotoPhone(page, "/", detent);
      const topbar = (await page.locator(".topbar").boundingBox())!;
      const sheet = (await page.locator(".sheet").first().boundingBox())!;
      const freeTop = topbar.y + topbar.height;
      const freeHeight = sheet.y - freeTop;
      // the fit is a fly-to once the collection has loaded: poll until the centre has landed
      await expect
        .poll(
          async () => {
            const pt = await project(page, [(WEST + EAST) / 2, (SOUTH + NORTH) / 2]);
            return (pt.y - freeTop) / freeHeight;
          },
          { message: "the extent's centre never settled inside the free area" },
        )
        .toBeGreaterThan(0.15);
      const pt = await project(page, [(WEST + EAST) / 2, (SOUTH + NORTH) / 2]);
      expect((pt.y - freeTop) / freeHeight).toBeLessThan(0.85);
      expect(pt.x).toBeGreaterThan(0);
      expect(pt.x).toBeLessThan(390);
    });
  }

  test("the extent's north and south edges sit between the top bar and the sheet (and the legend chip)", async ({
    page,
  }) => {
    await gotoPhone(page);
    const lon = (WEST + EAST) / 2;
    await expect
      .poll(async () => (await project(page, [lon, SOUTH])).y, {
        message: "the fit never landed",
      })
      .toBeLessThan(844);
    const south = await project(page, [lon, SOUTH]);
    const north = await project(page, [lon, NORTH]);
    const topbar = (await page.locator(".topbar").boundingBox())!;
    const sheet = (await page.locator(".sheet").first().boundingBox())!;
    expect(north.y).toBeGreaterThan(topbar.y + topbar.height);
    expect(south.y).toBeLessThan(sheet.y);
    // the floating legend chip sits ON TOP of the sheet (a sibling of `#panel-region`): a fit that
    // only cleared the sheet could still tuck the south edge under the chip
    const chip = page.locator(".legend-chip-region");
    await expect(chip, "no legend chip: the collection lens draws a legend").toBeVisible();
    const chipBox = (await chip.boundingBox())!;
    expect(
      south.y,
      `south edge (y=${south.y}) at or below the chip top (${chipBox.y})`,
    ).toBeLessThan(chipBox.y);
  });

  test("an explicit ?map= is never refitted on the phone either", async ({ page }) => {
    await gotoPhone(page, `/?map=${(WEST + EAST) / 2},${(SOUTH + NORTH) / 2},4`);
    await page.waitForTimeout(3000);
    const pt = await project(page, [(WEST + EAST) / 2, (SOUTH + NORTH) / 2]);
    expect(Math.abs(pt.x - 390 / 2)).toBeLessThan(20);
  });
});
