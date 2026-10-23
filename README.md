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
  petals) from the 4326 original over HTTP Range (`src/lib/raster/cogPoint.ts`); no tile server is asked. A COG's copy and numbers come from the shared side table `marine-atlas/tables/cog_3857.parquet` by `content_hash`: the first lookup of a page reads 47 KB (8 B trailer, the 17 KB footer, one page of each column by the page index; 620 KB before, `docs/release-cog-table.md`).
  Today that is the published `aquamaps_eov` risk Items. Every other raster Item still renders through the
  MarineSensitivity titiler (`src/lib/raster/tiles.ts`), the fallback until every COG has a 3857 asset
  (it retires in build week 6), as do a place summary's statistics over a raster. Numbers never come from
  the tile server. The map stack is `@oceanmetrics/map` ^0.2.2 from npm.

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

Schema 1.1 (build week 4) adds `lenses` (the lenses the instance builds; `defaults.lens` must be one of
them), `tools` widened to `report`, `pages` (the HTML entries it publishes: `index`, `catalog`, `report`;
always `index`), `release` (`registry` base, required when present, `preview` origin, `access: "gate"`,
`docs` book root) for an instance that reads a release registry, `seal` (`agency`, `src`), `budget`
(`static_kb`, `worker_kb`, the defaults of `npm run size-budget` for the selected instance), and the
strings the moved MarineSensitivity modules used to hard-code: `repo` (where feedback issues go and the
Docs/changelog links point), `download.prefix` (the figure file names), `report` (`title`, `stem`;
required when `pages` names `report`) and `about.credits`. Fixtures that pass and fail are in
`tests/fixtures/instance/{valid,invalid}/`, with the expected error per invalid file in `invalid.json`.
Schema 1.3 adds `defaults.bathymetry` (`on` or `off`, absent = `off`): the Layers panel's Bathymetry row, the GEBCO sea
floor, on a fresh page (oceanmetrics `on`, marinesensitivity `off`).

- `VITE_INSTANCE=<id>` picks the folder (default `oceanmetrics`; `.env` or the environment). Vite
  aliases `@instance` to it; `src/lib/brand/instance.ts` is the only reader of `instance.json` in
  `src/`, and `shell.css`/`catalog.css`/`report.css` import `@instance/tokens.css` (and the shell
  `@instance/fonts.css`, empty for an instance on system fonts).
- `index.html`, `catalog.html` and `report.html` carry `%instance.*%` text placeholders and
  `instance:*` comment blocks, filled by the `atlas-instance` plugin in `vite.config.ts`
  (`scripts/instance.mjs`, `renderInstanceHtml`): the og tags, the skeleton's mark, wordmark, lens
  switch and (with a release) version chip, the font preloads, and, for an instance with a release
  registry, the inline early-fetch script (`src/lib/release/earlyFetch.inline.js`, one copy for both
  pages). The same plugin serves `assets/` beside the page (a dev middleware; `emitFile` at build)
  while `public/` keeps the files every instance shares (`public/mst/`).
- The brand scripts (`contrast`, `check:hex-literals`, `check:inlined-tokens`, `export-tokens`,
  `render-og`) read `VITE_INSTANCE` too: `VITE_INSTANCE=marinesensitivity npm run contrast`.

### What an instance builds (the instance module table)

