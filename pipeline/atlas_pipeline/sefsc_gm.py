"""sefsc_gm version 2 (restricted): NOAA SEFSC Gulf line-transect survey effort, marine mammal sightings and the 19 NCEI
0256800 v2.2 density models on their one 40 km2 hexagon grid, staged from MarineSensitivity/workflows
ingest_sefsc_gm-surveys.qmd as a STAC collection under its OWN unlisted prefix.

Input (`src`, default ~/_big/msens/derived/preview/sefsc_gm/, override ATLAS_SEFSC_SRC):
  values.parquet          HEXID + one double column per {layer}__{month}__{variable}
  layers.csv              one row per values column (title, unit, description, n_hex, min, p98, max)
  models.csv              one row per density model (layer key, label, scientific name, AphiaID, months, abundance)
  hexagons / effort_vessel / effort_aerial / sightings_vessel / sightings_aerial  .parquet (GeoParquet) + .fgb, EPSG:4326
  taxa.csv, checks.csv, questions.md, SEFSC_Line_Transect_Survey_Data_ReadMe.txt
  DONE                    written last by the notebook: its content hash, then "md5 file" per file; nothing is staged
                          without it, or when a listed file is missing or differs from its md5
Output: catalog/staging/sefsc_gm/ {collection.json, items/, values.parquet (HEXID -> FID), hex.pmtiles (FID only),
<overlay>.pmtiles (every attribute), the GeoParquet downloads, the tables, README.md, thumbnail*.png}.
The collection's `atlas:overlays` (below, OVERLAYS) is the contract the atlas app implements: change it only together.
publish.sh --only sefsc_gm uploads it.
"""

from __future__ import annotations

import csv
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from . import docs, grid, stac

PIPE_DIR = Path(__file__).resolve().parent.parent
SRC_DEFAULT = Path(os.environ.get("ATLAS_SEFSC_SRC", "~/_big/msens/derived/preview/sefsc_gm")).expanduser()
PREFIX_FILE = PIPE_DIR / "restricted_prefix_sefsc_gm.txt"
OTHER_PREFIX_FILES = [PIPE_DIR / "restricted_prefix.txt", PIPE_DIR / "restricted_prefix_swfsc_cce.txt"]
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+")
COLUMN_RE = re.compile(r"^(?P<layer>[a-z][a-z_]*?)__(?P<month>annual|0[1-9]|1[0-2])__"
                       r"(?P<variable>effort_km|groups|individuals|density|cv)$")
GEO_LAYERS = ["hexagons", "effort_vessel", "effort_aerial", "sightings_vessel", "sightings_aerial"]
TABLES = ["values.parquet", "layers.csv", "models.csv", "taxa.csv", "checks.csv", "questions.md",
          "SEFSC_Line_Transect_Survey_Data_ReadMe.txt"]
DAYS = np.array([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31], dtype="float64")   # msens::month_day_weights()
NA_VAL = -9999.0
ATTRIBUTION = '<a href="https://oceanmetrics.io" target="_blank">OceanMetrics</a> | NOAA SEFSC'
OVERLAY_ZOOM = (0, 12)

