"""the EPSG:3857 copies of a published MarineSensitivity release's COGs, and their side table (week 6 step 5,
decision D8: titiler's retirement precondition).

MST's published releases are immutable (decision D7), so the copies and their numbers go BESIDE the release, never
into it:

- the copies: `marine-atlas/<ver>/cog_3857/<the original's path under marine-atlas/ less .tif>_3857.tif`
  (e.g. `cog/usa05/88802d665cfdf0ae.tif` -> `marine-atlas/v7/cog_3857/cog/usa05/88802d665cfdf0ae_3857.tif`);
- the side table: `marine-atlas/<ver>/tables/cog_3857.parquet`, one row per distinct original COG, keyed by the
  original's `content_hash` (the store key, which is the original's file stem), with the copy's key, `proj:code`,
  zoom range, size and md5, and the per band `statistics` and 32-bucket `histogram` read from the FULL-RESOLUTION
  4326 original (`cog.band_summary`), never from the copy.

The copy is `cog.web_mercator_copy` (nearest warp, GoogleMapsCompatible, nearest overviews). The original is never
rewritten: `ensure_overviews` is NOT run on it (it is a published file; the browser draws the copy and reads numbers
from the original at full resolution).

Resumable: each finished COG is one JSON line appended to `<out>/<ver>/cog_3857.jsonl` (the journal) as it
completes; the Parquet side table is written from the journal (plus any earlier side table) every
`flush_every` rows and at the end. A rerun skips every `content_hash` already in either. A failed COG is logged to
`<out>/<ver>/cog_3857_errors.jsonl` and retried on the next run.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import shutil
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Callable

import pyarrow as pa
import pyarrow.parquet as pq

from . import cog
from .stac import projection_code

BASE = "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/"
ROOT = "marine-atlas/"
OM_BASE = "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/atlas/"
REGISTRY_COPY_COLS = {"cog_url": "cog_3857_url", "cog_url_005": "cog_3857_url_005"}   # D8's new registry columns
COPY_DIR = "cog_3857"
TABLE = "tables/cog_3857.parquet"
JOURNAL = "cog_3857.jsonl"
ERRORS = "cog_3857_errors.jsonl"
# (table, url column, filter) of the release tables that name COGs; a release lacks some (v8, v9: native_asset only)
RELEASE_TABLES = [("model_asset", "cog_url", None), ("score_cog", "cog_url", None),
                  ("native_asset", "asset_url", ("asset_type", "cog"))]

STAT = pa.struct([("minimum", pa.float64()), ("maximum", pa.float64()), ("mean", pa.float64()),
                  ("stddev", pa.float64()), ("valid_percent", pa.float64())])
HIST = pa.struct([("count", pa.int32()), ("min", pa.float64()), ("max", pa.float64()),
                  ("buckets", pa.list_(pa.int64()))])
SCHEMA = pa.schema([
  pa.field("content_hash", pa.string(), nullable=False),   # the ORIGINAL's store key (its file stem), the join key
  pa.field("url", pa.string(), nullable=False),            # the original as the release tables name it
  pa.field("cog_3857_key", pa.string(), nullable=False),   # marine-atlas/<ver>/cog_3857/<rel>_3857.tif
  pa.field("proj:code", pa.string(), nullable=False),      # the copy's: EPSG:3857
  pa.field("src_proj:code", pa.string(), nullable=False),  # the original's (EPSG:4326)
  pa.field("zoom_min", pa.int8()),
  pa.field("zoom_max", pa.int8()),
  pa.field("bands", pa.int16(), nullable=False),
  pa.field("data_type", pa.list_(pa.string())),             # per band, rasterio's spelling (uint8, float32)
  pa.field("nodata", pa.list_(pa.float64())),               # per band; null = none (NaN kept as NaN)
  pa.field("statistics", pa.list_(STAT)),                  # per band, from the 4326 original; null for an empty band
  pa.field("histogram", pa.list_(HIST)),                   # per band, 32 buckets; null for an empty band
  pa.field("bytes", pa.int64(), nullable=False),           # the copy's
  pa.field("md5", pa.string(), nullable=False),            # the copy's
  pa.field("src_bytes", pa.int64(), nullable=False),
  pa.field("src_md5", pa.string(), nullable=False),        # the original's, checked against the store catalog
  pa.field("created", pa.string(), nullable=False),        # UTC, ISO 8601
])


# ---- names ----

def rel_path(url: str) -> str:
  """the original's path under `marine-atlas/` (`cog/usa05/<hash>.tif`), from a path-style, virtual-host or
  storage URL."""
  i = url.find(ROOT)
  if i < 0:
    raise ValueError(f"{url}: not under {ROOT}")
  rel = url[i + len(ROOT):].split("?", 1)[0]
  if not rel.endswith(".tif"):
    raise ValueError(f"{url}: not a .tif")
  return rel


def copy_key(ver: str, url: str) -> str:
  """the copy's bucket key: `marine-atlas/<ver>/cog_3857/<rel less .tif>_3857.tif`."""
  return f"{ROOT}{ver}/{COPY_DIR}/{cog.copy_href(rel_path(url))}"


