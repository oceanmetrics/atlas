import { expect, test, type Page } from "@playwright/test";
import { blockAppBundle, routeBucket, waitForHydration } from "./hermetic";

// atlas-3 step 3 fix round 1: the PRIMARY gate here is GEOMETRY EQUALITY between the static
// skeleton and the hydrated frame -- not the Layout Instability API, which CANNOT detect a
// skeleton/hydrated mismatch on this page. src/main.ts does `target.replaceChildren()` then
// `mount(Shell)`: every skeleton node is REMOVED and new nodes are CREATED, and the spec only
// reports a "layout shift" for a node whose OWN identity persists across two rendered frames and
// whose rect changed -- a wholesale swap is invisible to it (confirmed: even an 8 px skeleton
// offset produced a measured CLS of 0 before this fix). So this file now captures the bounding
// box of every keyed element with the app bundle BLOCKED (skeleton only, `blockAppBundle`) and
// again after real hydration (`waitForHydration`), and asserts they are pixel-identical (0.5 px
// tolerance for subpixel layout) -- the actual claim atlas-3 step 3 makes. The Layout Instability
// API is kept as a SECONDARY check below: it still catches a font-swap-driven shift on a node that
// DOES persist across frames (e.g. hydrated content settling after `document.fonts.ready`), which
// is a real, previously-caught regression (see shell.css's `.chip` min-width and index.html's
// Carlito preload comments).
const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  phone: { width: 390, height: 844 },
};
const THEMES = ["navy", "paper"] as const;

interface KeySpec {
  key: string;
  skeleton: string;
  hydrated: string;
}

// Every element with a hydrated twin the skeleton claims to match geometrically. Rail tools and
// panel-size controls are keyed by POSITION on the skeleton side (plain `sk-*` placeholders, no
// individual name) and by `aria-label` on the hydrated side (Rail/Panel/Sheet are src/lib/ui/*
// components this step imports but does not edit, so a NEW attribute cannot be added to their
// internal buttons -- aria-label is already there, stable, and exactly what a screen-reader user
// keys off of too). `[aria-label^="Collapse to a"]` matches both Panel's "...pill" and Sheet's
// "...peek" with one selector.
const KEYS: KeySpec[] = [
  { key: "topbar", skeleton: ".topbar", hydrated: ".topbar" },
  { key: "title", skeleton: "#app-title", hydrated: "#app-title" },
  {
    key: "lens-switch",
    skeleton: '[data-control="lens-switch"]',
    hydrated: '[data-control="lens-switch"]',
  },
  { key: "search", skeleton: '[data-control="search"]', hydrated: '[data-control="search"]' },
  { key: "share", skeleton: '[data-control="share"]', hydrated: '[data-control="share"]' },
  // owner review item 3 (live 0.10.62): the desktop "report-top" topbar button is REMOVED
  // (duplicative with the rail's own Report tool) -- no skeleton/hydrated pair to compare any more.
  { key: "help", skeleton: '[data-control="help"]', hydrated: '[data-control="help"]' },
  { key: "theme", skeleton: '[data-control="theme"]', hydrated: '[data-control="theme"]' },
  { key: "rail-frame", skeleton: "#rail-region > *", hydrated: "#rail-region > *" },
  {
    key: "rail-layers",
    skeleton: "#rail-region .sk-railitem:nth-child(1)",
    hydrated: '#rail-region button[aria-label="Layers"]',
  },
  // R4-B: the spine is FOUR items (Layers, Details, Table, Report) and the skeleton carries four
  // pills (index.html).
  {
    key: "rail-details",
    skeleton: "#rail-region .sk-railitem:nth-child(2)",
    hydrated: '#rail-region button[aria-label="Details"]',
  },
  {
    key: "rail-table",
    skeleton: "#rail-region .sk-railitem:nth-child(3)",
    hydrated: '#rail-region button[aria-label="Table"]',
  },
  {
    key: "rail-places",
    skeleton: "#rail-region .sk-railitem:nth-child(4)",
    hydrated: '#rail-region button[aria-label="Places"]',
  },
  { key: "panel-frame", skeleton: "#panel-region > *", hydrated: "#panel-region > *" },
  // R4-B: the panel's two controls, in their real DOM order -- move to the other side, THEN
  // collapse (dock left/bottom/right and maximize retired).
  {
    key: "panel-move-side",
    skeleton: ".sk-panel-controls .sk-panel-ctrl:nth-child(1)",
    hydrated: '#panel-region button[data-panel-control="swap-side"]',
  },
  {
    key: "panel-collapse",
    skeleton: ".sk-panel-controls .sk-panel-ctrl:nth-child(2)",
    // scoped to `.panel-surface` (Panel's own root), never a bare `[aria-label^="Collapse to a"]`
    // -- Sheet's own collapse control carries the identical prefix, and an unscoped selector would
    // match IT at the phone viewport (where `.sk-panel-ctrl` is `display:none`, correctly null),
    // making this key wrongly "hydrated-only" there instead of the null/null the loop expects.
    hydrated: '#panel-region .panel-surface button[aria-label^="Collapse to a"]',
  },
  // Sheet's OWN 3 (collapse/half/full), unchanged by R1 -- desktop-null/phone-real, the mirror of
  // the 2 Panel keys above (desktop-real/phone-null).
  {
    key: "sheet-collapse",
    skeleton: ".sk-panel-controls .sk-sheet-ctrl:nth-child(3)",
    hydrated: '#panel-region .sheet button[aria-label^="Collapse to a"]',
  },
  {
    key: "sheet-half",
    skeleton: ".sk-panel-controls .sk-sheet-ctrl:nth-child(4)",
    hydrated: '#panel-region .sheet button[aria-label="Half height"]',
  },
  {
    key: "sheet-full",
    skeleton: ".sk-panel-controls .sk-sheet-ctrl:nth-child(5)",
    hydrated: '#panel-region .sheet button[aria-label="Full height"]',
  },
  // R2: About/Feedback moved off the map into the top bar (TopBarActions.svelte); the ⋯ overflow
  // is phone-only, so it and About/Feedback are null/null at the OTHER viewport -- the loop below
  // already treats "consistently absent at this viewport" as a pass (see its own comment).
  { key: "feedback", skeleton: '[data-control="feedback"]', hydrated: '[data-control="feedback"]' },
  { key: "about", skeleton: '[data-control="about"]', hydrated: '[data-control="about"]' },
  {
    key: "more-menu",
    skeleton: '[data-control="more-menu"]',
    hydrated: '[data-control="more-menu"]',
  },
];

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function captureBoxes(page: Page, keys: KeySpec[], side: "skeleton" | "hydrated") {
  const boxes: Record<string, Box | null> = {};
  for (const k of keys) {
    const selector = side === "skeleton" ? k.skeleton : k.hydrated;
    const loc = page.locator(selector).first();
    const box = (await loc.count()) > 0 ? await loc.boundingBox() : null;
    boxes[k.key] = box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null;
  }
  return boxes;
}

