// tests/analysis/nodeEngine.ts -- the REAL `Engine` (its promise chain, its `MemoryTableStore`
// bookkeeping, `AnalysisSources`, the `sql/*.sql` twins) over a REAL DuckDB, under plain vitest.
//
// usability B1 needed this: the place-analysis race lives BETWEEN statements (two analyses
// interleaving on one connection), so a stub `SqlRunner` that pattern-matches SQL cannot show it --
// only a real catalog can hold `place_cell` twice over. `docs/engine.md` records that the browser
// worker needs a real browser; what runs here is the same pinned `@duckdb/duckdb-wasm@1.32.0` (the
// same `v1.4.3` engine, the same `duckdb-eh.wasm`) through its in-process node build
// (`@duckdb/duckdb-wasm/blocking`), with ONE substitution each, both stated:
//
// - the connection answers every query after a macrotask (`setImmediate`), standing in for the
//   worker's `postMessage` round trip -- so two analyses advance statement by statement exactly as
//   they do in a tab, and the interleaving is deterministic (FIFO timers, no real I/O);
// - tiles are CSV, read with `read_csv`, because `read_parquet` autoloads the parquet extension
//   (a network fetch, or the gitignored `public/duckdb-ext/` mirror that CI's `checks` job has not
//   fetched yet when vitest runs). `CsvTableStore` is `MemoryTableStore` with ONLY `ref()` changed;
//   every view `AnalysisSources` builds is otherwise the app's own, byte for byte.
import { createRequire } from "node:module";
import path from "node:path";
import * as duckdb from "@duckdb/duckdb-wasm/blocking";
import { Engine, type DuckDBConnLike, type DuckDBHandleLike } from "../../src/lib/engine/engine";
import { MemoryTableStore } from "../../src/lib/engine/store/memoryStore";
import type { TableRef } from "../../src/lib/engine/store/TableStore";
import { lit } from "../../src/lib/engine/sql";

const require = createRequire(import.meta.url);

export type NodeDuckdb = Awaited<ReturnType<typeof duckdb.createDuckDB>>;

/** instantiating the wasm module costs seconds, so a test file does it ONCE and resets the catalog
 * per engine (`reset()` drops every table and view and invalidates old connections). */
export async function instantiateNodeDuckdb(): Promise<NodeDuckdb> {
  const dist = path.dirname(require.resolve("@duckdb/duckdb-wasm/dist/duckdb-eh.wasm"));
  const bindings = await duckdb.createDuckDB(
    {
      mvp: {
        mainModule: path.join(dist, "duckdb-mvp.wasm"),
        mainWorker: path.join(dist, "duckdb-node-mvp.worker.cjs"),
      },
      eh: {
        mainModule: path.join(dist, "duckdb-eh.wasm"),
        mainWorker: path.join(dist, "duckdb-node-eh.worker.cjs"),
      },
    },
    new duckdb.VoidLogger(),
    duckdb.NODE_RUNTIME,
  );
  await bindings.instantiate();
  return bindings;
}

const macrotask = () => new Promise<void>((resolve) => setImmediate(resolve));

/** the `DuckDBHandleLike` `Engine` boots against: in-process bindings, answered a macrotask later. */
function handleOver(bindings: NodeDuckdb): DuckDBHandleLike {
  return {
    async registerFileBuffer(name: string, buffer: Uint8Array) {
      await macrotask();
      bindings.registerFileBuffer(name, buffer);
    },
    async dropFile(name: string) {
      await macrotask();
      bindings.dropFile(name);
      return null;
    },
    async connect(): Promise<DuckDBConnLike> {
      const conn = bindings.connect();
      return {
        async query<T>(sql: string) {
          await macrotask();
          const table = conn.query(sql);
          return { toArray: () => table.toArray() as unknown as T[] };
        },
        async close() {
          conn.close();
        },
      };
    },
    async terminate() {},
  };
}

/** `MemoryTableStore`, reading its registered files as CSV (see the module header). */
export class CsvTableStore extends MemoryTableStore {
  override ref(name: string): TableRef | undefined {
    return super.ref(name)
      ? { from: `read_csv(${lit(name)}, header = true, delim = ',')` }
      : undefined;
  }
}

/**
 * A fresh real `Engine` over `bindings` (its catalog reset first), whose `fetch` answers from
 * `files` (keyed by the path after `base`) a macrotask later, and 404s anything else -- UNLESS
 * `opts.statusFor(path)` names a different status for that path (P8 item 1's "a REAL failure must
 * still surface" test: a 500, not the release-side-gap 403/404, on a specific tile).
 */
export function nodeEngine(
  bindings: NodeDuckdb,
  base: string,
  files: ReadonlyMap<string, Uint8Array>,
  opts: { statusFor?: (path: string) => number | undefined } = {},
): Engine {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    await macrotask();
    const url = String(input instanceof Request ? input.url : input);
    const path = url.startsWith(base) ? url.slice(base.length) : undefined;
    const body = path ? files.get(path) : undefined;
    if (body) return new Response(body.slice());
    const status = (path !== undefined ? opts.statusFor?.(path) : undefined) ?? 404;
    return new Response(null, { status });
  }) as typeof fetch;
  return new Engine({
    createDb: async () => {
      bindings.reset();
      return { db: handleOver(bindings) };
    },
    fetchImpl,
    store: (db) => new CsvTableStore(db),
    extensionRepository: null,
    marksSink: () => {},
  });
}
