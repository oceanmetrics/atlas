-- species_shares.sql  --  the per-species and per-category contribution shares
--
-- R twin: msens:::.species_shares() (msens/R/calc.R:569-579), verbatim.
-- Pinned by: tests/fixtures/parity/{v7,v9}/species_zone_*.json and species_cell_*.json
--   (max|delta| < 1e-9 on pct_cat).
--
-- ONE rule for both paths, which is the point: the zone path (sql/species_for_zone.sql) and the
-- cell path (sql/species_for_cells.sql + the bounded-memory combine) both land in `species_agg` and
-- then come through here, so a change to the share definition cannot reach one and miss the other.
-- R has the same single implementation and calls it from .zone_taxon_normalize(), species_for_cells()
-- and species_for_zone() alike.
--
-- `sum(...) OVER (PARTITION BY sp_cat)` is dplyr's group_by(sp_cat) |> mutate(cat_suit_er_area =
-- sum(suit_er_area, na.rm = TRUE)): a window, not an aggregate, because the per-species rows survive.
-- SQL's `sum()` already skips NULLs, which is R's `na.rm = TRUE`.
--
-- ORDER BY sp_cat, sp_scientific is calc.R:578's arrange(), and it is part of the contract: the
-- parity harness compares row for row.
SELECT sp_cat,
       sp_common,
       sp_scientific,
       taxon_id,
       taxon_authority,
       er_code,
       er_score,
       is_mmpa,
       is_mbta,
       mdl_key,
       area_km2,
       avg_suit,
       avg_suit * er_score                             AS suit_er,
       avg_suit * er_score * area_km2                  AS suit_er_area,
       sum(avg_suit * er_score * area_km2)
         OVER (PARTITION BY sp_cat)                    AS cat_suit_er_area,
       (avg_suit * er_score * area_km2)
         / sum(avg_suit * er_score * area_km2)
             OVER (PARTITION BY sp_cat)                AS pct_cat
  FROM species_agg
 ORDER BY sp_cat, sp_scientific
