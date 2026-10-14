"""the 10 km hex grid: FID-only PMTiles (decision D9) and the FID -> H3 area-weight crosswalk."""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import geopandas as gpd
import h3
import numpy as np
import pandas as pd
import shapely

H3_RES  = 7
AREA_CRS = "EPSG:6933"   # world cylindrical equal-area, for overlap areas

# tippecanoe flags of decision D9: keep every hex whole, no coalescing, no dropping, no tile cap
TIPPECANOE_FLAGS = [
  "-Z0", "-z10",
  "--detect-shared-borders",
  "--no-tiny-polygon-reduction",
  "--no-feature-limit",
  "--no-tile-size-limit",
  "--no-simplification-of-shared-nodes",
  "--force",
  "-l", "hex",
]
ATTRIBUTION = '<a href="https://oceanmetrics.io" target="_blank">OceanMetrics</a> | MBON BioTrack'


# ---- hex geometry ----

def read_hex(path: Path) -> gpd.GeoDataFrame:
  """fid.geojson (lowercase `fid`, EPSG:4326) -> GeoDataFrame with integer `FID` and valid geometry."""
  g = gpd.read_file(path)
  col = "FID" if "FID" in g.columns else "fid"
  g = g.rename(columns={col: "FID"})[["FID", "geometry"]]
  g["FID"] = g["FID"].astype("int64")
  g["geometry"] = shapely.make_valid(g.geometry.values)
  if g.crs is None:
    g = g.set_crs(4326)
  return g.sort_values("FID").reset_index(drop=True)


