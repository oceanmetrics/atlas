"""aquamaps_native: AquaMaps native 0.5-degree habitat suitability, by reference to the COGs MarineSensitivity v7 publishes.

No raster is copied and no per-taxon Item is written. The pipeline reads five public v7 tables over HTTP (DuckDB
httpfs) and writes a registry (one row per AquaMaps model that has a native COG) plus the collection that describes
how an Item is built from a registry row, client-side:

  fetch_v7_tables -> build_registry -> write_registry / search_index -> stac collection -> README, AGENTS, thumbnail

Join keys in the v7 tables (checked 2026-10-14):
  model.parquet          ds_key 'am_0.05'; mdl_seq; taxa = AquaMaps sp_key; description 'AquaMaps suitability for <name>, ...'
  taxon_model.parquet    ds_key 'am_0.05'; taxon_id -> mdl_seq
  taxon.parquet          taxon_id; taxon_authority worms|botw; scientific_name, common_name, sp_cat, redlist_code
  native_asset.parquet   ds_key 'am', representation 'native', asset_type 'cog'; mdl_key = str(mdl_seq); asset_url; xmin..ymax
  model_asset.parquet    ds_key 'am'; mdl_seq; cog_url (the 0.05 degree COG, grid usa05); n_cells (0.05 degree cells)
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
TITLE         = "AquaMaps habitat suitability, native 0.5 degree"
V7_TABLES     = "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/v7/tables"
TABLE_NAMES   = ["model", "taxon_model", "taxon", "native_asset", "model_asset"]
V7_COLLECTION = "https://file.marinesensitivity.org/stac/v7/am_0.05/collection.json"
AQUAMAPS_URL  = "https://www.aquamaps.org"
LICENSE       = "CC-BY-NC-3.0"
LICENSE_URL   = "https://creativecommons.org/licenses/by-nc/3.0/"
LICENSE_TITLE = "CC BY-NC 3.0 Unported (non-commercial use only)"
CITATION = ("Kaschner, K., Kesner-Reyes, K., Garilao, C., Segschneider, J., Rius-Barile, J., Rees, T., Froese, R. "
            "(2019). AquaMaps: Predicted range maps for aquatic species. World wide web electronic publication, "
            "www.aquamaps.org, Version 10/2019.")
NOTE = ("Non-commercial use only (CC BY-NC 3.0). Maps and numbers come from AquaMaps; link back to aquamaps.org "
        "when you reuse them.")
VERSION       = "2019.10"
PREDICTORS    = ["depth", "temperature", "salinity", "primary_production", "sea_ice_concentration", "distance_to_land"]
VALUE_RANGE   = [1, 100]
COLORMAP      = "spectral_r"
# STAC 1.1 core `bands` (the raster extension's `raster:bands` is gone in raster v2.0.0, the version Portolan pins)
BANDS         = [{"name": "suitability", "data_type": "uint8", "nodata": 0, "unit": "percent",
                  "statistics": {"minimum": 1, "maximum": 100}}]
COG_TYPE      = "image/tiff; application=geotiff; profile=cloud-optimized"
INDEX_MIN_BYTES = 1_000_000   # registry_index.json is written only when registry.parquet is larger than this
THUMB_SPECIES = ["Dermochelys coriacea", "Thunnus thynnus", "Carcharodon carcharias", "Megaptera novaeangliae"]

REGISTRY_COLUMNS = ["sp_key", "mdl_seq", "aphia_id", "botw_id", "scientific_name", "common_name", "sp_cat",
                    "redlist_code", "cog_url", "cog_url_005", "bbox", "n_cells_005"]
REGISTRY_FIELDS = [
  ("sp_key",          "string", "AquaMaps species key (model.taxa); the Item id"),
  ("mdl_seq",         "int32",  "MarineSensitivity v7 model number (model.parquet, ds_key am_0.05)"),
  ("aphia_id",        "int32",  "accepted WoRMS AphiaID; null when the model has no WoRMS match"),
  ("botw_id",         "int32",  "BirdLife BOTW id for the one bird model; null otherwise"),
  ("scientific_name", "string", "accepted scientific name; falls back to the name in the model description when unmatched"),
  ("common_name",     "string", "English common name; null when none"),
  ("sp_cat",          "string", "category: fish, invertebrate, mammal, turtle, reptile, bird, coral, other; null when unmatched"),
  ("redlist_code",    "string", "IUCN Red List category (EX, EW, CR, EN, VU, NT, LC, DD, NE); null when none"),
  ("cog_url",         "string", "native 0.5 degree COG (Byte, 1-100, nodata 0), the surface this collection draws"),
  ("cog_url_005",     "string", "the 0.05 degree COG of the same model on the MST analysis grid (usa05), for comparison"),
  ("bbox",            "list<double>", "[west, south, east, north]: extent of the native surface's cells, from native_asset"),
  ("n_cells_005",     "int32",  "number of 0.05 degree cells in the model's MST surface (model_asset.n_cells); null when unknown"),
]

_NAME_RE = re.compile(r"^AquaMaps suitability for (.+?), interpolated")


# ---- reading the v7 tables ----

def fetch_v7_tables(base: str = V7_TABLES, con=None) -> dict[str, pd.DataFrame]:
  """the five v7 tables, filtered to the AquaMaps rows and the columns the registry needs (httpfs, no download)."""
  import duckdb
  if con is None:
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs")
  rd = lambda t: f"read_parquet('{base}/{t}.parquet')"
  q = {
    "model": f"select mdl_seq, taxa, description from {rd('model')} where ds_key = 'am_0.05'",
    "taxon_model": f"select taxon_id, mdl_seq from {rd('taxon_model')} where ds_key = 'am_0.05'",
    "taxon": (f"select taxon_id, taxon_authority, sp_cat, scientific_name, common_name, worms_id, redlist_code "
              f"from {rd('taxon')}"),
    "native_asset": (f"select mdl_key, asset_url, xmin, ymin, xmax, ymax from {rd('native_asset')} "
                     f"where ds_key = 'am' and representation = 'native' and asset_type = 'cog'"),
    "model_asset": f"select mdl_seq, cog_url, n_cells from {rd('model_asset')} where ds_key = 'am'",
  }
  return {k: con.execute(v).df() for k, v in q.items()}


# ---- registry ----

def name_from_description(description: str | None) -> str | None:
  """'AquaMaps suitability for Chlamys lowei, interpolated to 0.05 degree resolution' -> 'Chlamys lowei'."""
  m = _NAME_RE.match(description or "")
  return m.group(1) if m else None


def _none_if_na(s: pd.Series) -> pd.Series:
  return s.astype(object).where(s.notna(), None)


def build_registry(tables: dict[str, pd.DataFrame]) -> tuple[pd.DataFrame, dict]:
  """one row per am_0.05 model that has a native COG, sorted by scientific name. Models without a native COG are
  excluded and counted in stats['excluded_no_native']; models without a taxon match keep the name from the model
  description (stats['n_unmatched'])."""
  model = tables["model"].drop_duplicates("mdl_seq")
  native = tables["native_asset"].assign(mdl_seq=lambda d: pd.to_numeric(d["mdl_key"], errors="coerce")).dropna(subset=["mdl_seq"])
  native = native.assign(mdl_seq=native["mdl_seq"].astype(int)).drop_duplicates("mdl_seq")
  d = model.merge(native[["mdl_seq", "asset_url", "xmin", "ymin", "xmax", "ymax"]], on="mdl_seq", how="left")
  has_native = d["asset_url"].notna()
  excluded = d.loc[~has_native, ["mdl_seq", "taxa"]]
  d = d[has_native].copy()

  tm = tables["taxon_model"].drop_duplicates("mdl_seq")
  tx = tables["taxon"].drop_duplicates("taxon_id")
  d = d.merge(tm, on="mdl_seq", how="left").merge(tx, on="taxon_id", how="left")
  d = d.merge(tables["model_asset"].drop_duplicates("mdl_seq")[["mdl_seq", "cog_url", "n_cells"]], on="mdl_seq", how="left")

  worms, botw = d["taxon_authority"].eq("worms"), d["taxon_authority"].eq("botw")
  aphia = d["worms_id"].where(worms & d["worms_id"].notna(), d["taxon_id"].where(worms))
  sci = d["scientific_name"].where(d["scientific_name"].notna(), d["description"].map(name_from_description))
  sci = sci.where(sci.notna(), d["taxa"])   # last resort: the sp_key itself
  bbox = [
    None if pd.isna(r.xmin) else [float(r.xmin), float(r.ymin), float(r.xmax), float(r.ymax)]
    for r in d.itertuples()
  ]
  reg = pd.DataFrame({
    "sp_key":          d["taxa"].astype(str).to_numpy(),
    "mdl_seq":         d["mdl_seq"].astype("int32").to_numpy(),
    "aphia_id":        pd.array(aphia.to_numpy(), dtype="Int32"),
    "botw_id":         pd.array(d["taxon_id"].where(botw).to_numpy(), dtype="Int32"),
    "scientific_name": sci.astype(str).to_numpy(),
    "common_name":     _none_if_na(d["common_name"].replace("", np.nan)).to_numpy(),
    "sp_cat":          _none_if_na(d["sp_cat"]).to_numpy(),
    "redlist_code":    _none_if_na(d["redlist_code"]).to_numpy(),
    "cog_url":         d["asset_url"].astype(str).to_numpy(),
    "cog_url_005":     _none_if_na(d["cog_url"]).to_numpy(),
    "bbox":            bbox,
    "n_cells_005":     pd.array(d["n_cells"].to_numpy(), dtype="Int32"),
  })[REGISTRY_COLUMNS]
  key = reg["scientific_name"].str.casefold()
  reg = reg.assign(_k=key).sort_values(["_k", "sp_key"], kind="stable").drop(columns="_k").reset_index(drop=True)
  stats = {
    "n_models": int(len(model)),
    "n_taxa": int(len(reg)),
    "excluded_no_native": int(len(excluded)),
    "excluded_sp_keys": sorted(excluded["taxa"].astype(str)),
    "n_unmatched": int((reg["aphia_id"].isna() & reg["botw_id"].isna()).sum()),
    "n_no_common_name": int(reg["common_name"].isna().sum()),
    "n_no_cog_005": int(reg["cog_url_005"].isna().sum()),
    "by_sp_cat": {str(k): int(v) for k, v in reg["sp_cat"].fillna("unmatched").value_counts().sort_index().items()},
  }
  return reg, stats


REGISTRY_SCHEMA = pa.schema([
  ("sp_key", pa.string()), ("mdl_seq", pa.int32()), ("aphia_id", pa.int32()), ("botw_id", pa.int32()),
  ("scientific_name", pa.string()), ("common_name", pa.string()), ("sp_cat", pa.string()),
  ("redlist_code", pa.string()), ("cog_url", pa.string()), ("cog_url_005", pa.string()),
  ("bbox", pa.list_(pa.float64())), ("n_cells_005", pa.int32()),
])


def registry_table(reg: pd.DataFrame) -> pa.Table:
  """registry frame -> Arrow table with the fixed schema (nullable ints, bbox as list<double>)."""
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
  substituted from the row; keys whose value is null are omitted."""
  return {
    "description": ("Build one Item per registry row, client-side; no Item files are published. Substitute each "
                    "placeholder in braces with the row's value of the column of that name; omit keys whose "
                    "value is null."),
    "registry_asset": "registry",
    "key_column": "sp_key",
    "id": "{sp_key}",
    "collection": COLLECTION_ID,
    "bbox": "{bbox}",
    "geometry": "Polygon of {bbox} (west, south, east, north)",
    "properties": {
      "title": "{scientific_name} ({common_name})",
      "title_without_common_name": "{scientific_name}",
      "datetime": None,
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
        "atlas:rescale": VALUE_RANGE,
        "atlas:colormap": COLORMAP,
        "atlas:bidx": 1,
      },
      "cog_005": {
        "href": "{cog_url_005}",
        "type": COG_TYPE,
        "roles": ["data"],
        "title": "MarineSensitivity 0.05 degree surface of the same model (usa05 grid), for comparison",
        "atlas:optional": True,
        "atlas:rescale": VALUE_RANGE,
        "atlas:colormap": COLORMAP,
      },
    },
    "point_value": "titiler /cog/point on the `cog` asset (value 1-100; 0 or no data = outside the model's range)",
  }


