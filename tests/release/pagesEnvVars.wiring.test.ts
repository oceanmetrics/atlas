// round 2, Q4 (moved with the release registry from MarineSensitivity/atlas): proves the build-time
// flags reach the PUBLISHED marinesensitivity build. That build is now made by this repository's
// reusable `.github/workflows/build-instance.yml`, called from MarineSensitivity/atlas's thin
// `pages.yml` (drafted in docs/mst-thin-repo.md). There is no way to run either workflow here, so this
// scans both files -- the same approach `tests/report/windowOpenSync.wiring.test.ts` and
// `tests/raster/ramps.wiring.test.ts` use for their own "is X really wired" gates. A build that
// silently drops a var ships a feedback control that can never send (src/lib/feedback/endpoint.ts), a
// preview-host Atlas link pointed at a route not deployed yet (src/lib/release/previewLink.ts), or no
// seal.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../..");
const BUILD_YML = readFileSync(join(ROOT, ".github/workflows/build-instance.yml"), "utf8");
const THIN_DOC = readFileSync(join(ROOT, "docs/mst-thin-repo.md"), "utf8");

/** the thin repo's `pages.yml`, the first ```yaml block of docs/mst-thin-repo.md. */
function thinPagesYml(): string {
  const m = THIN_DOC.match(/```yaml\n([\s\S]*?)```/);
  if (!m) throw new Error("docs/mst-thin-repo.md: no ```yaml block (the thin repo's pages.yml)");
  return m[1];
}

/** the ONE `npx vite build` step of build-instance.yml (up to the next step marker). */
function viteBuildStepBlock(): string {
  const idx = BUILD_YML.indexOf("- run: npx vite build");
  if (idx === -1) throw new Error("build-instance.yml: no `npx vite build` step found");
  const rest = BUILD_YML.slice(idx);
  const nextStepOffset = rest.slice(1).search(/\n {6}- (run|uses|name|if|id):/);
  return nextStepOffset === -1 ? rest : rest.slice(0, nextStepOffset + 1);
}

const VARS = [
  "VITE_FEEDBACK_URL",
  "VITE_LOG_URL",
  "VITE_GA_ID",
  "VITE_PREVIEW_ATLAS_ROUTE",
] as const;

describe("build-instance.yml: the one build passes every VITE_* input through", () => {
  const block = viteBuildStepBlock();

  it("declares each as a workflow_call input and hands it to `vite build`", () => {
    for (const v of [...VARS, "VITE_CATALOG_BASE", "VITE_SEAL"]) {
      expect(BUILD_YML).toMatch(new RegExp(`\\n {6}${v}:\\n {8}description:`));
      expect(block).toMatch(new RegExp(`${v}:\\s*\\$\\{\\{\\s*inputs\\.${v}\\s*\\}\\}`));
    }
  });

  it("builds the instance it is asked for", () => {
    expect(BUILD_YML).toMatch(/VITE_INSTANCE:\s*\$\{\{\s*inputs\.instance\s*\}\}/);
  });
});

describe("the thin repo's pages.yml (docs/mst-thin-repo.md) feeds that build", () => {
  const yml = thinPagesYml();

  it("passes every repository variable through, by name", () => {
    for (const v of VARS) {
      expect(yml).toMatch(new RegExp(`${v}:\\s*\\$\\{\\{\\s*vars\\.${v}\\s*\\}\\}`));
    }
  });

  it("turns the seal on (the agency and its image are the instance's `seal`, no VITE_AGENCY)", () => {
    expect(yml).toMatch(/VITE_SEAL:\s*"1"/);
    expect(yml).not.toMatch(/VITE_AGENCY/);
  });

  it("builds the marinesensitivity instance at ONE tag: the uses pin and ref agree", () => {
    const uses = yml.match(
      /uses: oceanmetrics\/atlas\/\.github\/workflows\/build-instance\.yml@(\S+)/,
    );
    const ref = yml.match(/\n\s+ref: (\S+)/);
    expect(uses?.[1]).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(ref?.[1]).toBe(uses?.[1]);
    expect(yml).toMatch(/instance: marinesensitivity/);
    expect(yml).toMatch(/deploy: true/);
  });
});

describe("build-instance.yml: deploy ships the build job's OWN artifact, never a second build", () => {
  it("the deploy job needs [build], downloads its artifact and never runs vite build", () => {
    const deployBlock = BUILD_YML.slice(BUILD_YML.indexOf("\n  deploy:"));
    expect(deployBlock).toMatch(/needs:\s*\[build\]/);
    expect(deployBlock).not.toMatch(/vite build/);
    expect(deployBlock).toMatch(/download-artifact/);
  });
});
