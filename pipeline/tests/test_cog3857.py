"""atlas_pipeline/cog3857.py: the 3857 copies of a MST release's COGs and the side table `cog_3857.parquet` (week 6
step 5, D8). One test per rule, a synthetic release (three tiny 4326 GeoTIFFs, the three release tables and the store
catalog) under a local `marine-atlas/` root, GDAL on the PATH.

Gates and their planted faults:
  the schema     the side table is exactly SCHEMA, one row per distinct COG, the copy at its key, EPSG:3857
  the resume     a second run does nothing; a run cut by --limit or a torn journal line finishes the rest
  the hash       content_hash is the ORIGINAL's store key (not the copy's); a release row whose content_hash is not
                 its file stem is refused; a download whose md5 is not the store catalog's is refused, not appended
"""

import json
import shutil

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
import pytest
import rasterio
from rasterio.transform import from_origin

from atlas_pipeline import cli, cog, cog3857

pytestmark = pytest.mark.skipif(not (shutil.which("gdalwarp") and shutil.which("gdal_translate")),
                                reason="needs GDAL (gdalwarp, gdal_translate)")
URL = cog3857.BASE   # the release tables name originals path-style, as the published ones do
H = {"usa": "aaaa000000000001", "score": "bbbb000000000002", "native": "cccc000000000003"}


def tiny_tif(path, value=None, dtype="uint8", nodata=0, empty=False):
  """a 40 x 20 grid at 0.5 degrees over 10..30E, 10..20N; values 1..100 (or `value`), nodata 0 in the left column."""
  a = np.random.default_rng(len(str(path))).integers(1, 101, (20, 40)).astype(dtype)
  if value is not None:
    a[:] = value
  a[:, 0] = nodata
  if empty:
    a[:] = nodata
  path.parent.mkdir(parents=True, exist_ok=True)
  with rasterio.open(path, "w", driver="GTiff", height=20, width=40, count=1, dtype=dtype, crs="EPSG:4326",
                     transform=from_origin(10, 20, 0.5, 0.5), nodata=nodata) as ds:
    ds.write(a, 1)
  return path


def md5(p):
  return cog3857.md5_of(p)


@pytest.fixture
def release(tmp_path):
  """a local `marine-atlas/` root: v7's model_asset (two rows on one COG, one on another), score_cog, native_asset
  (a cog row and a pmtiles row), assets.parquet, and a fetcher that maps the path-style URLs onto it."""
  root = tmp_path / "bucket" / "marine-atlas"
  files = {"usa": tiny_tif(root / f"cog/usa05/{H['usa']}.tif"),
           "score": tiny_tif(root / f"cog/usa05/{H['score']}.tif", dtype="float32", nodata=-9999),
           "native": tiny_tif(root / f"native/am/{H['native']}.tif")}
  u = {k: f"{URL}{p.relative_to(root)}" for k, p in files.items()}
  tables = root / "v7" / "tables"
  tables.mkdir(parents=True)
  pq.write_table(pa.table({"mdl_key": ["a", "b", "c"], "content_hash": [H["usa"], H["usa"], H["score"]],
                           "cog_url": [u["usa"], u["usa"], u["score"]]}), tables / "model_asset.parquet")
  pq.write_table(pa.table({"content_hash": [H["score"]], "cog_url": [u["score"]]}), tables / "score_cog.parquet")
  pq.write_table(pa.table({"asset_type": ["cog", "pmtiles"], "content_hash": [H["native"], "dddd000000000004"],
                           "asset_url": [u["native"], f"{URL}native/bl/dddd000000000004.pmtiles"]}),
                 tables / "native_asset.parquet")
  pq.write_table(pa.table({"key": [str(p.relative_to(root)) for p in files.values()],
                           "md5": [md5(p) for p in files.values()],
                           "bytes": [float(p.stat().st_size) for p in files.values()]}), root / "assets.parquet")
  calls = []
  real = cog3857.fetch

  def fetcher(src, dest, session=None):
    calls.append(src)
    return real(str(root) + "/" + src[len(URL):] if src.startswith(URL) else src, dest)

  return {"root": root, "base": str(root) + "/", "files": files, "urls": u, "fetcher": fetcher, "calls": calls}


def run(release, out, **kw):
  return cog3857.run_batch("v7", out, release["base"], workers=2, fetcher=release["fetcher"], **kw)


