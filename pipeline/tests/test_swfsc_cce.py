"""swfsc_cce_becker2020b (restricted): one test per rule, synthetic 2-band COGs and a synthetic models.csv.

Gates and their planted faults (CLAUDE.md: every gate ships with a seeded fault):
  check_collection   an email, an href outside the prefix, a missing COG, a non-restricted access -> flagged
  check_staging      catalog.json linking the collection -> flagged
  publish.sh --only  a prefix that is not a ULID -> refused before any aws call
"""

import csv
import json
import os
import re
import stat
import subprocess
from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from atlas_pipeline import cli, docs, stac, swfsc_cce

PREFIX = "01K8ZZZZZZZZZZZZZZZZZZZZZZ"   # a 26-character Crockford ULID shape
PIPE = Path(__file__).resolve().parent.parent
HUMPBACK, BLUE = 137092, 137090

ROWS = [
  {"layer": "Mn", "species": "Humpback whale", "scientific_name": "Megaptera novaeangliae", "worms_id": str(HUMPBACK),
   "season": "summer-fall", "mdl_key": "swfsc_cce|137092|summer-fall", "cog": f"cce_{HUMPBACK}_summer-fall.tif",
   "n_cells": "12", "abundance_source": "4000", "abundance_regridded": "3990", "density_min": "0.0001",
   "density_p98": "0.004", "density_max": "0.006", "cv_median": "0.31"},
  {"layer": "Bm", "species": "Blue whale", "scientific_name": "Balaenoptera musculus", "worms_id": str(BLUE),
   "season": "summer-fall", "mdl_key": "swfsc_cce|137090|summer-fall", "cog": f"cce_{BLUE}_summer-fall.tif",
   "n_cells": "6", "abundance_source": "1500", "abundance_regridded": "1497", "density_min": "0.0002",
   "density_p98": "0.002", "density_max": "0.003", "cv_median": "0.42"},
]
WEST, NORTH, RES = -126.0, 40.0, 0.05


def _rows():
  return [dict(r, worms_id=int(r["worms_id"])) for r in ROWS]


def write_cog(path: Path, data_rows: slice, data_cols: slice, nodata=float("nan"), noise: float = 0.0) -> None:
  """a small 2-band float32 GeoTIFF: a window aligned to the 0.05 degree global grid, as the ingest writes them."""
  h, w = 40, 60
  fill = np.nan if nodata != nodata else nodata
  dens = np.full((h, w), fill, dtype="float32")
  cv = np.full((h, w), fill, dtype="float32")
  dens[data_rows, data_cols] = 0.002
  cv[data_rows, data_cols] = 0.3
  path.parent.mkdir(parents=True, exist_ok=True)
  with rasterio.open(path, "w", driver="GTiff", height=h, width=w, count=2, dtype="float32", crs="EPSG:4326",
                     transform=from_origin(WEST - noise, NORTH - noise, RES + noise * 1e-3, RES - noise * 1e-3),
                     nodata=nodata) as ds:
    ds.write(dens, 1)
    ds.write(cv, 2)


def make_src(tmp: Path, done: bool = True) -> Path:
  src = tmp / "swfsc_cce"
  # the delivered nodata, and the delivered transform's float noise (origin 4.4e-6 off, res 1.7e-9 off)
  write_cog(src / "cog" / ROWS[0]["cog"], slice(10, 20), slice(5, 15), nodata=-9999.0, noise=4.4e-6)
  write_cog(src / "cog" / ROWS[1]["cog"], slice(0, 4), slice(30, 40))
  with open(src / "models.csv", "w", newline="") as f:
    wr = csv.DictWriter(f, fieldnames=list(ROWS[0]))
    wr.writeheader()
    wr.writerows(ROWS)
  if done:
    (src / "DONE").write_text("")
  return src


