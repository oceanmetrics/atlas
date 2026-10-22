"""the platform STAC profiles as a build check (atlas_pipeline/profiles.py): one test per rule, synthetic documents.

Gate and its planted faults (every gate ships with a seeded fault): a broken `atlas:flower`, an Item without
`atlas:dims`, a COG Item without `proj:code`, a COG band without `statistics` -> reported with the document id;
`check_staging` -> fails the build on any of them. These tests need the platform schemas (`../platform` beside this
repo, or `$OM_SCHEMAS_DIR`): without them they fail, naming the three places searched."""

import copy
import json

import pytest

from atlas_pipeline import cli, profiles, stac

STATS = {"minimum": 0.0, "maximum": 4.0, "mean": 1.5, "stddev": 0.5, "valid_percent": 80.0}
COG = "image/tiff; application=geotiff; profile=cloud-optimized"


def collection():
  return {
    "type": "Collection", "stac_version": "1.1.0", "id": "demo", "description": "d", "license": "CC-BY-4.0",
    "extent": {"spatial": {"bbox": [[-1, -1, 1, 1]]}, "temporal": {"interval": [[None, None]]}},
    "cube:dimensions": {"species": {"type": "other", "values": ["a", "b"]}},
    "atlas:flower": {"dimension": "species", "composite": "b"},
    "links": [],
  }


def item(iid="demo_a"):
  return {
    "type": "Feature", "stac_version": "1.1.0", "id": iid, "collection": "demo", "bbox": [-1, -1, 1, 1],
    "geometry": None, "links": [],
    "properties": {"datetime": None, "proj:code": "EPSG:4326", "atlas:dims": {"species": "a"},
                   "sdm:response_type": "density", "sdm:method": "density_surface_model",
                   "sdm:source_authority": "demo", "sdm:temporal_interval": "static"},
    "assets": {"cog": {"href": "./a.tif", "type": COG, "roles": ["data"], "atlas:bidx": 1,
                       "raster:bands": [{"name": "v", "data_type": "float32", "nodata": None, "statistics": STATS}]}},
  }


# ---- schema_dir ----

def test_schema_dir_takes_the_env_var_first(tmp_path, monkeypatch):
  monkeypatch.setenv(profiles.SCHEMA_ENV, str(tmp_path))
  assert profiles.schema_dir() == tmp_path


def test_schema_dir_env_var_that_is_not_a_directory_is_an_error_naming_the_places(tmp_path, monkeypatch):
  monkeypatch.setenv(profiles.SCHEMA_ENV, str(tmp_path / "nope"))
  with pytest.raises(FileNotFoundError) as e:
    profiles.schema_dir()
  assert "$OM_SCHEMAS_DIR" in str(e.value) and "node_modules/@oceanmetrics/catalog/schemas" in str(e.value)


def test_schema_dir_falls_back_to_node_modules_then_the_sibling_checkout(tmp_path, monkeypatch):
  monkeypatch.delenv(profiles.SCHEMA_ENV, raising=False)
  repo = tmp_path / "atlas"
  sibling = tmp_path / "platform" / "packages" / "catalog" / "schemas"
  sibling.mkdir(parents=True)
  assert profiles.schema_dir(repo) == sibling
  nm = repo / "node_modules" / "@oceanmetrics" / "catalog" / "schemas"
  nm.mkdir(parents=True)
  assert profiles.schema_dir(repo) == nm


def test_schema_dir_missing_everywhere_names_all_three_places(tmp_path, monkeypatch):
  monkeypatch.delenv(profiles.SCHEMA_ENV, raising=False)
  with pytest.raises(FileNotFoundError) as e:
    profiles.schema_dir(tmp_path / "atlas")
  msg = str(e.value)
  assert "$OM_SCHEMAS_DIR (unset)" in msg and "<repo>/node_modules/@oceanmetrics/catalog/schemas" in msg
  assert "<repo>/../platform/packages/catalog/schemas" in msg


# ---- check_profiles ----

def test_a_valid_collection_and_item_pass():
  assert profiles.check_profiles(collection(), [item()]) == []


