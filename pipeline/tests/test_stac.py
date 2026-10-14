import json

import pytest

from atlas_pipeline import biotrack as bt
from atlas_pipeline import cli, docs, stac

BBOX = [-97.9, 11.7, -43.8, 56.6]


def ranges():
  return {bt.column_name(g, s, m): (0.0, 1.0) for g in bt.GROUPS for s in bt.SEASONS for m in bt.METRICS}


def make_collection():
  cols = list(ranges())
  return stac.indicators_collection(BBOX, cols, {}, cols, 3, 10, {"bytes": 1})


def test_indicator_collection_required_fields_and_extensions():
  c = make_collection()
  assert stac.check_stac_required(c) == []
  assert c["stac_version"] == "1.1.0" and c["license"] == "CC-BY-4.0"
  for k in ("sdm", "scientific", "table", "datacube", "web_map", "contacts", "version"):
    assert stac.EXT[k] in c["stac_extensions"]
  assert c["sdm:response_type"] == "mixed" and c["sdm:method"] == "derived_merge"
  assert c["sdm:source_authority"] == "MBON BioTrack" and c["sdm:climatological"] is True
  assert c["atlas:funders"] == ["NOAA IOOS MBON", "BOEM"] and c["atlas:status"] == "prototype"
  assert c["cube:dimensions"]["group"]["values"] == ["all", "fish", "ray", "redlisted", "shark", "turtle"]
  assert c["cube:dimensions"]["season"]["values"] == ["summer", "winter"]
  assert c["cube:dimensions"]["metric"]["values"] == ["richness", "uncertainty"]
  assert c["sci:citation"].startswith("Couto, T.B.A., Hammerschlag, N., et al. (in prep).")


def test_indicator_collection_assets_and_links():
  c = make_collection()
  assert c["assets"]["hex"]["pmtiles:layers"] == ["hex"] and c["assets"]["hex"]["atlas:id_field"] == "FID"
  assert c["assets"]["values_h3"]["sdm:h3_resolution"] == 7
  assert c["assets"]["values"]["table:columns"][0]["name"] == "FID"
  rels = [l["rel"] for l in c["links"]]
  for r in ("root", "self", "item", "describedby", "agents", "license"):
    assert r in rels
  assert rels.count("item") == 24
  assert all(not l["href"].startswith("/") for l in c["links"])
  assert [x["roles"][0] for x in c["contacts"]] == ["principal investigator", "author"]


def test_indicator_collection_lists_hex_centroids_asset():
  a = make_collection()["assets"]["hex_centroids"]
  assert a["href"] == "./hex_centroids.parquet" and a["atlas:key_column"] == "FID" and a["table:row_count"] == 3
  assert [c["name"] for c in a["table:columns"]] == ["FID", "lon", "lat"]


def test_24_items_with_dims_and_value_columns():
  items = stac.indicator_items(BBOX, ranges())
  assert len(items) == 24
  it = items["shark_summer_richness"]
  assert stac.check_stac_required(it) == []
  p = it["properties"]
  assert p["atlas:dims"] == {"group": "shark", "season": "summer", "metric": "richness"}
  assert p["atlas:metric"] == "richness" and p["sdm:season"] == "summer"
  assert p["datetime"] is None and p["start_datetime"] == "2000-01-01T00:00:00Z" and p["end_datetime"].startswith("2023-12-31")
  assert it["assets"]["values"]["href"] == "../values.parquet"
  assert it["assets"]["values"]["atlas:value_column"] == "shark_summer_richness"
  assert it["assets"]["h3"]["href"] == "../values_h3.parquet"
  assert it["assets"]["h3"]["atlas:value_column"] == "shark_summer_richness"
  assert it["assets"]["hex"]["href"] == "../hex.pmtiles"
  assert p["atlas:value_range"] == [0.0, 1.0]
  assert stac.indicator_item_ids() == list(items)


