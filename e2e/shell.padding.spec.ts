// WP13: the map's centre (and the globe) sits in the part of the stage the panel leaves open.
// `src/lib/map/livePadding.ts` turns the shell's chrome reserve into MapLibre padding, `Shell.svelte`
// applies it when the chrome settles (never mid-drag), and `map.ts#flyToBounds` solves fits against
// the padded transform so an extent lands in the open area with only the breathing gutter, once.
// HERMETIC: the same catalog fixture and basemap stubs as shell.firstview.spec.ts.
import { expect, test, type Page } from "@playwright/test";
import { BIOTRACK_BBOX, routeBucket, waitForHydration } from "./hermetic";
import { routeBasemapStyle, routeGlyphs } from "./map-hermetic";

const [WEST, SOUTH, EAST, NORTH] = BIOTRACK_BBOX;
// rail (80) + the panel's outer inset (12) + the panel's own width (380)
const PANEL_EDGE = 80 + 12 + 380;
const GUTTER = 20;

async function gotoMap(page: Page, path: string, size = { width: 1280, height: 800 }) {
  await routeBucket(page);
  await routeBasemapStyle(page);
  await routeGlyphs(page);
  await page.setViewportSize(size);
  await page.goto(path);
  await waitForHydration(page);
  await page.waitForFunction(() => !!(window as unknown as { __atlasMap?: unknown }).__atlasMap, {
    timeout: 15_000,
  });
}

type Pad = { top: number; right: number; bottom: number; left: number };

const padding = (page: Page): Promise<Pad> =>
  page.evaluate(
    () =>
      (
        window as unknown as { __atlasMap: { handle: { map: { getPadding(): Pad } } } }
      ).__atlasMap.handle.map.getPadding() as Pad,
  );

/** poll until the map has stopped moving and the padding satisfies `ok` */
async function settledPadding(page: Page, ok: (p: Pad) => boolean): Promise<Pad> {
  await expect
    .poll(
      async () =>
        page.evaluate(
          () =>
            !(
              window as unknown as { __atlasMap: { handle: { map: { isMoving(): boolean } } } }
            ).__atlasMap.handle.map.isMoving(),
        ),
      { message: "the map never stopped moving" },
    )
    .toBe(true);
  await expect
    .poll(async () => ok(await padding(page)), { message: "padding never settled" })
    .toBe(true);
  return padding(page);
}

/** the screen box (canvas px) of an extent's outline, and the canvas size */
async function extentBox(page: Page) {
  return page.evaluate(
    ([w, s, e, n]) => {
      const map = (
        window as unknown as {
          __atlasMap: {
            handle: {
              map: {
                project(ll: [number, number]): { x: number; y: number };
                getCanvas(): HTMLCanvasElement;
              };
            };
          };
        }
      ).__atlasMap.handle.map;
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        const x = w + t * (e - w);
        const y = s + t * (n - s);
        for (const ll of [
          [x, s],
          [x, n],
          [w, y],
          [e, y],
        ] as [number, number][]) {
          const p = map.project(ll);
          x0 = Math.min(x0, p.x);
          x1 = Math.max(x1, p.x);
          y0 = Math.min(y0, p.y);
          y1 = Math.max(y1, p.y);
        }
      }
      const c = map.getCanvas();
      return { x0, x1, y0, y1, w: c.clientWidth, h: c.clientHeight };
    },
    [WEST, SOUTH, EAST, NORTH] as const,
  );
}