@pytest.fixture
def built(tmp_path):
  src = make_src(tmp_path)
  out = tmp_path / "staging"
  pf = tmp_path / "restricted_prefix_swfsc_cce.txt"
  pf.write_text(PREFIX + "\n")
  r = swfsc_cce.build(src, out, prefix_file=pf, thumbnail=False, log=lambda m: None)
  return r, out / stac.CCE_ID


def collection_and_items():
  base = stac.restricted_base_url(PREFIX, stac.CCE_ID)
  bbox = [-126.0, 38.0, -123.0, 40.0]
  return stac.cce_collection(_rows(), bbox, base), stac.cce_items(_rows(), bbox, base, float("nan"))


# ---- the collection validates ----

def test_collection_and_items_have_the_required_stac_and_sdm_fields():
  c, items = collection_and_items()
  assert stac.check_stac_required(c) == []
  assert len(items) == 4 and all(stac.check_stac_required(i) == [] for i in items.values())
  assert c["stac_version"] == "1.1.0" and stac.EXT["sdm"] in c["stac_extensions"]
  assert c["sdm:response_type"] == "density" and c["sdm:method"] == "density_surface_model"
  assert c["sdm:temporal_interval"] == "seasonal" and c["sdm:source_authority"] == "NOAA SWFSC"


def test_collection_and_items_pass_the_stac_sdm_schema_offline():
  jsonschema = pytest.importorskip("jsonschema")
  schema_path = Path("~/Github/MarineSensitivity/stac-sdm/json-schema/schema.json").expanduser()
  if not schema_path.exists():
    pytest.skip("stac-sdm schema checkout not present")
  schema = json.loads(schema_path.read_text())
  c, items = collection_and_items()
  jsonschema.validate(c, schema)
  for it in items.values():
    jsonschema.validate(it, schema)


def test_collection_and_items_parse_with_pystac():
  pystac = pytest.importorskip("pystac")
  c, items = collection_and_items()
  assert pystac.Collection.from_dict(c).id == stac.CCE_ID
  for it in items.values():
    assert pystac.Item.from_dict(it).collection_id == stac.CCE_ID


@pytest.mark.network
def test_staged_collection_validates_with_pystac_schemas(built):
  pystac = pytest.importorskip("pystac")
  _, dest = built
  pystac.Collection.from_file(str(dest / "collection.json")).validate()
  for p in sorted((dest / "items").glob("*.json")):
    pystac.Item.from_file(str(p)).validate()


# ---- restricted, unlisted, credited ----

def test_collection_is_restricted_with_the_review_note():
  c, _ = collection_and_items()
  assert c["atlas:access"] == "restricted"
  assert c["atlas:note"] == (
    "Under review: shared by link for provider and BOEM/MMA review; not for distribution. Density as delivered "
    "(animals per km²), area-weighted onto a 0.05° grid by Ocean Metrics for the Marine Sensitivity Toolkit; not yet "
    "used in any score.")
  assert "UNDER REVIEW" in c["description"] and "not for distribution" in c["description"]


def test_not_linked_from_the_root_catalog():
  text = json.dumps(stac.root_catalog(stac.EXTERNAL_CHILDREN))
  assert stac.CCE_ID not in text and "atlas-restricted" not in text and "swfsc" not in text.lower()


def test_check_staging_flags_a_catalog_that_links_it(tmp_path):
  # seeded fault: catalog.json gains a child link to the restricted collection
  out = tmp_path / "staging"
  out.mkdir()
  cat = stac.root_catalog([])
  cat["links"].append({"rel": "child", "href": f"./{stac.CCE_ID}/collection.json", "type": "application/json"})
  stac.write_json(out / "catalog.json", cat)
  assert "catalog.json links the restricted collection" in cli.check_staging(out)


def test_no_email_anywhere():
  c, items = collection_and_items()
  readme = docs.cce_readme(_rows())
  for text in [json.dumps(c, ensure_ascii=False), *map(json.dumps, items.values()), readme]:
    assert not swfsc_cce.EMAIL_RE.search(text)
  assert all("emails" not in x for x in c["contacts"])
  assert [x["name"] for x in c["contacts"]] == ["Elizabeth A. Becker"]


