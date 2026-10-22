"""swfsc_cce_becker2020b (restricted): stage the NOAA SWFSC California Current cetacean density COGs written by
MarineSensitivity/workflows ingest_swfsc_cce.qmd as a STAC collection under its OWN unlisted prefix.

Input (`src`, default ~/_big/msens/derived/preview/swfsc_cce/, override ATLAS_CCE_SRC):
  cog/cce_<worms_id>_summer-fall.tif  2-band Float32 COGs: a window over the California Current ALIGNED to the 0.05
                                      degree global grid (band 1 density animals/km2, band 2 cv; nodata -9999)
  models.csv                          one row per species
  DONE                                written last by the ingest; nothing is staged without it
Output: catalog/staging/swfsc_cce_becker2020b/ {collection.json, items/, cog/, models.csv, README.md, thumbnail*.png}.
cog/ holds each COG as staged (its overviews rebuilt nearest, `cog.ensure_overviews`) and its EPSG:3857 copy
`<stem>_3857.tif` (`cog.web_mercator_copy`), the two data assets of every Item (`cog.publish_cog_item`).
The STAC JSON is written by stac.cce_collection / stac.cce_items; publish.sh --only swfsc_cce_becker2020b uploads it.
"""

from __future__ import annotations

import csv
import json
import math
import os
import re
import shutil
from pathlib import Path

import numpy as np

from . import cog, docs, stac

PIPE_DIR = Path(__file__).resolve().parent.parent
SRC_DEFAULT = Path(os.environ.get("ATLAS_CCE_SRC", "~/_big/msens/derived/preview/swfsc_cce")).expanduser()
PREFIX_FILE = PIPE_DIR / "restricted_prefix_swfsc_cce.txt"
BIOTRACK_PREFIX_FILE = PIPE_DIR / "restricted_prefix.txt"
GRID = {"res": 0.05, "west": -180.0, "north": 90.0}
# the transform of a delivered COG carries float noise (res 0.0500000017, origin -131.0000044): 1e-6 degree on the
# resolution, a thousandth of a cell on the origin
RES_TOL, ALIGN_TOL = 1e-6, 1e-3
# the columns the builder reads; the cog file name may be called cog, cog_file or cog_filename
REQUIRED = ["layer", "species", "scientific_name", "worms_id", "season", "mdl_key", "n_cells", "abundance_source",
            "abundance_regridded", "density_min", "density_p98", "density_max", "cv_median"]
COG_COLUMNS = ["cog", "cog_file", "cog_filename", "cog filename"]
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+")
# the ingest's common names lose apostrophes and hyphens ("Bairds beaked whale"); shown as written in English
COMMON_NAME_FIXES = [(r"\bBairds\b", "Baird's"), (r"\bRissos\b", "Risso's"), (r"\bDalls\b", "Dall's"),
                     (r"\b(Long|Short) beaked\b", r"\1-beaked"), (r"\bwhite sided\b", "white-sided")]
THUMB_SPECIES = ["Megaptera novaeangliae", "Balaenoptera musculus", "Balaenoptera physalus", "Physeter macrocephalus"]


def read_models(path: Path) -> list[dict]:
  """models.csv rows, the cog file name normalised to `cog`; raises on a missing column, worms_id or file name."""
  with open(path, newline="") as f:
    rows = list(csv.DictReader(f))
  if not rows:
    raise ValueError(f"{path}: no rows")
  cols = rows[0].keys()
  missing = [c for c in REQUIRED if c not in cols]
  cog_col = next((c for c in COG_COLUMNS if c in cols), None)
  if missing or cog_col is None:
    raise ValueError(f"{path}: missing columns {missing + ([] if cog_col else ['cog'])}")
  out = []
  for r in rows:
    r = dict(r)
    r["cog"] = Path(r[cog_col]).name
    if not str(r["worms_id"]).strip() or not r["cog"]:
      raise ValueError(f"{path}: row {r.get('layer')} has no worms_id or cog file")
    r["worms_id"] = int(float(r["worms_id"]))
    r["species"] = common_name(r["species"])
    out.append(r)
  return out


