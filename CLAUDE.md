# CLAUDE.md

Guidance for Claude Code when working in `oceanmetrics/atlas`: **OceanMetrics Atlas**, a static Svelte 5 + Vite +
TypeScript app (no SvelteKit, no client router) that maps species distribution model (SDM) products described by a
STAC catalog, with places from the Ocean Metrics gazetteer. Forked 2026-10-14 from `MarineSensitivity/atlas`
0.10.88 (remote `upstream`); the plan is `~/Github/bbest/notes/om/plans_todo/2026-10-14_oceanmetrics-atlas_plan.md`.
Brand: "OceanMetrics Atlas", supported by MMA and MBON (Neil's BioTrack collections credit NOAA IOOS MBON only).

## Where things are

- App: https://oceanmetrics.io/atlas/ (GitHub Pages, `pages.yml`). Catalog + data:
  https://storage.oceanmetrics.io/atlas/ = `s3://oceanmetrics.io-public/atlas/` (read path-style
  `https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/atlas/` while the storage host's 302 lacks CORS).
- `pipeline/`: Python (uv) build of the atlas catalog: raw inputs -> GeoParquet + PMTiles + STAC (`stac-sdm`
  extension) staged under `catalog/staging/<collection>/` (git-ignored), published by `pipeline/publish.sh`.
  One pytest per rule, synthetic fixtures. Mirrors `oceanmetrics/places`.
- `src/`: the app. `src/lib/catalog/` loads `catalog.json` -> collections -> items (own and external MST
  collections at https://file.marinesensitivity.org/stac/). `src/lens/collection/` is the generic lens.
- External: MST titiler `https://titiler.marinesensitivity.org` (stock `/cog`), gazetteer
  `https://storage.oceanmetrics.io/gazetteer/` (`index/layers.json`, `<collection>/places.parquet|pmtiles`).

## Commands

```sh
npm ci; npm run dev            # http://localhost:5173
npm run check; npm test        # svelte-check; vitest
npm run build; npm run size-budget
cd pipeline && uv run --group dev pytest -q
uv run pipeline/build.py build --collection biotrack_indicators
```

## Rules carried over from the MST atlas (still enforced by tests and scripts)

- Relative base (`base: "./"`); never an absolute `/assets/` URL. URL is the view: every view state lives in the
  query string or hash, written with `replaceState`. Places use the `g1` codec in the hash; gazetteer places by
  reference use the `p.` token (`docs/gazetteer-places.md`).
- Data origins are formed in exactly one place (`src/lib/catalog/base.ts`), absolute.
- Numbers never come from the tile server: values come from Parquet (DuckDB-WASM or hyparquet); titiler is for
  display, plus `/cog/point` and `/cog/statistics` behind interfaces.
- One MapLibre style, `setStyle(diff: true)`; never `addLayer` piecemeal after load.
- Pins: `@duckdb/duckdb-wasm` 1.32.0, `maplibre-gl` ^6.10.0, upload parsers pinned; see `package.json` `pinReasons`.
- Size budget 450 KB gzip static path + 150 KB workers. Lazy modules stay dynamic imports.
- Every gate ships with a seeded fault that proves it can fail. A bug fix adds a named regression test.

## Catalog contract (what pipeline writes and the app reads)

- STAC 1.1 Collections with `stac-sdm` v1.0.0 fields, `sci:citation`/`sci:doi`, `contacts` (PIs, roles),
  `providers` (producer, licensor, processor, host), `license`, `atlas:funders` (list), `describedby` -> README.md
  (methods). `cube:dimensions` lists the selectable dimensions; each Item carries `atlas:dims` (one value per
  dimension) and `atlas:metric` where `sdm:response_type` is `mixed` (multi-species products).
- Hex grids: a collection-level `hex` asset (PMTiles, layer `hex`, id field `FID`, geometry only) and per-item
  `values` Parquet assets (`FID` + value columns, `table:columns`); H3 twins as `h3` Parquet assets with
  `sdm:h3_resolution`. Rasters: COG assets rendered through titiler.
- `atlas:flower {"dimension", "composite"}` on a Collection is the flower hook (`src/lib/catalog/flower.ts`): a raster
  click shows a flower whose petals are the sibling Items across `dimension` for the current other selections, each
  read by its asset's `atlas:bidx` from ONE all-band `/cog/point` answer, and whose centre is the `composite` Item's
  band (the producer defines it as the mean of the reportable petals). Petals are coloured by the dimension value
  (`FLOWER_COLORS`, else `--cat-other`) and labelled from `cube:dimensions[dimension]["atlas:labels"]`; nodata (a
  masked pixel, the band's `raster:bands` nodata, or a value outside `atlas:value_range`) is an empty slot. Never name
  a collection id in `src/`; the hook is the field.
- `atlas:absent: true` (Item property) marks an Item that has no data by construction (AquaMaps models no seabirds or
  seagrasses): the flower draws its slot empty and the table says `atlas:absent_note`, default "(not in AquaMaps)" --
  absent, never zero. An Item with no `title` is titled by its dimension labels joined with " · ".
- Restricted collections live under an unlisted prefix and are not linked from `catalog.json`.

## Conventions

2-space indent, snake_case in Python and SQL, camelCase in TypeScript, lowercase comments, `----` section
headings in long files. CHANGELOG.md gets a line for every user-facing change under the version in package.json.