def test_citation_doi_license_and_use_constraints_from_inport():
  c, _ = collection_and_items()
  assert c["sci:citation"].startswith("Becker, E. A., Forney, K. A., Miller, D. L., Fiedler, P. C., Barlow, J., & Moore, J. E. (2020).")
  assert "NOAA Technical Memorandum NMFS-SWFSC-638" in c["sci:citation"]
  assert c["sci:doi"] == "10.25923/3znq-yx13"
  # public domain as a US Government work, to check (Ben 2026-10-22); "other" had linked a 404 SPDX page
  assert c["license"] == "CC-PDDC"
  lic = [l for l in c["links"] if l["rel"] == "license"]
  assert [l["href"] for l in lic] == ["https://www.usa.gov/government-copyright",
                                       "https://www.fisheries.noaa.gov/inport/item/64349"]
  assert "US Government work" in lic[0]["title"] and "to check" in lic[0]["title"]
  assert c["atlas:use_constraints"].startswith("*** No Warranty*** The user assumes the entire risk")
  assert c["atlas:use_constraints"].endswith("resulting from any use or misuse of these data.")
  readme = docs.cce_readme(_rows())
  assert stac.CCE_USE_CONSTRAINTS in readme and stac.CCE_CITATION in readme and stac.CCE_NOTE in readme
  roles = {p["name"]: p["roles"] for p in c["providers"]}
  assert roles["NOAA Southwest Fisheries Science Center (SWFSC)"] == ["producer"]
  assert roles["Ocean Metrics"] == ["processor", "host"]
  assert any(l["rel"] == "describedby" and l["href"] == "./README.md" for l in c["links"])


# ---- hrefs under the restricted prefix ----

def test_cog_hrefs_are_absolute_under_the_collections_restricted_prefix():
  _, items = collection_and_items()
  base = f"https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/atlas-restricted/{PREFIX}/{stac.CCE_ID}/cog/"
  for it in items.values():
    assert it["assets"]["cog"]["href"].startswith(base)
  assert items[f"{HUMPBACK}_density"]["assets"]["cog"]["href"] == base + f"cce_{HUMPBACK}_summer-fall.tif"


def test_collection_links_are_relative():
  c, _ = collection_and_items()
  for l in c["links"]:
    if l["rel"] in ("root", "self", "item", "describedby"):
      assert l["href"].startswith("./")


def test_restricted_base_url_refuses_an_empty_or_nested_prefix():
  for bad in ("", "a/b", None):
    with pytest.raises((ValueError, TypeError)):
      stac.restricted_base_url(bad, stac.CCE_ID)


# ---- dimensions and bands ----

def test_species_by_variable_cube_with_bidx_and_rescale():
  c, items = collection_and_items()
  dims = c["cube:dimensions"]
  assert list(dims) == ["species", "variable"]
  assert dims["species"]["values"] == [str(HUMPBACK), str(BLUE)] and dims["species"]["atlas:taxon_dim"] is True
  assert dims["species"]["atlas:labels"][str(HUMPBACK)] == "Humpback whale (Megaptera novaeangliae)"
  assert dims["variable"]["values"] == ["density", "cv"]
  assert dims["variable"]["atlas:labels"] == {"density": "Density (animals per km²)", "cv": "Coefficient of variation"}
  d, v = items[f"{HUMPBACK}_density"], items[f"{HUMPBACK}_cv"]
  assert d["properties"]["atlas:dims"] == {"species": str(HUMPBACK), "variable": "density"}
  assert d["assets"]["cog"]["atlas:bidx"] == 1 and d["assets"]["cog"]["atlas:rescale"] == [0, 0.004]   # [0, p98]
  assert v["assets"]["cog"]["atlas:bidx"] == 2 and v["assets"]["cog"]["atlas:rescale"] == [0, 2]
  assert d["assets"]["cog"]["href"] == v["assets"]["cog"]["href"]      # one 2-band COG per species
  assert d["properties"]["sdm:value_unit"] == "animals/km2" and v["properties"]["sdm:value_unit"] == "unitless"
  # a fixed rescale is the app's range only when the item has no atlas:value_range of its own
  assert "atlas:value_range" not in d["properties"] and "atlas:value_range" not in v["properties"]
  assert d["properties"]["sdm:taxon"] == {"scientific_name": "Megaptera novaeangliae", "common_name": "Humpback whale",
                                          "authorities": {"worms": HUMPBACK}, "group": "mammal"}
  assert d["properties"]["atlas:season"] == "summer-fall" and "Summer-Fall" in c["description"]


