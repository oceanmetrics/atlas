"""README.md, AGENTS.md and the MapLibre style written next to the staged collections."""

from __future__ import annotations

from . import biotrack as bt
from . import stac

# ColorBrewer Spectral 11, reversed (low = blue/purple, high = red)
SPECTRAL_11_REV = ["#5e4fa2", "#3288bd", "#66c2a5", "#abdda4", "#e6f598", "#ffffbf",
                   "#fee08b", "#fdae61", "#f46d43", "#d53e4f", "#9e0142"]

METHODS = """\
Two datasets were integrated: acoustic telemetry detections of tagged animals (A-BioTrack) and OBIS
occurrence records, both quality controlled. Monthly detection histories were built for 66 species across
27,841 10-km hexagonal cells covering the US Atlantic and Gulf of Mexico. Integrated spatial occupancy models
(R package spOccupancy) were fitted per species and season (warm = May-Aug, called summer; cold = Nov-Feb,
called winter). Occupancy covariates were depth, sea surface temperature, chlorophyll, total suspended matter
and sea surface height; detection covariates were depth and the number of receivers per cell (telemetry) and
the number of same-clade records per cell (OBIS). Model performance was assessed with the Bayesian p-value and
k-fold cross-validation.

Richness is the sum of per-species occupancy probabilities in a cell. Ecoregion-weighted richness is the cell
richness divided by the maximum mean richness of the cell's ecoregion (11 ecoregions), so it ranges 0-1.
Cumulative uncertainty is the sum of per-species standard deviations of the occupancy probability, scaled
(z-score of the seasonal estimates) and weighted by ecoregion likewise. Probability classes for species lists:
0.6-0.8 Likely, 0.8-1.0 Very likely; lower values are Unlikely and can be ignored.
(Summary of T. Couto's method description, 2025-04-10.)"""


def credits_block(restricted: bool = False) -> str:
  contacts = "\n".join(
    f"  - {c['name']}, {c['roles'][0]}, {c['organization']} ({c['emails'][0]['value']})" for c in stac.CONTACTS)
  lic = (f"{stac.LICENSE_PLACEHOLDER} (PLACEHOLDER, pending confirmation from Neil Hammerschlag; do not rely on it "
         "until confirmed)")
  if restricted:
    lic += ". These per-species surfaces are RESTRICTED until Neil Hammerschlag gives permission to publish."
  return f"""\
## Credits

- Citation (placeholder): {stac.CITATION}
- License: {lic}
- Contacts:
{contacts}
- Funders: {', '.join(stac.FUNDERS)}
- Processed and hosted by OceanMetrics (https://oceanmetrics.io)."""


def field_dictionary(fields: list[dict]) -> str:
  rows = ["| Product | Field | Full name | Description |", "|---|---|---|---|"]
  rows += [f"| {f['product']} | `{f['field']}` | {f['full_name']} | {f['description']} |" for f in fields]
  return "\n".join(rows)


def column_table() -> str:
  src = {v: k for k, v in bt.FIELD_SUFFIX.items()}
  rows = ["| Suffix | Source product | Source field | Meaning |", "|---|---|---|---|"]
  for s in bt.SUFFIXES:
    prod, field = src[s]
    rows.append(f"| `{s}` | {prod} | `{field}` | {bt.SUFFIX_DESCRIPTION[s]} |")
  return "\n".join(rows)


