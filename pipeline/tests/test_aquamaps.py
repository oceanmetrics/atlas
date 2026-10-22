import json

import numpy as np
import pandas as pd
import pyarrow.parquet as pq
import pytest
import rasterio
from PIL import Image
from rasterio.transform import from_origin

from atlas_pipeline import aquamaps as aq
from atlas_pipeline import cli, cog, docs, stac, thumbs

NATIVE = "https://example.org/native/am/{h}.tif"
COG005 = "https://example.org/cog/global05/{h}.tif"
CHN = "Chn-0a1b2c3d-0000-4000-8000-000000000004"


def tables():
  """7 v8 am models: Zeta (taxon match, WoRMS), alpha (matched, no common name, new in v8), a botw bird, an unmatched
  model with a Chn- id (name only in the model table; v7 knew it as SLB-4), one with only a native COG, one with only
  a 0.05 COG and one with neither."""
  names = ["Zeta zeta", "alpha alpha", "Avis avis", "Chlamys lowei", "Native only", "Only 005", "No cog"]
  ids = ["Fis-1", "Fis-2", "Bir-3", CHN, "Fis-5", "Fis-6", "Fis-7"]
  model = pd.DataFrame({
    "mdl_key": [f"am|{i}" for i in ids], "sp_id": ids, "sci_name": names, "common_name": [None] * 7,
  })
  taxon_model = pd.DataFrame({
    "mdl_key": ["am|Fis-1", "am|Fis-2", "am|Bir-3"],
    "taxon_authority": ["worms", "worms", "botw"], "taxon_id": ["100", "200", "300"],
  })
  taxon = pd.DataFrame({
    "taxon_authority": ["worms", "worms", "botw"], "taxon_id": ["100", "200", "300"],
    "sp_cat": ["fish", "mammal", "bird"],
    "scientific_name": ["Zeta zeta", "Alpha alpha", "Avis avis"],
    "common_name": ["Zeta fish", "", None],
    "iucn_code": ["EN", None, "LC"],
  })
  rows = []
  for rep, keys, tpl, boxes in (
    ("native", ["am|Fis-1", "am|Fis-2", "am|Bir-3", f"am|{CHN}", "am|Fis-5"], NATIVE,
     [(-180.0, -60.0, 180.0, 80.0), (-10.0, -20.0, 10.0, 20.0), (-180.0, -30.0, 180.0, 60.0), (-5.0, 0.0, 5.0, 10.0),
      (0.0, 0.0, 1.0, 1.0)]),
    ("model", ["am|Fis-1", "am|Fis-2", "am|Bir-3", f"am|{CHN}", "am|Fis-6"], COG005,
     [(-180.0, -61.0, 180.0, 81.0), (-10.5, -20.5, 10.5, 20.5), (-180.0, -31.0, 180.0, 61.0), (-5.5, -0.5, 5.5, 10.5),
      (2.0, 2.0, 3.0, 3.0)]),
  ):
    for k, h, (x0, y0, x1, y1) in zip(keys, "abcde", boxes):
      rows.append({"mdl_key": k, "representation": rep, "asset_url": tpl.format(h=h), "rescale_min": 1,
                   "rescale_max": 100, "colormap": "spectral_r", "xmin": x0, "ymin": y0, "xmax": x1, "ymax": y1})
  v7 = pd.DataFrame({
    "taxa": ["Fis-1", "Bir-3", "SLB-4"],
    "description": [f"AquaMaps suitability for {n}, interpolated to 0.05° resolution"
                    for n in ("Zeta zeta", "Avis avis", "Chlamys lowei")],
  })
  return {"model": model, "taxon_model": taxon_model, "taxon": taxon, "native_asset": pd.DataFrame(rows),
          "model_v7": v7}


@pytest.fixture
def built():
  return aq.build_registry(tables())


# ---- registry ----

def test_registry_row_shape_and_columns(built):
  reg, _ = built
  assert list(reg.columns) == aq.REGISTRY_COLUMNS == [c for c, _, _ in aq.REGISTRY_FIELDS]
  r = reg[reg["sp_key"] == "Fis-1"].iloc[0]
  assert r["mdl_key"] == "am|Fis-1" and r["aphia_id"] == 100 and pd.isna(r["botw_id"])
  assert r["scientific_name"] == "Zeta zeta" and r["common_name"] == "Zeta fish" and r["sp_cat"] == "fish"
  assert r["redlist_code"] == "EN"
  assert r["cog_url"] == NATIVE.format(h="a") and r["cog_url_005"] == COG005.format(h="a")
  assert r["bbox_native"] == [-180.0, -60.0, 180.0, 80.0] and r["bbox_005"] == [-180.0, -61.0, 180.0, 81.0]
  assert r["rescale_min"] == 1 and r["rescale_max"] == 100 and r["colormap"] == "spectral_r"
  assert r["sp_key_v7"] == "Fis-1"


