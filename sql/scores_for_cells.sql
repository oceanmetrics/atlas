-- scores_for_cells.sql
--
-- R twin: msens::scores_for_cells(blend = TRUE, denominator = "study_area")
--   (msens/R/calc.R:286-334), with .component_of() (calc.R:224-228) and the study-area clip of
--   cells_in_study_area() (place.R:331-340) applied by sql/cells_in_study_area.sql first.
-- Pinned by: tests/fixtures/parity/{v7,v9}/scores_*.json and tracing_*.json (GAA reproduces its
--   published composite within 0.5 on v9; the OLD formula must MISS GEO by >= 49.14 on v9 / 58.95
--   on v7 -- see the denominator note below, which is the whole gate).
--
-- THE BLEND (master-plan D7, decided 2026-09-20). A published `zone_metric` is exactly
--   sum(coalesce(val, 0) * pct) / sum(pct)
-- over EVERY cell of the zone -- verified to reproduce all 795 v9 rows. The old `scores_for_cells()`
-- divided by the weight of only the cells that HAVE the metric, which is the `_prepctareaweighting`
-- intermediate, not the published number. Over the 20 v9 Program Areas the old formula reads high by
-- up to 49.1448 (turtle in GEO, 1.41 % coverage) and is over 0.5 on 12 of 20.
--
-- HOW THAT IS SPELLED HERE. `sum(coalesce(v, 0) * pct)` and `sum(v * pct)` are the SAME number (a
-- NULL contributes nothing either way), so the blend is not in the NUMERATOR at all: it is the
-- DENOMINATOR. `w_all` is the weight of every touched cell inside the study area; `w_present` is the
-- weight of just the cells carrying this metric. Dividing by `w_present` instead of `w_all` IS the
-- old formula, and that one-token change is what the parity harness's RED side detects.
--
-- WIDE, NOT LONG. Metrics are addressed by `metric_key`: the tile carries one DOUBLE column per
-- scored key (NULL = no value) and nothing joins on a `metric_seq` that is dropped and recreated
-- every release. The `cols` RAW slot is the ident()-validated list of those component columns
-- (sql.ts's RAW_ALLOWLIST); `metric_pattern` is the `_ecoregion_rescaled$` regex calc.R:287 defaults
-- to, and its `$` is what excludes the `_prepctareaweighting` rows.
--
-- A COMPONENT WITH NO VALUE ANYWHERE GETS NO ROW, never a zero (calc.R:323) -- UNPIVOT drops NULL
-- values, so such a key never reaches `agg` and `w_present > 0` is belt and braces. The caller
-- reports it as NULL and the composite is the mean of the non-NULL components (msens::mean_score(),
-- calc.R:714-716, weighted by `even`, which is 1 here exactly as in R).
--
-- `coverage` is the share of the denominator weight held by cells that carry the component and
-- `mean_where_present` is the mean over just those cells, so the identity
-- `score = coverage * mean_where_present` holds and a panel can say "17.7, over 1.4 % of the place"
-- rather than implying 17.7 everywhere (calc.R:262-268).
WITH c AS (
  SELECT z.cell_id,
         z.pct_covered,
         {{cols}}
    FROM place_cell_sa z
    JOIN cell ON cell.cell_id = z.cell_id
),
w AS (
  SELECT sum(pct_covered) AS w_all
    FROM c
),
long AS (
  UNPIVOT c
     ON {{cols}}
   INTO NAME metric_key VALUE v
),
agg AS (
  SELECT metric_key,
         sum(v * pct_covered) AS num_present,
         sum(pct_covered)     AS w_present
    FROM long
   WHERE regexp_matches(metric_key, {{metric_pattern}})
   GROUP BY metric_key
)
SELECT agg.metric_key,
       agg.num_present / w.w_all              AS score,
       regexp_replace(
         regexp_replace(
           regexp_replace(agg.metric_key, 'extrisk_', ''),
           '_ecoregion_rescaled', ''),
         '_', ' ')                            AS component,
       1.0                                    AS even,
       agg.w_present / w.w_all                AS coverage,
       agg.num_present / agg.w_present        AS mean_where_present,
       agg.w_present                          AS w_present,
       w.w_all                                AS w_all
  FROM agg
 CROSS JOIN w
 WHERE agg.w_present > 0
   AND regexp_replace(
         regexp_replace(
           regexp_replace(agg.metric_key, 'extrisk_', ''),
           '_ecoregion_rescaled', ''),
         '_', ' ') <> 'all'
 ORDER BY agg.metric_key
