"""STAC 1.1 writers for the atlas catalog: collections, items and the root catalog (stac-sdm v1.0.0)."""

from __future__ import annotations

import datetime
import hashlib
import json
from pathlib import Path

from . import biotrack as bt

STAC_VERSION = "1.1.0"

EXT = {
  "sdm":        "https://marinesensitivity.github.io/stac-sdm/v1.0.0/schema.json",
  "scientific": "https://stac-extensions.github.io/scientific/v1.0.0/schema.json",
  "table":      "https://stac-extensions.github.io/table/v1.2.0/schema.json",
  "datacube":   "https://stac-extensions.github.io/datacube/v2.2.0/schema.json",
  "web_map":    "https://stac-extensions.github.io/web-map-links/v1.3.0/schema.json",
  "contacts":   "https://stac-extensions.github.io/contacts/v0.1.1/schema.json",
  "version":    "https://stac-extensions.github.io/version/v1.2.0/schema.json",
  "file":       "https://stac-extensions.github.io/file/v2.1.0/schema.json",
  "portolan":   "https://schemas.portolan-sdi.org/portolan/v0.2.0/schema.json",
}
SOURCE_URL = "https://marinebon.org/"   # producer's public page; the raw files came from T. Couto by Google Drive

# ---- credits (placeholders pending Neil Hammerschlag's confirmation) ----

LICENSE_PLACEHOLDER = "CC-BY-4.0"
CITATION = ("Couto, T.B.A., Hammerschlag, N., et al. (in prep). Multi-species biodiversity indicators from "
            "integrated occupancy models of acoustic telemetry and OBIS records, US Atlantic and Gulf of Mexico. "
            "MBON BioTrack.")
FUNDERS = ["NOAA IOOS MBON", "BOEM"]
VERSION = "2025.05"
OBS_START, OBS_END = "2000-01-01T00:00:00Z", "2023-12-31T23:59:59Z"

CONTACTS = [
  {"name": "Neil Hammerschlag", "organization": "Shark Research Foundation / MBON BioTrack",
   "position": "Principal investigator",
   "emails": [{"value": "neilhammerschlag@gmail.com"}], "roles": ["principal investigator"]},
  {"name": "Thiago B. A. Couto", "organization": "Lancaster University",
   "position": "Author",
   "emails": [{"value": "couto.thiagoba@gmail.com"}], "roles": ["author"]},
]
PROVIDERS = [
  {"name": "MBON BioTrack", "roles": ["producer"], "url": "https://marinebon.org/"},
  {"name": "OceanMetrics", "roles": ["processor", "host"], "url": "https://oceanmetrics.io"},
]

PREDICTORS = ["depth", "sea surface temperature", "chlorophyll", "total suspended matter", "sea surface height"]

INDICATOR_METHOD = (
  "Derived merge of per-species integrated spatial occupancy models (spOccupancy, acoustic telemetry + OBIS "
  "records) over 66 species in 27,841 10-km hexagonal cells, per season (summer = May-Aug, winter = Nov-Feb). "
  "Richness = sum of per-species occupancy probabilities in a cell; ecoregion-weighted richness (the public "
  "richness metric) = cell richness divided by the maximum mean richness of its ecoregion (11 ecoregions). "
  "Cumulative uncertainty = sum of per-species standard deviations, scaled and ecoregion-weighted likewise "
  "(the public uncertainty metric). Groups: all, fish, ray, redlisted, shark, turtle.")
SPECIES_METHOD = "integrated spatial occupancy model, spOccupancy"

GROUP_TITLES = {"all": "all species", "fish": "fish", "ray": "rays", "redlisted": "red-listed species",
                "shark": "sharks", "turtle": "turtles"}

PARQUET = "application/vnd.apache.parquet"
PMTILES = "application/vnd.pmtiles"
JSON_T  = "application/json"
STYLE_T = "application/vnd.mapbox.style+json"
MD_T    = "text/markdown"


