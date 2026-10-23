"""aquamaps_native: AquaMaps habitat suitability, native 0.5 degree and the global 0.05 degree downscale, by reference to
the COGs MarineSensitivity release v8 publishes.

No raster is copied and no per-taxon Item is written. The pipeline reads four public v8 tables (and the v7 `model`
table, for old links) over HTTP (DuckDB httpfs) and writes a registry (one row per AquaMaps model that has BOTH a
native 0.5 degree COG and a global 0.05 degree COG) plus the collection that describes how an Item is built from a
registry row, client-side:

  fetch_tables -> build_registry -> write_registry / search_index -> stac collection -> README, AGENTS, thumbnail

Join keys in the v8 tables (checked 2026-10-15):
  model.parquet          ds_key 'am'; mdl_key 'am|<SpeciesID>'; sp_id = the AquaMaps SpeciesID (Rep-3437, Fis-49220,
                         ITS-..., W-Hex-..., SLB-..., Chn-<uuid>); sci_name; sp_cat and common_name are empty here
  taxon_model.parquet    ds_key 'am'; mdl_key -> (taxon_authority worms|botw, taxon_id)
  taxon.parquet          (taxon_authority, taxon_id); scientific_name, common_name, sp_cat, iucn_code
  native_asset.parquet   ds_key 'am', asset_type 'cog'; representation 'native' = the 0.5 degree COG
                         (marine-atlas/native/am/), representation 'model' = the global 0.05 degree COG
                         (marine-atlas/cog/global05/); asset_url, rescale_min/max, colormap, xmin..ymax per COG
  v7 model.parquet       ds_key 'am_0.05'; taxa = the v7 registry key (an old `?sp=` link), description names the species
There is no model_asset.parquet in v8.
"""

from __future__ import annotations

import datetime as dt
import json
import re
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from . import docs, stac, thumbs

COLLECTION_ID = "aquamaps_native"
TITLE         = "AquaMaps habitat suitability (native 0.5° and global 0.05°)"
V8_TABLES     = "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/v8/tables"
V7_TABLES     = "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/v7/tables"
TABLE_NAMES   = ["model", "taxon_model", "taxon", "native_asset"]   # v8, in the order they are read
V8_COLLECTION = "https://file.marinesensitivity.org/stac/v8/am/collection.json"
V8_COLLECTION_TITLE = "MarineSensitivity v8 AquaMaps, 0.05 degree global downscale"
AQUAMAPS_URL  = "https://www.aquamaps.org"
# the v8 `am` STAC collection says license CC-BY-4.0 while its own sci:citation says Creative Commons
# Attribution-NonCommercial 3.0 (om TODO: "msens: fix msens-v7-am_0.05 STAC license (CC-BY-4.0 vs CC-BY-NC 3.0
# citation)", the same defect in v8). AquaMaps' terms are the NonCommercial ones, so that is what is shown.
LICENSE       = "CC-BY-NC-3.0"
LICENSE_URL   = "https://creativecommons.org/licenses/by-nc/3.0/"
LICENSE_TITLE = "CC BY-NC 3.0 Unported (non-commercial use only)"
CITATION = ("Kaschner, K., Kesner-Reyes, K., Garilao, C., Segschneider, J., Rius-Barile, J., Rees, T., Froese, R. "
            "(2019). AquaMaps: Predicted range maps for aquatic species. World wide web electronic publication, "
            "www.aquamaps.org, Version 10/2019.")
NOTE = ("Non-commercial use only (CC BY-NC 3.0). Maps and numbers come from AquaMaps; link back to aquamaps.org "
        "when you reuse them.")
VERSION       = "2019.10"
SOURCE_RELEASE = "MarineSensitivity v8"
PREDICTORS    = ["depth", "temperature", "salinity", "primary_production", "sea_ice_concentration", "distance_to_land"]
VALUE_RANGE   = [1, 100]
COLORMAP      = "spectral_r"
# STAC 1.1 core `bands` (the raster extension's `raster:bands` is gone in raster v2.0.0, the version Portolan pins).
# The registry Items are built client-side from a template, so their `statistics` are template constants, not read from
# 17,000+ COGs at write time: the grids are Byte 1-100 with nodata 0 by construction (test_registry_statistics_hold_for_an_aquamaps_byte_grid);
# only minimum and maximum, which the `cog` profile requires (no mean, stddev or valid_percent per taxon).
BANDS         = [{"name": "suitability", "data_type": "uint8", "nodata": 0, "unit": "percent",
                  "statistics": {"minimum": 1, "maximum": 100}}]
