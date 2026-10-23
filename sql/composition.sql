-- composition.sql  --  the taxonomy join behind the species-composition treemap
--
-- R twin: the WoRMS hierarchy of `app/taxonomy.parquet` (msens/R/app_bundle.R's taxonomy table,
--   atlas-1's contract row "taxonomy.parquet ... restricted to this release's taxa") joined onto a
--   species table from msens:::.species_shares() (msens/R/calc.R:569-579). There is no single R function to
--   port: R's apps read the same CSV and group it in the client, which is exactly the duplication
--   atlas-1's contract removes.
-- Pinned by: tests/fixtures/parity/{v7,v9}/composition_*.json (the rolled-up per-rank
--   `suit_er_area` for a zone, which is what the treemap's rectangles are sized by).
--
-- `species_sel` is whichever species table is on screen -- sql/species_shares.sql over a zone or
-- over a place's cells -- so the treemap always describes the SAME selection as the table beside it
-- (D7b's one cell set), and this file never has to know which of the two produced it.
--
-- LEFT JOIN, never INNER. `taxonomy.parquet` is the WoRMS hierarchy restricted to the release's
-- taxa, and a taxon whose WoRMS record has no hierarchy row (an unmatched id, a taxon published
-- from a non-WoRMS authority) must still appear in the treemap under its `sp_cat` rather than
-- vanish from a plot whose whole job is to show the composition of the selection. `coalesce(...,
-- 'unknown')` is what makes such a row land in a visible box instead of a NULL-keyed one.
--
-- The ranks are the fixed six the treemap nests (`taxonomy.parquet` carries 30+, most of them
-- sparse); "Order" is quoted because it is a reserved word, and atlas-1 published it with that exact
-- capitalisation.
--
-- `suit_er_area` is the size measure (not `area_km2`): it is what the flower and the table already
-- weight by -- suitability x extinction risk x area -- so a box's size means the same thing as the
-- number in the row it came from.
SELECT s.mdl_key,
       s.sp_cat,
       coalesce(x."Kingdom", 'unknown') AS kingdom,
       coalesce(x."Phylum",  'unknown') AS phylum,
       coalesce(x."Class",   'unknown') AS class,
       coalesce(x."Order",   'unknown') AS "order",
       coalesce(x."Family",  'unknown') AS family,
       coalesce(x."Genus",   'unknown') AS genus,
       s.sp_scientific,
       s.sp_common,
       s.taxon_id,
       s.area_km2,
       s.avg_suit,
       s.suit_er_area,
       s.pct_cat
  FROM species_sel s
  LEFT JOIN taxonomy x ON x.taxon_id = s.taxon_id
 ORDER BY s.sp_cat, s.sp_scientific
