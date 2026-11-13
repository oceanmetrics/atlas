// A collection's own vector overlays (`atlas:overlays`) end to end, on the tiny fixture of
// tests/fixtures/overlays/ (a versioned hex collection: vessel sightings over vessel effort over the model
// hexagons, real PMTiles made with tippecanoe), opened the way a reviewer opens an unlisted collection:
// `?collection=<url of its collection.json>`. HERMETIC: the fixture is served under a made-up https origin
// (Range answered as S3 would), the catalog and every map origin are routed (`e2e/hermetic.ts`).
// Proves what the unit tests cannot: the list renders from the hook, two ticks put both overlays on the
// map at once (and `cov=` is written by replaceState), a click on a sighting opens ONE card listing the
// features under it with every attribute (markup as text) and the hex cell's value, Escape closes it, and
// the collection's version and its predecessor are in the credits.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { routeBucket, waitForHydration } from "./hermetic";
import { blockWasm, fulfillRanged } from "./map-hermetic";
import { safeRoute } from "./routeSafety";

test.skip(({ browserName }) => browserName !== "chromium", "WebGL gate: chromium only (S2)");
test.use({ viewport: { width: 1280, height: 900 } });

const ORIGIN = "https://fixture.oceanmetrics.test/sefsc_fixture/";
const COLLECTION = `${ORIGIN}collection.json`;
const FIXTURE = new URL("../tests/fixtures/overlays/sefsc_fixture/", import.meta.url);
/** the Rice's whale sighting (sightid 20140612003), on the first trackline, inside hexagon 1 */
const RICES_WHALE: [number, number] = [-89.61234, 27.51234];

type MapLike = {
  project(ll: [number, number]): { x: number; y: number };
  getCanvas(): HTMLCanvasElement;
  queryRenderedFeatures(o: { layers: string[] }): unknown[];
  getLayer(id: string): unknown;
};

async function boot(page: Page, query: string) {
  await blockWasm(page);
  await routeBucket(page);
  await page.route(
    (url) => url.href.startsWith(ORIGIN),
    safeRoute((route) => {
      const rel = route.request().url().slice(ORIGIN.length).split("?")[0];
      let body: Buffer;
      try {
        body = readFileSync(fileURLToPath(new URL(rel, FIXTURE)));
      } catch {
        return route.fulfill({ status: 404, body: "" });
      }
      if (rel.endsWith(".json")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "access-control-allow-origin": "*" },
          body,
        });
      }
      return fulfillRanged(route, body);
    }),
  );
  await page.goto(`./?tour=off&collection=${encodeURIComponent(COLLECTION)}&${query}`);
  await waitForHydration(page);
  await page.waitForFunction(() => !!(window as unknown as { __atlasMap?: unknown }).__atlasMap, {
    timeout: 15_000,
  });
}

