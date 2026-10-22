"""what the browser COG renderer needs, written at publish (platform spike 3, 2026-10-22, "What the pipeline must write
at publish"; the script it fixed is platform `spikes/cog-protocol/make_3857.sh`):

- `web_mercator_copy`: an EPSG:3857 copy of a COG (the cog protocol draws 3857 only; a 4326 file draws silently in the
  wrong place), nearest warp, GoogleMapsCompatible tiling at the UPPER zoom (a 0.5 degree file stays at zoom 2),
  256 px blocks, DEFLATE, nearest overviews, clipped to the mercator latitude limit;
- `ensure_overviews`: the 4326 original's overviews rebuilt down to about 256 px with nearest (or mode for classes),
  never averaging (the EOV files' averaged overviews moved the legend's mean by +29%);
- `band_summary`: a band's `statistics` and 32-bucket `histogram` from the FULL-RESOLUTION 4326 source, nodata masked
  (never the 3857 copy: mercator repeats high-latitude pixels, -23% on the EOV mean; never an overview);
- `add_cog_assets` / `publish_cog_item`: the Item's two data assets, the original (`proj:code` EPSG:4326, roles
  ["data"]) and `cog_3857` (`proj:code` EPSG:3857, roles ["data", "visual"]), with the same band metadata.

@oceanmetrics/map `pickCogAssets` takes the data asset whose `proj:code` is EPSG:3857 to draw and the other one for
numbers; both need the `data` role. `visual` marks the copy as the one made for display (STAC best practice); the map
reads `proj:code`, not the role.
"""

from __future__ import annotations

import copy
import math
import os
import subprocess
from pathlib import Path

from . import stac
from .stac import _sig, projection_code

MERCATOR_LAT = 85.0511287798
WEB_MERCATOR = "EPSG:3857"
COG_T = "image/tiff; application=geotiff; profile=cloud-optimized"
COPY_KEY = "cog_3857"
COPY_SUFFIX = "_3857"
COPY_ROLES = ["data", "visual"]
EARTH_CIRCUMFERENCE = 2 * math.pi * 6378137.0
RESAMPLING = {"nearest": "NEAREST", "mode": "MODE"}


def _run(cmd: list[str]) -> None:
  r = subprocess.run(cmd, capture_output=True, text=True)
  if r.returncode != 0:
    raise RuntimeError(f"{cmd[0]} failed ({r.returncode}): {r.stderr.strip()[:2000]}")


# ---- the web mercator copy ----

def _clip_window(bounds) -> list[str]:
  """`-te_srs EPSG:4326 -te ...` when the source reaches past the mercator latitude limit (PROJ is not asked for
  |lat| > 85.0511), its own longitudes kept; [] otherwise."""
  w, s, e, n = bounds
  if max(abs(s), abs(n)) <= MERCATOR_LAT:
    return []
  return ["-te_srs", "EPSG:4326", "-te", repr(max(w, -180.0)), repr(max(s, -MERCATOR_LAT)), repr(min(e, 180.0)),
          repr(min(n, MERCATOR_LAT))]


def zoom_range(path: Path) -> tuple[int, int]:
  """(min zoom, max zoom) of a GoogleMapsCompatible COG: the max is its tiling-scheme zoom (else read from the pixel
  size), the min is that less one per overview level."""
  import rasterio
  with rasterio.open(path) as ds:
    z = ds.tags(ns="TILING_SCHEME").get("ZOOM_LEVEL")
    zmax = int(z) if z is not None else round(math.log2(EARTH_CIRCUMFERENCE / (256 * ds.res[0])))
    ovr = ds.overviews(1)
  return zmax - (int(round(math.log2(max(ovr)))) if ovr else 0), zmax


