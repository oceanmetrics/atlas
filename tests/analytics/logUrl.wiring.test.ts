// round 2, Q7: proves the Sheet-log beacon is actually WIRED, not just documented.
// `docs/analytics.md` claimed setting the repository variable `VITE_LOG_URL` was enough -- false
// when `createAnalytics({...})` never passed a `logUrl` and `pages.yml` never forwarded the variable
// into `npx vite build`. This source-scans the sites directly (there is no way to run a `.svelte`
// component or a GitHub Actions workflow here), so a regression goes red even though
// `analyticsLogUrl()` itself (logUrl.test.ts) stays green in isolation.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../..");

describe("the Sheet-log beacon's logUrl is wired end to end (round 2, Q7)", () => {
  it("Shell.svelte passes logUrl: analyticsLogUrl() to createAnalytics()", () => {
    const src = readFileSync(join(ROOT, "src/shell/Shell.svelte"), "utf8");
    expect(src).toMatch(/logUrl:\s*analyticsLogUrl\(/);
  });

  it("Shell.svelte passes the module's GA leg of analyticsGaId() to createAnalytics() (GA stays config-driven)", () => {
    // the id goes to ONE side (gaLegs): the Ocean Metrics bar on an instance with it, this module on one
    // without it (tests/nav.test.ts holds the bar's side)
    const src = readFileSync(join(ROOT, "src/shell/Shell.svelte"), "utf8");
    expect(src).toMatch(/const GA = gaLegs\(analyticsGaId\(\),/);
    expect(src).toMatch(/measurementId:\s*GA\.module/);
  });

  it("pages.yml forwards VITE_LOG_URL from the repository variable into the published build", () => {
    // the oceanmetrics leg of the build matrix gets this repository's variable; the one build
    // (build-instance.yml) hands its input to `vite build`
    const pagesYml = readFileSync(join(ROOT, ".github/workflows/pages.yml"), "utf8");
    expect(pagesYml).toMatch(
      /VITE_LOG_URL:\s*\$\{\{\s*matrix\.instance == 'oceanmetrics' && vars\.VITE_LOG_URL \|\| ''\s*\}\}/,
    );
    const buildYml = readFileSync(join(ROOT, ".github/workflows/build-instance.yml"), "utf8");
    expect(buildYml).toMatch(/VITE_LOG_URL:\s*\$\{\{\s*inputs\.VITE_LOG_URL\s*\}\}/);
  });
});
