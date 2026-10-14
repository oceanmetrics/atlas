"""readers and column-naming rules for the BioTrack indicator products (Couto, Hammerschlag et al.)."""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

import numpy as np
import pandas as pd

# ---- constants ----

RAW_SUBDIR = "Indicators_AllProducts_may2025"
XLSX_NAME  = "Metadata_new-2025-05-16.xlsx"

# group key as written in the shapefile name -> lowercase key used in column and item names
GROUP_KEYS = {
  "All":        "all",
  "Fish":       "fish",
  "Ray":        "ray",
  "Red-listed": "redlisted",
  "Shark":      "shark",
  "Turtle":     "turtle",
}
GROUPS  = ["all", "fish", "ray", "redlisted", "shark", "turtle"]
SEASONS = ["summer", "winter"]
METRICS = ["richness", "uncertainty"]

# (shapefile product type, shapefile field) -> column suffix; the two public metrics are
# ecrg_rc -> richness and ecrg_ncr -> uncertainty
FIELD_SUFFIX = {
  ("WeightedRichShape",      "ecrg_rc"):   "richness",
  ("WeightedRichShape",      "mx_mn_r"):   "richness_max_mean",
  ("WeightedRichShape",      "htspt_c"):   "hotspot_class",
  ("RichShape",              "plt_dt_m_"): "richness_raw",
  ("RichShape",              "plt_dt_s_"): "richness_sd",
  ("CumulativeUncertainty",  "ecrg_ncr"):  "uncertainty",
  ("CumulativeUncertainty",  "Uncrt_c"):   "uncertainty_cum",
  ("CumulativeUncertainty",  "Uncrt_s"):   "uncertainty_scaled",
  ("CumulativeUncertainty",  "ecrg_ncl"):  "uncertainty_class",
}
SUFFIXES        = list(FIELD_SUFFIX.values())
CLASS_SUFFIXES  = ["hotspot_class", "uncertainty_class"]
NUMERIC_SUFFIXES = [s for s in SUFFIXES if s not in CLASS_SUFFIXES]

SUFFIX_DESCRIPTION = {
  "richness":           "Ecoregion-weighted richness (0-1): estimated number of species divided by the ecoregion's maximum mean richness (public metric)",
  "richness_max_mean":  "Maximum mean richness (number of species) of the cell's ecoregion (11 ecoregions)",
  "hotspot_class":      "Hotspot class: ecoregion-weighted richness in classes separated by 0.1 ('[0,0.2]', '(0.2,0.4]', ...)",
  "richness_raw":       "Mean richness: sum of per-species occupancy probabilities (estimated number of species)",
  "richness_sd":        "Standard deviation of the estimated number of species",
  "uncertainty":        "Ecoregion-weighted cumulative uncertainty (0-1): cumulative uncertainty divided by the ecoregion's maximum (public metric)",
  "uncertainty_cum":    "Cumulative uncertainty: sum of per-species standard deviations of occupancy probability",
  "uncertainty_scaled": "Cumulative uncertainty scaled by the mean and sd of the seasonal estimates (z-score)",
  "uncertainty_class":  "Ecoregion-weighted uncertainty class in classes separated by 0.1",
}

# probability class thresholds (Thiago Couto): 0.6-0.8 Likely, 0.8-1.0 Very likely, below Unlikely
CLASS_LIKELY      = 0.6
CLASS_VERY_LIKELY = 0.8

SHP_RE = re.compile(r"^Ind_(CumulativeUncertainty|RichShape|WeightedRichShape)_(summer|winter)_(All|Fish|Ray|Red-listed|Shark|Turtle)$")


# ---- naming rules ----

def parse_shp_name(name: str) -> tuple[str, str, str]:
  """'Ind_WeightedRichShape_summer_Red-listed(.shp)' -> ('WeightedRichShape', 'summer', 'redlisted')."""
  stem = Path(name).stem
  m = SHP_RE.match(stem)
  if m is None:
    raise ValueError(f"unexpected shapefile name: {name}")
  return m.group(1), m.group(2), GROUP_KEYS[m.group(3)]


def column_name(group: str, season: str, suffix: str) -> str:
  """'{group}_{season}_{suffix}', e.g. shark_summer_richness_raw."""
  stopifnot(group in GROUPS, f"unknown group: {group}")
  stopifnot(season in SEASONS, f"unknown season: {season}")
  stopifnot(suffix in SUFFIXES, f"unknown suffix: {suffix}")
  return f"{group}_{season}_{suffix}"