# ---- helpers ----

def write_json(path: Path, obj: dict) -> None:
  path = Path(path)
  path.parent.mkdir(parents=True, exist_ok=True)
  path.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n")


def bbox_polygon(bbox: list[float]) -> dict:
  w, s, e, n = bbox
  return {"type": "Polygon", "coordinates": [[[w, s], [e, s], [e, n], [w, n], [w, s]]]}


def table_columns(df) -> list[dict]:
  """table:columns from a pandas frame (dtype -> parquet-ish type)."""
  def typ(dt):
    k = str(dt)
    if k.startswith("int"):
      return k
    if k.startswith("float"):
      return k
    return "string"
  return [{"name": c, "type": typ(t)} for c, t in df.dtypes.items()]


def indicator_column_description(col: str) -> str:
  group, season, suffix = col.split("_", 2)
  return f"{bt.SUFFIX_DESCRIPTION[suffix]}; group {group}, season {season}"


def indicator_table_columns(values_columns: list[str], dtypes: dict[str, str]) -> list[dict]:
  cols = [{"name": "FID", "type": "int64", "description": "hexagonal cell id (join key to hex.pmtiles feature id)"}]
  for c in values_columns:
    cols.append({"name": c, "type": dtypes.get(c, "double"), "description": indicator_column_description(c)})
  return cols


def _credits() -> dict:
  return {
    "license": LICENSE_PLACEHOLDER,
    "sci:citation": CITATION,
    "contacts": CONTACTS,
    "providers": PROVIDERS,
    "atlas:funders": FUNDERS,
  }


# ---- biotrack_indicators ----

