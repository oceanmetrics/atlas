import { expect, test } from "@playwright/test";
import { routeBucket } from "./hermetic";

// atlas-3 step 3 / CLAUDE.md "URL-is-the-view": every write goes through history.replaceState,
// never pushState (a link must reproduce its exact view, not grow a back-button stack of every
// chrome tweak), and a field that equals its OWN default is never written to the URL (a shared
// link for the default view stays "/", not "/?lens=scores&..."). tests/state/invariants.test.ts
// and tests/shell/shell-invariants.test.ts already prove this at the source level; this is the
// real-browser version, walked through the actual controls.

async function recordHistoryCalls(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    (window as unknown as { __pushStateCalls: unknown[] }).__pushStateCalls = [];
    const real = history.pushState.bind(history);
    history.pushState = (...args: Parameters<typeof history.pushState>) => {
      (window as unknown as { __pushStateCalls: unknown[] }).__pushStateCalls.push(args);
      return real(...args);
    };
  });
}

async function gotoShell(page: import("@playwright/test").Page) {
  await routeBucket(page);
  await recordHistoryCalls(page);
  await page.goto("/", { waitUntil: "networkidle" });
}

function urlTail(page: import("@playwright/test").Page): string {
  const u = new URL(page.url());
  return u.search + u.hash;
}

test("the default view's URL carries no query or hash", async ({ page }) => {
  await gotoShell(page);
  expect(urlTail(page)).toBe("");
});

test("clicking the ALREADY-active lens does not add a default value to the URL", async ({
  page,
}) => {
  await gotoShell(page);
  await page.locator(".topbar").getByRole("button", { name: "Collections" }).click();
  expect(urlTail(page)).toBe("");
});

test("switching lenses writes a non-default value, and switching back removes it", async ({
  page,
}) => {
  await gotoShell(page);
  await page.locator(".topbar").getByRole("button", { name: "Species" }).click();
  expect(urlTail(page)).toBe("?lens=species");
  await page.locator(".topbar").getByRole("button", { name: "Collections" }).click();
  expect(urlTail(page)).toBe(""); // "collection" is the default lens when no species is selected
});

test("opening every rail tool and every panel-size control never touches the URL (chrome, not view state)", async ({
  page,
}) => {
  await gotoShell(page);
  const rail = page.locator("#rail-region [role='toolbar']");
  for (const label of ["Layers", "Details", "Table", "Places"]) {
    await rail.locator(`button[aria-label="${label}"]`).click();
    expect(urlTail(page)).toBe("");
  }

  const panel = page.locator("#panel-region");
  await panel.locator('[data-panel-control="collapse"]').click();
  expect(urlTail(page)).toBe("");
  await panel.locator("button.panel-pill").click(); // restore
  expect(urlTail(page)).toBe("");
  // R4-B: the panel's header keeps two controls -- move to the other side, and collapse (dock
  // bottom and Full screen retired). Walk the side swap both ways; layout is chrome, never the URL.
  await panel.getByRole("button", { name: "Move panel to the right" }).click();
  expect(urlTail(page)).toBe("");
  await panel.getByRole("button", { name: "Move panel to the left" }).click();
  expect(urlTail(page)).toBe("");
});

test("a full interaction walk never calls history.pushState, and never grows history.length", async ({
  page,
}) => {
  await gotoShell(page);
  const startLength = await page.evaluate(() => history.length);

  await page.locator(".topbar").getByRole("button", { name: "Species" }).click();
  await page.locator(".topbar").getByRole("button", { name: "Collections" }).click();
  await page.locator('[data-control="theme"]').click();
  const rail = page.locator("#rail-region [role='toolbar']");
  for (const label of ["Layers", "Details", "Table", "Places"]) {
    await rail.locator(`button[aria-label="${label}"]`).click();
  }
  const panel = page.locator("#panel-region");
  await panel.locator('[data-panel-control="collapse"]').click();
  await panel.locator("button.panel-pill").click();
  // the desktop search field and the phone-search trigger button (CSS-hidden here, still in the DOM)
  // share the label; the role picks the field
  await page.getByRole("searchbox", { name: /Search species and places/ }).click();
  await page.keyboard.type("leatherback");

  const pushStateCalls = await page.evaluate(
    () => (window as unknown as { __pushStateCalls: unknown[] }).__pushStateCalls,
  );
  expect(pushStateCalls).toEqual([]);
  expect(await page.evaluate(() => history.length)).toBe(startLength);
});

test("an explicit theme choice writes a real value (not a default-value bug)", async ({ page }) => {
  await gotoShell(page);
  await page.locator('[data-control="theme"]').click();
  expect(urlTail(page)).toMatch(/^\?theme=(light|dark)$/);
});
