# atlas pipeline

The Python (uv) build of the atlas catalog: raw inputs to GeoParquet, PMTiles, COGs and STAC, staged under
`catalog/staging/<collection>/` (git-ignored) and published by `publish.sh`. The commands and the catalog contract
are in the repo's [`CLAUDE.md`](../CLAUDE.md); the profiles are in the repo [README](../README.md#profiles).

```sh
cd pipeline && uv run --group dev pytest -q                       # one test per rule; needs GDAL on the PATH
uv run pipeline/build.py build --collection swfsc_cce_becker2020b   # from the repo root
uv run pipeline/build.py check
uv run pipeline/build.py cog-assets <item.json>... <tif>          # the browser COG assets of Items written elsewhere
uv run pipeline/build.py cog-3857-batch --release v7 --out <dir>  # the 3857 copies + side table of a MST release
uv run --project pipeline pipeline/scripts/sweep_3857.py          # the gate counter: COGs referenced without a copy
pipeline/publish.sh [--only <collection>] [--really]              # dry run unless --really
```

## COGs for the browser renderer (build week 2)

From build week 2 the atlas draws COGs in the browser with `@oceanmetrics/map` `cogSlot` (the
`@geomatico/maplibre-cog-protocol`) instead of titiler. Platform spike 3 (2026-10-22) fixed what publish must write;
`atlas_pipeline/cog.py` writes it:

| what                                                     | function                             | rule                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| an EPSG:3857 copy `<stem>_3857.tif` beside each 4326 COG | `web_mercator_copy`                  | `gdalwarp -r near`, clipped to ±85.0511°, COG with `TILING_SCHEME=GoogleMapsCompatible`, `ZOOM_LEVEL_STRATEGY=UPPER` (a 0.5° file stays at zoom 2), 256 px blocks, DEFLATE, nearest overviews. The protocol draws only 3857; a 4326 file draws silently in the wrong place.                                                                                                          |
| the original's overviews                                 | `ensure_overviews`                   | rebuilt in place down to about 256 px with `nearest` (`mode` for classes), never averaging (the EOV files' averaged overviews put the smallest overview's mean +29% off). Compression, predictor and block size kept; a file that already has them is left alone.                                                                                                                    |
| per band `statistics` and a 32-bucket `histogram`        | `band_summary`                       | from the full-resolution 4326 original, nodata masked: never the 3857 copy (Mercator repeats high-latitude pixels: -23% on the EOV mean), never an overview.                                                                                                                                                                                                                         |
| two data assets per Item                                 | `add_cog_assets`, `publish_cog_item` | the original (`proj:code` EPSG:4326, roles `["data"]`) and `cog_3857` (`proj:code` EPSG:3857, roles `["data", "visual"]`), with the same draw hints (`atlas:bidx`, `atlas:rescale`, `atlas:colormap`) and the same bands. `pickCogAssets` draws the data asset whose `proj:code` is EPSG:3857 and reads numbers from the other; `visual` marks the copy as the one made for display. |

`profiles.check_profiles` checks each of the two data assets against the `cog` profile on its own (`[cog <key>]`), and
each must carry its own `proj:code`. A band with no valid pixel (AquaMaps models no seabirds or seagrasses) gets
`statistics` {minimum, maximum} = the asset's display range (`atlas:rescale`, else `atlas:value_range`) and
`valid_percent` 0, and no histogram, because the `cog` profile requires a minimum and a maximum.

`swfsc_cce.build` does all of this for the CCE COGs; `publish.sh --only swfsc_cce_becker2020b` uploads the originals,
then the `_3857.tif` copies beside them (`--content-type image/tiff`), then the Items.

### The next `aquamaps_eov` publish (oceanmetrics/workflows)

`workflows/R/eov_share.R` writes its own STAC, so `aquamaps_eov.qmd` calls the pipeline once per score COG, with the
Items over it, after the Items are written and BEFORE `collection.json` is built: the call rewrites `score_<metric>.tif`
in place (nearest overviews), so the collection's `score_*` asset `file:size` and `file:checksum` must be read after
it. From the `stac` chunk, with the atlas checkout beside workflows:

```r
atlas <- normalizePath("../atlas")
for (m in c("risk", "share")) {
  items <- f(file.path("items", paste0(eov_levels(), "_", m, ".json")))
  rc <- system2("uv", c("run", "--project", file.path(atlas, "pipeline"), file.path(atlas, "pipeline/build.py"),
                        "cog-assets", shQuote(items), shQuote(f(glue("score_{m}.tif")))))
  stopifnot(rc == 0)
}
```

