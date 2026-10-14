# aquamaps_native: AquaMaps native 0.5 degree by reference (WP7)

`uv run pipeline/build.py build --collection aquamaps_native` writes `catalog/staging/aquamaps_native/`
(code: `atlas_pipeline/aquamaps.py`; tests: `tests/test_aquamaps.py`). No raster is copied and **no per-taxon Item
file is written** (17,499 Items would be about 35 MB): the collection carries a registry and an item template, and
the app builds a taxon's Item client-side, as it does for the v7 taxa shards (`docs/mst-by-reference.md`).

## Inputs (public, read over HTTP with DuckDB httpfs)

`https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/v7/tables/`

| table                  | filter                                                                      | columns used                                                                                                        |
| ---------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `model.parquet`        | `ds_key = 'am_0.05'` (17,550 rows)                                          | `mdl_seq`, `taxa` (= AquaMaps `sp_key`), `description`                                                              |
| `taxon_model.parquet`  | `ds_key = 'am_0.05'` (16,935)                                               | `taxon_id`, `mdl_seq`                                                                                               |
| `taxon.parquet`        | all (17,561)                                                                | `taxon_id`, `taxon_authority` (worms, botw), `sp_cat`, `scientific_name`, `common_name`, `worms_id`, `redlist_code` |
| `native_asset.parquet` | `ds_key = 'am'`, `representation = 'native'`, `asset_type = 'cog'` (17,499) | `mdl_key` (= `str(mdl_seq)`), `asset_url`, `xmin ymin xmax ymax`                                                    |
| `model_asset.parquet`  | `ds_key = 'am'` (17,544)                                                    | `mdl_seq`, `cog_url` (0.05 degree, grid `usa05`), `n_cells`                                                         |

Native COG (checked with `gdalinfo`): Byte, values 1-100, nodata 0, EPSG:4326, 0.5 degree cells, 720 columns,
cropped to the species' latitude window (rows vary), internal overviews, DEFLATE.

## Registry

One row per model with a native COG (17,499), sorted by `scientific_name` (case-insensitive). A model with no taxon
match (595, mostly SeaLifeBase `SLB-*`) keeps the name from `model.description` and has null `aphia_id`, `botw_id`,
`sp_cat`, `redlist_code`; 51 models have no native COG and are excluded (listed in `provenance.json`).
Columns: see the table in the collection README. `n_cells_005` counts 0.05 degree cells of the MST surface (the
native cell count is not in the v7 tables). `bbox` is the extent of the species' cells from `native_asset`.
`registry_index.json` (`[sp_key, scientific_name, common_name, sp_cat]`) is written only when `registry.parquet`
exceeds 1 MB (`INDEX_MIN_BYTES`).

## Building an Item from a row (`atlas:item_template`)

- id = `sp_key`; `bbox` = row `bbox`; geometry = bbox polygon; `datetime: null`.
- asset `cog`: href `cog_url`, COG media type, role `data`, `bands` = uint8, nodata 0, unit percent (STAC 1.1 core;
  `raster:bands` is not used because raster extension v2.0.0, pinned by Portolan, dropped it),
  `atlas:rescale [1, 100]`, `atlas:colormap spectral_r`, `atlas:bidx 1`; optional asset `cog_005`: `cog_url_005`.
- properties: `title` = `scientific_name (common_name)`, `atlas:value_range [1, 100]`, `atlas:representation native`,
  `sdm:taxon` {scientific_name, common_name, group = `sp_cat`, authorities {worms = `aphia_id`, botw = `botw_id`},
  redlist_code}; omit null values.
- values at a point: titiler `/cog/point` on `cog`.

## Licensing

`license: CC-BY-NC-3.0`, a `rel: license` link to creativecommons.org/licenses/by-nc/3.0/, and the visible
`atlas:note` ("Non-commercial use only ... link back to aquamaps.org"). `atlas:funders` is empty. Whether an
MMA/MBON-supported public atlas counts as non-commercial is Ben's call (WP7 plan).

## Publish

`pipeline/publish.sh` syncs `catalog/staging/aquamaps_native` to `s3://oceanmetrics.io-public/atlas/aquamaps_native`
with the other collections; `catalog.json` links it as a child.