def test_registry_sorted_by_scientific_name_ignoring_case(built):
  reg, _ = built
  assert list(reg["scientific_name"]) == ["Alpha alpha", "Avis avis", "Chlamys lowei", "Zeta zeta"]


def test_only_models_with_both_representations_are_in_the_registry(built):
  reg, stats = built
  assert set(reg["sp_key"]) == {"Fis-1", "Fis-2", "Bir-3", CHN}
  assert stats["native_only"] == 1 and stats["only_005"] == 1 and stats["no_cog"] == 1
  assert stats["one_rep_sp_keys"] == ["Fis-5", "Fis-6"]
  assert stats["n_models"] == 7 and stats["n_taxa"] == len(reg) == 4


def test_each_representation_keeps_its_own_cog_and_bbox(built):
  reg, _ = built
  r = reg[reg["sp_key"] == "Fis-2"].iloc[0]
  assert r["cog_url"] == NATIVE.format(h="b") and r["cog_url_005"] == COG005.format(h="b")
  assert r["bbox_native"] == [-10.0, -20.0, 10.0, 20.0] and r["bbox_005"] == [-10.5, -20.5, 10.5, 20.5]


def test_unmatched_model_keeps_the_model_name_and_null_ids(built):
  reg, stats = built
  r = reg[reg["sp_key"] == CHN].iloc[0]
  assert r["scientific_name"] == "Chlamys lowei"
  assert pd.isna(r["aphia_id"]) and pd.isna(r["botw_id"]) and pd.isna(r["sp_cat"]) and pd.isna(r["redlist_code"])
  assert stats["n_unmatched"] == 1 and stats["by_sp_cat"]["unmatched"] == 1


def test_botw_model_has_botw_id_and_no_aphia_id(built):
  reg, _ = built
  r = reg[reg["sp_key"] == "Bir-3"].iloc[0]
  assert r["botw_id"] == 300 and pd.isna(r["aphia_id"]) and r["sp_cat"] == "bird" and r["redlist_code"] == "LC"


def test_blank_common_name_is_null(built):
  reg, stats = built
  r = reg[reg["sp_key"] == "Fis-2"].iloc[0]
  assert r["common_name"] is None or pd.isna(r["common_name"])
  assert stats["n_no_common_name"] == 3


def test_model_common_name_fills_in_when_the_taxon_has_none():
  t = tables()
  t["model"].loc[t["model"]["sp_id"] == "Fis-2", "common_name"] = "Model-table name"
  reg, _ = aq.build_registry(t)
  assert reg[reg["sp_key"] == "Fis-2"].iloc[0]["common_name"] == "Model-table name"


# ---- sp_key_v7 (old ?sp= links) ----

def test_sp_key_v7_is_the_same_key_when_the_v8_id_is_a_v7_taxa_value(built):
  reg, _ = built
  assert reg[reg["sp_key"] == "Fis-1"].iloc[0]["sp_key_v7"] == "Fis-1"
  assert reg[reg["sp_key"] == "Bir-3"].iloc[0]["sp_key_v7"] == "Bir-3"


def test_sp_key_v7_maps_a_renamed_species_through_its_scientific_name(built):
  reg, stats = built
  assert reg[reg["sp_key"] == CHN].iloc[0]["sp_key_v7"] == "SLB-4"
  assert stats["n_sp_key_v7"] == 3 and stats["n_sp_key_v7_renamed"] == 1


def test_sp_key_v7_is_null_for_a_species_v7_never_modelled(built):
  reg, _ = built
  assert pd.isna(reg[reg["sp_key"] == "Fis-2"].iloc[0]["sp_key_v7"])


def test_sp_key_v7_name_match_must_be_unique_and_unclaimed():
  v7 = pd.DataFrame({"taxa": ["X-1", "X-2", "Fis-9"],
                     "description": ["AquaMaps suitability for Dup dup, interpolated to 0.05°",
                                     "AquaMaps suitability for Dup dup, interpolated to 0.05°",
                                     "AquaMaps suitability for Claimed claimed, interpolated to 0.05°"]})
  keys = pd.Series(["N-1", "N-2", "Fis-9", "N-3"])
  names = pd.Series(["Dup dup", "Other", "Claimed claimed", "claimed CLAIMED"])
  out = aq.map_v7_keys(keys, names, v7).tolist()
  # two v7 models with the name: ambiguous; no v7 model: null; own id in v7: itself; a name whose v7 model is
  # already some other v8 species' own key (Fis-9) is not given to N-3
  assert out == [None, None, "Fis-9", None]
  assert aq.map_v7_keys(keys, names, None).tolist() == [None] * 4