# ---- the overlay contract (atlas:overlays) ----
# array order = Layers panel order = draw order, FIRST ON TOP. `fields` = popup order (the file's other fields follow);
# `filter_field` names the "|token|" string property a density-model Item's atlas:overlay_filter matches.
# colours: vessel magenta and aerial orange read on the light and the dark basemap; effort lines and hexagons muted.
OVERLAYS = [
  {"id": "sightings_vessel", "title": "Vessel sightings, 2003–2024", "geometry": "point", "color": "#c51b7d",
   "default": True, "label_field": "vernacularName", "filter_field": "models",
   "fields": ["sightid", "survey", "date.time", "vernacularName", "scientificName", "group.size", "name_resolved",
              "accepted_name", "aphia_id", "rank", "id_certain", "models", "segment.id", "segment_found", "in_own_hex",
              "dist_to_segment_m", "HEXID", "trackline", "s.date", "e.date"]},
  {"id": "sightings_aerial", "title": "Aerial sightings, 2011–2018", "geometry": "point", "color": "#e66101",
   "default": True, "label_field": "Common.Name", "filter_field": "models",
   "fields": ["unique.id", "survey", "date.time", "Common.Name", "SciName", "group.size", "name_resolved",
              "accepted_name", "aphia_id", "rank", "id_certain", "models", "unique.seg.id", "segment_found", "in_own_hex",
              "dist_to_segment_m", "HEXID", "date"]},
  {"id": "effort_vessel", "title": "Vessel effort, 2003–2024", "geometry": "line", "color": "#7b8794",
   "default": True, "label_field": "Sample.Label",
   "fields": ["Sample.Label", "survey", "segment.id", "trackline", "s.date", "e.date", "seg.length.m", "length_km",
              "n_sightings", "HEXID"]},
  {"id": "effort_aerial", "title": "Aerial effort, 2011–2018", "geometry": "line", "color": "#a89a7c",
   "default": True, "label_field": "unique.seg.id",
   "fields": ["unique.seg.id", "survey", "date", "seg.len.m", "length_km", "n_sightings", "HEXID"]},
  {"id": "hexagons", "title": "Model hexagons (40 km²)", "geometry": "polygon", "color": "#8c96a0",
   "default": False, "label_field": "HEXID",
   "fields": ["HEXID", "Area_km2", "USA_EEZ", "Oceanic", "Shelf", "vessel_km", "aerial_km", "vessel_groups",
              "aerial_groups", "vessel_individuals", "aerial_individuals", "vessel_surveys", "aerial_surveys",
              "vessel_years", "aerial_years"]},
]
FIELD_LABELS = {
  "sightid": "Sighting id", "unique.id": "Sighting id", "survey": "Survey", "date.time": "Date and time",
  "vernacularName": "Common name", "Common.Name": "Common name", "scientificName": "Scientific name",
  "SciName": "Scientific name", "group.size": "Group size", "name_resolved": "Resolved name",
  "accepted_name": "WoRMS accepted name", "aphia_id": "WoRMS AphiaID", "rank": "Rank",
  "id_certain": "Identified to one taxon", "models": "Density models", "segment.id": "Segment",
  "unique.seg.id": "Segment", "segment_found": "Segment in the effort file", "in_own_hex": "Inside its HEXID hexagon",
  "dist_to_segment_m": "Distance to its segment (m)", "trackline": "Trackline", "s.date": "Segment start (UTC)",
  "e.date": "Segment end (UTC)", "date": "Segment date", "Sample.Label": "Sample label", "seg.length.m": "Length (m)",
  "seg.len.m": "Length (m)", "length_km": "Length (km)", "n_sightings": "Sightings on the segment",
  "Area_km2": "Area (km², nominal)", "USA_EEZ": "In the US EEZ", "Oceanic": "Oceanic (> 200 m)",
  "Shelf": "Shelf (< 200 m)", "vessel_km": "Vessel effort (km)", "aerial_km": "Aerial effort (km)",
  "vessel_groups": "Vessel sightings", "aerial_groups": "Aerial sightings", "vessel_individuals": "Vessel individuals",
  "aerial_individuals": "Aerial individuals", "vessel_surveys": "Vessel surveys", "aerial_surveys": "Aerial surveys",
  "vessel_years": "Vessel years", "aerial_years": "Aerial years",
}
OVERLAY_GEOMETRY_TYPES = {"point": {"Point", "MultiPoint"}, "line": {"LineString", "MultiLineString"},
                          "polygon": {"Polygon", "MultiPolygon"}}


# ---- rules (each has its test) ----

def parse_column(col: str) -> tuple[str, str, str]:
  """`{layer}__{month}__{variable}` -> (layer, month, variable); raises ValueError on any other name."""
  m = COLUMN_RE.match(col)
  if not m:
    raise ValueError(f"values column {col!r} is not {{layer}}__{{01..12|annual}}__{{variable}}")
  return m["layer"], m["month"], m["variable"]


def day_weighted_annual(monthly: dict[str, np.ndarray]) -> np.ndarray:
  """the annual density of one model: sum over the 12 months of density x days / 365, a month the model does not
  cover (absent from `monthly`) or a NULL hexagon-month counting as 0; NULL where no month has a value
  (msens::density_annual(..., n_intervals = 12, weights = month_day_weights()))."""
  n = len(next(iter(monthly.values())))
  num, seen = np.zeros(n), np.zeros(n, dtype=bool)
  for i in range(12):
    v = monthly.get(f"{i + 1:02d}")
    if v is None:
      continue
    v = np.asarray(v, dtype="float64")
    ok = np.isfinite(v)
    num[ok] += v[ok] * DAYS[i]
    seen |= ok
  out = num / DAYS.sum()
  out[~seen] = np.nan
  return out


def values_problems(values: pd.DataFrame, layers: list[dict], key: str = "HEXID") -> list[str]:
  """what is wrong with the wide values table (empty = fine): column names, the layers.csv rows, a -9999 or negative
  value left in, the annual density against the day-weighted mean of the months, a surveyed hexagon without a count."""
  bad = []
  cols = [c for c in values.columns if c != key]
  want = [r["column"] for r in layers]
  if cols != want:
    bad.append(f"values columns differ from layers.csv (first difference at "
               f"{next((i for i, (a, b) in enumerate(zip(cols, want)) if a != b), min(len(cols), len(want)))})")
  for r in layers:
    try:
      if parse_column(r["column"]) != (r["layer"], r["month"], r["variable"]):
        bad.append(f"{r['column']}: layers.csv says {r['layer']} {r['month']} {r['variable']}")
    except ValueError as e:
      bad.append(str(e))
  for c in cols:
    v = values[c].to_numpy(dtype="float64", na_value=np.nan)
    if (v <= NA_VAL).any():
      bad.append(f"{c}: {int((v <= NA_VAL).sum())} value(s) of {NA_VAL:g} (no data must be NULL)")
    elif (v < 0).any():
      bad.append(f"{c}: {int((v < 0).sum())} negative value(s)")
  by = {}
  for c in cols:
    try:
      by.setdefault(parse_column(c)[0], {})[parse_column(c)[1:]] = c
    except ValueError:
      pass
  for lyr, cs in by.items():
    if ("annual", "density") in cs:
      monthly = {m: values[c].to_numpy(dtype="float64", na_value=np.nan) for (m, v), c in cs.items()
                 if v == "density" and m != "annual"}
      got = values[cs[("annual", "density")]].to_numpy(dtype="float64", na_value=np.nan)
      exp = day_weighted_annual(monthly)
      if not (np.array_equal(np.isnan(got), np.isnan(exp))
              and np.allclose(got[~np.isnan(got)], exp[~np.isnan(exp)], rtol=1e-9, atol=1e-15)):
        bad.append(f"{lyr}: annual density is not the day-weighted mean of its months (uncovered = 0)")
    for (m, v), c in cs.items():
      if v != "effort_km":
        continue
      eff = values[c].notna()
      for k in ("groups", "individuals"):
        ck = cs.get((m, k))
        if ck is not None and values.loc[eff, ck].isna().any():
          bad.append(f"{ck}: NULL where {c} > 0 (a surveyed hexagon without a sighting is 0)")
  return bad


