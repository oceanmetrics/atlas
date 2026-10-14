import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

// 0.10.14: the firefox software-WebGL2 prefs, read from the one file `scripts/check-webgl2.mjs`
// also reads (that script is the CI gate proving they worked). Its `_why` key is the explanation;
// every other key is a real Firefox pref. Keeping them in JSON rather than inline here is what
// makes the gate and the browser provably identical.
const FIREFOX_WEBGL_PREFS: Record<string, string | number | boolean> = Object.fromEntries(
  Object.entries(
    JSON.parse(
      readFileSync(
        fileURLToPath(new URL("./scripts/firefox-webgl-prefs.json", import.meta.url)),
        "utf8",
      ),
    ) as Record<string, string | number | boolean>,
  ).filter(([k]) => !k.startsWith("_")),
);

/**
 * Run Firefox HEADED (under `pages.yml`'s `xvfb-run`) -- see the firefox project's own comment.
 *
 * 0.10.14 fix round 1: this used to be INFERRED (`platform === "linux" && !!DISPLAY`), and an
 * inference cannot tell "no display, so headless is correct" apart from "someone forgot
 * `xvfb-run` on this step, so headless is a silent WebGL2-less run". That second case is exactly
 * what happened (run 35823503729: the suite step was wrapped, the timing-gate step was not).
 * It is now an EXPLICIT opt-in that validates itself: `FIREFOX_HEADED=1` with no `$DISPLAY`
 * throws here, before a single browser launches.
 */
const FIREFOX_HEADED = process.env.FIREFOX_HEADED === "1";
if (FIREFOX_HEADED && !process.env.DISPLAY) {
  throw new Error(
    "playwright.config: FIREFOX_HEADED=1 but $DISPLAY is unset — headed Firefox needs a display. " +
      'Wrap the command in `xvfb-run -a --server-args="-screen 0 1280x1024x24" ...` (see ' +
      ".github/workflows/pages.yml), or unset FIREFOX_HEADED to run headless (no WebGL2 on linux).",
  );
}

// atlas-0 Deliverable 5: one smoke spec (shell paints, zero console errors) across the three
// engines. `webServer` builds then serves the real production bundle (`vite preview`), the same
// thing size-budget.mjs and check-relative-assets.mjs run against — not the dev server, which
// would exercise a different code path (unbundled, absolute /src/ URLs).

// `PW_PORT` moves the whole harness (baseURL + webServer) to another port, and never reuses a
// server it did not start. `npm run test:faults` (scripts/test-faults.mjs, atlas-8 step 3) needs
// exactly that: it applies a seeded fault in a throwaway `git worktree` and must run the gate
// against THAT tree's own build — reusing a `vite preview` already answering 4331 from the
// unpatched checkout would serve the wrong bytes and quietly pass. Unset, everything behaves
// exactly as before.
const PORT = process.env.PW_PORT ?? "4331";
const BASE_URL = `http://localhost:${PORT}/`;

export default defineConfig({
  // scoped to this directory only — the S1-S4 spike harnesses each run their own Playwright
  // config out of spikes/<n>/ on their own ports (4311-4314); this one never crawls spikes/**.
  testDir: "./e2e",
  // e2e/fixtures/** are standalone mini-projects (their own vite.config.ts, never reachable from
  // index.html's static graph — same idea as tests/fixtures/**, which vitest.config.ts
  // excludes the same way) with their OWN scoped Playwright config and webServer, run via their own
  // npm script — e2e/fixtures/analytics-privacy/ is the first of these. Without this, Playwright's
  // default recursive spec discovery would also try to run that spec here, against a webServer that
  // never starts its fixture build.
  testIgnore: ["fixtures/**"],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI && !process.env.PW_PORT,
    timeout: 120_000,
  },
  projects: [
    // species.timing.spec.ts is a COLD-load TIMING gate (atlas-8's rule: runs alone, gated on a
    // median of N >= 3 cold runs) — excluded here and picked up only by the "timing" project
    // below, so the three engine projects below never contend with it for CPU. A per-project
    // testIgnore REPLACES (does not merge with) this config's top-level testIgnore for that
    // project, so each list below repeats the top-level entries too.
    {
      name: "chromium",
      testIgnore: ["fixtures/**", "species.timing.spec.ts"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "webkit",
      testIgnore: ["fixtures/**", "species.timing.spec.ts"],
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "firefox",
      testIgnore: ["fixtures/**", "species.timing.spec.ts"],
      use: {
        ...devices["Desktop Firefox"],
        // 0.10.14: on a GPU-less ubuntu-latest runner Firefox BLOCKLISTS its software (llvmpipe)
        // GL driver, so `canvas.getContext("webgl2")` returns null and maplibre-gl throws
        // `GPUInitializationError: WebGL2 is required to display this map` before the map object
        // ever exists. That was 5 of the 9 reds in run 35819393922 -- every firefox spec that
        // waits on `window.__atlasMap`, `window.__atlasSpecies` or a rendered `.map-print img`,
        // plus the two shell-smoke "zero console errors" gates. It is invisible on macOS, where
        // Firefox gets a real accelerated context.
        //
        // `scripts/firefox-webgl-prefs.json` gives the runner's Firefox the SAME thing chromium
        // already has there (headless SwiftShader, see this file's atlas-8 note): a real,
        // software-rasterized WebGL2 context. Prefs alone are NOT enough -- unlike chromium,
        // Firefox uses the SYSTEM GL stack, so the runner also needs Mesa's DRI drivers
        // (`pages.yml` installs them and `scripts/check-webgl2.mjs` gates the result). None of
        // this relaxes an assertion: if WebGL2 still cannot be created, that gate goes red first.
        // ...and prefs are STILL not enough, because Playwright's Firefox has no WebGL at all in
        // HEADLESS mode on linux (measured, run 35823275862: with libgl1-mesa-dri installed,
        // `webgl.force-enabled` set and LIBGL_ALWAYS_SOFTWARE=1, `getContext("webgl2")` is still
        // null; chromium and webkit on the same runner are fine). The documented workaround is to
        // run Firefox HEADED under a virtual display -- `pages.yml` wraps the suite in
        // `xvfb-run`. Only on linux CI: a local macOS run stays headless.
        headless: !FIREFOX_HEADED,
        launchOptions: { firefoxUserPrefs: FIREFOX_WEBGL_PREFS },
      },
    },
    // the timing gate's own project (atlas-8's rule, see species.timing.spec.ts's header for the
    // full reasoning): `workers: 1` + `fullyParallel: false` cap concurrency WITHIN this project,
    // but do not by themselves stop chromium/webkit/firefox's workers running at the same time
    // inside one `npx playwright test` invocation — `dependencies` does: Playwright runs a project
    // only after the projects it depends on have FINISHED, so in a full run the timing gate starts
    // once chromium, webkit and firefox are done and the machine is quiet (measured 2026-09-23:
    // started concurrently it hit the 10 s predicate timeout; alone, medians of 1.5 s).
    // `npx playwright test --project=timing` still runs it on its own.
    {
      name: "timing",
      testMatch: "species.timing.spec.ts",
      dependencies: ["chromium", "webkit", "firefox"],
      workers: 1,
      fullyParallel: false,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
