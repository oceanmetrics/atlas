-- cells_in_study_area.sql
--
-- R twin: msens::cells_in_study_area() (msens/R/place.R:331-340), master-plan D7b.
-- Pinned by: tests/fixtures/parity/{v7,v9}/scores_*.json (the `n_cells_sa` / `w_all` fields, which
--   a removed clip changes on every polygon) and tests/engine/sqlTwins.test.ts.
--
-- ONE cell set per place drives scores, species, area and N cells: the touched cells that are
-- inside the release's study area. "Absent means zero" is only sound where a value could have
-- existed, so land and foreign waters must not enter a coverage-blended score as zeros -- a place
-- half over land would otherwise score half of what it is.
--
-- `coalesce(in_usa, TRUE)`, NOT a bare `in_usa` (place.R:334 says so in as many words): v1-v7 have
-- no `in_usa` column in their `cell` table at all, so atlas-1's wide tile writes the column as all
-- NULL for them (measured: 662,075 of 662,075 v7 rows NULL, 0 of 946,557 on v9). A bare `in_usa`
-- there is NULL for every row, the WHERE keeps nothing, and v7 answers an EMPTY place -- no error,
-- no warning, just zero cells. The release whose `cell` table IS already the study area must not be
-- emptied by the absence of the column that says so.
--
-- `place_cell` is the app-built (cell_id, pct_covered) table this place's coverage produced
-- (src/lib/analysis/sources.ts placeCellTable(), every number through lit()); `cell` is the view
-- over the wide `app/cell/tile={t}/data_0.parquet` tiles.
SELECT z.cell_id,
       z.pct_covered
  FROM place_cell z
  JOIN cell c ON c.cell_id = z.cell_id
 WHERE coalesce(c.in_usa, TRUE)
 ORDER BY z.cell_id