SIGHTING_COMMON = {"sightings_vessel": "vernacularName", "sightings_aerial": "Common.Name"}
TIME_OVERLAYS = ["sightings_vessel", "sightings_aerial", "effort_vessel", "effort_aerial"]


def species_options(sightings: dict[str, pd.DataFrame], cube_layers: set[str] | None = None) -> list[dict]:
  """the species select of `atlas:overlay_filters`: one option per AphiaID over every sightings layer
  (`sightings`: overlay id -> its table with aphia_id, accepted_name, rank, models and the layer's common-name field),
  with the number of sightings, sorted by label. Rules:
  - label: a species is "<its most frequent common name> (<accepted name>)"; a higher taxon carries a common name only
    when all its sightings share ONE (a genus or family pools several delivered names, e.g. "Cetacean (large)" and
    "Cetacean (small)" under Cetacea, which no single one describes), else the accepted name alone; the accepted name
    alone when the common name is the same text.
  - `layers`: the density models EVERY sighting of the taxon belongs to (the intersection of their `|token|`s, kept to
    `cube_layers` when given), so a taxon links to a model only when all its sightings do: Delphinidae, whose few
    Peponocephala/Feresa combinations belong to blackfish while the rest belong to no model, links to none.
  Raises on a sighting without an AphiaID."""
  rows = []
  for oid, df in sightings.items():
    if df["aphia_id"].isna().any():
      raise ValueError(f"{oid}: {int(df['aphia_id'].isna().sum())} sighting(s) without an aphia_id")
    rows.append(pd.DataFrame({"aphia_id": df["aphia_id"].astype("int64"), "accepted_name": df["accepted_name"],
                              "rank": df["rank"] if "rank" in df else None,
                              "common": df[SIGHTING_COMMON[oid]], "models": df["models"].fillna("")}))
  d = pd.concat(rows, ignore_index=True)
  out = []
  for aid, g in d.groupby("aphia_id", sort=False):
    acc = g["accepted_name"].mode().iloc[0]
    names = g["common"].dropna().astype(str).str.strip()
    names = names[names != ""]
    is_species = g["rank"].notna().all() and (g["rank"] == "Species").all()
    if is_species:
      com = names.mode().iloc[0] if len(names) else None
    else:
      com = names.iloc[0] if names.nunique() == 1 else None
    label = acc if not com or com.casefold() == str(acc).strip().casefold() else f"{com} ({acc})"
    sets = [{t for t in str(m).split("|") if t and (cube_layers is None or t in cube_layers)} for m in g["models"]]
    toks = sorted(set.intersection(*sets)) if sets else []
    o = {"value": int(aid), "label": label, "count": int(len(g))}
    if toks:
      o["layers"] = toks
    out.append(o)
  return sorted(out, key=lambda o: o["label"].casefold())


def filters_block(sightings: dict[str, pd.DataFrame], years: dict[str, pd.Series],
                  fields: dict[str, list[str]], cube: dict[str, set[str]] | None = None) -> list[dict]:
  """`atlas:overlay_filters` (the contract the atlas app implements beside atlas:overlays): the sightings' species
  (`aphia_id`), the month (follows the cube's month dimension: "01".."12"; annual = no filter) and the year range of
  the effort and sightings layers. `cube` (dimension -> its values) keeps the species' layers and the months'
  `dim_value` to what the cube holds. Raises when a filter names a field an overlay's tiles lack."""
  yr = pd.concat([pd.Series(v) for v in years.values()]).dropna().astype("int64")
  block = [
    {"id": "species", "title": "Species (sightings)", "type": "select", "field": "aphia_id",
     "overlays": list(sightings), "options": species_options(sightings, (cube or {}).get("layer"))},
    {"id": "month", "title": "Month", "type": "select", "field": "month", "overlays": list(TIME_OVERLAYS),
     "options": [{"value": i + 1, "label": stac.SEFSC_MONTH_LABELS[f"{i + 1:02d}"],
                  **({"dim_value": f"{i + 1:02d}"} if cube is None or f"{i + 1:02d}" in cube.get("month", set()) else {})}
                 for i in range(12)],
     "follow_dim": "month"},
    {"id": "year", "title": "Year", "type": "range", "field": "year", "overlays": list(TIME_OVERLAYS),
     "min": int(yr.min()), "max": int(yr.max())},
  ]
  for f in block:
    for oid in f["overlays"]:
      if f["field"] not in fields.get(oid, []):
        raise ValueError(f"filter {f['id']}: field {f['field']} not in overlay {oid}")
  return block