PROJ_CODE     = "EPSG:4326"   # both COGs (native 0.5 degree, downscaled 0.05 degree) are on the global lon/lat grid
COG_TYPE      = "image/tiff; application=geotiff; profile=cloud-optimized"
INDEX_MIN_BYTES = 1_000_000   # registry_index.json is written only when registry.parquet is larger than this
THUMB_SPECIES = ["Dermochelys coriacea", "Thunnus thynnus", "Carcharodon carcharias", "Megaptera novaeangliae"]

REGISTRY_COLUMNS = ["sp_key", "mdl_key", "aphia_id", "botw_id", "scientific_name", "common_name", "sp_cat",
                    "redlist_code", "cog_url", "bbox_native", "cog_url_005", "bbox_005", "rescale_min",
                    "rescale_max", "colormap", "sp_key_v7"]
REGISTRY_FIELDS = [
  ("sp_key",          "string", "AquaMaps SpeciesID (v8 model.sp_id, e.g. Rep-3437); the Item id and the `?sp=` key"),
  ("mdl_key",         "string", "MarineSensitivity v8 model key `am|<sp_key>` (model.parquet, ds_key am)"),
  ("aphia_id",        "int32",  "accepted WoRMS AphiaID; null when the model has no WoRMS match"),
  ("botw_id",         "int32",  "BirdLife BOTW id for a bird model; null otherwise"),
  ("scientific_name", "string", "accepted scientific name; falls back to the model's own name when unmatched"),
  ("common_name",     "string", "English common name; null when none"),
  ("sp_cat",          "string", "category: fish, invertebrate, mammal, turtle, reptile, bird, coral, ...; null when unmatched"),
  ("redlist_code",    "string", "IUCN Red List category (EX, EW, CR, EN, VU, NT, LC, DD, NE); null when none"),
  ("cog_url",         "string", "native 0.5 degree COG (Byte, 1-100, nodata 0), the collection's own surface"),
  ("bbox_native",     "list<double>", "[west, south, east, north]: extent of the native COG, from native_asset"),
  ("cog_url_005",     "string", "global 0.05 degree COG of the same model: the v8 downscale of the native surface"),
  ("bbox_005",        "list<double>", "[west, south, east, north]: extent of the 0.05 degree COG, from native_asset"),
  ("rescale_min",     "int32",  "display rescale minimum of the COGs (native_asset.rescale_min, 1)"),
  ("rescale_max",     "int32",  "display rescale maximum of the COGs (native_asset.rescale_max, 100)"),
  ("colormap",        "string", "titiler colormap name of the COGs (native_asset.colormap, spectral_r)"),
  ("sp_key_v7",       "string", "the v7 registry key (v7 model.taxa, ds_key am_0.05) of the same species, to map an old "
                                "`?sp=` link; null when v7 had no model of it"),
]

# registry version 2 (written by `build.py cog-3857-batch --pool`, published additively at registry/v2/registry.parquet):
# the same rows and columns plus the EPSG:3857 copy of each COG, which the browser draws
REGISTRY_V2_FIELDS = REGISTRY_FIELDS + [
  ("cog_3857_url",     "string", "EPSG:3857 copy of `cog_url` (what the browser draws; `cog_url` stays the original the numbers are "
                                "read from); null when the shared pool has no copy"),
  ("cog_3857_url_005", "string", "EPSG:3857 copy of `cog_url_005`; null when the shared pool has no copy"),
]

_NAME_RE = re.compile(r"^AquaMaps suitability for (.+?), interpolated")


# ---- reading the tables ----

def fetch_tables(base: str = V8_TABLES, v7_base: str | None = V7_TABLES, con=None) -> dict[str, pd.DataFrame]:
  """the four v8 tables filtered to the AquaMaps rows and the columns the registry needs, plus the v7 `model` table
  (`model_v7`, only when `v7_base` is not None) for the old-key mapping (httpfs, no download)."""
  import duckdb
  if con is None:
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs")
  rd = lambda t: f"read_parquet('{base}/{t}.parquet')"
  q = {
    "model": f"select mdl_key, sp_id, sci_name, common_name from {rd('model')} where ds_key = 'am'",
    "taxon_model": f"select mdl_key, taxon_authority, taxon_id from {rd('taxon_model')} where ds_key = 'am'",
    "taxon": (f"select taxon_authority, taxon_id, sp_cat, scientific_name, common_name, iucn_code "
              f"from {rd('taxon')}"),
    "native_asset": (f"select mdl_key, representation, asset_url, rescale_min, rescale_max, colormap, xmin, ymin, "
                     f"xmax, ymax from {rd('native_asset')} where ds_key = 'am' and asset_type = 'cog' "
                     f"and representation in ('native', 'model')"),
  }
  if v7_base:
    q["model_v7"] = (f"select taxa, description from read_parquet('{v7_base}/model.parquet') "
                     f"where ds_key = 'am_0.05'")
  return {k: con.execute(v).df() for k, v in q.items()}


