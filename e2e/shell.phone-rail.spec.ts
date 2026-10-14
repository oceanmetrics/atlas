// B4 (docs/usability.md §4/§3.8, z-index part only): "Phone: tool rail beneath the sheet at every
// detent" -- the sheet's `.panel-region` (z-index 16) sat at `bottom: 0`, the SAME row the tool
// rail (`.rail-region`, z-index 15) floats over at `bottom: var(--space-3)`; at every detent (even
// "peek", 96 px tall) the sheet's own box covered the rail's footprint and intercepted every tap
// meant for it. Only the Layers tool (selected by default, no tap needed) was reachable on a
// phone. Root cause + fix: src/shell/shell.css's `.panel-region` phone rule now reserves the
// rail's own row (`--size-rail-row`, built from the SAME tokens Rail.svelte/HexButton size the
// rail with, so it can never drift), and src/lib/ui/Sheet.svelte's `detent-full` rule shrinks to
// fit above it instead of growing back down over the reserved row.
//
// This is a REAL Playwright `.click()`, not a synthetic dispatch: Playwright's own actionability
// checks refuse to click a target another element visually covers, which is exactly how this bug
// reproduces red on the unfixed CSS (a timeout, matching the assessment's own "tapping 'Places'
// timed out with the sheet's content intercepting the tap").
//
// The phone species search (m1-adjacent, a different owner) is out of scope here -- this spec only
// taps the Places tool and
// reads the sheet's own title, never species state.
import { expect, test, type Page } from "@playwright/test";
import { gotoPublicShell, waitForHydration } from "./hermetic";

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 390, height: 844 } });

const DETENTS = [
  { name: "peek", buttonLabel: "Collapse to a peek" },
  { name: "half", buttonLabel: "Half height" },
  { name: "full", buttonLabel: "Full height" },
] as const;

async function gotoPhoneShell(page: Page) {
  await gotoPublicShell(page);
  await waitForHydration(page);
}

async function setDetent(page: Page, buttonLabel: string) {
  await page.getByRole("button", { name: buttonLabel }).click();
}

test.describe("B4: the phone tool rail is reachable at every sheet detent", () => {
  for (const { name, buttonLabel } of DETENTS) {
    test(`detent "${name}": tapping the Places rail item actually opens Places`, async ({
      page,
    }) => {
      await gotoPhoneShell(page);

      // Layers is the default tool -- confirms the starting state before the tap this test is
      // actually about. (R4-B: the sheet title is the header context, "<layer> · <unit>", not the
      // tool's name, so the ACTIVE RAIL ENTRY is what says which tool is open.)
      await expect(page.locator("#rail-region button[aria-label='Layers']")).toHaveAttribute(
        "aria-current",
        "true",
      );

      await setDetent(page, buttonLabel);

      // the real tap: Playwright refuses to click a target another element visually covers, so
      // this alone reproduces the bug (a timeout) on unfixed CSS -- no custom hit-testing needed.
      await page.locator("#rail-region button[aria-label='Places']").click({ timeout: 5_000 });

      // Places is now the active entry, and its header context with no place added is the tool's own
      // label ("Places").
      await expect(page.locator("#rail-region button[aria-label='Places']")).toHaveAttribute(
        "aria-current",
        "true",
      );
      await expect(page.locator(".sheet-title")).toHaveText("Places");
    });
  }

  test("elementFromPoint at the rail's own centre resolves to the rail, at every detent", async ({
    page,
  }) => {
    // a second, independent proof technique (the assessment's own diagnostic,
    // docs/usability/obs/obs-phone.json's `elementFromPoint` check) -- kept as a second test
    // rather than folded into the loop above so a regression here reads as "the geometry is wrong
    // again", distinct from "the click handler is wrong".
    await gotoPhoneShell(page);
    const rail = page.locator("#rail-region .rail");

    for (const { name, buttonLabel } of DETENTS) {
      await setDetent(page, buttonLabel);
      const box = await rail.boundingBox();
      expect(box, `detent "${name}": rail has no box (not rendered?)`).not.toBeNull();
      const cx = box!.x + box!.width / 2;
      const cy = box!.y + box!.height / 2;
      const hitsRail = await page.evaluate(
        ([x, y]) => {
          const el = document.elementFromPoint(x, y);
          return !!el?.closest("#rail-region");
        },
        [cx, cy] as const,
      );
      expect(hitsRail, `detent "${name}": elementFromPoint at the rail's centre missed it`).toBe(
        true,
      );
    }
  });
});
