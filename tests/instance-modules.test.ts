// The instance module table (scripts/instance-modules.mjs): instance.json's lenses, tools, pages,
// release and seal choose what a build includes. These cases pin the table against the type
// declarations, the source it generates for each instance, the per-instance test selection, the
// shell's one door to instance-only code, and the dist check every CI build runs
// (scripts/check-instance-dist.mjs), each with a seeded fault proving it can fail.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  MODULE_TABLE,
  allExportNames,
  instanceDefines,
  instanceFlags,
  instanceModulesSource,
  instanceTestExcludes,
  pageInputs,
  splitEntries,
  tableProblems,
} from "../scripts/instance-modules.mjs";
import { instanceDistProblems } from "../scripts/check-instance-dist-core.mjs";
import { listInstances, readInstance } from "../scripts/instance.mjs";

const OM = readInstance("oceanmetrics");
const MST = readInstance("marinesensitivity");
const DTS = readFileSync("src/vite-env.d.ts", "utf8");
const SHELL = readFileSync("src/shell/Shell.svelte", "utf8");

describe("the table and its type declarations agree", () => {
  it("src/vite-env.d.ts declares exactly the table's export names", () => {
    const block = DTS.slice(DTS.indexOf('declare module "virtual:instance-modules"'));
    const declared = [...block.matchAll(/export const (\w+):/g)].map((m) => m[1]).sort();
    expect(declared).toEqual(allExportNames());
  });

  it("every instance names only lenses, tools and pages the table has", () => {
    for (const id of listInstances()) expect(tableProblems(readInstance(id))).toEqual([]);
  });

  it("SEEDED FAULT: an instance naming a lens the table does not build is refused", () => {
    expect(tableProblems({ ...OM, lenses: [...OM.lenses, "uncertainty"] })).toEqual([
      'lenses: "uncertainty" has no module in the instance module table',
    ]);
    expect(() => instanceModulesSource({ ...OM, lenses: ["uncertainty"] }, "/r")).toThrow(
      /uncertainty/,
    );
    expect(tableProblems({ ...MST, pages: ["index", "gallery"] })).toEqual([
      'pages: "gallery" has no entry in the instance module table',
    ]);
  });
});

describe("the generated virtual:instance-modules", () => {
  it("oceanmetrics: the Collections lens eager, its components lazy, and none of the MST modules", () => {
    const src = instanceModulesSource(OM, "/r");
    expect(src).toContain(
      'export { createCollectionLens } from "/r/src/lens/collection/state.svelte.ts";',
    );
    expect(src).toContain(
      'export const loadCollection = () => import("/r/src/lens/collection/shell.ts");',
    );
    for (const name of ["loadScores", "loadReport", "loadRelease"]) {
      expect(src).toContain(`export const ${name} = null;`);
    }
    expect(src).not.toMatch(/lens\/scores|reportTool|release\/shell/);
  });

  it("marinesensitivity: the Scores lens, the Report tool and the release lazy, no Collections lens", () => {
    const src = instanceModulesSource(MST, "/r");
    expect(src).toContain('export const loadScores = () => import("/r/src/lens/scores/shell.ts");');
    expect(src).toContain('export const loadReport = () => import("/r/src/shell/reportTool.ts");');
    expect(src).toContain(
      'export const loadRelease = () => import("/r/src/lib/release/shell.ts");',
    );
    for (const name of ["createCollectionLens", "createPlaceSummaries", "loadCollection"]) {
      expect(src).toContain(`export const ${name} = null;`);
    }
    expect(src).not.toMatch(/lens\/collection/);
  });

  it("the pages are the instance's own entries", () => {
    expect(Object.keys(pageInputs(OM, "/r"))).toEqual(["index", "catalog"]);
    expect(pageInputs(MST, "/r")).toEqual({
      index: "/r/index.html",
      report: "/r/report.html",
    });
  });

  it("the build-time flags follow the instance", () => {
    expect(instanceFlags(OM)).toEqual({
      __LENS_SCORES__: false,
      __LENS_COLLECTION__: true,
      __TOOL_REPORT__: false,
      __RELEASE__: false,
      __SEAL__: false,
      __NAV__: true,
    });
    expect(instanceFlags(MST)).toEqual({
      __LENS_SCORES__: true,
      __LENS_COLLECTION__: false,
      __TOOL_REPORT__: true,
      __RELEASE__: true,
      __SEAL__: true,
      __NAV__: false,
    });
    expect(instanceDefines(MST).__RELEASE__).toBe("true");
  });
});

