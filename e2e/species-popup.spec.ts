// atlas-5 fix round 3: the species click popup, themed (owner screenshot: MapLibre's own white
// popup box painted the app's light-on-dark text tokens white-on-white in the navy theme; only the
// swatch's inline style stayed legible). Both themes, real computed styles, in a real browser —
// the unit half of this fix (`tests/map/popup.test.ts`) only proves the CSS/class wiring; this is
// the "does it actually render legibly" half.
//
// Click is fired synthetically — `handle.map.fire("click", {lngLat, point})` — the same technique
// `e2e/scores.popup.spec.ts` uses and for the same reason: the species click handler
// (`Shell.svelte`'s `map.on("click", ...)` -> `speciesLens.handleMapClick`) only reads
// `e.lngLat`/`e.point`, both of which `Evented#fire` merges straight onto the event object, so this
// drives the exact production code path without needing pixel-accurate screen coordinates.
import { expect, test, type Page } from "@playwright/test";
import { routeBucket, waitForHydration } from "./hermetic";
import { blockWasm, routeBasemapStyle, routeGlyphs, routeTitilerTiles } from "./map-hermetic";
import { LEATHERBACK_SP, bootFor, routeSpeciesShards } from "./species-hermetic";

test.skip(({ browserName }) => browserName !== "chromium", "WebGL gate: chromium only (S2)");
test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1280, height: 800 } });

/** every `/cog/point/...` request (the species value fetch, `raster/point.ts`) answers the same
 * fixed value — registered AFTER `routeTitilerTiles` (Playwright: reverse registration order), so
 * it wins for that path while ordinary tile requests still get `routeTitilerTiles`'s PNG. */
async function routeSpeciesPointValue(page: Page, value: number) {
  await page.route(
    (url) =>
      url.hostname === "titiler-v8.marinesensitivity.org" && url.pathname.startsWith("/cog/point/"),
    (route) =>
      route.fulfill({ status: 200, contentType: "application/json", json: { values: [value] } }),
  );
}

async function gotoSpeciesTheme(
  page: Page,
  theme: "dark" | "light",
  beforeGoto?: () => Promise<void>,
) {
  await blockWasm(page);
  await routeBucket(page, bootFor("v9"));
  await routeSpeciesShards(page);
  await routeBasemapStyle(page);
  await routeTitilerTiles(page);
  await routeGlyphs(page);
  await routeSpeciesPointValue(page, 50);
  await beforeGoto?.(); // registered last -> wins over the titiler catch-all above
  await page.goto(`/?sp=${LEATHERBACK_SP}&ver=v9&theme=${theme}`);
  await waitForHydration(page);
  await page.waitForFunction(
    () => !!(window as unknown as { __atlasMap?: unknown }).__atlasMap,
    undefined,
    { timeout: 15_000 },
  );
}

async function fireMapClick(page: Page, lngLat: { lng: number; lat: number }) {
  await page.evaluate((ll) => {
    (
      window as unknown as {
        __atlasMap: { handle: { map: { fire(type: string, props: object): void } } };
      }
    ).__atlasMap.handle.map.fire("click", { lngLat: ll, point: { x: 0, y: 0 } });
  }, lngLat);
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a #rrggbb color: "${hex}"`);
  return m.slice(1, 4).map((h) => parseInt(h, 16)) as [number, number, number];
}

function rgbStringToTuple(s: string): [number, number, number] {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(s);
  if (!m) throw new Error(`not an rgb()/rgba() color: "${s}"`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

// WCAG 2.1 relative luminance / contrast ratio (the same formula scripts/contrast.mjs uses).
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = [r, g, b]
    .map((c) => c / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// fix list #12 (SC 4.1.3): the species click popup used to be a plain MapLibre div, never
// announced. Fix: `state.svelte.ts`'s `show()` also calls the shared `announce()`, with
// `popupAnnounceText()` (popup.ts) -- the SAME content as `popupHtml()`, unescaped. REVERTED
// (this fix alone) -> RED: the live region's text never changes on a map click.
test("the species popup's text is also announced through the shared live region", async ({
  page,
}) => {
  await gotoSpeciesTheme(page, "dark");
  const live = page.locator('[role="status"]').first();
  await fireMapClick(page, { lng: -70, lat: 40 });
  await expect(page.locator(".atlas-popup")).toBeVisible({ timeout: 15_000 });
  await expect(live).toContainText("Value: 50", { timeout: 15_000 });
  // never markup: announce() sets text content, so an unescaped "<" would prove the wrong
  // (HTML-escaped) string leaked through instead of the plain one popupAnnounceText() builds.
  expect(await live.innerHTML()).not.toContain("&lt;");
});

for (const theme of ["dark", "light"] as const) {
  test(`species popup text clears 4.5:1 contrast against its background — ${theme} theme (fix round 3)`, async ({
    page,
  }) => {
    await gotoSpeciesTheme(page, theme);
    await fireMapClick(page, { lng: -70, lat: 40 });

    const popup = page.locator(".atlas-popup .maplibregl-popup-content");
    await expect(popup).toBeVisible({ timeout: 15_000 });
    await expect(popup).toContainText("Value: 50"); // proves the click actually resolved a value

    // both values computed IN THE PAGE, on the real rendered popup, in the real resolved theme.
    // The background is `--surface-panel-basis`, not the popup's own literal (semi-transparent)
    // `background-color` — spec.md §3: that token IS "the worst-case OPAQUE composite of that
    // glass over the map ... what the contrast checker measures against" (the reason it exists at
    // all is that a color-mix() alpha blend cannot be judged for contrast without knowing what is
    // behind it; this project's own gate, scripts/contrast.mjs, uses the identical convention).
    const [textColor, basisHex] = await page.evaluate(() => {
      const el = document.querySelector(".atlas-popup .maplibregl-popup-content") as HTMLElement;
      return [
        getComputedStyle(el).color,
        getComputedStyle(document.documentElement).getPropertyValue("--surface-panel-basis"),
      ];
    });

    const ratio = contrastRatio(rgbStringToTuple(textColor), hexToRgb(basisHex));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
}

// R4-A (Ben, 2026-09-30): the species legend carries the whole-layer histogram (`/cog/statistics`
// on the drawn COG, `histogram_range` = the asset's rescale) and the click's `/cog/point` value as
// a marker -- and the popup itself no longer carries a sparkline.
test("the species legend shows the layer histogram; a click adds a marker at the /cog/point value", async ({
  page,
}) => {
  const urls: string[] = [];
  await gotoSpeciesTheme(page, "dark", async () => {
    await page.route(
      (url) =>
        url.hostname === "titiler-v8.marinesensitivity.org" &&
        url.pathname.startsWith("/cog/statistics"),
      (route) => {
        urls.push(route.request().url());
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          json: {
            b1: {
              min: 1,
              max: 100,
              histogram: [
                [4, 12, 30, 8],
                [1, 25.75, 50.5, 75.25, 100],
              ],
            },
          },
        });
      },
    );
  });
  const legend = page.getByTestId("species-legend");
  await expect(legend.getByTestId("legend-histogram")).toBeVisible({ timeout: 15_000 });
  await expect(legend.getByTestId("legend-marker")).toHaveCount(0);
  expect(urls.length).toBeGreaterThan(0);
  expect(urls[0]).toContain("histogram_range=");

  await fireMapClick(page, { lng: -70, lat: 40 });
  await expect(page.locator(".atlas-popup")).toContainText("Value: 50", { timeout: 15_000 });
  await expect(legend.getByTestId("legend-marker")).toContainText("50");
  await expect(page.locator(".atlas-popup svg")).toHaveCount(0);
});
