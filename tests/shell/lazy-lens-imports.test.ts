// D13: Shell.svelte once statically imported every lens' panel component -- over
// `scripts/size-budget.mjs`'s 450 KB budget, and a species-only deep link downloaded the entire
// other lens it never renders. The fix moved every
// `.svelte` PANEL component under `src/lens/**` and `src/places/**` behind a dynamic `import()`,
// chosen by `sel.lens` (Places by `activeTool === "places"`) -- see Shell.svelte's own "lazy
// lens/panel chunks" header comment. This is the SAME source-scan technique
// `tests/places/lazyImports.test.ts` and `tests/geo/upload/lazyImports.test.ts` already use for
// terra-draw/the upload parsers: `npm run build && npm run size-budget` can only prove this AFTER a
// real build; this proves the rule holds in the source, so a re-added static import goes red before
// a build is ever needed to notice.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SHELL_PATH = "src/shell/Shell.svelte";
const SHELL_SVELTE = readFileSync(SHELL_PATH, "utf8");
const SHELL_DIR = dirname(fileURLToPath(new URL(`../../${SHELL_PATH}`, import.meta.url)));

/** `import ... from "x"` / `import "x"` at the top level -- NOT `import type` (erased under
 * `verbatimModuleSyntax`, costs nothing at runtime) and NOT `await import("x")`. Same regex as
 * `tests/places/lazyImports.test.ts`/`tests/geo/upload/lazyImports.test.ts`. */
const staticImportsOf = (src: string): string[] =>
  [...src.matchAll(/(?:^|\n)\s*import\s(?!type\s)(?:[^;'"]*?\sfrom\s)?["']([^"']+)["']/g)].map(
    (m) => m[1],
  );

const dynamicImportsOf = (src: string): string[] =>
  [...src.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);

/** a REAL `.svelte` SFC component reached from `src/lens/**` or `src/places/**` -- as opposed to a
 * plain, runes-using data/wiring module named `*.svelte.ts` (e.g. `state.svelte.ts`,
 * `placesMap.svelte.ts`), whose import specifier ALSO ends in literal ".svelte" once TypeScript's
 * extension is dropped. Disambiguated on disk: an SFC resolves to `<spec>` itself; a `*.svelte.ts`
 * module resolves to `<spec>.ts` instead. Shell.svelte's own header comment explains why the
 * latter is allowed to stay static (needed before a lens' panel component ever mounts, and it
 * never imports a `.svelte` SFC itself). */
const isLensOrPlacesSvelteImport = (spec: string): boolean => {
  if (!/^\.\.\/(lens|places)\//.test(spec) || !spec.endsWith(".svelte")) return false;
  const resolved = resolve(SHELL_DIR, spec);
  return existsSync(resolved) && !existsSync(`${resolved}.ts`);
};

describe("Shell.svelte never statically imports a lens/places .svelte panel component", () => {
  it("Shell.svelte source scan finds nothing (a missing file must not pass vacuously)", () => {
    expect(SHELL_SVELTE.length).toBeGreaterThan(1000);
  });

  it("no static import of a .svelte file under src/lens/ or src/places/", () => {
    const statics = staticImportsOf(SHELL_SVELTE).filter(isLensOrPlacesSvelteImport);
    expect(statics, `statically imports: ${statics.join(", ")}`).toEqual([]);
  });

  it("every lens/places panel component IS reached, but only dynamically", () => {
    const dynamic = dynamicImportsOf(SHELL_SVELTE);
    for (const mod of [
      "../lens/species/SpeciesLens.svelte",
      "../lens/species/SpeciesPicker.svelte",
      "../lens/species/SpeciesLegend.svelte",
      "../lens/species/NotFoundModal.svelte",
      "../places/Places.svelte",
    ]) {
      expect(dynamic, `Shell.svelte never dynamically imports ${mod}`).toContain(mod);
    }
  });

  // the pure data/wiring modules a lens' panel component needs BEFORE it loads are allowed to stay
  // static -- Shell.svelte's own header comment on `createSpeciesLens`/`createPlacesMapStore`.
  it("the species/places data-layer modules stay static (not svelte files, so not gated here)", () => {
    const statics = staticImportsOf(SHELL_SVELTE);
    expect(statics).toContain("../lens/species/state.svelte");
    expect(statics).toContain("../places/placesMap.svelte");
  });

  it("SEEDED FAULT: the same scan flags a reintroduced static import of SpeciesLens.svelte", () => {
    const seeded =
      'import SpeciesLens from "../lens/species/SpeciesLens.svelte";\nexport const x = SpeciesLens;\n';
    const statics = staticImportsOf(seeded).filter(isLensOrPlacesSvelteImport);
    expect(statics).toContain("../lens/species/SpeciesLens.svelte");
  });
});