def common_name(name: str) -> str:
  """the ingest's common name with its apostrophes and hyphens back ("Bairds beaked whale" -> "Baird's beaked whale")."""
  for pat, rep in COMMON_NAME_FIXES:
    name = re.sub(pat, rep, name)
  return name


def grid_problems(crs: str | None, res: tuple[float, float], west: float, north: float, count: int,
                  dtypes: tuple[str, ...]) -> list[str]:
  """what keeps a COG off the 0.05 degree global grid (a window of it is fine) as a 2-band Float32 (empty = fine)."""
  bad = []
  if crs is None or "4326" not in str(crs):
    bad.append(f"crs {crs}, expected EPSG:4326")
  if not all(math.isclose(abs(x), GRID["res"], abs_tol=RES_TOL) for x in res):
    bad.append(f"resolution {res}, expected {GRID['res']}")
  else:
    for name, off in (("west", (west - GRID["west"]) / GRID["res"]), ("north", (GRID["north"] - north) / GRID["res"])):
      if abs(off - round(off)) > ALIGN_TOL:
        bad.append(f"{name} edge {west if name == 'west' else north} is {off:.4f} cells from the global grid, not on a cell edge")
  if count != 2:
    bad.append(f"{count} band(s), expected 2 (density, cv)")
  if any(d != "float32" for d in dtypes):
    bad.append(f"dtypes {dtypes}, expected float32")
  return bad


def valid_bbox(arr: np.ndarray, west: float, north: float, res: float, nodata=None) -> list[float] | None:
  """[w, s, e, n] of the cells holding a finite, non-nodata value, on cell edges; None when there is none."""
  ok = np.isfinite(arr)
  if nodata is not None and not (isinstance(nodata, float) and math.isnan(nodata)):
    ok &= arr != nodata
  rows = np.flatnonzero(ok.any(axis=1))
  cols = np.flatnonzero(ok.any(axis=0))
  if rows.size == 0:
    return None
  r = lambda v: round(float(v), 6)  # noqa: E731   (6 decimals: the transform's float noise is ~1e-6 degree)
  return [r(west + cols[0] * res), r(north - (rows[-1] + 1) * res), r(west + (cols[-1] + 1) * res), r(north - rows[0] * res)]


def union_bbox(boxes: list[list[float]]) -> list[float]:
  return [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]


def new_prefix(path: Path = PREFIX_FILE, other: Path = BIOTRACK_PREFIX_FILE) -> str:
  """this collection's unlisted prefix: a ULID created once and kept (git-ignored), never equal to biotrack's."""
  from .cli import restricted_prefix, ulid
  p = restricted_prefix(path)
  if other.exists() and other.read_text().strip() == p:
    path.write_text(ulid() + "\n")
    p = path.read_text().strip()
  return p


def _cog_file_info(path: Path) -> dict:
  return {"file:size": path.stat().st_size, "file:checksum": stac.multihash_sha256(path)}


