"""atlas_pipeline/cog.py: what the browser COG renderer needs, written at publish (platform spike 3). One test per
rule, synthetic GeoTIFFs written by rasterio, GDAL on the PATH.

Gates and their planted faults:
  band_summary       an EPSG:3857 raster (the copy) -> refused; an empty band -> refused
  ensure_overviews   averaging -> refused; averaged overviews -> rebuilt nearest
  check_cog_assets   a 3857 copy without proj:code or without statistics -> flagged with its asset key
"""

import json
import math
import shutil

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from atlas_pipeline import cli, cog, profiles, stac

pytestmark = pytest.mark.skipif(not (shutil.which("gdalwarp") and shutil.which("gdal_translate")),
                                reason="needs GDAL (gdalwarp, gdal_translate)")
R = 6378137.0


def merc(lon: float, lat: float) -> tuple[float, float]:
  return R * math.radians(lon), R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def write_tif(path, bands, transform, nodata=None, dtype="uint8", crs="EPSG:4326", **kw):
  bands = [np.asarray(b) for b in bands]
  h, w = bands[0].shape
  with rasterio.open(path, "w", driver="GTiff", height=h, width=w, count=len(bands), dtype=dtype, crs=crs,
                     transform=transform, nodata=nodata, **kw) as ds:
    for i, b in enumerate(bands, 1):
      ds.write(b.astype(dtype), i)
  return path


def global_half_degree(path):
  """a 0.5 degree global uint8 grid (the AquaMaps native shape): random 1..100, nodata 255 north of 80N, a 5 x 5
  block of 42 centred on 10.25E 20.25N."""
  a = np.random.default_rng(7).integers(1, 101, (360, 720)).astype("uint8")
  a[:20] = 255
  a[137:142, 378:383] = 42
  return write_tif(path, [a], from_origin(-180, 90, 0.5, 0.5), nodata=255)


# ---- web_mercator_copy ----

def test_web_mercator_copy_is_3857_tiled_256_with_overviews_nodata_and_values_kept(tmp_path):
  src = global_half_degree(tmp_path / "am.tif")
  dst, zoom = cog.web_mercator_copy(src, tmp_path / "am_3857.tif")
  # UPPER: a 0.5 degree file (55 km) stays at zoom 2 (39 km); AUTO dropped it to zoom 1 (78 km)
  assert zoom == (0, 2)
  with rasterio.open(dst) as ds:
    assert ds.crs.to_epsg() == 3857
    assert ds.block_shapes == [(256, 256)] and ds.overviews(1) == [2, 4]
    assert ds.tags(ns="IMAGE_STRUCTURE")["LAYOUT"] == "COG"
    assert ds.tags(ns="IMAGE_STRUCTURE")["COMPRESSION"] == "DEFLATE"
    assert ds.tags(ns="IMAGE_STRUCTURE")["OVERVIEW_RESAMPLING"] == "NEAREST"
    assert ds.tags(ns="TILING_SCHEME")["NAME"] == "GoogleMapsCompatible"
    assert ds.nodata == 255 and ds.count == 1
    # clipped to the mercator limit, not past it
    assert ds.bounds.top <= merc(0, 85.06)[1] and ds.bounds.bottom >= -merc(0, 85.06)[1]
    (v,), (nd,) = ds.sample([merc(10.25, 20.25), merc(0.1, 82.0)])
  assert v == 42 and nd == 255


def test_the_clip_window_applies_only_past_the_mercator_limit():
  assert cog._clip_window((-180, -80, 180, 80)) == []
  assert cog._clip_window((-130, -90, -110, 90)) == ["-te_srs", "EPSG:4326", "-te", "-130", "-85.0511287798",
                                                     "-110", "85.0511287798"]


def test_web_mercator_copy_refuses_a_raster_without_a_crs(tmp_path):
  src = write_tif(tmp_path / "x.tif", [np.ones((4, 4))], from_origin(0, 4, 1, 1), crs=None)
  with pytest.raises(ValueError, match="no CRS"):
    cog.web_mercator_copy(src, tmp_path / "x_3857.tif")


# ---- ensure_overviews ----

def test_overview_sizes_halve_until_the_larger_side_is_at_most_256():
  assert cog.overview_sizes(7200, 3600) == [(3600, 1800), (1800, 900), (900, 450), (450, 225), (225, 113)]
  assert cog.overview_sizes(720, 283) == [(360, 142), (180, 71)]
  assert cog.overview_sizes(256, 100) == []