def indicators_collection(bbox: list[float], values_columns: list[str], dtypes: dict[str, str],
                          values_h3_columns: list[str], n_hex: int, n_h3: int, hex_info: dict) -> dict:
  """Collection for the public indicator products: hex + values + h3 twins."""
  hex_asset = {
    "href": "./hex.pmtiles", "type": PMTILES, "roles": ["data"],
    "title": "10 km hexagon grid (geometry + FID only)",
    "pmtiles:layers": ["hex"], "atlas:id_field": "FID",
    "pmtiles:min_zoom": 0, "pmtiles:max_zoom": 10, "file:size": hex_info.get("bytes"),
  }
  hex_asset = {k: v for k, v in hex_asset.items() if v is not None}
  return {
    "type": "Collection",
    "stac_version": STAC_VERSION,
    "stac_extensions": [EXT["sdm"], EXT["scientific"], EXT["table"], EXT["datacube"], EXT["web_map"],
                        EXT["contacts"], EXT["version"], EXT["file"], EXT["portolan"]],
    "id": "biotrack_indicators",
    "updated": now_rfc3339(),
    "title": "MBON BioTrack biodiversity indicators",
    "description": (
      "Ecoregion-weighted species richness and cumulative uncertainty for the US Atlantic and Gulf of Mexico, "
      "for all species, fish, rays, red-listed species, sharks and turtles in summer and winter, in "
      f"{n_hex:,} 10-km hexagonal cells. Derived from integrated spatial occupancy models of acoustic "
      "telemetry (A-BioTrack) and OBIS records for 66 species (Couto, Hammerschlag et al.). Methods and "
      "field dictionary: README.md."),
    "license": LICENSE_PLACEHOLDER,
    "version": VERSION,
    "deprecated": False,
    "sci:citation": CITATION,
    "contacts": CONTACTS,
    "providers": PROVIDERS,
    "atlas:funders": FUNDERS,
    "atlas:status": "prototype",
    "extent": {
      "spatial": {"bbox": [bbox]},
      "temporal": {"interval": [[OBS_START, OBS_END]]},
    },
    "sdm:response_type": "mixed",
    "sdm:method": "derived_merge",
    "sdm:method_detail": INDICATOR_METHOD,
    "sdm:source_authority": "MBON BioTrack",
    "sdm:temporal_interval": "seasonal",
    "sdm:climatological": True,
    "sdm:predictors": PREDICTORS,
    "cube:dimensions": {
      "group":  {"type": "other", "description": "species group", "values": bt.GROUPS},
      "season": {"type": "other", "description": "season (summer = May-Aug, winter = Nov-Feb)", "values": bt.SEASONS},
      "metric": {"type": "other", "description": "indicator metric", "values": bt.METRICS},
    },
    "summaries": {
      "group": bt.GROUPS, "season": bt.SEASONS, "metric": bt.METRICS,
      "sdm:season": bt.SEASONS, "sdm:response_type": ["mixed"],
    },
    "assets": {
      "hex": hex_asset,
      "values": {
        "href": "./values.parquet", "type": PARQUET, "roles": ["data"],
        "title": "Indicator values, one row per FID, one column per group x season x field",
        "atlas:key_column": "FID", "table:row_count": n_hex,
        "table:columns": indicator_table_columns(values_columns, dtypes),
      },
      "hex_h3": {
        "href": "./hex_h3.parquet", "type": PARQUET, "roles": ["data"],
        "title": "FID to H3 (res 7) area-weight crosswalk",
        "sdm:h3_resolution": bt_h3_res(),
        "table:columns": [
          {"name": "FID", "type": "int64", "description": "hexagonal cell id"},
          {"name": "h3", "type": "string", "description": "H3 cell index"},
          {"name": "weight", "type": "double", "description": "share of the hexagon's area inside the H3 cell; sums to 1 per FID"},
          {"name": "overlap_km2", "type": "double", "description": "intersection area in km2 (equal-area projection)"},
        ],
      },
      "values_h3": {
        "href": "./values_h3.parquet", "type": PARQUET, "roles": ["data"],
        "title": "Indicator values aggregated to H3 res 7 (area-weighted mean)",
        "atlas:key_column": "h3", "sdm:h3_resolution": bt_h3_res(), "table:row_count": n_h3,
        "table:columns": [{"name": "h3", "type": "string", "description": "H3 cell index"}] + [
          {"name": c, "type": "double", "description": indicator_column_description(c)} for c in values_h3_columns],
      },
      "style": {
        "href": "./styles/default.json", "type": STYLE_T, "roles": ["style"],
        "title": "MapLibre fill layer, Spectral reversed on feature-state value (0..1)",
      },
    },
    "links": [
      {"rel": "root",   "href": "../catalog.json", "type": JSON_T, "title": "OceanMetrics Atlas"},
      {"rel": "parent", "href": "../catalog.json", "type": JSON_T, "title": "OceanMetrics Atlas"},
      {"rel": "self",   "href": "./collection.json", "type": JSON_T},
      *[{"rel": "item", "href": f"./items/{i}.json", "type": "application/geo+json", "title": indicator_item_title(*i.split("_"))}
        for i in indicator_item_ids()],
      {"rel": "describedby", "href": "./README.md", "type": MD_T, "title": "Methods, field dictionary and credits"},
      {"rel": "agents", "href": "./AGENTS.md", "type": MD_T, "title": "Agent/LLM usage guide"},
      {"rel": "pmtiles", "href": "./hex.pmtiles", "type": PMTILES, "pmtiles:layers": ["hex"]},
      {"rel": "via", "href": SOURCE_URL, "type": "text/html", "title": "MBON BioTrack (producer)"},
      {"rel": "license", "href": "https://creativecommons.org/licenses/by/4.0/", "type": "text/html",
       "title": "CC-BY-4.0 (placeholder, pending confirmation from the data owners)"},
    ],
  }


def now_rfc3339() -> str:
  return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def indicator_item_title(group: str, season: str, metric: str) -> str:
  return f"{metric.capitalize()} of {GROUP_TITLES[group]}, {season}"