def web_mercator_copy(src: Path, dst: Path) -> tuple[Path, tuple[int, int]]:
  """write `dst`, the EPSG:3857 copy of `src` the cog protocol draws (the spike's recipe): nearest warp, clipped to
  +-85.0511 degrees when the source reaches past it, COG with GoogleMapsCompatible tiling, UPPER zoom strategy,
  256 px blocks, DEFLATE, nearest overviews, nodata carried over, no alpha. Returns (dst, (min zoom, max zoom))."""
  import rasterio
  import rasterio.warp
  src, dst = Path(src), Path(dst)
  with rasterio.open(src) as ds:
    if ds.crs is None:
      raise ValueError(f"{src}: no CRS, cannot warp to {WEB_MERCATOR}")
    te = _clip_window(rasterio.warp.transform_bounds(ds.crs, "EPSG:4326", *ds.bounds)) if ds.crs.to_epsg() != 4326 \
      else _clip_window(ds.bounds)
  dst.parent.mkdir(parents=True, exist_ok=True)
  tmp = dst.with_name(dst.name + ".part")
  _run(["gdalwarp", "-q", "-overwrite", "-t_srs", WEB_MERCATOR, *te, "-r", "near", "-of", "COG",
        "-co", "TILING_SCHEME=GoogleMapsCompatible", "-co", "ZOOM_LEVEL_STRATEGY=UPPER", "-co", "BLOCKSIZE=256",
        "-co", "COMPRESS=DEFLATE", "-co", "ADD_ALPHA=NO", "-co", "OVERVIEW_RESAMPLING=NEAREST",
        "-co", "OVERVIEWS=IGNORE_EXISTING", "-co", "SPARSE_OK=YES", str(src), str(tmp)])
  os.replace(tmp, dst)
  return dst, zoom_range(dst)


# ---- overviews of the original ----

def overview_sizes(width: int, height: int, min_size: int = 256) -> list[tuple[int, int]]:
  """the overview levels a raster gets: halved (rounded up, as GDAL does) while its larger side exceeds `min_size`."""
  out = []
  w, h = width, height
  while max(w, h) > min_size:
    w, h = math.ceil(w / 2), math.ceil(h / 2)
    out.append((w, h))
  return out


def _overview_state(path: Path) -> dict:
  import rasterio
  with rasterio.open(path) as ds:
    st = ds.tags(ns="IMAGE_STRUCTURE")
    ovr = ds.overviews(1)
    sizes = [(math.ceil(ds.width / f), math.ceil(ds.height / f)) for f in ovr]
    return {"width": ds.width, "height": ds.height, "levels": sizes, "layout": st.get("LAYOUT"),
            "resampling": (st.get("OVERVIEW_RESAMPLING") or "").upper() or None, "compress": st.get("COMPRESSION"),
            "predictor": st.get("PREDICTOR"), "block": ds.block_shapes[0], "tiled": ds.profile.get("tiled", False)}


def ensure_overviews(path: Path, min_size: int = 256, resampling: str = "nearest") -> dict:
  """rewrite the COG at `path` in place with overviews down to about `min_size` px built with `resampling` ("nearest"
  for scores and densities, "mode" for classes; never averaging, which mixes nodata into the legend). A file already a
  COG with those levels and that resampling (GDAL records it as IMAGE_STRUCTURE OVERVIEW_RESAMPLING) is left as is.
  Compression, predictor and block size are kept. Returns {rebuilt, resampling, levels: [[w, h], ...], before}."""
  if resampling not in RESAMPLING:
    raise ValueError(f"resampling {resampling!r}: use nearest or mode, never averaging")
  path = Path(path)
  st = _overview_state(path)
  want = overview_sizes(st["width"], st["height"], min_size)
  alg = RESAMPLING[resampling]
  before = {"levels": [list(s) for s in st["levels"]], "resampling": st["resampling"]}
  if st["layout"] == "COG" and st["levels"] == want and (not want or st["resampling"] == alg):
    return {"rebuilt": False, "resampling": resampling, "levels": [list(s) for s in want], "before": before}
  block = st["block"][1] if st["tiled"] and st["block"][1] % 16 == 0 else 512
  co = ["-co", f"BLOCKSIZE={block}", "-co", f"COMPRESS={st['compress'] or 'DEFLATE'}"]
  if st["predictor"] and st["predictor"] != "1":
    co += ["-co", f"PREDICTOR={st['predictor']}"]
  co += (["-co", f"OVERVIEW_COUNT={len(want)}", "-co", f"OVERVIEW_RESAMPLING={alg}", "-co", "OVERVIEWS=IGNORE_EXISTING"]
         if want else ["-co", "OVERVIEWS=NONE"])
  tmp = path.with_name(path.name + ".part")
  _run(["gdal_translate", "-q", "-of", "COG", *co, str(path), str(tmp)])
  os.replace(tmp, path)
  got = _overview_state(path)["levels"]
  if got != want:
    raise RuntimeError(f"{path}: overviews {got} after the rebuild, expected {want}")
  return {"rebuilt": True, "resampling": resampling, "levels": [list(s) for s in want], "before": before}


