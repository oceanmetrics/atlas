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
  "raster":     "https://stac-extensions.github.io/raster/v1.1.0/schema.json",
}
SOURCE_URL = "https://marinebon.org/"   # producer's public page; the raw files came from T. Couto by Google Drive

# ---- credits (citation and contacts from T. Couto 2026-10-16; license and funders pending Neil Hammerschlag) ----

LICENSE_PLACEHOLDER = "CC-BY-4.0"
CITATION = ("Couto, T. B. A., Zulian, V., D'Antonio, B., ... & Hammerschlag, N. (under review). Unlocking the "
            "potential of acoustic telemetry to scale up marine biodiversity assessment. Frontiers in Ecology and "
            "the Environment.")
# full author list (T. Couto, 2026-10-16); the short form above is the one he suggested for the collection
CITATION_FULL = (
  "Couto, T. B. A., Zulian, V., D'Antonio, B., Ajemian, M., Aoki, D. M., Bopp, J., Buckel, J. A., Brundage, H. M. "
  "III, Cook, G. S., Dance, M. A., Doser, J., Drymon, J. M., Dureuil, M., Ellis, R. D., Fox, A. G., Fuentes, "
  "M. M. P. B., Gahagan, B., Gallagher, A. J., Gallagher, R. M., Gibson-Banks, K., Grothues, T. M., Guertin, "
  "J. R., Guttridge, T. L., Hale, E. A., Harborne, A. R., Heim, V., Hilton, E. J., Hoffman, W. S., Ingram, E. C., "
  "Lidgard, D., Lowerre-Barbieri, S. K., Massie, J. A., McGarigal, C., McGrath, P. E., Morley, D., "
  "Muller-Karger, F. E., Naisbett-Jones, L. C., Ogburn, M. B., O'Donnell, P. M., Otis, D., Papastamatiou, Y., "
  "Pate, J. H., Perrault, J. R., Powers, S., Price, C. S., Pye, J. D., Rehage, J. S., Rider, M. J., Rooker, J. R., "
  "Roday, R. E., Rudershausen, P. J., Sasso, C. R., Savoy, T., Murray, T., Shillinger, G. L., Smukall, M. J., "
  "Streich, M. K., Stunz, G. W., TinHan, T. C., van Zinnicq Bergmann, M., Wells, R. J. D., Whoriskey, F. G., "
  "Wunder, C., Young, J., & Hammerschlag, N. (under review). Unlocking the potential of acoustic telemetry to "
  "scale up marine biodiversity assessment. Frontiers in Ecology and the Environment.")
FUNDERS = ["NOAA IOOS MBON"]
VERSION = "2025.05"
OBS_START, OBS_END = "2000-01-01T00:00:00Z", "2023-12-31T23:59:59Z"

CONTACTS = [
  {"name": "Neil Hammerschlag", "organization": "Shark Research Foundation / MBON BioTrack",
   "position": "Principal investigator",
   "emails": [{"value": "drneilhammer@sharkresearch.org"}], "roles": ["principal investigator"]},
  {"name": "Thiago B. A. Couto", "organization": "University of East Anglia",
   "position": "Author",
   "emails": [{"value": "t.couto@uea.ac.uk"}], "roles": ["author"]},
  {"name": "Viviane Zulian", "organization": "Universidade Federal de Santa Catarina",
   "position": "Author",
   "emails": [{"value": "zulian.vi@gmail.com"}], "roles": ["author"]},
]
PROVIDERS = [
  {"name": "MBON BioTrack", "roles": ["producer"], "url": "https://marinebon.org/"},
  {"name": "OceanMetrics", "roles": ["processor", "host"], "url": "https://oceanmetrics.io"},
]

PREDICTORS = ["depth", "sea surface temperature", "chlorophyll", "total suspended matter", "sea surface height"]