def content_hash_of(url: str) -> str:
  """the store key of an original: its file stem (MST's asset store names every object `<content_hash>.tif`)."""
  return rel_path(url).rsplit("/", 1)[-1][: -len(".tif")]


def md5_of(path: Path) -> str:
  h = hashlib.md5()
  with open(path, "rb") as f:
    while block := f.read(1 << 20):
      h.update(block)
  return h.hexdigest()


# ---- the release's COG list ----

def _fetch_http(url: str, dest: Path, session=None, tries: int = 4) -> Path:
  import requests
  s = session or requests
  dest.parent.mkdir(parents=True, exist_ok=True)
  tmp = dest.with_name(dest.name + ".part")
  for k in range(tries):
    try:
      with s.get(url, stream=True, timeout=60) as r:
        if r.status_code == 404:
          raise FileNotFoundError(url)
        r.raise_for_status()
        with open(tmp, "wb") as f:
          for chunk in r.iter_content(1 << 16):
            f.write(chunk)
      tmp.replace(dest)
      return dest
    except FileNotFoundError:
      raise
    except Exception:
      if k == tries - 1:
        raise
      time.sleep(2 ** k)
  return dest


def fetch(src: str, dest: Path, session=None) -> Path:
  """`src` (an http(s) URL, or a local path for tests and local mirrors) copied to `dest`."""
  if src.startswith(("http://", "https://")):
    return _fetch_http(src, dest, session)
  p = Path(src[len("file://"):] if src.startswith("file://") else src)
  if not p.exists():
    raise FileNotFoundError(src)
  dest.parent.mkdir(parents=True, exist_ok=True)
  shutil.copyfile(p, dest)
  return dest


def release_cogs(ver: str, base: str = BASE, cache: Path | None = None, fetcher=None) -> list[dict]:
  """[{content_hash, url}] of every distinct `.tif` the release's tables name (model_asset.cog_url,
  score_cog.cog_url, native_asset.asset_url where asset_type = cog), sorted by url. Refuses a row whose
  `content_hash` is not the file's stem (the side table's join key would then miss)."""
  import pyarrow.compute as pc
  fetcher = fetcher or fetch
  cache = Path(cache) if cache else Path(".")
  seen: dict[str, str] = {}
  found = 0
  for name, col, flt in RELEASE_TABLES:
    try:
      p = fetcher(f"{base}{ver}/tables/{name}.parquet", cache / ver / "release" / f"{name}.parquet")
    except FileNotFoundError:
      continue
    found += 1
    t = pq.read_table(p)
    if flt:
      t = t.filter(pc.equal(t[flt[0]], flt[1]))
    hashes = t["content_hash"].to_pylist() if "content_hash" in t.column_names else [None] * t.num_rows
    for url, h in zip(t[col].to_pylist(), hashes):
      if not url or not url.split("?", 1)[0].endswith(".tif"):
        continue
      stem = content_hash_of(url)
      if h is not None and h != stem:
        raise ValueError(f"{ver}/{name}: content_hash {h} is not the file stem of {url}")
      if seen.setdefault(url, stem) != stem:
        raise ValueError(f"{url}: two content hashes")
  if not found:
    raise FileNotFoundError(f"{base}{ver}/tables/: none of {[n for n, _, _ in RELEASE_TABLES]}")
  return [{"content_hash": h, "url": u} for u, h in sorted(seen.items())]