# ---- registry ----

def name_from_description(description: str | None) -> str | None:
  """'AquaMaps suitability for Chlamys lowei, interpolated to 0.05 degree resolution' -> 'Chlamys lowei'."""
  m = _NAME_RE.match(description or "")
  return m.group(1) if m else None


def _none_if_na(s: pd.Series) -> pd.Series:
  return s.astype(object).where(s.notna(), None)


def _box(r) -> list[float] | None:
  return None if pd.isna(r.xmin) else [float(r.xmin), float(r.ymin), float(r.xmax), float(r.ymax)]


def map_v7_keys(sp_keys: pd.Series, names: pd.Series, model_v7: pd.DataFrame | None) -> pd.Series:
  """the v7 registry key (v7 model.taxa) of each v8 species, or None. Two rules, best effort:
  1. the v8 SpeciesID is itself a v7 `taxa` value (the AquaMaps ids did not change): the same key;
  2. else the case-insensitive scientific name equals the name in exactly one unclaimed v7 description."""
  if model_v7 is None or len(model_v7) == 0:
    return pd.Series([None] * len(sp_keys), index=sp_keys.index, dtype=object)
  v7 = model_v7.drop_duplicates("taxa")
  v7_keys = set(v7["taxa"].astype(str))
  taken = set(sp_keys.astype(str)) & v7_keys
  by_name: dict[str, list[str]] = {}
  for taxa, desc in zip(v7["taxa"].astype(str), v7["description"]):
    nm = name_from_description(desc)
    if nm and taxa not in taken:
      by_name.setdefault(nm.casefold(), []).append(taxa)
  out = []
  for k, nm in zip(sp_keys.astype(str), names.astype(str)):
    if k in v7_keys:
      out.append(k)
    else:
      cand = by_name.get(nm.casefold(), [])
      out.append(cand[0] if len(cand) == 1 else None)
  return pd.Series(out, index=sp_keys.index, dtype=object)