# ---- band statistics and histogram ----

def histogram(values, lo: float, hi: float, buckets: int = 32) -> list[int]:
  """equal-width bucket counts from lo to hi: bucket = floor((v - lo) / (hi - lo) * n), the top edge in the last
  bucket, a value outside [lo, hi] clamped to an end bucket (the spike's gdal_stats.py and @oceanmetrics/map
  `bucketCounts` rule)."""
  import numpy as np
  span = hi - lo if hi > lo else 1.0
  k = np.clip(np.floor((np.asarray(values, dtype="float64") - lo) / span * buckets), 0, buckets - 1).astype("int64")
  return np.bincount(k, minlength=buckets).tolist()


def band_summary(src, band: int, buckets: int = 32, allow_web_mercator: bool = False) -> dict:
  """{"statistics": {minimum, maximum, mean, stddev, valid_percent}, "histogram": {count, min, max, buckets}} of
  band `band` of a COG (a path or an open rasterio dataset), read at FULL resolution (never an overview), nodata and
  non-finite pixels masked; population stddev (as GDAL's ComputeStatistics), values to 6 significant figures,
  valid_percent to 2 decimals, histogram buckets from the exact minimum to the exact maximum. Refuses an EPSG:3857
  raster unless `allow_web_mercator` (its statistics carry the mercator area bias) and a band with no valid pixel."""
  import numpy as np
  import rasterio
  ds = rasterio.open(src) if isinstance(src, (str, Path)) else src
  try:
    if not allow_web_mercator and ds.crs is not None and ds.crs.to_epsg() == 3857:
      raise ValueError(f"{ds.name}: statistics come from the full-resolution 4326 source, not the {WEB_MERCATOR} copy")
    a = np.ma.masked_invalid(ds.read(band, masked=True).astype("float64"))
  finally:
    if ds is not src:
      ds.close()
  if a.count() == 0:
    raise ValueError(f"band {band} has no valid pixel")
  v = a.compressed()
  lo, hi = float(v.min()), float(v.max())
  return {
    "statistics": {"minimum": _sig(lo), "maximum": _sig(hi), "mean": _sig(v.mean()), "stddev": _sig(v.std()),
                   "valid_percent": round(100.0 * v.size / a.size, 2)},
    "histogram": {"count": buckets, "min": _sig(lo), "max": _sig(hi), "buckets": histogram(v, lo, hi, buckets)},
  }


def band_summaries(src: Path, buckets: int = 32) -> list[dict | None]:
  """`band_summary` of every band of `src` in band order; None for a band with no valid pixel."""
  import rasterio
  out = []
  with rasterio.open(src) as ds:
    for b in range(1, ds.count + 1):
      try:
        out.append(band_summary(ds, b, buckets))
      except ValueError as e:
        if "no valid pixel" not in str(e):
          raise
        out.append(None)
  return out


def _nodata(v):
  return None if v is None else ("nan" if v != v else ("inf" if v == math.inf else ("-inf" if v == -math.inf else v)))