def store_catalog(base: str = BASE, cache: Path | None = None, fetcher=None) -> dict[str, tuple[str, int]]:
  """{key under marine-atlas/: (md5, bytes)} from the asset store's catalog `assets.parquet` ({} when absent)."""
  fetcher = fetcher or fetch
  cache = Path(cache) if cache else Path(".")
  try:
    p = fetcher(f"{base}assets.parquet", cache / "assets.parquet")
  except FileNotFoundError:
    return {}
  t = pq.read_table(p, columns=["key", "md5", "bytes"]).to_pylist()
  return {r["key"]: (r["md5"], int(r["bytes"]) if r["bytes"] is not None else None) for r in t}


# ---- one COG ----

def _summaries_arrow(summaries: list[dict | None]) -> tuple[list, list]:
  stats = [None if s is None else s["statistics"] for s in summaries]
  hist = [None if s is None else s["histogram"] for s in summaries]
  return stats, hist


def band_info(src: Path) -> tuple[list[str], list[float | None]]:
  """(data_type, nodata) per band of `src` (nodata None when the band has none)."""
  import rasterio
  with rasterio.open(src) as ds:
    return list(ds.dtypes), [None if v is None else float(v) for v in ds.nodatavals]


def fill_band_info(rows: dict[str, dict], out: Path) -> int:
  """rows written before the side table had `data_type` and `nodata` get them from the cached original
  (`<out>/src/<rel>`); returns how many were filled (a row whose original is not cached is left as it is)."""
  n = 0
  for r in rows.values():
    if r.get("data_type") is not None:
      continue
    src = Path(out) / "src" / rel_path(r["url"])
    if src.exists():
      r["data_type"], r["nodata"] = band_info(src)
      n += 1
  return n


def process_one(entry: dict, ver: str, out: Path, store: dict | None = None, fetcher=None,
                key: str | None = None, dst: Path | None = None) -> dict:
  """download the original (cached at `<out>/src/<rel>`, its md5 checked against the store catalog when it lists the
  key; a cached file that fails is fetched once more), write its 3857 copy at `dst` (default
  `<out>/<ver>/cog_3857/<rel>_3857.tif`, bucket key `key`, default `copy_key(ver, url)`), read the band summaries
  from the original, and return the side-table row."""
  url, h = entry["url"], entry["content_hash"]
  rel = rel_path(url)
  if content_hash_of(url) != h:
    raise ValueError(f"{url}: content_hash {h} is not its file stem")
  src = Path(out) / "src" / rel
  want = (store or {}).get(rel)
  for attempt in (0, 1):
    if attempt or not src.exists():
      (fetcher or fetch)(url, src)
    src_md5 = md5_of(src)
    if not want or not want[0] or want[0] == src_md5:
      break
    if attempt:
      raise ValueError(f"{url}: md5 {src_md5} is not the store catalog's {want[0]}")
  import rasterio
  with rasterio.open(src) as ds:
    src_proj, nb = projection_code(ds), ds.count
  if src_proj == cog.WEB_MERCATOR:
    raise ValueError(f"{url}: already {cog.WEB_MERCATOR}")
  if key is None:
    key = copy_key(ver, url)
    dst = Path(out) / ver / key[len(f"{ROOT}{ver}/"):]
  dst, zoom = cog.web_mercator_copy(src, Path(dst))
  stats, hist = _summaries_arrow(cog.band_summaries(src))
  types, nodata = band_info(src)
  return {"content_hash": h, "url": url, "cog_3857_key": key, "proj:code": cog.WEB_MERCATOR,
          "src_proj:code": src_proj, "zoom_min": zoom[0], "zoom_max": zoom[1], "bands": nb,
          "data_type": types, "nodata": nodata,
          "statistics": stats, "histogram": hist, "bytes": dst.stat().st_size, "md5": md5_of(dst),
          "src_bytes": src.stat().st_size, "src_md5": src_md5,
          "created": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}


# ---- the side table ----

def table_path(out: Path, ver: str) -> Path:
  return Path(out) / ver / TABLE


def journal_path(out: Path, ver: str) -> Path:
  return Path(out) / ver / JOURNAL


def load_rows(out: Path, ver: str) -> dict[str, dict]:
  """{content_hash: row} from the side table and the journal (the journal's row wins: it is the later one)."""
  rows: dict[str, dict] = {}
  t = table_path(out, ver)
  if t.exists():
    for r in pq.read_table(t).to_pylist():
      rows[r["content_hash"]] = r
  j = journal_path(out, ver)
  if j.exists():
    with open(j) as f:
      for line in f:
        line = line.strip()
        if not line:
          continue
        try:
          r = json.loads(line)
        except json.JSONDecodeError:   # a line cut by a crash mid-write: that COG is redone
          continue
        rows[r["content_hash"]] = r
  return rows


