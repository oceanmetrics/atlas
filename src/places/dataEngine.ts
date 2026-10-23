// places/dataEngine.ts -- the ONE lazily-created DuckDB engine + AnalysisSources this panel uses,
// for BOTH the upload/coordinate pipeline's "must touch the study area" hook (Deliverable 4 rule
// 10) and Deliverable 5's results, so a place is never booted twice.
//
// `@duckdb/duckdb-wasm` is a forbidden STATIC marker (CLAUDE.md) because `lib/engine/engine.ts`
// itself statically imports the real bundle loader (`bundles.ts`) -- so `Engine` the CLASS is
// reached only through this module's own dynamic `import()`, the same discipline draw.ts/coords.ts
// already follow for terra-draw/geo-upload. `AnalysisSources` has no such cost (its only reference
// to `Engine` is `import type`, per its own module header) and stays a static import.
//
// `analysis/templates.ts` (`TEMPLATES`) is ALSO dynamic here, for a related but different reason:
// it embeds every `sql/*.sql` FILE VERBATIM via `?raw` (so the browser runs the exact bytes a
// reviewer reads), and those files' own comments happen to say "treemap" (composition.sql/
// species_shares.sql, describing the unrelated species-composition UI) -- which is coincidentally
// one of `scripts/size-budget-core.mjs`'s FORBIDDEN_LAZY_MARKERS, tripping the same content scan a
// static import of it once did (measured, before this fix). Keeping the whole SQL-embedding module
// out of the static graph is the same fix as duckdb/terra-draw's: correct regardless of the
// coincidence, since none of this belongs on the critical path anyway.
//
// Data URLs are built from `release/dataBase.ts`'s `dataUrl()` -- the ONE place a release URL is
// formed (CLAUDE.md) -- for the PUBLIC path only (`session` omitted): a restricted/preview release
// needs `session.data`, which is release/access.ts's concern and out of this phase's scope (no
// release the study-area check or results run against here is ever restricted from this panel's
// own reach -- see the module's `buildDataUrl` doc for the exact limitation).
import { AnalysisSources } from "../lib/analysis/sources";
import { dataUrl } from "../lib/release/dataBase";
import { gridFromBoot, type GridSpec } from "../lib/grid/grid";
import type { Engine as EngineType } from "../lib/engine/engine";

export interface DataEngineContext {
  engine: EngineType;
  sources: AnalysisSources;
  grid: GridSpec;
}

export interface DataEngineOptions {
  ver: string;
  boot: Record<string, unknown>;
}

/** the public-release URL builder `AnalysisSources` needs -- see the module header for the
 * preview-session limitation. */
export function buildDataUrl(ver: string): (path: string) => string {
  return (path: string) => dataUrl(ver, path);
}

let cached: { key: string; ctx: Promise<DataEngineContext> } | null = null;

function keyOf(opts: DataEngineOptions): string {
  return `${opts.ver}:${String(opts.boot.built_at ?? "")}`;
}

/**
 * The cached engine + sources for `opts` -- booted once per (version, `built_at`) pair; a release
 * switch (a different `ver`, or the SAME `ver` re-published with a new `built_at`) boots a fresh
 * one automatically rather than serving stale tables.
 */
export async function getDataEngine(opts: DataEngineOptions): Promise<DataEngineContext> {
  const key = keyOf(opts);
  if (cached?.key === key) return cached.ctx;
  const ctx = boot(opts);
  cached = { key, ctx };
  return ctx;
}

/** drop the cached engine (tests, or an explicit "start over"); the next `getDataEngine()` boots a
 * fresh one. */
export function resetDataEngine(): void {
  cached = null;
}

async function boot(opts: DataEngineOptions): Promise<DataEngineContext> {
  const [{ Engine }, { TEMPLATES }] = await Promise.all([
    import("../lib/engine/engine"),
    import("../lib/analysis/templates"),
  ]);
  const engine = new Engine({});
  const grid = gridFromBoot(opts.boot);
  const sources = new AnalysisSources(engine, {
    url: buildDataUrl(opts.ver),
    boot: opts.boot,
    templates: TEMPLATES,
  });
  await sources.coreTables();
  return { engine, sources, grid };
}