def indicators_readme(fields: list[dict], counts: dict) -> str:
  return f"""\
# MBON BioTrack biodiversity indicators

Prototype (`atlas:status: prototype`). Ecoregion-weighted species richness and cumulative uncertainty for the US
Atlantic and Gulf of Mexico, by species group (all, fish, ray, redlisted, shark, turtle) and season (summer,
winter), in {counts['n_hex']:,} 10-km hexagonal cells, as GeoParquet-style tables plus a geometry-only PMTiles
grid. Part of the OceanMetrics Atlas (https://oceanmetrics.io/atlas/), funded by NOAA IOOS MBON.

{credits_block()}

## Methods

{METHODS}

## Assets

One row per asset of `collection.json` (asset key, file, content):

| Asset | File | What it holds |
|---|---|---|
| `hex` | `hex.pmtiles` | hex grid, layer `hex`, attribute `FID` only; paint with MapLibre feature-state and `promoteId: "FID"` |
| `values` | `values.parquet` | one row per FID, columns `{{group}}_{{season}}_{{suffix}}` ({counts['n_values_cols']} value columns); public metrics are `richness` and `uncertainty` |
| `hex_h3` | `hex_h3.parquet` | FID to H3 res 7 crosswalk (`FID`, `h3`, `weight`, `overlap_km2`); `weight` sums to 1 per FID |
| `values_h3` | `values_h3.parquet` | numeric value columns aggregated to H3 res 7 (area-weighted mean, 4 decimals, empty cells skipped) |
| `cell_species` | `cell_species.parquet` | public species list, long table (`FID`, `season`, `aphia_id`, `prob`, `class`) of Likely (0.6-0.8) and Very likely (0.8-1.0) species, {counts.get('n_cell_species', 0):,} rows |
| `species` | `species.parquet` | lookup for `aphia_id` ({counts.get('n_species', 0)} species): names, `abbreviation`, `iucn_code`, `redlisted`, `group1`, `group2`, `common_name` |
| `hex_centroids` | `hex_centroids.parquet` | `FID`, `lon`, `lat` of each hexagon centroid (EPSG:4326), for point-in-polygon summaries over places |
| `thumbnail` | `thumbnail.png` | 1200x800 preview of summer richness, all species (`thumbnail-sm.png` is the 400 px copy) |
| `style` | `styles/default.json` | MapLibre fill layer, Spectral reversed, 0..1 |

Other files: `items/` (24 STAC Items `{{group}}_{{season}}_{{metric}}`, each pointing at a column of `values.parquet`
and `values_h3.parquet` through `atlas:value_column`) and `provenance.json` (source files, checksums, record counts).

Notes. A group's species list is `lower(group2) == group` (`group2` is Fish, Ray, Shark, Turtle, Seal or
Invertebrate); `all` is every species and `redlisted` is `redlisted == true`. `common_name` is the English
vernacular from WoRMS (`AphiaVernacularsByAphiaID`), blank when none. The per-species probability MAPS stay
restricted; only this list is public.

## Column suffixes

{column_table()}

## Field dictionary (from Metadata_new-2025-05-16.xlsx, sheet Fields)

{field_dictionary(fields)}
"""


def indicators_agents(counts: dict) -> str:
  return f"""\
# AGENTS.md: biotrack_indicators

How to read this collection programmatically.

1. Read `collection.json` (STAC 1.1 + stac-sdm). `cube:dimensions` lists `group`, `season`, `metric`; each Item in
   `items/` has `atlas:dims` with one value per dimension, and `atlas:value_column` on its `values` and `h3` assets.
2. Values: `values.parquet` has `FID` (int64, 0..{counts['n_hex'] - 1}) plus {counts['n_values_cols']} columns named
   `{{group}}_{{season}}_{{suffix}}`. Groups: {', '.join(bt.GROUPS)}. Seasons: summer (May-Aug), winter (Nov-Feb).
   `richness` and `uncertainty` are the ecoregion-weighted 0-1 public metrics; other suffixes are secondary.
   Class columns (`hotspot_class`, `uncertainty_class`) are strings like `(0.8,1]`. Missing values are null
   ({counts['n_null_richness']} cells lack ecoregion-weighted values).
   ```sql
   -- duckdb
   select FID, shark_summer_richness from read_parquet('values.parquet') where shark_summer_richness > 0.8;
   ```
3. Geometry: `hex.pmtiles` carries only `FID` (join key; layer `hex`). The id field is `atlas:id_field`.
4. H3: `hex_h3.parquet` maps FID to H3 res 7 cells (`FID`, `h3`, `weight`, `overlap_km2`; weights sum to 1 per FID).
   `values_h3.parquet` (key `h3`) holds the same numeric columns aggregated by area-weighted mean.
   `sdm:h3_resolution` is 7.
5. Credits (citation, license, contacts, funders) are on the collection; the license is a placeholder.
6. Species list (public): `cell_species.parquet` (`FID`, `season`, `aphia_id`, `prob`, `class`; Likely and Very likely
   rows only, {counts.get('n_cell_species', 0):,} rows) joins `species.parquet` (`aphia_id`, `scientific_name`,
   `abbreviation`, `iucn_code`, `redlisted`, `group1`, `group2`, `common_name`) on `aphia_id`. For an item's list filter
   `season == atlas:dims.season`, then `lower(group2) == atlas:dims.group` (`all` = everyone, `redlisted` = `redlisted`).
   ```sql
   -- duckdb
   select s.scientific_name, s.common_name, c.prob, c."class"
   from read_parquet('cell_species.parquet') c join read_parquet('species.parquet') s using (aphia_id)
   where c.FID = 100 and c.season = 'summer' order by c.prob desc;
   ```
7. The per-species probability surfaces (maps) are not in this collection; they are restricted.
8. `thumbnail.png` (1200x800) and `thumbnail-sm.png` (400 px wide) preview summer richness for all species; the
   `thumbnail` asset and the `preview` link point at the large one.
"""