def file_bands(src: Path) -> list[dict]:
  """{data_type, nodata} per band of `src`, in the profile's spelling (nodata null when none, "nan" for NaN)."""
  import rasterio
  with rasterio.open(src) as ds:
    return [{"data_type": dt, "nodata": _nodata(ds.nodatavals[i])} for i, dt in enumerate(ds.dtypes)]


# ---- the STAC assets ----

def copy_href(href: str) -> str:
  """the 3857 copy's href: the original's with `_3857` before `.tif` (beside it, relative or absolute)."""
  stem, dot, ext = href.rpartition(".")
  if not dot or "/" in ext:
    raise ValueError(f"href {href!r} has no file extension")
  return f"{stem}{COPY_SUFFIX}.{ext}"


def empty_range(asset: dict, item: dict) -> list[float] | None:
  """the display range an empty band falls back to: the asset's `atlas:rescale` pair, else the item's
  `atlas:value_range`; None when neither says."""
  r = asset.get("atlas:rescale")
  if isinstance(r, list) and len(r) == 2:
    return [r[0], r[1]]
  r = (item.get("properties") or {}).get("atlas:value_range")
  return [r[0], r[1]] if isinstance(r, list) and len(r) == 2 else None


def _bands_key(asset: dict) -> str:
  return "bands" if "bands" in asset and "raster:bands" not in asset else "raster:bands"


def add_cog_assets(item: dict, key: str, summaries: list[dict | None], proj_code: str = "EPSG:4326",
                   file_band_info: list[dict] | None = None, copy_info: dict | None = None) -> dict:
  """the item (a new dict) with its data COG asset `key` given `proj:code` and per band `statistics` and `histogram`
  (from `band_summary` of the full-resolution source), and, unless `copy_info` is None or the original already is
  EPSG:3857, a `cog_3857` asset beside it: `proj:code` EPSG:3857, roles ["data", "visual"], the same draw hints
  (`atlas:bidx|rescale|colormap`) and the same band metadata. `copy_info` is {href, file:size?, file:checksum?,
  atlas:zoom?}. A band with no valid pixel (summary None) gets statistics {minimum, maximum} = the asset's display
  range (`empty_range`) and valid_percent 0, no histogram (the `cog` profile requires minimum and maximum). The item's
  `properties["proj:code"]` is the original's; the projection extension is declared."""
  out = copy.deepcopy(item)
  a = out["assets"][key]
  bk = _bands_key(a)
  bands = a.get(bk) or [{} for _ in summaries]
  if len(bands) != len(summaries):
    raise ValueError(f"{item.get('id')}: asset {key} lists {len(bands)} bands, the COG has {len(summaries)}")
  info = file_band_info or [{} for _ in summaries]
  for i, (b, s) in enumerate(zip(bands, summaries), 1):
    for k, v in info[i - 1].items():
      b.setdefault(k, v)
    if s is None:
      rng = empty_range(a, out)
      if rng is None:
        raise ValueError(f"{item.get('id')}: band {i} of asset {key} has no valid pixel and no atlas:rescale or "
                         "atlas:value_range to stand for its minimum and maximum")
      b["statistics"] = {"minimum": rng[0], "maximum": rng[1], "valid_percent": 0.0}
      b.pop("histogram", None)
    else:
      b["statistics"] = s["statistics"]
      b["histogram"] = s["histogram"]
  a[bk] = bands
  a["proj:code"] = proj_code
  a.setdefault("roles", ["data"])
  out.setdefault("properties", {}).setdefault("proj:code", proj_code)
  ext = out.setdefault("stac_extensions", [])
  if stac.EXT["projection"] not in ext:
    ext.append(stac.EXT["projection"])
  if copy_info is not None and proj_code != WEB_MERCATOR:
    c = {"href": copy_info["href"], "type": COG_T, "roles": list(COPY_ROLES),
         "title": f"{a['title']} (web mercator copy, drawn in the browser)" if a.get("title") else
                  "web mercator copy, drawn in the browser",
         "proj:code": WEB_MERCATOR}
    for k in ("atlas:bidx", "atlas:rescale", "atlas:colormap"):
      if k in a:
        c[k] = copy.deepcopy(a[k])
    c[bk] = copy.deepcopy(bands)
    for k in ("file:size", "file:checksum", "atlas:zoom"):
      if k in copy_info:
        c[k] = copy_info[k]
    out["assets"][COPY_KEY] = c
    if "file:size" in c and stac.EXT["file"] not in ext:
      ext.append(stac.EXT["file"])
  return out