def write_table(rows: dict[str, dict] | list[dict], path: Path) -> Path:
  """the side table: `SCHEMA`, sorted by content_hash, zstd, written atomically."""
  rs = sorted(rows.values() if isinstance(rows, dict) else rows, key=lambda r: r["content_hash"])
  t = pa.Table.from_pylist([{f.name: r.get(f.name) for f in SCHEMA} for r in rs], schema=SCHEMA)
  path.parent.mkdir(parents=True, exist_ok=True)
  tmp = path.with_name(path.name + ".part")
  # small row groups, sorted by content_hash: a reader asking for one hash (hyparquet's `filter`) skips the
  # others by their min/max statistics and reads about 1/70 of the v7 table. Statistics on content_hash ONLY: the
  # other columns' made the footer 366 KB on the shared table (240 KB on v7's), all pulled by a reader's first tail
  # read; without them it is 227 KB (the 24 leaf columns' chunk metadata over 112 groups is the rest)
  pq.write_table(t, tmp, compression="zstd", row_group_size=512, write_statistics=["content_hash"])
  tmp.replace(path)
  return path


def _http_fetcher(workers: int):
  """one pooled HTTP session, at most `workers` connections (polite to S3)."""
  import requests
  session = requests.Session()
  session.mount("https://", requests.adapters.HTTPAdapter(pool_connections=workers, pool_maxsize=workers))
  return lambda u, d: fetch(u, d, session)


def _run(label: str, todo: list[dict], job: Callable[[dict], dict], rows: dict[str, dict], dirname: Path,
         tpath: Path, workers: int, flush_every: int, log: Callable[[str], None]) -> tuple[int, int, float]:
  """`job` on each of `todo`, `workers` at a time: each row journaled to `<dirname>/cog_3857.jsonl` as it lands
  and put in `rows`, each failure to `<dirname>/cog_3857_errors.jsonl`, the table `tpath` rewritten from `rows`
  every `flush_every` rows. Returns (done, failed, seconds)."""
  jpath, epath = dirname / JOURNAL, dirname / ERRORS
  jpath.parent.mkdir(parents=True, exist_ok=True)
  lock = threading.Lock()
  done = failed = 0
  t0 = time.perf_counter()
  with open(jpath, "a") as jf, open(epath, "a") as ef, ThreadPoolExecutor(max_workers=workers) as ex:
    futs = {ex.submit(job, c): c for c in todo}
    for k, fut in enumerate(as_completed(futs), 1):
      c = futs[fut]
      try:
        r = fut.result()
      except Exception as e:  # noqa: BLE001 - one bad file never stops the batch; it is retried next run
        failed += 1
        ef.write(json.dumps({"content_hash": c["content_hash"], "url": c["url"], "error": str(e)[:500]}) + "\n")
        ef.flush()
        continue
      with lock:
        rows[r["content_hash"]] = r
        jf.write(json.dumps(r) + "\n")
        jf.flush()
        done += 1
      if done % flush_every == 0:
        write_table(rows, tpath)
      if k % 100 == 0 or k == len(todo):
        el = time.perf_counter() - t0
        rate = k / el if el else 0.0
        eta = (len(todo) - k) / rate if rate else 0.0
        log(f"{label}: {k:,}/{len(todo):,} ({done:,} ok, {failed:,} failed) {rate:.2f}/s, "
            f"elapsed {el / 60:.1f} min, eta {eta / 60:.1f} min")
  return done, failed, time.perf_counter() - t0