/** how long the document's fonts get to settle before this helper gives up and says so. */
const FONTS_TIMEOUT_MS = 10_000;

/**
 * Wait for the document's fonts to settle. OceanMetrics Atlas ships NO web fonts (a system font stack,
 * `src/lib/brand/tokens.css`), so there is normally nothing to load; this stays as a bounded wait so a
 * future face cannot move a box between the skeleton and the hydrated frame unnoticed. It is bounded
 * (`document.fonts.ready` is a whole-document promise that can hang on WebKit) and it asserts nothing
 * is still loading afterwards.
 */
async function settleFonts(page: Page) {
  const loading = await page.evaluate(async (timeoutMs) => {
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, timeoutMs))]);
    return [...document.fonts].filter((f) => f.status === "loading").map((f) => f.family);
  }, FONTS_TIMEOUT_MS);
  expect(loading, `font face(s) still loading after ${FONTS_TIMEOUT_MS} ms`).toEqual([]);
}

for (const theme of THEMES) {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    test(`geometry equality: skeleton vs hydrated -- ${theme} @ ${name}`, async ({ browser }) => {
      const skeletonCtx = await browser.newContext();
      const skeletonPage = await skeletonCtx.newPage();
      await routeBucket(skeletonPage);
      await blockAppBundle(skeletonPage);
      await skeletonPage.setViewportSize(viewport);
      await skeletonPage.goto(`/?theme=${theme}`, { waitUntil: "networkidle" });
      await settleFonts(skeletonPage);
      const skeletonBoxes = await captureBoxes(skeletonPage, KEYS, "skeleton");
      await skeletonCtx.close();

      const hydratedCtx = await browser.newContext();
      const hydratedPage = await hydratedCtx.newPage();
      await routeBucket(hydratedPage);
      await hydratedPage.setViewportSize(viewport);
      await hydratedPage.goto(`/?theme=${theme}`, { waitUntil: "networkidle" });
      await waitForHydration(hydratedPage);
      await settleFonts(hydratedPage);
      const hydratedBoxes = await captureBoxes(hydratedPage, KEYS, "hydrated");
      await hydratedCtx.close();

      for (const k of KEYS) {
        const s = skeletonBoxes[k.key];
        const h = hydratedBoxes[k.key];
        if (s === null && h === null) continue; // consistently absent at this viewport (e.g. "about" on phone)
        expect(s, `"${k.key}" has a skeleton box but no hydrated twin`).not.toBeNull();
        expect(h, `"${k.key}" has a hydrated box but no skeleton twin`).not.toBeNull();
        if (!s || !h) continue;
        expect(
          Math.abs(s.x - h.x),
          `"${k.key}".x: skeleton ${s.x} vs hydrated ${h.x}`,
        ).toBeLessThanOrEqual(0.5);
        expect(
          Math.abs(s.y - h.y),
          `"${k.key}".y: skeleton ${s.y} vs hydrated ${h.y}`,
        ).toBeLessThanOrEqual(0.5);
        expect(
          Math.abs(s.width - h.width),
          `"${k.key}".width: skeleton ${s.width} vs hydrated ${h.width}`,
        ).toBeLessThanOrEqual(0.5);
        expect(
          Math.abs(s.height - h.height),
          `"${k.key}".height: skeleton ${s.height} vs hydrated ${h.height}`,
        ).toBeLessThanOrEqual(0.5);
      }
    });
  }
}

