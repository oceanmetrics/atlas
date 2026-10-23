// atlas-2 Step 3 (Sonnet half): the engine wrapper. DuckDB-WASM booted lazily (after first frame, or
// on first need -- never in the entry's static import graph), one connection, and EVERY `load()`/
// `exec()` serialized on one promise chain (`atlas-refs/"calcofi explore review.md"` §11 lesson 2:
// "a real shipped bug came from issuing a query before an asynchronously-registered buffer it
// depended on had finished" -- `this.q = this.q.then(...)` is the fix, adopted verbatim below).
//
// Dependency-injectable on purpose: `createDb`/`fetchImpl`/`store`/`marksSink` all default to the
// real self-hosted DuckDB boot (`bundles.ts`) and a real `fetch`, but a test supplies stubs so the
// chain-ordering, the 25 MB materialize guard and the extension-repository wiring are all provable
// under plain Node/Vitest without a browser. The real, no-stub path is exercised only by
// `tests/fixtures/engine-e2e`'s Playwright specs (a real worker + wasm module needs a real browser).
import { createRealDuckDB, DUCKDB_ENGINE_VERSION } from "./bundles";
import { fetchWithSizeGuard, MATERIALIZE_MAX_BYTES, MaterializeTooLargeError } from "./materialize";
import { lit } from "./sql";
import { MemoryTableStore, type DuckDBFileHandle } from "./store/memoryStore";
import type { RawSql, TableStore } from "./store/TableStore";

export type { RawSql } from "./store/TableStore";

export { MATERIALIZE_MAX_BYTES } from "./materialize";

/** the minimal query surface `engine.ts` needs from a connection -- structural, not imported from
 * `@duckdb/duckdb-wasm`, so a test double can satisfy it without any real Arrow/WASM machinery. A
 * real `AsyncDuckDBConnection.query()` already returns an `arrow.Table`, which has `.toArray()`. */
export interface DuckDBConnLike {
  query<T = Record<string, unknown>>(sql: string): Promise<{ toArray(): T[] }>;
  close(): Promise<void>;
}

export interface DuckDBHandleLike extends DuckDBFileHandle {
  connect(): Promise<DuckDBConnLike>;
  terminate(): Promise<void>;
  /** an empty in-memory file a `COPY ... TO` writes into (`AsyncDuckDB.registerEmptyFileBuffer`); optional, so a
   * stub without it still boots ({@link Engine.exportParquet} then says the engine cannot write) */
  registerEmptyFileBuffer?(name: string): Promise<void>;
  /** the bytes of a virtual file (`AsyncDuckDB.copyFileToBuffer`) */
  copyFileToBuffer?(name: string): Promise<Uint8Array>;
}

export interface EngineMark {
  name: string;
  startMs: number;
  durationMs: number;
  detail?: Record<string, unknown>;
}

export interface EngineOptions {
  /** creates the underlying DuckDB handle (+ its worker, for disposal); defaults to the real
   * self-hosted boot (`createRealDuckDB`). Overridden by tests. */
  createDb?: () => Promise<{ db: DuckDBHandleLike; worker?: { terminate(): void } }>;
  fetchImpl?: typeof fetch;
  /**
   * defaults to a fresh `MemoryTableStore` bound to the booted db. Pass an OPFS-backed store
   * (atlas-2 Step 4, `store/opfsBackend.ts`'s `makeStore`) to swap tiers without touching this
   * class.
   *
   * The second argument is a {@link RawSql} bound to this engine's ONE connection that deliberately
   * BYPASSES the public promise chain. A store that owns real persisted tables has to issue its own
   * DDL from inside `register()`, which already runs as a chain task; re-entering `exec()` there
   * would enqueue behind the task that is waiting for it and deadlock. `MemoryTableStore` ignores
   * it entirely.
   */
  store?: (db: DuckDBHandleLike, raw: RawSql) => TableStore;
  /** same-origin path DuckDB's extension autoloader is pointed at before the first query
   * (`docs/spikes/S3.md`/`S4.md`). `undefined` (the default) computes it from `document.baseURI`, so
   * it stays base-relative under both hosts; `null` disables the `SET` entirely (used only by the
   * seeded-fault test proving what happens without it). */
  extensionRepository?: string | null;
  maxMaterializeBytes?: number;
  marksSink?: (mark: EngineMark) => void;
}