def species_readme(counts: dict) -> str:
  return f"""\
# MBON BioTrack per-species occupancy (RESTRICTED)

Per-species probability of occurrence and probability class for 66 species ({counts['n_hex']:,} cells, summer and
winter). **Gated pending Neil Hammerschlag's OK**: this collection is not linked from the public `catalog.json`
and is staged under an unlisted prefix. Do not share the link or redistribute.

{credits_block(restricted=True)}

## Methods

{METHODS}

## Provenance

Source: T. Couto's `Indicators_AllProducts_may2025` (Indicator_SpPresence_Prob / Class csv per season, and the
Species sheet of Metadata_new-2025-05-16.xlsx), received on Google Drive. Species names were matched to WoRMS
(AphiaRecordsByMatchNames); `species.parquet` records the match status. Checksums of the source files are in the
`provenance.json` of `biotrack_indicators`.

## Files

- `prob_summer.parquet`, `prob_winter.parquet`: `FID` plus one probability column per species, `aphia_<id>`
  (accepted WoRMS AphiaID).
- `class_summer.parquet`, `class_winter.parquet`: same layout, values `Unlikely`, `Likely`, `Very likely`.
- `species.parquet`: lookup (aphia_id, scientific_name, abbreviation, numeric_id, iucn_code, redlisted, group1,
  group2, worms_match_status, input_name, matched_aphia_id).
- `cell_species.parquet`: long table (FID, season, aphia_id, prob, class) of Likely and Very likely species only
  ({counts['cell_rows']:,} rows), for a cell-click species list.
- `items/`: 132 Items `{{aphia_id}}_{{season}}`.
- `thumbnail.png`, `thumbnail-sm.png`: 1200x800 and 400 px previews, a 2x2 panel of four summer probability surfaces.
"""


def style_default() -> dict:
  stops = []
  for i, c in enumerate(SPECTRAL_11_REV):
    stops += [round(i / 10, 1), c]
  return {
    "id": "hex-fill",
    "type": "fill",
    "source": "hex",
    "source-layer": "hex",
    "paint": {
      "fill-color": ["case", ["==", ["feature-state", "value"], None], "rgba(0,0,0,0)",
                     ["interpolate", ["linear"], ["feature-state", "value"], *stops]],
      "fill-opacity": 0.85,
    },
    "metadata": {"atlas:value_range": [0, 1], "atlas:palette": "Spectral (reversed), 11 classes",
                 "atlas:promote_id": "FID"},
  }


