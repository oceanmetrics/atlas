// places/engine.ts -- the ONE lazily-created DuckDB-WASM engine the Places panel uses, today only
// for GeoPackage upload (`lib/geo/upload/engineRuntime.ts` reads a `.gpkg` through it).
//
// `@duckdb/duckdb-wasm` is a forbidden STATIC marker (CLAUDE.md) because `lib/engine/engine.ts`
// itself statically imports the real bundle loader (`bundles.ts`) -- so `Engine` the CLASS is
// reached only through this module's own dynamic `import()`, the same discipline draw.ts/coords.ts
// follow for terra-draw/geo-upload. This file imports the type only.
import type { Engine as EngineType } from "../lib/engine/engine";

let cached: Promise<EngineType> | null = null;

/** the cached engine, booted on first use. */
export function getPlacesEngine(): Promise<EngineType> {
  cached ??= import("../lib/engine/engine").then(({ Engine }) => new Engine({}));
  return cached;
}

/** drop the cached engine (tests, or an explicit "start over"). */
export function resetPlacesEngine(): void {
  cached = null;
}
