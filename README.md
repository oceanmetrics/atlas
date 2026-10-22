# OceanMetrics Atlas

A static web app (Svelte 5 + Vite + TypeScript, no server) that maps species distribution model
products described by a STAC catalog, with places from the Ocean Metrics gazetteer. Live at
<https://oceanmetrics.io/atlas/>. Forked from
[MarineSensitivity/atlas](https://github.com/MarineSensitivity/atlas) 0.10.88 (remote `upstream`) and
stripped to a catalog-driven core; the plan and the rules that do not change are in
[`CLAUDE.md`](./CLAUDE.md).

## Commands

```sh
npm ci
npm run dev                # http://localhost:5173
npm run check              # svelte-check (types inside .svelte files too)
npm test                   # vitest
npm run build              # dist/
npm run size-budget        # critical-path gzip budget + lazy-chunk check against a real build
npm run lint && npm run format:check
npm run test:faults        # seeded-fault suite (tests/GATES.md)
```

## Where data lives

- **Catalog and collections**: `https://storage.oceanmetrics.io/atlas/` = `s3://oceanmetrics.io-public/atlas/`
  (read path-style at `https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/atlas/` until the
  storage host answers CORS). Built by the Python pipeline in `pipeline/`. The one place the origin
  is formed is `src/lib/catalog/base.ts`; override it with `?catalog=<https url>` or `VITE_CATALOG_BASE`. `?collection=<https url of a
collection.json>` adds one unlisted collection to the picker (a private preview link).
- **MarineSensitivity collections** are read by reference from `https://file.marinesensitivity.org/stac/`;
  the Species lens still reads one pinned MST release (`src/lib/release/mst.ts`).
- **Gazetteer places**: `https://storage.oceanmetrics.io/gazetteer/` (`docs/gazetteer-places.md`).
- **Rasters** render through the MarineSensitivity titiler (`src/lib/raster/tiles.ts`); numbers never
  come from the tile server.

## Profiles

The pipeline checks the catalog it writes against the Ocean Metrics STAC layer profiles
(JSON Schemas of `oceanmetrics/platform`, `packages/catalog`): `atlas-collection` for every Collection (plus
`sdm-dossier` when it has `sdm:response_type`), and for every Item `atlas-item`, `sdm-dossier` and, when a `data`
asset is a cloud-optimized GeoTIFF, `cog` (`properties["proj:code"]`; each band `data_type`, `nodata` or `null`, and
`statistics`). `pipeline/atlas_pipeline/profiles.py` runs them inside `cli.check_staging`, so a build fails on a profile
error (reported as `<collection>: <document id>: [<profile>] <json pointer>: <message>`); `pipeline/tests/` also
validates every Collection and Item under `tests/fixtures/catalog/` and `tests/fixtures/registry/` (not the external
`catalog/mst/` mirrors). The writers fill the `cog` fields from the raster itself (`stac.band_statistics`,
`stac.projection_code`); the AquaMaps registry Items are built in the browser from `atlas:item_template`, so their
`statistics` are the template constants {minimum 1, maximum 100} (see `pipeline/docs/aquamaps-native.md`).

The schemas are read from `$OM_SCHEMAS_DIR`, else `node_modules/@oceanmetrics/catalog/schemas` (after the npm
publish), else the sibling checkout `../platform/packages/catalog/schemas`: clone `oceanmetrics/platform` beside this
repo, or set `OM_SCHEMAS_DIR`; without any of the three the pipeline tests and the staging check stop with an error
naming them. The pipeline tests do not run in CI (`pages.yml` ignores `pipeline/**` and has no Python job), so
the check runs where the pipeline runs.

## Build-time configuration (all optional)

`VITE_CATALOG_BASE`, `VITE_FEEDBACK_URL`, `VITE_LOG_URL`, `VITE_GA_ID` (see `.github/workflows/pages.yml`).
Analytics are off unless `VITE_GA_ID` / `VITE_LOG_URL` are set.

## Docs

`docs/` is partly inherited from upstream (MarineSensitivity/atlas). Each inherited page opens with a
"Status in OceanMetrics Atlas" note saying what no longer applies (scores, Program Areas, the Report, the
release registry); `gazetteer-places.md` and `mst-by-reference.md` are the current notes for places and for
the MarineSensitivity collections. No page is entirely about a removed feature, so none was deleted.
