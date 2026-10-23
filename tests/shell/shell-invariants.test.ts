// atlas-3 step 3: repo-shaped invariants for the shell that can't be expressed as an ordinary
// input/output unit test -- the same source-scanning technique tests/state/invariants.test.ts
// already uses for sel.svelte.ts (a real `history.pushState` call can't be observed by invoking
// code under vitest's node environment; reading whether the source calls it is the available
// proxy, and e2e/shell.url-state.spec.ts covers the real-browser version of the same rule).
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  instanceHtmlExtras,
  loadInstance,
  readMark,
  renderInstanceHtml,
} from "../../scripts/instance.mjs";

const INSTANCE_JSON = loadInstance();

const INDEX_HTML = readFileSync("index.html", "utf8");
const MAIN_TS = readFileSync("src/main.ts", "utf8");
const SHELL_SVELTE = readFileSync("src/shell/Shell.svelte", "utf8");
const TOOLS_TS = readFileSync("src/shell/tools.ts", "utf8");
// R2 (docs/usability.md §7, U1): About/Feedback/the phone ⋯ menu live in their OWN component, not
// inline in Shell.svelte (this round's own instructions: a new file so U5/U6 stay additive) --
// its data-control/data-tour anchors are still part of "the shell", so the round-trip check below
// reads it alongside Shell.svelte, never JUST Shell.svelte on its own.
const TOP_BAR_ACTIONS_SVELTE = readFileSync("src/shell/TopBarActions.svelte", "utf8");

describe('the shell never calls history.pushState -- only src/lib/state\'s replaceState does (CLAUDE.md "URL-is-the-view")', () => {
  it("src/main.ts never calls .pushState(", () => {
    expect(MAIN_TS).not.toMatch(/\.pushState\s*\(/);
  });

  it("src/shell/Shell.svelte never calls .pushState( -- every write goes through selStore", () => {
    expect(SHELL_SVELTE).not.toMatch(/\.pushState\s*\(/);
  });

  it("index.html's inline scripts never call .pushState(", () => {
    expect(INDEX_HTML).not.toMatch(/\.pushState\s*\(/);
  });

  it("Shell.svelte writes view state only through selStore.set/.replace, never history.* directly", () => {
    expect(SHELL_SVELTE).not.toMatch(/\bhistory\.(replaceState|pushState)\s*\(/);
  });
});

describe("src/shell/* reaches a release through the pinned seam or the early-fetch results only", () => {
  // without a release registry the Species lens reads one fixed MarineSensitivity release:
  // Shell.svelte gets its version and boot bundle ONLY through src/lib/release/mst.ts, never by
  // importing the other release modules (dataBase/boot) itself. An instance WITH a registry
  // (instance.json `release`) has the inline early-fetch script resolve the release before any bundle
  // parses; the shell only READS its results off window.__early, after the `__RELEASE__` guard.
  it("Shell.svelte imports from src/lib/release/mst only", () => {
    const imports = [...SHELL_SVELTE.matchAll(/from\s+["']\.\.\/lib\/release\/([^"']+)["']/g)].map(
      (m) => m[1],
    );
    expect(imports.length).toBeGreaterThan(0);
    for (const i of imports) expect(i).toBe("mst");
  });

  it("Shell.svelte reads window.__early only past the release guard; TopBarActions never", () => {
    const reads = [
      ...SHELL_SVELTE.matchAll(/\(window as unknown as \{ __early\?: Early \}\)\.__early/g),
    ];
    expect(reads).toHaveLength(1);
    const before = SHELL_SVELTE.slice(0, reads[0].index);
    // the closest guard above the one read returns early for an instance without a release
    expect(before.slice(before.lastIndexOf("if (!__RELEASE__)"))).toMatch(
      /^if \(!__RELEASE__\) \{[\s\S]*?return;\s*\}\s*const early = $/,
    );
    expect(TOP_BAR_ACTIONS_SVELTE).not.toMatch(/__early/);
  });

  it("tools.ts does not import from src/lib/release, geo, grid, engine, raster or analytics", () => {
    expect(TOOLS_TS).not.toMatch(
      /from\s+["']\.\.\/lib\/(release|geo|grid|engine|raster|analytics)/,
    );
  });
});

describe("Shell.svelte owns no scoped <style> of its own for shell layout", () => {
  // every geometry value the CLS gate depends on lives in ONE file, src/shell/shell.css, imported
  // as a plain global stylesheet by both index.html's inline critical CSS and this component --
  // a component-scoped <style> block here would be a second place a shell layout value could be
  // typed, and could silently drift from the skeleton's copy.
  it("has no <style> block", () => {
    expect(SHELL_SVELTE).not.toMatch(/<style[\s>]/);
  });
});

function dataAttrValues(source: string, attr: string): string[] {
  return [...source.matchAll(new RegExp(`${attr}="([^"]+)"`, "g"))].map((m) => m[1]);
}

// the skeleton as the build writes it for this instance (scripts/instance.mjs fills the instance
// blocks: an instance with a release gets the version chip), and the hydrated controls this instance
// renders (the chip is the shell's one release-only control)
const RENDERED_INDEX = renderInstanceHtml(
  INDEX_HTML,
  INSTANCE_JSON,
  readMark(INSTANCE_JSON),
  instanceHtmlExtras(INSTANCE_JSON),
);
const RELEASE_ONLY = new Set(INSTANCE_JSON.release ? [] : ["version-chip"]);
const hydratedValues = (attr: string) =>
  new Set(
    [...dataAttrValues(SHELL_SVELTE, attr), ...dataAttrValues(TOP_BAR_ACTIONS_SVELTE, attr)].filter(
      (v) => !RELEASE_ONLY.has(v),
    ),
  );

describe("the skeleton and the hydrated shell agree on every data-control/data-tour anchor", () => {
  it("every data-control in the skeleton also appears in Shell.svelte + TopBarActions.svelte, and vice versa", () => {
    const skeleton = new Set(dataAttrValues(RENDERED_INDEX, "data-control"));
    const hydrated = hydratedValues("data-control");
    expect([...skeleton].sort()).toEqual([...hydrated].sort());
    expect(skeleton.size).toBeGreaterThan(0);
  });

  it("every data-tour anchor in the skeleton also appears in Shell.svelte + TopBarActions.svelte, and vice versa", () => {
    const skeleton = new Set(dataAttrValues(RENDERED_INDEX, "data-tour"));
    const hydrated = hydratedValues("data-tour");
    expect([...skeleton].sort()).toEqual([...hydrated].sort());
    expect(skeleton.size).toBeGreaterThan(0);
  });
});

// a shipped app must not log diagnostics on every click: this scan keeps `console.log` out of lenses.
describe("src/lens/** never ships a console.log(", () => {
  it("no console.log( appears in any src/lens/**/*.{ts,svelte} file", () => {
    const files = (readdirSync("src/lens", { recursive: true }) as string[]).filter((f) =>
      /\.(ts|svelte)$/.test(f),
    );
    const offenders = files.filter((f) =>
      /console\.log\(/.test(readFileSync(`src/lens/${f}`, "utf8")),
    );
    expect(offenders).toEqual([]);
    expect(files.length).toBeGreaterThan(4); // not vacuous
  });
});