def data_cog_key(item: dict, src_tif: Path) -> str:
  """the key of the item's data COG asset that is `src_tif`: the one whose href names the file, else the only data
  COG asset (the 3857 copy left out)."""
  cogs = {k: a for k, a in item.get("assets", {}).items()
          if k != COPY_KEY and a.get("type") == COG_T and "data" in (a.get("roles") or [])}
  named = [k for k, a in cogs.items() if a["href"].rsplit("/", 1)[-1] == Path(src_tif).name]
  if len(named) == 1:
    return named[0]
  if len(cogs) == 1:
    return next(iter(cogs))
  raise ValueError(f"{item.get('id')}: cannot tell which data COG asset is {Path(src_tif).name} "
                   f"(data COG assets: {sorted(cogs)})")


def _fresh(dst: Path, src: Path) -> bool:
  return dst.exists() and dst.stat().st_mtime_ns >= src.stat().st_mtime_ns


def publish_cog_item(item: dict, src_tif: Path, staging_dir: Path | None = None, *, key: str | None = None,
                     resampling: str = "nearest", summaries: list[dict | None] | None = None,
                     log=None) -> tuple[dict, dict]:
  """everything the browser COG renderer needs for one Item over `src_tif` (the 4326 original as staged, rewritten in
  place with nearest/mode overviews): its 3857 copy `<stem>_3857.tif` in `staging_dir` (default: beside `src_tif`;
  kept when newer than the original, so several Items over one COG warp it once), the band statistics and histograms
  from the full-resolution original (`summaries` when the caller has them) and the two assets (`add_cog_assets`).
  Returns (the new item, a report {key, overviews, copy, zoom, bytes, summaries, seconds per step})."""
  src_tif = Path(src_tif)
  staging_dir = Path(staging_dir) if staging_dir is not None else src_tif.parent
  key = key or data_cog_key(item, src_tif)
  import time

  import rasterio
  t = {}
  t0 = time.perf_counter()
  ovr = ensure_overviews(src_tif, resampling=resampling)
  t["overviews"] = round(time.perf_counter() - t0, 1)
  with rasterio.open(src_tif) as ds:
    proj = projection_code(ds)
  t0 = time.perf_counter()
  summaries = summaries if summaries is not None else band_summaries(src_tif)
  t["summaries"] = round(time.perf_counter() - t0, 1)
  report = {"key": key, "overviews": ovr, "summaries": summaries, "proj:code": proj, "seconds": t}
  copy_info = None
  if proj != WEB_MERCATOR:
    dst = staging_dir / f"{src_tif.stem}{COPY_SUFFIX}{src_tif.suffix}"
    t0 = time.perf_counter()
    if _fresh(dst, src_tif):
      zoom = zoom_range(dst)
    else:
      if log:
        log(f"{src_tif.name}: warping to {WEB_MERCATOR}")
      dst, zoom = web_mercator_copy(src_tif, dst)
    t["copy"] = round(time.perf_counter() - t0, 1)
    copy_info = {"href": copy_href(item["assets"][key]["href"]), "file:size": dst.stat().st_size,
                 "file:checksum": stac.multihash_sha256(dst), "atlas:zoom": list(zoom)}
    report |= {"copy": dst, "zoom": zoom, "bytes": dst.stat().st_size}
  out = add_cog_assets(item, key, summaries, proj, file_bands(src_tif), copy_info)
  return out, report
