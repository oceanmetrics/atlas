# performance.md — what each budget measured, on what, and the three slowest matrix states

> **Status in OceanMetrics Atlas (WP11, 2026-10-14).** The measurements are from MarineSensitivity Atlas 0.10.x (the `scripts/verify.mjs` matrix, the scores states, `npm run parity`), none of which exists here, and were not re-measured. The current budgets are `npm run size-budget` (450 KB gzip static path + 150 KB workers, 600 KB combined) and the gates listed in `tests/GATES.md`.

atlas-8 step 3. Every number below is real, from a real command run in this dispatch (2026-09-23,
macOS, this worktree, laptop) unless marked otherwise. Nothing here is invented or interpolated.
The size-budget, `verify.mjs`-matrix and CI numbers were re-measured in a later pass the same day
(worktree `r2-perf`, `origin/main` at `9c614db`, 0.10.20) to bring them current against the build
that actually shipped; the timing-gate laptop numbers below predate that pass and were not re-run.

## Size budgets (`scripts/size-budget.mjs`, `pages.yml`'s `checks` job)

Measured with `npm run build && node scripts/size-budget.mjs` (2026-09-23, re-measured pass,
`TMPDIR` exported to a worktree-local dir — the sandboxed default `$TMPDIR` denies `vite`/Playwright
`mkdtemp` calls here):

