"""sefsc_gm v2 (restricted): one test per rule, synthetic fixtures (three hexagons, a few segments and sightings).

Gates and their planted faults (CLAUDE.md: every gate ships with a seeded fault):
  values_problems    a -9999 left in, an annual that is the plain mean, a surveyed hexagon with a NULL count, a bad
                     column name, a column layers.csv does not list -> flagged
  done_stamp         no DONE, a file changed after DONE, a file newer than DONE -> refused
  overlays_block     a contract field the tiles lack -> raises
  check_collection   an email, a public access, a wrong overlay filter, a lost overlay field, a missing predecessor
                     link -> flagged
  publish.sh --only  a prefix that is not a ULID -> refused before any om-publish call
"""

import csv
import hashlib
import json
import shutil
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import pytest
import shapely

from atlas_pipeline import profiles, sefsc_gm, stac

sys.path.insert(0, str(Path(__file__).resolve().parent))
from conftest import hexagon  # noqa: E402
from publish_fakes import ULID, run_publish  # noqa: E402

HAS_TILES = shutil.which("tippecanoe") is not None and shutil.which("pmtiles") is not None
needs_tiles = pytest.mark.skipif(not HAS_TILES, reason="tippecanoe and pmtiles needed")
HEXIDS = [101, 102, 103]

MODELS = [
  {"layer": "rices_whale", "shapefile": "Rices_Whale_Monthly_Density.shp", "label": "Rice’s whale",
   "common_name": "Rice’s whale", "scientific_name": "Balaenoptera ricei", "taxa_doc": "Rice’s whale (Balaenoptera ricei)",
   "aphia_id": "1576133", "population": "", "months_modelled": "04,05", "n_hex_annual": "2",
   "abundance_annual": "1.5", "density_p98_annual": "0.004"},
  {"layer": "kemps_ridley_sea_turtle", "shapefile": "KempsRidley_SeaTurtle_Monthly_Density_wUnids_Unclipped.shp",
   "label": "Kemp's ridley sea turtle", "common_name": "Kemp's Ridley sea turtle", "scientific_name": "Lepidochelys kempii",
   "taxa_doc": "Kemp's Ridley sea turtle (Lepidochelys kempii)", "aphia_id": "137208", "population": "",
   "months_modelled": "04", "n_hex_annual": "1", "abundance_annual": "2", "density_p98_annual": "0.01"},
]


def _layer(col, n_hex=2, lo=0.0, p98=1.0, hi=1.0, unit="km"):
  layer, month, var = sefsc_gm.parse_column(col)
  return {"column": col, "layer": layer, "month": month, "variable": var, "title": f"{layer} · {month} · {var}",
          "unit": unit, "description": f"{var} of {layer} in {month}.", "n_hex": str(n_hex), "min": str(lo),
          "p98": str(p98), "max": str(hi)}


def values_fixture() -> tuple[pd.DataFrame, list[dict]]:
  """three hexagons: surveys (annual) and two models (Rice's whale Apr + May, Kemp's ridley Apr only)."""
  nan = np.nan
  v = {"HEXID": HEXIDS}
  for s in stac.SEFSC_SURVEY_LAYERS:
    v |= {f"{s}__annual__effort_km": [4.0, nan, 2.5], f"{s}__annual__groups": [0.0, 1.0, 2.0],
          f"{s}__annual__individuals": [0.0, 3.0, 7.0]}
  apr, may = np.array([0.01, 0.02, nan]), np.array([0.03, nan, nan])
  v |= {"rices_whale__annual__density": (apr * 30 + np.nan_to_num(may) * 31) / 365 * np.array([1, 1, nan]),
        "rices_whale__04__density": apr, "rices_whale__04__cv": [0.5, 0.7, nan],
        "rices_whale__05__density": may, "rices_whale__05__cv": [0.4, nan, nan]}
  kr = np.array([0.1, nan, nan])
  v |= {"kemps_ridley_sea_turtle__annual__density": kr * 30 / 365, "kemps_ridley_sea_turtle__04__density": kr,
        "kemps_ridley_sea_turtle__04__cv": [3.0, nan, nan]}
  values = pd.DataFrame(v)
  layers = [_layer(c, n_hex=int(values[c].notna().sum()), p98=float(values[c].quantile(0.98)), hi=float(values[c].max()))
            for c in values.columns if c != "HEXID"]
  return values, layers


# ---- rules ----