/** the page coordinates of a lon/lat once the given layers have drawn something there. */
async function screenPoint(page: Page, ll: [number, number], layers: string[]) {
  await expect
    .poll(
      () =>
        page.evaluate((ids) => {
          const map = (window as unknown as { __atlasMap: { handle: { map: MapLike } } }).__atlasMap
            .handle.map;
          return ids.every(
            (id) => map.getLayer(id) && map.queryRenderedFeatures({ layers: [id] }).length > 0,
          );
        }, layers),
      { timeout: 20_000 },
    )
    .toBe(true);
  return page.evaluate((lngLat) => {
    const map = (window as unknown as { __atlasMap: { handle: { map: MapLike } } }).__atlasMap
      .handle.map;
    const p = map.project(lngLat);
    const r = map.getCanvas().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, ll);
}

test("two overlays on at once, a click on a sighting lists every attribute in ONE card", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let pushes = 0;
    const orig = history.pushState.bind(history);
    history.pushState = (...a) => {
      pushes++;
      return orig(...a);
    };
    (window as unknown as { __pushes: () => number }).__pushes = () => pushes;
  });
  const requested: string[] = [];
  page.on("request", (r) => {
    if (r.url().startsWith(ORIGIN)) requested.push(r.url().slice(ORIGIN.length));
  });
  // `cov=` (empty): none of the collection's overlays on, whatever its defaults
  await boot(page, "map=-89.45,27.5,9&cov=");
  const list = page.getByTestId("collection-layers");
  // one row per overlay (the filter checkbox under them is not a layer)
  const rows = list.getByRole("group", { name: "Collection layers" }).getByRole("checkbox");
  await expect(rows).toHaveCount(3);
  for (const cb of await rows.all()) await expect(cb).not.toBeChecked();
  await expect(list).toContainText("0 of 3 on");

  await list.getByRole("checkbox", { name: /Vessel sightings/ }).check();
  await expect.poll(() => new URL(page.url()).searchParams.get("cov")).toBe("sightings_vessel");
  await list.getByRole("checkbox", { name: /Vessel effort/ }).check();
  // sightings + effort are the collection's defaults: the URL says nothing again
  await expect.poll(() => new URL(page.url()).searchParams.has("cov")).toBe(false);
  await expect(list).toContainText("2 of 3 on");
  // both are drawn, the sightings over the effort, and the legend names them
  const order = await page.evaluate(() => {
    const ids = (
      window as unknown as {
        __atlasMap: {
          inputs: () => unknown;
          handle: { map: { getStyle(): { layers: { id: string }[] } } };
        };
      }
    ).__atlasMap.handle.map
      .getStyle()
      .layers.map((l) => l.id);
    return [ids.indexOf("cov-effort_vessel-line"), ids.indexOf("cov-sightings_vessel-circle")];
  });
  expect(order[0]).toBeGreaterThan(-1);
  expect(order[1]).toBeGreaterThan(order[0]);
  await expect(page.getByTestId("legend-overlays")).toContainText("Vessel sightings, 2003–2024");

  const at = await screenPoint(page, RICES_WHALE, [
    "cov-sightings_vessel-circle",
    "cov-effort_vessel-line",
    "hex-fill",
  ]);
  await page.mouse.click(at.x, at.y);
  const card = page.getByTestId("overlay-popup");
  await expect(card).toBeVisible();
  await expect(page.getByTestId("overlay-popup")).toHaveCount(1); // ONE card
  const features = card.locator(".atlas-popup-ov-feature");
  // top overlay first: the sighting, then the trackline it lies on
  await expect(features).toHaveCount(2);
  await expect(features.nth(0).locator(".atlas-popup-ov-head")).toContainText(
    "Vessel sightings, 2003–2024",
  );
  await expect(features.nth(0).locator(".atlas-popup-ov-head")).toContainText("Rice's whale");
  await expect(features.nth(1).locator(".atlas-popup-ov-head")).toContainText("Vessel effort");
  const row = (name: string) =>
    features
      .nth(0)
      .locator("tr")
      .filter({ has: page.locator("th", { hasText: name }) });
  await expect(row("sightid").locator("td")).toHaveText("20140612003");
  await expect(row("date").locator("td")).toHaveText("2014-06-12");
  await expect(row("Common name").locator("td")).toHaveText("Rice's whale");
  await expect(row("Group size").locator("td")).toHaveText("2");
  await expect(row("models").locator("td")).toHaveText("|rices_whale|");
  // a property holding markup is shown as text, never parsed
  await expect(row("comments").locator("td")).toHaveText("<img src=x onerror=alert(1)>");
  await expect(card.locator("img")).toHaveCount(0);
  // all eleven listed fields are rows, in the overlay's order
  await expect(features.nth(0).locator("th")).toHaveText([
    "sightid",
    "date",
    "survey",
    "Common name",
    "Scientific name",
    "Group size",
    "beaufort",
    "lat",
    "lon",
    "models",
    "comments",
    "aphia_id",
    "year",
    "month",
  ]);
  // the hex Item's value under the same point, in the same card
  await expect(card.locator(".atlas-popup-ov-cell")).toHaveText("Cell 1: 0.82");

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("overlay-popup")).toHaveCount(0);
  // the items came from the one-file index (rel: items), never one request per item
  expect(requested.filter((u) => u === "items.json")).toHaveLength(1);
  expect(requested.filter((u) => u.startsWith("items/"))).toEqual([]);
  expect(
    await page.evaluate(() => (window as unknown as { __pushes: () => number }).__pushes()),
  ).toBe(0);
});