def bt_h3_res() -> int:
  from .grid import H3_RES
  return H3_RES


def indicator_item_ids() -> list[str]:
  return [f"{g}_{s}_{m}" for g in bt.GROUPS for s in bt.SEASONS for m in bt.METRICS]


def indicator_items(bbox: list[float], value_ranges: dict[str, tuple[float, float]]) -> dict[str, dict]:
  """24 Items {group}_{season}_{metric}; value_ranges maps column name -> observed (min, max)."""
  items = {}
  for g in bt.GROUPS:
    for s in bt.SEASONS:
      for m in bt.METRICS:
        iid, col = f"{g}_{s}_{m}", bt.column_name(g, s, m)
        lo, hi = value_ranges[col]
        items[iid] = {
          "type": "Feature",
          "stac_version": STAC_VERSION,
          "stac_extensions": [EXT["sdm"], EXT["table"]],
          "id": iid,
          "bbox": bbox,
          "geometry": bbox_polygon(bbox),
          "properties": {
            "title": indicator_item_title(g, s, m),
            "description": (f"Ecoregion-weighted {m} (0-1) for {GROUP_TITLES[g]} in {s} "
                            f"({'warm, May-Aug' if s == 'summer' else 'cold, Nov-Feb'}), per 10-km hexagon."),
            "datetime": None,
            "start_datetime": OBS_START,
            "end_datetime": OBS_END,
            "atlas:dims": {"group": g, "season": s, "metric": m},
            "atlas:metric": m,
            "atlas:value_range": [float(lo), float(hi)],
            "sdm:response_type": "mixed",
            "sdm:method": "derived_merge",
            "sdm:method_detail": INDICATOR_METHOD,
            "sdm:source_authority": "MBON BioTrack",
            "sdm:temporal_interval": "seasonal",
            "sdm:climatological": True,
            "sdm:season": s,
            "sdm:value_unit": "unitless",
            "sdm:value_range": [0, 1],
            "sdm:predictors": PREDICTORS,
          },
          "links": [
            {"rel": "root",       "href": "../../catalog.json", "type": JSON_T},
            {"rel": "parent",     "href": "../collection.json", "type": JSON_T},
            {"rel": "collection", "href": "../collection.json", "type": JSON_T},
            {"rel": "self",       "href": f"./{iid}.json", "type": "application/geo+json"},
          ],
          "assets": {
            "values": {
              "href": "../values.parquet", "type": PARQUET, "roles": ["data"],
              "title": f"{col} by FID", "atlas:key_column": "FID", "atlas:value_column": col,
              "table:columns": [{"name": "FID", "type": "int64"}, {"name": col, "type": "double"}],
            },
            "h3": {
              "href": "../values_h3.parquet", "type": PARQUET, "roles": ["data"],
              "title": f"{col} by H3 res 7 cell", "atlas:key_column": "h3", "atlas:value_column": col,
              "sdm:h3_resolution": bt_h3_res(),
              "table:columns": [{"name": "h3", "type": "string"}, {"name": col, "type": "double"}],
            },
            "hex": {
              "href": "../hex.pmtiles", "type": PMTILES, "roles": ["data"], "title": "10 km hexagon grid",
              "pmtiles:layers": ["hex"], "atlas:id_field": "FID",
            },
          },
          "collection": "biotrack_indicators",
        }
  return items


# ---- biotrack_species (restricted) ----

HEX_PUBLIC_HREF = "https://storage.oceanmetrics.io/atlas/biotrack_indicators/hex.pmtiles"