def test_column_names_parse_and_anything_else_is_refused():
  assert sefsc_gm.parse_column("rices_whale__annual__density") == ("rices_whale", "annual", "density")
  assert sefsc_gm.parse_column("survey_all__07__effort_km") == ("survey_all", "07", "effort_km")
  assert sefsc_gm.parse_column("pygmy_or_dwarf_sperm_whales__12__cv") == ("pygmy_or_dwarf_sperm_whales", "12", "cv")
  for bad in ["rices_whale_annual_density", "rices_whale__13__density", "rices_whale__7__density",
              "rices_whale__annual__abundance", "Rices_whale__01__cv", "__01__cv", "rices_whale__annual__density__x"]:
    with pytest.raises(ValueError):
      sefsc_gm.parse_column(bad)


def test_annual_is_the_day_weighted_mean_with_an_uncovered_month_as_zero():
  # a model of April-November only (Kogia): density 1 in every modelled month -> 244/365, not 1
  months = {f"{m:02d}": np.array([1.0, np.nan]) for m in range(4, 12)}
  a = sefsc_gm.day_weighted_annual(months)
  assert a[0] == pytest.approx(244 / 365) and np.isnan(a[1])   # no month has a value -> NULL, never 0
  # twelve months: the day-weighted mean (February 28/365), not the plain mean of the months
  full = {f"{m:02d}": np.array([float(m)]) for m in range(1, 13)}
  days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  assert sefsc_gm.day_weighted_annual(full)[0] == pytest.approx(sum(m * d for m, d in zip(range(1, 13), days)) / 365)
  assert sefsc_gm.day_weighted_annual(full)[0] != pytest.approx(6.5)
  # a NULL hexagon-month (-9999 as delivered) counts as 0 over its weight
  gap = {"01": np.array([2.0]), "02": np.array([np.nan])}
  assert sefsc_gm.day_weighted_annual(gap)[0] == pytest.approx(2 * 31 / 365)


def test_values_problems_clean_table_passes():
  values, layers = values_fixture()
  assert sefsc_gm.values_problems(values, layers) == []


def test_values_problems_flags_a_minus_9999_left_in():
  values, layers = values_fixture()
  values.loc[2, "rices_whale__05__cv"] = -9999.0
  bad = sefsc_gm.values_problems(values, layers)
  assert any("rices_whale__05__cv" in b and "-9999" in b for b in bad)


def test_values_problems_flags_an_annual_that_is_not_day_weighted():
  values, layers = values_fixture()
  # the plain mean of the modelled months (the v8 recipe), not the day-weighted mean over twelve
  values["rices_whale__annual__density"] = values[["rices_whale__04__density", "rices_whale__05__density"]].mean(axis=1)
  bad = sefsc_gm.values_problems(values, layers)
  assert any(b.startswith("rices_whale: annual density") for b in bad)


def test_values_problems_flags_a_surveyed_hexagon_with_a_null_count():
  values, layers = values_fixture()
  values.loc[0, "survey_vessel__annual__groups"] = np.nan   # effort 4 km, groups must be 0
  bad = sefsc_gm.values_problems(values, layers)
  assert any("survey_vessel__annual__groups" in b and "NULL where" in b for b in bad)


def test_values_problems_flags_a_bad_name_and_a_column_layers_csv_lacks():
  values, layers = values_fixture()
  assert any("differ from layers.csv" in b for b in sefsc_gm.values_problems(values.assign(extra__01__cv=0.1), layers))
  layers2 = [dict(layers[0], column="survey_all_annual_effort_km")] + layers[1:]
  assert any("is not {layer}__" in b for b in sefsc_gm.values_problems(values, layers2))


def _fields():
  """every field each overlay's file has (the contract's own, plus one extra to show the rest follow)."""
  return {o["id"]: list(dict.fromkeys(o["fields"] + [o["label_field"]] + ([o["filter_field"]] if o.get("filter_field") else [])
                                      + ["platform"])) for o in sefsc_gm.OVERLAYS}