def species_agents() -> str:
  return f"""\
# AGENTS.md: biotrack_species (RESTRICTED)

Restricted: do not link, mirror or republish without permission from Neil Hammerschlag.

1. `collection.json`: `sdm:response_type` probability, `sdm:method` occupancy_model. Items `{{aphia_id}}_{{season}}`
   carry `sdm:taxon` (accepted WoRMS name, `authorities.worms`, group, `redlist_code`).
2. `prob_{{season}}.parquet` and `class_{{season}}.parquet`: `FID` plus one column per species `aphia_<id>`; the Item
   assets name the column in `atlas:value_column`. Classes: Unlikely (< 0.6), Likely (0.6-0.8), Very likely (>= 0.8).
3. `cell_species.parquet`: long table (FID, season, aphia_id, prob, class), Likely and Very likely only; join
   `species.parquet` on `aphia_id` for names, groups and IUCN codes.
4. `FID` joins to `hex.pmtiles` of the public `biotrack_indicators` collection.
"""


def catalog_readme() -> str:
  return """\
# OceanMetrics Atlas catalog

Root STAC catalog of the OceanMetrics Atlas (https://oceanmetrics.io/atlas/), supported by MMA and MBON.
Children: `biotrack_indicators` (MBON BioTrack richness and uncertainty), `aquamaps_native` (AquaMaps native 0.5 degree
habitat suitability, a registry of references to the MarineSensitivity v7 native COGs, non-commercial use only) and,
by reference, the MarineSensitivity SDM collections (v7, v8 gm and nc) at https://file.marinesensitivity.org/stac/. Each collection README holds its
credits (citation, license, contacts, funders) and methods. Prototype.
"""


def catalog_agents() -> str:
  return """\
# AGENTS.md: OceanMetrics Atlas catalog

Start at `catalog.json`; follow `child` links to collections, then `item` links. Collections declare
`cube:dimensions`; each Item has `atlas:dims` (one value per dimension) and assets pointing at Parquet columns
(`atlas:value_column`) or PMTiles (`atlas:id_field`). External children are MarineSensitivity STAC collections.
"""


# ---- aquamaps_native ----

def aquamaps_credits() -> str:
  from . import aquamaps as aq
  return f"""\
## Credits

- Citation: {aq.CITATION}
- License: {aq.LICENSE} (CC BY-NC 3.0 Unported, {aq.LICENSE_URL}). **{aq.NOTE}**
- Producer and licensor: AquaMaps ({aq.AQUAMAPS_URL}). Questions about reuse and partnering: info.aquamaps@gmail.com.
- Processor: MarineSensitivity (https://marinesensitivity.org), which published the native COGs in release v7.
- Hosted by OceanMetrics (https://oceanmetrics.io)."""


def aquamaps_registry_table() -> str:
  from . import aquamaps as aq
  rows = ["| Column | Type | Meaning |", "|---|---|---|"]
  rows += [f"| `{c}` | {t} | {d} |" for c, t, d in aq.REGISTRY_FIELDS]
  return "\n".join(rows)