def test_ensure_overviews_rebuilds_a_file_without_overviews_and_keeps_its_compression(tmp_path):
  a = np.random.default_rng(1).integers(0, 100, (500, 1000)).astype("uint8")
  f = write_tif(tmp_path / "m.tif", [a], from_origin(-180, 90, 0.36, 0.36), nodata=255, compress="lzw")
  r = cog.ensure_overviews(f)
  assert r["rebuilt"] and r["levels"] == [[500, 250], [250, 125]] and r["before"]["levels"] == []
  with rasterio.open(f) as ds:
    st = ds.tags(ns="IMAGE_STRUCTURE")
    assert st["LAYOUT"] == "COG" and st["OVERVIEW_RESAMPLING"] == "NEAREST" and st["COMPRESSION"] == "LZW"
    assert ds.overviews(1) == [2, 4] and ds.nodata == 255
    assert (ds.read(1) == a).all()   # full resolution untouched
    ovr = ds.read(1, out_shape=(125, 250))
  assert set(np.unique(ovr)) <= set(np.unique(a))   # nearest: every overview value is a source value


def test_ensure_overviews_rebuilds_averaged_overviews_nearest_then_leaves_them(tmp_path):
  """regression: the EOV COGs' overviews were built by averaging (+29% on the legend's mean): rebuilt nearest."""
  a = np.random.default_rng(2).integers(0, 100, (600, 600)).astype("uint8")
  f = tmp_path / "avg.tif"
  write_tif(tmp_path / "plain.tif", [a], from_origin(0, 60, 0.1, 0.1), nodata=255)
  cog._run(["gdal_translate", "-q", "-of", "COG", "-co", "OVERVIEW_RESAMPLING=AVERAGE", "-co", "BLOCKSIZE=256",
            str(tmp_path / "plain.tif"), str(f)])
  r = cog.ensure_overviews(f)
  assert r["rebuilt"] and r["before"]["resampling"] == "AVERAGE" and r["levels"] == [[300, 300], [150, 150]]
  with rasterio.open(f) as ds:
    assert ds.tags(ns="IMAGE_STRUCTURE")["OVERVIEW_RESAMPLING"] == "NEAREST" and ds.block_shapes == [(256, 256)]
  mtime = f.stat().st_mtime_ns
  assert cog.ensure_overviews(f)["rebuilt"] is False and f.stat().st_mtime_ns == mtime