# ---- naming ----

def test_the_copy_key_sits_under_the_release_with_the_originals_path_and_the_3857_suffix():
  for url in (f"{URL}cog/usa05/{H['usa']}.tif", f"https://oceanmetrics.io-public.s3.amazonaws.com/marine-atlas/cog/usa05/{H['usa']}.tif"):
    assert cog3857.rel_path(url) == f"cog/usa05/{H['usa']}.tif"
    assert cog3857.copy_key("v7", url) == f"marine-atlas/v7/cog_3857/cog/usa05/{H['usa']}_3857.tif"
    assert cog3857.content_hash_of(url) == H["usa"]
  with pytest.raises(ValueError, match="not a .tif"):
    cog3857.rel_path(f"{URL}native/bl/x.pmtiles")


# ---- the release's COG list ----

def test_release_cogs_are_the_distinct_tifs_of_the_three_tables_without_pmtiles(release, tmp_path):
  cogs = cog3857.release_cogs("v7", release["base"], tmp_path / "out")
  assert [c["content_hash"] for c in cogs] == sorted([H["usa"], H["score"], H["native"]],
                                                       key=lambda h: [c for c in release["urls"].values() if h in c][0])
  assert {c["url"] for c in cogs} == set(release["urls"].values())


def test_a_release_with_only_some_tables_is_read_and_one_with_none_is_refused(release, tmp_path):
  (release["root"] / "v7" / "tables" / "model_asset.parquet").unlink()
  (release["root"] / "v7" / "tables" / "score_cog.parquet").unlink()
  assert [c["content_hash"] for c in cog3857.release_cogs("v7", release["base"], tmp_path / "o")] == [H["native"]]
  with pytest.raises(FileNotFoundError):
    cog3857.release_cogs("v9", release["base"], tmp_path / "o")


# ---- the schema ----

def test_the_side_table_has_the_schema_one_row_per_cog_and_each_copy_at_its_key(release, tmp_path):
  out = tmp_path / "out"
  r = run(release, out)
  assert (r["total"], r["done"], r["failed"], r["rows"]) == (3, 3, 0, 3)
  t = pq.read_table(out / "v7" / "tables" / "cog_3857.parquet")
  assert t.schema.equals(cog3857.SCHEMA)
  rows = {x["content_hash"]: x for x in t.to_pylist()}
  assert set(rows) == set(H.values())
  for k, h in H.items():
    row = rows[h]
    assert row["url"] == release["urls"][k]
    assert row["cog_3857_key"] == cog3857.copy_key("v7", release["urls"][k])
    assert (row["proj:code"], row["src_proj:code"], row["bands"]) == ("EPSG:3857", "EPSG:4326", 1)
    assert (row["data_type"], row["nodata"]) == ((["float32"], [-9999.0]) if k == "score" else (["uint8"], [0.0]))
    copy = out / "v7" / row["cog_3857_key"][len("marine-atlas/v7/"):]
    assert copy.exists() and row["bytes"] == copy.stat().st_size and row["md5"] == md5(copy)
    with rasterio.open(copy) as ds:
      assert ds.crs.to_epsg() == 3857 and ds.tags(ns="IMAGE_STRUCTURE")["LAYOUT"] == "COG"
    assert row["zoom_max"] >= row["zoom_min"] >= 0
    assert len(row["histogram"][0]["buckets"]) == 32
  # the published layout: aws s3 sync <out>/v7/cog_3857 -> marine-atlas/v7/cog_3857, <out>/v7/tables -> v7/tables
  assert sorted(p.relative_to(out / "v7").as_posix() for p in (out / "v7").rglob("*.tif")) == sorted(
    r_["cog_3857_key"][len("marine-atlas/v7/"):] for r_ in rows.values())


def test_statistics_and_histogram_come_from_the_full_resolution_4326_original(release, tmp_path):
  out = tmp_path / "out"
  run(release, out)
  row = next(x for x in pq.read_table(out / "v7" / "tables" / "cog_3857.parquet").to_pylist()
             if x["content_hash"] == H["usa"])
  want = cog.band_summary(release["files"]["usa"], 1)
  assert row["statistics"][0] == want["statistics"]
  assert row["histogram"][0] == want["histogram"]
  assert row["statistics"][0]["valid_percent"] == 97.5   # the nodata column masked: 39 of 40 columns


