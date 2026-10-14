// R3-W8 item 3 (Ben, 2026-09-25): "when clicking Share, the link should include all the same UI
// elements in their arrangement, eg on Layers pane." End-to-end proof of the `ui=` token's own
// round trip (`src/shell/uiState.ts`, unit-tested in tests/shell/uiState.test.ts's parse/format
// core): arrange the shell (dock right, collapse the Data row, pick a real species input,
// untick "Zoom to layer on change"), click Share, then open the COPIED link in a fresh browser
// context and confirm the same arrangement reappears -- not just that the token round-trips in
// isolation. The species input + representation and the zoom-to-layer preference are already
// ordinary `Sel` query state by the time Share is clicked (`in=`, `zl=`) -- this test also checks
// those survive, matching Shell.svelte's `shareUrl()` header ("everything ELSE Ben's example
// names... is already ordinary Sel query state").
import { expect, test, type Page } from "@playwright/test";
import { routeZonesPmtiles } from "./map-hermetic";
import { LEATHERBACK_SP, gotoSpecies } from "./species-hermetic";

test.use({ viewport: { width: 1280, height: 800 } });

// the v9 leatherback fixture's own "FWS Range" input (`rng_fws`, tests/fixtures/species/v9/taxon/
// f9.json) -- the one non-merged input on this taxon that ships a real asset (a pmtiles range with
// a bbox), so its pill is a real, clickable <button> (`hasSurface`, data/layerBar.ts's own rule),
// not a struck-through <span>. `*` (a Playwright glob wildcard, never matching `/`) absorbs the
// fixture's own cache-busting `?v=...` query string.
const FWS_RANGE_URL = "https://file.marinesensitivity.org/pmtiles/v9/rng_fws/C00F.pmtiles*";

/** overrides `navigator.clipboard.writeText` to CAPTURE what Share copies, rather than depending on
 * a real OS clipboard (unavailable/permission-gated in headless CI -- the same trade-off
 * e2e/shell.toast.spec.ts's own header documents for the SAME `onShare()` call). */
async function armClipboardCapture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __copied: string | null }).__copied = null;
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText(text: string) {
          (window as unknown as { __copied: string | null }).__copied = text;
          return Promise.resolve();
        },
      },
    });
  });
}

async function clickShareAndCapture(page: Page): Promise<string> {
  await page.locator('[data-control="share"]').click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __copied: string | null }).__copied), {
      message: "Share never wrote to the (captured) clipboard",
    })
    .not.toBeNull();
  return page.evaluate(() => (window as unknown as { __copied: string }).__copied);
}

test.describe("R3-W8 item 3: Share reproduces the UI arrangement", () => {
  test("dock right + Data row collapsed + FWS Range + zoom-to-layer off round-trip through a shared link", async ({
    page,
    context,
  }) => {
    await armClipboardCapture(page);
    await routeZonesPmtiles(page, FWS_RANGE_URL);
    await gotoSpecies(page, `/?sp=${LEATHERBACK_SP}&ver=v9`);

    // arrange 1: move the panel to the right (Panel.svelte's own move-to-the-other-side control --
    // chrome, never the URL, per U1; R4-B: the default side is LEFT, so RIGHT is the arrangement
    // worth sharing).
    const panelSurface = page.locator("#panel-region .panel-surface");
    await panelSurface.getByRole("button", { name: "Move panel to the right" }).click();
    await expect(page.locator("#panel-region")).toHaveAttribute("data-dock", "right");

    // arrange 3: pick "FWS Range" -- promoted to the top of the pane by item 1 -- reflected in the
    // ordinary `in=` URL state (not the `ui=` token).
    await page.locator('[data-testid="layer-pill"][data-key="rng_fws"]').click();
    await expect(page).toHaveURL(/[?&]in=rng_fws(&|$)/);

    // arrange 4: untick "Zoom to layer on change" (item 2) -- reflected in `zl=0`.
    await page.locator('[data-testid="zoom-to-layer-toggle"]').uncheck();
    await expect(page).toHaveURL(/[?&]zl=0(&|$)/);

    // arrange 2: collapse the "Data" row (LayersPanel.svelte's one expandable row; it starts open, and
    // its body holds the pills above, so it is collapsed last).
    const dataRow = page.getByRole("button", { name: "Data", exact: true });
    await expect(dataRow).toHaveAttribute("aria-expanded", "true");
    await dataRow.click();
    await expect(dataRow).toHaveAttribute("aria-expanded", "false");

    const shared = await clickShareAndCapture(page);
    // R4-B: the `ui=` token is version 4 (the Details tool is a `tool` code, the `tab` field is
    // gone, the side is left|right) -- see uiState.ts's own header.
    expect(shared).toMatch(/[?&]ui=4\./);
    expect(shared).toMatch(/[?&]in=rng_fws(&|$)/);
    expect(shared).toMatch(/[?&]zl=0(&|$)/);

    // open the copied link in a FRESH context -- a different reader, no shared localStorage/panel
    // state to leak the arrangement through any channel besides the link itself.
    const freshContext = await context.browser()!.newContext();
    const page2 = await freshContext.newPage();
    try {
      await routeZonesPmtiles(page2, FWS_RANGE_URL);
      const url = new URL(shared);
      await gotoSpecies(page2, `${url.pathname}${url.search}${url.hash}`);

      await expect(page2.locator("#panel-region")).toHaveAttribute("data-dock", "right");
      await expect(page2.locator("#rail-region")).toHaveAttribute("data-dock", "right");
      await expect(page2.getByRole("button", { name: "Data", exact: true })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      // the Data row is collapsed in the shared arrangement; its body (pills, zoom toggle) is there once
      // it is opened, and the choices made before the share are in it
      await page2.getByRole("button", { name: "Data", exact: true }).click();
      await expect(page2.locator('[data-testid="zoom-to-layer-toggle"]')).not.toBeChecked();
      await expect(page2.locator('[data-testid="layer-pill"][data-key="rng_fws"]')).toHaveClass(
        /active/,
      );
    } finally {
      await freshContext.close();
    }
  });
});

test.describe("R4-B: Share carries the Details tool and the side", () => {
  test("Details open on the right round-trips as ui=4.d.r...", async ({ page, context }) => {
    await armClipboardCapture(page);
    await routeZonesPmtiles(page, FWS_RANGE_URL);
    await gotoSpecies(page, `/?sp=${LEATHERBACK_SP}&ver=v9`);

    await page
      .locator("#panel-region .panel-surface")
      .getByRole("button", { name: "Move panel to the right" })
      .click();
    await page
      .locator('#rail-region [role="toolbar"]')
      .getByRole("button", { name: "Details" })
      .click();
    await expect(
      page.locator('#rail-region [role="toolbar"]').getByRole("button", { name: "Details" }),
    ).toHaveAttribute("aria-current", "true");

    const shared = await clickShareAndCapture(page);
    expect(new URL(shared).searchParams.get("ui")).toMatch(/^4\.d\.r\./);

    const freshContext = await context.browser()!.newContext();
    const page2 = await freshContext.newPage();
    try {
      await routeZonesPmtiles(page2, FWS_RANGE_URL);
      const url = new URL(shared);
      await gotoSpecies(page2, `${url.pathname}${url.search}${url.hash}`);
      await expect(page2.locator("#panel-region")).toHaveAttribute("data-dock", "right");
      await expect(
        page2.locator('#rail-region [role="toolbar"]').getByRole("button", { name: "Details" }),
      ).toHaveAttribute("aria-current", "true");
    } finally {
      await freshContext.close();
    }
  });
});