def test_a_name_worms_no_longer_accepts_is_labelled_with_both():
  base = {"species": "Long-beaked common dolphin", "scientific_name": "Delphinus capensis"}
  assert stac.cce_label(base | {"scientific_name_accepted": "Delphinus delphis"}) == (
    "Long-beaked common dolphin (Delphinus capensis; WoRMS accepted: D. delphis)")
  assert stac.cce_label({"species": "Pacific white-sided dolphin", "scientific_name": "Lagenorhynchus obliquidens",
                         "scientific_name_accepted": "Sagmatias obliquidens"}) == (
    "Pacific white-sided dolphin (Lagenorhynchus obliquidens; WoRMS accepted: Sagmatias obliquidens)")
  assert stac.cce_label(base | {"scientific_name_accepted": "Delphinus capensis"}) == "Long-beaked common dolphin (Delphinus capensis)"
  assert stac.cce_label(base) == "Long-beaked common dolphin (Delphinus capensis)"


def test_readme_says_what_the_cv_is_and_which_layers_are_delivered():
  readme = docs.cce_readme(_rows())
  assert '"Numerical uncertainty\nvalue (CV)"' in readme or '"Numerical uncertainty value (CV)"' in readme.replace("\n", " ")
  assert "74.6 %" in readme and "93.5 %" in readme
  assert "sperm whale" in readme and "neither is in the geodatabase" in readme
  assert "ingest_swfsc_cce.html" not in readme   # the methods page is not live yet: no link to it


def test_density_rescale_is_0_to_p98_at_3_significant_figures():
  # regression: "auto" sent the band minimum (1.85e-14 for the humpback) as titiler's histogram_range -> 422
  row = {"species": "x", "density_p98": "0.00598184", "density_max": "0.09315"}
  assert stac.cce_density_rescale(row) == [0, 0.00598]
  assert stac.cce_density_rescale(row | {"density_p98": "1.96123"}) == [0, 1.96]
  assert stac.cce_density_rescale(row | {"density_p98": "0.0508462"}) == [0, 0.0508]
  assert stac.cce_density_rescale(row | {"density_p98": "0"}) == [0, 0.0931]          # p98 not positive: the max
  with pytest.raises(ValueError, match="below 1e-6"):
    stac.cce_density_rescale(row | {"density_p98": "4e-9"})
  _, items = collection_and_items()
  for it in items.values():
    lo, hi = it["assets"]["cog"]["atlas:rescale"]
    assert lo == 0 and hi > 0 and "e-" not in repr(hi) and it["assets"]["cog"]["atlas:rescale"] != "auto"


def test_duplicate_worms_id_is_refused():
  rows = _rows() + [_rows()[0]]
  with pytest.raises(ValueError, match="duplicate worms_id"):
    stac.cce_collection(rows, [0, 0, 1, 1], stac.restricted_base_url(PREFIX, stac.CCE_ID))


# ---- inputs ----