def test_name_from_description():
  assert aq.name_from_description("AquaMaps suitability for Chlamys lowei, interpolated to 0.05° resolution") == "Chlamys lowei"
  assert aq.name_from_description("something else") is None and aq.name_from_description(None) is None


def test_registry_parquet_round_trip_has_nullable_ints_and_bbox_list(built, tmp_path):
  reg, _ = built
  p = aq.write_registry(reg, tmp_path / "registry.parquet")
  t = pq.read_table(p)
  assert t.schema.names == aq.REGISTRY_COLUMNS and t.num_rows == 4
  df = t.to_pandas()
  assert str(t.schema.field("aphia_id").type) == "int32"
  assert all(str(t.schema.field(c).type) == "list<element: double>" for c in ("bbox_native", "bbox_005"))
  assert df["aphia_id"].isna().sum() == 2 and df["sp_key_v7"].isna().sum() == 1


def test_search_index_rows_and_empty_strings(built):
  reg, _ = built
  idx = aq.search_index(reg)
  assert idx[0] == ["Fis-2", "Alpha alpha", "", "mammal"]
  assert idx[2] == [CHN, "Chlamys lowei", "", ""]
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
  assert c["title"] == "AquaMaps habitat suitability (native 0.5° and global 0.05°)"
  assert c["atlas:source_release"] == "MarineSensitivity v8"
  assert "global 0.05 degree downscale" in c["description"] and "release v8" in c["description"]
  assert "USA" in c["description"]   # says the 0.05 surface is not the v7 US clip
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
  assert rels["related"]["href"] == "https://file.marinesensitivity.org/stac/v8/am/collection.json"
  assert "v7" not in json.dumps(c["links"])
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
  assert t["registry_asset"] == "registry" and t["id"] == "{sp_key}" and t["bbox"] == "{bbox_native}"
  cog = t["assets"]["cog"]
  assert cog["href"] == "{cog_url}" and cog["roles"] == ["data"] and cog["type"].startswith("image/tiff")
  assert cog["bands"] == aq.BANDS and cog["bands"][0]["data_type"] == "uint8" and cog["bands"][0]["nodata"] == 0
  assert cog["bands"][0]["statistics"] == {"minimum": 1, "maximum": 100} and "raster:bands" not in cog
  assert cog["atlas:rescale"] == [1, 100] and cog["atlas:colormap"] == "spectral_r"
  assert cog["atlas:bbox"] == "{bbox_native}"
  c005 = t["assets"]["cog_005"]
  assert c005["href"] == "{cog_url_005}" and c005["atlas:bbox"] == "{bbox_005}" and c005["roles"] == ["reference"]
  assert c005["bands"] == aq.BANDS and c005["atlas:rescale"] == [1, 100] and "atlas:optional" not in c005
  assert "global" in c005["title"] and "v8" in c005["title"]
  tax = t["properties"]["sdm:taxon"]
  assert tax["scientific_name"] == "{scientific_name}" and tax["group"] == "{sp_cat}"
  assert tax["authorities"] == {"worms": "{aphia_id}", "botw": "{botw_id}"} and tax["redlist_code"] == "{redlist_code}"
  assert t["properties"]["atlas:value_range"] == [1, 100]
  ia = make_collection()["item_assets"]
  assert set(ia) == {"cog", "cog_005"}
  assert ia["cog"]["bands"][0]["nodata"] == 0 and ia["cog_005"]["sdm:value_range"] == [1, 100]


def test_registry_statistics_hold_for_an_aquamaps_byte_grid(tmp_path):
  """the registry Items are built client-side, so their `cog` statistics are template constants (min 1, max 100);
  a synthetic AquaMaps Byte grid (1-100, nodata 0, EPSG:4326) read the way the CCE writer reads its COGs agrees."""
  grid = np.zeros((11, 10), dtype="uint8")
  grid[1:] = np.arange(1, 101, dtype="uint8").reshape(10, 10)   # one row of nodata 0, then 1..100
  f = tmp_path / "am.tif"
  with rasterio.open(f, "w", driver="GTiff", height=11, width=10, count=1, dtype="uint8", crs="EPSG:4326",
                     transform=from_origin(-5, 5.5, 1, 1), nodata=0) as ds:
    ds.write(grid, 1)
  with rasterio.open(f) as ds:
    st = cog.band_summary(ds, 1)["statistics"]
    assert stac.projection_code(ds) == aq.PROJ_CODE
  assert st == {"minimum": 1.0, "maximum": 100.0, "mean": 50.5, "stddev": 28.8661, "valid_percent": 90.91}
  const = aq.BANDS[0]["statistics"]
  assert (st["minimum"], st["maximum"]) == (const["minimum"], const["maximum"])
  tpl = make_collection()["atlas:item_template"]
  assert tpl["properties"]["proj:code"] == "EPSG:4326"
  assert tpl["assets"]["cog"]["bands"][0]["statistics"] == const == {"minimum": 1, "maximum": 100}


