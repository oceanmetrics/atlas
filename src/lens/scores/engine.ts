// atlas-4 step 2 — the lazy DuckDB-WASM boot, reached ONLY through dynamic `import()` (CLAUDE.md's
// budget rules: "the whole analysis layer is reached only through a dynamic import() from a
// lens, like duckdb itself" — `analysis/templates.ts`'s own header). This module is the ONE place
// the scores lens crosses into the engine; every caller (a cell click, opening the species table)
// goes through `getAnalysisSources()`, which is memoised per release so a second click reuses the
// same booted engine and registered tables instead of re-fetching them.
import type { Engine as EngineType } from "../../lib/engine/engine";
import type { AnalysisSources as AnalysisSourcesType } from "../../lib/analysis/sources";

interface Modules {
  Engine: typeof EngineType;
  AnalysisSources: typeof AnalysisSourcesType;
  templates: AnalysisSourcesType["templates"];
  dataUrl: (ver: string, path: string) => string;
}

let modulesPromise: Promise<Modules> | null = null;

function loadModules(): Promise<Modules> {
  if (!modulesPromise) {
    modulesPromise = Promise.all([
      import("../../lib/engine/engine"),
      import("../../lib/analysis/sources"),
      import("../../lib/analysis/templates"),
      import("../../lib/release/dataBase"),
    ]).then(([engineMod, sourcesMod, templatesMod, dataBaseMod]) => ({
      Engine: engineMod.Engine,
      AnalysisSources: sourcesMod.AnalysisSources,
      templates: templatesMod.TEMPLATES,
      // public-host data origin only (this phase does not thread a preview `session` through the
      // shell into the engine yet — see the atlas-4 report's "could not satisfy" list).
      dataUrl: (ver: string, path: string) => dataBaseMod.dataUrl(ver, path, null),
    }));
  }
  return modulesPromise;
}

// P6c (orchestrator, 2026-09-24): memoize the IN-FLIGHT PROMISE, not just its resolved value.
// `sel` is now written EAGERLY on click (`state.svelte.ts#handleMapClick`'s own header has the
// regression this fixes), which makes it routine for TWO callers to reach this function around the
// same moment -- the click's own `showCellPopup` value fetch AND `ScoresLens.svelte`'s
// `cellFlowerRows` effect, which reacts to `sel` changing to `kind: "cell"` the instant it is
// written, not once a value has already resolved. The old code checked the RESOLVED `sources`
// synchronously (`if (sources && sourcesVer === ver) return sources`) and awaited `loadModules()`
// (itself correctly promise-memoized) before ever assigning `sources` -- so two concurrent callers
// for the SAME `ver`, both arriving before the first had finished, each saw `sources` still `null`
// and each built its OWN `new Engine()`, racing to install DuckDB-WASM's `parquet` extension
// independently (observed failure: "Extension Autoloading Error ... parquet"). Memoizing the
// PROMISE closes that gap: a second concurrent caller awaits the SAME in-flight boot instead of
// starting a second one.
let sourcesPromise: Promise<AnalysisSourcesType> | null = null;
let sourcesPromiseVer: string | null = null;

/**
 * The current release's `AnalysisSources`, booting the engine on first call and reusing it for
 * every later one AS LONG AS `ver` has not changed (a version switch tears down and rebuilds —
 * the old engine's registered tables belong to a different release's grid/schema). Safe to call
 * concurrently: every caller for the same `ver` shares the SAME boot, never a second engine.
 */
export function getAnalysisSources(
  ver: string,
  boot: Record<string, unknown>,
): Promise<AnalysisSourcesType> {
  // #9: never build (and so never memoise) sources over a missing boot -- a promise cached for
  // `ver` with `boot = null` would fail every later call for that release, even once boot arrived.
  if (!boot) return Promise.reject(new Error("the release's boot.json has not loaded yet"));
  if (sourcesPromise && sourcesPromiseVer === ver) return sourcesPromise;
  // the boot this call supersedes (a real version switch, or `null` on the very first call) —
  // captured now, before `sourcesPromise` is overwritten below, and disposed only once the NEW
  // boot has actually finished (never torn down while something might still be using it, and
  // never awaited before returning — disposal is a fire-and-forget cleanup, not on the critical
  // path of handing the caller its new sources).
  const superseded = sourcesPromiseVer !== ver ? sourcesPromise : null;
  const promise = (async () => {
    const { Engine, AnalysisSources, templates, dataUrl } = await loadModules();
    const engine = new Engine();
    const next = new AnalysisSources(engine, {
      url: (path) => dataUrl(ver, path),
      boot,
      templates,
    });
    if (superseded) {
      void superseded.then(
        (prev) => prev.engine.dispose().catch(() => {}),
        () => {}, // the superseded boot never even finished -- nothing to dispose
      );
    }
    return next;
  })();
  sourcesPromise = promise;
  sourcesPromiseVer = ver;
  return promise;
}
