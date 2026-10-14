// R4 (docs/usability.md §7): the tool rail is now a vertical labelled stack on desktop and a
// bottom tab bar on the phone -- this spec proves the four things the decision actually promises,
// none of which the pre-existing rail specs cover (e2e/shell.phone-rail.spec.ts is about z-index/
// reachability, not labels or the active marker; tools.test.ts is a pure-data test with no DOM):
//   1. every tool's label is VISIBLE text on desktop (not tooltip-only -- the usability finding
//      this decision answers: "meaning only in tooltips ... a first-timer has to hover each").
//   2. the phone spine is a labelled ROW (tab bar), same four tools, at every sheet detent.
//   3. the active tool's marker (`aria-current`, plus the accent fill/ring CSS) follows clicks.
//   4. arrow keys (+ Home/End) move the roving-tabindex focus stop, per roving.ts.
//
// R4-B (2026-09-30): the rail is the spine -- FOUR entries (Layers, Details, Table, Places), the
// same in both lenses and on every viewport, attached to the panel's outer edge.
import { expect, test } from "@playwright/test";
import { gotoPublicShell, waitForHydration } from "./hermetic";

const RAIL_LABELS = ["Layers", "Details", "Table", "Places"];

test.describe("R4: desktop -- a vertical labelled stack", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("every rail item shows its label as visible text, not tooltip-only", async ({ page }) => {
    await gotoPublicShell(page);
    await waitForHydration(page);

    const items = page.locator("#rail-region .rail button.railitem");
    await expect(items).toHaveCount(4);
    for (const label of RAIL_LABELS) {
      const btn = page.locator(`#rail-region button.railitem[aria-label="${label}"]`);
      // the visible label text sits inside the button (a real, laid-out, non-empty text node) --
      // not merely present in the accessible tree via aria-label/tooltip.
      await expect(btn.locator(".railitem-label")).toHaveText(label);
      await expect(btn.locator(".railitem-label")).toBeVisible();
    }
  });

  test("the active tool's marker follows the clicked tool (aria-current)", async ({ page }) => {
    await gotoPublicShell(page);
    await waitForHydration(page);

    const layers = page.locator('#rail-region button.railitem[aria-label="Layers"]');
    const table = page.locator('#rail-region button.railitem[aria-label="Table"]');

    await expect(layers).toHaveAttribute("aria-current", "true"); // default tool
    await expect(table).not.toHaveAttribute("aria-current", /.*/);

    await table.click();

    await expect(table).toHaveAttribute("aria-current", "true");
    await expect(layers).not.toHaveAttribute("aria-current", /.*/);

    // R3 (Ben, 2026-09-25): the hexagon pip is gone ("excessive and distracting") -- the active
    // marker is now the accent fill alone (RailButton.svelte's `.is-on` background), asserted here
    // as a real paint, not just a class name with no visible effect.
    const bg = await table.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg, "the active item has no accent background paint").not.toBe("rgba(0, 0, 0, 0)");
    // and the removed pip pseudo-element paints nothing (content: "" was the only thing that made
    // it visible at all -- a stray leftover rule would still show as a background here).
    const pipBg = await table.evaluate((el) => getComputedStyle(el, "::before").backgroundColor);
    expect(pipBg, "the hexagon pip must be gone (R3)").toBe("rgba(0, 0, 0, 0)");
  });

  test("arrow keys and Home/End move the roving-tabindex stop (roving.ts)", async ({ page }) => {
    await gotoPublicShell(page);
    await waitForHydration(page);

    const rail = page.locator("#rail-region .rail");
    await rail.locator("button.railitem").first().focus();
    await expect(page.locator('button.railitem[aria-label="Layers"]')).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await expect(page.locator('button.railitem[aria-label="Details"]')).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator('button.railitem[aria-label="Table"]')).toBeFocused();
    await page.keyboard.press("ArrowUp");

    await page.keyboard.press("ArrowUp");
    await expect(page.locator('button.railitem[aria-label="Layers"]')).toBeFocused();

    await page.keyboard.press("End");
    await expect(page.locator('button.railitem[aria-label="Places"]')).toBeFocused();

    await page.keyboard.press("Home");
    await expect(page.locator('button.railitem[aria-label="Layers"]')).toBeFocused();

    // wraps at both ends (roving.ts's own rule)
    await page.keyboard.press("ArrowUp");
    await expect(page.locator('button.railitem[aria-label="Places"]')).toBeFocused();
  });
});

test.describe("R4: phone (390x844) -- a labelled bottom tab bar, same four tools", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  const DETENTS = ["Collapse to a peek", "Half height", "Full height"] as const;

  test("the tab bar shows all four labels, in a row, at every sheet detent", async ({ page }) => {
    await gotoPublicShell(page);
    await waitForHydration(page);

    const rail = page.locator("#rail-region .rail");
    await expect(rail).toHaveCSS("flex-direction", "row");

    for (const buttonLabel of DETENTS) {
      await page.getByRole("button", { name: buttonLabel }).click();
      for (const label of RAIL_LABELS) {
        const btn = page.locator(`#rail-region button.railitem[aria-label="${label}"]`);
        await expect(btn, `"${label}" at detent "${buttonLabel}"`).toBeVisible();
        await expect(btn.locator(".railitem-label"), `"${label}" label text`).toHaveText(label);
      }
    }
  });
});

// R4-B: the phone bar grew from three to four entries -- it must still fit the narrowest viewport
// the matrix covers (320) and the common one (390), every target at least 44px.
for (const width of [320, 390]) {
  test.describe(`R4-B: phone bar at ${width}px -- four entries, no overflow, 44px targets`, () => {
    test.use({ viewport: { width, height: 800 } });

    test("every entry is on screen, at least 44x44, and the page does not scroll sideways", async ({
      page,
    }) => {
      await gotoPublicShell(page);
      await waitForHydration(page);
      const buttons = page.locator("#rail-region button.railitem");
      await expect(buttons).toHaveCount(4);
      for (let i = 0; i < 4; i++) {
        const box = (await buttons.nth(i).boundingBox())!;
        expect(box.x, `entry ${i} left edge`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `entry ${i} right edge`).toBeLessThanOrEqual(width);
        expect(box.width, `entry ${i} width`).toBeGreaterThanOrEqual(44);
        expect(box.height, `entry ${i} height`).toBeGreaterThanOrEqual(44);
      }
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
}
