import json

import numpy as np
import pandas as pd
import pyarrow.parquet as pq
import pytest
from PIL import Image

from atlas_pipeline import aquamaps as aq
from atlas_pipeline import cli, docs, stac, thumbs

NATIVE = "https://example.org/native/am/{h}.tif"
COG005 = "https://example.org/cog/usa05/{h}.tif"


def tables(extra_native: bool = True):
  """5 am_0.05 models: Zeta (taxon match, WoRMS), alpha (matched, no common name), a botw bird, an unmatched SeaLifeBase
  model (name only in the description) and one model with no native COG."""
  model = pd.DataFrame({
    "mdl_seq": [1, 2, 3, 4, 5],
    "taxa": ["Fis-1", "Fis-2", "Bir-3", "SLB-4", "Fis-5"],
    "description": [f"AquaMaps suitability for {n}, interpolated to 0.05° resolution"
                    for n in ("Zeta zeta", "alpha alpha", "Avis avis", "Chlamys lowei", "No native")],
  })
  taxon_model = pd.DataFrame({"taxon_id": [100.0, 200.0, 300.0], "mdl_seq": [1, 2, 3]})
  taxon = pd.DataFrame({
    "taxon_id": [100.0, 200.0, 300.0],
    "taxon_authority": ["worms", "worms", "botw"],
    "sp_cat": ["fish", "mammal", "bird"],
    "scientific_name": ["Zeta zeta", "Alpha alpha", "Avis avis"],
    "common_name": ["Zeta fish", "", None],
    "worms_id": pd.array([100, 200, None], dtype="Int32"),
    "redlist_code": ["EN", None, "LC"],
  })
  native = pd.DataFrame({
    "mdl_key": ["1", "2", "3", "4"],
    "asset_url": [NATIVE.format(h=h) for h in "abcd"],
    "xmin": [-180.0, -10.0, -180.0, -5.0], "ymin": [-60.0, -20.0, -30.0, 0.0],
    "xmax": [180.0, 10.0, 180.0, 5.0], "ymax": [80.0, 20.0, 60.0, 10.0],
  })
  model_asset = pd.DataFrame({
    "mdl_seq": [1, 2, 3, 4, 5], "cog_url": [COG005.format(h=h) for h in "abcde"],
    "n_cells": [1000.0, 50.0, 70.0, 3.0, 9.0],
  })
  return {"model": model, "taxon_model": taxon_model, "taxon": taxon, "native_asset": native, "model_asset": model_asset}


@pytest.fixture
def built():
  return aq.build_registry(tables())


# ---- registry ----

def test_registry_row_shape_and_columns(built):
  reg, _ = built
  assert list(reg.columns) == aq.REGISTRY_COLUMNS == [c for c, _, _ in aq.REGISTRY_FIELDS]
  r = reg[reg["sp_key"] == "Fis-1"].iloc[0]
  assert r["mdl_seq"] == 1 and r["aphia_id"] == 100 and pd.isna(r["botw_id"])
  assert r["scientific_name"] == "Zeta zeta" and r["common_name"] == "Zeta fish" and r["sp_cat"] == "fish"
  assert r["redlist_code"] == "EN"
  assert r["cog_url"] == NATIVE.format(h="a") and r["cog_url_005"] == COG005.format(h="a")
  assert r["bbox"] == [-180.0, -60.0, 180.0, 80.0] and r["n_cells_005"] == 1000


def test_registry_sorted_by_scientific_name_ignoring_case(built):
  reg, _ = built
  assert list(reg["scientific_name"]) == ["Alpha alpha", "Avis avis", "Chlamys lowei", "Zeta zeta"]


def test_models_without_a_native_cog_are_excluded_and_counted(built):
  reg, stats = built
  assert "Fis-5" not in set(reg["sp_key"])
  assert stats["excluded_no_native"] == 1 and stats["excluded_sp_keys"] == ["Fis-5"]
  assert stats["n_models"] == 5 and stats["n_taxa"] == len(reg) == 4


def test_unmatched_model_keeps_the_description_name_and_null_ids(built):
  reg, stats = built
  r = reg[reg["sp_key"] == "SLB-4"].iloc[0]
  assert r["scientific_name"] == "Chlamys lowei"
  assert pd.isna(r["aphia_id"]) and pd.isna(r["botw_id"]) and pd.isna(r["sp_cat"])
  assert stats["n_unmatched"] == 1 and stats["by_sp_cat"]["unmatched"] == 1