def test_the_shipped_writers_pass_their_profiles():
  """the CCE collection and its items, written by stac.cce_*, with statistics, pass atlas-collection, sdm-dossier,
  atlas-item and cog."""
  rows = [{"worms_id": 137092, "scientific_name": "Megaptera novaeangliae", "species": "Humpback whale", "cog": "h.tif",
           "density_min": "0.0001", "density_p98": "0.004", "density_max": "0.006", "cv_median": "0.31", "n_cells": "12",
           "mdl_key": "k"}]
  base = stac.restricted_base_url("01K8ZZZZZZZZZZZZZZZZZZZZZZ", stac.CCE_ID)
  items = stac.cce_items(rows, [-126, 38, -123, 40], base, None, [STATS, STATS])
  assert profiles.check_profiles(stac.cce_collection(rows, [-126, 38, -123, 40], base), items) == []


def test_a_broken_flower_is_reported_with_the_collection_id():
  c = collection()
  c["atlas:flower"] = {"dimension": "species"}   # no composite
  bad = profiles.check_profiles(c, [item()])
  assert bad and all(m.startswith("demo: [atlas-collection] ") for m in bad)
  assert any("atlas:flower" in m for m in bad)


def test_an_item_without_atlas_dims_is_reported_with_the_item_id():
  it = item("demo_x")
  del it["properties"]["atlas:dims"]
  bad = profiles.check_profiles(collection(), [it])
  assert len(bad) == 1 and bad[0].startswith("demo_x: [atlas-item] ") and "atlas:dims" in bad[0]


def test_a_collection_with_sdm_response_type_is_checked_against_sdm_dossier():
  c = collection()
  c["sdm:response_type"] = "habitat"   # sdm:method, sdm:source_authority and sdm:temporal_interval are missing
  assert any("[sdm-dossier]" in m for m in profiles.check_profiles(c, []))
  assert not any("[sdm-dossier]" in m for m in profiles.check_profiles(collection(), []))


def test_a_data_cog_item_is_checked_against_cog_and_an_item_without_one_is_not():
  no_crs = item()
  del no_crs["properties"]["proj:code"]
  assert any("[cog]" in m and "proj:code" in m for m in profiles.check_profiles(collection(), [no_crs]))
  no_stats = copy.deepcopy(item())
  del no_stats["assets"]["cog"]["raster:bands"][0]["statistics"]
  assert any("[cog]" in m and "statistics" in m for m in profiles.check_profiles(collection(), [no_stats]))
  parquet = item()
  parquet["assets"] = {"values": {"href": "./v.parquet", "type": stac.PARQUET, "roles": ["data"]}}
  del parquet["properties"]["proj:code"]
  assert profiles.check_profiles(collection(), [parquet]) == []
  assert profiles.has_data_cog(item()) and not profiles.has_data_cog(parquet)


def test_a_reference_only_cog_is_not_a_data_cog():
  it = item()
  it["assets"]["cog"]["roles"] = ["reference"]
  assert not profiles.has_data_cog(it)


def test_a_band_with_no_nodata_must_say_null():
  it = item()
  del it["assets"]["cog"]["raster:bands"][0]["nodata"]
  assert any("nodata" in m for m in profiles.check_profiles(collection(), [it]))


# ---- the build check ----

def test_check_staging_fails_on_a_profile_error(tmp_path):
  out = tmp_path / "staging"
  stac.write_json(out / "catalog.json", stac.root_catalog([]))
  d = out / "demo"
  c = {**collection(), "links": [{"rel": "item", "href": "./items/demo_a.json"}]}
  it = item()
  del it["properties"]["atlas:dims"]
  (d / "items").mkdir(parents=True)
  (d / "a.tif").write_bytes(b"")
  stac.write_json(d / "collection.json", c)
  stac.write_json(d / "items" / "demo_a.json", it)
  bad = cli.check_staging(out)
  assert any(m.startswith("demo: demo_a: [atlas-item]") and "atlas:dims" in m for m in bad)
