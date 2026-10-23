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
- Platform packages from npm (`oceanmetrics/platform`): `@oceanmetrics/map` (^0.3.3: the MapLibre setup, the COG
  provider, the h3 release slot with its tile costs (`stats()`) and `speciesForCell`), `@oceanmetrics/places` (the gazetteer client; called only from
  `src/lib/gazetteer/resolve.ts`, a dynamic import, elsewhere `import type` only) and `@oceanmetrics/catalog` (^0.5.1: the
  `storage` subpath, the one rule for the storage host, `src/lib/catalog/storage.ts`; the `schemas/*.schema.json` the pipeline's profiles read). No vendored client.

## Commands

```sh
npm ci; npm run dev            # http://localhost:5173
npm run check; npm test        # svelte-check; vitest (project `logic` = node; `runes` = `*.svelte.test.ts`, the real lens state)
npm run build; npm run size-budget
cd pipeline && uv run --group dev pytest -q
uv run pipeline/build.py build --collection biotrack_indicators
uv run pipeline/build.py build --collection swfsc_cce_becker2020b   # restricted; input = workflows ingest_swfsc_cce.qmd (DONE)
pipeline/publish.sh --only swfsc_cce_becker2020b [--really]       # that collection alone, dry run unless --really
```

## CI notes

- The Playwright jobs of `pages.yml` (e2e-engine, e2e-opfs, analytics-privacy) install their browsers through the composite action
  `.github/actions/playwright`: `actions/cache` on `~/.cache/ms-playwright`, keyed on the OS, the browser list and the
  `@playwright/test` version in `package-lock.json`; a miss runs `playwright install --with-deps`, a hit only `install-deps` (the system
  libraries are not cached). Each job stops after 20 minutes. A new e2e job uses the action and sets `timeout-minutes`.

## Rules carried over from the MST atlas (still enforced by tests and scripts)

- Relative base (`base: "./"`); never an absolute `/assets/` URL. URL is the view: every view state lives in the
  query string or hash, written with `replaceState`. Places use the `g1` codec in the hash; gazetteer places by
  reference use the `p.` token (`docs/gazetteer-places.md`).
- Data origins are formed in exactly one place (`src/lib/catalog/base.ts`), absolute, on the storage host chosen once in `src/lib/catalog/storage.ts` (`onStorage()` moves any storage-host url read from a release table onto it; other hosts pass through).
- Numbers never come from the tile server: values come from Parquet (DuckDB-WASM or hyparquet); a raster Item with
  a `cog_3857` asset is drawn in the browser (`@oceanmetrics/map` `cogSlot` behind the `RasterSource` seam,
  `src/lib/raster/cog.ts`, chosen per Item by `pickCogAssets`), its legend from STAC `statistics`/`histogram`, its
  point read from the 4326 original (`raster/cogPoint.ts`, `pointValue`). Titiler is the fallback for an Item with no
  3857 asset yet (display, `/cog/point`, `/cog/statistics`, behind the same interfaces) and retires in build week 6.
- One MapLibre style, `setStyle(diff: true)`; never `addLayer` piecemeal after load (a `cogSlot` is mounted on a
  recorder and its source and layer go into the composed style; one mounted slot per band of a file, the package's
  `cogHref`, `?b=<atlas:bidx>`).
- Pins: `@duckdb/duckdb-wasm` 1.32.0, `maplibre-gl` ^6.13.0 (the `@oceanmetrics/map` peer range), upload parsers
  pinned; see `package.json` `pinReasons`. `map.ts` calls `@oceanmetrics/map`'s `setupMapLibre` once (worker,
  `pmtiles://`, lazy `cog://`); worker chunks are named `.mjs` (`vite.config.ts`).
- Size budget 450 KB gzip static path + 150 KB workers. Lazy modules stay dynamic imports.
- Every gate ships with a seeded fault that proves it can fail. A bug fix adds a named regression test.

## Catalog contract (what pipeline writes and the app reads)

- STAC 1.1 Collections with `stac-sdm` v1.0.0 fields, `sci:citation`/`sci:doi`, `contacts` (PIs, roles),
  `providers` (producer, licensor, processor, host), `license`, `atlas:funders` (list), `describedby` -> README.md
  (methods). `cube:dimensions` lists the selectable dimensions; each Item carries `atlas:dims` (one value per
  dimension) and `atlas:metric` where `sdm:response_type` is `mixed` (multi-species products).
- Hex grids: a collection-level `hex` asset (PMTiles, layer `hex`, id field `FID`, geometry only) and per-item
  `values` Parquet assets (`FID` + value columns, `table:columns`); H3 twins as `h3` Parquet assets with
  `sdm:h3_resolution`. Rasters: COG assets, drawn in the browser from their `cog_3857` asset when they have one,
  else through titiler.