def build_registry(tables: dict[str, pd.DataFrame]) -> tuple[pd.DataFrame, dict]:
  """one row per am model that has BOTH a native 0.5 degree COG and a global 0.05 degree COG, sorted by scientific
  name. A model with only one of the two is excluded and counted (stats['native_only'], stats['only_005'],
  listed in stats['one_rep_sp_keys']); a model with neither is counted in stats['no_cog']. A model without a taxon
  match keeps the name from the model table and null ids (stats['n_unmatched'])."""
  model = tables["model"].drop_duplicates("mdl_key")
  na = tables["native_asset"]
  cols = ["mdl_key", "asset_url", "rescale_min", "rescale_max", "colormap", "xmin", "ymin", "xmax", "ymax"]
  nat = na[na["representation"] == "native"].drop_duplicates("mdl_key")[cols]
  dwn = na[na["representation"] == "model"].drop_duplicates("mdl_key")[cols]
  has_nat, has_005 = model["mdl_key"].isin(nat["mdl_key"]), model["mdl_key"].isin(dwn["mdl_key"])
  one_rep = model.loc[has_nat ^ has_005, "sp_id"].astype(str)
  d = model[has_nat & has_005].copy()
  d = d.merge(nat.add_prefix("n_").rename(columns={"n_mdl_key": "mdl_key"}), on="mdl_key", how="left")
  d = d.merge(dwn.add_prefix("d_").rename(columns={"d_mdl_key": "mdl_key"}), on="mdl_key", how="left")

  tm = tables["taxon_model"].drop_duplicates("mdl_key")
  tx = tables["taxon"].drop_duplicates(["taxon_authority", "taxon_id"]).rename(
    columns={"scientific_name": "tx_name", "common_name": "tx_common"})
  d = d.merge(tm, on="mdl_key", how="left").merge(tx, on=["taxon_authority", "taxon_id"], how="left")

  tid = pd.to_numeric(d["taxon_id"], errors="coerce")
  worms, botw = d["taxon_authority"].eq("worms") & d["tx_name"].notna(), d["taxon_authority"].eq("botw") & d["tx_name"].notna()
  sci = d["tx_name"].where(d["tx_name"].notna(), d["sci_name"])
  sci = sci.where(sci.notna(), d["sp_id"])   # last resort: the SpeciesID itself
  common = d["tx_common"].replace("", np.nan)
  common = common.where(common.notna(), d["common_name"].replace("", np.nan))
  nbox = [_box(r) for r in d.rename(columns={"n_xmin": "xmin", "n_ymin": "ymin", "n_xmax": "xmax", "n_ymax": "ymax"}).itertuples()]
  dbox = [_box(r) for r in d.rename(columns={"d_xmin": "xmin", "d_ymin": "ymin", "d_xmax": "xmax", "d_ymax": "ymax"}).itertuples()]
  reg = pd.DataFrame({
    "sp_key":          d["sp_id"].astype(str).to_numpy(),
    "mdl_key":         d["mdl_key"].astype(str).to_numpy(),
    "aphia_id":        pd.array(tid.where(worms).to_numpy(), dtype="Int32"),
    "botw_id":         pd.array(tid.where(botw).to_numpy(), dtype="Int32"),
    "scientific_name": sci.astype(str).to_numpy(),
    "common_name":     _none_if_na(common).to_numpy(),
    "sp_cat":          _none_if_na(d["sp_cat"].where(d["tx_name"].notna())).to_numpy(),
    "redlist_code":    _none_if_na(d["iucn_code"].where(d["tx_name"].notna())).to_numpy(),
    "cog_url":         d["n_asset_url"].astype(str).to_numpy(),
    "bbox_native":     nbox,
    "cog_url_005":     d["d_asset_url"].astype(str).to_numpy(),
    "bbox_005":        dbox,
    "rescale_min":     pd.array(d["n_rescale_min"].to_numpy(), dtype="Int32"),
    "rescale_max":     pd.array(d["n_rescale_max"].to_numpy(), dtype="Int32"),
    "colormap":        _none_if_na(d["n_colormap"]).to_numpy(),
    "sp_key_v7":       map_v7_keys(d["sp_id"], sci, tables.get("model_v7")).to_numpy(),
  })[REGISTRY_COLUMNS]
  key = reg["scientific_name"].str.casefold()
  reg = reg.assign(_k=key).sort_values(["_k", "sp_key"], kind="stable").drop(columns="_k").reset_index(drop=True)
  stats = {
    "n_models": int(len(model)),
    "n_taxa": int(len(reg)),
    "native_only": int((has_nat & ~has_005).sum()),
    "only_005": int((~has_nat & has_005).sum()),
    "no_cog": int((~has_nat & ~has_005).sum()),
    "one_rep_sp_keys": sorted(one_rep),
    "n_unmatched": int((reg["aphia_id"].isna() & reg["botw_id"].isna()).sum()),
    "n_no_common_name": int(reg["common_name"].isna().sum()),
    "n_sp_key_v7": int(reg["sp_key_v7"].notna().sum()),
    "n_sp_key_v7_renamed": int((reg["sp_key_v7"].notna() & (reg["sp_key_v7"] != reg["sp_key"])).sum()),
    "by_sp_cat": {str(k): int(v) for k, v in reg["sp_cat"].fillna("unmatched").value_counts().sort_index().items()},
  }
  return reg, stats


REGISTRY_SCHEMA = pa.schema([
  ("sp_key", pa.string()), ("mdl_key", pa.string()), ("aphia_id", pa.int32()), ("botw_id", pa.int32()),
  ("scientific_name", pa.string()), ("common_name", pa.string()), ("sp_cat", pa.string()),
  ("redlist_code", pa.string()), ("cog_url", pa.string()), ("bbox_native", pa.list_(pa.float64())),
  ("cog_url_005", pa.string()), ("bbox_005", pa.list_(pa.float64())), ("rescale_min", pa.int32()),
  ("rescale_max", pa.int32()), ("colormap", pa.string()), ("sp_key_v7", pa.string()),
])


def registry_table(reg: pd.DataFrame) -> pa.Table:
  """registry frame -> Arrow table with the fixed schema (nullable ints, boxes as list<double>)."""
  cols = {f.name: pa.array(reg[f.name].astype(object).where(reg[f.name].notna(), None).tolist(), type=f.type)
          for f in REGISTRY_SCHEMA}
  return pa.table(cols, schema=REGISTRY_SCHEMA)


def write_registry(reg: pd.DataFrame, path: Path) -> Path:
  path = Path(path)
  path.parent.mkdir(parents=True, exist_ok=True)
  pq.write_table(registry_table(reg), path, compression="zstd", row_group_size=50_000)
  return path


def search_index(reg: pd.DataFrame) -> list[list[str]]:
  """[[sp_key, scientific_name, common_name, sp_cat], ...] in registry order; missing values are empty strings."""
  txt = lambda x: x if isinstance(x, str) else ""
  return [[r.sp_key, r.scientific_name, txt(r.common_name), txt(r.sp_cat)] for r in reg.itertuples()]


