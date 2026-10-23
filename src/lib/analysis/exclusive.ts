// analysis/exclusive.ts -- ONE place analysis at a time per database (usability B1).
//
// Every place analysis builds the same fixed-name objects the `sql/*.sql` twins read -- `cell`
// (a view over the place's tiles), `place_cell`, `place_cell_sa`, `cell_model`, `cell_model_key`,
// `species_agg`, `species_sel` -- one statement per `await`. `Engine`'s promise chain orders
// STATEMENTS, not analyses, so two analyses in flight on one engine used to interleave: `CREATE OR
// REPLACE place_cell` twice then `INSERT` twice doubled the table (the live 0.10.21 read "200.0 %
// ... 1,344 of 672 cells"), a replace landing between one analysis' insert and its count emptied it
// (the 0.0 %), and a `cell` view redefined over another place's tiles handed one place the other's
// scores (`tests/analysis/concurrentPlaces.test.ts` reproduces all three, deterministically).
//
// Why a queue, and not per-call table names or per-connection TEMP objects:
// - the twins' object names ARE the contract with `msens` (D7/D7b): the parity harness runs these
//   exact files, the report prints them as "the SQL that ran", and `species_sel` is read by a LATER
//   call (`composition()`). Per-call names would mean rewriting every twin, or templating
//   identifiers into files whose bytes are what parity proves.
// - TEMP objects are per connection, and the engine is deliberately ONE connection (the OPFS store's
//   own DDL shares it, `engine.ts`); `scripts/parity/run.mjs` runs each statement in its own CLI
//   process, where a TEMP table would not survive to the next statement.
// - DuckDB-WASM runs one statement at a time in one worker anyway: two analyses were never
//   parallel, only interleaved. Queuing them costs no throughput -- it only fixes the order.
//
// So every caller that builds and then reads those objects runs its WHOLE sequence inside
// `exclusive()`: `places/results.ts` (scores, the analysed-cells toggle, species), `places/
// studyArea.ts` (an upload's study-area check), `report/data.ts`'s zone species.
//
// NEVER nest `exclusive()` on the same database: the inner call waits for the outer one, which is
// waiting for it. The callers above each take it exactly once, at their outermost async function.
import type { SqlRunner } from "./queries";

/** the settled tail of each database's queue -- keyed by the runner itself (in the app, the one
 * `Engine` a `DataEngineContext` holds), so every caller sharing an engine shares its queue. */
const tails = new WeakMap<SqlRunner, Promise<void>>();

/**
 * Run `fn` alone on `db`: it starts only after every earlier `exclusive()` on the same `db` has
 * SETTLED (resolved or rejected), and the next starts only after it settles. First in, first out.
 * A rejection goes to `fn`'s own caller and never blocks the queue for the next one.
 */
export function exclusive<T>(db: SqlRunner, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(db) ?? Promise.resolve();
  const run = prev.then(() => fn());
  tails.set(
    db,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}
