/// <reference types="vite/client" />

/** injected by `vite.config.ts`'s `define` — `package.json`'s `version`, as a string literal
 * inlined at build time (see that file's comment on why NOT a runtime `import` of package.json). */
declare const __APP_VERSION__: string;

/** injected by `vite.config.ts`'s `define` — `git rev-parse --short HEAD` at build time, or
 * `"unknown"` when git is unavailable (atlas-8 Deliverable 4: the "Report a problem" issue body). */
declare const __APP_SHA__: string;

/** injected by `vite.config.ts`'s `define` — the code's repository, "owner/name", from `package.json`
 * `repository` (the About dialog's app line). */
declare const __APP_SOURCE__: string;

/** the instance's build-time flags (`vite.config.ts` `define`, scripts/instance-modules.mjs
 * `instanceFlags`): an instance-only branch guarded by one is dropped from a build without it. */
declare const __LENS_SCORES__: boolean;
declare const __LENS_COLLECTION__: boolean;
declare const __TOOL_REPORT__: boolean;
declare const __RELEASE__: boolean;
declare const __SEAL__: boolean;
declare const __NAV__: boolean;

// the instance's mark (vite.config.ts's atlas-instance plugin, from instances/<id>/<mark>.svg): its
// viewBox and the markup inside the root <svg>, inlined by src/lib/brand/Mark.svelte.
declare module "virtual:instance-mark" {
  const mark: { viewBox: string; body: string };
  export default mark;
}

// the instance module table (scripts/instance-modules.mjs, served by vite.config.ts and
// vitest.config.ts): each export is the real module (eager), a loader (lazy) or `null` when the
// instance does not build it. tests/instance-modules.test.ts keeps these names equal to the table's.
declare module "virtual:instance-modules" {
  /** the Collections lens' reactive core (eager: its map inputs exist before any panel mounts). */
  export const createCollectionLens:
    typeof import("./lens/collection/state.svelte").createCollectionLens | null;
  /** the per-place summaries of the Collections lens' current item (eager, with that lens). */
  export const createPlaceSummaries:
    typeof import("./places/summary.svelte").createPlaceSummaries | null;
  /** the Collections lens' components (lazy). */
  export const loadCollection: (() => Promise<typeof import("./lens/collection/shell")>) | null;
  /** the Scores lens: everything the shell reads from it (lazy). */
  export const loadScores: (() => Promise<typeof import("./lens/scores/shell")>) | null;
  /** the Report tool: its pane and the subject rules (lazy). */
  export const loadReport: (() => Promise<typeof import("./shell/reportTool")>) | null;
  /** the release registry: the zone units and the release picker (lazy). */
  export const loadRelease: (() => Promise<typeof import("./lib/release/shell")>) | null;
}
