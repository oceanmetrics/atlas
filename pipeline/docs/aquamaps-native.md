# aquamaps_native: AquaMaps native 0.5 degree and global 0.05 degree by reference (WP7, WP12)

`uv run pipeline/build.py build --collection aquamaps_native` writes `catalog/staging/aquamaps_native/`
(code: `atlas_pipeline/aquamaps.py`; tests: `tests/test_aquamaps.py`). No raster is copied and **no per-taxon Item
file is written** (18,697 Items would be tens of MB): the collection carries a registry and an item template, and
the app builds a taxon's Item client-side, as it does for the v7 taxa shards (`docs/mst-by-reference.md`).

WP12 (2026-10-15) moved the source from MarineSensitivity release v7 (0.5 degree native COGs plus the 0.05 degree
surface clipped to US waters) to **release v8** (native 0.5 degree COGs plus the **global** 0.05 degree downscale).

## Inputs (public, read over HTTP with DuckDB httpfs)

`https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/v8/tables/` (there is no `model_asset.parquet`
in v8; the 0.05 degree COG is a `native_asset` row with `representation = 'model'`)

| table                  | filter                                                                  | columns used                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `model.parquet`        | `ds_key = 'am'` (23,699 rows)                                           | `mdl_key` (`am\|<SpeciesID>`), `sp_id` (= the AquaMaps SpeciesID, the registry `sp_key`), `sci_name`, `common_name` |
| `taxon_model.parquet`  | `ds_key = 'am'` (23,658)                                                | `mdl_key`, `taxon_authority` (worms, botw), `taxon_id`                                                              |
| `taxon.parquet`        | all (37,051)                                                            | `taxon_authority`, `taxon_id`, `sp_cat`, `scientific_name`, `common_name`, `iucn_code`                              |
| `native_asset.parquet` | `ds_key = 'am'`, `asset_type = 'cog'`, `representation` native or model | `mdl_key`, `representation`, `asset_url`, `rescale_min/max`, `colormap`, `xmin ymin xmax ymax`                      |

and, only for `sp_key_v7`, the v7 `model.parquet` (`ds_key = 'am_0.05'`: `taxa`, `description`).

- `representation = 'native'`: the 0.5 degree COG, `marine-atlas/native/am/<hash>.tif` (18,697).
- `representation = 'model'`: the global 0.05 degree COG, `marine-atlas/cog/global05/<hash>.tif` (18,697).

COGs: Byte, values 1-100, nodata 0, EPSG:4326, cropped to the species' window, internal overviews, DEFLATE.

## Registry

One row per model that has **both** COGs: 18,697 of 23,699 (5,002 have neither; no model has just one, checked
2026-10-15; the build reports `native_only`, `only_005` and `one_rep_sp_keys` so a later release that does is visible).
Sorted by `scientific_name` (case-insensitive). Every row matches a `taxon` row (unmatched = 0 today); a model with
no match would keep `sci_name` from the model table and null `aphia_id`, `botw_id`, `sp_cat`, `redlist_code`.
`aphia_id` is `taxon_id` for authority worms, `botw_id` for botw. Columns: the table in the collection README.
`bbox_native` and `bbox_005` are the extents of the two COGs; they can differ.

`sp_key_v7` maps an old `?sp=` link (a v7 registry key = v7 `model.taxa`). Rule 1: the v8 SpeciesID is itself a v7
`taxa` value (true for all 17,498 of the 17,550 v7 models that are in the v8 registry: the AquaMaps ids did not change,
so the column equals `sp_key` today); rule 2: else the case-insensitive scientific name equals the name in exactly one
v7 model description whose key is not some other v8 species' own. Null when v7 never modelled the species (1,199 rows).

`registry_index.json` (`[sp_key, scientific_name, common_name, sp_cat]`) is written only when `registry.parquet`
exceeds 1 MB (`INDEX_MIN_BYTES`).

## Building an Item from a row (`atlas:item_template`)

- id = `sp_key`; `datetime: null`; the Item `bbox` and `geometry` are the `atlas:bbox` of the asset that plays the `data`
  role (`bbox_native` for native, `bbox_005` for 0.05).
- asset `cog`: href `cog_url`, COG media type, `bands` = uint8, nodata 0, unit percent (STAC 1.1 core; `raster:bands` is
  not used because raster extension v2.0.0, pinned by Portolan, dropped it), `atlas:bbox {bbox_native}`,
  `atlas:rescale [1, 100]`, `atlas:colormap spectral_r`, `atlas:bidx 1`; asset `cog_005`: `cog_url_005`, the same
  fields with `atlas:bbox {bbox_005}`. Roles: the drawn one is `data`, the other `reference`.
- properties: `title` = `scientific_name (common_name)`, `atlas:value_range [1, 100]`, `atlas:representation`
  `native` or `005`, `sdm:taxon` {scientific_name, common_name, group = `sp_cat`, authorities {worms = `aphia_id`,
  botw = `botw_id`}, redlist_code}; omit null values.
- values at a point: titiler `/cog/point` on the drawn asset.

## Licensing

`license: CC-BY-NC-3.0`, a `rel: license` link to creativecommons.org/licenses/by-nc/3.0/, and the visible
`atlas:note` ("Non-commercial use only ... link back to aquamaps.org"). The MST v8 `am` STAC collection
(`rel: related`) says `license: CC-BY-4.0` while its own citation says CC BY-NC 3.0 (the v7 defect again, om TODO
"msens: fix msens-v7-am_0.05 STAC license"); the atlas shows the non-commercial terms for both representations.
`atlas:funders` is empty. Whether an MMA/MBON-supported public atlas counts as non-commercial is Ben's call (WP7 plan).

## Root catalog

The MST v7 parent is no longer a child of `catalog.json`: it lists `am_0.05` (the US-clipped downscale this collection
replaces). The eight other v7 collections are linked one by one (`stac.MST_V7_CHILDREN`), with `v8/gm` and `v8/nc`.
`msens-v8-am` is not a child either: `aquamaps_native` is the AquaMaps entry. `build.py check` flags a catalog that links
the v7 parent, `am_0.05` or `v8/am`.

## Publish

`pipeline/publish.sh` syncs `catalog/staging/aquamaps_native` to `s3://oceanmetrics.io-public/atlas/aquamaps_native`
with the other collections, except `registry_index.json`: it is uploaded separately from a `gzip -9` copy with
`--content-encoding gzip --content-type application/json` (the 1.1 MB file is served gzip-encoded, as the app's
size budget assumes). `catalog.json` links the collection as a child.