def test_read_models_normalises_the_cog_column(tmp_path):
  p = tmp_path / "models.csv"
  rows = [{**{k: v for k, v in r.items() if k != "cog"}, "cog_filename": f"x/{r['cog']}"} for r in ROWS]
  with open(p, "w", newline="") as f:
    wr = csv.DictWriter(f, fieldnames=list(rows[0]))
    wr.writeheader()
    wr.writerows(rows)
  got = swfsc_cce.read_models(p)
  assert [r["cog"] for r in got] == [ROWS[0]["cog"], ROWS[1]["cog"]] and got[0]["worms_id"] == HUMPBACK


def test_read_models_refuses_a_missing_column(tmp_path):
  p = tmp_path / "models.csv"
  p.write_text("layer,species\nMn,Humpback whale\n")
  with pytest.raises(ValueError, match="missing columns"):
    swfsc_cce.read_models(p)


def test_grid_problems_accepts_a_window_aligned_to_the_global_grid_and_flags_each_mismatch():
  # the delivered transform, float noise and all (cce_137092_summer-fall.tif)
  ok = dict(crs="EPSG:4326", res=(0.050000001695656514, 0.04999999915205396), west=-131.00000444262005,
            north=48.54999917664439, count=2, dtypes=("float32", "float32"))
  assert swfsc_cce.grid_problems(**ok) == []
  assert swfsc_cce.grid_problems(**(ok | {"west": -180.0, "north": 90.0})) == []          # the whole grid
  assert swfsc_cce.grid_problems(**(ok | {"res": (0.1, 0.1)}))
  assert swfsc_cce.grid_problems(**(ok | {"count": 1, "dtypes": ("float32",)}))
  assert swfsc_cce.grid_problems(**(ok | {"dtypes": ("float64", "float64")}))
  assert any("cell edge" in m for m in swfsc_cce.grid_problems(**(ok | {"west": -130.975})))   # half a cell off
  assert any("cell edge" in m for m in swfsc_cce.grid_problems(**(ok | {"north": 48.56})))
  assert swfsc_cce.grid_problems(**(ok | {"crs": "EPSG:3857"}))


def test_common_names_get_their_apostrophes_and_hyphens_back():
  fix = swfsc_cce.common_name
  assert fix("Bairds beaked whale") == "Baird's beaked whale"
  assert fix("Rissos dolphin") == "Risso's dolphin" and fix("Dalls porpoise") == "Dall's porpoise"
  assert fix("Long beaked common dolphin") == "Long-beaked common dolphin"
  assert fix("Short beaked common dolphin") == "Short-beaked common dolphin"
  assert fix("Pacific white sided dolphin") == "Pacific white-sided dolphin"
  assert fix("Humpback whale") == "Humpback whale"


def test_an_unaccepted_worms_id_is_kept_and_its_accepted_id_recorded():
  rows = [dict(_rows()[0], worms_id=254981, scientific_name="Lagenorhynchus obliquidens", species="Pacific white-sided dolphin",
               cog="cce_254981_summer-fall.tif", worms_status="junior objective synonym", worms_id_accepted="1571909",
               scientific_name_accepted="Sagmatias obliquidens"),
          dict(_rows()[1], worms_status="accepted", worms_id_accepted=str(BLUE), scientific_name_accepted="Balaenoptera musculus")]
  items = stac.cce_items(rows, [0, 0, 1, 1], stac.restricted_base_url(PREFIX, stac.CCE_ID))
  p = items["254981_density"]["properties"]
  assert p["atlas:dims"]["species"] == "254981" and p["sdm:taxon"]["authorities"] == {"worms": 254981}
  assert p["atlas:worms_id_accepted"] == 1571909 and p["atlas:scientific_name_accepted"] == "Sagmatias obliquidens"
  q = items[f"{BLUE}_density"]["properties"]
  assert "atlas:worms_id_accepted" not in q and "atlas:scientific_name_accepted" not in q
  readme = docs.cce_readme(rows)
  assert "*Lagenorhynchus obliquidens* (254981, junior objective synonym; accepted: *Sagmatias obliquidens*, 1571909)" in readme
  assert "137090" not in readme.split("WoRMS no longer accepts")[1].split("\n")[0]