def taxa_rows():
  return [{"aphia_id": 105836, "scientific_name": "Alopias vulpinus", "group1": "Shark", "group2": "Shark", "iucn_code": "VU"},
          {"aphia_id": 137205, "scientific_name": "Caretta caretta", "group1": "Turtle", "group2": "Turtle", "iucn_code": "EN"}]


def test_species_items_carry_taxon_and_column_assets():
  rows = taxa_rows()
  rng = {(r["aphia_id"], s): (0.0, 0.9) for r in rows for s in bt.SEASONS}
  items = stac.species_items(BBOX, rows, rng)
  assert sorted(items) == ["105836_summer", "105836_winter", "137205_summer", "137205_winter"]
  it = items["105836_winter"]
  assert stac.check_stac_required(it) == []
  tx = it["properties"]["sdm:taxon"]
  assert tx == {"scientific_name": "Alopias vulpinus", "authorities": {"worms": 105836}, "group": "shark", "redlist_code": "VU"}
  assert it["properties"]["sdm:response_type"] == "probability" and it["properties"]["sdm:method"] == "occupancy_model"
  assert it["assets"]["prob"]["href"] == "../prob_winter.parquet"
  assert it["assets"]["prob"]["atlas:value_column"] == "aphia_105836"
  assert it["assets"]["class"]["href"] == "../class_winter.parquet"


def test_species_collection_is_restricted_probability():
  rows = taxa_rows()
  c = stac.species_collection(BBOX, rows, 3, 5, {"prob_summer": {"title": "t", "columns": []}})
  assert stac.check_stac_required(c) == []
  assert c["sdm:response_type"] == "probability" and c["sdm:method"] == "occupancy_model"
  assert c["sdm:method_detail"] == "integrated spatial occupancy model, spOccupancy"
  assert c["atlas:access"] == "restricted"
  assert sum(1 for l in c["links"] if l["rel"] == "item") == 4
  assert c["contacts"] == stac.CONTACTS and c["license"] == "CC-BY-4.0"


def test_restricted_collection_not_linked_from_root_catalog():
  cat = stac.root_catalog(stac.EXTERNAL_CHILDREN)
  text = json.dumps(cat)
  assert "biotrack_species" not in text and "restricted" not in text
  children = [l["href"] for l in cat["links"] if l["rel"] == "child"]
  assert children[0] == "./biotrack_indicators/collection.json"
  assert "https://file.marinesensitivity.org/stac/v7/collection.json" in children
  assert "https://file.marinesensitivity.org/stac/v8/gm/collection.json" in children
  assert "https://file.marinesensitivity.org/stac/v8/nc/collection.json" in children
  assert "BOEM" in cat["description"] and "MBON" in cat["description"]


def test_check_stac_required_flags_missing_sdm_fields():
  it = stac.indicator_items(BBOX, ranges())["all_summer_richness"]
  del it["properties"]["sdm:method"]
  assert "missing sdm:method" in stac.check_stac_required(it)


def test_style_is_spectral_reversed_11_stops_on_feature_state():
  s = docs.style_default()
  expr = s["paint"]["fill-color"]
  interp = expr[3]
  assert interp[0] == "interpolate" and interp[2] == ["feature-state", "value"]
  stops = interp[3:]
  assert len(stops) == 22 and stops[0] == 0 and stops[-2] == 1.0
  assert stops[1] == "#5e4fa2" and stops[-1] == "#9e0142"
  assert s["source-layer"] == "hex"


def test_ulid_shape_and_ordering():
  a, b = cli.ulid(1_000), cli.ulid(2_000)
  assert len(a) == 26 and set(a) <= set(cli.CROCKFORD)
  assert a[:10] < b[:10]


def test_restricted_prefix_is_created_once(tmp_path):
  p = tmp_path / "restricted_prefix.txt"
  first = cli.restricted_prefix(p)
  assert first == cli.restricted_prefix(p) and len(first) == 26