def collection(stats: dict, registry_bytes: int | None = None, index_bytes: int | None = None) -> dict:
  n = stats["n_taxa"]
  assets = {
    "registry": {
      "href": "./registry.parquet", "type": stac.PARQUET, "roles": ["metadata"],
      "title": "Taxa registry: one row per AquaMaps model with a native COG (names, ids, COG urls, bbox)",
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
              "search_columns": ["scientific_name", "common_name"], "group_column": "sp_cat"}
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
      f"AquaMaps relative environmental suitability (1-100 percent) for {n:,} aquatic species on the original "
      "global 0.5 degree grid, drawn from the native COGs that MarineSensitivity release v7 publishes. The COGs are "
      "referenced, not copied; one registry row per species lets an app build a per-taxon COG Item without 17,000 "
      "Item files. Distinct from the 0.05 degree downscaled AquaMaps in the MarineSensitivity v7 collection. "
      "Non-commercial use only (CC BY-NC 3.0). Methods and registry columns: README.md."),
    "license": LICENSE,
    "version": VERSION,
    "deprecated": False,
    "sci:citation": CITATION,
    "providers": [
      {"name": "AquaMaps", "roles": ["producer", "licensor"], "url": AQUAMAPS_URL,
       "description": "Kaschner et al. 2019; relative environmental suitability models (www.aquamaps.org)"},
      {"name": "MarineSensitivity", "roles": ["processor"], "url": "https://marinesensitivity.org",
       "description": "published the native 0.5 degree COGs in release v7"},
      {"name": "OceanMetrics", "roles": ["host"], "url": "https://oceanmetrics.io"},
    ],
    "atlas:funders": [],
    "atlas:status": "prototype",
    "atlas:note": NOTE,
    "atlas:source_release": "MarineSensitivity v7",
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
                          "stored here as Byte 1-100 (0 = no data) on the 0.5 degree HCAF grid."),
    "sdm:source_authority": "AquaMaps",
    "sdm:temporal_interval": "static",
    "sdm:predictors": PREDICTORS,
    "atlas:taxa_registry": registry,
    "atlas:item_template": item_template(),
    "atlas:registry_stats": {k: stats[k] for k in ("n_models", "n_taxa", "excluded_no_native", "n_unmatched")},
    "summaries": {
      "sdm:taxon.group": by_cat,
      "atlas:taxa": [n],   # summaries hold arrays, ranges or schemas, not scalars
      "sdm:response_type": ["suitability"],
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
    },
    "links": [
      {"rel": "root",   "href": "../catalog.json", "type": stac.JSON_T, "title": "OceanMetrics Atlas"},
      {"rel": "parent", "href": "../catalog.json", "type": stac.JSON_T, "title": "OceanMetrics Atlas"},
      {"rel": "self",   "href": "./collection.json", "type": stac.JSON_T},
      {"rel": "describedby", "href": "./README.md", "type": stac.MD_T, "title": "Methods, registry columns and credits"},
      {"rel": "agents", "href": "./AGENTS.md", "type": stac.MD_T, "title": "Agent/LLM usage guide"},
      stac.PREVIEW_LINK,
      {"rel": "via", "href": AQUAMAPS_URL, "type": "text/html", "title": "AquaMaps (producer)"},
      {"rel": "related", "href": V7_COLLECTION, "type": stac.JSON_T,
       "title": "MarineSensitivity v7 AquaMaps, 0.05 degree downscale"},
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
  f = Path(coll_dir) / "registry.parquet"
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


# ---- thumbnail ----

def read_cog_panel(url: str):
  """(masked array, (west, south, east, north)) of a native COG read over HTTP; nodata 0 is masked."""
  import rasterio
  with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_MAX_RETRY="3"):
    with rasterio.open(url) as src:
      return src.read(1, masked=True), tuple(src.bounds)


