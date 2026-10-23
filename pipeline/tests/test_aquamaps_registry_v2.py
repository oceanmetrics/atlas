"""aquamaps_native: the collection.json repointed at registry/v2/registry.parquet (the cog_3857_url columns), additively.

Rules, one test each: the registry asset's href, file:size, file:checksum and table:columns follow the file; the
collection version is bumped; nothing else of the live document changes; a file that is not the registry the
collection describes is refused; the staged collection passes the offline check; the command writes the staged file.
"""

import copy
import json
import re
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from atlas_pipeline import aquamaps as aq
from atlas_pipeline import cli, stac

from test_aquamaps import tables

LIVE_UPDATED = "2026-10-16T13:51:30Z"


@pytest.fixture
def live(tmp_path):
  """the collection as the v1 build writes it (the live one, with its unversioned registry asset) and its registry."""
  aq.build(tmp_path / "v1", tables=tables(), use_thumbnail=False, log=lambda m: None)
  d = tmp_path / "v1" / "aquamaps_native"
  coll = json.loads((d / "collection.json").read_text())
  coll["updated"] = LIVE_UPDATED
  return coll, d / "registry.parquet"


def write_v2(v1: Path, dest: Path, copies=True) -> Path:
  """registry v2 as `cog3857.write_registry_version` writes it: the v1 rows and columns, plus the two copy columns."""
  t = pq.read_table(v1)
  for col, src in (("cog_3857_url", "cog_url"), ("cog_3857_url_005", "cog_url_005")):
    vals = [u.replace("/native/am/", "/cog_3857/").replace(".tif", "_3857.tif") if u and copies else None for u in t[src].to_pylist()]
    t = t.append_column(pa.field(col, pa.string()), pa.array(vals, pa.string()))
  dest.parent.mkdir(parents=True, exist_ok=True)
  pq.write_table(t, dest, compression="zstd")
  return dest


def test_registry_asset_follows_the_v2_file(live, tmp_path):
  coll, v1 = live
  v2 = write_v2(v1, tmp_path / "registry" / "v2" / "registry.parquet")
  out = aq.registry_version_collection(coll, v2, "v2", updated="2026-10-23T14:00:00Z")
  a = out["assets"]["registry"]
  assert a["href"] == "./registry/v2/registry.parquet"
  assert a["file:size"] == v2.stat().st_size and a["file:size"] != coll["assets"]["registry"]["file:size"]
  assert a["file:checksum"] == stac.multihash_sha256(v2) and re.fullmatch(r"1220[0-9a-f]{64}", a["file:checksum"])
  assert [c["name"] for c in a["table:columns"]] == pq.read_schema(v2).names
  assert [c["name"] for c in a["table:columns"]][-2:] == ["cog_3857_url", "cog_3857_url_005"]
  assert all(c["description"] for c in a["table:columns"])
  assert a["table:row_count"] == pq.read_metadata(v2).num_rows


def test_collection_version_is_bumped_and_updated(live, tmp_path):
  coll, v1 = live
  out = aq.registry_version_collection(coll, write_v2(v1, tmp_path / "v2.parquet"), updated="2026-10-23T14:00:00Z")
  assert coll["version"] == "2019.10" and out["version"] == "2019.10.1"
  assert out["updated"] == "2026-10-23T14:00:00Z"
  assert aq.bump_version("2019.10.1") == "2019.10.2" and aq.bump_version("2019.10.9") == "2019.10.10"
  with pytest.raises(ValueError):
    aq.bump_version("2020.1")


def test_nothing_else_of_the_live_collection_changes(live, tmp_path):
  coll, v1 = live
  before = copy.deepcopy(coll)
  out = aq.registry_version_collection(coll, write_v2(v1, tmp_path / "v2.parquet"))
  assert coll == before   # the live document is not mutated
  same = lambda c: {k: v for k, v in c.items() if k not in ("version", "updated", "assets", "atlas:item_template")}
  assert same(out) == same(coll)
  assert out["assets"]["thumbnail"] == coll["assets"]["thumbnail"]
  a, b = out["assets"]["registry"], coll["assets"]["registry"]
  assert {k: v for k, v in a.items() if k not in ("href", "title", "file:size", "file:checksum", "table:columns")} == \
         {k: v for k, v in b.items() if k not in ("href", "title", "file:size", "file:checksum", "table:columns")}
  # the v1 columns keep their descriptions word for word
  assert a["table:columns"][:len(b["table:columns"])] == b["table:columns"]


def test_item_template_lists_the_copies_as_3857_assets(live, tmp_path):
  coll, v1 = live
  t = aq.registry_version_collection(coll, write_v2(v1, tmp_path / "v2.parquet"))["atlas:item_template"]["assets"]
  assert list(t) == ["cog", "cog_005", "cog_3857", "cog_3857_005"]
  assert t["cog_3857"]["href"] == "{cog_3857_url}" and t["cog_3857"]["proj:code"] == "EPSG:3857"
  assert t["cog_3857"]["roles"] == ["data", "visual"] and t["cog_3857_005"]["roles"] == ["reference"]
  assert t["cog"] == coll["atlas:item_template"]["assets"]["cog"]


def test_a_file_that_is_not_the_registry_is_refused(live, tmp_path):
  coll, v1 = live
  with pytest.raises(ValueError, match="lacks the registry columns"):
    aq.registry_version_collection(coll, v1)   # the v1 file has no copy columns
  v2 = write_v2(v1, tmp_path / "v2.parquet")
  pq.write_table(pq.read_table(v2).slice(0, 2), tmp_path / "short.parquet")
  with pytest.raises(ValueError, match="rows"):
    aq.registry_version_collection(coll, tmp_path / "short.parquet")


def test_the_staged_v2_collection_passes_the_offline_check(live, tmp_path):
  coll, v1 = live
  d = tmp_path / "stage" / "aquamaps_native"
  write_v2(v1, d / "registry" / "v2" / "registry.parquet")
  out = aq.registry_version_collection(coll, d / "registry" / "v2" / "registry.parquet")
  assert aq.check_collection(d, out) == []
  # the check reads the file the asset names: a v1 collection with no registry.parquet beside it fails
  assert aq.check_collection(d, coll) != []


def test_command_writes_only_the_staged_collection(live, tmp_path):
  coll, v1 = live
  (tmp_path / "live.json").write_text(json.dumps(coll))
  v2 = write_v2(v1, tmp_path / "om" / "registry" / "v2" / "registry.parquet")
  out = tmp_path / "stage"
  assert cli.main(["aquamaps-registry", str(v2), "--live", str(tmp_path / "live.json"), "--out", str(out)]) == 0
  assert [p.relative_to(out).as_posix() for p in out.rglob("*") if p.is_file()] == ["aquamaps_native/collection.json"]
  written = json.loads((out / "aquamaps_native" / "collection.json").read_text())
  assert written["assets"]["registry"]["href"] == "./registry/v2/registry.parquet" and written["version"] == "2019.10.1"