def overlays_block(fields: dict[str, list[str]], overlays: list[dict] = OVERLAYS) -> list[dict]:
  """`atlas:overlays`: OVERLAYS with each popup list completed by the file's other fields (`fields`: layer -> the
  attribute names of its PMTiles, in file order) and the labels of those fields. Raises when a named field is not in
  the file, so the contract never names a property the tiles lack."""
  out = []
  for o in overlays:
    have = fields[o["id"]]
    missing = [f for f in o["fields"] + [o["label_field"]] + ([o["filter_field"]] if o.get("filter_field") else [])
               if f not in have]
    if missing:
      raise ValueError(f"overlay {o['id']}: {missing} not in the file's fields")
    order = o["fields"] + [f for f in have if f not in o["fields"]]
    block = {"id": o["id"], "title": o["title"], "asset": o["id"], "source_layer": o["id"], "geometry": o["geometry"],
             "color": o["color"], "default": o["default"], "label_field": o["label_field"], "fields": order,
             "field_labels": {f: FIELD_LABELS[f] for f in order if f in FIELD_LABELS}}
    if o.get("filter_field"):
      block["filter_field"] = o["filter_field"]
    out.append(block)
  return out


def overlay_tippecanoe_cmd(src: Path, out: Path, layer: str, geometry: str, zoom=OVERLAY_ZOOM) -> list[str]:
  """tippecanoe for one overlay: every attribute, no feature dropped at any zoom (-r1, no feature or tile-size limit),
  polygons not reduced, shared hexagon borders kept."""
  cmd = ["tippecanoe", "-o", str(out), "-l", layer, f"-Z{zoom[0]}", f"-z{zoom[1]}", "-r1", "--no-feature-limit",
         "--no-tile-size-limit", "--force", f"--attribution={ATTRIBUTION}"]
  if geometry == "polygon":
    cmd += ["--no-tiny-polygon-reduction", "--detect-shared-borders", "--no-simplification-of-shared-nodes"]
  return cmd + [str(src)]


def pmtiles_fields(path: Path, layer: str) -> dict[str, str]:
  """{attribute: type} of one layer as the PMTiles metadata (vector_layers) states it."""
  md = grid.pmtiles_header(path)
  for lyr in md.get("vector_layers", []):
    if lyr["id"] == layer:
      return dict(lyr["fields"])
  raise ValueError(f"{path.name}: no layer {layer!r}")


def done_stamp(src: Path) -> str:
  """the notebook's DONE marker (its text); raises while it is missing, older than a file, or names a file that is
  missing or whose md5 differs (the notebook is mid-run, or a file was changed after it). build() reads it before and
  after staging and refuses a mix of two runs."""
  src = Path(src)
  done = src / "DONE"
  if not done.exists():
    raise FileNotFoundError(f"{done} missing: ingest_sefsc_gm-surveys.qmd has not finished")
  lines = done.read_text().splitlines()
  listed = dict(reversed(l.split(" ", 1)) for l in lines[1:] if l.strip())
  need = TABLES + [f"{n}.{x}" for n in GEO_LAYERS for x in ("parquet", "fgb")]
  missing = [n for n in need if n not in listed]
  if missing:
    raise FileNotFoundError(f"{done} does not list {missing[:3]}: not this notebook's output")
  t = done.stat().st_mtime_ns
  for name, md5 in listed.items():
    p = src / name
    if not p.exists():
      raise FileNotFoundError(f"{p} (listed in DONE) is missing")
    if p.stat().st_mtime_ns > t:
      raise FileNotFoundError(f"{done} is older than {name}: the notebook is re-running")
    h = hashlib.md5()
    with open(p, "rb") as f:
      while b := f.read(1 << 20):
        h.update(b)
    if h.hexdigest() != md5:
      raise FileNotFoundError(f"{name}: md5 differs from DONE (changed after the notebook wrote it)")
  return done.read_text()


def new_prefix(path: Path = PREFIX_FILE, others: list[Path] = OTHER_PREFIX_FILES) -> str:
  """this collection's unlisted prefix: a ULID created once and kept (git-ignored), never another collection's."""
  from .cli import restricted_prefix, ulid
  p = restricted_prefix(path)
  taken = {o.read_text().strip() for o in others if o.exists()}
  while p in taken:
    path.write_text(ulid() + "\n")
    p = path.read_text().strip()
  return p


# ---- build ----

def read_csv(path: Path) -> list[dict]:
  with open(path, newline="", encoding="utf-8") as f:
    return list(csv.DictReader(f))