INDICATOR_METHOD = (
  "Derived merge of per-species integrated spatial occupancy models (spOccupancy, acoustic telemetry + OBIS "
  "records) over 66 species in 27,841 10-km hexagonal cells, per season (summer = May-Aug, winter = Nov-Feb). "
  "Richness = sum of the latent occupancy states (z) across species in a cell, averaged over 1,000 retained "
  "model iterations; ecoregion-weighted richness (the public "
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
PNG_T   = "image/png"


def thumbnail_asset(title: str) -> dict:
  """thumbnail.png next to collection.json; add_file_info fills file:size and file:checksum when the file exists."""
  return {"href": "./thumbnail.png", "type": PNG_T, "roles": ["thumbnail"], "title": title}


PREVIEW_LINK = {"rel": "preview", "href": "./thumbnail.png", "type": PNG_T, "title": "Thumbnail"}


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


def cell_species_table_columns() -> list[dict]:
  return [
    {"name": "FID", "type": "int32", "description": "hexagonal cell id (join key to hex.pmtiles feature id and values.parquet)"},
    {"name": "season", "type": "string", "description": "summer (May-Aug) or winter (Nov-Feb)"},
    {"name": "aphia_id", "type": "int32", "description": "accepted WoRMS AphiaID (join key to species.parquet)"},
    {"name": "prob", "type": "float", "description": "probability of occurrence, 0.6 or more"},
    {"name": "class", "type": "string", "description": "probability class: Likely (0.6-0.8) or Very likely (0.8-1.0)"},
  ]


def species_table_columns() -> list[dict]:
  return [
    {"name": "aphia_id", "type": "int32", "description": "accepted WoRMS AphiaID"},
    {"name": "scientific_name", "type": "string", "description": "accepted WoRMS scientific name"},
    {"name": "abbreviation", "type": "string", "description": "six-letter code used in the producer's tables"},
    {"name": "iucn_code", "type": "string", "description": "IUCN Red List category code (LC, NT, VU, EN, CR, DD, ...)"},
    {"name": "redlisted", "type": "bool", "description": "true when the species is in the red-listed group"},
    {"name": "group1", "type": "string", "description": "detailed group (Reef fish, Game fish, Shark, Ray, Turtle, ...)"},
    {"name": "group2", "type": "string", "description": "coarse group: Fish, Ray, Shark, Turtle, Seal or Invertebrate; lowercased it equals the cube dimension group (all and redlisted are not groups of their own)"},
    {"name": "common_name", "type": "string", "description": "English vernacular name from WoRMS (AphiaVernacularsByAphiaID); blank when none"},
  ]


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
                          values_h3_columns: list[str], n_hex: int, n_h3: int, hex_info: dict,
                          species_rows: dict[str, int] | None = None) -> dict:
  """Collection for the public indicator products: hex + values + h3 twins + the public species list
  (`species_rows` = {"cell_species": n, "species": n}; omitted when the list was not built)."""
  hex_asset = {
    "href": "./hex.pmtiles", "type": PMTILES, "roles": ["data"],
    "title": "10 km hexagon grid (geometry + FID only)",
    "pmtiles:layers": ["hex"], "atlas:id_field": "FID",
    "pmtiles:min_zoom": 0, "pmtiles:max_zoom": 10, "file:size": hex_info.get("bytes"),
  }
  hex_asset = {k: v for k, v in hex_asset.items() if v is not None}
  species_assets = {}
  if species_rows:
    species_assets = {
      "cell_species": {
        "href": "./cell_species.parquet", "type": PARQUET, "roles": ["metadata"],
        "title": "Likely and Very likely species per cell and season (public species list for a clicked cell)",
        "atlas:key_column": "FID", "table:row_count": species_rows["cell_species"],
        "table:columns": cell_species_table_columns(),
      },
      "species": {
        "href": "./species.parquet", "type": PARQUET, "roles": ["metadata"],
        "title": "species lookup: AphiaID, scientific and English common name, IUCN code, groups",
        "atlas:key_column": "aphia_id", "table:row_count": species_rows["species"],
        "table:columns": species_table_columns(),
      },
    }
  return {
    "type": "Collection",
    "stac_version": STAC_VERSION,
    "stac_extensions": [EXT["sdm"], EXT["scientific"], EXT["table"], EXT["datacube"], EXT["web_map"],
                        EXT["contacts"], EXT["version"], EXT["file"], EXT["portolan"]],
    "id": "biotrack_indicators",
    "updated": now_rfc3339(),
    "title": "MBON BioTrack biodiversity indicators",
    "description": (
      "Ecoregion-weighted species richness and cumulative uncertainty for the US Atlantic, the Gulf of Mexico and the Caribbean, "
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
      "hex_centroids": {
        "href": "./hex_centroids.parquet", "type": PARQUET, "roles": ["data"],
        "title": "Hexagon centroids (FID, lon, lat) for point-in-polygon summaries",
        "atlas:key_column": "FID", "table:row_count": n_hex,
        "table:columns": [
          {"name": "FID", "type": "int64", "description": "hexagonal cell id (join key to hex.pmtiles feature id)"},
          {"name": "lon", "type": "double", "description": "centroid longitude, EPSG:4326"},
          {"name": "lat", "type": "double", "description": "centroid latitude, EPSG:4326"},
        ],
      },
      "values_h3": {
        "href": "./values_h3.parquet", "type": PARQUET, "roles": ["data"],
        "title": "Indicator values aggregated to H3 res 7 (area-weighted mean)",
        "atlas:key_column": "h3", "sdm:h3_resolution": bt_h3_res(), "table:row_count": n_h3,
        "table:columns": [{"name": "h3", "type": "string", "description": "H3 cell index"}] + [
          {"name": c, "type": "double", "description": indicator_column_description(c)} for c in values_h3_columns],
      },
      **species_assets,
      "thumbnail": thumbnail_asset("Thumbnail: ecoregion-weighted species richness, all species, summer"),
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
      PREVIEW_LINK,
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
  assets["thumbnail"] = thumbnail_asset("Thumbnail: 2x2 panel of four species probability surfaces, summer")
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
      PREVIEW_LINK,
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


# ---- swfsc_cce_becker2020b (restricted) ----
# NOAA SWFSC habitat-based cetacean density models for the California Current (Becker et al. 2020), as delivered
# (animals per km2) and area-weighted onto the 0.05 degree global grid by oceanmetrics/workflows ingest_swfsc_cce.qmd.
# Shared by an unlisted link for provider and BOEM/MMA review: its OWN unlisted prefix
# (pipeline/restricted_prefix_swfsc_cce.txt, git-ignored), never biotrack's, and never linked from catalog.json.

CCE_ID = "swfsc_cce_becker2020b"
CCE_INPORT = "https://www.fisheries.noaa.gov/inport/item/64349"
CCE_DOI = "10.25923/3znq-yx13"
CCE_ARCGIS = "https://noaa.maps.arcgis.com/home/item.html?id=566b4ad31f1d40eeb65b8cf3a4f087ca"
CCE_REPORT = "https://repository.library.noaa.gov/view/noaa/27826"
# InPort 64349 "Data Set Credit" (checked 2026-10-22), in the atlas' citation style
CCE_CITATION = (
  "Becker, E. A., Forney, K. A., Miller, D. L., Fiedler, P. C., Barlow, J., & Moore, J. E. (2020). Habitat-based "
  "density estimates for cetaceans in the California Current Ecosystem based on 1991-2018 survey data. U.S. "
  "Department of Commerce, NOAA Technical Memorandum NMFS-SWFSC-638. https://doi.org/10.25923/3znq-yx13")
# InPort 64349 "Use Constraints" / "Data Use Constraints", verbatim (the ArcGIS item's licenseInfo is the same text).
# InPort states no license; NOAA Fisheries publishes the product.
CCE_USE_CONSTRAINTS = (
  '*** No Warranty*** The user assumes the entire risk related to its use of these data. NMFS is providing these '
  'data "as is," and NMFS disclaims any and all warranties, whether express or implied, including (without '
  'limitation) any implied warranties of merchantability or fitness for a particular purpose. No warranty expressed '
  'or implied is made regarding the accuracy or utility of the data on any other system or for general or '
  'scientific purposes, nor shall the act of distribution constitute any such warranty. It is strongly recommended '
  'that careful attention be paid to the contents of the metadata file associated with these data to evaluate '
  'dataset limitations, restrictions or intended use. In no event will NMFS be liable to you or to any third party '
  'for any direct, indirect, incidental, consequential, special or exemplary damages or lost profit resulting from '
  'any use or misuse of these data.')
CCE_LICENSE = "other"
CCE_NOTE = (
  "Under review: shared by link for provider and BOEM/MMA review; not for distribution. Density as delivered "
  "(animals per km²), area-weighted onto a 0.05° grid by Ocean Metrics for the Marine Sensitivity Toolkit; not "
  "yet used in any score.")
# no email is shown for anyone (the collection is shared by link)
CCE_CONTACTS = [
  {"name": "Elizabeth A. Becker", "organization": "NOAA Southwest Fisheries Science Center",
   "position": "Lead author, NOAA-TM-NMFS-SWFSC-638", "roles": ["principal investigator"]},
]
CCE_PROVIDERS = [
  {"name": "NOAA Southwest Fisheries Science Center (SWFSC)", "roles": ["producer"],
   "url": "https://www.fisheries.noaa.gov/about/southwest-fisheries-science-center",
   "description": "habitat-based density models, Becker et al. 2020 (NOAA-TM-NMFS-SWFSC-638)"},
  {"name": "NOAA Fisheries Office of Science and Technology", "roles": ["host"], "url": CCE_INPORT,
   "description": "distributor of the delivered file geodatabase (InPort 64349)"},
  {"name": "Ocean Metrics", "roles": ["processor", "host"], "url": "https://oceanmetrics.io",
   "description": "area-weighted onto the 0.05 degree grid of the Marine Sensitivity Toolkit"},
]
CCE_START, CCE_END = "1991-07-01T00:00:00Z", "2018-11-30T23:59:59Z"
CCE_SEASON = "summer-fall"
CCE_SEASON_LABEL = "Summer-Fall (July-November)"
CCE_METHOD_DETAIL = (
  "Habitat-based density models (generalized additive models of line-transect sightings, with segment-specific "
  "detection probability and dynamic covariates from an ocean model calibrated to the California Current "
  "Ecosystem) fit to NOAA SWFSC ship surveys 1991-2018 (Becker et al. 2020); Summer-Fall (July-November) density "
  "in animals per km2 and its coefficient of variation, as delivered, area-weighted onto the 0.05 degree global "
  "grid by Ocean Metrics.")
CCE_VARIABLES = ["density", "cv"]
CCE_VARIABLE_LABELS = {"density": "Density (animals per km²)", "cv": "Coefficient of variation"}
CCE_UNITS = {"density": "animals/km2", "cv": "unitless"}
CCE_BIDX = {"density": 1, "cv": 2}
# density: a FIXED [0, p98] per species, p98 = models.csv density_p98 (the ingest's 98th percentile of the band) to 3
# significant figures, so the legend reads 0 -> p98 and the app makes no /cog/statistics read for the range. ("auto"
# drew [min, p98] and sent the minimum, e.g. 1.85e-14, as titiler's histogram_range, whose pattern rejects a negative
# exponent: 422, no legend histogram for 7 of 13 species.) cv: a fixed 0-2 so species compare (the delivered cv's
# 98th percentile runs 0.26 to 3.96 across the 13 species; a cv of 1 is a standard error as large as the density,
# above 2 draws at the top colour).
CCE_CV_RESCALE = [0, 2]


def cce_density_rescale(row: dict) -> list[float]:
  """[0, p98] to 3 significant figures (density_max when p98 is not positive); never an exponent below 1e-6, which
  the app would send to titiler as a negative-exponent histogram_range."""
  hi = float(row["density_p98"])
  if not hi > 0:
    hi = float(row["density_max"])
  if not hi > 0:
    raise ValueError(f"{row.get('species')}: density_p98 and density_max are not positive")
  hi = float(f"{hi:.3g}")
  if hi < 1e-6:
    raise ValueError(f"{row.get('species')}: p98 {hi} is below 1e-6 (an exponent in the app's histogram request)")
  return [0, hi]
CCE_COLORMAP = {"density": "viridis", "cv": "magma"}
COG_T = "image/tiff; application=geotiff; profile=cloud-optimized"
S3_PATH_STYLE = "https://s3.us-east-1.amazonaws.com"


def restricted_base_url(prefix: str, coll_id: str, bucket: str = "oceanmetrics.io-public") -> str:
  """the absolute, path-style S3 URL of a restricted collection's folder (titiler reads it; the storage host's
  302 lacks CORS); ends with '/'."""
  if not prefix or "/" in prefix:
    raise ValueError(f"bad restricted prefix {prefix!r}")
  return f"{S3_PATH_STYLE}/{bucket}/atlas-restricted/{prefix}/{coll_id}/"


def cce_label(row: dict) -> str:
  """"Humpback whale (Megaptera novaeangliae)"; a name WoRMS no longer accepts keeps its delivered name and adds the
  accepted one, the genus abbreviated when it is the same: "Long-beaked common dolphin (Delphinus capensis; WoRMS
  accepted: D. delphis)"."""
  sci, acc = row["scientific_name"], (row.get("scientific_name_accepted") or "").strip()
  if not acc or acc == sci:
    return f"{row['species']} ({sci})"
  g_sci, g_acc, *rest = sci.split()[:1] + acc.split()
  short = f"{g_acc[0]}. {' '.join(rest)}" if g_sci == g_acc and rest else acc
  return f"{row['species']} ({sci}; WoRMS accepted: {short})"


def cce_item_id(row: dict, variable: str) -> str:
  return f"{int(row['worms_id'])}_{variable}"


def _cce_bands(nodata) -> list[dict]:
  nd = {} if nodata is None else {"nodata": "nan" if nodata != nodata else nodata}
  return [
    {"name": "density", "description": "density, animals per km2", "data_type": "float32", "unit": "animals/km2", **nd},
    {"name": "cv", "description": "coefficient of variation of density", "data_type": "float32", "unit": "unitless", **nd},
  ]


def cce_collection(rows: list[dict], bbox: list[float], base_url: str, assets: dict | None = None) -> dict:
  """restricted collection: species x variable (density band 1, cv band 2) over the shared 2-band COGs of the
  delivered Summer-Fall models; not linked from catalog.json. `rows` are models.csv rows; `base_url` is
  restricted_base_url(...); `assets` adds collection assets (thumbnail, models.csv)."""
  ids = [str(int(r["worms_id"])) for r in rows]
  if len(set(ids)) != len(ids):
    raise ValueError("duplicate worms_id in models.csv")
  n = len(rows)
  return {
    "type": "Collection",
    "stac_version": STAC_VERSION,
    "stac_extensions": [EXT["sdm"], EXT["scientific"], EXT["datacube"], EXT["contacts"], EXT["raster"], EXT["file"]],
    "id": CCE_ID,
    "updated": now_rfc3339(),
    "title": "California Current cetacean density, SWFSC (Becker et al. 2020), under review",
    "description": (
      f"Habitat-based density models for {n} cetacean species in the California Current Ecosystem from NOAA SWFSC "
      "ship line-transect surveys 1991-2018 (Becker et al. 2020, NOAA-TM-NMFS-SWFSC-638). One season, Summer-Fall "
      "(July-November). Pick a species and a variable: density (animals per km2) or its coefficient of "
      "variation, both as delivered, area-weighted onto a 0.05 degree grid. UNDER REVIEW: shared by link for "
      "provider and BOEM/MMA review; not for distribution. Methods and credits: README.md."),
    "license": CCE_LICENSE,
    "deprecated": False,
    "sci:citation": CCE_CITATION,
    "sci:doi": CCE_DOI,
    "contacts": CCE_CONTACTS,
    "providers": CCE_PROVIDERS,
    "atlas:funders": [],
    "atlas:status": "under review",
    "atlas:access": "restricted",
    "atlas:note": CCE_NOTE,
    "atlas:use_constraints": CCE_USE_CONSTRAINTS,
    "extent": {"spatial": {"bbox": [bbox]}, "temporal": {"interval": [[CCE_START, CCE_END]]}},
    "sdm:response_type": "density",
    "sdm:method": "density_surface_model",
    "sdm:method_detail": CCE_METHOD_DETAIL,
    "sdm:source_authority": "NOAA SWFSC",
    "sdm:temporal_interval": "seasonal",
    "sdm:climatological": True,
    "cube:dimensions": {
      "species": {"type": "other", "title": "Species", "description": "species (WoRMS AphiaID; common and scientific name)",
                  "values": ids, "atlas:labels": {str(int(r["worms_id"])): cce_label(r) for r in rows},
                  "atlas:taxon_dim": True},
      "variable": {"type": "other", "title": "Variable", "description": "density (band 1) or its coefficient of variation (band 2)",
                   "values": CCE_VARIABLES, "atlas:labels": CCE_VARIABLE_LABELS},
    },
    "summaries": {"sdm:response_type": ["density"], "variable": CCE_VARIABLES, "atlas:season": [CCE_SEASON]},
    "assets": dict(assets or {}),
    "links": [
      {"rel": "root", "href": "./collection.json", "type": JSON_T},
      {"rel": "self", "href": "./collection.json", "type": JSON_T},
      *[{"rel": "item", "href": f"./items/{cce_item_id(r, v)}.json", "type": "application/geo+json",
         "title": f"{cce_label(r)} · {CCE_VARIABLE_LABELS[v]}"} for r in rows for v in CCE_VARIABLES],
      {"rel": "describedby", "href": "./README.md", "type": MD_T, "title": "Methods, review status and credits"},
      {"rel": "cite-as", "href": f"https://doi.org/{CCE_DOI}", "type": "text/html",
       "title": "Becker et al. 2020, NOAA-TM-NMFS-SWFSC-638"},
      {"rel": "via", "href": CCE_INPORT, "type": "text/html", "title": "InPort 64349 (NOAA Fisheries metadata)"},
      {"rel": "related", "href": CCE_ARCGIS, "type": "text/html", "title": "Delivered file geodatabase (ArcGIS Online)"},
      {"rel": "license", "href": CCE_INPORT, "type": "text/html",
       "title": "No license stated; NOAA Fisheries use constraints (No Warranty) on InPort 64349"},
    ],
  }


def cce_items(rows: list[dict], bbox: list[float] | dict[int, list[float]], base_url: str,
              nodata=None) -> dict[str, dict]:
  """2 Items per species ({worms_id}_density, {worms_id}_cv) over ONE 2-band COG each; hrefs are absolute under the
  restricted prefix (`base_url` + cog/<file>). `bbox` and `nodata` are one value for all, or {worms_id: value} (each
  COG's own data extent and nodata)."""
  items = {}
  for r in rows:
    wid = int(r["worms_id"])
    box = bbox[wid] if isinstance(bbox, dict) else bbox
    nd = nodata.get(wid) if isinstance(nodata, dict) else nodata
    href = f"{base_url}cog/{r['cog']}"
    taxon = {"scientific_name": r["scientific_name"], "common_name": r["species"], "authorities": {"worms": wid},
             "group": "mammal"}
    for v in CCE_VARIABLES:
      iid = cce_item_id(r, v)
      props = {
        "title": f"{cce_label(r)} · {CCE_VARIABLE_LABELS[v]}",
        "description": (f"{CCE_VARIABLE_LABELS[v]} of {r['species']} ({r['scientific_name']}), {CCE_SEASON_LABEL}, "
                        "California Current Ecosystem (Becker et al. 2020), on the 0.05 degree grid. Under review."),
        "datetime": None, "start_datetime": CCE_START, "end_datetime": CCE_END,
        "atlas:dims": {"species": str(wid), "variable": v},
        "atlas:season": CCE_SEASON,
        "atlas:mdl_key": r.get("mdl_key"),
        # the delivered WoRMS id is kept as the key; its accepted id when WoRMS no longer accepts it
        "atlas:worms_status": r.get("worms_status") or None,
        "atlas:worms_id_accepted": (int(float(r["worms_id_accepted"]))
                                    if str(r.get("worms_id_accepted") or "").strip()
                                    and int(float(r["worms_id_accepted"])) != wid else None),
        "atlas:scientific_name_accepted": (r.get("scientific_name_accepted")
                                           if r.get("scientific_name_accepted")
                                           and r.get("scientific_name_accepted") != r["scientific_name"] else None),
        "sdm:response_type": "density",
        "sdm:method": "density_surface_model",
        "sdm:method_detail": CCE_METHOD_DETAIL,
        "sdm:source_authority": "NOAA SWFSC",
        "sdm:temporal_interval": "seasonal",
        "sdm:climatological": True,
        "sdm:value_unit": CCE_UNITS[v],
        "sdm:taxon": taxon,
      }
      if v == "density":
        props |= {"sdm:value_range": [float(r["density_min"]), float(r["density_max"])],
                  "atlas:density_p98": float(r["density_p98"]), "atlas:n_cells": int(r["n_cells"])}
      else:
        props |= {"atlas:cv_median": float(r["cv_median"])}
      props = {k: x for k, x in props.items() if x is not None}
      items[iid] = {
        "type": "Feature",
        "stac_version": STAC_VERSION,
        "stac_extensions": [EXT["sdm"], EXT["raster"]],
        "id": iid,
        "bbox": box,
        "geometry": bbox_polygon(box),
        "properties": props,
        "links": [
          {"rel": "root",       "href": "../collection.json", "type": JSON_T},
          {"rel": "parent",     "href": "../collection.json", "type": JSON_T},
          {"rel": "collection", "href": "../collection.json", "type": JSON_T},
          {"rel": "self",       "href": f"./{iid}.json", "type": "application/geo+json"},
        ],
        "assets": {
          "cog": {"href": href, "type": COG_T, "roles": ["data"],
                  "title": f"{r['species']}, {CCE_VARIABLE_LABELS[v]} (band {CCE_BIDX[v]})",
                  "atlas:bidx": CCE_BIDX[v],
                  "atlas:rescale": cce_density_rescale(r) if v == "density" else CCE_CV_RESCALE,
                  "atlas:colormap": CCE_COLORMAP[v],
                  "raster:bands": _cce_bands(nd)},
        },
        "collection": CCE_ID,
      }
  return items


# ---- root catalog ----

# the AquaMaps EOV share product: staged and uploaded by oceanmetrics/workflows/aquamaps_eov.qmd; only the root
# catalog (this file's output) links it
EOV_TITLE = "AquaMaps EOV share"

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
      "Maps of species distribution and biodiversity products: the AquaMaps EOV share, MBON BioTrack richness and uncertainty "
      "indicators, AquaMaps habitat suitability (native 0.5 degree and global 0.05 degree), plus the MarineSensitivity SDM collections by reference. Supported by the Marine Minerals Administration (MMA) and the "
      "Marine Biodiversity Observation Network (MBON). Built by OceanMetrics."),
    "links": [
      {"rel": "root", "href": "./catalog.json", "type": JSON_T, "title": "OceanMetrics Atlas"},
      {"rel": "self", "href": "./catalog.json", "type": JSON_T},
      {"rel": "describedby", "href": "./README.md", "type": MD_T, "title": "Human-readable documentation"},
      {"rel": "agents", "href": "./AGENTS.md", "type": MD_T, "title": "Agent/LLM usage guide"},
      # aquamaps_eov is FIRST: the atlas opens on the first child (its `all` x `risk` item), see CHANGELOG 0.2.0.
      # It is written and uploaded by oceanmetrics/workflows/aquamaps_eov.qmd, not built here.
      {"rel": "child", "href": "./aquamaps_eov/collection.json", "type": JSON_T, "title": EOV_TITLE},
      {"rel": "child", "href": "./biotrack_indicators/collection.json", "type": JSON_T,
       "title": "MBON BioTrack biodiversity indicators"},
      {"rel": "child", "href": "./aquamaps_native/collection.json", "type": JSON_T,
       "title": "AquaMaps habitat suitability (native 0.5° and global 0.05°)"},
      *[{"rel": "child", "href": c["href"], "type": JSON_T, "title": c["title"]} for c in external_children],
    ],
  }


