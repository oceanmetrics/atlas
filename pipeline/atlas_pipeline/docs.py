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
27,841 10-km hexagonal cells covering the US Atlantic, the Gulf of Mexico, and the Caribbean. Integrated spatial occupancy models
(R package spOccupancy) were fitted per species and season (warm = May-Aug, called summer; cold = Nov-Feb,
called winter). Occupancy covariates were depth, sea surface temperature, chlorophyll, total suspended matter
and sea surface height; detection covariates were depth and the number of receivers per cell (telemetry) and
the number of same-clade records per cell (OBIS). Model performance was assessed with the Bayesian p-value and
k-fold cross-validation.

Species richness was estimated by summing the latent occupancy states (z) across all species in each grid cell
and averaging the resulting species counts across 1,000 retained model iterations. Ecoregion-weighted richness
is the cell richness divided by the maximum mean richness of the cell's ecoregion (11 ecoregions), so it ranges
0-1. Cumulative uncertainty is the sum of per-species standard deviations of the occupancy probability, scaled
(z-score of the seasonal estimates) and weighted by ecoregion. Probability classes for species lists: 0.6-0.8
Likely, 0.8-1.0 Very likely; lower values are considered less likely and were ignored.
(T. Couto's method description, revised 2026-10-16.)"""


def credits_block(restricted: bool = False) -> str:
  contacts = "\n".join(
    f"  - {c['name']}, {c['roles'][0]}, {c['organization']} ({c['emails'][0]['value']})" for c in stac.CONTACTS)
  lic = f"{stac.LICENSE} (the public indicator layers; confirmed by Neil Hammerschlag 2026-10-23)"
  if restricted:
    lic += (". These per-species surfaces are RESTRICTED: only the species list of a cell is public, never the maps "
            "or a download (Neil Hammerschlag, 2026-10-23).")
  return f"""\
## Credits

- Citation: {stac.CITATION}
- Full author list: {stac.CITATION_FULL}
- License: {lic}
- Contacts:
{contacts}
- Funders: {', '.join(stac.FUNDERS)}
- Acknowledgement: {stac.ACKNOWLEDGEMENT}
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
Atlantic, the Gulf of Mexico and the Caribbean, by species group (all, fish, ray, redlisted, shark, turtle) and season (summer,
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
5. Credits (citation, license, contacts, funders, `atlas:acknowledgement`) are on the collection.
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
winter). **Restricted (Neil Hammerschlag, 2026-10-23: the species list only)**: this collection is not linked from the public `catalog.json`
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
Children: `biotrack_indicators` (MBON BioTrack richness and uncertainty), `aquamaps_native` (AquaMaps habitat suitability,
native 0.5 degree and global 0.05 degree, a registry of references to the MarineSensitivity v8 COGs, non-commercial
use only) and, by reference, the MarineSensitivity SDM collections (the v7 collections one by one, v8 gm and nc) at https://file.marinesensitivity.org/stac/. Each collection README holds its
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
- Processor: MarineSensitivity (https://marinesensitivity.org), which published the native COGs and the global 0.05
  degree downscale in release v8.
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
# AquaMaps habitat suitability (native 0.5° and global 0.05°)

Relative environmental suitability (1-100 percent) of {counts['n_taxa']:,} aquatic species in two representations,
both from MarineSensitivity (MST) release v8: **native**, AquaMaps' original global 0.5 degree grid, and **0.05**, the
global 0.05 degree downscale. **{aq.NOTE}**

The rasters are not part of this collection. They are COGs MST release v8 already publishes on the public bucket
(native: `marine-atlas/native/am/<hash>.tif`; 0.05 degree: `marine-atlas/cog/global05/<hash>.tif`; both Byte, 1-100,
nodata 0, EPSG:4326, cropped to each species' extent). This collection is a **registry** of references to them.

## The two representations

- `native` (`cog_url`, box `bbox_native`): AquaMaps as published, coarse 0.5 degree cells, no interpolation. Use it to
  see what AquaMaps itself predicts.
- `005` (`cog_url_005`, box `bbox_005`): the same model downscaled by MST to the 0.05 degree analysis grid, **global**.
  It is the release v8 surface ({aq.V8_COLLECTION}), not the USA-clipped one of release v7 (the v7 `am_0.05`
  collection is no longer part of this atlas). The MST v8 STAC says `CC-BY-4.0` for it while its own citation says CC BY-NC 3.0;
  AquaMaps' terms are the non-commercial ones and are shown for both.

A model is in the registry only when it has **both** COGs ({counts['n_taxa']:,} of {counts['n_models']:,} v8 AquaMaps
models; {counts['native_only']} have only a native COG, {counts['only_005']} only a 0.05 degree one, {counts['no_cog']}
have neither).

## No per-taxon Item files

{counts['n_taxa']:,} Items would be tens of MB of JSON, so none are written. An app builds a taxon's Item from its
registry row (`atlas:taxa_registry` and `atlas:item_template` in `collection.json`). The `cog` profile wants `statistics` on every
data band; these Items are never written, so the template carries the constants `minimum` 1 and `maximum` 100 (the
grids are Byte 1-100, nodata 0, by construction) instead of statistics read from {counts['n_taxa']:,} COGs, and has no
`mean`, `stddev` or `valid_percent`:

1. read `registry.parquet` (or `registry_index.json` to search first), find the row by `sp_key` (an old v7 key is
   `sp_key_v7`);
2. Item id = `sp_key`; assets `cog` = `cog_url` (box `bbox_native`) and `cog_005` = `cog_url_005` (box `bbox_005`), type
   COG, `bands` uint8 nodata 0 with `statistics` {{minimum 1, maximum 100}}, rescale `[1, 100]`, colormap `spectral_r`,
   band 1, and `proj:code` `EPSG:4326`; the representation on the map plays the `data` role and its box is the Item
   `bbox` and `geometry`;
3. `sdm:taxon` = scientific and common name, group = `sp_cat`, authorities `worms` = `aphia_id` and `botw` =
   `botw_id`, `redlist_code`; omit what is null;
4. draw the COG through titiler; read a clicked value with `/cog/point` (1-100; 0 or no data means outside the
   model's range).

{aquamaps_credits()}

## Registry columns (`registry.parquet`, {counts['n_taxa']:,} rows, sorted by scientific name)

{aquamaps_registry_table()}

{idx}

`sp_key_v7` is set for {counts['n_sp_key_v7']:,} rows ({counts['n_sp_key_v7_renamed']} of them with a key that differs from `sp_key`):
AquaMaps SpeciesIDs did not change between release v7 and v8, so the v7 key is normally the same string.

## Method (summary)

AquaMaps (Kaschner et al. 2019) estimates, per species, relative environmental suitability from an envelope of
six predictors (depth, temperature, salinity, primary production, sea ice concentration, distance to land) fitted to
occurrence records and expert-reviewed. Values are published to 0.01 and stored as Byte 1-100 (percent); 0 is no
data. They are suitability, not probability of occurrence or abundance.

## Provenance and exclusions

Registry built from the v8 tables `model`, `taxon_model`, `taxon` and `native_asset` (and the v7 `model` table for
`sp_key_v7`); URLs and row counts in `provenance.json`. Of {counts['n_models']:,} v8 AquaMaps models,
{counts['n_taxa']:,} have both COGs; the rest have no COG. {counts['n_unmatched']} included models have no taxon match
(they keep the model's own name and have null `aphia_id`, `sp_cat` and `redlist_code`).
The boxes are the extents of the COGs (`native_asset`), not of the world grid.

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
2. `registry.parquet`: {counts['n_taxa']:,} rows, one per AquaMaps model with both COGs. `cog_url` is the native Byte
   COG (1-100, nodata 0, EPSG:4326, 0.5 degree, box `bbox_native`); `cog_url_005` is the global 0.05 degree downscale
   of the same model (MarineSensitivity release v8, box `bbox_005`). Boxes are `[west, south, east, north]`. Join to
   WoRMS with `aphia_id`; `sp_key_v7` maps an old v7 key.
3. Search: `scientific_name` and `common_name`; filter by `sp_cat`. Rows are sorted by scientific name.
4. Values: draw with titiler `/cog` (rescale 1,100, colormap spectral_r); read a point with `/cog/point`.
   Never compute numbers from tile pixels.
5. Related: the downscale's MarineSensitivity collection is {aq.V8_COLLECTION} (release v8).
"""


# ---- swfsc_cce_becker2020b (restricted) ----

def cce_readme(rows: list[dict]) -> str:
  """README.md (describedby) of the restricted SWFSC California Current density collection. No email, no URL of
  the unlisted prefix (the README sits under it already)."""
  from . import stac
  table = "\n".join(
    f"| {r['species']} | *{r['scientific_name']}* | {int(r['worms_id'])} | {int(r['n_cells']):,} | "
    f"{float(r['density_p98']):.3g} | {float(r['density_max']):.3g} | {float(r['cv_median']):.2f} |"
    for r in rows)
  moved = [r for r in rows if str(r.get("worms_id_accepted") or "").strip()
           and int(float(r["worms_id_accepted"])) != int(r["worms_id"])]
  worms_note = "" if not moved else (
    " WoRMS no longer accepts " + "; ".join(
      f"*{r['scientific_name']}* ({int(r['worms_id'])}, {r.get('worms_status') or 'not accepted'}; accepted: "
      f"{('*' + r['scientific_name_accepted'] + '*, ') if r.get('scientific_name_accepted') else ''}"
      f"{int(float(r['worms_id_accepted']))})" for r in moved)
    + ", recorded on their Items as `atlas:worms_id_accepted`.")
  return f"""\
# California Current cetacean density, SWFSC (Becker et al. 2020): UNDER REVIEW

> {stac.CCE_NOTE}

This collection is not linked from the public `catalog.json`; it sits under an unlisted prefix and is shared by link
only. Do not share the link or redistribute the data.

## What it is

NOAA Southwest Fisheries Science Center habitat-based density models for {len(rows)} cetacean species in the California
Current Ecosystem (Becker et al. 2020, NOAA Technical Memorandum NMFS-SWFSC-638), from ship line-transect surveys
1991-2018. One season, **Summer-Fall** (July-November, the survey season). Each species has one 2-band
cloud-optimized GeoTIFF: band 1 is density (animals per km2), band 2 its coefficient of variation (cv). The atlas
shows them as two selectors, species and variable.

The collection has the {len(rows)} layers the delivered geodatabase holds. The InPort abstract also names sperm whale
and a "small beaked whale guild" (Mesoplodon spp. and Cuvier's beaked whale); neither is in the geodatabase, so
neither is here.

## Method

{stac.CCE_METHOD_DETAIL}

The delivered model predictions (InPort 64349, a file geodatabase of density and cv per 0.1 degree prediction
cell) were area-weighted onto the 0.05 degree global grid of the Marine Sensitivity Toolkit by Ocean Metrics
(`MarineSensitivity/workflows` `ingest_swfsc_cce.qmd`): each 0.05 degree cell takes the area-weighted mean of the
source cells it overlaps. The cv is the delivered `UNCERTAINTY` field, defined on InPort as "Numerical uncertainty
value (CV)", with the same area weighting: where a 0.05 degree cell straddles source cells (74.6 % of cells) it is
an area-weighted blend of their CVs, an approximation for a coefficient of variation; there the dominant source
cell supplies a median 93.5 % of the area (the ingest's figures, 2026-10-22). The total abundance is kept: `abundance_source` and `abundance_regridded` in `models.csv` agree. Values stay density
as delivered (animals per km2), not rescaled; they are not yet used in any Marine Sensitivity score. The map draws
density from 0 to its 98th percentile (`density_p98` in `models.csv`, 3 significant figures, fixed per species)
and cv on a fixed 0-2 range, the same for
every species (a cv of 1 is a standard error as large as the density; above 2 draws at the top colour).

## Species

| species | scientific name | WoRMS | cells | density p98 (map maximum) | density max | cv median |
|---|---|---:|---:|---:|---:|---:|
{table}

Density in animals per km2. The WoRMS id is the one delivered.{worms_note}

## Credits

- Citation: {stac.CCE_CITATION}
- Producer: NOAA Southwest Fisheries Science Center (lead author Elizabeth A. Becker). Distributor: NOAA Fisheries
  Office of Science and Technology, InPort item 64349 ({stac.CCE_INPORT}).
- Processing (0.05 degree grid): Ocean Metrics, for the Marine Sensitivity Toolkit.
- License: public domain as a US Government work, 17 U.S.C. § 105 (to check: none is stated on InPort; the
  product is published by NOAA Fisheries). Use constraints, quoted from InPort 64349:

  > {stac.CCE_USE_CONSTRAINTS}

## Files

- `items/`: {2 * len(rows)} Items `{{worms_id}}_density` and `{{worms_id}}_cv` (one COG, `atlas:bidx` 1 or 2).
- `cog/cce_{{worms_id}}_summer-fall.tif`: the 2-band Float32 COGs (band 1 density, band 2 cv, nodata -9999), a
  window over the California Current aligned to the global 0.05 degree grid.
- `models.csv`: one row per species (layer, names, WoRMS id, season, mdl_key, cog file, n_cells, abundance source,
  density min / p98 / max, cv median) from the ingest.
- `thumbnail.png`, `thumbnail-sm.png`: a 2x2 panel of four Summer-Fall density surfaces.
"""


def sefsc_readme(models: list[dict], layers: list[dict], checks: list[dict], taxa: list[dict], questions_md: str,
                 provider_readme: str, overlays: list[dict]) -> str:
  """README.md (describedby) of the restricted sefsc_gm v2 collection: methods, the provider's field dictionary
  verbatim, the derived fields, the checks with their numbers, the questions for the provider, credits. No email, no
  URL of the unlisted prefix (the README sits under it already)."""
  from . import stac
  model_table = "\n".join(
    f"| {m['label']} | `{m['layer']}` | *{m['scientific_name']}* | {m['aphia_id']} | {m['months_modelled']} | "
    f"{float(m['abundance_annual']):,.0f} | {float(m['density_p98_annual']):.3g} |" for m in models)
  check_table = "\n".join(f"| {c['group']} | {c['check']} | {c['value']} | {c['note']} |" for c in checks)
  unresolved = [t for t in taxa if not t["models"]]
  n_unres = sum(int(t["n"]) for t in unresolved)
  taxa_table = "\n".join(
    f"| {t['platform']} | {t['name']} | {t['n']} | {t['name_resolved']} | {t['aphia_id']} | {t['rank']} | "
    f"{t['id_certain']} | `{t['models'] or '-'}` |" for t in taxa)
  overlay_list = "\n".join(f"- **{o['title']}** (`{o['id']}`, {o['geometry']}, {'on' if o['default'] else 'off'} by default)"
                           for o in overlays)
  questions = questions_md.split("\n", 1)[1].strip() if questions_md.startswith("#") else questions_md.strip()
  n_by_var = {}
  for r in layers:
    n_by_var[r["variable"]] = n_by_var.get(r["variable"], 0) + 1
  return f"""\
# Gulf line-transect surveys and density models, NOAA SEFSC: version 2, UNDER REVIEW

> {stac.SEFSC_NOTE}

This collection is not linked from the public `catalog.json`; it sits under an unlisted prefix and is shared by link
only, for review with the provider first. Do not share the link or redistribute the data.

**Version 2** of the atlas' NOAA SEFSC Gulf layer. Version 1 ({stac.SEFSC_V1_URL}) is the Marine Sensitivity v8
collection: the annual densities of the same 19 models as a 0-100 index on the 0.05 degree grid. Version 2 adds the
survey effort and sightings behind the models and keeps everything on the models' own hexagons, as delivered.

## What it is

- **Survey effort and sightings** (NOAA SEFSC, delivered 12 November 2026 by Lance Garrison): the broadscale vessel
  surveys 2003-2024 (including the 2023 and 2024 surveys) and aerial surveys 2011-2018 that the GoMMAPPS spatial
  density models were fit to, as line-transect effort segments and marine mammal sightings.
- **The 40 km² model hexagons** (`GoMex_Hexagons_40km.shp`, 42,908 hexagons, `HEXID`).
- **The 19 spatial density models** of NCEI accession 0256800 v2.2 ({len(models)} shapefiles, monthly abundance per
  hexagon with its standard error and CV), on the same 42,908 `HEXID`s: no regridding anywhere.

On the map, pick a **layer** (the surveys or a density model), a **month** and a **variable** to paint the hexagons
(`values.parquet`); over that, the vector layers:

{overlay_list}

Click any of them for all its attributes. With a density model selected, ticking "Only features matching the selected
layer" keeps only the sightings that belong to that model (`atlas:overlay_filter` on the model's Items: the sightings
whose `models` holds `|<model key>|`); it is off by default, so every sighting shows. The **Filter features** block
under the layers (`atlas:overlay_filters`) narrows the sightings to one species (with a link to its density model where
it has one), the effort and sightings to a month (by default the month the hexagons show; none for annual) and to a
range of years. Every choice is kept in the page's URL, so a view can be shared by its link.

## The hexagon values (`values.parquet`, `layers.csv`)

One row per hexagon (`FID` = `HEXID`), one double column per layer x month x variable, named
`{{layer}}__{{month}}__{{variable}}` ({len(layers)} columns: {', '.join(f'{n} {k}' for k, n in n_by_var.items())}).

- Density models: `density` = `{{Mon}}_n / Area_km2` (animals per km², `Area_km2` the nominal 40 km²) and `cv` as
  delivered (`{{Mon}}_cv`), for every month the model covers; `-9999` is NULL. `annual__density` is the
  **day-weighted** mean of the twelve monthly densities, a month the model does not cover counting as 0 (the annual
  of the Marine Sensitivity ingest, `msens::density_annual()` with `month_day_weights()`); there is no annual CV. The
  pygmy and dwarf sperm whale model covers April-November only, so its annual is 244/365 of its April-November mean.
- Surveys (`survey_vessel`, `survey_aerial`, `survey_all`): `effort_km` = the sum of the segments' delivered length
  field / 1000 by the segment's `HEXID`; `groups` = the number of sightings by the sighting's `HEXID`;
  `individuals` = the sum of `group.size`; per month of the segment or sighting, and `annual` = all months. A
  hexagon with no effort is NULL (not surveyed), not 0; `groups` and `individuals` are 0 where `effort_km` > 0. A
  sighting whose hexagon has no effort that month still counts (see the checks).
- The map draws each surface from 0 to its 98th percentile (`p98` in `layers.csv`, 3 significant figures); the CV
  on a fixed 0-2, the same for every model.

## Density models (`models.csv`)

| model | key | scientific name (spp_gmx) | AphiaID | months | annual abundance | annual density p98 |
|---|---|---|---:|---|---:|---:|
{model_table}

Annual abundance = the sum over hexagons of annual density x `Area_km2`. The two Atlantic spotted and the two common
bottlenose dolphin models are separate stocks (oceanic, shelf), kept as separate layers.

## Effort and sightings: delivered and derived fields

Every delivered field keeps its delivered `.rds` name (the shapefiles of the same names abbreviate them). The
provider's field dictionary, verbatim (`SEFSC_Line_Transect_Survey_Data_ReadMe.txt`):

```text
{provider_readme.strip()}
```

Two differences from it: the aerial effort length field is `seg.len.m` in the file (the ReadMe says `seg.length.m`),
and the hexagon field is `USA_EEZ` (the ReadMe says `USA_EZZ`). Dates are ISO strings as delivered: vessel effort
`s.date` / `e.date` in UTC and vessel sightings `date.time` in GMT (as the `.rds` states them), aerial sightings
`date.time` without a time zone, aerial effort `date` a date only (local, EST/EDT). All layers are EPSG:4326 here
(the vessel effort and the hexagons were delivered in USA Contiguous Lambert Conformal Conic, ESRI:102004).

Derived fields (snake_case):

- effort: `platform` (vessel / aerial), `year`, `month` (of `s.date` / `date`), `length_km` (the length field / 1000),
  `n_sightings` (the sightings linked to the segment).
- sightings: `platform`, `year`, `month` (of `date.time`), `lon`, `lat` (vessel; the aerial file carries its own),
  `name_resolved`, `aphia_id`, `accepted_name`, `rank` (WoRMS, offline snapshot), `id_certain` (FALSE for a
  combination such as "X or Y"), `models` (the density models the sighting belongs to, `|key|key|`, empty for none),
  `segment_found` (its `survey` + `segment.id`, or `unique.seg.id`, is in the effort file), `in_own_hex` (the point
  lies in the hexagon its `HEXID` names), `dist_to_segment_m` (geodesic distance to its own segment), and the joined
  segment's `trackline`, `s.date`, `e.date` (vessel) or `date` (aerial).
- hexagons: `vessel_km`, `aerial_km`, `vessel_groups`, `aerial_groups`, `vessel_individuals`, `aerial_individuals`,
  `vessel_surveys`, `aerial_surveys` (distinct surveys with effort), `vessel_years`, `aerial_years` (first-last year
  with effort); NULL where not surveyed.

## Sighting to model crosswalk (`sefsc_gm_sighting_taxa.csv`)

A sighting belongs to every model whose species set contains every candidate of its identification: Ziphius,
Mesoplodon and Ziphiidae to the beaked whales; Orcinus, Peponocephala, Feresa, Pseudorca and their combinations to
blackfish; Globicephala to pilot whales; Kogia to the pygmy and dwarf sperm whales; *Stenella frontalis* to both
Atlantic spotted stocks; *Tursiops truncatus* and "Standard Tursiops" to both bottlenose stocks. A higher taxon
(Delphinidae, Odontoceti, Stenella sp., Cetacea, Mysticeti, unidentified dolphin), a combination across models, and a
species no model covers (rough-toothed and Fraser's dolphins, the manatee) belong to none. One deliberate exception:
the *Balaenoptera* combinations ("B. borealis/ricei" and the like) go to the Rice's whale model with `id_certain`
FALSE. {len(unresolved)} names ({n_unres} sightings) belong to no model.

| platform | name as delivered | n | resolved | AphiaID | rank | id certain | models |
|---|---|---:|---|---:|---|---|---|
{taxa_table}

## Checks (`checks.csv`)

| group | check | value | note |
|---|---|---|---|
{check_table}

## Questions for the provider

{questions}

## Credits

- Survey effort and sightings: {stac.SEFSC_SURVEY_CITATION}
- Density models: {stac.SEFSC_CITATION}
- Producer and point of contact: NOAA Southeast Fisheries Science Center, Marine Mammal and Turtle Division (Lance
  Garrison). Archive of the density models: NOAA NCEI, accession 0256800 ({stac.SEFSC_NCEI}).
- {stac.SEFSC_ACK}
- Processing and hosting: Ocean Metrics (MarineSensitivity/workflows `ingest_sefsc_gm-surveys.qmd`, oceanmetrics/atlas
  `pipeline/atlas_pipeline/sefsc_gm.py`).
- License: public domain as a US Government work, 17 U.S.C. § 105 (to check with the provider).

## Files

- `items/`: {len(layers)} Items `{{layer}}_{{month}}_{{variable}}`, one per `values.parquet` column.
- `values.parquet`, `hex.pmtiles` (geometry + `FID` only): the painted hexagons.
- `sightings_vessel.pmtiles`, `sightings_aerial.pmtiles`, `effort_vessel.pmtiles`, `effort_aerial.pmtiles`,
  `hexagons.pmtiles`: the vector layers with every attribute (z0-z12, no feature dropped).
- `hexagons.parquet`, `effort_vessel.parquet`, `effort_aerial.parquet`, `sightings_vessel.parquet`,
  `sightings_aerial.parquet`: the downloads (GeoParquet 1.1, EPSG:4326).
- `layers.csv`, `models.csv`, `sefsc_gm_sighting_taxa.csv`, `checks.csv`, `SEFSC_Line_Transect_Survey_Data_ReadMe.txt`.
"""