def test_template_placeholders_are_all_registry_columns():
  import re
  text = json.dumps(make_collection()["atlas:item_template"])
  assert set(re.findall(r"\{(\w+)\}", text)) <= set(aq.REGISTRY_COLUMNS)


# ---- catalog and staging ----

def test_catalog_links_aquamaps_native_as_a_child():
  cat = stac.root_catalog(stac.EXTERNAL_CHILDREN)
  kids = [(l["href"], l["title"]) for l in cat["links"] if l["rel"] == "child"]
  assert ("./aquamaps_native/collection.json", aq.TITLE) in kids
  assert [h for h, _ in kids][:3] == [
    "./aquamaps_eov/collection.json", "./biotrack_indicators/collection.json", "./aquamaps_native/collection.json"]


def test_catalog_opens_on_aquamaps_eov_first():
  # the app's default layer is the FIRST child's first item (all x risk); the notebook writes the collection, this
  # catalog only has to link it ahead of every other child, external ones included
  cat = stac.root_catalog(stac.EXTERNAL_CHILDREN)
  kids = [l for l in cat["links"] if l["rel"] == "child"]
  assert kids[0]["href"] == "./aquamaps_eov/collection.json" and kids[0]["title"] == "AquaMaps EOV share"
  assert [l["href"] for l in kids].count("./aquamaps_eov/collection.json") == 1
  assert kids.index(next(l for l in kids if "biotrack_indicators" in l["href"])) == 1


def test_catalog_lists_the_v7_collections_one_by_one_without_aquamaps_005():
  cat = stac.root_catalog(stac.EXTERNAL_CHILDREN)
  kids = [l["href"] for l in cat["links"] if l["rel"] == "child"]
  v7 = [h for h in kids if "/stac/v7/" in h]
  assert v7 == [f"https://file.marinesensitivity.org/stac/v7/{k}/collection.json" for k in
                ("ms_merge", "rng_iucn", "rng_fws", "bl", "ch_nmfs", "ch_fws", "ca_nmfs", "rng_turtle_swot_dps")]
  assert "https://file.marinesensitivity.org/stac/v7/collection.json" not in kids   # the parent also lists am_0.05
  assert not any("am_0.05" in h or "/v8/am/" in h for h in kids)   # aquamaps_native is the AquaMaps entry
  assert "https://file.marinesensitivity.org/stac/v8/gm/collection.json" in kids
  assert "https://file.marinesensitivity.org/stac/v8/nc/collection.json" in kids
  assert all(l["title"] for l in cat["links"] if l["rel"] == "child")


def test_check_staging_flags_a_catalog_that_exposes_am_005_or_the_v7_parent(tmp_path):
  aq.build(tmp_path, tables=tables(), use_thumbnail=False, log=lambda m: None)
  cat = stac.root_catalog(stac.EXTERNAL_CHILDREN)
  cat["links"].append({"rel": "child", "href": "https://file.marinesensitivity.org/stac/v7/collection.json", "title": "v7"})
  cat["links"].append({"rel": "child", "href": "https://file.marinesensitivity.org/stac/v7/am_0.05/collection.json", "title": "am"})
  cat["links"].append({"rel": "child", "href": "https://file.marinesensitivity.org/stac/v8/am/collection.json", "title": "am8"})
  stac.write_json(tmp_path / "catalog.json", cat)
  bad = cli.check_staging(tmp_path)
  assert sum("catalog links" in m for m in bad) == 3


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
  assert "cog_url_005" in readme and "No per-taxon Item files" in readme and "global" in readme and "v8" in readme
  prov = json.loads((d / "provenance.json").read_text())
  assert prov["record_counts"]["native_only"] == 1 and prov["record_counts"]["only_005"] == 1
  assert [x["table"] for x in prov["sources"]] == ["v8/model", "v8/taxon_model", "v8/taxon", "v8/native_asset", "v7/model"]
  assert all("/v8/tables/" in x["url"] for x in prov["sources"][:4]) and prov["one_rep_sp_keys"] == ["Fis-5", "Fis-6"]


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
  assert "CC BY-NC 3.0" in text and aq.V8_COLLECTION in text and "sp_key_v7" in text