def test_overlays_block_shape_order_and_asset_references():
  ov = sefsc_gm.overlays_block(_fields())
  assert [o["id"] for o in ov] == ["sightings_vessel", "sightings_aerial", "effort_vessel", "effort_aerial", "hexagons"]
  for o in ov:
    assert o["asset"] == o["source_layer"] == o["id"]
    assert o["geometry"] in ("point", "line", "polygon")
    assert set(o) >= {"id", "title", "asset", "source_layer", "geometry", "color", "default", "label_field", "fields"}
    assert o["fields"][-1] == "platform"   # popup order: the contract's fields first, the file's others after
    assert all(f in o["fields"] for f in o["field_labels"])
    assert o["color"].startswith("#") and len(o["color"]) == 7
  assert [o["default"] for o in ov] == [True, True, True, True, False]
  assert [o.get("filter_field") for o in ov] == ["models", "models", None, None, None]
  assert len({o["color"] for o in ov}) == len(ov)
  # the contract never names a property the tiles lack
  f = _fields()
  f["sightings_vessel"].remove("group.size")
  with pytest.raises(ValueError, match="group.size"):
    sefsc_gm.overlays_block(f)
  # a collection whose overlay names an asset it does not have is refused
  _, layers = values_fixture()
  with pytest.raises(ValueError, match="not a collection asset"):
    stac.sefsc_collection(MODELS, layers, [-98, 18, -80, 31], ("2003-01-01T00:00:00Z", "2024-12-31T23:59:59Z"), {}, ov)


def _intervals():
  return {"survey_vessel": ("2003-06-14T00:00:00Z", "2024-09-30T23:59:59Z"),
          "survey_aerial": ("2011-10-12T00:00:00Z", "2018-02-28T23:59:59Z"),
          "survey_all": ("2003-06-14T00:00:00Z", "2024-09-30T23:59:59Z")}


def test_items_dims_value_ranges_and_overlay_filter():
  _, layers = values_fixture()
  layers = [dict(r, p98="0.001234567", max="0.002") if r["column"] == "rices_whale__04__density" else r for r in layers]
  layers = [dict(r, p98="0", max="5") if r["column"] == "survey_all__annual__groups" else r for r in layers]
  items = stac.sefsc_items(MODELS, layers, [-98, 18, -80, 31], _intervals())
  assert set(items) == {f"{r['layer']}_{r['month']}_{r['variable']}" for r in layers}
  d = items["rices_whale_04_density"]["properties"]
  assert d["atlas:dims"] == {"layer": "rices_whale", "month": "04", "variable": "density"}
  assert d["atlas:value_range"] == [0, 0.00123]                       # [0, p98] to 3 significant figures
  assert d["atlas:overlay_filter"] == {"field": "models", "token": "rices_whale"}
  assert d["sdm:value_unit"] == "animals/km2" and d["sdm:taxon"]["authorities"] == {"worms": 1576133}
  assert items["rices_whale_04_cv"]["properties"]["atlas:value_range"] == [0, 2]
  assert items["kemps_ridley_sea_turtle_04_cv"]["properties"]["sdm:taxon"]["group"] == "turtle"
  s = items["survey_all_annual_groups"]["properties"]
  assert s["atlas:value_range"] == [0, 5.0]                            # p98 0 -> the max
  assert "atlas:overlay_filter" not in s and "sdm:taxon" not in s
  assert s["sdm:value_unit"] == "count" and s["start_datetime"] == "2003-06-14T00:00:00Z"
  assert items["survey_aerial_annual_effort_km"]["properties"]["end_datetime"] == "2018-02-28T23:59:59Z"
  v = items["rices_whale_04_density"]["assets"]["values"]
  assert v["href"] == "../values.parquet" and v["atlas:key_column"] == "FID" and v["atlas:value_column"] == "rices_whale__04__density"


def test_collection_cube_default_view_version_links_and_profiles():
  _, layers = values_fixture()
  assets = {o["id"]: {"href": f"./{o['id']}.pmtiles", "type": stac.PMTILES, "roles": ["overlay"],
                      "pmtiles:layers": [o["id"]]} for o in sefsc_gm.OVERLAYS}
  ov = sefsc_gm.overlays_block(_fields())
  c = stac.sefsc_collection(MODELS, layers, [-98, 18, -80, 31], ("2003-01-01T00:00:00Z", "2024-12-31T23:59:59Z"), assets, ov)
  dims = c["cube:dimensions"]
  # the default view is the first value of every dimension: survey_all / annual / effort_km
  assert [dims[k]["values"][0] for k in ("layer", "month", "variable")] == ["survey_all", "annual", "effort_km"]
  assert dims["layer"]["values"] == ["survey_all", "survey_vessel", "survey_aerial", "kemps_ridley_sea_turtle", "rices_whale"]
  assert dims["layer"]["atlas:taxon_dim"] is True and dims["layer"]["atlas:labels"]["rices_whale"] == "Rice’s whale"
  assert dims["month"]["values"] == ["annual", "04", "05"] and dims["month"]["atlas:labels"]["04"] == "April"
  assert c["version"] == "2" and c["atlas:access"] == "restricted" and c["atlas:status"] == "review"
  assert c["deprecated"] is False and c["license"] == "CC-PDDC"
  pred = [l for l in c["links"] if l["rel"] == "predecessor-version"]
  assert pred == [stac.SEFSC_PREDECESSOR] and pred[0]["href"] == "https://oceanmetrics.io/atlas/?c=msens-v8-gm"
  assert not any(l["rel"] == "successor-version" for l in c["links"])
  assert c["atlas:overlays"] == ov
  items = stac.sefsc_items(MODELS, layers, [-98, 18, -80, 31], _intervals())
  assert profiles.check_profiles(c, items) == []
  # a layers.csv layer that is neither a survey layer nor a model is refused
  with pytest.raises(ValueError, match="differ"):
    stac.sefsc_collection(MODELS[:1], layers, [-98, 18, -80, 31], ("a", "b"), assets, ov)