def cce_thumbnail(rows: list[dict], cog_dir: Path, bounds: list[float], out: Path) -> tuple[Path, Path]:
  """2x2 panel of four species' density (0 to its p98), over the collection bounds."""
  import rasterio
  from rasterio.windows import from_bounds

  from . import thumbs
  by_name = {r["scientific_name"]: r for r in rows}
  pick = [by_name[n] for n in THUMB_SPECIES if n in by_name] or rows
  pick = (pick + [r for r in rows if r not in pick])[:4]
  w, s, e, n = thumbs._pad(bounds)
  coast = thumbs.land((w, s, e, n))
  fig, axes = thumbs._figure(thumbs.SIZE, 2, 2)
  for ax in axes.flat:
    ax.set_facecolor(thumbs.BACKGROUND)
    ax.set_axis_off()
  for ax, r in zip(axes.flat, pick):
    with rasterio.open(cog_dir / r["cog"]) as ds:
      win = from_bounds(*bounds, transform=ds.transform).round_offsets().round_lengths()
      arr = ds.read(1, window=win, masked=True).astype("float64")
      wb = rasterio.windows.bounds(win, ds.transform)
    vmax = float(r["density_p98"]) or float(np.nanmax(arr.filled(np.nan)))
    if coast is not None and len(coast):
      coast.plot(ax=ax, color=thumbs.LAND_FILL, linewidth=0)
    ax.imshow(np.ma.masked_invalid(arr.filled(np.nan)), cmap="viridis", vmin=0, vmax=vmax,
              extent=(wb[0], wb[2], wb[1], wb[3]), interpolation="nearest", zorder=2)
    if coast is not None and len(coast):
      coast.boundary.plot(ax=ax, color=thumbs.LAND_EDGE, linewidth=0.4, alpha=0.8, zorder=3)
    ax.set_xlim(w, e)
    ax.set_ylim(s, n)
    ax.set_aspect("equal", adjustable="box")
    ax.set_axis_off()
    ax.text(0.03, 0.97, r["species"], transform=ax.transAxes, color=thumbs.TEXT, fontsize=12, va="top", zorder=4)
  fig.text(0.985, 0.012, "SWFSC Summer-Fall density, 0 to p98 (Becker et al. 2020), under review",
           color=thumbs.TEXT, fontsize=8, ha="right")
  png = thumbs.save_png(fig, out, thumbs.SIZE)
  return png, thumbs.small_copy(png)


def done_stamp(src: Path) -> tuple[str, int]:
  """the ingest's DONE marker (its text and mtime); raises while it is missing or older than an input file (the
  ingest is mid-run). build() reads it before and after staging and refuses a mix of two runs."""
  done = Path(src) / "DONE"
  if not done.exists():
    raise FileNotFoundError(f"{done} missing: ingest_swfsc_cce.qmd has not finished")
  t = done.stat().st_mtime_ns
  newer = [p.name for p in [Path(src) / "models.csv", *sorted((Path(src) / "cog").glob("*.tif"))]
           if p.exists() and p.stat().st_mtime_ns > t]
  if newer:
    raise FileNotFoundError(f"{done} is older than {newer[:3]}: the ingest is re-running")
  return done.read_text(), t