def species_collection(bbox: list[float], taxa_rows: list[dict], n_hex: int, cell_rows: int,
                       tables: dict[str, dict]) -> dict:
  """restricted collection: per-species probability and class surfaces; not linked from catalog.json."""
  names = sorted(t["scientific_name"] for t in taxa_rows)
  assets = {
    "hex": {"href": HEX_PUBLIC_HREF, "type": PMTILES, "roles": ["data"], "title": "10 km hexagon grid",
            "pmtiles:layers": ["hex"], "atlas:id_field": "FID"},
    "style": {"href": HEX_PUBLIC_HREF.replace("hex.pmtiles", "styles/default.json"), "type": STYLE_T, "roles": ["style"],
              "title": "MapLibre fill layer shared with biotrack_indicators"},
    "species": {"href": "./species.parquet", "type": PARQUET, "roles": ["metadata"],
                "title": "species lookup (AphiaID, names, IUCN, groups, WoRMS match status)"},
    "cell_species": {"href": "./cell_species.parquet", "type": PARQUET, "roles": ["data"],
                     "title": "long table of Likely / Very likely species per cell (FID, season, aphia_id, prob, class)",
                     "table:row_count": cell_rows,
                     "table:columns": [{"name": "FID", "type": "int32"}, {"name": "season", "type": "string"},
                                       {"name": "aphia_id", "type": "int32"}, {"name": "prob", "type": "float"},
                                       {"name": "class", "type": "string"}]},
  }
  for key, info in tables.items():
    assets[key] = {"href": f"./{key}.parquet", "type": PARQUET, "roles": ["data"],
                   "title": info["title"], "atlas:key_column": "FID", "table:row_count": n_hex,
                   "table:columns": info["columns"]}
  return {
    "type": "Collection",
    "stac_version": STAC_VERSION,
    "stac_extensions": [EXT["sdm"], EXT["scientific"], EXT["table"], EXT["datacube"], EXT["web_map"],
                        EXT["contacts"], EXT["version"], EXT["file"], EXT["portolan"]],
    "id": "biotrack_species",
    "updated": now_rfc3339(),
    "title": "MBON BioTrack per-species occupancy (restricted)",
    "description": (
      "Per-species probability of occurrence and probability class (Unlikely / Likely 0.6-0.8 / Very likely "
      f"0.8-1.0) for 66 species in {n_hex:,} 10-km hexagonal cells, summer and winter. RESTRICTED: shared by "
      "unlisted link only, pending permission from Neil Hammerschlag; do not redistribute."),
    "license": LICENSE_PLACEHOLDER,
    "version": VERSION,
    "deprecated": False,
    "sci:citation": CITATION,
    "contacts": CONTACTS,
    "providers": PROVIDERS,
    "atlas:funders": FUNDERS,
    "atlas:status": "prototype",
    "atlas:access": "restricted",
    "extent": {"spatial": {"bbox": [bbox]}, "temporal": {"interval": [[OBS_START, OBS_END]]}},
    "sdm:response_type": "probability",
    "sdm:method": "occupancy_model",
    "sdm:method_detail": SPECIES_METHOD,
    "sdm:source_authority": "MBON BioTrack",
    "sdm:temporal_interval": "seasonal",
    "sdm:climatological": True,
    "sdm:predictors": PREDICTORS,
    "cube:dimensions": {
      "taxon":  {"type": "other", "description": "species (accepted WoRMS name)", "values": names},
      "season": {"type": "other", "description": "season (summer = May-Aug, winter = Nov-Feb)", "values": bt.SEASONS},
    },
    "summaries": {"season": bt.SEASONS, "sdm:season": bt.SEASONS, "sdm:response_type": ["probability"]},
    "assets": assets,
    "links": [
      {"rel": "root", "href": "./collection.json", "type": JSON_T},
      {"rel": "self", "href": "./collection.json", "type": JSON_T},
      *[{"rel": "item", "href": f"./items/{t['aphia_id']}_{s}.json", "type": "application/geo+json",
         "title": f"{t['scientific_name']}, {s}"} for t in taxa_rows for s in bt.SEASONS],
      {"rel": "describedby", "href": "./README.md", "type": MD_T, "title": "Methods and access notes"},
      {"rel": "agents", "href": "./AGENTS.md", "type": MD_T, "title": "Agent/LLM usage guide"},
      {"rel": "pmtiles", "href": HEX_PUBLIC_HREF, "type": PMTILES, "pmtiles:layers": ["hex"]},
      {"rel": "via", "href": SOURCE_URL, "type": "text/html", "title": "MBON BioTrack (producer)"},
      {"rel": "license", "href": "https://creativecommons.org/licenses/by/4.0/", "type": "text/html",
       "title": "CC-BY-4.0 (placeholder, pending confirmation from the data owners)"},
    ],
  }