def aquamaps_readme(counts: dict) -> str:
  from . import aquamaps as aq
  idx = (f"- `registry_index.json`: compact search index (`[sp_key, scientific_name, common_name, sp_cat]`, "
         f"{counts['index_bytes']:,} B) for a picker that loads at idle." if counts.get("index_bytes")
         else "- No `registry_index.json`: the registry is small enough to read whole.")
  return f"""\
# AquaMaps habitat suitability, native 0.5 degree

Relative environmental suitability (1-100 percent) of {counts['n_taxa']:,} aquatic species on AquaMaps' original
global 0.5 degree grid. **{aq.NOTE}**

The rasters are not part of this collection. They are the native COGs MarineSensitivity (MST) release v7 already
publishes on the public bucket (`marine-atlas/native/am/<hash>.tif`: Byte, 1-100, nodata 0, EPSG:4326, 0.5 degree
cells, cropped to each species' extent). This collection is a **registry** of references to them.

## How it differs from the MST AquaMaps collection

The MST collection `msens-v7-am_0.05` ({aq.V7_COLLECTION}) shows the same AquaMaps models interpolated
(downscaled) to the 0.05 degree MST analysis grid, which is what MST's merged model uses. This collection shows the
AquaMaps surface as published: coarse 0.5 degree cells, no interpolation. Use it to see what AquaMaps itself predicts
and to compare against the downscale (`cog_url_005` in the registry points to the matching 0.05 degree COG).

## No per-taxon Item files

{counts['n_taxa']:,} Items would be about 35 MB of JSON, so none are written. An app builds a taxon's Item from its
registry row (`atlas:taxa_registry` and `atlas:item_template` in `collection.json`):

1. read `registry.parquet` (or `registry_index.json` to search first), find the row by `sp_key`;
2. Item id = `sp_key`; `bbox` = the row's `bbox`; `geometry` = that bbox as a polygon;
3. asset `cog` = `cog_url` (type COG, role data, `bands` uint8 nodata 0, rescale `[1, 100]`, colormap
   `spectral_r`, band 1); asset `cog_005` = `cog_url_005` when present;
4. `sdm:taxon` = scientific and common name, group = `sp_cat`, authorities `worms` = `aphia_id` and `botw` =
   `botw_id`, `redlist_code`; omit what is null;
5. draw the COG through titiler; read a clicked value with `/cog/point` (1-100; 0 or no data means outside the
   model's range).

{aquamaps_credits()}

## Registry columns (`registry.parquet`, {counts['n_taxa']:,} rows, sorted by scientific name)

{aquamaps_registry_table()}

{idx}

## Method (summary)

AquaMaps (Kaschner et al. 2019) estimates, per species, relative environmental suitability from an envelope of
six predictors (depth, temperature, salinity, primary production, sea ice concentration, distance to land) fitted to
occurrence records and expert-reviewed. Values are published to 0.01 and stored as Byte 1-100 (percent); 0 is no
data. They are suitability, not probability of occurrence or abundance.

## Provenance and exclusions

Registry built from the v7 tables `model`, `taxon_model`, `taxon`, `native_asset` and `model_asset` (URLs and row
counts in `provenance.json`). Of {counts['n_models']:,} v7 AquaMaps models, {counts['excluded_no_native']} have no
native COG and are excluded. {counts['n_unmatched']} included models have no taxon match in v7 (mostly SeaLifeBase
species): they keep the name from the model description and have null `aphia_id`, `sp_cat` and `redlist_code`.
The `bbox` is the extent of the species' native cells (`native_asset`), not of the world grid.

## Files

- `collection.json`, `registry.parquet`, `provenance.json`, `README.md`, `AGENTS.md`
- `thumbnail.png`, `thumbnail-sm.png`: 1200x800 and 400 px previews, a 2x2 panel of four native surfaces.
"""


def aquamaps_agents(counts: dict) -> str:
  from . import aquamaps as aq
  return f"""\
# AGENTS.md: aquamaps_native

Non-commercial use only (CC BY-NC 3.0); say the maps and numbers come from AquaMaps and link https://www.aquamaps.org.

1. `collection.json`: `sdm:response_type` suitability, `sdm:value_range` [1, 100], `sdm:method` env_envelope,
   `sdm:temporal_interval` static. There are **no Item files**: read `atlas:taxa_registry` (asset `registry`, key
   `sp_key`) and build an Item from a row following `atlas:item_template`.
2. `registry.parquet`: {counts['n_taxa']:,} rows, one per AquaMaps model with a native COG. `cog_url` is a Byte COG
   (1-100, nodata 0, EPSG:4326, 0.5 degree), already public; `cog_url_005` is the 0.05 degree MST surface of the same
   model. `bbox` is `[west, south, east, north]`. Join to WoRMS with `aphia_id`.
3. Search: `scientific_name` and `common_name`; filter by `sp_cat`. Rows are sorted by scientific name.
4. Values: draw with titiler `/cog` (rescale 1,100, colormap spectral_r); read a point with `/cog/point`.
   Never compute numbers from tile pixels.
5. Related: the 0.05 degree downscale is {aq.V7_COLLECTION} (MarineSensitivity v7).
"""