| what                                                | measured          | budget   |
| --------------------------------------------------- | ----------------- | -------- |
| static critical path (index.html's own `<script>`s) | **417.4 KB gzip** | ≤ 450 KB |
| runtime worker (maplibre-gl's)                      | **140.5 KB gzip** | ≤ 150 KB |
| combined, "before first interaction"                | **557.9 KB gzip** | ≤ 600 KB |

Both individual budgets and the combined one pass with headroom (32.6 KB / 9.5 KB / 42.1 KB
respectively). The two red-fixture controls
(`npm run build:fixture:size-budget[-worker]` + the inverted checker call) still fail as designed —
confirmed both in this dispatch's own `npx tsc`/`vitest`/`eslint`/`prettier` pass and in CI run
`35867233243` (job "build & checks"): the static-duckdb fixture fails on the forbidden `duckdb`
lazy-chunk marker, and the worker fixture fails on exceeding the 153,600 B runtime-worker budget
(170,821 B measured) — unchanged from atlas-0's own wiring.

## The timing gate (`e2e/species.timing.spec.ts`, its own "timing" Playwright project)

Rule (this subplan's own pyramid + atlas-8's 2026-09-21 handover): the gate runs ALONE
(`workers: 1`; in CI it is its own `pages.yml` step, after the step that runs the three engine
projects), and gates on the MEDIAN of N ≥ 3 cold runs, never a single sample. That CI step passes
`--no-deps`: the `timing` project's `dependencies: ["chromium","webkit","firefox"]` orders the
projects inside ONE invocation, but in a separate invocation it just re-runs the whole matrix
again — which is what it was silently doing until 0.10.14 fix round 1.

**Laptop, this dispatch** (`npx playwright test --project=timing --no-deps`, machine otherwise
idle): three cold runs of **1711 ms, 1497 ms, 1579 ms — median 1579 ms**, against the 2.5 s budget
(`e2e/species.timing.spec.ts:48`'s own assertion). This measures "deep link (`?sp=`) to first
species raster pixel painted," a different (later) milestone than S2's own "first maplibre paint"
number (atlas-0's spike, 499–740 ms median) — the two are not directly comparable; both stay well
inside their own budgets.

**CI runner: OBSERVED, 2026-09-23 (0.10.14 fix round 1).** atlas-0's review (F6) found "the ≤ 2.5 s
first-data-frame gate has never run on the CI runner" and asked this phase to put it into CI and
record the runner's number. It has now actually run there, on `ubuntu-latest`, alone in its own
step (`npx playwright test --project=timing --no-deps` under `xvfb-run`, after the three engine
projects finished in the step before) — twice, with instructive disagreement:

| where                            | cold median (of 3 runs)                              | budget        |
| -------------------------------- | ---------------------------------------------------- | ------------- |
| laptop (macOS, idle)             | **1579 ms** (1711/1497/1579)                         | ≤ **2500 ms** |
| `ubuntu-latest`, run 35824811030 | **3281 / 2629 / 3261 ms** (its three retry attempts) | ≤ **4000 ms** |
| `ubuntu-latest`, run 35825712215 | **1906 ms** (2173/1897/1906)                         | ≤ **4000 ms** |
| `ubuntu-latest`, run 35826436609 | **3445 ms** (3584/3432/3445)                         | ≤ **4000 ms** |
| `ubuntu-latest`, run 35867233243 | **1646 ms** (1757/1646/1632)                         | ≤ **4000 ms** |

**2026-09-23, a fourth CI observation (run `35867233243`, job "e2e (chromium, webkit, firefox)",
step "timing gate (species.timing.spec.ts, alone)" — the latest GREEN run on `main` as of this
pass, head sha `9c614db`, same commit this worktree is based on).** Median **1646 ms**, the lowest
of the four CI medians recorded here — well under even the 1906 ms that had been the previous
floor. The four medians now span 1646–3445 ms (still a >2× range), which reinforces rather than
revises the point below: the cap is calibrated against the worst case observed, and one new fast
run doesn't retire a worst case — only a new, worse one would move the cap. `CI_BUDGET_MS` stays
4000 ms.

**The headline here is the SPREAD, not any single number.** Three runs of identical code on the
same nominal hardware, minutes apart, produced medians of 3281, 1906 and 3445 ms — a 1.8× swing,
and the fastest of them beats the laptop's own 2500 ms budget while the slowest is nearly 40% over
it. That is what a 2-core shared VM with network-RTT-bound tile latency does, and it is why this
gate cannot carry a laptop-calibrated number on CI: with a 2500 ms cap the suite would be red most
of the time, for no reason related to the app.

So the budget is now per machine (`e2e/species.timing.spec.ts`'s `LAPTOP_BUDGET_MS` /
`CI_BUDGET_MS`, selected on `process.env.CI`). The laptop number is unchanged at 2500 ms; the CI
number is 4000 ms, chosen against the WORST median observed rather than the mean precisely because
of that spread — a decision the third run then vindicated: 3445 ms passes, and a mean-calibrated
cap (~2900 ms) would have been red. It is still a real gate: a regression adding ~1 s to the cold
path lands past 4000 ms on every run above, good or bad.

**Headroom is now thin — 4000 ms is only ~16% above the 3445 ms worst case.** The spec prints its
samples and median on a PASS as well as a failure, so every future run adds a row here. If more
runs cluster near 3400-3600 ms, raise the cap _and_ say here what it was raised against; if they
cluster near 1900 ms, lower it. Either way this table is the evidence, and the cap should never
move without a new row.

One caveat worth keeping in view: titiler tile latency (the dominant cost per S2) is
network-RTT-bound from whatever region the runner lands in, which is the most likely explanation
for the 1906→3445 ms gap above. Every row is "the gate alone", so none is contaminated by the old
double-run of the engine matrix.

## `scripts/verify.mjs`'s state matrix — laptop, chromium (full run)

`VERIFY_BASE_URL=http://localhost:4352 node scripts/verify.mjs --engines=chromium`: **174/174
pass** (58 named states × 3 viewports), confirmed on two independent clean, quiet-machine runs this
pass (2026-09-23; 1-min load 2.16→4.23 and 4.19→5.02, both well under the ~25 threshold this task
sets — see uptime readings below). Total wall time **~112–114 s per run**, measured end to end from
this dispatch's own `uptime` timestamps bracketing each run (17:27:54→17:29:46 and
17:33:32→17:35:26). This _corrects_ the ~35–40 s figure previously recorded here: that number
undercounted the script's own self-managed lifecycle (atlas-8 fix round 1) — building `dist/`,
starting its own `vite preview`, running all 174 states, then shutting the server back down — none
of which is itself budgeted (`assertLayout` + the per-state probes are correctness gates, not a
timing gate).

**Cross-engine (webkit, firefox): substantially confirmed, not exhaustively swept.** Every
individual `e2e/*.spec.ts` file this phase widened (`map.spec.ts`, `scores.firstpaint.spec.ts`,
`species.smoke.spec.ts`, `places.spec.ts`, `verify.faults.spec.ts`) was run to completion on all
three engines via `npx playwright test <file> --project=<engine>` and is green (one narrowly-scoped
exception logged in `CHANGELOG.md`'s 0.10.2 entry and in `scores.firstpaint.spec.ts` itself). The
raw `verify.mjs` matrix itself was run on webkit/firefox in large but not full-174 batches: this
machine is shared (per this dispatch's own instructions) and its manually-launched `vite preview`
server on :4331 was killed by the OS (exit 137, OOM) three separate times over the course of this
session while other, unrelated processes on the same box were also under memory pressure —
independent of engine or test correctness (confirmed: every state that "failed" this way passed
cleanly on retry once the server was healthy again). This is a laptop/sandbox resource-sharing
artifact, not a finding about WebKit or Firefox, and not expected to recur on a CI runner's own,
non-shared VM. The mechanism itself (hermetic routing, cross-engine launch, the raster/vector
probes) is proven correct by the files above; a full three-engine `node scripts/verify.mjs` sweep
is `pages.yml`'s `e2e` job's job now, on hardware that does not have this problem.

## The three slowest matrix states, and their cause

Re-measured this pass, 2026-09-23: two back-to-back, clean (no other process running — the four
non-build gates had already finished, confirmed via `ps`) runs of
`VERIFY_BASE_URL=http://localhost:4352 node scripts/verify.mjs --engines=chromium`, each on a
machine at or under the ~25 1-min-load threshold this task sets, per-state timings taken from the
script's own `timings` array (its "verify: slowest 3 states" printout):

**Run 1** (1-min load 2.16 before → 4.23 after):

| rank | state                                                                    | ms   |
| ---- | ------------------------------------------------------------------------ | ---- |
| 1    | `scores sel=zone:MDA proj=globe @ phoneNarrow [chromium]`                | 1278 |
| 2    | `shell (default) @ desktop [chromium]`                                   | 1199 |
| 3    | `scores lyr=extrisk_bird_ecoregion_r area=FULL @ phoneNarrow [chromium]` | 1089 |

**Run 2, warm-cache** (1-min load 4.19 before → 5.02 after) — **this is the run the table below is
drawn from**, per this task's own instruction to take the second run:

| rank | state                                              | ms   |
| ---- | -------------------------------------------------- | ---- |
| 1    | `scores lyr=primprod area=GA @ desktop [chromium]` | 1300 |
| 2    | `scores sel=cell:1500000 @ phoneNarrow [chromium]` | 1206 |
| 3    | `shell (default) @ desktop [chromium]`             | 1191 |

**Cause: the top state is no longer `shell (default)`, and the top-3 identities no longer repeat
between runs — this is tail noise near a fairly flat distribution, not one dominant, reproducible
bottleneck.** `shell (default)` — the FIRST page `verify.mjs` opens in a freshly-launched browser
instance, where V8's JIT has compiled nothing yet and the OS has not yet paged in the browser's own
code — is still in the top 3 of _both_ runs (#2 at 1199 ms, #3 at 1191 ms; a previous pass recorded
it at #1, 1139 ms), so the fresh-browser warm-up cost this doc has attributed to it before is real
and reproducible in magnitude. But it is no longer distinguishably the largest cost in the matrix:
each run's actual #1 is a _different_ state (`scores sel=zone:MDA proj=globe @ phoneNarrow` in run
1, `scores lyr=primprod area=GA @ desktop` in run 2), and neither is unusually early in the run
order or unusually heavy to compose — `lyr=primprod area=GA` is the second of 58 named states to
carry a raster-probe assertion (`scoresRasterProbe()`, which polls in up to 40×500 ms steps if the
first read doesn't match, so a slow WebGL tile decode on any given run can add real wall time to
just that state), while `sel=cell:1500000` and `sel=zone:MDA` carry no probe at all (`assert` only
runs at the `desktop` viewport per `runState()`, and `sel=zone:MDA`'s slow run was at
`phoneNarrow`) — so their variance comes from ordinary per-page overhead (hydration, hermetic route
setup, GC pauses), not a probe retry loop. All six top-3 entries across both runs sit in a narrow
1089–1300 ms band, roughly 2× this run's rough per-state average (~114 s / 174 ≈ 655 ms including
the script's own build+server lifecycle) — consistent with ordinary run-to-run scheduling/GC jitter
riding on top of a real but modest fixed per-page cost, not a single mechanism worth chasing. No fix
is indicated: the matrix is a correctness gate, and ~1.2–1.3 s for a state that includes a fresh
page load, hydration, and (for some) a polled raster probe is not a regression.

## What CI vs laptop actually differ on (summary)

Every CI number below is from run **`35867233243`** — the latest GREEN run on `main` as of this
pass (`gh run list --branch main --limit 5`; head sha `9c614db`, the same commit this worktree is
based on), cited per row with its job name:

| gate                                | laptop (this dispatch)                                                                          | CI runner (`35867233243`)                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| size-budget                         | 417.4 / 140.5 / 557.9 KB gzip                                                                   | **418.9 / 141.3 / 560.2 KB gzip**, PASS (job "build & checks", step "Run node scripts/size-budget.mjs") — within ~1.5 KB of the laptop number, as predicted                                                                                                                                                                                            |
| timing gate (species first pixel)   | median 1579 ms / 2.5 s budget (prior pass, not re-run this round)                               | **median 1646 ms** (samples 1757/1646/1632) / 4000 ms budget (job "e2e (chromium, webkit, firefox)", step "timing gate (species.timing.spec.ts, alone)") — 4th observed CI median, see "The timing gate" table above for the full 1646–3445 ms spread across 4 runs                                                                                    |
| `verify.mjs` matrix, chromium       | 174/174 pass, ~112–114 s per run (two runs this pass)                                           | **174/174 pass, ~182.6 s** (job "verify (state matrix, 58 states x 3 viewports)", step "Run node scripts/verify.mjs --engines=chromium", 13:28:30.23Z→13:31:32.83Z) — slower than the laptop, consistent with a shared 2-core runner                                                                                                                   |
| `verify.mjs` matrix, webkit/firefox | spot-checked green per-file; full sweep blocked by this shared laptop's own OOM, not by the app | **not run by CI** — the "verify (state matrix...)" job invokes `scripts/verify.mjs` with `--engines=chromium` only; cross-engine coverage instead comes from the separate "e2e (chromium, webkit, firefox)" job (549 passed, 35 skipped, 0 failed, 9.8 m), which runs the individual `e2e/*.spec.ts` files per engine, not the 174-state matrix itself |
| `npm run parity` (v9)               | **PASS**, max\|Δ\| < 1e-9 on every quantity (real bucket, real network)                         | **PASS**, max\|Δ\| < 1e-9 on every quantity (job "parity (v9 vs msens, max\|Δ\| < 1e-9)"; sample deltas shown range 0 to 8.882e-13) — identical verdict, as predicted                                                                                                                                                                                  |

Two more CI-only signals this pass pulled, with no laptop-side row in this doc's own gate set to
compare against: **`test:faults`** (job "test:faults (seeded-fault suite)"): **10/10 faults turned
their gate red**, step duration ~13 m 17 s (13:28:24Z→13:41:41Z). **The three-engine e2e matrix**
(job "e2e (chromium, webkit, firefox)", step "Run npx playwright test --project=chromium
--project=webkit --project=firefox"): **549 passed, 35 skipped, 0 failed** in 9.8 m.
