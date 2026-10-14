// UI-1 (round 3, Opus 5.5 eyes-on review): "About 60 announce() messages go only to a
// screen-reader live region... `lib/ui` has a visible toast component, but the app never mounts
// it" -- Share copies the link and says so, but a sighted user saw nothing happen. `notify()`
// (src/lib/ui/announcer.ts) now announces AND enqueues a visible toast; `<Toast>` is mounted once
// in Shell.svelte. RED-FIRST: fails on the pre-fix tree (no `.toast` element exists at all, since
// nothing ever mounted `<Toast>`).
//
// The clipboard call itself is not stubbed -- Playwright headless Chromium usually denies
// `navigator.clipboard.writeText` without an explicit permission grant, so this asserts EITHER of
// the two Share outcomes' own toast text: the point under test is "a toast bubble appears at all",
// not which branch fired (both go through the identical `notify()` call, just with a different
// tone -- see announcer.ts's own header).
import { expect, test, type Page } from "@playwright/test";
import { routeBucket, waitForHydration } from "./hermetic";

async function gotoShell(page: Page, viewport: { width: number; height: number }) {
  await routeBucket(page);
  await page.setViewportSize(viewport);
  await page.goto("/?theme=navy");
  await waitForHydration(page);
}

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

test.describe("UI-1: Share shows a VISIBLE toast, not just a screen-reader announcement", () => {
  test("desktop: clicking Share shows a toast bubble", async ({ page }) => {
    await gotoShell(page, DESKTOP);
    await page.locator('[data-control="share"]').click();

    const toast = page.locator(".toast");
    await expect(toast).toBeVisible({ timeout: 5_000 });
    await expect(toast).toContainText(/Link copied to your clipboard|Couldn't copy the link/);

    // UI-1's own acceptance bar: the toast must never cover the top bar / rail chrome it sits
    // above -- a coarse geometry check (the toast region sits at the bottom, the top bar at the
    // top) rather than a pixel-perfect non-overlap proof.
    const toastBox = (await toast.boundingBox())!;
    const topBarBox = (await page.locator(".topbar").boundingBox())!;
    expect(toastBox.y).toBeGreaterThan(topBarBox.y + topBarBox.height);
  });

  test("phone: clicking Share shows a toast bubble that clears the tool rail", async ({ page }) => {
    await gotoShell(page, PHONE);
    // Share is topbar-desktop-only on the phone -- reach it through the ⋯ overflow menu instead
    // (TopBarActions.svelte's own `moreItems`, "Share" first).
    await page.locator('[data-control="more-menu"]').click();
    await page.getByRole("menuitem", { name: "Share" }).click();

    const toast = page.locator(".toast");
    await expect(toast).toBeVisible({ timeout: 5_000 });

    // UI-1: "the toast must never cover the phone sheet's buttons or the legend chip" -- the rail
    // sits at the very bottom on the phone; the toast must clear it.
    const toastBox = (await toast.boundingBox())!;
    const railBox = (await page.locator("#rail-region").boundingBox())!;
    expect(
      toastBox.y + toastBox.height,
      `toast bottom edge (${toastBox.y + toastBox.height}) reaches into the rail starting at ` +
        `${railBox.y}`,
    ).toBeLessThanOrEqual(railBox.y + 0.5);
  });
});