`scripts/instance-modules.mjs` is the one table of which module implements each lens, tool, page and
capability (`release`, `seal`); `vite.config.ts` and `vitest.config.ts` serve it to the app as
`virtual:instance-modules`. For the selected instance each export is the module (eager: the
Collections lens' reactive core and place summaries, which must exist before a panel mounts), a loader
(lazy: the Collections lens' components, the Scores lens, the Report tool, the release registry) or
`null`, so a module the instance does not name is never bundled. Shell.svelte imports instance-only
code only from there (`tests/instance-modules.test.ts`), and guards each instance-only template branch
with a build-time flag (`__LENS_SCORES__`, `__LENS_COLLECTION__`, `__TOOL_REPORT__`, `__RELEASE__`,
`__SEAL__`, the same `define`), so the minifier drops it from a build without it.

| instance            | lenses               | rail                           | pages          | release, seal                    | budget (KB gzip) |
| ------------------- | -------------------- | ------------------------------ | -------------- | -------------------------------- | ---------------- |
| `oceanmetrics`      | Collections, Species | Layers, Details, Table, Places | index, catalog | none                             | 450 / 150        |
| `marinesensitivity` | Scores, Species      | Layers, Details, Table, Report | index, report  | marine-atlas registry, gate; MMA | 470 / 150        |

- `scripts/check-instance-dist.mjs` (every CI build) checks a dist carries exactly its instance's
  pages, no chunk from a source an unselected entry owns, and each selected entry's marker string but
  no unselected one's: the oceanmetrics dist has no Scores lens, Report or release registry code, the
  marinesensitivity dist no Collections lens.
- `npm test` runs the logic tests once per instance (`logic:oceanmetrics`, `logic:marinesensitivity`):
  a module's tests run under an instance that builds it (the table's `tests`), and a test of one
  instance's strings reads them from the instance.
- `.github/workflows/build-instance.yml` is the ONE build (a reusable `workflow_call`: `instance`,
  `ref`, the `VITE_*` values; the dist as an artifact; `deploy: true` publishes it to the caller's
  `gh-pages`). This repository's `pages.yml` calls it for both instances and deploys oceanmetrics;
  MarineSensitivity/atlas becomes a thin repo calling it at a pinned tag (`docs/mst-thin-repo.md`).
- `oceanmetrics` is https://oceanmetrics.io/atlas/. `marinesensitivity` is the MarineSensitivity
  Atlas (https://marinesensitivity.org/atlas/ once its thin repo publishes it): the 0.10.93 Scores
  lens, Report tool and page, release registry with the access gate, version picker and the MMA seal,
  moved in build week 4 (see `instances/marinesensitivity/README.md`).

## The OBIS layer's URL grammar (obis-hex links)

An obis-hex link maps to the atlas query string
`?c=obis_h3&i=<item>&dim.indicator=<es|sp|shannon|simpson|n>&dim.period=<1990s|2015|all>&res=<auto|1..7>&map=lon,lat,zoom[&taxon=<rank>:<name>|aphia:<id>]&proj=<globe|mercator>`,
with an outlined place as the `p.` token in the hash, or to the Place page when a place is outlined and no layer
view is chosen (build week 4, step 1). The case table is **`tests/fixtures/obis_redirect_cases.json`**: every
obis-hex key and query switch with its target or the reason it is dropped, and the cases (obis-hex URL, expected
URL, `exact`, `dropped`). **Both repos' tests read it**: `tests/state/obisHex.test.ts` here drives
`obisHexToAtlas(url)` (`src/lib/state/obisHex.ts`) and checks that the atlas's own `parseSel` and place codec read
what it writes; obis-hex copies the table into its `tests/redirect.test.ts` for `redirectFor` (step 5). Change the
table here first, then copy it.

**The paper's figures** (obis-hex parity rows 124 to 127, D7): `node scripts/figures.mjs` (`--url https://oceanmetrics.io/atlas/`
for the live site, `--dist <dir>` for a built oceanmetrics dist, `--only <name>`) converts the paper's three obis-hex URLs with
`obisHexRedirect`, adds the `theme` and the `cell` the redirect drops, opens them at 1512×798 in headless Chromium on SwiftShader,
waits for the layer, and writes `docs/shots/figA_atlas_{global_es_2020s,seagrasses_globe,caribbean_cell_res4}.png`;
`tests/figures.test.ts` decodes each URL with `parseSel`. The catalog the page reads gets the obis-h3 collection linked when the
published `catalog.json` does not link it yet.

## The OBIS layer

The obis-h3 release is a collection of the catalog (group `obis`, oceanmetrics instance), drawn by the Collections
lens as H3 hexagons through `@oceanmetrics/map`'s `h3ReleaseSlot` (the release's own Parquet read in MapLibre's
worker), a lazy module (`src/lens/collection/h3/`): the Taxa selector (all taxa, the 7 EOVs), a taxon field over
the release's taxon layers, the indicator, the period strip (decades and years), the resolution (auto or pinned),
the legend from `stats.parquet` (records on a log scale), the coverage line, hover and click, and the Cell pane
with the hexagon's species from the release's species table (CSV). The design, the measurements (hover, the
globe, p95 frame over a 5 s pan, the Monterey zoom 9 bytes) and what is not built yet: **`docs/obis-layer.md`**.