def fid_only(g: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
  """geometry + integer FID, nothing else (the only attribute the PMTiles may carry)."""
  return g[["FID", "geometry"]].astype({"FID": "int64"})


# ---- pmtiles ----

def tippecanoe_version() -> str:
  r = subprocess.run(["tippecanoe", "--version"], capture_output=True, text=True)
  return (r.stdout + r.stderr).strip()


def build_pmtiles(g: gpd.GeoDataFrame, out_pmtiles: Path, flags=None, attribution=ATTRIBUTION,
                  workdir: Path | None = None) -> dict:
  """hex GeoDataFrame -> FID-only PMTiles via tippecanoe -> mbtiles -> `pmtiles convert`."""
  for exe in ("tippecanoe", "pmtiles"):
    if shutil.which(exe) is None:
      raise RuntimeError(f"{exe} not on PATH (brew install tippecanoe pmtiles)")
  flags = list(flags if flags is not None else TIPPECANOE_FLAGS)
  out_pmtiles = Path(out_pmtiles)
  out_pmtiles.parent.mkdir(parents=True, exist_ok=True)
  with tempfile.TemporaryDirectory(dir=workdir) as tmp:
    tmp = Path(tmp)
    geojson, mbt = tmp / "hex.geojson", tmp / "hex.mbtiles"
    fid_only(g).to_crs(4326).to_file(geojson, driver="GeoJSON")
    cmd = ["tippecanoe", "-o", str(mbt), f"--attribution={attribution}", *flags, str(geojson)]
    subprocess.run(cmd, check=True, capture_output=True, text=True)
    if out_pmtiles.exists():
      out_pmtiles.unlink()
    subprocess.run(["pmtiles", "convert", str(mbt), str(out_pmtiles)], check=True, capture_output=True, text=True)
  return {"cmd": ["tippecanoe", "-o", "hex.mbtiles", f"--attribution={attribution}", *flags, "hex.geojson"],
          "bytes": out_pmtiles.stat().st_size}


def pmtiles_header(path: Path) -> dict:
  r = subprocess.run(["pmtiles", "show", str(path), "--metadata"], capture_output=True, text=True, check=True)
  return json.loads(r.stdout)


def pmtiles_attribute_names(path: Path) -> list[str]:
  """attribute names of layer `hex` as declared in the PMTiles tilestats/vector_layers metadata."""
  md = pmtiles_header(path)
  for lyr in md.get("vector_layers", []):
    if lyr["id"] == "hex":
      return sorted(lyr["fields"].keys())
  raise ValueError("no layer 'hex' in pmtiles metadata")


def tile_size_stats(path: Path) -> pd.DataFrame:
  """per zoom: n tiles, max and mean compressed tile size (bytes), read with the python `pmtiles` package."""
  from pmtiles.reader import MmapSource, Reader, all_tiles
  rows = []
  with open(path, "rb") as f:
    src = MmapSource(f)
    for (z, x, y), data in all_tiles(src):
      rows.append((z, len(data)))
  d = pd.DataFrame(rows, columns=["z", "bytes"])
  return d.groupby("z")["bytes"].agg(n="size", max="max", mean="mean").reset_index()


# ---- h3 crosswalk ----

def hex_to_h3_cells(geom, res: int = H3_RES) -> list[str]:
  """h3 cells overlapping a (multi)polygon in lon/lat; falls back to the centroid's cell for slivers."""
  cells = h3.h3shape_to_cells_experimental(h3.geo_to_h3shape(geom), res, "overlap")
  if len(cells) == 0:
    c = geom.centroid
    cells = [h3.latlng_to_cell(c.y, c.x, res)]
  return list(cells)


def build_crosswalk(g: gpd.GeoDataFrame, res: int = H3_RES) -> pd.DataFrame:
  """FID -> h3 crosswalk: columns FID, h3, weight (share of the hex's area in the h3 cell; sums to 1 per FID)
  and overlap_km2 (the intersection area, used for the area-weighted mean on the h3 side)."""
  g = fid_only(g).reset_index(drop=True)
  fids, cells = [], []
  for fid, geom in zip(g["FID"], g.geometry):
    cs = hex_to_h3_cells(geom, res)
    fids.extend([fid] * len(cs))
    cells.extend(cs)
  pairs = pd.DataFrame({"FID": fids, "h3": cells})
  uniq = pairs["h3"].unique()
  cell_poly = gpd.GeoSeries(
    [shapely.Polygon([(lng, lat) for lat, lng in h3.cell_to_boundary(c)]) for c in uniq],
    index=uniq, crs=4326).to_crs(AREA_CRS)
  hex_proj = g.set_index("FID").geometry.to_crs(AREA_CRS)
  hex_proj = gpd.GeoSeries(shapely.make_valid(hex_proj.values), index=hex_proj.index, crs=AREA_CRS)   # reprojection can break validity
  inter = shapely.intersection(hex_proj.loc[pairs["FID"]].values, cell_poly.loc[pairs["h3"]].values)
  pairs["overlap_km2"] = shapely.area(inter) / 1e6
  # cells that only touch a hex drop out; a hex left with none gets its cells back at equal weight
  pairs = pairs[pairs["overlap_km2"] > 0].copy()
  tot = pairs.groupby("FID")["overlap_km2"].transform("sum")
  missing = set(g["FID"]) - set(pairs["FID"])
  pairs["weight"] = pairs["overlap_km2"] / tot
  if missing:
    extra = []
    for fid in sorted(missing):
      cs = hex_to_h3_cells(g.loc[g["FID"] == fid, "geometry"].iloc[0], res)
      extra += [(fid, c, 0.0, 1.0 / len(cs)) for c in cs]
    pairs = pd.concat([pairs, pd.DataFrame(extra, columns=["FID", "h3", "overlap_km2", "weight"])])
  pairs["FID"] = pairs["FID"].astype("int64")
  return pairs[["FID", "h3", "weight", "overlap_km2"]].sort_values(["FID", "h3"]).reset_index(drop=True)


def aggregate_to_h3(values: pd.DataFrame, crosswalk: pd.DataFrame, columns: list[str]) -> pd.DataFrame:
  """FID-keyed numeric columns -> h3-keyed, area-weighted mean over the overlapping hexes (NaN cells skipped)."""
  w = crosswalk["overlap_km2"].where(crosswalk["overlap_km2"] > 0, crosswalk["weight"])
  m = crosswalk[["FID", "h3"]].assign(w=w.to_numpy()).merge(values[["FID", *columns]], on="FID", how="inner")
  out = {}
  for c in columns:
    ok  = m[c].notna()
    num = (m[c].where(ok, 0.0) * m["w"]).groupby(m["h3"]).sum()
    den = m["w"].where(ok, 0.0).groupby(m["h3"]).sum()
    out[c] = (num / den.where(den > 0)).astype("float64")
  res = pd.DataFrame(out)
  res.index.name = "h3"
  return res.reset_index().sort_values("h3").reset_index(drop=True)