def test_valid_bbox_is_the_data_extent_on_cell_edges():
  arr = np.full((40, 60), np.nan, dtype="float32")
  arr[10:20, 5:15] = 1.0
  assert swfsc_cce.valid_bbox(arr, WEST, NORTH, RES) == [-125.75, 39.0, -125.25, 39.5]
  assert swfsc_cce.valid_bbox(np.full((2, 2), np.nan), WEST, NORTH, RES) is None
  zero_nodata = np.zeros((4, 4), dtype="float32")
  zero_nodata[1, 2] = 3.0
  assert swfsc_cce.valid_bbox(zero_nodata, 0.0, 0.0, 1.0, nodata=0.0) == [2.0, -2.0, 3.0, -1.0]


# ---- the prefix ----

def test_the_prefix_is_its_own_never_biotracks(tmp_path):
  mine, theirs = tmp_path / "restricted_prefix_swfsc_cce.txt", tmp_path / "restricted_prefix.txt"
  theirs.write_text(cli.ulid() + "\n")
  p = swfsc_cce.new_prefix(mine, theirs)
  assert re.fullmatch(r"[0-9A-HJKMNP-TV-Z]{26}", p) and p != theirs.read_text().strip()
  assert swfsc_cce.new_prefix(mine, theirs) == p                    # created once, then kept
  # seeded collision: a file holding biotrack's prefix is replaced by a fresh one
  mine.write_text(theirs.read_text())
  assert swfsc_cce.new_prefix(mine, theirs) != theirs.read_text().strip()
  assert swfsc_cce.PREFIX_FILE.name == "restricted_prefix_swfsc_cce.txt"
  assert swfsc_cce.PREFIX_FILE != swfsc_cce.BIOTRACK_PREFIX_FILE


def test_both_prefix_files_are_git_ignored():
  r = subprocess.run(["git", "check-ignore", "-q", str(PIPE / "restricted_prefix_swfsc_cce.txt")], cwd=PIPE)
  assert r.returncode == 0
  r = subprocess.run(["git", "check-ignore", "-q", str(PIPE / "restricted_prefix.txt")], cwd=PIPE)
  assert r.returncode == 0


# ---- build ----

def test_build_waits_for_the_done_marker(tmp_path):
  src = make_src(tmp_path, done=False)
  with pytest.raises(FileNotFoundError, match="DONE"):
    swfsc_cce.build(src, tmp_path / "staging", prefix_file=tmp_path / "p.txt", thumbnail=False)
  assert not (tmp_path / "staging").exists() and not (tmp_path / "p.txt").exists()


def test_build_refuses_inputs_newer_than_the_done_marker(tmp_path):
  # seeded fault: the ingest rewrote a COG after DONE (a re-run in progress)
  src = make_src(tmp_path)
  cog = src / "cog" / ROWS[0]["cog"]
  t = (src / "DONE").stat().st_mtime_ns
  os.utime(cog, ns=(t + 10**9, t + 10**9))
  with pytest.raises(FileNotFoundError, match="re-running"):
    swfsc_cce.build(src, tmp_path / "staging", prefix_file=tmp_path / "p.txt", thumbnail=False)


def test_build_refuses_a_done_marker_rewritten_while_staging(tmp_path, monkeypatch):
  src = make_src(tmp_path)
  real = swfsc_cce.docs.cce_readme

  def rerun(rows):   # the ingest finishes a second run while the README is being written
    (src / "DONE").write_text("second run")
    return real(rows)

  monkeypatch.setattr(swfsc_cce.docs, "cce_readme", rerun)
  with pytest.raises(RuntimeError, match="changed while staging"):
    swfsc_cce.build(src, tmp_path / "staging", prefix_file=tmp_path / "p.txt", thumbnail=False)