def test_a_categorical_raster_gets_mode_overviews(tmp_path):
  """each 2 x 2 block holds 3 pixels of one class and 1 of another, in a random corner: the overview is the majority."""
  rng = np.random.default_rng(3)
  n = 160   # 320 x 320 -> one overview level, 160 x 160
  major = rng.integers(1, 6, (n, n))
  minor = (major + rng.integers(1, 4, (n, n))) % 6 + 1
  a = np.repeat(np.repeat(major, 2, 0), 2, 1)
  corner = rng.integers(0, 4, (n, n))
  rows, cols = np.indices((n, n))
  a[2 * rows + corner // 2, 2 * cols + corner % 2] = minor
  f = write_tif(tmp_path / "cls.tif", [a], from_origin(0, 32, 0.1, 0.1), nodata=0)
  r = cog.ensure_overviews(f, resampling="mode")
  assert r["levels"] == [[160, 160]]
  with rasterio.open(f) as ds:
    assert ds.tags(ns="IMAGE_STRUCTURE")["OVERVIEW_RESAMPLING"] == "MODE"
    ovr = ds.read(1, out_shape=(n, n))
  assert (ovr == major).all()


def test_ensure_overviews_refuses_averaging(tmp_path):
  f = write_tif(tmp_path / "a.tif", [np.ones((4, 4))], from_origin(0, 4, 1, 1))
  with pytest.raises(ValueError, match="never averaging"):
    cog.ensure_overviews(f, resampling="average")


# ---- band_summary ----

def write_six(path, crs="EPSG:4326"):
  """the Day 2 fixture: 2 x 3 float32, two bands, nodata -9999 (and a NaN)."""
  return write_tif(path, [[[1, 2, 3], [4, 5, -9999]], [[0.5, 1.5, np.nan], [2.5, 3.5, -9999]]],
                   from_origin(-126, 40, 0.05, 0.05), nodata=-9999.0, dtype="float32", crs=crs)


def test_band_summary_statistics_and_histogram_of_a_six_pixel_band(tmp_path):
  f = write_six(tmp_path / "t.tif")
  b1, b2 = cog.band_summary(f, 1), cog.band_summary(f, 2)
  assert b1["statistics"] == {"minimum": 1.0, "maximum": 5.0, "mean": 3.0, "stddev": 1.41421, "valid_percent": 83.33}
  assert b2["statistics"] == {"minimum": 0.5, "maximum": 3.5, "mean": 2.0, "stddev": 1.11803, "valid_percent": 66.67}
  # 32 equal-width buckets from min to max, the maximum in the last: (v - 1) / 4 * 32 -> 0, 8, 16, 24, 31
  h1 = [0] * 32
  for k in (0, 8, 16, 24, 31):
    h1[k] = 1
  assert b1["histogram"] == {"count": 32, "min": 1.0, "max": 5.0, "buckets": h1}
  h2 = [0] * 32
  for k in (0, 10, 21, 31):   # (v - 0.5) / 3 * 32
    h2[k] = 1
  assert b2["histogram"] == {"count": 32, "min": 0.5, "max": 3.5, "buckets": h2}
  with rasterio.open(f) as ds:   # an open dataset reads the same
    assert cog.band_summary(ds, 1) == b1


def test_band_summary_refuses_a_band_with_no_valid_pixel(tmp_path):
  f = write_tif(tmp_path / "e.tif", [[[-9999] * 3] * 2], from_origin(0, 2, 1, 1), nodata=-9999.0, dtype="float32")
  with pytest.raises(ValueError, match="no valid pixel"):
    cog.band_summary(f, 1)
  assert cog.band_summaries(f) == [None]


def test_band_summary_refuses_the_web_mercator_copy(tmp_path):
  """seeded fault: statistics from the 3857 copy carry the mercator area bias (-23% on the EOV mean)."""
  f = write_six(tmp_path / "m.tif", crs="EPSG:3857")
  with pytest.raises(ValueError, match="not the EPSG:3857 copy"):
    cog.band_summary(f, 1)
  assert cog.band_summary(f, 1, allow_web_mercator=True)["statistics"]["mean"] == 3.0


def test_band_summary_reads_full_resolution_not_the_overviews(tmp_path):
  """averaged overviews of a skewed band move its mean; the summary is the full-resolution one."""
  a = np.full((512, 512), 255, dtype="uint8")
  a[::2, ::2] = np.random.default_rng(4).integers(0, 10, (256, 256))
  a[0, 0] = 200
  write_tif(tmp_path / "p.tif", [a], from_origin(0, 51.2, 0.1, 0.1), nodata=255)
  f = tmp_path / "avg.tif"
  cog._run(["gdal_translate", "-q", "-of", "COG", "-co", "OVERVIEW_RESAMPLING=AVERAGE", "-co", "BLOCKSIZE=128",
            str(tmp_path / "p.tif"), str(f)])
  v = a[a != 255].astype("float64")
  s = cog.band_summary(f, 1)["statistics"]
  assert s["mean"] == stac._sig(v.mean()) and s["maximum"] == 200.0 and s["valid_percent"] == 25.0


def test_histogram_clamps_values_outside_the_range_into_the_end_buckets():
  assert cog.histogram([-5, 0, 10, 15], 0, 10, 4) == [2, 0, 0, 2]
  assert cog.histogram([3, 3], 3, 3, 2) == [2, 0]   # a constant band: one bucket


# ---- the STAC assets ----

def test_copy_href_puts_the_copy_beside_the_original():
  assert cog.copy_href("../score_risk.tif") == "../score_risk_3857.tif"
  assert cog.copy_href("https://x.org/a/cog/cce_1.tif") == "https://x.org/a/cog/cce_1_3857.tif"
  with pytest.raises(ValueError):
    cog.copy_href("https://x.org/a.b/noext")


SUM = {"statistics": {"minimum": 0.0, "maximum": 88.0, "mean": 2.957, "stddev": 9.249, "valid_percent": 62.69},
       "histogram": {"count": 2, "min": 0.0, "max": 88.0, "buckets": [10, 3]}}


def eov_item(rescale=True):
  a = {"href": "../score_risk.tif", "type": cog.COG_T, "roles": ["data"], "title": "Fish, risk (band 1)",
       "atlas:bidx": 1, "atlas:colormap": "viridis",
       "raster:bands": [{"name": "fish", "data_type": "uint8", "nodata": 255, "unit": "score"},
                        {"name": "seabirds", "data_type": "uint8", "nodata": 255, "unit": "score"}]}
  if rescale:
    a["atlas:rescale"] = [0, 100]
  return {"type": "Feature", "stac_version": "1.1.0", "id": "fish_risk", "stac_extensions": [],
          "properties": {"datetime": None, "atlas:dims": {"eov": "fish", "metric": "risk"}},
          "assets": {"cog": a, "density": {"href": "../density_risk.tif", "type": cog.COG_T, "roles": ["reference"]}}}


def test_add_cog_assets_writes_the_original_and_the_3857_copy_with_the_same_bands():
  it = cog.add_cog_assets(eov_item(), "cog", [SUM, SUM], "EPSG:4326",
                          copy_info={"href": "../score_risk_3857.tif", "file:size": 10, "file:checksum": "1220ab",
                                     "atlas:zoom": [0, 5]})
  o, c = it["assets"]["cog"], it["assets"]["cog_3857"]
  assert o["proj:code"] == "EPSG:4326" and o["roles"] == ["data"]
  # @oceanmetrics/map pickCogAssets: both have the data role; the EPSG:3857 one is drawn, the other read for numbers
  assert c["proj:code"] == "EPSG:3857" and c["roles"] == ["data", "visual"] and c["type"] == cog.COG_T
  assert c["href"] == "../score_risk_3857.tif" and c["atlas:zoom"] == [0, 5] and c["file:size"] == 10
  assert (c["atlas:bidx"], c["atlas:rescale"], c["atlas:colormap"]) == (1, [0, 100], "viridis")
  assert c["raster:bands"] == o["raster:bands"] and o["raster:bands"][0]["histogram"] == SUM["histogram"]
  assert o["raster:bands"][0]["unit"] == "score"   # the writer's band keys are kept
  assert it["properties"]["proj:code"] == "EPSG:4326"
  assert stac.EXT["projection"] in it["stac_extensions"] and stac.EXT["file"] in it["stac_extensions"]
  assert "cog_3857" not in eov_item()["assets"]   # the input is not changed


def test_an_empty_band_takes_the_display_range_and_no_histogram():
  """AquaMaps models no seabirds: the band has no valid pixel, yet the `cog` profile requires minimum and maximum."""
  it = cog.add_cog_assets(eov_item(), "cog", [SUM, None], "EPSG:4326", copy_info={"href": "../score_risk_3857.tif"})
  b = it["assets"]["cog"]["raster:bands"][1]
  assert b["statistics"] == {"minimum": 0, "maximum": 100, "valid_percent": 0.0} and "histogram" not in b
  with pytest.raises(ValueError, match="no valid pixel and no atlas:rescale"):
    cog.add_cog_assets(eov_item(rescale=False), "cog", [SUM, None])


def test_add_cog_assets_refuses_a_band_count_that_differs_from_the_cog():
  with pytest.raises(ValueError, match="lists 2 bands, the COG has 1"):
    cog.add_cog_assets(eov_item(), "cog", [SUM])


def test_a_3857_original_gets_no_copy():
  it = cog.add_cog_assets(eov_item(), "cog", [SUM, SUM], "EPSG:3857", copy_info={"href": "x_3857.tif"})
  assert "cog_3857" not in it["assets"] and it["assets"]["cog"]["proj:code"] == "EPSG:3857"


def test_data_cog_key_is_the_asset_naming_the_file():
  assert cog.data_cog_key(eov_item(), "/x/score_risk.tif") == "cog"
  it = eov_item()
  it["assets"]["other"] = dict(it["assets"]["cog"], href="../score_share.tif")
  assert cog.data_cog_key(it, "/x/score_share.tif") == "other"
  with pytest.raises(ValueError, match="cannot tell"):
    cog.data_cog_key(it, "/x/unknown.tif")


# ---- the profile: both assets checked against `cog` ----

def two_asset_item():
  return cog.add_cog_assets(eov_item(), "cog", [SUM, SUM], "EPSG:4326", copy_info={"href": "../score_risk_3857.tif"})


def test_check_cog_assets_checks_each_data_cog_on_its_own():
  assert profiles.check_cog_assets(two_asset_item()) == []
  # seeded faults: the copy without statistics, then without its own proj:code
  it = two_asset_item()
  del it["assets"]["cog_3857"]["raster:bands"][0]["statistics"]
  bad = profiles.check_cog_assets(it)
  assert bad and all(m.startswith("[cog cog_3857]") for m in bad) and any("statistics" in m for m in bad)
  it = two_asset_item()
  del it["assets"]["cog_3857"]["proj:code"]
  assert profiles.check_cog_assets(it) == [
    "[cog cog_3857] /assets/cog_3857: an item with 2 data COGs needs proj:code on each asset"]


# ---- publish_cog_item and the cli ----

def eov_tif(path):
  """a 2-band EOV-shaped score COG at 0.5 degree: band 1 scores 0..88, band 2 empty (all nodata 255)."""
  a = np.full((360, 720), 255, dtype="uint8")
  a[60:300, :] = np.random.default_rng(5).integers(0, 89, (240, 720))
  return write_tif(path, [a, np.full_like(a, 255)], from_origin(-180, 90, 0.5, 0.5), nodata=255, compress="deflate")


def test_publish_cog_item_writes_the_copy_once_and_the_item_passes_the_cog_profile(tmp_path):
  tif = eov_tif(tmp_path / "score_risk.tif")
  it, rep = cog.publish_cog_item(eov_item(), tif)
  assert rep["copy"] == tmp_path / "score_risk_3857.tif" and rep["zoom"] == (0, 2) and rep["overviews"]["rebuilt"]
  assert it["assets"]["cog_3857"]["file:size"] == rep["bytes"] == rep["copy"].stat().st_size
  assert it["assets"]["cog_3857"]["file:checksum"].startswith("1220")
  assert it["assets"]["cog"]["raster:bands"][1]["statistics"]["valid_percent"] == 0.0
  assert profiles.check_cog_assets(it) == []
  mtime = rep["copy"].stat().st_mtime_ns
  it2, rep2 = cog.publish_cog_item(eov_item(), tif, summaries=rep["summaries"])
  assert rep2["copy"].stat().st_mtime_ns == mtime and not rep2["overviews"]["rebuilt"] and it2 == it


def test_cli_cog_assets_rewrites_each_item_in_place(tmp_path):
  tif = eov_tif(tmp_path / "score_risk.tif")
  (tmp_path / "items").mkdir()
  paths = []
  for eov in ("fish", "seabirds"):
    it = eov_item()
    it["id"] = f"{eov}_risk"
    p = tmp_path / "items" / f"{eov}_risk.json"
    stac.write_json(p, it)
    paths.append(p)
  assert cli.main(["cog-assets", *map(str, paths), str(tif)]) == 0
  for p in paths:
    it = json.loads(p.read_text())
    assert it["assets"]["cog_3857"]["href"] == "../score_risk_3857.tif"
    assert it["assets"]["cog"]["raster:bands"][0]["histogram"]["count"] == 32
    assert profiles.check_cog_assets(it) == []
  assert (tmp_path / "score_risk_3857.tif").exists()


# ---- a reference asset's copy (the EOV density files) ----

def test_a_reference_assets_copy_goes_under_its_own_key_and_is_never_the_one_drawn():
  """`--key density`: the copy is `density_3857`, roles reference + visual, and the score's `cog_3857` is kept; so
  pickCogAssets (the first data asset in EPSG:3857) still draws the score copy."""
  it = two_asset_item()
  it["assets"]["density"]["raster:bands"] = [{"name": "fish", "data_type": "float32", "nodata": "nan"},
                                             {"name": "seabirds", "data_type": "float32", "nodata": "nan"}]
  out = cog.add_cog_assets(it, "density", [SUM, None], "EPSG:4326", copy_info={"href": "../density_risk_3857.tif"},
                           copy_key="density_3857")
  d = out["assets"]["density_3857"]
  assert d["href"] == "../density_risk_3857.tif" and d["roles"] == ["reference", "visual"]
  assert d["proj:code"] == "EPSG:3857" and out["assets"]["cog_3857"] == it["assets"]["cog_3857"]
  draw = [k for k, a in out["assets"].items() if "data" in a["roles"] and a.get("proj:code") == "EPSG:3857"]
  assert draw == ["cog_3857"]
  # an empty band of a reference asset (not under the cog profile) is only valid_percent 0, no borrowed range
  assert out["assets"]["density"]["raster:bands"][1]["statistics"] == {"valid_percent": 0.0}
  assert profiles.check_cog_assets(out) == []


def test_copy_roles_add_visual_to_the_originals():
  assert cog.copy_roles(["data"]) == ["data", "visual"] and cog.copy_roles(None) == ["data", "visual"]
  assert cog.copy_roles(["reference"]) == ["reference", "visual"]


def test_publish_cog_item_names_a_non_data_assets_copy_after_its_key(tmp_path):
  tif = eov_tif(tmp_path / "density_risk.tif")
  it, rep = cog.publish_cog_item(eov_item(), tif, key="density")
  assert it["assets"]["density_3857"]["href"] == "../density_risk_3857.tif"
  assert "cog_3857" not in it["assets"] and rep["copy"] == tmp_path / "density_risk_3857.tif"
