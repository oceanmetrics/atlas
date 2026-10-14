import json

import pandas as pd

from atlas_pipeline import biotrack as bt
from atlas_pipeline import cli, stac

BBOX = [-97.9, 11.7, -43.8, 56.6]


def stage(tmp_path, link_species=False):
  """a tiny staging tree: root catalog + a one-species restricted collection with real parquet columns."""
  out = tmp_path / "staging"
  rows = [{"aphia_id": 105836, "scientific_name": "Alopias vulpinus", "group1": "Shark", "group2": "Shark", "iucn_code": "VU"}]
  sp = out / "biotrack_species"
  for s in bt.SEASONS:
    cli.write_parquet(pd.DataFrame({"FID": [0, 1], "aphia_105836": [0.9, 0.1]}), sp / f"prob_{s}.parquet")
    cli.write_parquet(pd.DataFrame({"FID": [0, 1], "aphia_105836": ["Very likely", "Unlikely"]}), sp / f"class_{s}.parquet")
  cli.write_parquet(pd.DataFrame({"x": [1]}), sp / "species.parquet")
  cli.write_parquet(pd.DataFrame({"x": [1]}), sp / "cell_species.parquet")
  rng = {(105836, s): (0.1, 0.9) for s in bt.SEASONS}
  coll = stac.species_collection(BBOX, rows, 2, 1, {})
  stac.write_json(sp / "collection.json", coll)
  for iid, item in stac.species_items(BBOX, rows, rng).items():
    stac.write_json(sp / "items" / f"{iid}.json", item)
  cat = stac.root_catalog([])
  if link_species:
    cat["links"].append({"rel": "child", "href": "./biotrack_species/collection.json", "title": "x"})
  stac.write_json(out / "catalog.json", cat)
  return out


def test_check_passes_on_a_consistent_tree(tmp_path):
  assert cli.check_staging(stage(tmp_path)) == []


def test_check_flags_restricted_collection_linked_from_catalog(tmp_path):
  bad = cli.check_staging(stage(tmp_path, link_species=True))
  assert any("restricted" in m for m in bad)


def test_check_flags_value_column_missing_from_parquet(tmp_path):
  out = stage(tmp_path)
  cli.write_parquet(pd.DataFrame({"FID": [0, 1]}), out / "biotrack_species" / "prob_summer.parquet")
  bad = cli.check_staging(out)
  assert any("aphia_105836 not a column of ../prob_summer.parquet" in m for m in bad)


def test_add_file_info_adds_size_and_multihash_checksum(tmp_path):
  f = tmp_path / "a.parquet"
  f.write_bytes(b"abc")
  obj = {"stac_extensions": [], "assets": {"a": {"href": "./a.parquet"}, "b": {"href": "https://x.org/b"}}}
  stac.add_file_info(obj, tmp_path)
  assert obj["assets"]["a"]["file:size"] == 3
  assert obj["assets"]["a"]["file:checksum"] == "1220ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  assert "file:size" not in obj["assets"]["b"] and stac.EXT["file"] in obj["stac_extensions"]


def test_check_flags_public_species_asset_with_wrong_columns(tmp_path):
  out = tmp_path / "staging"
  cols = [bt.column_name("all", "summer", "richness")]
  d = out / "biotrack_indicators"
  coll = stac.indicators_collection(BBOX, cols, {}, cols, 3, 10, {"bytes": 1}, species_rows={"cell_species": 1, "species": 1})
  coll["links"] = [l for l in coll["links"] if l["rel"] != "item"]
  stac.write_json(d / "collection.json", coll)
  stac.write_json(out / "catalog.json", stac.root_catalog([]))
  cli.write_parquet(pd.DataFrame({"FID": [0], "season": ["summer"], "aphia_id": [1], "prob": [0.7], "class": ["Likely"]}), d / "cell_species.parquet")
  cli.write_parquet(pd.DataFrame({"aphia_id": [1]}), d / "species.parquet")
  bad = cli.check_staging(out)
  assert any("asset species columns" in m for m in bad) and not any("asset cell_species" in m for m in bad)
