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
- **Rasters**: an Item whose COG has an EPSG:3857 copy (`cog_3857`) is drawn in the browser by
  `@oceanmetrics/map`'s `cogSlot` through the `cog://` protocol (`src/lib/raster/cog.ts`), with its legend from
  the STAC band `statistics` and `histogram` and its point read (the hover and click value, the flower's
  petals) from the 4326 original over HTTP Range (`src/lib/raster/cogPoint.ts`); no tile server is asked.
  Today that is the published `aquamaps_eov` risk Items. Every other raster Item still renders through the
  MarineSensitivity titiler (`src/lib/raster/tiles.ts`), the fallback until every COG has a 3857 asset
  (it retires in build week 6), as do a place summary's statistics over a raster. Numbers never come from
  the tile server. The map stack is `@oceanmetrics/map` ^0.2.1 from npm.

## Profiles

The pipeline checks the catalog it writes against the Ocean Metrics STAC layer profiles
(JSON Schemas of `oceanmetrics/platform`, `packages/catalog`): `atlas-collection` for every Collection (plus
`sdm-dossier` when it has `sdm:response_type`), and for every Item `atlas-item`, `sdm-dossier` and, when a `data`
asset is a cloud-optimized GeoTIFF, `cog` (`properties["proj:code"]`; each band `data_type`, `nodata` or `null`, and
`statistics`). `pipeline/atlas_pipeline/profiles.py` runs them inside `cli.check_staging`, so a build fails on a profile
error (reported as `<collection>: <document id>: [<profile>] <json pointer>: <message>`); `pipeline/tests/` also
validates every Collection and Item under `tests/fixtures/catalog/` and `tests/fixtures/registry/` (not the external
`catalog/mst/` mirrors). The writers fill the `cog` fields from the raster itself (`cog.band_summary`,
`stac.projection_code`) and write each COG's EPSG:3857 copy as a second data asset, `cog_3857`
([`pipeline/README.md`](./pipeline/README.md)); the AquaMaps registry Items are built in the browser from `atlas:item_template`, so their
`statistics` are the template constants {minimum 1, maximum 100} (see `pipeline/docs/aquamaps-native.md`).

The schemas are read from `$OM_SCHEMAS_DIR`, else `node_modules/@oceanmetrics/catalog/schemas` (after the npm
publish), else the sibling checkout `../platform/packages/catalog/schemas`: clone `oceanmetrics/platform` beside this
repo, or set `OM_SCHEMAS_DIR`; without any of the three the pipeline tests and the staging check stop with an error
naming them. The pipeline tests do not run in CI (`pages.yml` ignores `pipeline/**` and has no Python job), so
the check runs where the pipeline runs.

## Instances

One codebase serves several atlases (vision doc 2026-10-21, "The atlas, one codebase with skins").
`instances/<id>/` holds what differs: `instance.json` (name, wordmark, titles, og tags, favicon, mark,
supporters, credit and citation, About copy, the default catalog base and picker groups, the default
lens, theme and tour, the tool list, the feedback app key, the places site and credit, the titiler
host), `tokens.css` with its `@contrast` block (and the exported `tokens.json`), the `mark.svg`, and
`assets/` (favicon, og card, logos, motifs). `instances/instance.schema.json` (JSON Schema 2020-12,
closed) is the contract; `tests/instances.test.ts` validates every instance and the build refuses an
invalid one.

- `VITE_INSTANCE=<id>` picks the folder (default `oceanmetrics`; `.env` or the environment). Vite
  aliases `@instance` to it; `src/lib/brand/instance.ts` is the only reader of `instance.json` in
  `src/`, and `shell.css`/`catalog.css` import `@instance/tokens.css`.
- `index.html` and `catalog.html` carry `%instance.*%` text placeholders and `instance:*` comment
  blocks, filled by the `atlas-instance` plugin in `vite.config.ts` (`scripts/instance.mjs`,
  `renderInstanceHtml`). The same plugin serves `assets/` beside the page (a dev middleware; `emitFile`
  at build) while `public/` keeps the files every instance shares (`public/mst/`).
- The brand scripts (`contrast`, `check:hex-literals`, `check:inlined-tokens`, `export-tokens`,
  `render-og`) read `VITE_INSTANCE` too: `VITE_INSTANCE=marinesensitivity npm run contrast`.
- `Lens`, `ToolName` and `CatalogGroup` stay compile-time unions: an instance chooses among their
  members (its `defaults.lens`, `tools`, `catalog.groups`), it cannot add one.
- `oceanmetrics` is the live atlas. `marinesensitivity` is a scaffold with the values known from
  MarineSensitivity/atlas; its Scores lens, Report export, seal and gallery arrive in build week 4
  (2026-11-20 to 11-26), see `instances/marinesensitivity/README.md`.

Collections declare their renderers in STAC through `atlas:*` hooks; `src/lib/catalog/hooks.ts` is the
one registry that maps a hook (`atlas:flower`, `atlas:cell_species`, `atlas:taxa_registry`) to its module.
`unknownHooks` lists a collection's `atlas:*` keys that are neither a registered hook nor a data field.

## Build-time configuration (all optional)

`VITE_INSTANCE` (above), `VITE_CATALOG_BASE`, `VITE_FEEDBACK_URL`, `VITE_LOG_URL`, `VITE_GA_ID` (see
`.github/workflows/pages.yml`).
Analytics are off unless `VITE_GA_ID` / `VITE_LOG_URL` are set.

## Docs

`docs/` is partly inherited from upstream (MarineSensitivity/atlas). Each inherited page opens with a
"Status in OceanMetrics Atlas" note saying what no longer applies (scores, Program Areas, the Report, the
release registry); `gazetteer-places.md` and `mst-by-reference.md` are the current notes for places and for
the MarineSensitivity collections. No page is entirely about a removed feature, so none was deleted.