def _table_columns(path: Path) -> list[dict]:
  return [{"name": f.name, "type": "binary (WKB)" if f.name == "geometry" else str(f.type)} for f in pq.read_schema(path)]


def _interval(effort: pd.DataFrame, start: str, end: str) -> tuple[str, str]:
  lo = str(effort[start].min())[:10]
  hi = str(effort[end].max())[:10]
  return f"{lo}T00:00:00Z", f"{hi}T23:59:59Z"


def sefsc_thumbnail(hexg, values: pd.DataFrame, effort: dict, sightings: dict, out: Path) -> tuple[Path, Path]:
  """the surveys over the hexagons: annual effort per hexagon (log), the effort lines and the sightings."""
  import matplotlib.colors as mcolors

  from . import thumbs
  bounds = thumbs._pad(tuple(hexg.total_bounds))
  coast = thumbs.land(bounds)
  fig, axes = thumbs._figure(thumbs.SIZE)
  ax = axes[0, 0]
  ax.set_facecolor(thumbs.BACKGROUND)
  if coast is not None and len(coast):
    coast.plot(ax=ax, color=thumbs.LAND_FILL, linewidth=0)
  eff = hexg.assign(_v=values["survey_all__annual__effort_km"].to_numpy())
  eff = eff[eff["_v"].notna()]
  eff.plot(column="_v", ax=ax, cmap="cividis", norm=mcolors.LogNorm(vmin=max(eff["_v"].quantile(0.02), 1e-3),
                                                                     vmax=eff["_v"].quantile(0.98)),
           linewidth=0, rasterized=True, alpha=0.85)
  effort["effort_aerial"].plot(ax=ax, color="#a89a7c", linewidth=0.15, alpha=0.6)
  effort["effort_vessel"].plot(ax=ax, color="#c9d1da", linewidth=0.15, alpha=0.6)
  sightings["sightings_aerial"].plot(ax=ax, color="#e66101", markersize=1.2)
  sightings["sightings_vessel"].plot(ax=ax, color="#ff4fa8", markersize=1.2)
  if coast is not None and len(coast):
    coast.boundary.plot(ax=ax, color=thumbs.LAND_EDGE, linewidth=0.5, alpha=0.8)
  ax.set_xlim(bounds[0], bounds[2])
  ax.set_ylim(bounds[1], bounds[3])
  ax.set_aspect("equal", adjustable="box")
  ax.set_axis_off()
  fig.text(0.985, 0.012, "NOAA SEFSC Gulf surveys: effort per 40 km² hexagon, effort lines, vessel and aerial sightings; under review",
           color=thumbs.TEXT, fontsize=9, ha="right")
  png = thumbs.save_png(fig, out, thumbs.SIZE)
  return png, thumbs.small_copy(png)


