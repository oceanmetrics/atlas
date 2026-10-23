-- cell_model_seq.sql  --  the v1-v7 branch (`boot.id_field = 'mdl_seq'`)
--
-- R twin: the `else` arm of msens:::.species_sql() (msens/R/calc.R:474-479).
-- Pinned by: tests/fixtures/parity/v7/species_cell_*.json (v7 IS this branch).
--
-- v7's `cell_model` stores `mdl_seq`, which `taxon` already joins on directly, so there is no
-- `model` table to go through and no `mdl_id` anywhere. Cast to VARCHAR so `mdl_key` has ONE type
-- across releases (calc.R:505 does the same cast for the same reason).
--
-- See sql/cell_model_key.sql for the v8+ branch and why this is two files.
SELECT cm.cell_id,
       cm.val,
       CAST(cm.mdl_seq AS VARCHAR) AS mdl_key
  FROM cell_model cm
