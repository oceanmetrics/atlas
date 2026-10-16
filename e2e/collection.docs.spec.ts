// WP11 item 9: "Methods" and "License" open as dialogs, in the Collections lens' credits strip and on the
// catalog page. Hermetic: the collection's README is a fixture with a script tag and a javascript: link
// in it, so the render is proven safe in a real browser, not only in the unit tests.
import { expect, test, type Page } from "@playwright/test";
import { ATLAS_BASE, routeBucket, waitForHydration } from "./hermetic";
import { blockWasm, routeBasemapStyle, routeGlyphs } from "./map-hermetic";
import { safeRoute } from "./routeSafety";

const README_URL = `${ATLAS_BASE}biotrack_indicators/README.md`;
const README = [
  "# Fixture methods",
  "",
  "Some `code`, **bold** text and a [relative link](./items/all_summer_richness.json).",
  "",
  "<script>window.__pwned = true</script>",
  "",
  "[bad](javascript:window.__pwned=true)",
  "",
  "| Asset | File |",
  "|---|---|",
  "| `hex` | `hex.pmtiles` |",
].join("\n");

async function routeReadme(page: Page) {
  await page.route(
    README_URL,
    safeRoute((route) =>
      route.fulfill({ status: 200, contentType: "text/markdown", body: README }),
    ),
  );
}

async function expectRenderedReadme(page: Page) {
  const dialog = page.getByRole("dialog", { name: /^Methods: / });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Fixture methods", level: 1 })).toBeVisible();
  await expect(dialog.locator("table th")).toHaveText(["Asset", "File"]);
  await expect(dialog.locator("code").first()).toHaveText("code");
  // raw HTML is text, never markup; a javascript: link has no href
  await expect(dialog.getByText("<script>window.__pwned = true</script>")).toBeVisible();
  expect(await dialog.locator("script").count()).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned)).toBe(
    undefined,
  );
  await expect(dialog.getByText("bad", { exact: true })).toBeVisible();
  expect(await dialog.locator('a[href^="javascript"]').count()).toBe(0);
  // the relative link resolved against the README's own URL, opening in a new tab safely
  const rel = dialog.getByRole("link", { name: "relative link" });
  await expect(rel).toHaveAttribute(
    "href",
    `${ATLAS_BASE}biotrack_indicators/items/all_summer_richness.json`,
  );
  await expect(rel).toHaveAttribute("target", "_blank");
  await expect(rel).toHaveAttribute("rel", /noopener/);
  // and the raw file is one click away
  await expect(dialog.getByRole("link", { name: "Open raw" })).toHaveAttribute("href", README_URL);
}

test.use({ viewport: { width: 1280, height: 900 } });

test("the credits strip: Methods opens the README rendered, License explains the license", async ({
  page,
}) => {
  await blockWasm(page);
  await routeBucket(page);
  await routeBasemapStyle(page);
  await routeGlyphs(page);
  await routeReadme(page);
  await page.goto("/?c=biotrack_indicators"); // no longer the default collection
  await waitForHydration(page);

  // Methods: a dialog with the rendered file, not a raw markdown tab
  await page.getByTestId("methods-open").click();
  await expectRenderedReadme(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: /^Methods: / })).toBeHidden();

  // License: SPDX id, full name, one-line summary, the collection's license link, attribution + Copy
  await page
    .context()
    .grantPermissions(["clipboard-read", "clipboard-write"])
    .catch(() => {});
  await page.getByTestId("license-open").click();
  const license = page.getByRole("dialog", { name: /^License: / });
  await expect(license).toBeVisible();
  await expect(license.getByText("CC-BY-4.0").first()).toBeVisible();
  await expect(license.getByText("Creative Commons Attribution 4.0 International")).toBeVisible();
  await expect(license.getByText(/credit the creators/)).toBeVisible();
  await expect(
    license.getByRole("link", { name: "https://creativecommons.org/licenses/by/4.0/" }),
  ).toHaveAttribute("target", "_blank");
  await expect(license.getByTestId("license-attribution")).toContainText("Fixture citation");
  await license.getByRole("button", { name: "Copy attribution" }).click();
  await expect(license.getByRole("status")).toContainText(/Copied|Could not copy/);
});

test("the catalog page: Methods opens the README rendered, with Open raw", async ({ page }) => {
  await routeBucket(page);
  await routeReadme(page);
  await page.goto("/catalog.html");
  const card = page.locator("article.card", { hasText: "MBON BioTrack biodiversity indicators" });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Methods" }).click();
  await expectRenderedReadme(page);
  // the STAC json stays a plain link
  await page.keyboard.press("Escape");
  await expect(card.getByRole("link", { name: "collection.json (STAC)" })).toBeVisible();
  // the license opens its dialog from the card too
  await card.getByRole("button", { name: "CC-BY-4.0" }).click();
  await expect(page.getByRole("dialog", { name: /^License: / })).toBeVisible();
});
