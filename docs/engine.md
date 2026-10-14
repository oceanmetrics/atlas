# engine/ — DuckDB-WASM extension mirror: eh vs mvp, and cross-origin

> **Status in OceanMetrics Atlas (WP11, 2026-10-14).** The DuckDB-WASM engine (`src/lib/engine/`) is still in the code, but the Collections lens reads Parquet with hyparquet and does not use it; only the shared place uploads (`lib/geo/upload/engineRuntime.ts`, `places/engine.ts`) still do. Everything about per-release stores, `versions.json` / restricted-release purges, `built_at` digests of MarineSensitivity release tables and the `msens` parity CLI describes the upstream release registry, which OceanMetrics Atlas does not have.

atlas-2 Step 3 (Sonnet half). This is the engine note atlas-0's hand-over asked this step to write:
measure the `mvp` bundle flavour (never selected in `docs/spikes/S1.md`/`S3.md` — every engine in
those spikes picked `eh`), and measure whether a cross-origin `custom_extension_repository` works at
all (neither spike tried it — S3.md's own gap list: "the extension mirror was tested for parquet
only, on wasm_eh, in chromium").

Harness: `tests/fixtures/engine-e2e/` (a standalone Vite app booting the real
`src/lib/engine/{engine,bundles,sql,smoke}.ts`, port 4391) + its Playwright specs, run
`npm run duckdb:fetch-ext && npm run e2e:engine` (chromium, firefox, webkit). Every number and
message below is copied verbatim from a real run on 2026-09-21 (macOS 15.7.1, Node 24, this
worktree).

## The mirror itself

`scripts/fetch-duckdb-extensions.mjs` fetches the `parquet` extension for both platforms, keyed by
the DuckDB **engine** version baked into the pinned `@duckdb/duckdb-wasm@1.32.0` (`v1.4.3`, not the
npm version — `src/lib/engine/bundles.ts`'s `DUCKDB_ENGINE_VERSION`):

| platform   | URL                                                                           | bytes                                                                |
| ---------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `wasm_eh`  | `https://extensions.duckdb.org/v1.4.3/wasm_eh/parquet.duckdb_extension.wasm`  | 3,045,039 (matches `docs/spikes/S3.md`'s own eh measurement exactly) |
| `wasm_mvp` | `https://extensions.duckdb.org/v1.4.3/wasm_mvp/parquet.duckdb_extension.wasm` | 2,867,304 (**new**: never fetched or measured before this step)      |

Written into `public/duckdb-ext/v1.4.3/{wasm_eh,wasm_mvp}/parquet.duckdb_extension.wasm`
(gitignored — re-fetched, not committed). `.github/workflows/pages.yml`'s `checks` job runs
`node scripts/fetch-duckdb-extensions.mjs` before `npx vite build`, so the mirror ships in every
published `dist/`; `npx vite build` copies both files through Vite's `publicDir` into
`dist/duckdb-ext/v1.4.3/{wasm_eh,wasm_mvp}/parquet.duckdb_extension.wasm` unchanged (verified by
hand). `spatial`/`json` are deliberately not mirrored (`docs/spikes/S4.md` "Where DuckDB extensions
are hosted" — unchanged by this step).

**The mirror is a supply-chain input, pinned.** `scripts/duckdb-extensions.manifest.json` commits
the exact byte size and sha256 of every mirrored file (re-measured 2026-09-21; a fresh re-download
hashed identically, confirming `extensions.duckdb.org` serves byte-identical content):

| platform   | bytes     | sha256                                                             |
| ---------- | --------- | ------------------------------------------------------------------ |
| `wasm_eh`  | 3,045,039 | `22765c8f7dc741cda2b571a66ac7bb355295d7d69a6c37e5315b265672984f55` |
| `wasm_mvp` | 2,867,304 | `0785c6c95d003eff4faa7b3b4b660f02c9c92f6d68d135ddf330d42e3a650600` |

`scripts/fetch-duckdb-extensions.mjs` verifies every download against this manifest and fails
(non-zero exit, nothing written) on a size or hash mismatch — an unexpectedly different file from a
third party is refused, not silently shipped. `scripts/check-duckdb-ext.mjs` (`npm run
check:duckdb-ext`, wired into `pages.yml` after `vite build`) re-verifies the same manifest against
whatever actually ended up in `dist/duckdb-ext/`, AND confirms neither pinned file is reachable from
`index.html`'s STATIC import graph (`assertMirrorNotInStaticGraph`, reusing
`size-budget-core.mjs`'s own static-graph walk) — the mirror must only ever be fetched at runtime by
DuckDB's own extension-autoload, never bundled. Both checks (missing file, tampered
byte/hash) are covered by named, seeded-fault tests in `tests/check-duckdb-ext.test.ts`.

**Published size added: 5,912,343 B (5.64 MiB)** for both platforms together (3,045,039 + 2,867,304),
entirely OUTSIDE the size budget: `size-budget.mjs`'s static-graph walk never visits `duckdb-ext/`
(publicDir copies have no entry in `dist/.vite/manifest.json` at all — there is nothing for the
walk to follow), confirmed by a real `npm run build && node scripts/size-budget.mjs` (11.5 KB gzip
static, unaffected by the mirror's presence) and by `assertMirrorNotInStaticGraph`'s own test suite.

## eh vs mvp — both work, forced explicitly

`selectBundle()` picked `eh` by default in every browser here too (same as S1/S3), so `mvp` was
forced by offering ONLY the `mvp` bundle key (`tests/fixtures/engine-e2e/main.ts`'s `bundlesFor()`).
Both flavours, with `extensions.duckdb.org` network-blocked and the same-origin mirror set, read
`marine-atlas/v9/tables/taxon.parquet` (a real, public bucket fetch — no fixture) and return exactly
**37,067** rows, on all three engines:

| platform       | chromium   | firefox    | webkit     |
| -------------- | ---------- | ---------- | ---------- |
| `eh`           | PASS 37067 | PASS 37067 | PASS 37067 |
| `mvp` (forced) | PASS 37067 | PASS 37067 | PASS 37067 |

## A relative `custom_extension_repository` breaks silently — worth stating explicitly

Not asked for, but found while building this fixture: the extension-autoload fetch runs **inside
the DuckDB worker**, whose own script location differs from the page's. A relative repository value
(e.g. the literal string `"./duckdb-ext"`) resolves against the _worker's_ location, not the page's,
and fails — on `eh` with "signature is either missing or invalid" (DuckDB fetched the wrong,
non-WASM response and rejected it), and on `mvp` with an unrelated-looking low-level `_setThrew is
not defined`. `src/lib/engine/engine.ts`'s `defaultExtensionRepository()` avoids this by building an
**absolute** URL from `document.baseURI` on the main thread before it ever reaches the worker; this
is why the option exists at all rather than a hand-rolled relative string, and this fixture's first
run caught exactly this class of bug (documented inline in `main.ts`, reverted before this note).

## Cross-origin `custom_extension_repository`: works, but only with CORS

The app's own data fetches already cross an origin boundary in production
(`src/lib/release/dataBase.ts`'s `PUBLIC_DATA_BASE` is the S3 bucket, a different origin than either
host the app is served from) — that already works because the bucket answers CORS for those objects.
This measures whether DuckDB-WASM's **own internal** extension-autoload fetch is subject to the same
mechanism, using a local "foreign origin" static server (`tests/fixtures/engine-e2e/foreign-server.mjs`,
port 4392) standing in for hosting the mirror on the bucket, since the real bucket is read-only here:

| foreign origin                        | chromium                            | firefox                                | webkit                                                   |
| ------------------------------------- | ----------------------------------- | -------------------------------------- | -------------------------------------------------------- |
| WITHOUT `Access-Control-Allow-Origin` | FAIL: `function signature mismatch` | FAIL: `Extension ... is not available` | FAIL: `call_indirect to a signature that does not match` |
| WITH `Access-Control-Allow-Origin: *` | PASS 37067                          | PASS 37067                             | PASS 37067                                               |

**Conclusion: a cross-origin repository works**, subject to ordinary CORS — the same rule that
already governs every other cross-origin fetch this app makes. If the extension mirror is ever
hosted on the bucket instead of same-origin under `dist/duckdb-ext/`, it needs the bucket's existing
CORS policy to cover `duckdb-ext/*` the same way it already covers `tables/*`/`manifest.json`; no
DuckDB-specific allowance is needed beyond that.

## Extension mirror unset + CDN blocked: the user-visible failure, per browser

The seeded fault `tests/fixtures/engine-e2e/e2e/extension-unset.spec.ts` runs: no
`custom_extension_repository` set, `**/extensions.duckdb.org/**` blocked, then a `read_parquet()`.
`docs/spikes/S3.md` called the underlying failure "not a catchable error... a WASM-level crash" —
true at the SQL-error layer, but it IS a rejected promise a surrounding `try`/`catch` catches (same
finding as S3's own gate re-run), which is why `Engine#exec`/`#load` can normalize it. The **raw**
message differs by engine — every one of these was copied verbatim from a real run:

| browser  | raw message                                                                                                                                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| chromium | `RuntimeError: function signature mismatch` (the whole message; no `Extension Autoloading Error` wrapper)                                                                                                                      |
| firefox  | `Extension Autoloading Error: An error occurred while trying to automatically install the required extension 'parquet': Extension https://extensions.duckdb.org/v1.4.3/wasm_eh/parquet.duckdb_extension.wasm is not available` |
| webkit   | `call_indirect to a signature that does not match (evaluating 'u(..._)')`                                                                                                                                                      |

`src/lib/engine/engine.ts`'s `EngineUnavailableError` wraps every one of these identically as `data
engine unavailable: <raw message>` — the one user-visible shape a caller (a future click handler)
has to know about, regardless of engine or browser.

## The 25 MB materialize guard now refuses BEFORE downloading (fix round 1)

The original guard (`Engine#load`) fetched the whole body, THEN checked `byteLength` — a 374 MB
`cell.parquet` would download in full on a phone and only then be refused, exactly backwards.
`src/lib/engine/materialize.ts`'s `fetchWithSizeGuard()` now checks twice, in order: (1) a
`Content-Length` response header over the guard aborts the request (`AbortController`) and throws
WITHOUT ever calling `resp.body.getReader()`; (2) the body is otherwise read as a stream and capped —
aborted the moment the running total crosses the guard, never buffering more than the guard plus one
chunk — which also catches a LYING `Content-Length` (a small header, a larger real body), not just a
missing one. Both layers, and both of their seeded-fault removals, are covered in
`tests/engine/materialize.test.ts`.

**What the real bucket sends, verified in a real browser (not just `curl`).** A cross-origin
`fetch()` from a real Chromium page (Playwright, a `data:` origin — the strictest, opaque-origin
case) to `marine-atlas/v9/tables/taxon.parquet` came back `type: "cors"` (not `"opaque"`) with
`content-length: "1033168"` readable from JS. `curl -I` against the same URL (with an `Origin`
header) shows why: `Access-Control-Allow-Origin: *` and, explicitly,
`Access-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges, ETag` — S3 exposes
`Content-Length` on every object this app reads, so the pre-check above works against the real
bucket, not just same-origin test fixtures. (`Content-Length` is also a CORS-safelisted response
header by spec regardless, so this would likely work even without the explicit expose-headers line —
S3 sends it anyway.)

## One place analysis at a time per engine (usability B1, 0.10.25)

`Engine`'s promise chain orders **statements**, not analyses. A place analysis is many statements
that first build fixed-name objects (`cell`, `place_cell`, `place_cell_sa`, `cell_model`,
`cell_model_key`, `species_agg`, `species_sel`) and then read them, with an `await` between each —
so on 0.10.21 two analyses in flight on one engine interleaved: a doubled `place_cell` (the live
"200.0 % … 1,344 of 672 cells"), an emptied one (0 %), or one place reading another's tiles.
`src/lib/analysis/exclusive.ts` is the rule: any caller that builds those objects and reads them
back runs its whole sequence inside `exclusive(ctx.sources.db, …)`, a FIFO queue per database.
Never nest it (the inner call would wait for the outer). It is not per-call table names (the twins'
names are the parity contract with `msens`) and not per-connection TEMP objects (one connection by
design; the parity CLI runs each statement in its own process). It costs nothing: the worker runs
one statement at a time regardless. `tests/analysis/concurrentPlaces.test.ts` proves it against a
real catalog, using the pinned duckdb-wasm's in-process node build (`tests/analysis/nodeEngine.ts`,
CSV tiles because `read_parquet` would autoload the extension); `e2e/places.concurrency.spec.ts`
proves it in the three browsers.

## What this note does NOT claim

- No real Safari, no real mobile browser — Playwright's WebKit build only (same caveat
  `docs/spikes/S1.md` already states for OPFS).
- The "foreign origin" is a local Node static server, not the real S3 bucket (read-only for this
  task) — the CORS mechanism measured here is the general one; whether the bucket's _specific_
  CORS policy already covers a `duckdb-ext/` prefix is unverified and would need a real (writable)
  test against it before relying on this in production.
- One machine, one session, `parquet` only (matches S3/S4's own scope; `spatial`/`json` untouched).
- The materialize-guard streaming path was measured against test doubles (a hand-rolled reader), not
  a real multi-hundred-MB fetch — the mechanism (abort on running total) is generic Streams API
  behaviour, but the exact chunk sizes a real S3 response delivers were not measured here.

---

# store/ — the OPFS tier: what it does, and the fallback matrix as measured

atlas-2 Step 4 (Opus). The tier-2 store (plan D3: "an OPFS-persistent DuckDB per release … one tab
holds it (Web Locks), everyone else and every failure mode runs in memory. The app never _requires_
OPFS"). Harness: `tests/fixtures/opfs-e2e/` (port 4451), `npm run duckdb:fetch-ext && npm run
e2e:opfs`. Every number below is from a real run on 2026-09-21 (macOS 15.7.1, Node 24, this
worktree), with `extensions.duckdb.org` blocked in every spec and one real public object —
`marine-atlas/v9/tables/taxon.parquet`, 1,033,168 B, 37,067 rows.

## The fallback matrix

Browsers: Playwright 1.63.0 — Chromium 153.0.8010.12, Firefox 155.0, WebKit 26.6. Every cell is a
green assertion in `tests/fixtures/opfs-e2e/e2e/`.

| situation                         | chromium                                | firefox                       | webkit                        |
| --------------------------------- | --------------------------------------- | ----------------------------- | ----------------------------- |
| first session (tier reached)      | `opfs`                                  | `opfs`                        | `opfs`                        |
| reload, S3 blocked, answers from  | the persisted table, 37,067             | the persisted table, 37,067   | the persisted table, 37,067   |
| … and takes to answer             | 16.1 ms (first load 644.6 ms)           | 5 ms (first load 700.0 ms)    | 12 ms (first load 607.0 ms)   |
| second tab, lock held elsewhere   | `memory` / `lock-held`                  | `memory` / `lock-held`        | `memory` / `lock-held`        |
| … answers in, never touching OPFS | 315.6 ms                                | 274.0 ms                      | 328.0 ms                      |
| corrupted file                    | deleted → `memory`, `corrupt`           | deleted → `memory`, `corrupt` | deleted → `memory`, `corrupt` |
| storage denied (probe rejects)    | `memory` / `opfs-unavailable`           | `memory` / `opfs-unavailable` | `memory` / `opfs-unavailable` |
| "keep data on this device" off    | `memory` / `setting-off`, files deleted | same                          | same                          |
| db file after CHECKPOINT          | 3,158,016 B                             | 3,420,160 B                   | 3,158,016 B                   |
| db file with CHECKPOINT removed   | 12,288 B (an empty header)              | 12,288 B                      | 12,288 B                      |

Only `no-locks-api`, `no-opfs-api` and `opfs-unavailable` emit `opfs_fallback` — plus whatever
reason a later failure produces (`corrupt`, `quota`, `locked`, `checkpoint`, `write`). `lock-held`
and `setting-off` are ordinary paths and emit nothing: a second tab is not an incident.

## This corrects `S1.md` on WebKit

`docs/spikes/S1.md` records Playwright's WebKit as a flat OPFS failure for every duckdb-wasm pin —
`navigator.storage.getDirectory()` rejecting with `UnknownError: The operation failed for an unknown
transient reason` inside the worker, before any file handle is requested. **On the same WebKit build
(26.6), OPFS works and persists here**: WebKit reaches the `opfs` tier, writes the file, and a
reload with S3 blocked reads 37,067 rows back out of it.

The one methodological difference is the browser context. S1 used Playwright's default (ephemeral)
context; this gate drives a real **persistent profile** (`launchPersistentContext`, `e2e/persistent.ts`)
— which is what a browser actually is. S1's verdict itself is unchanged and was never load-bearing on
this point ("it licenses only 'the app must never require OPFS'"), and the specs here hardcode no
engine as the broken one: chromium and firefox MUST reach the OPFS tier, WebKit may reach either and
must satisfy the corresponding contract, asserted specifically.

Also measured, and WebKit-specific: **a per-test `userDataDir` does not isolate OPFS on WebKit.**
Files written by one persistent profile were visible to the next, and across separate `playwright
test` runs. Harmless for the product (same origin, same storage) but the specs purge at
`beforeEach` so they do not depend on each other.

## What CHECKPOINT actually buys — not what the step predicted

The step's brief expected "CHECKPOINT removed → the reload finds no table". **It does not.**
duckdb-wasm prepares `<path>.wal` in OPFS alongside the database (`prepareDBFileHandle` asks for
both) and replays it on the next open, so an uncheckpointed table still comes back after a reload:
the reload gate stays green with every `CHECKPOINT` deleted. That fault therefore cannot be that
gate's seeded fault.

What CHECKPOINT does is put the bytes in the **database**: 3.2 MB in the `.duckdb` with it, a
12,288 B empty header without, on all three engines — the data sitting in the WAL instead. That
matters because this app's own stale-suffix sweep and self-heal delete a WAL together with its
database, and no tab that did not write a WAL replays it. So the gate was rewritten to assert the
db file's size, and `checkpoint: false` is its committed seeded fault. (`.wal` size is NOT a
discriminator: duckdb-wasm preallocates it at 7,332,7xx B either way.)

## Eviction order — ruled, and not what the plan's wording said

`atlas-2`'s `store/` paragraph says "evicting least-recently-used tiles first, then whole stale
versions". Taken literally that throws away a tile of the release on screen right now before it
touches a release nobody has opened in weeks. The phase review ruled the order (fix round 1,
ruling 5), and `policy.ts`'s `planEviction` implements exactly this:

1. **restricted OTHER-version files**, regardless of recency — plan D6: a reviewer's device keeps
   unreleased data no longer than it has to, and `purgeRestricted()` (Sign out) is the only other
   thing that removes them. The caller supplies the restricted labels from `versions.json`
   (`openTableStoreBackend({ restrictedVersions })`); with none supplied nothing is marked.
2. **the remaining OTHER-version files**, least recently used first;
3. **cold tiles of the CURRENT release**, least recently used first.

Non-tile tables (`taxon`, `zone_taxon`, `taxonomy`, `model`) are never evicted: they are the reason
the tier exists and together are ~10–25 MB per release against a 300 MB budget.

> **For whoever wires the store into the app** (nothing calls `openTableStoreBackend` yet): pass
> `restrictedVersions` — the labels `versions.json` marks `access: "restricted"`, which the release
> layer has already parsed — or step 1 above silently never fires and restricted releases are
> evicted in plain LRU order like any other.

The ruling opens with a fourth step, "cold tiles of OTHER releases". Steps 1–2 above are that step
and "whole stale versions" **collapsed**, necessarily: another release's tiles live inside a db file
this tab has not opened and must not open (one handle per file, `S1.md` rule 6), so the whole file
is the smallest unit available. The observable order is the ruled one. Seeded fault: restoring the
plan's literal "tiles first" order turns
`tests/engine/opfsPolicy.test.ts` › "evicts a COLD other release before a HOT tile of the current
one" red.

## Objects with no published digest — `built_at`, not the release label

`tables/model.parquet` (v1–v7), every `serve/cell_model` tile, and `taxonomy` on a release whose
`boot.tables` omits it carry no digest. They used to be keyed on the release LABEL alone, which is
constant for the life of a release — so a corrected re-publish was served from OPFS stale,
indefinitely, with no way to expire. Ruled (fix round 1, ruling 4): the key is **`boot.built_at` +
the object's path** (`policy.ts`'s `noDigestKey`, used by both `analysis/sources.ts`'s `digestOf`
and the session-start reconcile, so the writer and the checker cannot drift). No extra request, and
no dependence on S3 exposing `ETag` through CORS; any rebuild of `app/` invalidates them. The
matching obligation on the publisher is logged in atlas-1: re-publishing any object the app reads
outside `app/` requires rebuilding `app/`.

`built_at` is a required top-level key of `boot.json` in atlas-1's data contract (`schema, ver,
built_at, msens`). A boot without it **fails closed**: the key then carries a per-page-load token,
so nothing persisted by an earlier session is ever reused — stable within one session, different on
every reload.

## Three bugs the real-browser run found

Each has a named regression test; all three were invisible to a stub.

1. **`registerFileBuffer` transfers the buffer.** Reading `buffer.byteLength` after the call sees a
   detached array — 0. `MemoryTableStore` had done exactly that since Step 3, so every `bytes` was
   0 in every real browser, and the new LRU budget was a silent no-op. Measure before registering.
   The OPFS path additionally hands the worker a **copy**, so that a write failure after the
   transfer still has the bytes to fall back to memory with.
2. **A cache hit did not count as a use.** `Engine#load` short-circuits on `has(name, digest)` and
   never reaches `register()`, so `last_used` only ever moved on a (re-)registration: the LRU would
   have evicted the hottest tile in the working set. Hence `TableStore.touch(name)`.
3. **A failed `open()` leaked its worker.** `defaultOpenDatabase` threw without terminating the
   DuckDB it had just created, and duckdb-wasm creates the file's sync access handle _before_ it
   reads it — so the handle stayed open, `removeEntry()` kept failing, and the corrupted file
   "self-healed" into a corrupted file that was still there. It now tears down its own worker before
   rethrowing, and `deleteDbFile()` retries a bounded number of times besides (the handle is closed
   inside the worker's realm, asynchronously).

## What this note does NOT claim

- No real Safari, no real mobile browser, one machine — the same caveat `S1.md` already states.
- The WebKit finding above is about Playwright's WebKit 26.6 in a persistent profile. It is not a
  statement about Safari, and it does not make OPFS a requirement anywhere.
- The budget was exercised at 3.7 MB (a quota override), not at the real 300 MB cap, and with
  one ~1 MB object standing in for a `cell_model` tile. Browser eviction mid-session, a real quota
  error and a genuinely large multi-release store are still unmeasured — `S1.md`'s "nothing about
  tier-2 scale" gap is narrowed, not closed.
- "Storage denied" is injected at this app's own `opfsRoot` seam, not by a real private window.
  WebKit's own pre-existing rejection (S1) is the only un-simulated instance anyone has measured.