def test_build_stages_items_cogs_readme_and_passes_its_own_check(built):
  r, dest = built
  assert r["items"] == 4 and r["species"] == 2
  assert sorted(p.name for p in (dest / "cog").iterdir()) == sorted(x["cog"] for x in ROWS)
  assert (dest / "README.md").exists() and (dest / "models.csv").exists()
  coll = json.loads((dest / "collection.json").read_text())
  assert swfsc_cce.check_collection(dest, coll, PREFIX) == []
  hb = json.loads((dest / "items" / f"{HUMPBACK}_density.json").read_text())
  assert hb["bbox"] == [-125.75, 39.0, -125.25, 39.5]   # the species' own data extent, on grid edges (no float noise)
  assert coll["extent"]["spatial"]["bbox"] == [[-125.75, 39.0, -124.0, 40.0]]
  assert hb["assets"]["cog"]["file:size"] > 0 and hb["assets"]["cog"]["file:checksum"].startswith("1220")
  # regression: each item carries ITS COG's nodata (the build once applied the first COG's to every item)
  assert hb["assets"]["cog"]["raster:bands"][0]["nodata"] == -9999.0
  blue = json.loads((dest / "items" / f"{BLUE}_density.json").read_text())
  assert blue["assets"]["cog"]["raster:bands"][0]["nodata"] == "nan"
  assert blue["bbox"] == [-124.5, 39.8, -124.0, 40.0]
  # the species picker lists species by common name
  assert coll["cube:dimensions"]["species"]["values"] == [str(BLUE), str(HUMPBACK)]
  assert coll["assets"]["models"]["file:size"] > 0


def test_check_collection_flags_each_planted_fault(built):
  _, dest = built
  coll = json.loads((dest / "collection.json").read_text())
  # 1. an href outside this collection's prefix (biotrack's, say)
  p = dest / "items" / f"{BLUE}_cv.json"
  it = json.loads(p.read_text())
  it["assets"]["cog"]["href"] = it["assets"]["cog"]["href"].replace(PREFIX, "01AAAAAAAAAAAAAAAAAAAAAAAA")
  p.write_text(json.dumps(it))
  assert any("not under this collection's restricted prefix" in m for m in swfsc_cce.check_collection(dest, coll, PREFIX))
  # 2. an email in the README
  (dest / "README.md").write_text("contact someone@noaa.gov\n")
  assert any("email" in m for m in swfsc_cce.check_collection(dest, coll, PREFIX))
  # 3. a public collection
  assert "atlas:access is not restricted" in swfsc_cce.check_collection(dest, coll | {"atlas:access": "public"}, PREFIX)
  # 4. a COG the items name but staging lacks
  (dest / "cog" / ROWS[0]["cog"]).unlink()
  assert any("not staged under cog/" in m for m in swfsc_cce.check_collection(dest, coll, PREFIX))


def test_a_rebuild_drops_items_the_new_models_csv_no_longer_lists(tmp_path):
  src = make_src(tmp_path)
  out, pf = tmp_path / "staging", tmp_path / "p.txt"
  pf.write_text(PREFIX + "\n")
  swfsc_cce.build(src, out, prefix_file=pf, thumbnail=False, log=lambda m: None)
  with open(src / "models.csv", "w", newline="") as f:
    wr = csv.DictWriter(f, fieldnames=list(ROWS[0]))
    wr.writeheader()
    wr.writerow(ROWS[0])
  (src / "DONE").write_text("second run")   # the ingest finished again, DONE last
  swfsc_cce.build(src, out, prefix_file=pf, thumbnail=False, log=lambda m: None)
  assert sorted(p.name for p in (out / stac.CCE_ID / "items").iterdir()) == [f"{HUMPBACK}_cv.json", f"{HUMPBACK}_density.json"]
  assert [p.name for p in (out / stac.CCE_ID / "cog").iterdir()] == [ROWS[0]["cog"]]


# ---- publish.sh --only ----

FAKE_AWS = """#!/usr/bin/env bash
echo "$@" >> "$AWS_LOG"
"""