def thumbnail_names(reg: pd.DataFrame, names: list[str] = THUMB_SPECIES) -> dict[str, str]:
  """{scientific_name: cog_url} for the wanted names present in the registry (order kept)."""
  by = dict(zip(reg["scientific_name"][::-1], reg["cog_url"][::-1]))
  return {n: by[n] for n in names if n in by}


# ---- build ----

def build(out: Path, tables: dict[str, pd.DataFrame] | None = None, base: str = V7_TABLES,
          use_thumbnail: bool = True, log=print) -> dict:
  dest = Path(out) / COLLECTION_ID
  dest.mkdir(parents=True, exist_ok=True)
  tables = tables or fetch_v7_tables(base)
  reg, stats = build_registry(tables)
  rpath = write_registry(reg, dest / "registry.parquet")
  rbytes = rpath.stat().st_size
  log(f"registry.parquet: {len(reg):,} rows, {rbytes:,} B; excluded (no native COG): {stats['excluded_no_native']}; "
      f"unmatched to a taxon: {stats['n_unmatched']}")
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
  prov = {
    "collection": COLLECTION_ID,
    "retrieved": today,
    "built": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
    "sources": [{"table": t, "url": f"{base}/{t}.parquet", "rows_read": int(len(tables[t]))} for t in TABLE_NAMES],
    "filters": {"model": "ds_key = 'am_0.05'", "taxon_model": "ds_key = 'am_0.05'",
                "native_asset": "ds_key = 'am' and representation = 'native' and asset_type = 'cog'",
                "model_asset": "ds_key = 'am'"},
    "record_counts": {k: stats[k] for k in ("n_models", "n_taxa", "excluded_no_native", "n_unmatched",
                                              "n_no_common_name", "n_no_cog_005")},
    "registry_bytes": rbytes,
    "registry_index_bytes": index_bytes,
    "excluded_sp_keys": stats["excluded_sp_keys"],
    "thumbnail_species": THUMB_SPECIES if use_thumbnail else [],
    "rasters": "referenced, not copied: native COGs stay at marine-atlas/native/am/ on the public bucket",
  }
  stac.write_json(dest / "provenance.json", prov)
  return {"dest": dest, "stats": stats, "registry_bytes": rbytes, "index_bytes": index_bytes, "registry": reg}
