-- cell_value.sql  --  one clicked cell, one caller-chosen column
--
-- Used by the scores-lens click popup ONLY (atlas-4 §6.6 fix round 3: the popup shows "the
-- displayed layer's value", which may be ANY layer category -- composite, component or raw --
-- not only the `_ecoregion_rescaled$` component set `cell_components.sql` reads for the flower.
-- A second, single-column read keeps that file (and the parity fixtures pinned to its exact
-- shape) untouched.
--
-- Numbers never come from the tile server (master-plan D4): the value is read from the wide `cell`
-- Parquet tile the click already fetched for `cell_components.sql` (`AnalysisSources#cellTiles`),
-- never by sampling a rendered COG pixel.
--
-- `cols` is the ident()-validated single-column reference (sql.ts's RAW_ALLOWLIST); a cell_id not
-- in any loaded tile returns zero rows, which the caller reads as "no value" rather than an error.
SELECT {{cols}} AS val
  FROM cell
 WHERE cell_id = {{cell_id}}
