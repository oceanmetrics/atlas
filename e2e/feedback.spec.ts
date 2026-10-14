import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { routeBucket } from "./hermetic";

// atlas-8 Deliverable 4 (beta feedback, zero backend): the real "Report a problem" control, in a
// real browser, with a real place drawn into the hash -- the one thing a unit test (which never
// touches `location` at all -- see tests/feedback/noHash.test.ts's whole point) cannot prove: that
// the ACTUAL rendered `href`, read off the real DOM, never carries the fragment. HERMETIC, same
// convention as every other shell spec (e2e/hermetic.ts) -- no request ever reaches the live network.

const SECRET_PLACE = "g1.test.SECRET-GEOMETRY-XYZ";

async function gotoShellWithPlace(page: import("@playwright/test").Page) {
  await routeBucket(page);
  // `lens`/`pal` in the query (neither at its own default, so both round-trip); the place lives ONLY
  // in the hash, exactly like a real drawn place would (plan D8).
  await page.goto(`/?lens=species&pal=viridis#pl=${SECRET_PLACE}`, {
    waitUntil: "networkidle",
  });
}

/** the issue body ("body" query param), fully decoded -- `URLSearchParams.get` already does the
 * decoding, so this never double-decodes (which can throw on a literal "%" in the text). */
function issueBody(href: string): string {
  return new URL(href).searchParams.get("body") ?? "";
}

test.describe("Report a problem: the control's href never carries the hash", () => {
  test("real browser: hash is present in location, absent from the control's href", async ({
    page,
  }) => {
    await gotoShellWithPlace(page);

    // sanity: the secret really is in the live location before we check the control -- otherwise a
    // passing assertion below could just mean the setup silently failed to carry it at all.
    const hash = await page.evaluate(() => window.location.hash);
    expect(hash).toContain(SECRET_PLACE);

    const link = page.locator('[data-control="feedback"]');
    await expect(link).toBeVisible();
    const href = await link.getAttribute("href");
    expect(href).toBeTruthy();

    expect(href).not.toContain("#");
    expect(href).not.toContain("pl=");
    expect(href).not.toContain(SECRET_PLACE);

    // the lens and query ARE kept -- only the fragment is stripped.
    const url = new URL(href as string);
    expect(url.hostname).toBe("github.com");
    expect(url.pathname).toBe("/oceanmetrics/atlas/issues/new");
    expect(url.searchParams.get("labels")).toBe("beta-feedback");

    const body = issueBody(href as string);
    expect(body).not.toContain("#");
    expect(body).not.toContain(SECRET_PLACE);
    expect(body).toContain("Lens: species");

    // the query the address bar actually shows (formatSel's own defaults-omitted form) is exactly
    // what the issue body's "URL:" line carries -- proving "query kept" against the REAL app, not
    // just a hand-built fixture.
    const addressBarQuery = await page.evaluate(() => window.location.search);
    expect(addressBarQuery).toContain("lens=species");
    expect(addressBarQuery).toContain("pal=viridis");
    const pageOriginAndPath = await page.evaluate(() => location.origin + location.pathname);
    expect(body).toContain(`- URL: ${pageOriginAndPath}${addressBarQuery}`);
  });

  test("a real <a target=_blank rel=noopener>, keyboard-reachable, with an accessible name", async ({
    page,
  }) => {
    await gotoShellWithPlace(page);
    const link = page.locator('[data-control="feedback"]');
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener");
    expect(await link.evaluate((el) => el.tagName)).toBe("A");

    await link.focus();
    await expect(link).toBeFocused();
    // R2 (docs/usability.md §7, landed after this spec): the control moved from an on-map
    // bottom-left "Report a problem" link into the top bar, RELABELLED "Feedback" -- the same
    // action (`[data-control="feedback"]`, `openFeedback()`), a shorter name that fits a top-bar
    // icon+text control (TopBarActions.svelte).
    await expect(link).toHaveAccessibleName(/feedback/i);
  });

  test("the href is recomputed when the lens changes, never frozen at mount", async ({ page }) => {
    await gotoShellWithPlace(page);
    const link = page.locator('[data-control="feedback"]');
    const before = await link.getAttribute("href");
    expect(issueBody(before as string)).toContain("Lens: species");

    await page.locator(".topbar").getByRole("button", { name: "Collections" }).click();

    await expect
      .poll(async () => issueBody((await link.getAttribute("href")) as string))
      .toContain("Lens: collection");
    // and the OLD value is gone -- this is a live recompute, not an appended second line.
    const after = await link.getAttribute("href");
    expect(issueBody(after as string)).not.toContain("Lens: species");
  });
});