def test_a_band_with_no_valid_pixel_gets_null_statistics_not_a_failure(release, tmp_path):
  tiny_tif(release["files"]["native"], empty=True)
  out = tmp_path / "out"
  r = cog3857.run_batch("v7", out, release["base"], workers=1, fetcher=release["fetcher"], store={})
  assert r["failed"] == 0
  row = next(x for x in pq.read_table(out / "v7" / "tables" / "cog_3857.parquet").to_pylist()
             if x["content_hash"] == H["native"])
  assert row["statistics"] == [None] and row["histogram"] == [None]


# ---- the resume ----

def test_a_second_run_skips_every_row_already_in_the_side_table(release, tmp_path):
  out = tmp_path / "out"
  run(release, out)
  n_calls = len(release["calls"])
  before = (out / "v7" / "tables" / "cog_3857.parquet").read_bytes()
  r = run(release, out)
  assert (r["skipped"], r["done"], r["rows"]) == (3, 0, 3)
  # only the release tables and the store catalog were read again, no original
  assert all(not c.endswith(".tif") for c in release["calls"][n_calls:])
  assert pq.read_table(out / "v7" / "tables" / "cog_3857.parquet").equals(pq.read_table(pa.BufferReader(before)))


def test_a_run_cut_short_resumes_from_the_journal_and_redoes_a_torn_line(release, tmp_path):
  out = tmp_path / "out"
  r1 = run(release, out, limit=2)
  assert (r1["done"], r1["rows"]) == (2, 2)
  j = out / "v7" / "cog_3857.jsonl"
  lines = j.read_text().splitlines()
  # a crash mid-write: the second line is torn; the side table on disk is lost too
  j.write_text(lines[0] + "\n" + lines[1][: len(lines[1]) // 2])
  (out / "v7" / "tables" / "cog_3857.parquet").unlink()
  r2 = run(release, out)
  assert (r2["skipped"], r2["done"], r2["rows"]) == (1, 2, 3)
  t = pq.read_table(out / "v7" / "tables" / "cog_3857.parquet")
  assert sorted(t["content_hash"].to_pylist()) == sorted(H.values())


def test_the_side_table_alone_is_enough_to_resume(release, tmp_path):
  out = tmp_path / "out"
  run(release, out, limit=1)
  (out / "v7" / "cog_3857.jsonl").unlink()
  r = run(release, out)
  assert (r["skipped"], r["done"], r["rows"]) == (1, 2, 3)


def test_rows_written_before_data_type_and_nodata_get_them_from_the_cached_original(release, tmp_path):
  out = tmp_path / "out"
  run(release, out)
  t = pq.read_table(out / "v7" / "tables" / "cog_3857.parquet")
  old = [dict(r, data_type=None, nodata=None) for r in t.to_pylist()]
  cog3857.write_table(old, out / "v7" / "tables" / "cog_3857.parquet")
  (out / "v7" / "cog_3857.jsonl").unlink()
  r = run(release, out)
  assert (r["skipped"], r["done"]) == (3, 0)
  rows = pq.read_table(out / "v7" / "tables" / "cog_3857.parquet").to_pylist()
  assert all(x["data_type"] and x["nodata"] for x in rows)


def test_the_side_table_is_sorted_by_content_hash_in_small_row_groups_with_statistics(tmp_path):
  rows = [{f.name: None for f in cog3857.SCHEMA} | {"content_hash": f"{i:016x}", "url": "u", "cog_3857_key": "k",
          "proj:code": "EPSG:3857", "src_proj:code": "EPSG:4326", "bands": 1, "bytes": 1, "md5": "m",
          "src_bytes": 1, "src_md5": "m", "created": "t"} for i in reversed(range(1100))]
  p = cog3857.write_table(rows, tmp_path / "t.parquet")
  md = pq.ParquetFile(p).metadata
  assert md.num_row_groups == 3
  st = [md.row_group(i).column(0).statistics for i in range(3)]
  assert [(s.min, s.max) for s in st] == [(f"{0:016x}", f"{511:016x}"), (f"{512:016x}", f"{1023:016x}"),
                                          (f"{1024:016x}", f"{1099:016x}")]


# ---- the hash ----

def test_content_hash_is_the_originals_store_key_not_the_copys(release, tmp_path):
  out = tmp_path / "out"
  run(release, out)
  for row in pq.read_table(out / "v7" / "tables" / "cog_3857.parquet").to_pylist():
    assert row["content_hash"] == row["url"].rsplit("/", 1)[-1][:-4]
    assert row["src_md5"] == md5(release["root"] / cog3857.rel_path(row["url"]))
    assert row["md5"] != row["src_md5"]


def test_a_release_row_whose_content_hash_is_not_its_file_stem_is_refused(release, tmp_path):
  p = release["root"] / "v7" / "tables" / "score_cog.parquet"
  pq.write_table(pa.table({"content_hash": ["ffff000000000009"], "cog_url": [release["urls"]["score"]]}), p)
  with pytest.raises(ValueError, match="not the file stem"):
    cog3857.release_cogs("v7", release["base"], tmp_path / "o")


def test_a_download_whose_md5_is_not_the_store_catalogs_is_refused_and_not_appended(release, tmp_path):
  out = tmp_path / "out"
  store = cog3857.store_catalog(release["base"], out)
  store[cog3857.rel_path(release["urls"]["usa"])] = ("0" * 32, 1)
  r = cog3857.run_batch("v7", out, release["base"], workers=1, fetcher=release["fetcher"], store=store)
  assert (r["done"], r["failed"], r["rows"]) == (2, 1, 2)
  assert H["usa"] not in pq.read_table(out / "v7" / "tables" / "cog_3857.parquet")["content_hash"].to_pylist()
  err = [json.loads(x) for x in (out / "v7" / "cog_3857_errors.jsonl").read_text().splitlines()]
  assert err[0]["content_hash"] == H["usa"] and "md5" in err[0]["error"]
  # the cached file was fetched twice (once more after the mismatch) before giving up
  assert sum(c == release["urls"]["usa"] for c in release["calls"]) == 2


# ---- the command ----

def test_the_command_writes_the_side_table_and_exits_0(release, tmp_path, monkeypatch):
  out = tmp_path / "out"
  monkeypatch.setattr(cog3857, "fetch", release["fetcher"])   # the command's own HTTP fetcher, pointed at the fixture
  assert cli.main(["cog-3857-batch", "--release", "v7", "--out", str(out), "--base", release["base"],
                   "--workers", "2"]) == 0
  assert pq.read_table(out / "v7" / "tables" / "cog_3857.parquet").num_rows == 3


# ---- the sweep counter ----

def om_catalog(tmp_path, with_copy=True, registry_copy=False):
  """a local OM atlas/ root: catalog.json -> one collection -> one Item over score.tif (with or without its
  cog_3857 asset), an external child (ignored), and an aquamaps_native registry of one species."""
  root = tmp_path / "om" / "atlas"
  (root / "eov" / "items").mkdir(parents=True, exist_ok=True)
  (root / "aquamaps_native").mkdir(parents=True, exist_ok=True)
  (root / "catalog.json").write_text(json.dumps({"links": [
    {"rel": "child", "href": "./eov/collection.json"},
    {"rel": "child", "href": "https://file.marinesensitivity.org/stac/v7/bl/collection.json"}]}))
  (root / "eov" / "collection.json").write_text(json.dumps({"links": [{"rel": "item", "href": "./items/a.json"}]}))
  assets = {"cog": {"href": "../score.tif", "type": cog.COG_T, "roles": ["data"], "proj:code": "EPSG:4326"},
            "thumb": {"href": "../t.png", "type": "image/png"}}
  if with_copy:
    assets["cog_3857"] = {"href": "../score_3857.tif", "type": cog.COG_T, "roles": ["data", "visual"],
                          "proj:code": "EPSG:3857"}
  (root / "eov" / "items" / "a.json").write_text(json.dumps({"assets": assets}))
  reg = {"cog_url": [f"{URL}native/am/eeee000000000005.tif"], "cog_url_005": [f"{URL}cog/global05/ffff000000000006.tif"]}
  if registry_copy:
    reg |= {"cog_3857_url": ["x_3857.tif"], "cog_3857_url_005": ["y_3857.tif"]}
  pq.write_table(pa.table(reg), root / "aquamaps_native" / "registry.parquet")
  return str(root) + "/"


def test_the_sweep_counts_every_referenced_cog_without_a_copy_once(release, tmp_path):
  out = tmp_path / "out"
  run(release, out, limit=2)   # two of v7's three COGs have a side-table row
  om = om_catalog(tmp_path)
  r = cog3857.sweep(["v7"], release["base"], om, side_dir=out)
  assert r["parts"] == {"mst v7": (3, 1), "om aquamaps_native registry": (2, 2), "om items": (1, 0)}
  assert (r["referenced"], r["missing"]) == (6, 3)
  assert cog3857.sweep_line(r) == ("COGs referenced without a 3857 copy = 3 of 6 (mst v7 1/3, "
                                   "om aquamaps_native registry 2/2, om items 0/1)")


def test_the_sweep_reaches_0_only_when_everything_has_a_copy_and_counts_a_missing_item_copy(release, tmp_path):
  out = tmp_path / "out"
  run(release, out)
  assert cog3857.sweep(["v7"], release["base"], om_catalog(tmp_path, registry_copy=True), side_dir=out)["missing"] == 0
  # seeded fault: the Item loses its cog_3857 asset
  r = cog3857.sweep(["v7"], release["base"], om_catalog(tmp_path, with_copy=False, registry_copy=True), side_dir=out)
  assert r["missing"] == 1 and r["parts"]["om items"] == (1, 1)


def test_the_sweep_reads_the_side_table_from_the_bucket_when_there_is_no_local_one(release, tmp_path):
  out = tmp_path / "out"
  run(release, out)
  dst = release["root"] / "v7" / "tables" / "cog_3857.parquet"
  shutil.copyfile(out / "v7" / "tables" / "cog_3857.parquet", dst)
  r = cog3857.sweep(["v7"], release["base"], om_catalog(tmp_path, registry_copy=True))
  assert r["parts"]["mst v7"] == (3, 0)


# ---- the shared pool (D8 part 2): one copy per content hash for every release and registry ----

P = {"v7b": "aaaa000000000007", "am": "cccc000000000008", "g05": "eeee000000000009"}


@pytest.fixture
def pool(release, tmp_path):
  """v7 as `release` gives it, plus a restricted-style v7b (model_asset: v7's usa COG and one new COG) and an OM
  aquamaps_native registry of two rows (row 1: v7's native COG + a new global05 COG; row 2: a new native COG + the
  same global05 COG)."""
  root = release["root"]
  new = {"v7b": tiny_tif(root / f"cog/usa05/{P['v7b']}.tif"),
         "am": tiny_tif(root / f"native/am/{P['am']}.tif"),
         "g05": tiny_tif(root / f"cog/global05/{P['g05']}.tif")}
  u = {k: f"{URL}{p.relative_to(root)}" for k, p in new.items()}
  tables = root / "v7b" / "tables"
  tables.mkdir(parents=True)
  pq.write_table(pa.table({"content_hash": [H["usa"], P["v7b"]], "cog_url": [release["urls"]["usa"], u["v7b"]]}),
                 tables / "model_asset.parquet")
  om = tmp_path / "om" / "atlas"
  (om / "aquamaps_native").mkdir(parents=True)
  (om / "catalog.json").write_text(json.dumps({"links": []}))
  reg = om / "aquamaps_native" / "registry.parquet"
  pq.write_table(pa.table({"sp_key": ["Fis-1", "Fis-2"], "cog_url": [release["urls"]["native"], u["am"]],
                           "cog_url_005": [u["g05"], u["g05"]], "rescale_min": pa.array([1, 1], pa.int32())}), reg)
  return {**release, "new": new, "new_urls": u, "om": str(om) + "/", "registry": reg}


def run_pool(pool, out, **kw):
  return cog3857.run_pool(["v7b"], ["aquamaps_native"], out, pool["base"], pool["om"], ["v7"], workers=2,
                          fetcher=pool["fetcher"], **kw)


def test_the_shared_key_is_the_content_hash_under_the_marine_atlas_root():
  assert cog3857.shared_key(P["g05"]) == f"marine-atlas/cog_3857/{P['g05']}_3857.tif"
  assert cog3857.key_url(cog3857.shared_key(P["g05"])) == f"{URL}cog_3857/{P['g05']}_3857.tif"
  assert cog3857.registry_path("aquamaps_native", "v2") == "aquamaps_native/registry/v2/registry.parquet"
  assert cog3857.registry_path("aquamaps_native") == "aquamaps_native/registry.parquet"


def test_the_pool_copies_the_union_of_the_releases_and_registries_minus_every_hash_a_side_table_has(pool, tmp_path):
  out = tmp_path / "out"
  run(pool, out)   # v7's own side table (3 rows), as the first batch left it
  v7_files = sorted(p.relative_to(out).as_posix() for p in (out / "v7").rglob("*.tif"))
  r = run_pool(pool, out)
  # union: v7b {usa, v7b}, registry {native, am, g05}; v7 has usa and native, so three are copied
  assert (r["total"], r["skipped"], r["done"], r["failed"]) == (5, 2, 3, 0)
  copied = sorted(p.name for p in (out / "shared" / "cog_3857").glob("*.tif"))
  assert copied == sorted(f"{h}_3857.tif" for h in P.values())
  # nothing of v7's is copied again, nothing written under v7/
  assert sorted(p.relative_to(out).as_posix() for p in (out / "v7").rglob("*.tif")) == v7_files
  assert not list((out / "shared").rglob(f"*{H['usa']}*"))


def test_the_shared_table_is_the_union_with_v7s_rows_pointing_at_their_existing_keys(pool, tmp_path):
  out = tmp_path / "out"
  run(pool, out)
  r = run_pool(pool, out)
  t = pq.read_table(out / "shared" / "tables" / "cog_3857.parquet")
  assert t.schema.equals(cog3857.SCHEMA)
  assert t["content_hash"].to_pylist() == sorted([*H.values(), *P.values()])   # every v7 row, the pool's own, sorted
  assert (r["rows"], r["pointer_rows"]) == (6, 3)
  rows = {x["content_hash"]: x for x in t.to_pylist()}
  v7 = {x["content_hash"]: x for x in pq.read_table(out / "v7" / "tables" / "cog_3857.parquet").to_pylist()}
  for h in H.values():   # the pointer rows: v7's row as it is, its key under marine-atlas/v7/
    assert rows[h] == v7[h] and rows[h]["cog_3857_key"].startswith("marine-atlas/v7/cog_3857/")
  for k, h in P.items():
    row = rows[h]
    assert row["cog_3857_key"] == cog3857.shared_key(h) and row["url"] == pool["new_urls"][k]
    copy = out / "shared" / "cog_3857" / f"{h}_3857.tif"
    assert row["md5"] == md5(copy) and row["src_md5"] == md5(pool["new"][k])
    with rasterio.open(copy) as ds:
      assert ds.crs.to_epsg() == 3857
  # the published layout: <out>/shared/cog_3857 -> marine-atlas/cog_3857, <out>/shared/tables -> marine-atlas/tables
  assert sorted(f"marine-atlas/cog_3857/{p.name}" for p in (out / "shared" / "cog_3857").glob("*.tif")) == sorted(
    x["cog_3857_key"] for x in rows.values() if x["content_hash"] in P.values())


def test_the_pool_reads_v7s_side_table_from_the_bucket_when_there_is_no_local_one(pool, tmp_path):
  out = tmp_path / "first"
  run(pool, out)
  dst = pool["root"] / "v7" / "tables" / "cog_3857.parquet"
  shutil.copyfile(out / "v7" / "tables" / "cog_3857.parquet", dst)
  r = run_pool(pool, tmp_path / "second")
  assert (r["skipped"], r["done"], r["pointer_rows"]) == (2, 3, 3)


def test_the_pool_resumes_and_a_second_run_copies_nothing(pool, tmp_path):
  out = tmp_path / "out"
  run(pool, out)
  r1 = run_pool(pool, out, limit=1)
  assert (r1["done"], r1["rows"]) == (1, 4)
  r2 = run_pool(pool, out)
  assert (r2["skipped"], r2["done"], r2["rows"]) == (3, 2, 6)
  n = len(pool["calls"])
  r3 = run_pool(pool, out)
  assert (r3["skipped"], r3["done"], r3["rows"]) == (5, 0, 6)
  assert all(not c.endswith(".tif") for c in pool["calls"][n:])


def test_the_registry_gets_a_new_version_with_the_copy_urls_and_the_current_one_is_untouched(pool, tmp_path):
  out = tmp_path / "out"
  run(pool, out)
  before = pool["registry"].read_bytes()
  r = run_pool(pool, out)
  dest = out / "om" / "aquamaps_native" / "registry" / "v2" / "registry.parquet"
  assert r["registries"]["aquamaps_native"] == {"path": str(dest), "rows": 2, "cog_3857_url": 2,
                                                "cog_3857_url_005": 2}
  assert pool["registry"].read_bytes() == before
  t = pq.read_table(dest)
  cur = pq.read_table(pool["registry"])
  assert t.column_names == cur.column_names + ["cog_3857_url", "cog_3857_url_005"]
  assert t.select(cur.column_names).equals(cur)   # the rows and columns as they were
  v7_native = cog3857.copy_key("v7", pool["urls"]["native"])
  assert t["cog_3857_url"].to_pylist() == [cog3857.key_url(v7_native, pool["base"]),     # v7's existing copy
                                           cog3857.key_url(cog3857.shared_key(P["am"]), pool["base"])]
  assert t["cog_3857_url_005"].to_pylist() == [cog3857.key_url(cog3857.shared_key(P["g05"]), pool["base"])] * 2


def test_a_registry_url_without_a_copy_is_null_in_the_new_version(pool, tmp_path):
  out = tmp_path / "out"
  run(pool, out)
  store = cog3857.store_catalog(pool["base"], out)
  store[cog3857.rel_path(pool["new_urls"]["g05"])] = ("0" * 32, 1)   # seeded fault: the global05 download fails
  r = cog3857.run_pool([], ["aquamaps_native"], out, pool["base"], pool["om"], ["v7"], workers=1, store=store,
                       fetcher=pool["fetcher"])
  assert (r["done"], r["failed"]) == (1, 1)
  assert r["registries"]["aquamaps_native"]["cog_3857_url_005"] == 0
  t = pq.read_table(out / "om" / "aquamaps_native" / "registry" / "v2" / "registry.parquet")
  assert t["cog_3857_url_005"].to_pylist() == [None, None]


def test_the_sweep_counts_a_release_cog_in_the_shared_table_and_reads_the_registrys_new_version(pool, tmp_path):
  out = tmp_path / "out"
  run(pool, out)
  before = cog3857.sweep(["v7", "v7b"], pool["base"], pool["om"], side_dir=out)
  # a release is covered by its own side table or the shared one, never by another release's: v7b's usa is
  # v7's file, but v7b has no side table and there is no shared table yet
  assert before["parts"]["mst v7b"] == (2, 2) and before["parts"]["om aquamaps_native registry"] == (3, 3)
  run_pool(pool, out)
  r = cog3857.sweep(["v7", "v7b"], pool["base"], pool["om"], side_dir=out)
  assert r["parts"] == {"mst v7": (3, 0), "mst v7b": (2, 0), "om aquamaps_native registry v2": (3, 0),
                        "om items": (0, 0)}
  assert r["missing"] == 0
  # the same from the bucket once uploaded: the shared table at marine-atlas/tables/, the registry under registry/v2/
  shutil.copyfile(out / "v7" / "tables" / "cog_3857.parquet", pool["root"] / "v7" / "tables" / "cog_3857.parquet")
  (pool["root"] / "tables").mkdir()
  shutil.copyfile(out / "shared" / "tables" / "cog_3857.parquet", pool["root"] / "tables" / "cog_3857.parquet")
  v2 = tmp_path / "om" / "atlas" / "aquamaps_native" / "registry" / "v2"
  v2.mkdir(parents=True)
  shutil.copyfile(out / "om" / "aquamaps_native" / "registry" / "v2" / "registry.parquet", v2 / "registry.parquet")
  assert cog3857.sweep(["v7", "v7b"], pool["base"], pool["om"])["missing"] == 0


def test_the_pool_command_writes_the_shared_table_and_the_registry_version(pool, tmp_path, monkeypatch):
  out = tmp_path / "out"
  run(pool, out)
  monkeypatch.setattr(cog3857, "fetch", pool["fetcher"])
  assert cli.main(["cog-3857-batch", "--pool", "--release", "v7b", "--registry", "aquamaps_native", "--out", str(out),
                   "--base", pool["base"], "--om-base", pool["om"], "--workers", "2"]) == 0
  assert pq.read_table(out / "shared" / "tables" / "cog_3857.parquet").num_rows == 6
  assert (out / "om" / "aquamaps_native" / "registry" / "v2" / "registry.parquet").exists()
  with pytest.raises(SystemExit):
    cli.main(["cog-3857-batch", "--release", "v7", "--release", "v7b", "--out", str(out)])