def test_botw_model_has_botw_id_and_no_aphia_id(built):
  reg, _ = built
  r = reg[reg["sp_key"] == "Bir-3"].iloc[0]
  assert r["botw_id"] == 300 and pd.isna(r["aphia_id"]) and r["sp_cat"] == "bird"


def test_blank_common_name_is_null(built):
  reg, stats = built
  assert reg[reg["sp_key"] == "Fis-2"].iloc[0]["common_name"] is None or pd.isna(reg[reg["sp_key"] == "Fis-2"].iloc[0]["common_name"])
  assert stats["n_no_common_name"] == 3


def test_name_from_description():
  assert aq.name_from_description("AquaMaps suitability for Chlamys lowei, interpolated to 0.05° resolution") == "Chlamys lowei"
  assert aq.name_from_description("something else") is None and aq.name_from_description(None) is None


def test_registry_parquet_round_trip_has_nullable_ints_and_bbox_list(built, tmp_path):
  reg, _ = built
  p = aq.write_registry(reg, tmp_path / "registry.parquet")
  t = pq.read_table(p)
  assert t.schema.names == aq.REGISTRY_COLUMNS and t.num_rows == 4
  df = t.to_pandas()
  assert str(t.schema.field("aphia_id").type) == "int32" and str(t.schema.field("bbox").type) == "list<element: double>"
  assert df["aphia_id"].isna().sum() == 2


def test_search_index_rows_and_empty_strings(built):
  reg, _ = built
  idx = aq.search_index(reg)
  assert idx[0] == ["Fis-2", "Alpha alpha", "", "mammal"]
  assert idx[2] == ["SLB-4", "Chlamys lowei", "", ""]
  assert all(len(r) == 4 and all(isinstance(x, str) for x in r) for r in idx)
  assert "NaN" not in json.dumps(idx)


# ---- collection ----

def make_collection(index: bool = True):
  _, stats = aq.build_registry(tables())
  return aq.collection(stats, 1_057_459, 1_089_368 if index else None)


def test_collection_required_fields_and_sdm_core():
  c = make_collection()
  assert stac.check_stac_required(c) == []
  assert c["id"] == "aquamaps_native" and c["stac_version"] == "1.1.0"
  assert c["title"] == "AquaMaps habitat suitability, native 0.5 degree"
  assert c["sdm:response_type"] == "suitability" and c["sdm:value_unit"] == "percent"
  assert c["sdm:value_range"] == [1, 100] and c["sdm:method"] == "env_envelope"
  assert c["sdm:source_authority"] == "AquaMaps" and c["sdm:temporal_interval"] == "static"
  assert c["sdm:predictors"] == ["depth", "temperature", "salinity", "primary_production",
                                 "sea_ice_concentration", "distance_to_land"]
  for k in ("sdm", "scientific", "table", "version"):
    assert stac.EXT[k] in c["stac_extensions"]
  assert c["extent"]["spatial"]["bbox"] == [[-180.0, -90.0, 180.0, 90.0]]


def test_collection_license_note_citation_and_no_funders():
  c = make_collection()
  assert c["license"] == "CC-BY-NC-3.0"
  lic = [l for l in c["links"] if l["rel"] == "license"]
  assert lic == [{"rel": "license", "href": "https://creativecommons.org/licenses/by-nc/3.0/", "type": "text/html",
                  "title": "CC BY-NC 3.0 Unported (non-commercial use only)"}]
  assert c["atlas:note"] == ("Non-commercial use only (CC BY-NC 3.0). Maps and numbers come from AquaMaps; link back "
                             "to aquamaps.org when you reuse them.")
  assert c["sci:citation"].startswith("Kaschner, K., Kesner-Reyes, K., Garilao, C., Segschneider, J., Rius-Barile, J., Rees, T., Froese, R. (2019).")
  assert c["sci:citation"].endswith("www.aquamaps.org, Version 10/2019.")
  assert c["atlas:funders"] == [] and "MBON" not in json.dumps(c) and "MMA" not in json.dumps(c)