/** every failure this class raises is normalized to this: a query-layer `CatalogError` and an
 * extension-autoload WASM `RuntimeError: function signature mismatch` (docs/spikes/S3.md: "not a
 * catchable error" at the SQL layer, but it IS a rejected promise a `try`/`catch` around `exec()`
 * catches) both surface identically to a caller -- "data engine unavailable", never a raw crash a
 * click handler has to know DuckDB-WASM internals to interpret. */
export class EngineUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`data engine unavailable: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "EngineUnavailableError";
    if (cause instanceof Error && cause.stack)
      this.stack = `${this.stack}\ncaused by: ${cause.stack}`;
  }
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** `window.__marks` is intentionally NOT declared as a global ambient type here (this module doesn't
 * own that namespace) -- pushed defensively behind a cast, a no-op outside a browser (Vitest's `node`
 * environment, a worker with no `window`). */
function defaultMarksSink(mark: EngineMark): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __marks?: EngineMark[] };
  (w.__marks ??= []).push(mark);
}

/** relative to the current document, never absolute (`base: "./"`, the same rule every other module
 * in this app follows for asset/data URLs) -- so the same `dist/` keeps working under `/atlas/` and
 * `/{ver}/atlas/` alike. `null` outside a browser (no `document`), which callers must handle by
 * passing `extensionRepository` explicitly. */
export function defaultExtensionRepository(): string | null {
  if (typeof document === "undefined") return null;
  return new URL("duckdb-ext", document.baseURI).href;
}

export class Engine {
  #db: DuckDBHandleLike | null = null;
  #worker: { terminate(): void } | undefined;
  #conn: DuckDBConnLike | null = null;
  #chain: Promise<unknown> = Promise.resolve();
  #bootPromise: Promise<void> | null = null;
  #store: TableStore | null = null;
  #makeStore: (db: DuckDBHandleLike, raw: RawSql) => TableStore;
  #createDb: NonNullable<EngineOptions["createDb"]>;
  #fetchImpl: typeof fetch;
  #extensionRepository: string | null;
  #maxMaterializeBytes: number;
  #marksSink: (mark: EngineMark) => void;

  constructor(opts: EngineOptions = {}) {
    this.#createDb =
      opts.createDb ??
      (async () => {
        const { db, worker } = await createRealDuckDB();
        return { db, worker };
      });
    this.#fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
    this.#makeStore = opts.store ?? ((db) => new MemoryTableStore(db));
    this.#extensionRepository =
      opts.extensionRepository === undefined
        ? defaultExtensionRepository()
        : opts.extensionRepository;
    this.#maxMaterializeBytes = opts.maxMaterializeBytes ?? MATERIALIZE_MAX_BYTES;
    this.#marksSink = opts.marksSink ?? defaultMarksSink;
  }

  /** `null` until {@link boot} has resolved at least once. */
  get store(): TableStore | null {
    return this.#store;
  }

  get engineVersion(): string {
    return DUCKDB_ENGINE_VERSION;
  }

  /**
   * Schedule a lazy boot after first frame: `requestIdleCallback` when available, a macrotask
   * (`setTimeout(…, 0)`) fallback otherwise (older Safari, a non-browser test host). Never boots
   * synchronously and never runs at import time -- importing this module must stay free even when
   * the import itself is dynamic. A boot failure here is swallowed (logged via the same mark path a
   * caller can inspect on `window.__marks`); it resurfaces to whichever caller's `load()`/`exec()`
   * actually needs the engine next.
   */
  scheduleIdleBoot(): void {
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void) => void })
      .requestIdleCallback;
    const schedule = typeof ric === "function" ? ric : (cb: () => void) => setTimeout(cb, 0);
    schedule(() => {
      this.boot().catch(() => {});
    });
  }

  /** Idempotent: concurrent/subsequent calls all resolve from the same in-flight (or settled)
   * promise -- never a second `createDb()`/`connect()`. A failed boot clears the cached promise so
   * the NEXT call gets a fresh attempt rather than a permanently-cached rejection. */
  boot(): Promise<void> {
    if (!this.#bootPromise) this.#bootPromise = this.#bootOnce();
    return this.#bootPromise;
  }

  async #bootOnce(): Promise<void> {
    const endMark = this.#startMark("engine:boot");
    try {
      const { db, worker } = await this.#createDb();
      this.#db = db;
      this.#worker = worker;
      this.#conn = await db.connect();
      this.#store = this.#makeStore(db, this.#raw);
      if (this.#extensionRepository) {
        // MUST happen before the first read_parquet()/LOAD: unset, a blocked/unreachable
        // extensions.duckdb.org turns into an uncatchable-feeling WASM `RuntimeError: function
        // signature mismatch` deep inside the query path, not a normal query error
        // (docs/spikes/S3.md, S4.md).
        await this.#conn.query(
          `SET custom_extension_repository = ${lit(this.#extensionRepository)};`,
        );
      }
      endMark({ ok: true, extensionRepository: this.#extensionRepository });
    } catch (err) {
      endMark({ ok: false, error: String(err) });
      this.#bootPromise = null;
      throw new EngineUnavailableError(err);
    }
  }

  /**
   * Whole-object `fetch` + `registerFileBuffer` (materialize-then-query, plan `engine/`). Idempotent
   * via the store's own name+digest bookkeeping: a `name` already registered under this exact
   * `digest` is neither re-fetched nor re-registered. Refuses (throws, never silently truncates or
   * range-reads) anything over {@link MATERIALIZE_MAX_BYTES}. Serialized on the SAME chain as every
   * `exec()` -- see {@link enqueue}.
   */
  load(name: string, url: string, digest: string): Promise<void> {
    return this.#enqueue(async () => {
      await this.boot();
      const store = this.#store!;
      // a cache HIT is still a use: without this the OPFS tier's `last_used` would only ever move
      // on a (re-)registration, so its LRU would evict by registration order and throw away the
      // hottest tile in the working set. See `TableStore.touch`.
      if (store.has(name, digest)) return store.touch(name);

      const endMark = this.#startMark("engine:load", { name, url });
      try {
        // fetchWithSizeGuard refuses BEFORE the download completes: a Content-Length over the
        // guard aborts without ever reading the body, and a stream (missing or lying
        // Content-Length) is capped and aborted mid-flight -- see materialize.ts's header.
        const buf = await fetchWithSizeGuard(url, {
          fetchImpl: this.#fetchImpl,
          maxBytes: this.#maxMaterializeBytes,
        });
        await store.register(name, digest, buf);
        endMark({ ok: true, bytes: buf.byteLength });
      } catch (err) {
        endMark({ ok: false, error: String(err) });
        // MaterializeTooLargeError itself doesn't know which table it was loading (materialize.ts
        // is a generic fetch helper) -- add that context here, at the one call site that does.
        const named =
          err instanceof MaterializeTooLargeError
            ? new Error(`loading "${name}": ${err.message}`)
            : err;
        throw named instanceof EngineUnavailableError ? named : new EngineUnavailableError(named);
      }
    });
  }

  /**
   * Register a whole file's raw bytes as a duckdb-wasm virtual file, addressable by `name` in SQL
   * — the "buffer-register + query" hook `lib/geo/upload/engineRuntime.ts` wraps into a
   * `GeoPackageRuntime` (Q2, 0.10.52: `UploadPanel.svelte` used to hardcode `runtime: null`, so
   * every `.gpkg` was refused unconditionally since 0.10.47). Deliberately bypasses the `TableStore`
   * (`load()`, above): that abstraction assumes a manifest URL + digest for its LRU bookkeeping and
   * reads back only via `read_parquet(name)`, neither of which fits an uploaded `.gpkg`'s raw bytes
   * read by `sqlite_scan()`/`ST_Read()`. Serialized on the same chain as `load()`/`exec()` so a
   * concurrent query can never race the registration.
   */
  registerFile(name: string, bytes: Uint8Array): Promise<void> {
    return this.#enqueue(async () => {
      await this.boot();
      const endMark = this.#startMark("engine:registerFile", { name, bytes: bytes.byteLength });
      try {
        await this.#db!.registerFileBuffer(name, bytes);
        endMark({ ok: true });
      } catch (err) {
        endMark({ ok: false, error: String(err) });
        throw err instanceof EngineUnavailableError ? err : new EngineUnavailableError(err);
      }
    });
  }

  /** Drop a file registered by {@link registerFile}. A no-op before `boot()` has ever run (nothing
   * to drop yet), never an error — the same "never crash the tab" contract as every other public
   * method here. */
  dropFile(name: string): Promise<void> {
    return this.#enqueue(async () => {
      if (!this.#db) return;
      const endMark = this.#startMark("engine:dropFile", { name });
      try {
        await this.#db.dropFile(name);
        endMark({ ok: true });
      } catch (err) {
        endMark({ ok: false, error: String(err) });
        throw err instanceof EngineUnavailableError ? err : new EngineUnavailableError(err);
      }
    });
  }

  /**
   * The rows of `select` written as one Parquet file and handed back as bytes (the OBIS layer's WoRMS subtree: the
   * computed hexagons go to the map package's worker as a `blob:` url). `COPY (select) TO` an empty virtual file,
   * then its bytes, then the file dropped; serialized on the same chain as every `exec()`. `options` are the COPY
   * options after `FORMAT PARQUET` (`ROW_GROUP_SIZE 10240`).
   */
  exportParquet(name: string, select: string, options = ""): Promise<Uint8Array> {
    return this.#enqueue(async () => {
      await this.boot();
      const db = this.#db!;
      if (!db.registerEmptyFileBuffer || !db.copyFileToBuffer)
        throw new EngineUnavailableError(new Error("this engine cannot write a file"));
      const endMark = this.#startMark("engine:exportParquet", { name });
      try {
        await db.registerEmptyFileBuffer(name);
        await this.#conn!.query(
          `COPY (${select}) TO ${lit(name)} (FORMAT PARQUET${options ? `, ${options}` : ""});`,
        );
        const bytes = await db.copyFileToBuffer(name);
        await db.dropFile(name);
        endMark({ ok: true, bytes: bytes.byteLength });
        return bytes;
      } catch (err) {
        endMark({ ok: false, error: String(err) });
        throw err instanceof EngineUnavailableError ? err : new EngineUnavailableError(err);
      }
    });
  }

  /**
   * The {@link RawSql} handed to a `TableStore` (see `EngineOptions.store`): the same single
   * connection, NO chain, NO implicit `boot()`. It is an arrow property rather than a method so it
   * can be passed by reference, and it is private so the only way to obtain one is to BE the store
   * -- i.e. to be called from inside a chain task that already owns the ordering.
   */
  #raw: RawSql = async <T = Record<string, unknown>>(sql: string): Promise<T[]> => {
    if (!this.#conn) throw new EngineUnavailableError(new Error("raw(): engine is not booted"));
    return (await this.#conn.query<T>(sql)).toArray();
  };

  /** Run one query on the single connection, serialized on the same chain as every `load()`. */
  exec<T = Record<string, unknown>>(sql: string): Promise<T[]> {
    return this.#enqueue(async () => {
      await this.boot();
      const endMark = this.#startMark("engine:exec", {
        sql: sql.length > 200 ? `${sql.slice(0, 200)}…` : sql,
      });
      try {
        const result = await this.#conn!.query<T>(sql);
        const rows = result.toArray();
        endMark({ ok: true, rows: rows.length });
        return rows;
      } catch (err) {
        endMark({ ok: false, error: String(err) });
        throw err instanceof EngineUnavailableError ? err : new EngineUnavailableError(err);
      }
    });
  }

  /**
   * EVERY `load()`/`exec()` runs through here: `fn` starts only after the previous operation's
   * promise has SETTLED (resolved OR rejected), so two calls issued back-to-back -- with no
   * `await` between them -- always execute strictly in call order against the one connection
   * (`atlas-refs/"calcofi explore review.md"` lesson 2). A rejection is delivered to ITS caller
   * (the promise `enqueue` returns) but never poisons the chain for the NEXT caller: `#chain` itself
   * is re-armed with a settled (never-rejecting) continuation.
   */
  #enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.#chain.then(fn, fn);
    this.#chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async dispose(): Promise<void> {
    await this.#chain.catch(() => {});
    await this.#conn?.close().catch(() => {});
    await this.#db?.terminate().catch(() => {});
    this.#worker?.terminate?.();
    this.#conn = null;
    this.#db = null;
    this.#store = null;
    this.#bootPromise = null;
  }

  #startMark(name: string, detail?: Record<string, unknown>) {
    const startMs = nowMs();
    return (extra?: Record<string, unknown>) => {
      this.#marksSink({
        name,
        startMs,
        durationMs: nowMs() - startMs,
        detail: { ...detail, ...extra },
      });
    };
  }
}