// U3 (round 2): the real "Send feedback" dialog -- the control's ACTION now opens
// FeedbackDialog.svelte instead of navigating straight to the GitHub link above (that link stays,
// as the anchor's plain `href`, for JS-disabled/right-click -- the tests above are untouched by
// this because they never simulate a click). Every network leg is routed: the release bucket/map
// tiles (routeBucket), and a fake `VITE_FEEDBACK_URL` seeded via localStorage
// (`atlas.feedback_url`, docs/feedback.md's own override) so nothing here ever reaches a real
// Apps Script deployment.

const FEEDBACK_ENDPOINT = "https://script.google.com/macros/s/test-fixture/exec";

async function seedFeedbackEndpoint(page: Page) {
  await page.addInitScript((url) => {
    try {
      window.localStorage.setItem("atlas.feedback_url", url);
    } catch {
      /* private mode -- covered separately by the "no endpoint configured" test below */
    }
  }, FEEDBACK_ENDPOINT);
}

/** routes the fake endpoint, fulfilling every POST with `{ok:true}` and collecting each parsed
 * JSON body for the test to assert against -- the posted payload is the one thing a unit test
 * (which never mounts the real dialog) cannot prove end-to-end. */
function routeFakeFeedbackEndpoint(page: Page): Record<string, unknown>[] {
  const bodies: Record<string, unknown>[] = [];
  void page.route(FEEDBACK_ENDPOINT, async (route) => {
    const raw = route.request().postData() ?? "{}";
    bodies.push(JSON.parse(raw));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      // this fake endpoint is a different origin than the app (script.google.com vs localhost) --
      // postFeedback()'s real `fetch()` needs a CORS-allowing response to resolve `ok` at all;
      // without this header the request is a genuine cross-origin failure, not a stub.
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ ok: true }),
    });
  });
  return bodies;
}