def build(src: Path = SRC_DEFAULT, out: Path | None = None, prefix_file: Path = PREFIX_FILE,
          thumbnail: bool = True, log=print) -> dict:
  """stage the collection; raises FileNotFoundError while the notebook's DONE marker is missing or stale."""
  import geopandas as gpd

  from .cli import STAGING
  out = STAGING if out is None else out
  src = Path(src)
  done = done_stamp(src)
  layers = read_csv(src / "layers.csv")
  models = read_csv(src / "models.csv")
  dest = out / stac.SEFSC_ID
  if dest.exists():
    shutil.rmtree(dest)   # a rebuild never keeps an item or file the new run no longer has
  (dest / "items").mkdir(parents=True)

  # values: the gate, then HEXID -> FID (int64), one row group (a column is one range read)
  values = pd.read_parquet(src / "values.parquet")
  bad = values_problems(values, layers)
  if bad:
    raise ValueError("values.parquet: " + "; ".join(bad[:5]))
  hexg = gpd.read_parquet(src / "hexagons.parquet")
  if set(values["HEXID"]) != set(hexg["HEXID"]) or values["HEXID"].duplicated().any():
    raise ValueError("values.parquet HEXIDs differ from hexagons.parquet")
  vt = pa.Table.from_pandas(values.rename(columns={"HEXID": "FID"}).astype({"FID": "int64"}), preserve_index=False)
  pq.write_table(vt, dest / "values.parquet", compression="zstd", row_group_size=len(values))
  log(f"values.parquet: {len(values):,} hexagons x {len(layers)} columns")

  # hex.pmtiles: geometry + FID only (the painted grid)
  hx = hexg.assign(FID=hexg["HEXID"].astype("int64"))[["FID", "geometry"]]
  flags = [f for f in grid.TIPPECANOE_FLAGS]
  hex_info = grid.build_pmtiles(hx, dest / "hex.pmtiles", flags=flags, attribution=ATTRIBUTION)
  if grid.pmtiles_attribute_names(dest / "hex.pmtiles") != ["FID"]:
    raise ValueError("hex.pmtiles carries attributes other than FID")
  log(f"hex.pmtiles {hex_info['bytes']:,} B")

  # overlays: every attribute, from the FlatGeobuf; then the contract checked against what the tiles hold
  fields, ovl_bytes = {}, {}
  for o in OVERLAYS:
    fgb = src / f"{o['id']}.fgb"
    pm = dest / f"{o['id']}.pmtiles"
    subprocess.run(overlay_tippecanoe_cmd(fgb, pm, o["id"], o["geometry"]), check=True, capture_output=True, text=True)
    have = pmtiles_fields(pm, o["id"])
    want = [f.name for f in pq.read_schema(src / f"{o['id']}.parquet") if f.name != "geometry"]
    lost = [f for f in want if f not in have]
    if lost:
      raise ValueError(f"{pm.name}: tippecanoe dropped {lost}")
    fields[o["id"]] = want
    ovl_bytes[o["id"]] = pm.stat().st_size
    log(f"{pm.name}: {pm.stat().st_size:,} B, {len(have)} attributes")
  overlays = overlays_block(fields)
  sig_cols = lambda oid: ["aphia_id", "accepted_name", "rank", "models", SIGHTING_COMMON[oid]]
  filters = filters_block({oid: pd.read_parquet(src / f"{oid}.parquet", columns=sig_cols(oid)) for oid in SIGHTING_COMMON},
                          {oid: pd.read_parquet(src / f"{oid}.parquet", columns=["year"])["year"] for oid in TIME_OVERLAYS},
                          fields, {"layer": {r["layer"] for r in layers}, "month": {r["month"] for r in layers}})

  # downloads and tables
  for n in GEO_LAYERS:
    shutil.copy2(src / f"{n}.parquet", dest / f"{n}.parquet")
  for n in ["layers.csv", "models.csv", "checks.csv", "SEFSC_Line_Transect_Survey_Data_ReadMe.txt"]:
    shutil.copy2(src / n, dest / n)
  shutil.copy2(src / "taxa.csv", dest / "sefsc_gm_sighting_taxa.csv")
  n_rows = {n: pq.read_metadata(src / f"{n}.parquet").num_rows for n in GEO_LAYERS}
  geom_type = {n: json.loads(pq.read_schema(src / f"{n}.parquet").metadata[b"geo"])["columns"]["geometry"]["geometry_types"]
               for n in GEO_LAYERS}
  for o in OVERLAYS:
    if not set(geom_type[o["id"]]) <= OVERLAY_GEOMETRY_TYPES[o["geometry"]]:
      raise ValueError(f"{o['id']}: geometry {geom_type[o['id']]} is not a {o['geometry']}")
  titles = {"hexagons": "Model hexagons (40 km²) with per-hexagon survey totals", "effort_vessel": "Vessel effort segments, 2003–2024",
            "effort_aerial": "Aerial effort segments, 2011–2018", "sightings_vessel": "Vessel marine mammal sightings, 2003–2024",
            "sightings_aerial": "Aerial marine mammal sightings, 2011–2018"}
  assets = {
    "hex": {"href": "./hex.pmtiles", "type": stac.PMTILES, "roles": ["data"],
            "title": "40 km² model hexagons (geometry + FID = HEXID only)", "pmtiles:layers": ["hex"],
            "atlas:id_field": "FID", "pmtiles:min_zoom": 0, "pmtiles:max_zoom": 10},
    "values": {"href": "./values.parquet", "type": stac.PARQUET, "roles": ["data"],
               "title": "Per-hexagon values, one row per FID (= HEXID), one column per layer x month x variable (layers.csv)",
               "atlas:key_column": "FID", "table:row_count": len(values),
               "table:columns": [{"name": "FID", "type": "int64", "description": "HEXID (join key to hex.pmtiles)"}] +
                                [{"name": r["column"], "type": "double", "description": r["description"]} for r in layers]},
  }
  for o in OVERLAYS:
    assets[o["id"]] = {"href": f"./{o['id']}.pmtiles", "type": stac.PMTILES, "roles": ["overlay"],
                       "title": f"{o['title']}: vector tiles, every attribute", "pmtiles:layers": [o["id"]],
                       "pmtiles:min_zoom": OVERLAY_ZOOM[0], "pmtiles:max_zoom": OVERLAY_ZOOM[1]}
  for n in GEO_LAYERS:
    assets[f"{n}_geoparquet"] = {"href": f"./{n}.parquet", "type": stac.PARQUET, "roles": ["data"],
                                 "title": f"{titles[n]} (GeoParquet, EPSG:4326, every delivered field + the derived ones)",
                                 "table:row_count": n_rows[n], "table:columns": _table_columns(src / f"{n}.parquet")}
  assets |= {
    "layers": {"href": "./layers.csv", "type": "text/csv", "roles": ["metadata"],
               "title": "one row per values column: layer, month, variable, title, unit, description, n_hex, min, p98, max"},
    "models": {"href": "./models.csv", "type": "text/csv", "roles": ["metadata"],
               "title": "one row per density model: key, shapefile, names, AphiaID, months modelled, annual abundance"},
    "taxa": {"href": "./sefsc_gm_sighting_taxa.csv", "type": "text/csv", "roles": ["metadata"],
             "title": "sighting name -> WoRMS AphiaID -> density models (the crosswalk)"},
    "checks": {"href": "./checks.csv", "type": "text/csv", "roles": ["metadata"], "title": "quality checks with their counts"},
    "provider_readme": {"href": "./SEFSC_Line_Transect_Survey_Data_ReadMe.txt", "type": "text/plain", "roles": ["metadata"],
                        "title": "the provider's field dictionary (SEFSC Line Transect Survey Data ReadMe.txt), as delivered"},
    "readme": {"href": "./README.md", "type": stac.MD_T, "roles": ["metadata"], "title": "methods, checks, questions for the provider"},
  }

  # extents: the hexagons; the effort dates
  bbox = [round(float(x), 6) for x in hexg.total_bounds]
  ev = pd.read_parquet(src / "effort_vessel.parquet", columns=["s.date", "e.date"])
  ea = pd.read_parquet(src / "effort_aerial.parquet", columns=["date"])
  iv, ia = _interval(ev, "s.date", "e.date"), _interval(ea, "date", "date")
  intervals = {"survey_vessel": iv, "survey_aerial": ia, "survey_all": (min(iv[0], ia[0]), max(iv[1], ia[1]))}
  coll_interval = (min(intervals["survey_all"][0], stac.SEFSC_MODEL_INTERVAL[0]), intervals["survey_all"][1])

  if thumbnail:
    eff = {n: gpd.read_parquet(src / f"{n}.parquet") for n in ("effort_vessel", "effort_aerial")}
    sig = {n: gpd.read_parquet(src / f"{n}.parquet") for n in ("sightings_vessel", "sightings_aerial")}
    sefsc_thumbnail(hexg, values, eff, sig, dest / "thumbnail.png")
    assets["thumbnail"] = stac.thumbnail_asset("Thumbnail: survey effort per hexagon, effort lines and sightings")

  prefix = new_prefix(prefix_file)
  base = stac.restricted_base_url(prefix, stac.SEFSC_ID)
  fcache: dict = {}
  items = stac.sefsc_items(models, layers, bbox, intervals)
  written = []
  for iid, it in items.items():
    it = stac.add_file_info(it, dest / "items", fcache)
    stac.write_json(dest / "items" / f"{iid}.json", it)
    written.append(it)
  # the one-file item index (collection link rel=items): the SAME objects as items/*.json, so the app reads every Item
  # in one request; their relative hrefs stay relative to items/<id>.json (the app resolves them there). publish.sh
  # uploads it gzip-encoded.
  stac.write_json(dest / "items.json", stac.item_index(written))
  (dest / "README.md").write_text(docs.sefsc_readme(models, layers, read_csv(src / "checks.csv"), read_csv(src / "taxa.csv"),
                                                    (src / "questions.md").read_text(),
                                                    (src / "SEFSC_Line_Transect_Survey_Data_ReadMe.txt").read_text(), overlays))
  coll = stac.sefsc_collection(models, layers, bbox, coll_interval, assets, overlays, filters)
  if thumbnail:
    coll["links"].append(stac.PREVIEW_LINK)
  stac.write_json(dest / "collection.json", stac.add_file_info(coll, dest, fcache))
  if done_stamp(src) != done:
    raise RuntimeError(f"{src} changed while staging (the notebook re-ran): build again once it has finished")
  return {"dest": dest, "items": len(items), "models": len(models), "columns": len(layers), "prefix_file": prefix_file,
          "base": base, "bbox": bbox, "overlay_bytes": ovl_bytes, "hex_bytes": hex_info["bytes"], "rows": n_rows}