# ---- the DONE gate ----

def _md5(p: Path) -> str:
  return hashlib.md5(p.read_bytes()).hexdigest()


def write_done(src: Path) -> None:
  files = sorted(p for p in src.iterdir() if p.is_file() and p.name != "DONE")
  (src / "DONE").write_text("ingest_sefsc_gm-surveys 0123456789abcdef\n" + "".join(f"{_md5(p)} {p.name}\n" for p in files))


def make_src(src: Path) -> Path:
  """a complete synthetic notebook output folder (three hexagons, two vessel and one aerial segment, three sightings)."""
  src.mkdir(parents=True, exist_ok=True)
  values, layers = values_fixture()
  values.to_parquet(src / "values.parquet", index=False)
  with open(src / "layers.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(layers[0]))
    w.writeheader()
    w.writerows(layers)
  with open(src / "models.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(MODELS[0]))
    w.writeheader()
    w.writerows(MODELS)
  hx = [hexagon(-88.0 + 0.1 * i, 27.0) for i in range(3)]
  gpd.GeoDataFrame({"HEXID": [float(h) for h in HEXIDS], "Area_km2": 40.0, "USA_EEZ": [1, 1, 0], "Oceanic": [1, 0, 1],
                    "Shelf": [0, 1, 2], "vessel_km": [4.0, None, 2.5], "aerial_km": [None, None, 1.0],
                    "vessel_groups": [0, 1, 2], "aerial_groups": [None, None, 0], "vessel_individuals": [0.0, 3.0, 7.0],
                    "aerial_individuals": [None, None, 0.0], "vessel_surveys": [1, 1, 1], "aerial_surveys": [None, None, 1],
                    "vessel_years": ["2003", "2017", "2003-2024"], "aerial_years": [None, None, "2011"]},
                   geometry=hx, crs=4326).pipe(_write, src, "hexagons")
  line = lambda x: shapely.LineString([(x, 27.0), (x + 0.05, 27.01)])  # noqa: E731
  gpd.GeoDataFrame({"segment.id": [2.0, 7.0], "HEXID": [101.0, 103.0], "trackline": ["1", "5"],
                    "s.date": ["2003-06-14 10:54:59", "2024-09-30 11:14:10"], "e.date": ["2003-06-14 11:11:30", "2024-09-30 11:30:00"],
                    "survey": ["GU0302", "GU2402"], "Sample.Label": ["GU0302-2", "GU2402-7"], "seg.length.m": [5073.0, 4934.0],
                    "platform": "vessel", "year": [2003, 2024], "month": [6, 9], "length_km": [5.073, 4.934], "n_sightings": [1, 1]},
                   geometry=[line(-88.0), line(-87.8)], crs=4326).pipe(_write, src, "effort_vessel")
  gpd.GeoDataFrame({"unique.seg.id": [257], "survey": ["TOSE11Fa"], "date": ["2011-10-12"], "HEXID": [103.0],
                    "seg.len.m": [1000.0], "platform": "aerial", "year": [2011], "month": [10], "length_km": [1.0], "n_sightings": [1]},
                   geometry=[shapely.MultiLineString([line(-87.8)])], crs=4326).pipe(_write, src, "effort_aerial")
  common = {"name_resolved": ["Balaenoptera ricei", "Delphinidae"], "aphia_id": [1576133, 136980],
            "accepted_name": ["Balaenoptera ricei", "Delphinidae"], "rank": ["Species", "Family"], "id_certain": [True, True],
            "models": ["|rices_whale|", ""], "segment_found": [True, False], "in_own_hex": [True, True],
            "dist_to_segment_m": [0.0, None]}
  gpd.GeoDataFrame({"sightid": [1, 2], "survey": ["GU0302", "GU2402"], "segment.id": [2.0, 9.0], "HEXID": [101.0, 103.0],
                    "date.time": ["2003-06-14 11:04:20", "2024-09-30 12:04:38"], "vernacularName": ["Rice's whale", "Delphinidae"],
                    "scientificName": ["Balaenoptera ricei", "Delphinidae"], "group.size": [2.0, 5.0], "platform": "vessel",
                    "year": [2003, 2024], "month": [6, 9], "lon": [-88.0, -87.8], "lat": [27.0, 27.0], **common,
                    "trackline": ["1", None], "s.date": ["2003-06-14 10:54:59", None], "e.date": ["2003-06-14 11:11:30", None]},
                   geometry=shapely.points([(-88.0, 27.0), (-87.8, 27.0)]), crs=4326).pipe(_write, src, "sightings_vessel")
  gpd.GeoDataFrame({"unique.id": [3], "survey": ["TOSE11Fa"], "date.time": ["2011-10-13 14:21:00"], "Common.Name": ["Bottlenose dolphin"],
                    "group.size": [1.0], "lat": [27.0], "lon": [-87.8], "SciName": ["Standard Tursiops"], "HEXID": [103.0],
                    "unique.seg.id": [257], "platform": "aerial", "year": [2011], "month": [10],
                    "name_resolved": ["Tursiops truncatus"], "aphia_id": [137111], "accepted_name": ["Tursiops truncatus"],
                    "rank": ["Species"], "id_certain": [True], "models": ["|oceanic_common_bottlenose_dolphin|shelf_common_bottlenose_dolphin|"],
                    "segment_found": [True], "in_own_hex": [True], "dist_to_segment_m": [0.0], "date": ["2011-10-12"]},
                   geometry=shapely.points([(-87.8, 27.0)]), crs=4326).pipe(_write, src, "sightings_aerial")
  (src / "taxa.csv").write_text("name,platform,n,name_resolved,aphia_id,accepted_name,rank,id_certain,models,candidates,note\n"
                                "Balaenoptera ricei,vessel,1,Balaenoptera ricei,1576133,Balaenoptera ricei,Species,TRUE,|rices_whale|,Balaenoptera ricei,\n"
                                "Delphinidae,vessel,1,Delphinidae,136980,Delphinidae,Family,TRUE,,Delphinidae,higher taxon\n")
  (src / "checks.csv").write_text("group,check,value,note\nrows,hexagons,3,synthetic\n")
  (src / "questions.md").write_text("# Questions for the provider\n\n- **Positions.** Platform or animal?\n")
  (src / "SEFSC_Line_Transect_Survey_Data_ReadMe.txt").write_text("HEXID - the identifier for the hexagon\n")
  write_done(src)
  return src


def _write(g: gpd.GeoDataFrame, src: Path, name: str) -> None:
  g.to_parquet(src / f"{name}.parquet", index=False)
  g.to_file(src / f"{name}.fgb", driver="FlatGeobuf")


def test_done_gate_refuses_a_missing_stale_or_changed_output(tmp_path):
  src = make_src(tmp_path / "src")
  assert sefsc_gm.done_stamp(src).startswith("ingest_sefsc_gm-surveys ")
  (src / "DONE").unlink()
  with pytest.raises(FileNotFoundError, match="has not finished"):
    sefsc_gm.done_stamp(src)
  write_done(src)
  (src / "checks.csv").write_text("group,check,value,note\nrows,hexagons,4,changed\n")   # changed after DONE
  with pytest.raises(FileNotFoundError):
    sefsc_gm.done_stamp(src)
  write_done(src)
  (src / "taxa.csv").unlink()
  with pytest.raises(FileNotFoundError, match="missing"):
    sefsc_gm.done_stamp(src)
  # a DONE that is not this notebook's (it lists no values.parquet)
  (src / "DONE").write_text("something else\n")
  with pytest.raises(FileNotFoundError, match="does not list"):
    sefsc_gm.done_stamp(src)


def test_build_refuses_without_done(tmp_path):
  src = make_src(tmp_path / "src")
  (src / "DONE").unlink()
  with pytest.raises(FileNotFoundError):
    sefsc_gm.build(src, tmp_path / "out", prefix_file=tmp_path / "p.txt", thumbnail=False, log=lambda *_: None)
  assert not (tmp_path / "out" / stac.SEFSC_ID).exists()


def test_new_prefix_is_a_ulid_never_another_collections(tmp_path):
  other = tmp_path / "other.txt"
  other.write_text(ULID + "\n")
  mine = tmp_path / "mine.txt"
  mine.write_text(ULID + "\n")   # collides: replaced by a fresh one
  p = sefsc_gm.new_prefix(mine, [other])
  assert p != ULID and len(p) == 26 and sefsc_gm.new_prefix(mine, [other]) == p


# ---- end to end (tippecanoe) ----

@needs_tiles
def test_build_stages_a_collection_that_passes_its_checks_and_the_profiles(tmp_path):
  src = make_src(tmp_path / "src")
  out = tmp_path / "out"
  pf = tmp_path / "restricted_prefix_sefsc_gm.txt"
  r = sefsc_gm.build(src, out, prefix_file=pf, thumbnail=False, log=lambda *_: None)
  dest = r["dest"]
  coll = json.loads((dest / "collection.json").read_text())
  items = [json.loads(p.read_text()) for p in sorted((dest / "items").glob("*.json"))]
  prefix = pf.read_text().strip()
  assert sefsc_gm.check_collection(dest, coll, prefix) == []
  assert profiles.check_profiles(coll, items) == []
  assert r["base"] == f"https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/atlas-restricted/{prefix}/sefsc_gm/"
  # values: HEXID -> FID (int64), one row group
  import pyarrow.parquet as pq
  md = pq.read_metadata(dest / "values.parquet")
  assert md.num_row_groups == 1 and pq.read_schema(dest / "values.parquet").field("FID").type == "int64"
  # every attribute of every overlay survives tippecanoe, booleans as booleans
  f = sefsc_gm.pmtiles_fields(dest / "sightings_vessel.pmtiles", "sightings_vessel")
  assert f["id_certain"] == "Boolean" and f["models"] == "String" and "dist_to_segment_m" in f
  assert sefsc_gm.pmtiles_fields(dest / "hex.pmtiles", "hex") == {"FID": "Number"}
  for o in coll["atlas:overlays"]:
    assert coll["assets"][o["asset"]]["href"] == f"./{o['id']}.pmtiles"
  # seeded faults the check must catch
  bad = dict(coll, **{"atlas:access": None})
  assert "atlas:access is not restricted" in sefsc_gm.check_collection(dest, bad, prefix)
  assert any("predecessor" in m for m in sefsc_gm.check_collection(
    dest, dict(coll, links=[l for l in coll["links"] if l["rel"] != "predecessor-version"]), prefix))
  assert any("not a ULID" in m for m in sefsc_gm.check_collection(dest, coll, "public"))
  ov = json.loads(json.dumps(coll["atlas:overlays"]))
  ov[0]["fields"].append("no_such_field")
  assert any("no_such_field" in m for m in sefsc_gm.check_collection(dest, dict(coll, **{"atlas:overlays": ov}), prefix))
  ip = dest / "items" / "rices_whale_04_density.json"
  it = json.loads(ip.read_text())
  it["properties"]["atlas:overlay_filter"]["token"] = "kemps_ridley_sea_turtle"
  ip.write_text(json.dumps(it))
  assert any("rices_whale_04_density.json: overlay filter" in m for m in sefsc_gm.check_collection(dest, coll, prefix))
  (dest / "README.md").write_text("contact someone@example.org\n")
  assert any("email" in m for m in sefsc_gm.check_collection(dest, coll, prefix))


def test_item_index_holds_exactly_the_item_files_and_the_check_catches_drift(tmp_path):
  src = make_src(tmp_path / "src")
  pf = tmp_path / "restricted_prefix_sefsc_gm.txt"
  dest = sefsc_gm.build(src, tmp_path / "out", prefix_file=pf, thumbnail=False, log=lambda *_: None)["dest"]
  coll = json.loads((dest / "collection.json").read_text())
  prefix = pf.read_text().strip()
  idx = json.loads((dest / "items.json").read_text())
  linked = [Path(l["href"]).stem for l in coll["links"] if l["rel"] == "item"]
  # one rel=items link; the index = the item files' objects, in link order, relative hrefs unchanged
  assert [l["href"] for l in coll["links"] if l["rel"] == "items"] == ["./items.json"]
  assert idx["type"] == "FeatureCollection" and [f["id"] for f in idx["features"]] == linked
  for f in idx["features"]:
    assert f == json.loads((dest / "items" / f"{f['id']}.json").read_text())
    assert all(not a["href"].startswith("http") for a in f["assets"].values())
  assert sefsc_gm.check_collection(dest, coll, prefix) == []
  # seeded faults: a stale index (an item edited after), a missing index, a dropped link
  it = json.loads((dest / "items" / f"{linked[0]}.json").read_text())
  it["properties"]["title"] = "edited after the index"
  (dest / "items" / f"{linked[0]}.json").write_text(json.dumps(it))
  assert any("differs from its items" in m for m in sefsc_gm.check_collection(dest, coll, prefix))
  (dest / "items.json").unlink()
  assert any("item index) not staged" in m for m in sefsc_gm.check_collection(dest, coll, prefix))
  nolink = dict(coll, links=[l for l in coll["links"] if l["rel"] != "items"])
  assert any("rel=items" in m for m in sefsc_gm.check_collection(dest, nolink, prefix))


def test_species_options_one_per_aphia_id_labelled_counted_with_their_models():
  sv = pd.DataFrame({"aphia_id": [1576133, 1576133, 136980, 137108], "accepted_name": ["Balaenoptera ricei"] * 2 +
                     ["Delphinidae", "Stenella frontalis"], "vernacularName": ["Rice's whale", "Rice's whale", "Delphinidae", None],
                     "models": ["|rices_whale|", "|rices_whale|", "", "|oceanic_atlantic_spotted_dolphin|shelf_atlantic_spotted_dolphin|"]})
  sa = pd.DataFrame({"aphia_id": [137108], "accepted_name": ["Stenella frontalis"], "Common.Name": ["Atlantic spotted dolphin"],
                     "models": ["|shelf_atlantic_spotted_dolphin|"]})
  o = sefsc_gm.species_options({"sightings_vessel": sv, "sightings_aerial": sa})
  assert [x["label"] for x in o] == ["Atlantic spotted dolphin (Stenella frontalis)", "Delphinidae", "Rice's whale (Balaenoptera ricei)"]
  assert [x["count"] for x in o] == [2, 1, 2]
  assert o[0]["layers"] == ["oceanic_atlantic_spotted_dolphin", "shelf_atlantic_spotted_dolphin"]
  assert "layers" not in o[1] and o[2]["layers"] == ["rices_whale"] and o[2]["value"] == 1576133
  with pytest.raises(ValueError, match="without an aphia_id"):
    sefsc_gm.species_options({"sightings_vessel": sv.assign(aphia_id=[None, 1, 2, 3])})


def test_filters_block_species_month_follows_the_cube_year_range_and_refuses_a_missing_field():
  sv = pd.DataFrame({"aphia_id": [1576133], "accepted_name": ["Balaenoptera ricei"], "vernacularName": ["Rice's whale"],
                     "models": ["|rices_whale|"]})
  fields = {o: ["aphia_id", "month", "year"] for o in sefsc_gm.TIME_OVERLAYS}
  yrs = {"effort_vessel": pd.Series([2003, 2024]), "effort_aerial": pd.Series([2011, 2018])}
  b = {f["id"]: f for f in sefsc_gm.filters_block({"sightings_vessel": sv}, yrs, fields)}
  assert list(b) == ["species", "month", "year"]
  assert b["species"]["overlays"] == ["sightings_vessel"] and b["species"]["field"] == "aphia_id"
  assert b["month"]["follow_dim"] == "month" and b["month"]["options"][6] == {"value": 7, "label": "July", "dim_value": "07"}
  assert b["month"]["overlays"] == sefsc_gm.TIME_OVERLAYS
  assert (b["year"]["type"], b["year"]["min"], b["year"]["max"]) == ("range", 2003, 2024)
  with pytest.raises(ValueError, match="field month not in overlay effort_aerial"):
    sefsc_gm.filters_block({"sightings_vessel": sv}, yrs, dict(fields, effort_aerial=["year"]))


def test_staged_filters_pass_the_check_and_a_bad_layer_or_field_is_caught(tmp_path):
  src = make_src(tmp_path / "src")
  pf = tmp_path / "restricted_prefix_sefsc_gm.txt"
  dest = sefsc_gm.build(src, tmp_path / "out", prefix_file=pf, thumbnail=False, log=lambda *_: None)["dest"]
  coll = json.loads((dest / "collection.json").read_text())
  prefix = pf.read_text().strip()
  assert [f["id"] for f in coll["atlas:overlay_filters"]] == ["species", "month", "year"]
  assert sefsc_gm.check_collection(dest, coll, prefix) == []
  bad = json.loads(json.dumps(coll))
  bad["atlas:overlay_filters"][0]["options"][0]["layers"] = ["no_such_model"]
  assert any("names a layer not in the cube" in m for m in sefsc_gm.check_collection(dest, bad, prefix))
  bad = json.loads(json.dumps(coll))
  bad["atlas:overlay_filters"][2]["field"] = "no_such_field"
  assert any("field no_such_field not in" in m for m in sefsc_gm.check_collection(dest, bad, prefix))
  bad = json.loads(json.dumps(coll))
  bad["atlas:overlay_filters"][1]["options"][0]["dim_value"] = "13"
  assert any("dim_value not in month" in m for m in sefsc_gm.check_collection(dest, bad, prefix))


def test_item_index_refuses_duplicate_ids():
  with pytest.raises(ValueError, match="duplicate"):
    stac.item_index([{"id": "a"}, {"id": "a"}])


# ---- publish.sh --only sefsc_gm: the restricted destination guard ----

def test_publish_only_sefsc_gm_goes_to_its_ulid_prefix_with_collection_json_last(tmp_path):
  d = tmp_path / "stage"
  (d / "sefsc_gm" / "items").mkdir(parents=True)
  (d / "sefsc_gm" / "collection.json").write_text("{}")
  pf = {"restricted_prefix_sefsc_gm.txt": ULID}
  src, dest = f"{d}/sefsc_gm", f"atlas-restricted/{ULID}/sefsc_gm"
  r, calls, _ = run_publish(tmp_path, d, "--only", "sefsc_gm", prefix_files=pf)
  assert r.returncode == 0, r.stderr
  assert calls == [f"--dry-run --exclude collection.json {src} {dest}",
                   f"--dry-run --cache-control no-cache {src}/collection.json {dest}"]
  r, calls, _ = run_publish(tmp_path, d, "--only", "sefsc_gm", "--really", prefix_files=pf)
  assert calls == [f"--really --exclude collection.json {src} {dest}", f"--really --cache-control no-cache {src}/collection.json {dest}"]
  assert not any("--delete" in c for c in calls)


def test_publish_only_sefsc_gm_uploads_the_item_index_gzip_encoded_before_collection_json(tmp_path):
  d = tmp_path / "stage"
  (d / "sefsc_gm" / "items").mkdir(parents=True)
  (d / "sefsc_gm" / "collection.json").write_text("{}")
  (d / "sefsc_gm" / "items.json").write_text('{"type": "FeatureCollection", "features": []}')
  pf = {"restricted_prefix_sefsc_gm.txt": ULID}
  src, dest = f"{d}/sefsc_gm", f"atlas-restricted/{ULID}/sefsc_gm"
  r, calls, _ = run_publish(tmp_path, d, "--only", "sefsc_gm", "--really", prefix_files=pf)
  assert r.returncode == 0, r.stderr
  assert calls[0] == f"--really --exclude collection.json --exclude items.json {src} {dest}"
  assert calls[1].startswith("--really --content-encoding gzip --cache-control no-cache ") and calls[1].endswith(f"/items.json {dest}")
  assert calls[2] == f"--really --cache-control no-cache {src}/collection.json {dest}"
  assert len(calls) == 3


def test_publish_only_sefsc_gm_refuses_a_prefix_that_is_not_a_ulid_or_another_collections_file(tmp_path):
  d = tmp_path / "stage"
  (d / "sefsc_gm").mkdir(parents=True)
  (d / "sefsc_gm" / "collection.json").write_text("{}")
  for bad in ("public", "01HZX3K9M2Q7R8S4T5V6W7X8", "ILOU" + ULID[4:], f"{ULID}/x"):
    r, calls, _ = run_publish(tmp_path, d, "--only", "sefsc_gm", "--really", prefix_files={"restricted_prefix_sefsc_gm.txt": bad})
    assert r.returncode == 1 and calls == [], bad
  # the CCE prefix file is not this collection's: without its own file nothing runs
  r, calls, _ = run_publish(tmp_path, d, "--only", "sefsc_gm", "--really", prefix_files={"restricted_prefix_swfsc_cce.txt": ULID})
  assert r.returncode == 1 and calls == []