**The Place page link** ("Species on the map", places web): `placeObisUrl({ placeId, name, bbox })`
(`src/lib/state/obisPlace.ts`, tested in `tests/obis/placeLink.test.ts`; the places repo copies it) writes
`https://oceanmetrics.io/atlas/?c=obis_h3&i=all&dim.indicator=es&dim.period=all&res=auto&map=<lon>,<lat>,<zoom>#pl=p.<id>.<name>`:
the OBIS grammar above, `map` the centre of the place's bbox at `log2(600 / span)` clamped to 1..10 (no bbox, no
`map`), and the place as the gazetteer `p.` token written as the atlas codec writes the hash (its `%` as `%25`).
CINMS: `…&map=-119.75,33.725,8.38#pl=p.NMS%253ACINMS.Channel%2520Islands`.

Collections declare their renderers in STAC through `atlas:*` hooks; `src/lib/catalog/hooks.ts` is the
one registry that maps a hook (`atlas:flower`, `atlas:cell_species`, `atlas:taxa_registry`, and `h3`, the platform
profile) to its module.
`unknownHooks` lists a collection's `atlas:*` keys that are neither a registered hook nor a data field.

## The basemap

CARTO's vector style (dark-matter for navy, positron for paper) with the GEBCO 2025 sea floor of `@oceanmetrics/map`:
colour relief and hillshade, isobaths, the GEBCO undersea names and the OSM land mask, the Layers panel's Bathymetry
row (`docs/map.md`, "The GEBCO sea floor"). On by default in the oceanmetrics instance, a choice in marinesensitivity
(`defaults.bathymetry`), dimmed under a data layer, the tiers read through the storage rule. Shots
`docs/shots/gebco-obis-1280-{dark,light}.png` and `gebco-eov-risk-1280-{dark,light}.png`.

**What a first view costs** (2026-10-23, the oceanmetrics instance's own modules on a dev server, a 1280×800 map at one
device pixel on the globe (the app's default projection), a fresh cache, bytes on the wire until idle; the far tier
draws z0-5, core from z6):

| view | CARTO | GEBCO and OSM tiers | total |
|---|---|---|---|
| z2 over the North Pacific (-120, 30) | 70,964 B (4 requests) | 8,914,822 B (44): far 2,938,708, core 2,938,730, contours 1,807,866, land 1,229,518 | 8,985,786 B (8.6 MiB) |
| z8 over the Channel Islands (-119.7, 34.0) | 92,062 B (5) | 1,854,480 B (44): core 1,595,345, contours 116,109, far 88,160, land 30,892, names 23,974 | 1,946,542 B (1.9 MiB) |

At z2 core's z0-5 tiles are fetched beside far's (the same tiles twice, the map package README's "Known" note): a
third of the bytes, which gating core's layers from z6 in the package would save. The marinesensitivity instance
fetches none of it until the Bathymetry row is turned on.

## Build-time configuration (all optional)

`VITE_INSTANCE` (above), `VITE_CATALOG_BASE`, `VITE_FEEDBACK_URL`, `VITE_LOG_URL`, `VITE_GA_ID`, and for
an instance with a release and a seal `VITE_PREVIEW_ATLAS_ROUTE` (`1` once the preview host serves
`/{ver}/atlas/`) and `VITE_SEAL` (`1` shows the instance's seal; anything else, none). They are the inputs of
`.github/workflows/build-instance.yml`, which each caller fills from its own repository variables.
Analytics are off unless `VITE_GA_ID` / `VITE_LOG_URL` are set.

## Docs

`docs/` is partly inherited from upstream (MarineSensitivity/atlas). Each inherited page opens with a
"Status in OceanMetrics Atlas" note saying what does not apply to the oceanmetrics instance (scores,
Program Areas, the Report, the release registry: since build week 4 those are the marinesensitivity
instance's); `mst-thin-repo.md` is the draft of the thin MarineSensitivity/atlas repo and its steps; `gazetteer-places.md` and `mst-by-reference.md` are the current notes for places and for
the MarineSensitivity collections. No page is entirely about a removed feature, so none was deleted.
