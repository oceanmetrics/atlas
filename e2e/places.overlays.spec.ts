// WP4: the Layers panel's "Place layers" list. Hermetic: the gazetteer manifest is a three-row fixture
// (no live network), the catalog and every tile are stubbed. Proves what the unit tests cannot: the
// list renders from the manifest, the default overlays are ON, a toggle writes `?ov=` with
// replaceState (never a history entry), and the credits of the overlays that are on are listed.
import { expect, test } from "@playwright/test";
import { routeMapTileOrigins, safeRoute } from "./hermetic";

const GAZ = "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/gazetteer/";
const row = (slug: string, title: string, place_type: string, attribution: string, n: number) => ({
  slug,
  title,
  collection: slug,
  pmtiles: `https://storage.oceanmetrics.io/gazetteer/${slug}/places.pmtiles`,
  source_layer: slug,
  geom_type: "MultiPolygon",
  n,
  paint: {
    fill: { "fill-color": "#e08a1e", "fill-opacity": 0.45 },
    line: { "line-color": "#a85f00", "line-width": 1 },
  },
  place_type,
  attribution,
  license: "CC-PDDC",
});
const MANIFEST = {
  layers: [
    row(
      "noaa_sanctuaries",
      "NOAA national marine sanctuaries",
      "protected_area",
      "ONMS credit. Processed by Ocean Metrics.",
      47,
    ),
    row(
      "boem_wind_leases",
      "BOEM offshore wind leases",
      "lease",
      "BOEM credit. Processed by Ocean Metrics.",
      52,
    ),
    row(
      "mpa_inventory",
      "Marine protected areas inventory",
      "mpa",
      "MPA credit. Processed by Ocean Metrics.",
      981,
    ),
  ],
};

test.use({ viewport: { width: 1280, height: 900 } });

test.beforeEach(async ({ page }) => {
  await routeMapTileOrigins(page);
  await page.route(
    (url) => url.href.startsWith(GAZ),
    safeRoute((route) =>
      route.request().url().endsWith("index/layers.json")
        ? route.fulfill({ status: 200, json: MANIFEST })
        : route.fulfill({ status: 404, body: "" }),
    ),
  );
  await page.route(
    (url) => url.href.includes("/oceanmetrics.io-public/atlas/"),
    safeRoute((route) => route.fulfill({ status: 404, body: "" })),
  );
});

test("the Place layers list: default overlays on, toggles write ?ov= by replaceState, credits follow", async ({
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
  await page.goto("./?tour=off");
  const list = page.getByTestId("place-layers");
  await expect(list.getByRole("checkbox")).toHaveCount(3);
  await expect(list.getByRole("checkbox", { name: /national marine sanctuaries/ })).toBeChecked();
  await expect(list.getByRole("checkbox", { name: /wind leases/ })).toBeChecked();
  await expect(list.getByRole("checkbox", { name: /protected areas inventory/ })).not.toBeChecked();
  // the default set writes nothing
  expect(new URL(page.url()).searchParams.has("ov")).toBe(false);
  // credits of what is on, and only that
  const credits = page.getByTestId("place-layer-credits");
  await expect(credits).toContainText("ONMS credit");
  await expect(credits).toContainText("BOEM credit");
  await expect(credits).not.toContainText("MPA credit");

  await list.getByRole("checkbox", { name: /protected areas inventory/ }).check();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("ov"))
    .toBe("noaa_sanctuaries,boem_wind_leases,mpa_inventory");
  await expect(credits).toContainText("MPA credit");

  await list.getByRole("button", { name: "Hide all place layers" }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("ov")).toBe("");
  await expect(page.getByTestId("place-layer-credits")).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as unknown as { __pushes: () => number }).__pushes()),
  ).toBe(0);
});

test("a ?ov= link reproduces its overlays", async ({ page }) => {
  await page.goto("./?tour=off&ov=mpa_inventory");
  const list = page.getByTestId("place-layers");
  await expect(list.getByRole("checkbox", { name: /protected areas inventory/ })).toBeChecked();
  await expect(
    list.getByRole("checkbox", { name: /national marine sanctuaries/ }),
  ).not.toBeChecked();
  await expect(page.getByTestId("map-attribution-gazetteer")).toContainText("MPA credit");
});