def run_batch(ver: str, out: Path, base: str = BASE, workers: int = 4, limit: int | None = None,
              flush_every: int = 1000, cogs: list[dict] | None = None, store: dict | None = None,
              fetcher=None, log: Callable[[str], None] | None = None) -> dict:
  """make the 3857 copy and side-table row of every COG of release `ver` not yet in the side table (or the
  journal), `workers` at a time, the first `limit` only when given. Returns {total, skipped, done, failed, rows,
  seconds, rate}."""
  out = Path(out)
  log = log or (lambda m: None)
  fetcher = fetcher or _http_fetcher(workers)
  cogs = cogs if cogs is not None else release_cogs(ver, base, out, fetcher)
  store = store if store is not None else store_catalog(base, out, fetcher)
  rows = load_rows(out, ver)
  todo = [c for c in cogs if c["content_hash"] not in rows]
  skipped = len(cogs) - len(todo)
  if limit is not None:
    todo = todo[:limit]
  log(f"{ver}: {len(cogs):,} COGs, {skipped:,} already in the side table, {len(todo):,} to do ({workers} workers)")
  done, failed, el = _run(ver, todo, lambda c: process_one(c, ver, out, store, fetcher), rows, out / ver,
                          table_path(out, ver), workers, flush_every, log)
  filled = fill_band_info(rows, out)
  if filled:
    log(f"{ver}: data_type and nodata filled from the cached originals on {filled:,} earlier rows")
  write_table(rows, table_path(out, ver))
  return {"total": len(cogs), "skipped": skipped, "done": done, "failed": failed, "rows": len(rows),
          "seconds": round(el, 1), "rate": round((done + failed) / el, 3) if el else 0.0}


# ---- the shared pool: one copy per content hash for every release and registry (D8, part 2) ----
#
# The copies are content addressed (the original's `content_hash` is its file stem, shared across releases), so one
# pool serves every release: `marine-atlas/cog_3857/<content_hash>_3857.tif` and one table
# `marine-atlas/tables/cog_3857.parquet` (`SCHEMA`, sorted by hash, row groups of 512). A hash a release side table
# already has (v7's) is not copied again: its row joins the shared table as it is, pointing at the existing
# `marine-atlas/v7/cog_3857/...` key. Locally the pool is `<out>/shared/` (the journal, the errors, `cog_3857/`,
# `tables/`), the new registry versions `<out>/om/<registry>/registry/<version>/registry.parquet` (published under
# the OM `atlas/` root).

SHARED = "shared"
REGISTRY_VERSION = "v2"   # the aquamaps_native registry's next version: the current one is the unversioned registry.parquet
REGISTRY_VERSIONS = [REGISTRY_VERSION]   # newest first, read by the sweep before the unversioned file


def shared_key(content_hash: str) -> str:
  """the pool copy's bucket key: `marine-atlas/cog_3857/<content_hash>_3857.tif`."""
  return f"{ROOT}{COPY_DIR}/{content_hash}{cog.COPY_SUFFIX}.tif"


def key_url(key: str, base: str = BASE) -> str:
  """a `marine-atlas/...` key as a URL on the same root as `base` (path-style, as the release tables name
  originals)."""
  if not key.startswith(ROOT) or not base.endswith(ROOT):
    raise ValueError(f"{key} under {base}: not both on {ROOT}")
  return base + key[len(ROOT):]


def registry_path(name: str, version: str | None = None) -> str:
  """a registry's path under the OM `atlas/` root: the unversioned `<name>/registry.parquet` (the collection's
  `registry` asset today) or `<name>/registry/<version>/registry.parquet`."""
  return f"{name}/registry.parquet" if not version else f"{name}/registry/{version}/registry.parquet"


def registry_cogs(name: str, om_base: str = OM_BASE, cache: Path | None = None,
                  fetcher=None) -> tuple[list[dict], Path]:
  """([{content_hash, url}] of every distinct `.tif` the CURRENT registry `name` names (`cog_url`,
  `cog_url_005`), the cached registry file)."""
  fetcher = fetcher or fetch
  cache = Path(cache) if cache else Path(".")
  path = fetcher(f"{om_base}{registry_path(name)}", cache / "om_current" / registry_path(name))
  t = pq.read_table(path)
  seen: dict[str, str] = {}
  for col in REGISTRY_COPY_COLS:
    if col not in t.column_names:
      continue
    for url in t[col].to_pylist():
      if url and url.split("?", 1)[0].endswith(".tif"):
        seen.setdefault(url, content_hash_of(url))
  return [{"content_hash": h, "url": u} for u, h in sorted(seen.items())], path