MST_STAC = "https://file.marinesensitivity.org/stac"
# the v7 collections are linked one by one (ids msens-v7-<key>, titles as the MST STAC states them), not through the v7
# parent: the parent also lists `am_0.05`, the USA-clipped AquaMaps downscale that `aquamaps_native` replaces with the
# global v8 one. Checked against https://file.marinesensitivity.org/stac/v7/collection.json on 2026-10-15.
MST_V7_CHILDREN = [
  ("ms_merge", "Merged Model"),
  ("rng_iucn", "IUCN Range"),
  ("rng_fws", "FWS Range"),
  ("bl", "BirdLife Range"),
  ("ch_nmfs", "NMFS Critical Habitat"),
  ("ch_fws", "FWS Critical Habitat"),
  ("ca_nmfs", "NMFS Core Area"),
  ("rng_turtle_swot_dps", "SWOT+DPS Turtle Range"),
]
# v8 `am` (AquaMaps) is deliberately not a child: the OceanMetrics `aquamaps_native` collection is the AquaMaps entry
EXTERNAL_CHILDREN = [
  *[{"href": f"{MST_STAC}/v7/{k}/collection.json", "title": t} for k, t in MST_V7_CHILDREN],
  {"href": f"{MST_STAC}/v8/gm/collection.json", "title": "NOAA SEFSC (density)"},
  {"href": f"{MST_STAC}/v8/nc/collection.json", "title": "NOAA NCCOS (density)"},
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