def stopifnot(cond: bool, msg: str) -> None:
  if not cond:
    raise ValueError(msg)


def class_from_prob(p: float | None) -> str:
  """probability of occurrence -> 'Very likely' (>= 0.8), 'Likely' (>= 0.6) or 'Unlikely'."""
  if p is None or (isinstance(p, float) and np.isnan(p)):
    return "Unlikely"
  if p >= CLASS_VERY_LIKELY:
    return "Very likely"
  if p >= CLASS_LIKELY:
    return "Likely"
  return "Unlikely"


# ---- shapefile readers ----

def shp_to_wide(df: pd.DataFrame, product: str, season: str, group: str) -> pd.DataFrame:
  """one shapefile attribute table (FID + product fields) -> FID + renamed {group}_{season}_{suffix} columns."""
  out = pd.DataFrame({"FID": df["FID"].astype("int64").to_numpy()})
  for (prod, field), suffix in FIELD_SUFFIX.items():
    if prod != product:
      continue
    if field not in df.columns:
      raise ValueError(f"{product}: field {field} missing (have {list(df.columns)})")
    out[column_name(group, season, suffix)] = df[field].to_numpy()
  return out


def read_shapefile_table(path: Path) -> pd.DataFrame:
  """attribute table of a shapefile without geometry."""
  import pyogrio
  return pyogrio.read_dataframe(path, read_geometry=False)


def read_values(dir_shp: Path, reader=read_shapefile_table) -> pd.DataFrame:
  """all 36 shapefiles -> one wide table, one row per FID, columns {group}_{season}_{suffix}."""
  shps = sorted(Path(dir_shp).glob("Ind_*.shp"))
  stopifnot(len(shps) > 0, f"no Ind_*.shp in {dir_shp}")
  wide = None
  for shp in shps:
    product, season, group = parse_shp_name(shp.name)
    part = shp_to_wide(reader(shp), product, season, group)
    wide = part if wide is None else wide.merge(part, on="FID", how="outer", validate="one_to_one")
  wide = wide.sort_values("FID").reset_index(drop=True)
  return wide[["FID"] + sorted(c for c in wide.columns if c != "FID")]


def value_columns(wide: pd.DataFrame, group: str, season: str, suffixes=SUFFIXES) -> list[str]:
  return [column_name(group, season, s) for s in suffixes if column_name(group, season, s) in wide.columns]


# ---- metadata xlsx ----

def read_species_sheet(xlsx: Path) -> pd.DataFrame:
  """sheet Species -> name, numeric_id, abbreviation, iucn_code, redlisted, group1, group2."""
  d = pd.read_excel(xlsx, sheet_name="Species")
  d = d.rename(columns={
    "Name": "name", "NumericID": "numeric_id", "Abbreviation": "abbreviation",
    "IUCN_status": "iucn_code", "RedListed": "redlisted", "Group 1": "group1", "Group 2": "group2"})
  d["redlisted"] = d["redlisted"].astype(str).str.strip().str.lower().eq("yes")
  for c in ["name", "abbreviation", "iucn_code", "group1", "group2"]:
    d[c] = d[c].astype(str).str.strip()
  return d.reset_index(drop=True)


def read_fields_sheet(xlsx: Path) -> list[dict]:
  """sheet Fields -> [{product, field, full_name, description}], one dict per field row."""
  import openpyxl
  ws = openpyxl.load_workbook(xlsx, data_only=True)["Fields"]
  rows, product = [], None
  for a, b, c in ws.iter_rows(values_only=True, max_col=3):
    if a is None:
      continue
    if a == "Field":
      continue
    if b is None and c is None:
      product = str(a)
      continue
    rows.append({"product": product, "field": str(a), "full_name": str(b), "description": str(c)})
  return rows


# ---- species presence tables ----

def read_sppresence(path: Path) -> pd.DataFrame:
  """Indicator_SpPresence_{Prob|Class}_{season}.csv -> FID + one column per species abbreviation."""
  d = pd.read_csv(path)
  d = d.drop(columns=[c for c in d.columns if c.startswith("Unnamed")])
  d["FID"] = d["FID"].astype("int64")
  return d.sort_values("FID").reset_index(drop=True)


# ---- provenance ----

def sha256_file(path: Path, chunk: int = 1 << 20) -> str:
  h = hashlib.sha256()
  with open(path, "rb") as f:
    while block := f.read(chunk):
      h.update(block)
  return h.hexdigest()