describe("each module's tests run under an instance that builds it", () => {
  it("oceanmetrics leaves out the Scores lens', the Report's, the release's and the seal's tests", () => {
    const ex = instanceTestExcludes(OM);
    for (const g of [
      "tests/lens/scores/**",
      "tests/lib/report/**",
      "tests/ui/sealVisibility.test.ts",
      "tests/**/*.mst.test.ts",
    ]) {
      expect(ex).toContain(g);
    }
    expect(ex).not.toContain("tests/lens/collection/**");
  });

  it("marinesensitivity leaves out the Collections lens' tests and nothing of its own", () => {
    const ex = instanceTestExcludes(MST);
    expect(ex).toContain("tests/lens/collection/**");
    expect(ex).not.toContain("tests/lens/scores/**");
    expect(ex).not.toContain("tests/lib/report/**");
  });

  it("every entry an instance does not select is excluded, and every entry is selected by some instance", () => {
    const all = listInstances().map((id) => splitEntries(readInstance(id)));
    for (const group of ["lenses", "tools", "capabilities"] as const) {
      for (const key of Object.keys(MODULE_TABLE[group])) {
        expect(
          all.some((s) => s.selected.some(([g, k]) => g === group && k === key)),
          `${group}.${key} is built by no instance`,
        ).toBe(true);
      }
    }
  });
});

describe("the shell reaches instance-only code through the table alone", () => {
  // the MST modules the table owns (scores lens, report, release registry, analysis): Shell.svelte
  // may not import them statically or dynamically; it gets them from `virtual:instance-modules`
  const OWNED_DIRS =
    /["'](\.\.\/lens\/(scores|collection)\/[^"']*|\.\.\/report\/[^"']*|\.\.\/lib\/analysis\/[^"']*|\.\.\/lib\/report\/[^"']*|\.\.\/lib\/release\/(?!mst)[^"']*|\.\/ReportPane\.svelte|\.\/reportTool)["']/g;

  /** the import specifiers of `src` that name a table-owned module (type-only imports allowed). */
  const ownedImports = (src: string) =>
    [
      ...src.matchAll(
        /(?:^|\n)\s*import\s(?!type\s)[^;]*?from\s+(["'][^"']+["'])|import\(\s*(["'][^"']+["'])\s*\)/g,
      ),
    ]
      .map((m) => m[1] ?? m[2])
      .filter((spec) => !!spec && new RegExp(OWNED_DIRS.source).test(spec));

  it("Shell.svelte imports no table-owned module, statically or dynamically", () => {
    expect(ownedImports(SHELL)).toEqual([]);
    expect(SHELL).toContain('from "virtual:instance-modules"');
  });

  it("SEEDED FAULT: a direct import of the Scores lens state is caught", () => {
    const seeded = SHELL.replace(
      '  import { LENS_LABEL } from "./lenses";',
      '  import { LENS_LABEL } from "./lenses";\n  import { createScoresLens } from "../lens/scores/state.svelte";',
    );
    expect(seeded).not.toBe(SHELL);
    expect(ownedImports(seeded)).toEqual(['"../lens/scores/state.svelte"']);
    expect(ownedImports('const m = await import("../report/data");')).toEqual(['"../report/data"']);
  });
});