def test_collection_providers_links_and_no_items():
  c = make_collection()
  roles = {p["name"]: p["roles"] for p in c["providers"]}
  assert roles == {"AquaMaps": ["producer", "licensor"], "MarineSensitivity": ["processor"], "OceanMetrics": ["host"]}
  rels = {l["rel"]: l for l in c["links"]}
  assert rels["via"]["href"] == "https://www.aquamaps.org"
  assert rels["related"]["href"] == "https://file.marinesensitivity.org/stac/v7/am_0.05/collection.json"
  assert rels["describedby"]["href"] == "./README.md" and rels["agents"]["href"] == "./AGENTS.md"
  assert rels["preview"]["href"] == "./thumbnail.png"
  assert "item" not in rels and "child" not in rels


def test_collection_registry_assets_and_summaries():
  c = make_collection()
  reg = c["assets"]["registry"]
  assert reg["href"] == "./registry.parquet" and reg["table:row_count"] == 4
  assert [x["name"] for x in reg["table:columns"]] == aq.REGISTRY_COLUMNS
  assert c["atlas:taxa_registry"]["asset"] == "registry" and c["atlas:taxa_registry"]["key_column"] == "sp_key"
  assert c["atlas:taxa_registry"]["index_asset"] == "registry_index" and "registry_index" in c["assets"]
  assert c["summaries"]["atlas:taxa"] == [4]
  assert c["summaries"]["sdm:taxon.group"] == {"bird": 1, "fish": 1, "mammal": 1, "unmatched": 1}


def test_collection_without_index_has_no_index_asset():
  c = make_collection(index=False)
  assert "registry_index" not in c["assets"] and "index_asset" not in c["atlas:taxa_registry"]


def test_item_template_fields():
  t = make_collection()["atlas:item_template"]
  assert t["registry_asset"] == "registry" and t["id"] == "{sp_key}" and t["bbox"] == "{bbox}"
  cog = t["assets"]["cog"]
  assert cog["href"] == "{cog_url}" and cog["roles"] == ["data"] and cog["type"].startswith("image/tiff")
  assert cog["bands"] == aq.BANDS and cog["bands"][0]["data_type"] == "uint8" and cog["bands"][0]["nodata"] == 0
  assert cog["bands"][0]["statistics"] == {"minimum": 1, "maximum": 100} and "raster:bands" not in cog
  assert cog["atlas:rescale"] == [1, 100] and cog["atlas:colormap"] == "spectral_r"
  assert t["assets"]["cog_005"]["href"] == "{cog_url_005}"
  tax = t["properties"]["sdm:taxon"]
  assert tax["scientific_name"] == "{scientific_name}" and tax["group"] == "{sp_cat}"
  assert tax["authorities"] == {"worms": "{aphia_id}", "botw": "{botw_id}"} and tax["redlist_code"] == "{redlist_code}"
  assert t["properties"]["atlas:value_range"] == [1, 100]
  ia = make_collection()["item_assets"]["cog"]
  assert ia["bands"][0]["nodata"] == 0 and ia["sdm:value_range"] == [1, 100]


def test_template_placeholders_are_all_registry_columns():
  import re
  text = json.dumps(make_collection()["atlas:item_template"])
  assert set(re.findall(r"\{(\w+)\}", text)) <= set(aq.REGISTRY_COLUMNS)


# ---- catalog and staging ----

def test_catalog_links_aquamaps_native_as_a_child():
  cat = stac.root_catalog(stac.EXTERNAL_CHILDREN)
  kids = [(l["href"], l["title"]) for l in cat["links"] if l["rel"] == "child"]
  assert ("./aquamaps_native/collection.json", "AquaMaps habitat suitability, native 0.5 degree") in kids
  assert [h for h, _ in kids][:2] == ["./biotrack_indicators/collection.json", "./aquamaps_native/collection.json"]