def side_rows(ver: str, base: str = BASE, out: Path | None = None, fetcher=None) -> dict[str, dict]:
  """{content_hash: row} of release `ver`'s side table: the local `<out>/<ver>/tables/cog_3857.parquet` when the
  batch wrote one there, else the bucket's; {} when there is none."""
  out = Path(out) if out else Path(".")
  p = table_path(out, ver)
  if not p.exists():
    try:
      p = (fetcher or fetch)(f"{base}{ver}/{TABLE}", out / "om_current" / ver / TABLE)
    except FileNotFoundError:
      return {}
  return {r["content_hash"]: r for r in pq.read_table(p).to_pylist()}


def pool_sources(releases: list[str], registries: list[str], base: str = BASE, om_base: str = OM_BASE,
                 cache: Path | None = None, fetcher=None) -> tuple[list[dict], dict[str, Path]]:
  """the union, by content hash, of the COGs the releases' tables and the registries name (the first url seen
  kept), sorted by hash; and {registry: its cached current file}."""
  seen: dict[str, str] = {}
  for ver in releases:
    for c in release_cogs(ver, base, cache, fetcher):
      seen.setdefault(c["content_hash"], c["url"])
  regs = {}
  for name in registries:
    cogs, regs[name] = registry_cogs(name, om_base, cache, fetcher)
    for c in cogs:
      seen.setdefault(c["content_hash"], c["url"])
  return [{"content_hash": h, "url": u} for h, u in sorted(seen.items())], regs


def write_registry_version(current: Path, rows: dict[str, dict], dest: Path, base: str = BASE) -> dict:
  """the registry's next version: the current file's rows and columns as they are, plus `cog_3857_url` and
  `cog_3857_url_005` (the copy of `cog_url` / `cog_url_005` by content hash, a path-style URL like theirs; null
  when the pool has no copy). Returns {rows, <copy col>: non-null count}."""
  t = pq.read_table(current)
  counts = {"rows": t.num_rows}
  for col, copy_col in REGISTRY_COPY_COLS.items():
    if copy_col in t.column_names:
      t = t.drop_columns([copy_col])
    vals = []
    for url in (t[col].to_pylist() if col in t.column_names else [None] * t.num_rows):
      r = rows.get(content_hash_of(url)) if url and url.split("?", 1)[0].endswith(".tif") else None
      vals.append(key_url(r["cog_3857_key"], base) if r else None)
    t = t.append_column(pa.field(copy_col, pa.string()), pa.array(vals, pa.string()))
    counts[copy_col] = sum(v is not None for v in vals)
  dest.parent.mkdir(parents=True, exist_ok=True)
  tmp = dest.with_name(dest.name + ".part")
  pq.write_table(t, tmp, compression="zstd", row_group_size=50_000)
  tmp.replace(dest)
  return counts


def run_pool(releases: list[str], registries: list[str], out: Path, base: str = BASE, om_base: str = OM_BASE,
             pointers: list[str] = ("v7",), workers: int = 4, limit: int | None = None, flush_every: int = 1000,
             registry_version: str = REGISTRY_VERSION, store: dict | None = None, fetcher=None,
             log: Callable[[str], None] | None = None) -> dict:
  """the shared pool: every content hash the `releases` and `registries` name that no side table of `pointers`
  (v7's) and no earlier pool row has gets its copy at `<out>/shared/cog_3857/<hash>_3857.tif` (key
  `shared_key`); the shared table `<out>/shared/tables/cog_3857.parquet` is the union of the pointer releases' rows
  (their keys as they are) and the pool's own; then each registry's next version
  (`<out>/om/<registry>/registry/<version>/registry.parquet`). Resumable like `run_batch`. Returns {total,
  skipped, done, failed, rows, pointer_rows, registries, seconds, rate}."""
  out = Path(out)
  log = log or (lambda m: None)
  fetcher = fetcher or _http_fetcher(workers)
  cogs, regs = pool_sources(list(releases), list(registries), base, om_base, out, fetcher)
  store = store if store is not None else store_catalog(base, out, fetcher)
  ptr: dict[str, dict] = {}
  for ver in pointers:
    for h, r in side_rows(ver, base, out, fetcher).items():
      ptr.setdefault(h, r)
  own = load_rows(out, SHARED)
  rows = {**ptr, **own}   # a hash the pool already copied keeps its own row
  todo = [c for c in cogs if c["content_hash"] not in rows]
  skipped = len(cogs) - len(todo)
  if limit is not None:
    todo = todo[:limit]
  log(f"{SHARED}: {len(cogs):,} COGs from {list(releases) + list(registries)}, {skipped:,} already in a side table "
      f"({len(ptr):,} rows of {list(pointers)}, {len(own):,} of the pool), {len(todo):,} to do ({workers} workers)")
  copies = out / SHARED / COPY_DIR

  def job(c):
    h = c["content_hash"]
    return process_one(c, SHARED, out, store, fetcher, key=shared_key(h), dst=copies / f"{h}{cog.COPY_SUFFIX}.tif")

  done, failed, el = _run(SHARED, todo, job, rows, out / SHARED, table_path(out, SHARED), workers, flush_every, log)
  write_table(rows, table_path(out, SHARED))
  reg_out = {}
  for name, current in regs.items():
    dest = out / "om" / registry_path(name, registry_version)
    reg_out[name] = {"path": str(dest), **write_registry_version(current, rows, dest, base)}
    log(f"{name}: registry {registry_version} {reg_out[name]}")
  return {"total": len(cogs), "skipped": skipped, "done": done, "failed": failed, "rows": len(rows),
          "pointer_rows": sum(1 for h in rows if h in ptr and h not in own), "registries": reg_out,
          "seconds": round(el, 1), "rate": round((done + failed) / el, 3) if el else 0.0}


