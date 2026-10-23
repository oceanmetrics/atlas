# atlas pipeline

The Python (uv) build of the atlas catalog: raw inputs to GeoParquet, PMTiles, COGs and STAC, staged under
`catalog/staging/<collection>/` (git-ignored) and published by `publish.sh`. The commands and the catalog contract
are in the repo's [`CLAUDE.md`](../CLAUDE.md); the profiles are in the repo [README](../README.md#profiles).

```sh
cd pipeline && uv run --group dev pytest -q                       # one test per rule; needs GDAL on the PATH
uv run pipeline/build.py build --collection swfsc_cce_becker2020b   # from the repo root
uv run pipeline/build.py check
uv run pipeline/build.py cog-assets <item.json>... <tif>          # the browser COG assets of Items written elsewhere
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
the rest (`image/tiff`, from the extension). The `density` assets (roles `["reference"]`) are left as they are.

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