def write_search_index(reg: pd.DataFrame, path: Path) -> Path:
  Path(path).write_text(json.dumps(search_index(reg), ensure_ascii=False, separators=(",", ":")) + "\n")
  return Path(path)


# ---- collection ----

def item_template() -> dict:
  """how an app builds the STAC Item of one taxon from its registry row: every `{column_name}` placeholder is
  substituted from the row; keys whose value is null are omitted. The Item's bbox and geometry are those of the
  surface drawn (`atlas:bbox` of the asset that plays the `data` role)."""
  return {
    "description": ("Build one Item per registry row, client-side; no Item files are published. Substitute each "
                    "placeholder in braces with the row's value of the column of that name; omit keys whose "
                    "value is null. Both assets are listed; `atlas:representation` says which one plays the "
                    "`data` role (native by default). The Item bbox and geometry are the `atlas:bbox` of that asset."),
    "registry_asset": "registry",
    "key_column": "sp_key",
    "id": "{sp_key}",
    "collection": COLLECTION_ID,
    "bbox": "{bbox_native}",
    "geometry": "Polygon of the bbox (west, south, east, north)",
    "properties": {
      "title": "{scientific_name} ({common_name})",
      "title_without_common_name": "{scientific_name}",
      "datetime": None,
      "proj:code": PROJ_CODE,
      "atlas:value_range": VALUE_RANGE,
      "atlas:representation": "native",
      "sdm:taxon": {
        "scientific_name": "{scientific_name}",
        "common_name": "{common_name}",
        "group": "{sp_cat}",
        "authorities": {"worms": "{aphia_id}", "botw": "{botw_id}"},
        "redlist_code": "{redlist_code}",
      },
    },
    "assets": {
      "cog": {
        "href": "{cog_url}",
        "type": COG_TYPE,
        "roles": ["data"],
        "title": "AquaMaps native 0.5 degree habitat suitability (percent)",
        "bands": BANDS,
        "atlas:bbox": "{bbox_native}",
        "atlas:rescale": VALUE_RANGE,
        "atlas:colormap": COLORMAP,
        "atlas:bidx": 1,
      },
      "cog_005": {
        "href": "{cog_url_005}",
        "type": COG_TYPE,
        "roles": ["reference"],
        "title": "AquaMaps habitat suitability downscaled to 0.05 degree, global (MarineSensitivity v8)",
        "bands": BANDS,
        "atlas:bbox": "{bbox_005}",
        "atlas:rescale": VALUE_RANGE,
        "atlas:colormap": COLORMAP,
        "atlas:bidx": 1,
      },
    },
    "point_value": "titiler /cog/point on the drawn asset (value 1-100; 0 or no data = outside the model's range)",
  }