def build(src: Path = SRC_DEFAULT, out: Path | None = None, prefix_file: Path = PREFIX_FILE,
          thumbnail: bool = True, log=print) -> dict:
  """stage the collection; raises FileNotFoundError while the ingest's DONE marker is missing."""
  import rasterio

  from .cli import STAGING
  out = STAGING if out is None else out
  src = Path(src)
  done = done_stamp(src)
  rows = sorted(read_models(src / "models.csv"), key=lambda r: r["species"].lower())   # the species picker's order
  dest = out / stac.CCE_ID
  if dest.exists():
    shutil.rmtree(dest)   # a rebuild never keeps an item or COG the new models.csv no longer lists
  (dest / "cog").mkdir(parents=True)
  boxes, nodata, info, stats, crs, summaries, zoom = {}, {}, {}, {}, {}, {}, {}
  for r in rows:
    f = src / "cog" / r["cog"]
    if not f.exists():
      raise FileNotFoundError(f"{f} (models.csv row {r['layer']}) not found")
    with rasterio.open(f) as ds:
      t = ds.transform
      bad = grid_problems(ds.crs.to_string() if ds.crs else None, ds.res, t.c, t.f, ds.count, tuple(ds.dtypes))
      if bad:
        raise ValueError(f"{f.name}: " + "; ".join(bad))
      nodata[r["worms_id"]] = ds.nodata
      # the CRS the raster states (EPSG:4326 when it states none)
      crs[r["worms_id"]] = stac.projection_code(ds)
      # on the grid's own edges, not the transform's float noise (-131.0000044 -> -131.0)
      res = GRID["res"]
      west = GRID["west"] + round((t.c - GRID["west"]) / res) * res
      north = GRID["north"] - round((GRID["north"] - t.f) / res) * res
      box = valid_bbox(ds.read(1), west, north, res, ds.nodata)
    if box is None:
      raise ValueError(f"{f.name}: band 1 has no valid cell")
    boxes[r["worms_id"]] = box
    staged = dest / "cog" / r["cog"]
    shutil.copy2(f, staged)
    # the staged copy (never the ingest's file): nearest overviews, then statistics and histograms per band (density,
    # cv) from its full resolution, then the EPSG:3857 copy beside it
    cog.ensure_overviews(staged, resampling="nearest")
    summaries[r["worms_id"]] = cog.band_summaries(staged)
    empty = [i for i, x in enumerate(summaries[r["worms_id"]], 1) if x is None]
    if empty:
      raise ValueError(f"{f.name}: band {empty[0]} has no valid pixel")
    stats[r["worms_id"]] = [x["statistics"] for x in summaries[r["worms_id"]]]
    _, zoom[r["worms_id"]] = cog.web_mercator_copy(staged, staged.with_name(f"{staged.stem}{cog.COPY_SUFFIX}.tif"))
    info[r["cog"]] = _cog_file_info(staged)
    log(f"{r['species']}: {f.name} bbox {box}, {cog.WEB_MERCATOR} copy zoom {zoom[r['worms_id']]}")
  prefix = new_prefix(prefix_file)
  base = stac.restricted_base_url(prefix, stac.CCE_ID)
  bbox = union_bbox(list(boxes.values()))
  shutil.copy2(src / "models.csv", dest / "models.csv")
  assets = {"models": {"href": "./models.csv", "type": "text/csv", "roles": ["metadata"],
                       "title": "one row per species: names, WoRMS id, mdl_key, cog file, cells, abundance check, density and cv summaries"}}
  if thumbnail:
    cce_thumbnail(rows, dest / "cog", bbox, dest / "thumbnail.png")
    assets["thumbnail"] = stac.thumbnail_asset("Thumbnail: Summer-Fall density of four species (0 to p98)")
  items = stac.cce_items(rows, boxes, base, nodata, stats, crs)
  for iid, it in items.items():
    name = Path(it["assets"]["cog"]["href"]).name
    it["assets"]["cog"] |= info[name]
    wid = int(it["properties"]["atlas:dims"]["species"])
    # the two data assets: the 4326 original (numbers) and cog_3857 (drawn), the same bands with histograms
    it, _ = cog.publish_cog_item(it, dest / "cog" / name, dest / "cog", key="cog", summaries=summaries[wid])
    items[iid] = it
    stac.write_json(dest / "items" / f"{iid}.json", it)
  coll = stac.cce_collection(rows, bbox, base, assets)
  if thumbnail:
    coll["links"].append(stac.PREVIEW_LINK)
  stac.write_json(dest / "collection.json", stac.add_file_info(coll, dest))
  (dest / "README.md").write_text(docs.cce_readme(rows))
  if done_stamp(src) != done:
    raise RuntimeError(f"{src} changed while staging (the ingest re-ran): build again once it has finished")
  return {"dest": dest, "items": len(items), "species": len(rows), "prefix_file": prefix_file, "base": base,
          "bbox": bbox, "zoom": zoom}


def check_collection(coll_dir: Path, coll: dict, prefix: str | None) -> list[str]:
  """offline checks of the staged collection: restricted, no email anywhere, every COG under its own prefix and
  staged under cog/."""
  bad = []
  if coll.get("atlas:access") != "restricted":
    bad.append("atlas:access is not restricted")
  texts = [(coll_dir / "collection.json").read_text()]
  if (coll_dir / "README.md").exists():
    texts.append((coll_dir / "README.md").read_text())
  base = stac.restricted_base_url(prefix, stac.CCE_ID) + "cog/" if prefix else None
  for p in sorted((coll_dir / "items").glob("*.json")):
    texts.append(p.read_text())
    for k, a in json.loads(texts[-1])["assets"].items():
      h = a["href"]
      if base is None or not h.startswith(base):
        bad.append(f"{p.name}: asset {k} href {h} is not under this collection's restricted prefix")
      elif not (coll_dir / "cog" / h[len(base):]).exists():
        bad.append(f"{p.name}: {h[len(base):]} not staged under cog/")
  if any(EMAIL_RE.search(t) for t in texts):
    bad.append("an email address is in the collection, an item or the README")
  return bad
