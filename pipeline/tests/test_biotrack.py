import numpy as np
import pandas as pd
import pytest

from atlas_pipeline import biotrack as bt


def test_parse_shp_name_maps_group_keys():
  assert bt.parse_shp_name("Ind_WeightedRichShape_summer_Red-listed.shp") == ("WeightedRichShape", "summer", "redlisted")
  assert bt.parse_shp_name("Ind_RichShape_winter_All") == ("RichShape", "winter", "all")
  assert bt.parse_shp_name("Ind_CumulativeUncertainty_summer_Shark.shp") == ("CumulativeUncertainty", "summer", "shark")


def test_parse_shp_name_rejects_unknown():
  with pytest.raises(ValueError):
    bt.parse_shp_name("Ind_RichShape_spring_All.shp")
  with pytest.raises(ValueError):
    bt.parse_shp_name("Ind_RichShape_summer_Bird.shp")


def test_all_group_keys_are_the_six_lowercase_keys():
  assert sorted(bt.GROUP_KEYS.values()) == sorted(["all", "fish", "ray", "redlisted", "shark", "turtle"])
  assert bt.GROUPS == sorted(bt.GROUPS)


def test_column_name_pattern():
  assert bt.column_name("shark", "summer", "richness") == "shark_summer_richness"
  assert bt.column_name("shark", "summer", "richness_raw") == "shark_summer_richness_raw"
  with pytest.raises(ValueError):
    bt.column_name("bird", "summer", "richness")


def test_public_metrics_map_to_ecoregion_weighted_fields():
  assert bt.FIELD_SUFFIX[("WeightedRichShape", "ecrg_rc")] == "richness"
  assert bt.FIELD_SUFFIX[("CumulativeUncertainty", "ecrg_ncr")] == "uncertainty"
  assert bt.FIELD_SUFFIX[("RichShape", "plt_dt_m_")] == "richness_raw"
  assert bt.FIELD_SUFFIX[("RichShape", "plt_dt_s_")] == "richness_sd"
  assert bt.FIELD_SUFFIX[("WeightedRichShape", "htspt_c")] == "hotspot_class"
  assert bt.FIELD_SUFFIX[("CumulativeUncertainty", "Uncrt_c")] == "uncertainty_cum"
  assert bt.FIELD_SUFFIX[("CumulativeUncertainty", "Uncrt_s")] == "uncertainty_scaled"
  assert bt.FIELD_SUFFIX[("CumulativeUncertainty", "ecrg_ncl")] == "uncertainty_class"


def test_shp_to_wide_renames_fields_and_keeps_fid():
  raw = pd.DataFrame({"FID": [0.0, 1.0], "plt_dt_m_": [3.0, 1.5], "plt_dt_s_": [1.0, 0.5]})
  w = bt.shp_to_wide(raw, "RichShape", "summer", "shark")
  assert list(w.columns) == ["FID", "shark_summer_richness_raw", "shark_summer_richness_sd"]
  assert w["FID"].tolist() == [0, 1] and w["FID"].dtype == "int64"
  assert w["shark_summer_richness_raw"].tolist() == [3.0, 1.5]


def test_shp_to_wide_missing_field_is_an_error():
  with pytest.raises(ValueError):
    bt.shp_to_wide(pd.DataFrame({"FID": [0]}), "RichShape", "summer", "all")


def test_read_values_merges_products_by_fid(tmp_path):
  names = {"Ind_RichShape_summer_Shark.shp": ["plt_dt_m_", "plt_dt_s_"],
           "Ind_WeightedRichShape_summer_Shark.shp": ["mx_mn_r", "ecrg_rc", "htspt_c"]}
  for n in names:
    (tmp_path / n).write_text("")
  def reader(path):
    cols = names[path.name]
    d = {"FID": [2.0, 0.0, 1.0]}   # unsorted on purpose
    for c in cols:
      d[c] = ["(0,1]"] * 3 if c == "htspt_c" else [float(i) for i in (2, 0, 1)]
    return pd.DataFrame(d)
  w = bt.read_values(tmp_path, reader=reader)
  assert w["FID"].tolist() == [0, 1, 2]
  assert "shark_summer_richness" in w.columns and "shark_summer_richness_raw" in w.columns
  assert w["shark_summer_richness"].tolist() == [0.0, 1.0, 2.0]


@pytest.mark.parametrize("p,expected", [
  (0.0, "Unlikely"), (0.5999, "Unlikely"), (0.6, "Likely"), (0.7999, "Likely"),
  (0.8, "Very likely"), (1.0, "Very likely"), (np.nan, "Unlikely")])
def test_class_thresholds(p, expected):
  assert bt.class_from_prob(p) == expected


def test_numeric_suffixes_exclude_class_columns():
  assert not set(bt.NUMERIC_SUFFIXES) & set(bt.CLASS_SUFFIXES)
  assert len(bt.SUFFIXES) == 9