def collection(stats: dict, registry_bytes: int | None = None, index_bytes: int | None = None) -> dict:
  n = stats["n_taxa"]
  assets = {
    "registry": {
      "href": "./registry.parquet", "type": stac.PARQUET, "roles": ["metadata"],
      "title": "Taxa registry: one row per AquaMaps model with both a native 0.5 degree and a global 0.05 degree "
               "COG (names, ids, COG urls, bboxes)",
      "atlas:key_column": "sp_key", "table:row_count": n,
      "table:columns": [{"name": c, "type": t, "description": desc} for c, t, desc in REGISTRY_FIELDS],
    },
  }
  if index_bytes:
    assets["registry_index"] = {
      "href": "./registry_index.json", "type": stac.JSON_T, "roles": ["metadata"],
      "title": "Compact search index of the registry: [sp_key, scientific_name, common_name, sp_cat]",
      "atlas:row_count": n,
    }
  assets["thumbnail"] = stac.thumbnail_asset("Thumbnail: 2x2 panel of four native AquaMaps surfaces")
  registry = {"asset": "registry", "key_column": "sp_key", "row_count": n,
              "search_columns": ["scientific_name", "common_name"], "group_column": "sp_cat",
              "legacy_key_column": "sp_key_v7"}
  if index_bytes:
    registry["index_asset"] = "registry_index"
  by_cat = stats["by_sp_cat"]
  return {
    "type": "Collection",
    "stac_version": stac.STAC_VERSION,
    "stac_extensions": [stac.EXT["sdm"], stac.EXT["scientific"], stac.EXT["table"], stac.EXT["version"],
                        stac.EXT["file"], stac.EXT["portolan"]],
    "id": COLLECTION_ID,
    "updated": stac.now_rfc3339(),
    "title": TITLE,
    "description": (
      f"AquaMaps relative environmental suitability (1-100 percent) for {n:,} aquatic species in two "
      "representations, both from MarineSensitivity release v8: the original global 0.5 degree grid (native) and "
      "the global 0.05 degree downscale (not the USA-clipped surface of release v7). The COGs are referenced, not "
      "copied; one registry row per species lets an app build a per-taxon Item with both COGs without "
      f"{n:,} Item files. Non-commercial use only (CC BY-NC 3.0). Methods and registry columns: README.md."),
    "license": LICENSE,
    "version": VERSION,
    "deprecated": False,
    "sci:citation": CITATION,
    "providers": [
      {"name": "AquaMaps", "roles": ["producer", "licensor"], "url": AQUAMAPS_URL,
       "description": "Kaschner et al. 2019; relative environmental suitability models (www.aquamaps.org)"},
      {"name": "MarineSensitivity", "roles": ["processor"], "url": "https://marinesensitivity.org",
       "description": "published the native 0.5 degree COGs and downscaled the surfaces to a global 0.05 degree "
                      "grid in release v8"},
      {"name": "OceanMetrics", "roles": ["host"], "url": "https://oceanmetrics.io"},
    ],
    "atlas:funders": [],
    "atlas:status": "prototype",
    "atlas:note": NOTE,
    "atlas:source_release": SOURCE_RELEASE,
    "extent": {
      "spatial": {"bbox": [[-180.0, -90.0, 180.0, 90.0]]},
      "temporal": {"interval": [[None, None]]},
    },
    "sdm:response_type": "suitability",
    "sdm:value_unit": "percent",
    "sdm:value_range": VALUE_RANGE,
    "sdm:method": "env_envelope",
    "sdm:method_detail": ("AquaMaps relative environmental suitability: per species, an envelope of the cell values "
                          "of six predictors, fitted to occurrence records and expert-checked; published to 0.01 and "
                          "stored here as Byte 1-100 (0 = no data) on the 0.5 degree HCAF grid (native) and "
                          "downscaled by MarineSensitivity to a global 0.05 degree grid (release v8)."),
    "sdm:source_authority": "AquaMaps",
    "sdm:temporal_interval": "static",
    "sdm:predictors": PREDICTORS,
    "atlas:taxa_registry": registry,
    "atlas:item_template": item_template(),
    "atlas:registry_stats": {k: stats[k] for k in ("n_models", "n_taxa", "native_only", "only_005", "no_cog",
                                                    "n_unmatched", "n_sp_key_v7")},
    "summaries": {
      "sdm:taxon.group": by_cat,
      "atlas:taxa": [n],   # summaries hold arrays, ranges or schemas, not scalars
      "sdm:response_type": ["suitability"],
      "atlas:representation": ["native", "005"],
    },
    "assets": assets,
    "item_assets": {
      "cog": {
        "type": COG_TYPE, "roles": ["data"],
        "title": "AquaMaps native 0.5 degree habitat suitability (percent)",
        "bands": BANDS,
        "sdm:value_unit": "percent", "sdm:value_range": VALUE_RANGE,
        "atlas:rescale": VALUE_RANGE, "atlas:colormap": COLORMAP,
      },
      "cog_005": {
        "type": COG_TYPE, "roles": ["reference"],
        "title": "AquaMaps habitat suitability downscaled to 0.05 degree, global (MarineSensitivity v8)",
        "bands": BANDS,
        "sdm:value_unit": "percent", "sdm:value_range": VALUE_RANGE,
        "atlas:rescale": VALUE_RANGE, "atlas:colormap": COLORMAP,
      },
    },
    "links": [
      {"rel": "root",   "href": "../catalog.json", "type": stac.JSON_T, "title": "OceanMetrics Atlas"},
      {"rel": "parent", "href": "../catalog.json", "type": stac.JSON_T, "title": "OceanMetrics Atlas"},
      {"rel": "self",   "href": "./collection.json", "type": stac.JSON_T},
      {"rel": "describedby", "href": "./README.md", "type": stac.MD_T, "title": "Methods, registry columns and credits"},
      {"rel": "agents", "href": "./AGENTS.md", "type": stac.MD_T, "title": "Agent/LLM usage guide"},
      stac.PREVIEW_LINK,
      {"rel": "via", "href": AQUAMAPS_URL, "type": "text/html", "title": "AquaMaps (producer)"},
      {"rel": "related", "href": V8_COLLECTION, "type": stac.JSON_T, "title": V8_COLLECTION_TITLE},
      {"rel": "license", "href": LICENSE_URL, "type": "text/html", "title": LICENSE_TITLE},
    ],
  }


# ---- check ----