// --- secondary: the Layout Instability API, over a REAL (unblocked) hydration ------------------
// This does not prove the skeleton matches the hydrated frame (see the header comment) but it DOES
// still catch a shift among nodes that persist once mounted -- e.g. a font swap after
// `document.fonts.ready` settles late, or an async value (the version chip's text) growing a box
// past its reserved space. Both are real regressions this measured and fixed in this step.
test.describe("secondary: post-hydration layout-shift score", () => {
  // scoped to THIS describe block only (a bare top-level `test.skip(fn, ...)` would skip every
  // test in the whole file, including the geometry-equality ones above -- confirmed the hard way).
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "Layout Instability API is Chromium-only",
  );

  // What this counts: shifts of the CHROME (top bar, rail, the panel frame, the map controls). Three
  // pieces of content are data-driven and legitimately re-flow when their data arrives, so a shift
  // whose every source lies inside one of them is not counted: the panel's body (the catalog's
  // collection fields replace "Loading the catalog" -- a content swap inside a panel whose frame does
  // not move), the map-attribution line (it grows when the place-layer credits arrive from the
  // gazetteer manifest, anchored to the stage's edge) and the map legend card (its histogram arrives
  // with the values, growing the card upward from its corner). A shift of anything else still fails.
  async function installClsObserver(page: Page) {
    await page.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      (window as unknown as { __clsIgnored: number }).__clsIgnored = 0;
      const DATA_DRIVEN =
        "#panel-region .panel-body, #panel-region .sheet-body, .map-attribution, .lens-legend-region";
      const po = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const e = entry as PerformanceEntry & {
            value: number;
            hadRecentInput: boolean;
            sources?: { node: Node | null }[];
          };
          if (e.hadRecentInput) continue;
          const sources = e.sources ?? [];
          const dataDriven =
            sources.length > 0 &&
            sources.every((src) => {
              const n = src.node;
              const el = n instanceof Element ? n : (n?.parentElement ?? null);
              return !!el?.closest(DATA_DRIVEN);
            });
          const key = dataDriven ? "__clsIgnored" : "__cls";
          (window as unknown as Record<string, number>)[key] += e.value;
        }
      });
      po.observe({ type: "layout-shift", buffered: true });
    });
  }

  for (const theme of THEMES) {
    for (const [name, viewport] of Object.entries(VIEWPORTS)) {
      test(`post-hydration layout-shift score is 0 -- ${theme} @ ${name}`, async ({ page }) => {
        await routeBucket(page);
        await installClsObserver(page);
        await page.setViewportSize(viewport);

        await page.goto(`/?theme=${theme}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(300);

        const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
        expect(cls, `measured post-hydration layout-shift at ${theme}/${name}`).toBe(0);
      });
    }
  }
});