async function openFeedbackDialog(page: Page) {
  await page.locator('[data-control="feedback"]').click();
  const dialog = page.locator("dialog[open]");
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("Send feedback: the dialog (U3)", () => {
  test("opens on click, settles a screenshot state, can be annotated, and sends", async ({
    page,
  }) => {
    await routeBucket(page);
    await seedFeedbackEndpoint(page);
    const bodies = routeFakeFeedbackEndpoint(page);
    await page.goto("/", { waitUntil: "networkidle" });

    const dialog = await openFeedbackDialog(page);
    await expect(dialog.getByRole("heading", { name: "Feedback" })).toBeVisible();

    // the screenshot capture settles one way or the other (a thumbnail, or the graceful
    // "no screenshot" message html-to-image's own failure path falls back to) -- either is a
    // valid outcome of "capturing" resolving; what matters is the dialog never gets stuck showing
    // "Capturing the view…" forever.
    await expect
      .poll(async () => (await dialog.locator(".hint.pad").count()) === 0, { timeout: 15000 })
      .toBe(true);

    const markUp = dialog.getByRole("button", { name: "Mark up" });
    if (await markUp.isEnabled()) {
      await markUp.click();
      const canvas = dialog.locator("canvas");
      await expect(canvas).toBeVisible();
      const box = await canvas.boundingBox();
      if (box) {
        await page.mouse.move(box.x + 10, box.y + 10);
        await page.mouse.down();
        await page.mouse.move(
          box.x + Math.max(20, box.width - 10),
          box.y + Math.max(20, box.height - 10),
        );
        await page.mouse.up();
      }
      await dialog.getByRole("button", { name: "Done" }).click();
      await expect(dialog.getByRole("heading", { name: "Feedback" })).toBeVisible();
    }

    await dialog.getByLabel(/what happened/i).fill("the score near the Aleutians looks too high");
    await dialog.getByRole("button", { name: "Send" }).click();

    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0].app).toBe("atlas");
    expect(bodies[0].kind).toBe("bug");
    // unticked by default (the privacy rule): no `url` field at all, so definitely no fragment.
    expect("url" in bodies[0]).toBe(false);
    expect(JSON.stringify(bodies[0])).not.toContain("#");
    expect(bodies[0].restricted).toBe(false);

    await expect(dialog.getByText(/sent to the team/i)).toBeVisible();
  });

  test("unticked (the default): sending never includes the hash, or any url field at all", async ({
    page,
  }) => {
    await routeBucket(page);
    await seedFeedbackEndpoint(page);
    const bodies = routeFakeFeedbackEndpoint(page);
    await page.goto(`/?lens=species#pl=${SECRET_PLACE}`, { waitUntil: "networkidle" });

    const dialog = await openFeedbackDialog(page);
    await dialog.getByLabel(/what happened/i).fill("test");
    // the checkbox starts UNCHECKED (the privacy rule) -- this test never touches it.
    await expect(dialog.getByLabel(/include my current view link/i)).not.toBeChecked();
    await dialog.getByRole("button", { name: "Send" }).click();

    await expect.poll(() => bodies.length).toBe(1);
    expect("url" in bodies[0]).toBe(false);
    expect(JSON.stringify(bodies[0])).not.toContain("#");
    expect(JSON.stringify(bodies[0])).not.toContain(SECRET_PLACE);
  });

  test('ticking "include my current view link" carries the hash', async ({ page }) => {
    await routeBucket(page);
    await seedFeedbackEndpoint(page);
    const bodies = routeFakeFeedbackEndpoint(page);
    await page.goto(`/?lens=species#pl=${SECRET_PLACE}`, { waitUntil: "networkidle" });

    const dialog = await openFeedbackDialog(page);
    await dialog.getByLabel(/what happened/i).fill("test");
    await dialog.getByLabel(/include my current view link/i).check();
    await dialog.getByRole("button", { name: "Send" }).click();

    await expect.poll(() => bodies.length).toBe(1);
    expect(String(bodies[0].url)).toContain("#");
    expect(String(bodies[0].url)).toContain(SECRET_PLACE);
  });

  test("no endpoint configured: Send is disabled, and the GitHub-issue fallback works", async ({
    page,
  }) => {
    await routeBucket(page);
    // deliberately no seedFeedbackEndpoint() -- an unconfigured build.
    await page.goto("/", { waitUntil: "networkidle" });

    const dialog = await openFeedbackDialog(page);
    await dialog.getByLabel(/what happened/i).fill("test");
    await expect(dialog.getByRole("button", { name: "Send" })).toBeDisabled();

    const ghLink = dialog.getByRole("link", { name: "Open as GitHub issue" });
    await expect(ghLink).toBeVisible();
    const href = await ghLink.getAttribute("href");
    expect(href).toContain("github.com/oceanmetrics/atlas/issues/new");
    expect(href).toContain("labels=bug");
  });

  test("keyboard walk: Tab reaches the form controls; Esc closes and returns focus to the opener", async ({
    page,
  }) => {
    await routeBucket(page);
    await page.goto("/", { waitUntil: "networkidle" });

    const link = page.locator('[data-control="feedback"]');
    await link.focus();
    await page.keyboard.press("Enter");
    const dialog = page.locator("dialog[open]");
    await expect(dialog).toBeVisible();

    // the kind picker, the text field, the checkbox and Send are all real, Tab-reachable controls
    // -- Segmented renders four PLAIN Tab-order buttons (not roving tabindex, spec.md §5.3's "two
    // or three targets do not justify it"), so Tab from the LAST one is what reaches Title next.
    await dialog.getByRole("group", { name: "Feedback kind" }).getByRole("button").last().focus();
    await page.keyboard.press("Tab");
    await expect(dialog.getByLabel(/title/i)).toBeFocused();

    // Esc closes the native <dialog> (Modal.svelte's showModal()/close() contract) and returns
    // focus to whatever opened it.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(link).toBeFocused();
  });

  test("axe: zero serious/critical findings with the dialog open", async ({ page }) => {
    await routeBucket(page);
    await page.goto("/", { waitUntil: "networkidle" });
    await openFeedbackDialog(page);

    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const bad = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(bad, JSON.stringify(bad, null, 2)).toEqual([]);
  });
});
