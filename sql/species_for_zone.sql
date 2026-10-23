-- species_for_zone.sql  --  the precomputed read of `app/zone_taxon.parquet`
--
-- R twin: the `use_precomputed` branch of msens::species_for_zone() (msens/R/calc.R:674-693),
--   whose .zone_taxon_normalize() (calc.R:533-566) atlas-1 already applied AT PUBLISH
--   (app_bundle.R:844-865), so this file is the WHERE clause and the canonical column list only.
-- Pinned by: tests/fixtures/parity/{v7,v9}/species_zone_*.json.
--
-- WHY PRECOMPUTED AND NOT LIVE. The live aggregation is sql/species_for_cells.sql over every cell
-- of the zone -- ~349k cells and ~10k species for `subregion_key = 'USA'`. In the browser that is
-- hundreds of megabytes of `cell_model` tiles for a number msens already computed once per release.
--
-- THE NORMALIZATION IS NOT REDONE HERE, ON PURPOSE. A published `zone_taxon` used to carry the
-- column names of its OWN generation (v1/v2 `rl_code`/`rl_score`; v3-v7 `rl_code` + `er_score` on
-- the RAW 1-100 scale + `mdl_seq`; v8 `er_code` + a fraction + `mdl_key`), so reading one back was a
-- schema question exactly like the live aggregation is -- and that is what broke the v7 "Table of
-- Species" with `Column er_code doesn't exist`. atlas-1's contract (D5: normalize at publish, not in
-- the browser) means `app/zone_taxon.parquet` is ONE schema for v1...v9 with `er_score` already a
-- 0-1 fraction. If a future vintage breaks that, it breaks in R, where the fixtures are.
--
-- The per-species and per-category shares are NOT selected from the file either, even though it
-- carries them: they are recomputed by sql/species_shares.sql over this result, which is the same
-- rule the cell path runs, so the two paths cannot drift (calc.R:562-565 recomputes them for the
-- same reason).
-- `taxon_id` IS NOT YET ONE TYPE across releases, unlike everything else here: v9 publishes it as
-- VARCHAR, v7 as a DOUBLE (atlas-1's .app_id_cast() runs for `taxon.parquet`, app_bundle.R:500-517,
-- but app_zone_taxon() does not apply it). A bare CAST of the v7 DOUBLE yields "22725044.0" on all
-- 16,153 rows -- every WoRMS link 404s and the join in sql/composition.sql matches nothing -- so the
-- trailing ".0" is stripped here. REPORTED TO THE R SIDE: this belongs in app_zone_taxon(), and this
-- expression should become a plain column read once it lands.
SELECT sp_cat,
       sp_common,
       sp_scientific,
       regexp_replace(CAST(taxon_id AS VARCHAR), '\.0$', '') AS taxon_id,
       taxon_authority,
       er_code,
       er_score,
       is_mmpa,
       is_mbta,
       mdl_key,
       area_km2,
       avg_suit
  FROM zone_taxon
 WHERE zone_fld = {{zone_fld}}
   AND zone_value = {{zone_value}}