# ---- the sweep: COGs referenced without a 3857 copy (the step 5 gate counter) ----

SWEEP_RELEASES = ["v7", "v7b", "v7c"]   # the public catalogs' MST releases (the week 6 inventory's 57,279)


def read_bytes(src: str) -> bytes | None:
  """an http(s) URL or a local path; None when it is not there (404, no file)."""
  if src.startswith(("http://", "https://")):
    import requests
    r = requests.get(src, timeout=60)
    if r.status_code in (403, 404):
      return None
    r.raise_for_status()
    return r.content
  p = Path(src[len("file://"):] if src.startswith("file://") else src)
  return p.read_bytes() if p.exists() else None


def _join(base: str, href: str) -> str:
  if href.startswith(("http://", "https://", "/")):
    return href
  from posixpath import normpath
  head, _, _ = base.rpartition("/")
  scheme, sep, rest = head.partition("://")
  return f"{scheme}{sep}{normpath(rest + '/' + href)}" if sep else normpath(head + "/" + href)


def item_cog_refs(item: dict, item_url: str) -> list[tuple[str, bool]]:
  """(absolute href, has a copy) of each COG asset of an Item that is not itself a copy: the copy is an asset in
  EPSG:3857 whose href is `cog.copy_href` of the original's."""
  assets = item.get("assets") or {}
  copies = {a.get("href") for a in assets.values() if a.get("proj:code") == cog.WEB_MERCATOR}
  out = []
  for k, a in assets.items():
    h = a.get("href") or ""
    if a.get("type") != cog.COG_T or k.endswith(cog.COPY_SUFFIX) or h.endswith(f"{cog.COPY_SUFFIX}.tif"):
      continue
    if a.get("proj:code") == cog.WEB_MERCATOR:
      continue   # an original already in 3857 draws as it is
    out.append((_join(item_url, h), cog.copy_href(h) in copies))
  return out


def om_item_refs(om_base: str = OM_BASE, reader=read_bytes) -> list[tuple[str, bool]]:
  """`item_cog_refs` over every Item of the OM catalog's own collections (relative children of catalog.json)."""
  out = []
  cat = json.loads(reader(f"{om_base}catalog.json"))
  for l in cat.get("links", []):
    if l.get("rel") != "child" or l["href"].startswith(("http://", "https://")):
      continue
    curl = _join(f"{om_base}catalog.json", l["href"])
    col = json.loads(reader(curl) or b"{}")
    for il in col.get("links", []):
      if il.get("rel") == "item":
        iurl = _join(curl, il["href"])
        raw = reader(iurl)
        if raw:
          out += item_cog_refs(json.loads(raw), iurl)
  return out


def registry_refs(table: pa.Table) -> list[tuple[str, bool]]:
  """(url, has a copy) of each COG the aquamaps_native registry names (`cog_url`, `cog_url_005`); a copy is a
  non-null `cog_3857_url` / `cog_3857_url_005` (D8's registry columns)."""
  out = []
  for col, copy_col in REGISTRY_COPY_COLS.items():
    if col not in table.column_names:
      continue
    urls = table[col].to_pylist()
    copies = table[copy_col].to_pylist() if copy_col in table.column_names else [None] * len(urls)
    out += [(u, c is not None) for u, c in zip(urls, copies) if u]
  return out


