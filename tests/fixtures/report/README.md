# `tests/fixtures/report/` — the R reference for atlas-7's numbers gate

Six files, three places × two releases, each carrying **both** the input a caller hands
`buildReport()` (the already-run query results) and the **expected** output R derives from it.
`tests/lib/report/numbers.test.ts` drives `src/lib/report/model.ts` through all six; scores are
compared within `1e-9`, counts and the top-20 order **exactly**.

**R is the truth here.** If the gate goes red, the TypeScript is wrong until proven otherwise — the
fixture is never edited to match it.

## Regenerate

```sh
cd <the atlas repo root>
export TMPDIR=/tmp                       # vitest/R both want a writable temp dir
Rscript scripts/parity/report_fixtures.R          # both versions
Rscript scripts/parity/report_fixtures.R v9       # one version
```

`npm run report:fixtures` is the same command. Roughly 6 minutes per version on an M-series laptop
(most of it `species_for_cells()` over `cell_model` tiles).

Everything is **read-only**: `msens` is `devtools::load_all()`ed from the `atlas-contract`
worktree — never installed into the system library, which the v7.1 release session depends on — and
every DuckDB is opened `READ_ONLY`. Nothing is published and no S3 object is written.

### What it reads

| default                                                                              | override      | what                                                                        |
| ------------------------------------------------------------------------------------ | ------------- | --------------------------------------------------------------------------- |
| `.claude/worktrees/contract/msens`                                                   | `MSENS_DIR`   | the msens worktree to `load_all()`                                          |
| `~/_big/msens/derived/{ver}/sdm.duckdb`                                              | `DERIVED_DIR` | the release database                                                        |
| `~/_big/msens/derived/{ver}/cell_model/` or `…/{ver}/marine-atlas/serve/cell_model/` | —             | the species tiles (v7's are local-only)                                     |
| `.claude/worktrees/contract/workflows/_output/app_bundle/{ver}/`                     | `BUNDLE_DIR`  | `boot.json` + `zone_taxon.parquet` (the objects the browser actually reads) |
| `tests/fixtures/report`                                                              | `OUT_DIR`     | where the files land                                                        |

## The places

| id                  | kind  | geometry                                                            | why                                                                                                          |
| ------------------- | ----- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `gaa`               | zone  | `boot.zones.programarea.GAA` + `zone_taxon.parquet`                 | the precomputed path: published `zone_metric`, and the species table msens already computed once per release |
| `gulf_rectangle`    | drawn | `tests/fixtures/upload/gulf_rectangle.wkt` (−93.5 −88.5, 26.5 29.5) | an ordinary drawn place, 6,000 cells touched, ~3.6 % of them outside the study area                          |
| `aleutian_dateline` | drawn | `tests/fixtures/upload/aleutian_dateline.wkt` (`178 → −177`)        | the antimeridian: written wrapped, unwrapped by `place_encode()` before coverage (master plan D8's addendum) |

Every drawn place goes through `place_decode(place_encode(geometry))` first, because **every
analysis runs on the decoded geometry** (D8): a link that cannot carry the ring cannot reproduce its
numbers, and the quantized ring gives edge cells different `pct_covered` than the raw one — enough
to blow a `1e-9` gate on its own.

## What is in a file

- `input.components` — `msens::scores_for_cells(con, cells, blend = TRUE, denominator =
"study_area")` for a drawn place; `boot.zones[unit][key].metrics` (the published `zone_metric`,
  post-weight, with its `_prepctareaweighting` twin turned into `coverage` + `mean_where_present`)
  for the zone place.
- `input.n_cells` / `input.area_km2` / `input.study_area_pct` — D7b's **one** cell set: the touched
  cells inside the study area. `input.n_cells_touched` is the set before that clip.
- `input.species` — `species_for_cells()` / `species_for_zone()`, **columnar** (`{n, columns,
values}`) because the GAA list is ~6,300 rows and repeating 16 keys per row triples the file.
  `tests/lib/report/fixtures.ts` is the only reader of that shape.
- `input.boot_zone` (zone fixture only) — the raw `boot.zones` row, so the TypeScript's own
  `zoneComponents()` derivation is measured against R's rather than handed R's answer.
- `expected.composite` — `msens::mean_score()`; for the zone place it equals
  `expected.published_composite` (the release's own `score_…_equalweights`) exactly.
- `expected.counts` — `er_consolidate()` run **verbatim from `api/report_area_child.qmd:45-95`**,
  unformatted (the thousands comma is a display step the TypeScript does separately).
- `expected.top20` / `expected.full_order` — the two orders, as R's `arrange()` produced them.

Numbers are written at **17 significant digits** (`digits = I(17)`), the shortest form that
round-trips an IEEE-754 double; 15 digits loses ~5e-9 on a Program-Area-sized `area_km2`, which is
over this gate's own tolerance before any TypeScript has run.

## The two GAA numbers

`report_gaa.json` carries a `traced_as_custom_place` block: the **same** Program Area, traced as a
drawn place instead of read from `zone_metric`. On **v9** that is composite **40.498196** traced vs
**40.448395** published, **+0.049801** — the atlas-6 reviewer's 40.4982 vs 40.4484, reproduced. On
**v7** it is 33.100661 vs 33.093043, **+0.007617**.

This is not a disagreement to fix. A zone place reports its release's published numbers; a custom
place reports the D7b-clipped blend over its own cells, and the outline is a _polygon_ rasterised
onto the grid rather than the zone's own `zone_cell` rows. Master plan D7b bounds it: "a traced
Program Area still reproduces its published composite within 0.08 points (median 0.03)". Both
numbers are in the fixture so a reader can see which kind of place produces which.