It writes `score_<metric>_3857.tif` beside each COG and rewrites each Item in place with the `cog_3857` asset (href
`../score_<metric>_3857.tif`), `proj:code` on both assets and the Item, and per band statistics and histograms; it
refuses an Item that then fails the `cog` profile. The upload chunk's `aws s3 sync` carries the `_3857.tif` files with
the rest (`image/tiff`, from the extension). The `density` assets (roles `["reference"]`) take the same call with `--key density`: the copy goes under
`density_3857` (roles `["reference", "visual"]`, so `pickCogAssets` never draws it in place of `cog_3857`), and an empty
band of a reference asset gets only `valid_percent` 0. Done for the published `density_risk.tif` and `density_share.tif`
on 2026-10-23 (below).

Measured on the published `score_risk.tif` (7200 × 3600, 9 bands uint8, nodata 255) on the laptop, 2026-10-23, with
the 8 risk Items: overviews rebuilt nearest (3600 × 1800 down to 225 × 113; the published ones went to 450 × 225 with
no recorded resampling) in 2.2 s, the nine band summaries in 2.2 s, the 3857 copy (8192 × 8192, zoom 0 to 5,
11,121,693 B) in 25.3 s; 30 s for the whole call. Band 1 (`all`): minimum 0, maximum 88, mean 2.95722, stddev 9.2489,
valid_percent 62.69, the spike's GDAL reference; the smallest overview's mean is now 2.932 (-0.9%), not +29%.

Same call on the published `score_share.tif` (laptop, 2026-10-23, the 8 share Items): overviews rebuilt nearest down to
225 × 112 (the published ones were averaged, 450 × 225 at the smallest), 8192 × 8192 3857 copy of 15,508,152 B, 25.8 s;
`score_share.tif` 10,055,670 B to 10,064,899 B. Band 1 mean 6.03525, stddev 10.9548, valid_percent 62.69.

### Re-publishing an `aquamaps_eov` COG without the full workflow

After `build.py cog-assets` on a downloaded COG and its Items, stage them as `<stage>/aquamaps_eov/` (`score_*.tif`,
`score_*_3857.tif`, `items/*.json`, and `collection.json` read from the bucket with the new `score_*` `file:size` and
`file:checksum`), then:

```sh
ATLAS_STAGE=<stage> pipeline/publish.sh --only aquamaps_eov [--really]
```

It uploads the COGs, then their copies, then the Items, then `collection.json` last, under `atlas/aquamaps_eov/` only,
with the same keys and `image/tiff` / `application/json` content types; it never deletes, and `--size-only` skips a
key whose size did not change (the risk COG and Items published on 2026-10-23 are not touched).

### The density COGs (2026-10-23, the mini)

`build.py cog-assets items/*_<m>.json density_<m>.tif --key density` over the 8 Items of each metric: overviews rebuilt
nearest (4 levels, unrecorded resampling, to 5 down to 225 x 113), 3857 copies of 481,467,696 B (risk) and
674,782,732 B (share), zoom 0 to 5 (8 float32 bands), 82 s and 95 s. `collection.json` got the new `file:size` and
`file:checksum` of both originals, `proj:code`, and two collection assets `density_<m>_3857`; then
`ATLAS_STAGE=<stage> pipeline/publish.sh --only aquamaps_eov --really` (the originals and copies, the 16 Items,
`collection.json`; the score files were not staged, so not touched). The published originals before the rewrite are
kept at `/Volumes/msens_big/_big/oceanmetrics/cog3857/om_stage/aquamaps_eov_published/`.

## The 3857 copies of a MarineSensitivity release (`cog-3857-batch`, week 6 step 5, D8)

MST's published releases are immutable (D7), so the copies of their COGs go beside the release, never into it
(`atlas_pipeline/cog3857.py`):

- the release's COG list: the distinct `.tif` of `<ver>/tables/model_asset.parquet` (`cog_url`), `score_cog.parquet`
  (`cog_url`) and `native_asset.parquet` (`asset_url` where `asset_type = cog`); a table a release lacks is skipped.
  Each row's `content_hash` must be its file's stem (the store key);
- each original downloaded path-style to `<out>/src/<path under marine-atlas/>` (cached, shared by releases), its md5
  checked against the store catalog `marine-atlas/assets.parquet`, never rewritten (no `ensure_overviews`: it is a
  published file);
