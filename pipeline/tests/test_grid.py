import json
import shutil

import geopandas as gpd
import numpy as np
import pandas as pd
import pytest
import shapely

from atlas_pipeline import grid


def test_fid_only_drops_every_other_attribute(hexes):
  g = hexes.assign(extra=1, other="x")
  assert list(grid.fid_only(g).columns) == ["FID", "geometry"]
  assert grid.fid_only(g)["FID"].dtype == "int64"


def test_hex_centroids_are_fid_lon_lat_inside_each_hexagon(hexes):
  c = grid.hex_centroids(hexes)
  assert list(c.columns) == ["FID", "lon", "lat"] and c["FID"].dtype == "int64"
  assert c["FID"].tolist() == [0, 1, 2]
  for row, geom in zip(c.itertuples(), hexes.geometry):
    assert geom.contains(shapely.Point(row.lon, row.lat))
  assert abs(c.loc[0, "lon"] - (-80.6)) < 1e-6 and abs(c.loc[0, "lat"] - 28.4) < 1e-6


def test_crosswalk_weights_sum_to_one_per_fid(hexes):
  xw = grid.build_crosswalk(hexes)
  assert list(xw.columns) == ["FID", "h3", "weight", "overlap_km2"]
  assert set(xw["FID"]) == {0, 1, 2}
  assert np.allclose(xw.groupby("FID")["weight"].sum(), 1.0)
  assert (xw["weight"] > 0).all() and (xw["overlap_km2"] > 0).all()
  assert xw["h3"].str.len().eq(15).all()   # h3 index strings


def test_crosswalk_overlap_matches_hex_area(hexes):
  xw = grid.build_crosswalk(hexes)
  area = hexes.to_crs(grid.AREA_CRS).area / 1e6
  tot = xw.groupby("FID")["overlap_km2"].sum()
  assert np.allclose(tot.loc[[0, 1, 2]].values, area.values, rtol=1e-6)


def test_crosswalk_sliver_gets_a_cell_with_weight_one():
  tiny = shapely.Polygon([(-80.6, 28.4), (-80.6 + 1e-7, 28.4), (-80.6, 28.4 + 1e-7)])
  g = gpd.GeoDataFrame({"FID": [5]}, geometry=[tiny], crs=4326)
  xw = grid.build_crosswalk(g)
  assert xw["FID"].tolist() == [5] * len(xw) and len(xw) >= 1
  assert np.isclose(xw["weight"].sum(), 1.0)


def test_aggregate_to_h3_is_area_weighted_mean():
  xw = pd.DataFrame({"FID": [0, 0, 1], "h3": ["a", "b", "a"], "weight": [0.5, 0.5, 1.0], "overlap_km2": [1.0, 1.0, 3.0]})
  vals = pd.DataFrame({"FID": [0, 1], "v": [10.0, 20.0]})
  out = grid.aggregate_to_h3(vals, xw, ["v"]).set_index("h3")["v"]
  assert out["a"] == pytest.approx((10 * 1 + 20 * 3) / 4)
  assert out["b"] == pytest.approx(10.0)


def test_aggregate_to_h3_skips_missing_values():
  xw = pd.DataFrame({"FID": [0, 1], "h3": ["a", "a"], "weight": [1.0, 1.0], "overlap_km2": [1.0, 1.0]})
  vals = pd.DataFrame({"FID": [0, 1], "v": [np.nan, 4.0]})
  assert grid.aggregate_to_h3(vals, xw, ["v"]).set_index("h3")["v"]["a"] == 4.0
  vals = pd.DataFrame({"FID": [0, 1], "v": [np.nan, np.nan]})
  assert np.isnan(grid.aggregate_to_h3(vals, xw, ["v"])["v"].iloc[0])


def test_read_hex_accepts_lowercase_fid_and_fixes_validity(tmp_path):
  bowtie = shapely.Polygon([(0, 0), (1, 1), (1, 0), (0, 1), (0, 0)])
  src = gpd.GeoDataFrame({"fid": [3, 1]}, geometry=[bowtie, shapely.box(2, 2, 3, 3)], crs=4326)
  p = tmp_path / "fid.geojson"
  src.to_file(p, driver="GeoJSON")
  g = grid.read_hex(p)
  assert g["FID"].tolist() == [1, 3] and g.geometry.is_valid.all()


@pytest.mark.tippecanoe
@pytest.mark.skipif(shutil.which("tippecanoe") is None or shutil.which("pmtiles") is None, reason="needs tippecanoe + pmtiles")
def test_pmtiles_has_fid_as_only_attribute(hexes, tmp_path):
  g = hexes.assign(ecrg_rc=0.5, shark_summer_richness=0.3)
  out = tmp_path / "hex.pmtiles"
  info = grid.build_pmtiles(g, out, flags=["-Z0", "-z6", "--detect-shared-borders", "--no-tiny-polygon-reduction",
                                           "--no-feature-limit", "--no-tile-size-limit", "--force", "-l", "hex"])
  assert out.exists() and info["bytes"] > 0
  assert grid.pmtiles_attribute_names(out) == ["FID"]
  md = grid.pmtiles_header(out)
  assert [v["id"] for v in md["vector_layers"]] == ["hex"]
  assert md["vector_layers"][0]["fields"]["FID"] == "Number"