def species_items(bbox: list[float], taxa_rows: list[dict], value_ranges: dict[tuple[int, str], tuple[float, float]]) -> dict[str, dict]:
  """132 Items {aphia_id}_{season}, one per species and season."""
  items = {}
  for t in taxa_rows:
    aid, name = int(t["aphia_id"]), t["scientific_name"]
    col = f"aphia_{aid}"
    for s in bt.SEASONS:
      iid = f"{aid}_{s}"
      lo, hi = value_ranges[(aid, s)]
      taxon = {"scientific_name": name, "authorities": {"worms": aid}, "group": str(t["group2"]).lower()}
      if t.get("iucn_code"):
        taxon["redlist_code"] = t["iucn_code"]   # no IUCN taxon id in the source sheet: authorities.iucn omitted
      items[iid] = {
        "type": "Feature",
        "stac_version": STAC_VERSION,
        "stac_extensions": [EXT["sdm"], EXT["table"]],
        "id": iid,
        "bbox": bbox,
        "geometry": bbox_polygon(bbox),
        "properties": {
          "title": f"Probability of occurrence of {name}, {s}",
          "datetime": None, "start_datetime": OBS_START, "end_datetime": OBS_END,
          "atlas:dims": {"taxon": name, "season": s},
          "atlas:group_fine": t.get("group1"),
          "atlas:value_range": [float(lo), float(hi)],
          "sdm:response_type": "probability",
          "sdm:method": "occupancy_model",
          "sdm:method_detail": SPECIES_METHOD,
          "sdm:source_authority": "MBON BioTrack",
          "sdm:temporal_interval": "seasonal",
          "sdm:climatological": True,
          "sdm:season": s,
          "sdm:value_unit": "probability",
          "sdm:value_range": [0, 1],
          "sdm:taxon": taxon,
        },
        "links": [
          {"rel": "root",       "href": "../collection.json", "type": JSON_T},
          {"rel": "parent",     "href": "../collection.json", "type": JSON_T},
          {"rel": "collection", "href": "../collection.json", "type": JSON_T},
          {"rel": "self",       "href": f"./{iid}.json", "type": "application/geo+json"},
        ],
        "assets": {
          "prob": {"href": f"../prob_{s}.parquet", "type": PARQUET, "roles": ["data"],
                   "title": f"probability of occurrence, {name}, {s}",
                   "atlas:key_column": "FID", "atlas:value_column": col,
                   "table:columns": [{"name": "FID", "type": "int64"}, {"name": col, "type": "double"}]},
          "class": {"href": f"../class_{s}.parquet", "type": PARQUET, "roles": ["data"],
                    "title": f"probability class, {name}, {s}",
                    "atlas:key_column": "FID", "atlas:value_column": col,
                    "table:columns": [{"name": "FID", "type": "int64"}, {"name": col, "type": "string"}]},
          "hex": {"href": HEX_PUBLIC_HREF, "type": PMTILES, "roles": ["data"], "title": "10 km hexagon grid",
                  "pmtiles:layers": ["hex"], "atlas:id_field": "FID"},
        },
        "collection": "biotrack_species",
      }
  return items


# ---- root catalog ----