// --- scripts/check-instance-dist.mjs, over synthetic dists -------------------------------------
const tmp = mkdtempSync(join(tmpdir(), "instance-dist-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** a minimal dist: the pages, a manifest naming `sources`, one JS chunk holding `text`. */
function fakeDist(name: string, pages: string[], sources: string[], text: string): string {
  const dir = join(tmp, name);
  mkdirSync(join(dir, ".vite"), { recursive: true });
  mkdirSync(join(dir, "assets"), { recursive: true });
  for (const p of pages) writeFileSync(join(dir, p), "<!doctype html>");
  const manifest = Object.fromEntries(sources.map((s) => [s, { file: "assets/x.js", src: s }]));
  writeFileSync(join(dir, ".vite", "manifest.json"), JSON.stringify(manifest));
  writeFileSync(join(dir, "assets", "x.js"), text);
  return dir;
}

const OM_TEXT = [`x='data-testid="collection-details"'`, "<om-nav", "om-nav-search"].join(";");
const MST_TEXT = [
  'data-testid="scores-legend"',
  'data-testid="report-subject-sentence"',
  "versions.json",
  "Prepared for the",
].join(";");

describe("check-instance-dist over synthetic dists", () => {
  it("passes a dist with exactly the instance's pages, sources and markers", () => {
    const om = fakeDist(
      "om",
      ["index.html", "catalog.html"],
      ["index.html", "src/lens/collection/shell.ts"],
      OM_TEXT,
    );
    expect(instanceDistProblems(om, OM)).toEqual([]);
    const mst = fakeDist(
      "mst",
      ["index.html", "report.html"],
      ["index.html", "src/lens/scores/shell.ts"],
      MST_TEXT,
    );
    expect(instanceDistProblems(mst, MST)).toEqual([]);
  });

  it("SEEDED FAULT: an oceanmetrics dist carrying a Scores lens chunk and its marker fails", () => {
    const bad = fakeDist(
      "om-bad",
      ["index.html", "catalog.html"],
      ["index.html", "src/lens/scores/ScoresLegend.svelte"],
      `${OM_TEXT};data-testid="scores-legend"`,
    );
    expect(instanceDistProblems(bad, OM)).toEqual([
      "lenses.scores: src/lens/scores/ScoresLegend.svelte is in the build",
      'lenses.scores: its marker "data-testid="scores-legend"" is in assets/x.js',
    ]);
  });

  it("SEEDED FAULT: a dist missing a selected module's marker, or a page, fails", () => {
    const bad = fakeDist(
      "mst-bad",
      ["index.html"],
      ["index.html"],
      "versions.json;Prepared for the",
    );
    expect(instanceDistProblems(bad, MST)).toEqual([
      "page report.html is missing",
      'lenses.scores: its marker "data-testid="scores-legend"" is not in the build',
      'tools.report: its marker "data-testid="report-subject-sentence"" is not in the build',
    ]);
  });

  it("SEEDED FAULT: the Ocean Metrics bar in a marinesensitivity dist, or missing from an oceanmetrics one, fails", () => {
    // shell.css's `om-nav:not(:defined)` and the tokens' `--om-navy` are in every dist and are no marker
    const clean = `${MST_TEXT};om-nav:not(:defined){display:block};--om-navy:#102a43`;
    const mst = fakeDist(
      "mst-nav",
      ["index.html", "report.html"],
      ["index.html", "src/lens/scores/shell.ts"],
      clean,
    );
    expect(instanceDistProblems(mst, MST)).toEqual([]);
    const bad = fakeDist(
      "mst-nav-bad",
      ["index.html", "report.html"],
      ["index.html", "src/lens/scores/shell.ts"],
      `${clean};<om-nav current="atlas">;om-nav-search`,
    );
    expect(instanceDistProblems(bad, MST)).toEqual([
      'capabilities.nav: its marker "<om-nav" is in assets/x.js',
      'capabilities.nav: its marker "om-nav-search" is in assets/x.js',
    ]);
    const none = fakeDist(
      "om-nav-none",
      ["index.html", "catalog.html"],
      ["index.html", "src/lens/collection/shell.ts"],
      `x='data-testid="collection-details"'`,
    );
    expect(instanceDistProblems(none, OM)).toEqual([
      'capabilities.nav: its marker "<om-nav" is not in the build',
      'capabilities.nav: its marker "om-nav-search" is not in the build',
    ]);
  });

  it("a page the instance does not publish is a problem", () => {
    const extra = fakeDist(
      "om-extra",
      ["index.html", "catalog.html", "report.html"],
      ["index.html"],
      OM_TEXT,
    );
    expect(instanceDistProblems(extra, OM)).toContain(
      "page report.html is built but the instance does not publish it",
    );
  });
});
