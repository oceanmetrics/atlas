import { expect, test } from "@playwright/test";
import { ATLAS_BASE, collectConsoleErrors, collectRequests, routeBucket } from "./hermetic";

// atlas-0 Deliverable 5: the smoke spec. Runs against the built production bundle served by
// `vite preview` (see playwright.config.ts webServer), across chromium/webkit/firefox.
//
// HERMETIC: the catalog, the MarineSensitivity STAC, the gazetteer manifest and every map origin are
// routed to fixtures (e2e/hermetic.ts) -- no test here ever touches the live network.

test.describe("shell smoke", () => {
  test("index.html paints the real shell with zero console errors", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await routeBucket(page);

    await page.goto("/");

    // the shell (top bar, tool rail, panel, map) is real by the time the page settles -- the static
    // skeleton (index.html's own inlined critical CSS + markup) already painted an identical-geometry
    // placeholder before this, which is what e2e/shell.cls.spec.ts measures.
    await expect(page.locator(".topbar")).toBeVisible();
    await expect(page.locator("#rail-region")).toBeVisible();
    await expect(page.locator("#panel-region")).toBeVisible();
    await expect(page.locator("#map")).toBeVisible();
    // "Collections"/"Species" (the lens switch, top bar) and the spine's four tools (Layers, Details,
    // Table, Places) are each a real, visible, accessibly-named control in the hydrated shell.
    for (const label of ["Collections", "Species"]) {
      await expect(page.locator(".topbar").getByRole("button", { name: label })).toBeVisible();
    }
    for (const label of ["Layers", "Details", "Table", "Places"]) {
      await expect(page.locator("#rail-region").getByRole("button", { name: label })).toBeVisible();
    }
    // the retired lenses and chrome are really gone
    for (const label of ["Scores", "Report"]) {
      await expect(page.getByRole("button", { name: label, exact: true })).toHaveCount(0);
    }
    await expect(page.locator('[data-control="version-chip"]')).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test("the catalog is read from the atlas base, and no release registry is ever asked for", async ({
    page,
  }) => {
    const urls = collectRequests(page);
    await routeBucket(page);

    await page.goto("/?ver=v9"); // an old link: `ver` is retired and ignored

    await expect(page.locator("#rail-region .rail")).toBeAttached();
    await expect(page.getByRole("combobox", { name: "Collection" })).toBeVisible();
    expect(urls).toContain(`${ATLAS_BASE}catalog.json`);
    for (const retired of ["latest.txt", "versions.json", "session.json", "/manifest.json"]) {
      expect(urls.filter((u) => u.includes(retired))).toEqual([]);
    }
    expect(urls.filter((u) => u.includes("/v9/"))).toEqual([]);
  });
});

test.describe("a failed bundle load (atlas-3 handover item (b), fix list #14)", () => {
  // the ONLY fallback used to be a <noscript>, which never runs when script IS enabled and just
  // broken -- with every asset blocked, the page sat there forever: a title, an h1, two dead skip
  // links and ten aria-hidden skeleton parts, announcing and showing nothing. Fix: `src/main.ts`
  // sets `data-hydrated` on `<html>` right after `mount()` returns; index.html's own timed inline
  // script reveals a plain, visible `role="alert"` message if that attribute is still absent 8s
  // after the script starts. REVERTED (this fix alone) -> RED: no `#bundle-load-failed` element
  // ever appears, however long the test waits.
  test("index.html reveals a visible role=alert message when the bundle never runs", async ({
    page,
  }) => {
    await routeBucket(page);
    await page.route("**/assets/*.js", (route) => route.abort());

    await page.goto("/");

    // the skeleton paints regardless -- it is plain static HTML/CSS, no JS required.
    await expect(page.locator("#rail-region")).toBeVisible();

    const message = page.locator("#bundle-load-failed");
    await expect(message).toBeVisible({ timeout: 12_000 });
    await expect(message).toHaveAttribute("role", "alert");
    await expect(message).toContainText("could not load its application code");
    // genuinely on screen, not clipped/zero-size the way the visually-hidden map equivalent is.
    const box = await message.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(10);
    expect(box?.height ?? 0).toBeGreaterThan(10);
  });

  test("a bundle that DOES run never shows the fallback message", async ({ page }) => {
    await routeBucket(page);

    await page.goto("/");
    await expect(page.locator("#rail-region .rail")).toBeAttached();
    // well past the 8s timer, on a page that DID hydrate: the message must never fire.
    await page.waitForTimeout(9000);
    await expect(page.locator("#bundle-load-failed")).toHaveCount(0);
  });
});