def root_catalog(external_children: list[dict]) -> dict:
  """OceanMetrics Atlas root; the restricted species collection is deliberately absent."""
  return {
    "type": "Catalog",
    "stac_version": STAC_VERSION,
    "stac_extensions": [EXT["portolan"]],
    "id": "oceanmetrics-atlas",
    "updated": now_rfc3339(),
    "title": "OceanMetrics Atlas",
    "description": (
      "Maps of species distribution and biodiversity products: MBON BioTrack richness and uncertainty "
      "indicators, plus the MarineSensitivity SDM collections by reference. Supported by BOEM and the "
      "Marine Biodiversity Observation Network (MBON). Built by OceanMetrics."),
    "links": [
      {"rel": "root", "href": "./catalog.json", "type": JSON_T, "title": "OceanMetrics Atlas"},
      {"rel": "self", "href": "./catalog.json", "type": JSON_T},
      {"rel": "describedby", "href": "./README.md", "type": MD_T, "title": "Human-readable documentation"},
      {"rel": "agents", "href": "./AGENTS.md", "type": MD_T, "title": "Agent/LLM usage guide"},
      {"rel": "child", "href": "./biotrack_indicators/collection.json", "type": JSON_T,
       "title": "MBON BioTrack biodiversity indicators"},
      *[{"rel": "child", "href": c["href"], "type": JSON_T, "title": c["title"]} for c in external_children],
    ],
  }


EXTERNAL_CHILDREN = [
  {"href": "https://file.marinesensitivity.org/stac/v7/collection.json", "title": "MarineSensitivity SDMs v7"},
  {"href": "https://file.marinesensitivity.org/stac/v8/gm/collection.json", "title": "NOAA SEFSC (density)"},
  {"href": "https://file.marinesensitivity.org/stac/v8/nc/collection.json", "title": "NOAA NCCOS (density)"},
]


# ---- structural checks (offline) ----

REQUIRED_SDM = ["sdm:response_type", "sdm:method", "sdm:source_authority", "sdm:temporal_interval"]


def check_stac_required(obj: dict) -> list[str]:
  """returns problems: missing stac fields, sdm core fields, or missing extension url."""
  bad = []
  kind = obj.get("type")
  for k in ("type", "stac_version", "id", "links"):
    if k not in obj:
      bad.append(f"missing {k}")
  if kind == "Collection":
    for k in ("description", "license", "extent"):
      if k not in obj:
        bad.append(f"missing {k}")
    src = obj
  elif kind == "Feature":
    for k in ("geometry", "bbox", "properties", "assets"):
      if k not in obj:
        bad.append(f"missing {k}")
    src = obj.get("properties", {})
  else:
    return bad
  if kind == "Feature" or "sdm:response_type" in obj:
    bad += [f"missing {k}" for k in REQUIRED_SDM if k not in src]
    if EXT["sdm"] not in obj.get("stac_extensions", []):
      bad.append("stac-sdm extension not declared")
  return bad


# ---- file:size and file:checksum on local assets ----

def multihash_sha256(path: Path, cache: dict | None = None) -> str:
  """sha256 as a multihash hex string (0x12 0x20 prefix), as the file extension asks."""
  key = str(path)
  if cache is not None and key in cache:
    return cache[key]
  h = hashlib.sha256()
  with open(path, "rb") as f:
    while block := f.read(1 << 20):
      h.update(block)
  out = "1220" + h.hexdigest()
  if cache is not None:
    cache[key] = out
  return out


def add_file_info(obj: dict, base_dir: Path, cache: dict | None = None) -> dict:
  """add file:size and file:checksum to every asset whose href is a relative path that exists."""
  for a in obj.get("assets", {}).values():
    if a["href"].startswith("http"):
      continue
    p = (Path(base_dir) / a["href"]).resolve()
    if p.exists():
      a["file:size"] = p.stat().st_size
      a["file:checksum"] = multihash_sha256(p, cache)
  if any("file:size" in a for a in obj.get("assets", {}).values()) and EXT["file"] not in obj["stac_extensions"]:
    obj["stac_extensions"].append(EXT["file"])
  return obj