def _hashes(raw: bytes | None, local: Path | None) -> set[str]:
  if local is not None and local.exists():
    return set(pq.read_table(local, columns=["content_hash"])["content_hash"].to_pylist())
  if raw is None:
    return set()
  return set(pq.read_table(pa.BufferReader(raw), columns=["content_hash"])["content_hash"].to_pylist())


def side_table_hashes(ver: str, base: str = BASE, side_dir: Path | None = None, reader=read_bytes) -> set[str]:
  """the content hashes release `ver`'s side table covers (local `<side_dir>/<ver>/tables/cog_3857.parquet` first,
  else the bucket's); empty when there is none."""
  local = table_path(side_dir, ver) if side_dir is not None else None
  if local is not None and local.exists():
    return _hashes(None, local)
  return _hashes(reader(f"{base}{ver}/{TABLE}"), None)


def shared_table_hashes(base: str = BASE, side_dir: Path | None = None, reader=read_bytes) -> set[str]:
  """the content hashes the shared table `marine-atlas/tables/cog_3857.parquet` covers (local
  `<side_dir>/shared/tables/cog_3857.parquet` first, else the bucket's); empty when there is none."""
  local = table_path(side_dir, SHARED) if side_dir is not None else None
  if local is not None and local.exists():
    return _hashes(None, local)
  return _hashes(reader(f"{base}{TABLE}"), None)


def newest_registry(name: str, om_base: str = OM_BASE, side_dir: Path | None = None,
                    reader=read_bytes) -> tuple[str | None, pa.Table | None]:
  """(version, table) of the newest registry `name` there is: each of `REGISTRY_VERSIONS` (local
  `<side_dir>/om/...` first, else the OM root), else the unversioned `registry.parquet` (version None); (None,
  None) when there is none."""
  for v in [*REGISTRY_VERSIONS, None]:
    local = Path(side_dir) / "om" / registry_path(name, v) if side_dir is not None else None
    if local is not None and local.exists():
      return v, pq.read_table(local)
    raw = reader(f"{om_base}{registry_path(name, v)}")
    if raw is not None:
      return v, pq.read_table(pa.BufferReader(raw))
  return None, None


def sweep(releases: list[str] = SWEEP_RELEASES, base: str = BASE, om_base: str = OM_BASE,
          side_dir: Path | None = None, cache: Path | None = None, reader=read_bytes) -> dict:
  """{part: (referenced, without a copy)} and the distinct totals over the MST releases (each against its own side
  table and the shared table), the OM aquamaps_native registry (its newest version's copy columns) and the OM
  Items. A COG counts once in the total, missing when any reference to it lacks a copy."""
  import tempfile
  missing: dict[str, bool] = {}
  parts: dict[str, tuple[int, int]] = {}

  def add(name, refs):
    parts[name] = (len({u for u, _ in refs}), len({u for u, ok in refs if not ok}))
    for u, ok in refs:
      missing[u] = missing.get(u, False) or not ok

  def fetcher(src, dest):
    raw = reader(src)
    if raw is None:
      raise FileNotFoundError(src)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(raw)
    return dest

  with tempfile.TemporaryDirectory() as tmp:
    shared = shared_table_hashes(base, side_dir, reader)
    for ver in releases:
      have = side_table_hashes(ver, base, side_dir, reader) | shared
      add(f"mst {ver}", [(c["url"], c["content_hash"] in have)
                         for c in release_cogs(ver, base, Path(cache or tmp), fetcher)])
    v, reg = newest_registry("aquamaps_native", om_base, side_dir, reader)
    if reg is not None:
      add(f"om aquamaps_native registry{' ' + v if v else ''}", registry_refs(reg))
    add("om items", om_item_refs(om_base, reader))
  return {"parts": parts, "referenced": len(missing), "missing": sum(missing.values())}


def sweep_line(r: dict) -> str:
  """the one line: `COGs referenced without a 3857 copy = N of M (part a/b, ...)`."""
  parts = ", ".join(f"{k} {m:,}/{n:,}" for k, (n, m) in r["parts"].items())
  return f"COGs referenced without a 3857 copy = {r['missing']:,} of {r['referenced']:,} ({parts})"