test("'Only features matching the selected layer' filters the sightings by the Item's token", async ({
  page,
}) => {
  await boot(page, "map=-89.45,27.5,9&c=sefsc_fixture&i=rices_whale");
  const filter = page.getByTestId("overlay-filter");
  await expect(filter.getByRole("checkbox")).toBeEnabled();
  await filter.getByRole("checkbox").check();
  await expect.poll(() => new URL(page.url()).searchParams.get("covf")).toBe("1");
  const rendered = () =>
    page.evaluate(() => {
      const map = (
        window as unknown as {
          __atlasMap: {
            handle: {
              map: {
                queryRenderedFeatures(o: {
                  layers: string[];
                }): { properties: { sightid: number } }[];
              };
            };
          };
        }
      ).__atlasMap.handle.map;
      return [
        ...new Set(
          map
            .queryRenderedFeatures({ layers: ["cov-sightings_vessel-circle"] })
            .map((f) => f.properties.sightid),
        ),
      ];
    });
  await expect.poll(rendered, { timeout: 20_000 }).toEqual([20140612003]);

  // an Item that names no filter: the checkbox is disabled and says why
  await page.goto(
    `./?tour=off&collection=${encodeURIComponent(COLLECTION)}&map=-89.45,27.5,9&c=sefsc_fixture&i=sperm_whale&covf=1`,
  );
  await expect(page.getByTestId("overlay-filter").getByRole("checkbox")).toBeDisabled();
  await expect(page.getByTestId("overlay-filter")).toHaveAttribute(
    "title",
    /names no matching features/,
  );
  await expect.poll(async () => (await rendered()).length, { timeout: 20_000 }).toBe(4);
});

test("Filter features: a species, a year range, and Show model", async ({ page }) => {
  await boot(page, "map=-89.45,27.5,9&c=sefsc_fixture&i=sperm_whale");
  const rendered = (layer: string, key: string) =>
    page.evaluate(
      ([id, k]) => {
        const map = (
          window as unknown as {
            __atlasMap: {
              handle: {
                map: {
                  queryRenderedFeatures(o: {
                    layers: string[];
                  }): { properties: Record<string, number> }[];
                };
              };
            };
          }
        ).__atlasMap.handle.map;
        return [
          ...new Set(map.queryRenderedFeatures({ layers: [id] }).map((f) => f.properties[k])),
        ].sort();
      },
      [layer, key] as const,
    );
  const block = page.getByTestId("feature-filters");
  await expect(block).toBeVisible();
  // the month follows the map; this Item has no month, so it filters nothing
  await expect(block.getByRole("combobox", { name: "Month" })).toHaveValue("__follow");
  await expect(block.getByRole("combobox", { name: "Month" }).locator("option").first()).toHaveText(
    "Follow the map (all)",
  );
  await expect
    .poll(() => rendered("cov-sightings_vessel-circle", "sightid"), { timeout: 20_000 })
    .toHaveLength(4);

  await block.getByRole("combobox", { name: "Species (sightings)" }).selectOption("1576133");
  await expect.poll(() => new URL(page.url()).searchParams.get("cff")).toBe("species:1576133");
  await expect
    .poll(() => rendered("cov-sightings_vessel-circle", "sightid"))
    .toEqual([20140612003]);
  // the species filter lists the sightings only: the effort is untouched
  await expect.poll(() => rendered("cov-effort_vessel-line", "segid")).toEqual([5501, 7702]);
  // choosing a species never changes the layer; "Show model" does
  expect(new URL(page.url()).searchParams.get("i")).toBe("sperm_whale");
  await block.getByTestId("show-model").getByRole("button", { name: "Rice's whale" }).click();
  // (the Rice's whale Item is the collection's first, its default: `i=` leaves the URL)
  await expect
    .poll(() => new URL(page.url()).searchParams.get("i"), { timeout: 10_000 })
    .not.toBe("sperm_whale");
  await expect(
    page.getByTestId("collection-field").getByRole("combobox", { name: "Species", exact: true }),
  ).toHaveValue("rices_whale");

  await block.getByRole("combobox", { name: "Species (sightings)" }).selectOption("__all");
  await block.getByRole("combobox", { name: "Year from" }).selectOption("2018");
  await block.getByRole("combobox", { name: "Year to" }).selectOption("2018");
  await expect.poll(() => new URL(page.url()).searchParams.get("cff")).toBe("year:2018-2018");
  await expect
    .poll(() => rendered("cov-sightings_vessel-circle", "sightid"))
    .toEqual([20180704011, 20180704012]);
  await expect.poll(() => rendered("cov-effort_vessel-line", "segid")).toEqual([7702]);
});

test("the credits say Version 2 and link the previous version in this app", async ({ page }) => {
  await boot(page, "map=-89.45,27.5,9");
  const version = page.getByTestId("credits-version");
  await expect(page.getByTestId("credits-version-number")).toHaveText("2");
  const link = version.getByRole("link", { name: /MarineSensitivity v8/ });
  await expect(link).toHaveAttribute("href", "/?c=msens-v8-gm");
  await expect(link).not.toHaveAttribute("target", "_blank");
  await expect(version).toContainText("Previous version:");
});