def test_build_writes_registry_collection_docs_and_passes_check(tmp_path):
  r = aq.build(tmp_path, tables=tables(), use_thumbnail=False, log=lambda m: None)
  d = tmp_path / "aquamaps_native"
  assert (d / "registry.parquet").exists() and (d / "collection.json").exists() and (d / "provenance.json").exists()
  # the tiny fixture registry is far under 1 MB: no search index
  assert r["index_bytes"] is None and not (d / "registry_index.json").exists()
  coll = json.loads((d / "collection.json").read_text())
  assert "registry_index" not in coll["assets"]
  assert aq.check_collection(d, coll) == []
  assert "Non-commercial use only (CC BY-NC 3.0)" in (d / "README.md").read_text()
  readme = (d / "README.md").read_text()
  assert "cog_url_005" in readme and "No per-taxon Item files" in readme
  prov = json.loads((d / "provenance.json").read_text())
  assert prov["record_counts"]["excluded_no_native"] == 1 and len(prov["sources"]) == 5


def test_build_writes_search_index_above_the_size_threshold(tmp_path, monkeypatch):
  monkeypatch.setattr(aq, "INDEX_MIN_BYTES", 0)
  aq.build(tmp_path, tables=tables(), use_thumbnail=False, log=lambda m: None)
  d = tmp_path / "aquamaps_native"
  assert len(json.loads((d / "registry_index.json").read_text())) == 4
  assert aq.check_collection(d, json.loads((d / "collection.json").read_text())) == []


def test_check_flags_wrong_license_and_item_links(tmp_path):
  aq.build(tmp_path, tables=tables(), use_thumbnail=False, log=lambda m: None)
  d = tmp_path / "aquamaps_native"
  coll = json.loads((d / "collection.json").read_text())
  coll["license"] = "CC-BY-4.0"
  coll["links"].append({"rel": "item", "href": "./items/x.json"})
  bad = aq.check_collection(d, coll)
  assert any("license is" in m for m in bad) and any("item links" in m for m in bad)


def test_check_flags_registry_row_count_mismatch(tmp_path):
  aq.build(tmp_path, tables=tables(), use_thumbnail=False, log=lambda m: None)
  d = tmp_path / "aquamaps_native"
  coll = json.loads((d / "collection.json").read_text())
  coll["assets"]["registry"]["table:row_count"] = 99
  assert any("table:row_count" in m for m in aq.check_collection(d, coll))


def test_check_staging_accepts_the_aquamaps_collection(tmp_path):
  aq.build(tmp_path, tables=tables(), use_thumbnail=False, log=lambda m: None)
  stac.write_json(tmp_path / "catalog.json", stac.root_catalog([]))
  assert cli.check_staging(tmp_path) == []


# ---- thumbnail ----

def test_thumbnail_names_picks_registry_cogs_in_order(built):
  reg, _ = built
  assert aq.thumbnail_names(reg, ["Zeta zeta", "Missing", "Alpha alpha"]) == {
    "Zeta zeta": NATIVE.format(h="a"), "Alpha alpha": NATIVE.format(h="b")}


def test_aquamaps_thumbnail_is_a_2x2_navy_panel(tmp_path):
  rng = np.random.default_rng(1)
  arr = np.ma.masked_equal(rng.integers(0, 101, (40, 80)).astype("uint8"), 0)
  panels = {f"Species {i}": (arr, (-180.0, -60.0, 180.0, 80.0)) for i in range(4)}
  png, small = thumbs.aquamaps_thumbnail(panels, tmp_path / "thumbnail.png", size=(600, 400), use_land=False)
  assert Image.open(png).size == (600, 400) and Image.open(small).size[0] == thumbs.SMALL_W
  rgb = np.asarray(Image.open(png).convert("RGB"))
  assert tuple(rgb[0, 0]) == (5, 41, 77)
  assert len({tuple(p) for p in rgb.reshape(-1, 3)[::31]}) > 5


def test_aquamaps_thumbnail_rejects_more_than_four(tmp_path):
  arr = np.ma.masked_equal(np.ones((4, 4), dtype="uint8"), 0)
  with pytest.raises(AssertionError):
    thumbs.aquamaps_thumbnail({f"s{i}": (arr, (-180, -60, 180, 80)) for i in range(5)}, tmp_path / "t.png", use_land=False)


def test_docs_aquamaps_readme_lists_every_registry_column(built):
  _, stats = built
  text = docs.aquamaps_readme({**stats, "registry_bytes": 1, "index_bytes": None})
  assert all(f"`{c}`" in text for c in aq.REGISTRY_COLUMNS)
  assert "CC BY-NC 3.0" in text and aq.V7_COLLECTION in text