- `atlas:flower {"dimension", "composite"}` on a Collection is the flower hook (`src/lib/catalog/flower.ts`): a raster
  click shows a flower whose petals are the sibling Items across `dimension` for the current other selections, each
  read by its asset's `atlas:bidx` from ONE all-band point read (the 4326 original in the browser, else `/cog/point`), and whose centre is the `composite` Item's
  band (the producer defines it as the mean of the reportable petals). Petals are coloured by the dimension value
  (`FLOWER_COLORS`, else `--cat-other`) and labelled from `cube:dimensions[dimension]["atlas:labels"]`; nodata (a
  masked pixel, the band's `raster:bands` nodata, or a value outside `atlas:value_range`) is an empty slot. Never name
  a collection id in `src/`; the hook is the field.
- `atlas:absent: true` (Item property) marks an Item that has no data by construction (AquaMaps models no seabirds or
  seagrasses): the flower draws its slot empty and the table says `atlas:absent_note`, default "(not in AquaMaps)" --
  absent, never zero. An Item with no `title` is titled by its dimension labels joined with " · ".
- `atlas:cell_species` on a Collection (`src/lib/catalog/cellSpecies.ts`) is the raster cell -> species hook: `layout:
"tiles"`, `tile_deg`, `href_template` (`{tile}`), `grid {ncol,nrow,x0,y0,res}`, `key_column`, `species_column`,
  `lookup_asset` (a Parquet keyed by `lookup_key`, with `scientific_name`, `common_name`, `redlist_code`, `weight`,
  the `group_column` and `share.total_column`), `value_column`/`value_label`/`value_range`, and `links` (a URL
  `column`, or an `href_template` with `same_app: true` for this app's own `?c=..&sp={sp_key}`, which the app turns
  into `rep=005` plus the current `map=`). The lens follows it with `lens.followLink` (not a bare `selStore.set`): the
  clicked point is carried to the new collection and re-read there, `lens.returnTo` remembers the layer and camera for a
  "Back to ..." button (`goBack`), and the camera follows the global auto-zoom preference (the panel's checkbox and the
  Layers panel's "Auto-zoom to layer" are the same `lens.autoZoom`). Rules: `src/lens/collection/returnTo.ts`. Tiles are Parquet sorted by key with small row groups (hyparquet prunes by
  statistics); a missing tile is an empty cell. Hex collections keep the single `cell_species` table of `species.ts`.
- Restricted collections live under an unlisted prefix and are not linked from `catalog.json`.

## Profiles (checked at build time)

`pipeline/atlas_pipeline/profiles.py` validates what the pipeline stages against the platform profiles
(`oceanmetrics/platform` `packages/catalog/schemas`): `atlas-collection` (+ `sdm-dossier` with `sdm:response_type`) per
Collection; `atlas-item`, `sdm-dossier` and, for a `data` COG, `cog` per Item. `cli.check_staging` calls it, so a profile
error fails the build; the old `check_stac_required` checks stay. Schemas: `$OM_SCHEMAS_DIR`, else
`node_modules/@oceanmetrics/catalog/schemas` (after `npm ci`), else the sibling `../platform/packages/catalog/schemas`. A COG Item needs `properties["proj:code"]` and, per data band,
`data_type`, `nodata` (`null` when none) and `statistics`, read from the file at write time. From build week 2 every
published COG Item has two data assets, the 4326 original and `cog_3857` (its EPSG:3857 copy `<stem>_3857.tif`, roles
`["data", "visual"]`), each with its own `proj:code` and checked against `cog` on its own; band `statistics` and
`histogram` come from the full-resolution 4326 original (`cog.band_summary`, never the copy or an overview); overviews
are nearest or mode, never averaging (`pipeline/atlas_pipeline/cog.py`, `pipeline/README.md`; `build.py cog-assets` for
Items written elsewhere).
`jsonschema` is a main dependency; `@oceanmetrics/catalog` is a dependency (the app imports its `storage` subpath), so `npm ci` provides the schemas. The external `tests/fixtures/catalog/mst/` mirrors are not under the profiles. Pipeline
tests are not in CI (run `cd pipeline && uv run --group dev pytest -q`).

## Instances and hooks

- Another instance: copy `instances/oceanmetrics/` to `instances/<id>/` and edit `instance.json` (it must validate
  against `instances/instance.schema.json`; `npm test`), `tokens.css`, `mark.svg` and `assets/`; build with
  `VITE_INSTANCE=<id>` (the brand scripts read the same variable). Never name a brand in `src/`: read `lib/brand/instance.ts`.
- A new renderer hook: its module exports its `atlas:*` name and a `parse(collection) -> spec | null`, and
  `src/lib/catalog/hooks.ts` registers it (the one place that names hook -> module); a plain data field goes in `DATA_FIELDS`.
- What an instance builds is `scripts/instance-modules.mjs` (the instance module table): each lens, tool, page and
  capability (`release`, `seal`) names its modules (`eager` exports or `lazy` loaders), the source paths it `owns`, a
  `markers` string and its `tests`. `virtual:instance-modules` gives the shell each module or `null`; Shell.svelte never
  imports a table-owned module directly (`tests/instance-modules.test.ts`) and guards each instance-only branch with a
  build flag (`__LENS_SCORES__`, `__LENS_COLLECTION__`, `__TOOL_REPORT__`, `__RELEASE__`, `__SEAL__`). A new lens or
  tool: a table entry, a bridge module (`src/lens/<lens>/shell.ts`), its tests listed, and the d.ts in
  `src/vite-env.d.ts`. `check-instance-dist.mjs` (CI, every build) proves the dist carries only its instance's modules.
- Tests run once per instance (`vitest.config.ts`: `logic:<id>`); a module's tests run under an instance that builds it.
  A test of an instance's own strings reads them from the instance (or a per-instance table), never a literal brand.
  `*.mst.test.ts` are the shared modules' tests as MarineSensitivity/atlas wrote them (zones, `out`, the scores keys).
- The Ocean Metrics bar (`@oceanmetrics/nav`, dev decision D7): `instance.json` `nav` is required, `false` or `{ current, items?,
mark?, label?, changes_href? }`; `NAV` (`lib/brand/instance.ts`) is `null` for `false`. `Shell.svelte` renders `<om-nav>` above
  the top bar behind `__NAV__` and registers it with a dynamic `import('@oceanmetrics/nav/define')` (a 4.9 kB lazy chunk), so an
  instance with `nav: false` carries neither element nor chunk (`check-instance-dist.mjs`, the `nav` capability's markers are
  `<om-nav` and `om-nav-search`, never the bare tag: shell.css's `om-nav:not(:defined)` is in every build). The shell grid's
  extra row is `.app:has(> om-nav)`; the bar follows the shell's theme (`theme` attribute) and its place search goes to the places site.
- The two instances: `oceanmetrics` (Collections, Species; Places rail; index, catalog; 450/150 KB) and
  `marinesensitivity` (Scores, Species; Report rail; index, report; the marine-atlas release registry with the access
  gate; the MMA seal; 470/150 KB, raised from 0.10.93's 460 because this codebase carries maplibre-gl 6.15 (the
  `@oceanmetrics/map` peer range, about 10 KB gzip over 0.10.93's 6.10) and the shared Place layers). Both build from
  `.github/workflows/build-instance.yml`; MarineSensitivity/atlas calls it at a pinned tag (`docs/mst-thin-repo.md`).

### The release registry (an instance with `release`; moved from MarineSensitivity/atlas, still enforced)

- **Relative base**: the same `dist/` runs under `https://marinesensitivity.org/atlas/` and
  `https://preview.marinesensitivity.org/{ver}/atlas/` (Cloudflare Access scopes by path); never an absolute `/assets/` URL.
- **Version resolution: path beats `?ver=` beats `latest.txt`.** A malformed value is absent, never an error; the label is
  `^v[0-9]+[a-z]?$` (`src/lib/release/version.ts`). What renders is what the access gate allows.
- **Preview mode has exactly one door**: a same-origin `session.json` with `{"preview": true}` (`release/session.ts`), the
  app's only same-origin fetch; a 404, a network error, malformed JSON are public. Never fail open. The public path never
  awaits it.
- **Fail closed**: `versions.json` rows carry `access`; a restricted release is fetched only on a preview session; no row,
  no `access`, an unknown value are not renderable; an unreadable `versions.json` allows only `latest.txt`'s version; a
  denied version falls through to `latest.txt` with `{ver, reason}` on `window.__early.denied` (`release/access.ts`).
- **Registry origins are formed in one place**: `catalog/base.ts#RELEASE_REGISTRY_BASE` (the instance's
  `release.registry`), used by `release/dataBase.ts` and written into the inline script by the build.
- **The inline early-fetch script is a second copy, and a test proves it**: `src/lib/release/earlyFetch.inline.js` (one
  file, written into index.html and report.html at `<!--instance:early-fetch-->`) duplicates
  `release/{version,session,access,dataBase}.ts` because it runs before any bundle parses. `tests/release/access-cases.ts`
  is the one case table: `access.test.ts` drives the modules, `inline-early-fetch.test.ts` runs the script the build
  writes (both pages) in a `node:vm` sandbox. Add a case to the shared table, never to one side.
- The restricted release prefixes and their fixtures stay out of git (the moved tests keep only public v7 fixtures).

## Conventions

2-space indent, snake_case in Python and SQL, camelCase in TypeScript, lowercase comments, `----` section
headings in long files. CHANGELOG.md gets a line for every user-facing change under the version in package.json.