def check_collection(coll_dir: Path, coll: dict) -> list[str]:
  """offline problems of the staged collection: license, note, registry file vs table:columns, no item links."""
  bad = []
  if coll.get("license") != LICENSE:
    bad.append(f"license is {coll.get('license')!r}, expected {LICENSE}")
  if not any(l["rel"] == "license" and l["href"] == LICENSE_URL for l in coll.get("links", [])):
    bad.append("license link missing")
  if not coll.get("atlas:note"):
    bad.append("atlas:note (non-commercial) missing")
  if any(l["rel"] == "item" for l in coll.get("links", [])):
    bad.append("item links found: items are registry-built, not published")
  for k in ("atlas:taxa_registry", "atlas:item_template", "item_assets"):
    if k not in coll:
      bad.append(f"missing {k}")
  reg = coll.get("assets", {}).get("registry")
  f = Path(coll_dir) / (reg["href"] if reg else "registry.parquet")   # ./registry.parquet, or ./registry/v2/registry.parquet
  if reg is None or not f.exists():
    return bad + ["registry asset or registry.parquet missing"]
  meta = pq.read_metadata(f)
  have = pq.read_schema(f).names
  want = [c["name"] for c in reg["table:columns"]]
  if have != want:
    bad.append(f"registry columns {have} differ from table:columns {want}")
  if meta.num_rows != reg.get("table:row_count"):
    bad.append(f"registry has {meta.num_rows} rows, table:row_count says {reg.get('table:row_count')}")
  idx = Path(coll_dir) / "registry_index.json"
  if ("registry_index" in coll["assets"]) != idx.exists():
    bad.append("registry_index asset and registry_index.json disagree")
  if idx.exists() and len(json.loads(idx.read_text())) != meta.num_rows:
    bad.append("registry_index.json row count differs from registry.parquet")
  return bad


# ---- registry version 2: the collection points at it, additively ----

COLLECTION_URL = "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/atlas/aquamaps_native/collection.json"
COPY_COLUMNS   = ["cog_3857_url", "cog_3857_url_005"]


def bump_version(v: str) -> str:
  """the collection's next `version`: the AquaMaps release `2019.10` -> `2019.10.1` -> `2019.10.2` (a revision of
  the same data; the data version stays the prefix)."""
  if v == VERSION:
    return f"{VERSION}.1"
  m = re.fullmatch(re.escape(VERSION) + r"\.(\d+)", v)
  if not m:
    raise ValueError(f"collection version {v!r} is not {VERSION} or {VERSION}.<n>")
  return f"{VERSION}.{int(m.group(1)) + 1}"


def registry_version_collection(live: dict, registry: Path, version: str = "v2", updated: str | None = None) -> dict:
  """the live collection.json repointed at the registry version file `registry`: `version` bumped, `updated`, the
  `registry` asset's href (`./registry/<version>/registry.parquet`), `file:size`, `file:checksum` and `table:columns`
  (the file's columns, each keeping its description, the new ones described), and the item template listing the copy
  assets. Everything else is the live document as it is (additive: no field removed, no other asset touched).
  Raises ValueError when the file is not the registry the collection describes (a missing column, another row count)."""
  coll = json.loads(json.dumps(live))
  asset = coll["assets"]["registry"]
  meta, names = pq.read_metadata(registry), pq.read_schema(registry).names
  missing = [c for c in REGISTRY_COLUMNS + COPY_COLUMNS if c not in names]
  if missing:
    raise ValueError(f"{registry} lacks the registry columns {missing}")
  if meta.num_rows != asset.get("table:row_count"):
    raise ValueError(f"{registry} has {meta.num_rows} rows, the collection says {asset.get('table:row_count')}")
  known = {c["name"]: c for c in asset["table:columns"]}
  described = {c: (t, d) for c, t, d in REGISTRY_V2_FIELDS}
  cols = []
  for n in names:
    cols.append(known[n] if n in known else {"name": n, "type": described[n][0], "description": described[n][1]})
  asset["href"] = f"./registry/{version}/registry.parquet"
  asset["table:columns"] = cols
  asset["file:size"] = Path(registry).stat().st_size
  asset["file:checksum"] = stac.multihash_sha256(Path(registry))
  asset["title"] = asset["title"].replace("(names, ids, COG urls, bboxes)", "(names, ids, COG urls and their EPSG:3857 copies, bboxes)")
  coll["version"] = bump_version(coll["version"])
  coll["updated"] = updated or dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
  assets = coll["atlas:item_template"]["assets"]
  for key, src, rep_key in (("cog_3857", "cog_3857_url", "cog"), ("cog_3857_005", "cog_3857_url_005", "cog_005")):
    base = assets[rep_key]
    assets[key] = {**{k: base[k] for k in ("type", "bands", "atlas:bbox", "atlas:rescale", "atlas:colormap", "atlas:bidx")},
                   "href": "{" + src + "}", "roles": ["data", "visual"] if key == "cog_3857" else ["reference"],
                   "proj:code": "EPSG:3857",
                   "title": f"{base['title']}: EPSG:3857 copy, drawn in the browser; omit when null"}
  return coll