- the copy (`cog.web_mercator_copy`) at `<out>/<ver>/cog_3857/<path>_3857.tif`, published as
  `marine-atlas/<ver>/cog_3857/<path>_3857.tif`;
- one side-table row per COG in `<out>/<ver>/tables/cog_3857.parquet` (`cog3857.SCHEMA`): `content_hash` (the
  original's, the join key), `url` (the original as the release names it), `cog_3857_key`, `proj:code` (EPSG:3857),
  `src_proj:code`, `zoom_min`, `zoom_max`, `bands`, `data_type` and `nodata` (per band), `statistics` and `histogram` (per band, from the full-resolution
  4326 original, null for an empty band), `bytes` and `md5` of the copy, `src_bytes`, `src_md5`, `created`.

Resumable: each finished COG is a line of `<out>/<ver>/cog_3857.jsonl` (the journal); the Parquet is rewritten from it
every 1,000 rows and at the end, sorted by `content_hash` in row groups of 512 (a reader filtering on one
hash skips the rest by their statistics); a rerun skips every `content_hash` in either. Failures go to
`<out>/<ver>/cog_3857_errors.jsonl` and are retried by the next run (exit 1 while any remain). Publish, additive:

```sh
aws s3 sync <out>/<ver>/cog_3857 s3://oceanmetrics.io-public/marine-atlas/<ver>/cog_3857/ --content-type image/tiff
aws s3 cp <out>/<ver>/tables/cog_3857.parquet s3://oceanmetrics.io-public/marine-atlas/<ver>/tables/cog_3857.parquet
```

### The shared pool (`cog-3857-batch --pool`)

The copies are content addressed (the original's `content_hash` is its file stem, shared across releases), so one
pool serves every release and registry after v7: `marine-atlas/cog_3857/<content_hash>_3857.tif` and one shared
table `marine-atlas/tables/cog_3857.parquet` (the same `SCHEMA`, sorted by hash, row groups of 512).

```sh
uv run pipeline/build.py cog-3857-batch --pool --release v7b --release v7c --registry aquamaps_native --out <dir>
```

- input: the union, by hash, of the COGs the `--release` tables and the `--registry` files name (a registry's
  `cog_url` and `cog_url_005`), minus every hash a `--pointer` release's side table has (default v7: local
  `<dir>/v7/tables/` first, else the bucket's) or the pool already has;
- the copies at `<dir>/shared/cog_3857/<hash>_3857.tif`, the journal and errors in `<dir>/shared/`, resumable as above;
- the shared table `<dir>/shared/tables/cog_3857.parquet`: the union of the pointer release's rows, as they are (their
  `cog_3857_key` stays `marine-atlas/v7/cog_3857/...`: v7's copies are not uploaded again), and the pool's own;
- each registry's next version, additive: `<dir>/om/<registry>/registry/v2/registry.parquet`, the current
  `registry.parquet`'s rows and columns as they are plus `cog_3857_url` and `cog_3857_url_005` (path-style, null where
  there is no copy). The collection's `registry` asset still names `./registry.parquet`; pointing it at
  `./registry/v2/registry.parquet` is the collection's next publish.

Publish, additive (never `--delete`, never an original):

```sh
aws s3 sync <dir>/shared/cog_3857 s3://oceanmetrics.io-public/marine-atlas/cog_3857/ --content-type image/tiff
aws s3 cp <dir>/shared/tables/cog_3857.parquet s3://oceanmetrics.io-public/marine-atlas/tables/cog_3857.parquet
aws s3 cp <dir>/om/aquamaps_native/registry/v2/registry.parquet \
  s3://oceanmetrics.io-public/atlas/aquamaps_native/registry/v2/registry.parquet
```

The restricted releases' copies sit in the public pool because their originals do: v7b's and v7c's tables name only
`marine-atlas/cog/usa05/` and `marine-atlas/native/am/` files, the same public prefixes as v7's (`versions.json`
`access: restricted` gates the app and the STAC trees, D10, not the store's files).

`scripts/sweep_3857.py` prints the gate's one line, `COGs referenced without a 3857 copy = N of M (...)`, over the
MST releases v7, v7b and v7c (each against its own side table and the shared table), the OM `aquamaps_native`
registry (its newest version, `registry/v2/` before `registry.parquet`, by D8's `cog_3857_url` and
`cog_3857_url_005`) and the OM Items (a `*_3857` asset beside each COG asset); exit 0 at 0. `--side-dir` reads the
local `<dir>/<ver>/tables/`, `<dir>/shared/tables/` and `<dir>/om/` before the bucket's.