# ---- offline checks of the staged collection (cli.check_staging) ----

def check_collection(coll_dir: Path, coll: dict, prefix: str | None) -> list[str]:
  """restricted, no email anywhere, every local href staged, the overlays' assets PMTiles holding their source layer
  and every field the contract names, every Item's dims in the cube, a density-model Item's overlay filter its own
  model, the predecessor link to version 1 and no other atlas URL."""
  bad = []
  if coll.get("atlas:access") != "restricted":
    bad.append("atlas:access is not restricted")
  if not prefix or not re.fullmatch(r"[0-9A-HJKMNP-TV-Z]{26}", prefix):
    bad.append(f"restricted prefix {prefix!r} is not a ULID")
  if coll.get("version") != stac.SEFSC_VERSION:
    bad.append(f"version {coll.get('version')!r}, expected {stac.SEFSC_VERSION!r}")
  if not any(l.get("rel") == "predecessor-version" and l.get("href") == stac.SEFSC_V1_URL for l in coll.get("links", [])):
    bad.append("no predecessor-version link to version 1")
  texts = [(coll_dir / "collection.json").read_text()]
  if (coll_dir / "README.md").exists():
    texts.append((coll_dir / "README.md").read_text())
  for k, a in coll.get("assets", {}).items():
    h = a["href"]
    if h.startswith("http"):
      bad.append(f"collection asset {k} href {h} is absolute (everything is staged beside collection.json)")
    elif not (coll_dir / h).exists():
      bad.append(f"collection asset {k} -> {h} not staged")
  assets = coll.get("assets", {})
  for o in coll.get("atlas:overlays", []):
    a = assets.get(o.get("asset"))
    if a is None or a.get("type") != stac.PMTILES:
      bad.append(f"overlay {o.get('id')}: asset {o.get('asset')} is not a PMTiles collection asset")
      continue
    if o.get("source_layer") not in a.get("pmtiles:layers", []):
      bad.append(f"overlay {o['id']}: source_layer {o.get('source_layer')} not in the asset's pmtiles:layers")
    f = coll_dir / a["href"]
    if f.exists():
      try:
        have = pmtiles_fields(f, o["source_layer"])
      except ValueError as e:
        bad.append(f"overlay {o['id']}: {e}")
        continue
      named = o.get("fields", []) + [o.get("label_field")] + ([o["filter_field"]] if o.get("filter_field") else [])
      missing = [x for x in named if x not in have]
      if missing:
        bad.append(f"overlay {o['id']}: fields {missing[:3]} not in {a['href']}")
  dims = {k: set(v["values"]) for k, v in coll.get("cube:dimensions", {}).items()}
  survey = set(stac.SEFSC_SURVEY_LAYERS)
  for p in sorted((coll_dir / "items").glob("*.json")):
    texts.append(p.read_text())
    it = json.loads(texts[-1])
    pr = it["properties"]
    d = pr.get("atlas:dims", {})
    if set(d) != set(dims) or any(v not in dims[k] for k, v in d.items()):
      bad.append(f"{p.name}: atlas:dims {d} not in the cube")
    if p.stem != stac.sefsc_item_id(d.get("layer"), d.get("month"), d.get("variable")):
      bad.append(f"{p.name}: id is not {{layer}}_{{month}}_{{variable}}")
    flt = pr.get("atlas:overlay_filter")
    if d.get("layer") in survey and flt is not None:
      bad.append(f"{p.name}: a survey Item has an overlay filter")
    if d.get("layer") not in survey and flt != {"field": "models", "token": d.get("layer")}:
      bad.append(f"{p.name}: overlay filter {flt} is not its own model")
    for k, a in it["assets"].items():
      if a["href"].startswith("http") or not (p.parent / a["href"]).resolve().exists():
        bad.append(f"{p.name}: asset {k} -> {a['href']} not staged")
  # the feature filters: known overlays whose tiles hold the field; species layers are cube layer values; the month
  # follows the cube's month dimension; a year range in order
  ov_ids = {o.get("id") for o in coll.get("atlas:overlays", [])}
  for flt in coll.get("atlas:overlay_filters", []):
    for oid in flt.get("overlays", []):
      a = assets.get(oid)
      if oid not in ov_ids or a is None:
        bad.append(f"filter {flt.get('id')}: overlay {oid} is not an overlay of this collection")
      elif (coll_dir / a["href"]).exists() and flt.get("field") not in pmtiles_fields(coll_dir / a["href"], oid):
        bad.append(f"filter {flt.get('id')}: field {flt.get('field')} not in {a['href']}")
    if flt.get("type") == "select":
      vals = [o.get("value") for o in flt.get("options", [])]
      if not vals or len(set(vals)) != len(vals):
        bad.append(f"filter {flt.get('id')}: options empty or values repeated")
      for o in flt.get("options", []):
        if any(l not in dims.get("layer", set()) for l in o.get("layers", [])):
          bad.append(f"filter {flt.get('id')}: option {o.get('value')} names a layer not in the cube")
        if flt.get("follow_dim") and "dim_value" in o and o["dim_value"] not in dims.get(flt["follow_dim"], set()):
          bad.append(f"filter {flt.get('id')}: option {o.get('value')} dim_value not in {flt['follow_dim']}")
    elif flt.get("type") == "range":
      if not (isinstance(flt.get("min"), int) and isinstance(flt.get("max"), int) and flt["min"] <= flt["max"]):
        bad.append(f"filter {flt.get('id')}: range min/max not ordered integers")
    else:
      bad.append(f"filter {flt.get('id')}: unknown type {flt.get('type')!r}")
  # the item index (rel=items) holds exactly the item files' objects, one per rel=item link
  idx_links = [l for l in coll.get("links", []) if l.get("rel") == "items"]
  idx = coll_dir / "items.json"
  if len(idx_links) != 1 or idx_links[0].get("href") != "./items.json":
    bad.append("no single rel=items link to ./items.json")
  elif not idx.exists():
    bad.append("items.json (the item index) not staged")
  else:
    feats = json.loads(idx.read_text()).get("features", [])
    files = {p.stem: json.loads(p.read_text()) for p in (coll_dir / "items").glob("*.json")}
    linked = [Path(l["href"]).stem for l in coll.get("links", []) if l.get("rel") == "item"]
    if [f.get("id") for f in feats] != linked:
      bad.append("items.json: feature ids are not the rel=item links in order")
    elif any(f != files.get(f["id"]) for f in feats):
      bad.append("items.json: a feature differs from its items/<id>.json")
  if any(EMAIL_RE.search(t) for t in texts):
    bad.append("an email address is in the collection, an item or the README")
  if any("atlas-restricted/" in t for t in texts):
    bad.append("a restricted prefix URL is written into the collection, an item or the README")
  return bad