# ---- thumbnail ----

def read_cog_panel(url: str):
  """(masked array, (west, south, east, north)) of a native COG read over HTTP; nodata 0 is masked."""
  import rasterio
  with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_MAX_RETRY="3"):
    with rasterio.open(url) as src:
      return src.read(1, masked=True), tuple(src.bounds)


def thumbnail_names(reg: pd.DataFrame, names: list[str] = THUMB_SPECIES) -> dict[str, str]:
  """{scientific_name: cog_url} (native COG) for the wanted names present in the registry (order kept)."""
  by = dict(zip(reg["scientific_name"][::-1], reg["cog_url"][::-1]))
  return {n: by[n] for n in names if n in by}


# ---- build ----

def build(out: Path, tables: dict[str, pd.DataFrame] | None = None, base: str = V8_TABLES,
          v7_base: str | None = V7_TABLES, use_thumbnail: bool = True, log=print) -> dict:
  dest = Path(out) / COLLECTION_ID
  dest.mkdir(parents=True, exist_ok=True)
  tables = tables or fetch_tables(base, v7_base)
  reg, stats = build_registry(tables)
  rpath = write_registry(reg, dest / "registry.parquet")
  rbytes = rpath.stat().st_size
  log(f"registry.parquet: {len(reg):,} rows, {rbytes:,} B; only one representation (excluded): "
      f"{stats['native_only']} native-only + {stats['only_005']} 0.05-only; no COG at all: {stats['no_cog']}; "
      f"unmatched to a taxon: {stats['n_unmatched']}; sp_key_v7 set: {stats['n_sp_key_v7']}")
  index_bytes = None
  idx = dest / "registry_index.json"
  if rbytes > INDEX_MIN_BYTES:
    index_bytes = write_search_index(reg, idx).stat().st_size
    log(f"registry_index.json: {index_bytes:,} B")
  elif idx.exists():
    idx.unlink()
  if use_thumbnail:
    panels = {n: read_cog_panel(u) for n, u in thumbnail_names(reg).items()}
    png, small = thumbs.aquamaps_thumbnail(panels, dest / "thumbnail.png")
    log(f"thumbnails: {png.name} {png.stat().st_size:,} B, {small.name} {small.stat().st_size:,} B ({', '.join(panels)})")
  coll = collection(stats, rbytes, index_bytes)
  counts = {**stats, "registry_bytes": rbytes, "index_bytes": index_bytes}
  (dest / "README.md").write_text(docs.aquamaps_readme(counts))
  (dest / "AGENTS.md").write_text(docs.aquamaps_agents(counts))
  stac.write_json(dest / "collection.json", stac.add_file_info(coll, dest, {}))
  today = dt.date.today().isoformat()
  sources = [{"table": f"v8/{t}", "url": f"{base}/{t}.parquet", "rows_read": int(len(tables[t]))} for t in TABLE_NAMES]
  if "model_v7" in tables:
    sources.append({"table": "v7/model", "url": f"{v7_base}/model.parquet", "rows_read": int(len(tables["model_v7"]))})
  prov = {
    "collection": COLLECTION_ID,
    "retrieved": today,
    "built": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
    "sources": sources,
    "filters": {"v8/model": "ds_key = 'am'", "v8/taxon_model": "ds_key = 'am'",
                "v8/native_asset": "ds_key = 'am' and asset_type = 'cog' and representation in ('native', 'model')",
                "v7/model": "ds_key = 'am_0.05' (taxa + description, for sp_key_v7 only)"},
    "registry_rule": "models with BOTH a native (0.5 degree) and a model (global 0.05 degree) COG",
    "record_counts": {k: stats[k] for k in ("n_models", "n_taxa", "native_only", "only_005", "no_cog", "n_unmatched",
                                              "n_no_common_name", "n_sp_key_v7", "n_sp_key_v7_renamed")},
    "registry_bytes": rbytes,
    "registry_index_bytes": index_bytes,
    "one_rep_sp_keys": stats["one_rep_sp_keys"],
    "thumbnail_species": THUMB_SPECIES if use_thumbnail else [],
    "rasters": ("referenced, not copied: native COGs stay at marine-atlas/native/am/ and the global 0.05 degree "
                "COGs at marine-atlas/cog/global05/ on the public bucket"),
  }
  stac.write_json(dest / "provenance.json", prov)
  return {"dest": dest, "stats": stats, "registry_bytes": rbytes, "index_bytes": index_bytes, "registry": reg}
