-- the one split file of the fixture release over 256 KiB (the live release has 14 over it): species_flat/res=3/
-- p=812abffffffffff.parquet, six res-3 hexagons (832a98, 99, 9a, 9c, 9d, 9e) of 6,000 species each, row groups of
-- 3,000 rows (two per hexagon), sorted by cell id. Hash-made columns, so it is the same on every run; its AphiaIDs
-- are not in the fixture lookup (an unnamed species). Run from the repo root:
--   duckdb < tests/fixtures/obis_h3/scripts/make_large_split.sql
COPY (
  SELECT c.cell_id::BIGINT AS cell_id,
         (hash(c.cell_id, s) % 1000000)::INTEGER AS name_key,
         (1000000 + s)::BIGINT AS aphiaid,
         (1 + hash(c.cell_id, s, 'n') % 5000)::BIGINT AS n,
         (1950 + hash(c.cell_id, s, 'a') % 40)::SMALLINT AS year_min,
         (1990 + hash(c.cell_id, s, 'b') % 35)::SMALLINT AS year_max,
         3::BIGINT AS res
  FROM (SELECT unnest([590720937079341055, 590721005798817791, 590721074518294527, 590721211957247999, 590721280676724735, 590721349396201471]) AS cell_id) AS c,
       generate_series(1, 6000) AS g(s)
  ORDER BY cell_id, aphiaid
) TO 'tests/fixtures/obis_h3/species_flat/res=3/p=812abffffffffff.parquet'
  (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 3000);