def run_publish(tmp_path, stage, prefix_dir, *args):
  bindir = tmp_path / "bin"
  bindir.mkdir(exist_ok=True)
  aws = bindir / "aws"
  aws.write_text(FAKE_AWS)
  aws.chmod(aws.stat().st_mode | stat.S_IEXEC)
  log = tmp_path / "aws.log"
  log.write_text("")
  env = os.environ | {"PATH": f"{bindir}:{os.environ['PATH']}", "AWS_LOG": str(log), "ATLAS_STAGE": str(stage),
                      "ATLAS_PREFIX_DIR": str(prefix_dir), "ATLAS_BUCKET": "oceanmetrics.io-public"}
  r = subprocess.run(["bash", str(PIPE / "publish.sh"), *args], env=env, capture_output=True, text=True)
  return r, [l for l in log.read_text().splitlines() if l]


def test_publish_only_touches_nothing_but_the_collections_restricted_prefix(built, tmp_path):
  _, dest = built
  stage = dest.parent
  # the rest of a staged catalog is present and must NOT be uploaded
  (stage / "biotrack_indicators").mkdir()
  (stage / "biotrack_indicators" / "collection.json").write_text("{}")
  stac.write_json(stage / "catalog.json", stac.root_catalog([]))
  (tmp_path / "restricted_prefix_swfsc_cce.txt").write_text(PREFIX + "\n")
  r, calls = run_publish(tmp_path, stage, tmp_path, "--only", stac.CCE_ID)
  assert r.returncode == 0, r.stderr
  target = f"s3://oceanmetrics.io-public/atlas-restricted/{PREFIX}/{stac.CCE_ID}/"
  assert calls and all("--dryrun" in c for c in calls)
  for c in calls:
    dests = [w for w in c.split() if w.startswith("s3://")]
    assert len(dests) == 1 and dests[0].startswith(target), c
  joined = "\n".join(calls)
  assert "catalog.json" not in joined and "biotrack" not in joined and "aquamaps" not in joined
  assert calls[0].startswith(f"s3 sync {dest}/cog {target}cog") and "--content-type image/tiff" in calls[0]
  assert "--content-type application/json" in calls[1] and f"{target}items" in calls[1]
  assert calls[-1].startswith(f"s3 cp {dest}/collection.json {target}collection.json")
  assert "--cache-control no-cache" in calls[-1] and "--content-type application/json" in calls[-1]


def test_publish_only_really_drops_the_dryrun_flag(built, tmp_path):
  _, dest = built
  (tmp_path / "restricted_prefix_swfsc_cce.txt").write_text(PREFIX + "\n")
  r, calls = run_publish(tmp_path, dest.parent, tmp_path, "--only", stac.CCE_ID, "--really")
  assert r.returncode == 0 and calls and not any("--dryrun" in c for c in calls)


def test_publish_only_refuses_a_prefix_that_is_not_a_ulid(built, tmp_path):
  # seeded fault: the prefix file points the upload somewhere else
  _, dest = built
  for bad in ("..", "public", "01K8ZZZZZZZZZZZZZZZZZZZZZZ/../../atlas"):
    (tmp_path / "restricted_prefix_swfsc_cce.txt").write_text(bad + "\n")
    r, calls = run_publish(tmp_path, dest.parent, tmp_path, "--only", stac.CCE_ID, "--really")
    assert r.returncode != 0 and "refusing" in r.stderr and calls == []


def test_publish_only_refuses_an_unknown_collection(built, tmp_path):
  _, dest = built
  r, calls = run_publish(tmp_path, dest.parent, tmp_path, "--only", "biotrack_indicators", "--really")
  assert r.returncode == 2 and calls == []


def test_full_publish_never_uploads_this_collection():
  text = (PIPE / "publish.sh").read_text()
  full = text[text.index('[ -d "$stage/biotrack_indicators" ]'):]
  assert stac.CCE_ID not in full and "swfsc" not in full