test.describe("WP13: live padding follows the panel", () => {
  test("a left-docked panel pads the left by rail + inset + panel, and nothing else (the top bar is a row above the stage)", async ({
    page,
  }) => {
    await gotoMap(page, "/");
    const pad = await settledPadding(page, (p) => p.left > 0);
    expect(pad).toEqual({ top: 0, right: 0, bottom: 0, left: PANEL_EDGE });
  });

  test("collapsing leaves only the rail; swapping the dock moves the padding to the right", async ({
    page,
  }) => {
    await gotoMap(page, "/");
    await settledPadding(page, (p) => p.left === PANEL_EDGE);
    await page.click('[data-panel-control="collapse"]');
    const collapsed = await settledPadding(page, (p) => p.left < PANEL_EDGE);
    expect(collapsed).toEqual({ top: 0, right: 0, bottom: 0, left: 84 });

    await page.locator(".panel-pill").click();
    await settledPadding(page, (p) => p.left === PANEL_EDGE);
    await page.click('[data-panel-control="swap-side"]');
    const right = await settledPadding(page, (p) => p.right > 0);
    expect(right).toEqual({ top: 0, right: PANEL_EDGE, bottom: 0, left: 0 });
  });

  test("a panel drag does not chase the pane: the padding holds until the pointer is released", async ({
    page,
  }) => {
    await gotoMap(page, "/");
    await settledPadding(page, (p) => p.left === PANEL_EDGE);
    const handle = (await page.locator('[aria-label="Resize panel"]').boundingBox())!;
    const y = handle.y + handle.height / 2;
    await page.mouse.move(handle.x + handle.width / 2, y);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) {
      await page.mouse.move(handle.x + 40 * i, y);
      await page.waitForTimeout(100);
      expect((await padding(page)).left, `mid-drag step ${i}`).toBe(PANEL_EDGE);
    }
    await page.mouse.up();
    const after = await settledPadding(page, (p) => p.left !== PANEL_EDGE);
    expect(after.left).toBeGreaterThan(PANEL_EDGE + 100);
  });

  test("the URL never records a padding change (an ease is programmatic)", async ({ page }) => {
    await gotoMap(page, "/?map=-70,35,4");
    await settledPadding(page, (p) => p.left === PANEL_EDGE);
    await page.click('[data-panel-control="collapse"]');
    await settledPadding(page, (p) => p.left < PANEL_EDGE);
    await page.waitForTimeout(600);
    expect(new URL(page.url()).searchParams.get("map")).toBe("-70,35,4");
  });
});

test.describe("WP13: fits land in the open area, padded once", () => {
  for (const proj of ["mercator", "globe"] as const) {
    test(`the BioTrack extent fills the open area with the gutter, centred (${proj})`, async ({
      page,
    }) => {
      await gotoMap(page, `/?proj=${proj}`);
      await settledPadding(page, (p) => p.left === PANEL_EDGE);
      await page.waitForTimeout(2500); // the collection's fit has landed
      const b = await extentBox(page);
      // inside the open area, never under the panel and never off the stage
      expect(b.x0, "left edge clears the panel").toBeGreaterThanOrEqual(PANEL_EDGE + GUTTER - 2);
      expect(b.x1, "right edge on screen").toBeLessThanOrEqual(b.w);
      expect(b.y0, "top gutter").toBeGreaterThanOrEqual(GUTTER - 2);
      expect(b.y1, "bottom gutter").toBeLessThanOrEqual(b.h - GUTTER + 2);
      // centred in the open area (padded once, not twice: a double pad would push it ~236 px further)
      const openMid = (PANEL_EDGE + b.w) / 2;
      expect(Math.abs((b.x0 + b.x1) / 2 - openMid)).toBeLessThan(25);
      // and it fills it: the tight axis (height here) reaches the gutter
      expect(b.y1 - b.y0).toBeGreaterThan(b.h - 2 * GUTTER - 25);
    });
  }

  test("the globe is centred in the open area at low zoom, panel docked left", async ({ page }) => {
    await gotoMap(page, "/?map=-40,20,1.3&proj=globe");
    await settledPadding(page, (p) => p.left === PANEL_EDGE);
    const c = await page.evaluate(() => {
      const map = (
        window as unknown as {
          __atlasMap: {
            handle: {
              map: {
                project(ll: { lng: number; lat: number }): { x: number; y: number };
                getCenter(): { lng: number; lat: number };
                getCanvas(): HTMLCanvasElement;
              };
            };
          };
        }
      ).__atlasMap.handle.map;
      const p = map.project(map.getCenter());
      return { x: p.x, w: map.getCanvas().clientWidth };
    });
    expect(Math.abs(c.x - (PANEL_EDGE + c.w) / 2)).toBeLessThan(2);
  });
});

test.describe("WP13: the phone sheet", () => {
  test("a full-height sheet pads nothing at the bottom (it would leave under 40% of the height)", async ({
    page,
  }) => {
    await page.addInitScript(() => window.localStorage.setItem("atlas.sheet.shell", "full"));
    await gotoMap(page, "/", { width: 390, height: 844 });
    await page.waitForTimeout(1500);
    expect(await padding(page)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  test("a half-height sheet pads the bottom by the sheet and the rail row", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("atlas.sheet.shell", "half"));
    await gotoMap(page, "/", { width: 390, height: 844 });
    const half = await settledPadding(page, (p) => p.bottom > 0);
    expect(half.top).toBe(0);
    expect(half.left).toBe(0);
    expect(half.right).toBe(0);
    expect(half.bottom).toBeGreaterThan(300);
  });
});
