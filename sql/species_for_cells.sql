-- species_for_cells.sql  --  ONE BATCH of cell_model tiles, partially aggregated
--
-- R twin: msens:::.species_sql() (msens/R/calc.R:441-515) as called by
--   msens::species_for_cells() (calc.R:599-612), over the study-area-clipped cell set (D7b).
-- Pinned by: tests/fixtures/parity/{v7,v9}/species_cell_*.json (max|delta| < 1e-9 on area_km2,
--   avg_suit, pct_cat) and tests/analysis/batching.test.ts (batched == unbatched to 1e-12).
--
-- BOUNDED MEMORY (plan atlas-2 `engine/`). One `cell_model` tile is ~0.8 M rows (tile 1012:
-- 784,092 rows for 1,500 cells), so a 40-tile place is ~30 M rows and must never be materialized
-- whole. This query therefore runs per batch of <= 8 tiles and returns PARTIAL SUMS -- not R's
-- final `area_km2` / `avg_suit` -- so the caller can drop the batch's buffers and combine:
--
--     area_km2 = SUM(sum_area)                                    (a plain sum)
--     avg_suit = SUM(sum_val_pct) / SUM(sum_pct) / 100.0          (a ratio of sums)
--
-- Both are exact under partition, which is why batching cannot move the answer (the 1e-12 fixture).
-- Re-read calc.R:506-507: `sum(c.area_km2 * z.pct_covered / 100.0)` and
-- `sum(mc.val * z.pct_covered) / sum(z.pct_covered) / 100.0` -- the /100.0 stays with the caller's
-- combine, spelled once, in src/lib/analysis/combine.ts.
--
-- A species can legitimately appear in several batches (its model covers cells in several tiles),
-- so the identity columns are carried on every partial row and the combine groups by `mdl_key`.
--
-- THE TAXON FILTER IS SCORING ELIGIBILITY, NOT "HAS CELLS" (calc.R:445-449). v7 encoded it in
-- `is_ok`; v8 splits it into `is_valid_usa` + `is_marine`, and without them the table lists
-- non-marine and excluded taxa -- the v8 run surfaced a cane toad (amphibian) as the first row of
-- the study-area species table. atlas-1's publish step already applied `is_marine` and
-- `sp_cat NOT IN ('reptile','amphibian')` to `app/taxon.parquet` (app_bundle.R:544-576), and
-- published `valid_usa` as its own column (TRUE for every v1-v7 row, whose `is_ok` already baked
-- the cull in), so `t.valid_usa` here is exactly calc.R:512-513's WHERE clause and nothing about a
-- release's generation leaks into this file.
--
-- `er_score / 100.0` mirrors calc.R:491: `app/taxon.parquet` republishes the release's RAW 1-100
-- `er_score`, while the contract downstream (and `app/zone_taxon.parquet`) is a 0-1 fraction.
--
-- `cell_model_key` is sql/cell_model_key.sql or sql/cell_model_seq.sql, chosen by `boot.id_field`;
-- `cell` is the wide tile view (`c.area_km2`, calc.R:506); `place_cell_sa` is the clipped cell set.
SELECT t.sp_cat,
       t.common                                  AS sp_common,
       t.sci                                     AS sp_scientific,
       t.taxon_id,
       t.taxon_authority,
       t.er_code,
       t.er_score / 100.0                        AS er_score,
       t.is_mmpa,
       t.is_mbta,
       mc.mdl_key,
       sum(c.area_km2 * z.pct_covered / 100.0)   AS sum_area,
       sum(mc.val * z.pct_covered)               AS sum_val_pct,
       sum(z.pct_covered)                        AS sum_pct
  FROM cell_model_key mc
  JOIN place_cell_sa z ON z.cell_id = mc.cell_id
  JOIN cell c          ON c.cell_id = mc.cell_id
  JOIN taxon t         ON t.key = mc.mdl_key
 WHERE t.valid_usa
 GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
