-- cell_model_key.sql  --  the v8+ branch (`boot.id_field = 'mdl_key'`)
--
-- R twin: the `if ("mdl_id" %in% cm_cols)` arm of msens:::.species_sql() (msens/R/calc.R:466-473).
-- Pinned by: tests/fixtures/parity/v9/species_cell_*.json (v9 IS this branch) and the id_field
--   seeded fault in tests/engine/sqlTwins.test.ts.
--
-- The ONE generation fact the `app/` contract allows the browser to know (atlas-1's review
-- checklist): which column the `cell_model` join keys on. v8+ store the compact integer `mdl_id`
-- and join `model` back to the STABLE `mdl_key` that `taxon.key` carries; v1-v7 store `mdl_seq`
-- directly (sql/cell_model_seq.sql). Assuming v8's shape on a v7 release is not a wrong number, it
-- is `Binder Error: Column "mdl_id" does not exist on left side of join` (calc.R:463-465), which is
-- why the two branches are two files chosen by `boot.id_field` and never a hard-coded column.
--
-- Both files publish the SAME three columns under the SAME view name (`cell_model_key`), so
-- sql/species_for_cells.sql is generation-blind.
SELECT cm.cell_id,
       cm.val,
       CAST(mo.mdl_key AS VARCHAR) AS mdl_key
  FROM cell_model cm
  JOIN model mo ON mo.mdl_id = cm.mdl_id
