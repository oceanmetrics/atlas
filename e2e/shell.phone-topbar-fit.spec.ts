// P5 fix round 2 (coordinator finding, 390px eyes-on evidence on p5-phone-search-sheet-species-
// results.png): adding the P1 search button beside ⋯ pushed the phone topbar's fixed content
// (Collections/Species, search, ⋯, theme) past the viewport's right edge -- the theme
// toggle's own right edge landed ~20px past 390px and ~2px past 360px. Fixed by moving the theme
// toggle into the ⋯ menu on the phone (`topbar-desktop-only` on its standalone button,
// TopBarActions.svelte's own "Switch to light/dark theme" item) -- the same route Feedback/About
// already take.
//
// RED-FIRST: fails on the pre-fix tree at 390px (theme's boundingBox right edge > 390) and at
// 360px (theme's right edge > 360).
//
// Every VISIBLE, in-viewport `[data-control]` element is checked generically (not a hand-picked
// list of "the ones I touched") so a future control added to the phone topbar is covered by the
// same rule without this file changing.
import { expect, test, type Page } from "@playwright/test";
import { routeBucket, waitForHydration } from "./hermetic";

async function gotoShell(page: Page, viewport: { width: number; height: number }) {
  await routeBucket(page);
  await page.setViewportSize(viewport);
  await page.goto("/?theme=navy");
  await waitForHydration(page);
}

/** every `[data-control]` element that is actually visible (a `topbar-desktop-only` control at
 * this width has zero DOM footprint by way of `display: none`, so it is correctly skipped, not
 * silently passed) and whose own box sits inside the TOP BAR ROW (`y < topbar height`) -- rail/
 * panel controls float over the map at a different y and are out of this rule's scope. */
async function topbarControlBoxes(page: Page) {
  const topbarBox = (await page.locator(".topbar").boundingBox())!;
  const topbarBottom = topbarBox.y + topbarBox.height;
  const all = await page.locator("[data-control]").all();
  const rows: { name: string; box: { x: number; y: number; width: number; height: number } }[] = [];
  for (const el of all) {
    if (!(await el.isVisible())) continue;
    const box = await el.boundingBox();
    if (!box) continue;
    if (box.y >= topbarBottom) continue; // not a topbar row control (rail/panel/etc.)
    rows.push({ name: (await el.getAttribute("data-control")) ?? "?", box });
  }
  return rows;
}

for (const width of [390, 360]) {
  test(`phone topbar (${width}px): no visible control's right edge exceeds the viewport`, async ({
    page,
  }) => {
    await gotoShell(page, { width, height: 844 });
    const rows = await topbarControlBoxes(page);
    // lens switch, the phone search button and the ⋯ menu, at least
    expect(
      rows.length,
      "no topbar controls found -- selector or timing is wrong",
    ).toBeGreaterThanOrEqual(3);
    for (const { name, box } of rows) {
      expect(
        box.x + box.width,
        `[data-control="${name}"]'s right edge (${box.x + box.width}) exceeds the ${width}px viewport`,
      ).toBeLessThanOrEqual(width + 0.5);
    }
  });
}
