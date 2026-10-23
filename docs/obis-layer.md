# The OBIS layer (build week 4, step 5)

The obis-h3 release (OBIS snapshot 2026-10-11, release `v20261012`, obisindicators 0.11) is a collection of the
atlas catalog: `catalog.json` links its stable `collection.json`
(`https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/obis-h3/collection.json`, id `obis_h3`, the platform
`h3` profile 1.1) by absolute href, in the picker group `obis` (the link's `atlas:group`), listed by the
oceanmetrics instance only (decision D2: not the marinesensitivity instance in week 4).

## How it is drawn

- **The hook is the profile.** `src/lib/catalog/h3.ts` (`parseH3`, registered as `h3` in `hooks.ts`) reads the
  profile's fields; nothing in `src/` names the collection id.
- **The renderer is the map package's.** `@oceanmetrics/map` 0.3.2 `h3ReleaseSlot` reads the release's own Parquet
  in MapLibre's worker (`h3r://` tiles, every indicator in each tile, the resolution ladder of the release, never a
  roll-up). The slot is mounted on a style recorder, as `cogSlot` is, and its source and fill go into the one
  composed style (`composeStyle({ h3 })`, roles `h3` and `h3-selected` in the data group).
- **Lazy.** `src/lens/collection/h3/` (the layer, its controls and Cell pane) is imported only when an `h3`
  collection opens; the h3 worker module joins MapLibre's worker then (a second `setupMapLibre({ h3WorkerUrl })`).

| file              | what                                                                                                                                                                                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `view.ts`         | the URL (`i`, `taxon`, `dim.indicator`, `dim.period`, `res`) against what the Item or taxon publishes: the target (templates resolved from the Item's assets, or `taxon_groups.parquet` `url_path`), the period set, the resolution clamp and its note; heads by `heads.json` `served_by`                           |
| `paint.ts`        | the fill (viridis over stats.parquet p02 to p98 per resolution, a step on the zoom in auto; records on a log scale), the legend, the coverage line, the hexagon area, the sentence, the hover                                                                                                                       |
| `periods.ts`      | the period strip: decades and years from `h3:periods`, each bar the hexagons with records at res 3 (stats.parquet `n_cells`), ←/→ and Esc                                                                                                                                                                           |
| `taxa.ts`         | the taxon field: the release's taxon layers by rank (the heads above class first), common names, families only while searching                                                                                                                                                                                      |
| `cellSpecies.ts`  | the Cell pane's species: `species_flat/res=3.parquet` read by the map package's `speciesForCell` (a 256 KiB tail, one reader per page; a coarser hexagon sums its res-3 children exactly; a finer one shows its res-3 parent's), names from `species/species.parquet`, filter, sort, CSV, the line of what was read |
| `layer.svelte.ts` | the wiring: the slot, the reads, hover and click, the style parts                                                                                                                                                                                                                                                   |

Sizes (gzip, `npm run build`, oceanmetrics; static path 432.6 of 450 KB after the 0.3.2 step, workers 143.6 of 150 KB): static path 432.4 of 450 KB (428.9 before step 5: the parser, the
codec keys, the style role, the lens wiring, and the map package's shared modules split into chunks of their
own); the H3 layer's lazy closure 38.9 KB (the layer 5.6, its view, paint, taxa and species modules, hyparquet and
the package's release slot and reader), its controls and Cell pane 6.9 KB more; the h3 worker module 99.7 KB
(`h3Worker-*.mjs`, not in the runtime-worker budget: it is loaded by the lazy layer); the stats reader 0.6 KB.

## The place labels sit above the hexagons

A res-1 to 3 hexagon is large and opaque, and the stock stack draws the basemap's place labels under the data, so the
names were hidden under the fill (found by moving the Labels row above Data in the Layers panel). For this layer the
default stack is `LABELS_ABOVE_DATA_STACK` (`src/lib/map/layerStack.ts`): the stock stack with `basemap-labels` right above
`data-raster`. It is a per-layer default, not a global change: `Shell.svelte` resolves the stack with
`resolveLayerStack(sel.layers, lens.drawsH3)`, so every other layer keeps the stock stack and "Reset layers" restores
the shown layer's own default. `layers=` stays a deviation from that default, so on this layer moving the labels
back under the data is the deviation: the codec keeps a token that equals the stock stack (`parseLayerStack` and
`formatLayerStack` with `keepDefault`; their default, `null` for the stock stack, is unchanged). Tests:
`tests/obis/style.test.ts` ("the Labels row above the data is the h3 layer's default, not the stack's" and the
composed-style order).

## The URL

`?c=obis_h3&i=<all|EOV>&dim.indicator=<es|sp|shannon|simpson|n>&dim.period=<all|1990s|2015>&res=<auto|1..7>&map=lon,lat,zoom[&taxon=<rank>:<name>|aphia:<id>][&cell=<h3>]`,
the place in the hash as the `p.` token. Every atlas URL of the shared case table
(`tests/fixtures/obis_redirect_cases.json`) opens through the atlas's own `parseSel` (`tests/obis/codec.test.ts`)
to the view it names (`tests/obis/view.test.ts`).

## The Place page link

The places Place page's Species section links "Species on the map" to the atlas OBIS layer with the place
selected. The rule is `placeObisUrl` (`src/lib/state/obisPlace.ts`, tested in `tests/obis/placeLink.test.ts`), which
the places web copies as it is:

```
https://oceanmetrics.io/atlas/?c=obis_h3&i=all&dim.indicator=es&dim.period=all&res=auto&map=<lon>,<lat>,<zoom>#pl=p.<id>.<name>
```

- the query is the OBIS layer's grammar above (`i`, `dim.indicator`, `dim.period` as the section shows them; the
  defaults `all`, `es`, `all`);
- `map` frames the place's bbox `[west, south, east, north]`: its centre, and the zoom at which the larger side
  fills two thirds of a 1280 px map, `log2(600 / span)`, clamped to 1..10 (a bbox across the antimeridian has
  east < west or east > 180); no bbox, no `map`;
- `#pl=` is the gazetteer `p.` token (`p.<percent-encoded id>.<percent-encoded name>`, docs/gazetteer-places.md),
  written as the atlas codec writes a hash value (URLSearchParams, so the token's `%` is `%25`).

Example (CINMS): `https://oceanmetrics.io/atlas/?c=obis_h3&i=all&dim.indicator=es&dim.period=all&res=auto&map=-119.75,33.725,8.38#pl=p.NMS%253ACINMS.Channel%2520Islands`.

## Measured (2026-10-23, headless Chromium 1243 on the Mac mini M4 Pro, GPU via ANGLE Metal, 1280 × 800, the live S3 release, cold cache)

Method for the Monterey view and the Cell pane (this step, `@oceanmetrics/map` 0.3.2, the built app under `vite preview`):
a new browser context per run (no HTTP cache), every response body of `obis-h3/` counted from `page.on("response")`
(bytes of the bodies, so a suffix read counts its slice), the pane's own "Read ..." line beside it; the live
`catalog.json` does not link obis-h3 yet, so the run adds the link `root_catalog` writes (`atlas:group: obis`) to the
response. The Cell pane's hexagons are clicked on the map (at the zoom that draws their resolution), "cold" is the first
hexagon of a page, "warm" the second one of the same page (the reader keeps the species table's footer and the names
are read).

| check                                                                                                                 | result                                                                                                                                                                                                                                                                                       | bar                                                                             |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| hover via `queryRenderedFeatures`                                                                                     | the fill's features carry `{h3, es, sp, shannon, simpson, n}` (e.g. `816afffffffffff`: ES(50) 16.97, 39 species, Shannon 2.84, Simpson 0.078, 1,948 records); the hover popup shows the five, the chosen one bold; a click writes `cell=` and its popup links to Details                     | spike 1 did not test hover or click                                             |
| the globe                                                                                                             | the default projection: 145 hexagons rendered at z2 (2020s), drawn and queried on the globe                                                                                                                                                                                                  | one shot, `obis_global_es_2020s_z2_1280_dark`                                   |
| p95 frame over a 5 s pan                                                                                              | Mercator 16.7 ms (p50 16.7, max 16.8, 303 frames); globe 16.8 ms (p50 16.7, max 16.8, 304 frames)                                                                                                                                                                                            | within 1.5 × 16.7 ms                                                            |
| the same under SwiftShader (no GPU)                                                                                   | Mercator 33.4 ms, globe 50.1 ms: the software rasterizer, not the layer                                                                                                                                                                                                                      | (reference only)                                                                |
| Monterey Bay, zoom 9 (res 7), centre `-122.1, 36.75`, 1280 × 800 (the map canvas 1280 × 752), globe or Mercator alike | **162,964 B** in 10 parent files (`all/res=7/p=<res-3 parent>`, 10 requests, each file one suffix read), the same in 3 runs; 0.3.0 read 169,560 B in 11 files; the view's 11 tiles of z9 (x 80 to 83, y 198 to 200)                                                                          | obis-hex 118 KB (7 partitions): **over**, see below                             |
| first view (all, res auto, world)                                                                                     | 352,874 B of obis-h3 (collection, 8 Items, stats footers and groups, 25,665 B of tiles); tiles loaded 1.35 to 1.55 s after navigation (this link, not throttled; measured at 0.3.0)                                                                                                          | ≤ 1 MB, ≤ 1.5 s at 50 Mbit/s: bytes well under, time at the bar                 |
| Cell pane, `8329a9fffffffff` (res 3, Monterey), cold                                                                  | species table **328,895 B (321 KB)** in 2 requests (the 245 KB footer in the 256 KiB tail, then 1 of 370 row groups), 483 to 658 ms (4 runs); plus the names, `species/species.parquet`, once per page: 2,019,399 B in 7 requests, 539 to 1,210 ms, in parallel; the pane reads 0.6 to 1.2 s | ≤ 0.6 MB, ≤ 0.3 s: table bytes under, time **over**; with the names **over**    |
| the same, warm (a second hexagon of the page)                                                                         | **66,751 B (65 KB)**, 1 request (1 row group; the footer kept), 162 to 184 ms (4 runs), no names read                                                                                                                                                                                        | ≤ 0.6 MB, ≤ 0.3 s: **met**                                                      |
| Cell pane, `81197ffffffffff` (res 1, 49 res-3 children, 8,963 species), cold                                          | species table **830,201 B (811 KB)** in 10 requests (9 of 370 row groups), 930 to 1,111 ms (4 runs), plus the names as above when it is the page's first (the pane 0.93 to 1.2 s)                                                                                                            | ≤ 0.6 MB, ≤ 0.3 s: **over**                                                     |
| the same, warm (after a res-3 hexagon: footer kept, names read)                                                       | **568,057 B (555 KB)** in 9 requests (9 row groups), 300, 301, 317 and 388 ms (4 runs)                                                                                                                                                                                                       | ≤ 0.6 MB, ≤ 0.3 s: bytes **met**, time at the bar (median 0.31 s), not under it |

Before 0.3.2 the pane read 819 KB in 12 requests and 2.14 s for the res-1 hexagon and 580 KB in 5 requests and 1.60 s
for the res-3 one (cold, with the footer fetched in 64 KiB pieces). The pane prints what it read, the species table
and, on a page's first hexagon, the names: "Read 321 KB of the species table in 2 requests, 1 of 370 row groups, plus the
names, 1,972 KB, once per page; 1,218 ms." The bytes match the package's own measure in Node (328,895 and 568,057 B).

What is over and why:

- **Monterey z9.** 0.3.2's `tileParents` reads only the parents whose cells touch a tile, and the MVT of every tile is
  the same: 162,964 B in 10 files against 169,560 B in 11. Two things keep it over obis-hex's 118 KB. (1) The browser
  asks 11 tiles of z9 for this view (the map package's count was nine: x 80 to 83, y 198 to 200, so MapLibre 6's cover is
  a tile wider than the 1280 px of the view needs), and two of the 10 files, `832826` (4,944 B) and `832919` (3,314 B),
  come from tiles at the edge of that cover; the other 8 are the files the package's Node measure names (154,706 B).
  obis-hex planned from the view's own bounds. (2) The 118 KB was obis-hex's own 7 partitions, which are 135,373 B in
  today's release, so no plan of tiles or of bounds reads this view under 118 KB.
- **The Cell pane.** A page's first hexagon pays the species table's footer (245 KB of the 321 KB at res 3), and a res-1
  hexagon reads 9 row groups of 10,240 rows for its 77,000 child rows; the names (`species/species.parquet`, 1.97 MB for
  the five columns the list shows, read once per page) are not in the bar's number but are the largest read of a page's
  first hexagon. The release changes the package README names would bring it under: a `species_flat` per resolution
  (`res=1`, `res=2` beside `res=3`), a footer under the 64 KiB tail (split by a coarse parent, no `h3` column), and the
  names sorted by AphiaID in row groups the pane can range-read (or a per-cell index). Until then the bar is met only
  by a res-3 hexagon after the page's first.

## Second pass (2026-10-23): obis-hex's parity rows

The rows of obis-hex `docs/parity.md` that the first pass left open, built in the lazy H3 chunks (the static path is
433.4 of 450 KB for oceanmetrics, 432.8 before; 466.7 of 470 KB for marinesensitivity, 466.5 before). Each one has a
node test (`tests/obis/`), and the behaviour of the built app a hermetic Playwright spec (`e2e/obis.spec.ts`, the
fixture release `tests/fixtures/obis_h3/` served as S3 serves it; run it with
`npx playwright test --project=chromium e2e/obis.spec.ts`).

| what                                                                                                                                                                                                                                                                                                                                      | where                                                                      | test                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------- |
| the title sentence as five chips (taxon, period, place, hexagon size, indicator), each opening its field; a taxon's common name first ("Birds (class Aves)"); "in view (the res-3 parent files under the map)" at a split resolution                                                                                                      | `paint.ts` `sentenceParts`, `placePart`, `withinPart`; `H3Controls.svelte` | `coverage.test.ts`                             |
| the layer list: All taxa, then the 7 EOVs most records first with their counts (the search asset's EOV rows) on a log bar; "What defines each EOV?" (IOOS); the generic Taxa select is not shown for an h3 collection                                                                                                                     | `taxa.ts` `layerRows`; `CollectionLens.svelte`                             | `taxa.test.ts`                                 |
| the colour range of the loaded hexagons (`dom=view`, a new codec key): p02 to p98 of the cells in the map's loaded tiles at the drawn resolution (`querySourceFeatures` on idle, deduplicated), DuckDB `quantile_cont`'s rule                                                                                                             | `share.ts` `viewDomain`; `layer.svelte.ts` `readLoaded`                    | `legend.test.ts`, `codec.test.ts`              |
| a pinned res 6 or 7 over a view that needs more than 64 parent files (its area over a parent's) draws a coarser one and says so                                                                                                                                                                                                           | `share.ts` `pinForView`                                                    | `resolution.test.ts`                           |
| the status line ("Loading the release…", "No hexagons in this view.", "No OBIS records for Seabirds in the 1960s in this view.", "The release could not be read: …")                                                                                                                                                                      | `paint.ts` `statusLine`                                                    | `coverage.test.ts`                             |
| the footer line: the OBIS and WoRMS dates, the release, the resolution and the app, from `release.json` (the collection's `release` asset)                                                                                                                                                                                                | `share.ts` `footerText`, `releaseMetaOf`                                   | `share.test.ts`                                |
| Cite this data (the collection's `sci:citation`, else the release's own line, then OBIS's), Reproduce (DuckDB SQL over the layer's own file for the drawn resolution and period, the selected hexagon by `cell_id`; a split resolution lists its files from `files.parquet`), Data sources and attribution, About this layer and its keys | `share.ts`; `H3Controls.svelte`                                            | `share.test.ts`, `keys.test.ts`                |
| the `g` key (globe or flat; never while typing, with a modifier, or under a dialog or the tour), listed in Help with the layer's entry ("This layer: sources, citation, keys")                                                                                                                                                            | `share.ts` `h3ShortcutFor`; `Shell.svelte`                                 | `keys.test.ts`, e2e 'help entries'             |
| seven tour stops after Layers when the layer is an h3 one, a lazy chunk                                                                                                                                                                                                                                                                   | `src/shell/tourH3.ts`, `tour.ts` `tourStepsForLens`                        | `tour.test.ts`                                 |
| the About modal's section for the layer (its description, the release and its inputs, the MBON credit)                                                                                                                                                                                                                                    | `share.ts` `aboutLines`; `About.svelte`                                    | `share.test.ts`, e2e 'about names the release' |
| the map PNG stamped with the title sentence, the release as its version (`<prefix>_collection_<title>_v20261012_<date>.png`) and the colour scale in the indicator's format                                                                                                                                                               | `share.ts` `pngStamp`; `Shell.svelte`                                      | `share.test.ts`, e2e 'download png'            |
| the period strip folds (a per-viewer convenience in localStorage) and resizes between 48 and 240 px                                                                                                                                                                                                                                       | `H3Controls.svelte`                                                        | e2e 'strip fold'                               |
| the Cell pane's error line links OBIS's checklist of the hexagon's box (the tile pieces that draw it)                                                                                                                                                                                                                                     | `share.ts` `obisChecklistUrl`, `boxOfRings`                                | `share.test.ts`                                |
| the 13 seas and oceans of obis-hex as camera presets; a sea writes its camera and clears the places, their filter and the hexagon                                                                                                                                                                                                         | `placeFilter.ts` `SEAS`, `seaPatch`                                        | `place.test.ts`, e2e 'a sea clears the place'  |
| a release's dry run through `?catalog=` (a staging catalog linking a staging collection: every template, the legend, the search asset and `release.json` from it, nothing from the stable one)                                                                                                                                            | the catalog loader, `h3.ts`                                                | `catalog.test.ts`, e2e 'catalog override'      |

## The place filter

The Places tool's "Only inside places" (`filter=places`) on an h3 layer keeps the hexagons of the hash's gazetteer
places (`#pl=p.<id>.<name>`), by the gazetteer's place x H3 membership, as obis-hex's `f=` did: a place's collection
(the built-in `places` authorities by prefix, else the feature's own) and its layers.json `h3` url
(`<slug>/h3/membership.json`, re-based on the bucket host: `gazetteer/resolve.ts` `placeMembership`), then the
membership files of the drawn resolution: one whole file up to res 5, the files of the place's own parents (its cells
at `parent_res`) for res 6 and 7 (`placeFilter.ts`). Every row of a file counts: the gazetteer keeps a cell when 1% of
it is inside the place or it holds 1% of the place. The fill's filter is the layer's own and `h3` in the list (nothing
drawn while the membership loads, never the unfiltered view); the resolutions read so far are kept, so a zoom across a
resolution change shows the next as soon as it is read. Past 60,000 hexagons the filter says to zoom out or pin a
coarser size. The sentence says "in Channel Islands (statistics of its hexagons)", the coverage line counts the
place's loaded hexagons ("124 of 138 hexagons in the place have ≥ 50 records", CINMS at res 6), and the filter's line
says these are statistics of the hexagons, not the place's own values, which the Place page has. A drawn or uploaded
place has no membership and says so. No polygon is read in the browser.

### A whole collection as the filter (`filter=coll:<slug>`, obis-hex `f=<collection>`)

The select "Only inside a collection" in the layer's Place field (the polygon collections of `index/layers.json` that
have an `h3` build, by title) writes `filter=coll:<slug>` (a gazetteer slug: `[a-z0-9][a-z0-9_-]*`, anything else is
dropped on read; `parseFilter`, `filterColl`). The hash's places are not needed. The filter reads the collection's
`membership.json` and, for the drawn resolution, **every file of that resolution** with no place named
(`readMembershipCells(url, null)`: the hexagons of every place, a shared one once): `<slug>/h3/res=5/membership.parquet`
up to res 5, and for res 6 and 7 all the parent files (`collectionPlan`; no polygon in the browser). The sentence says
"in NOAA National Marine Sanctuaries (statistics of its hexagons)", the coverage line "108 of 161 hexagons in NOAA
National Marine Sanctuaries have ≥ 50 records" (`filteredCoverage`), the status line "No hexagons in <title>.", and the
filter's line says these are statistics of the hexagons, not any place's own values.

**The cap.** The plan is counted from `membership.json` before a byte is read (each file lists `rows` and `bytes`): a
resolution over `COLLECTION_MAX_CELLS` = 500,000 membership rows, or over `COLLECTION_MAX_BYTES` = 5 MB, is not read and
the line says "<title> has too many hexagons at res N to filter by (over 500,000 membership rows): filter by one place
instead, or pin a coarser hexagon size." Measured on the 36 collections of the gazetteer that have an H3 build
(2026-10-23, `membership.json` sizes, then the reads below): a file costs 2.4 to 11 bytes a row (about 8 on the densest
large one, `noaa_state_submerged_lands` res 7: 145,680 rows, 1.2 MB), so 500,000 rows are 1.2 to 5.5 MB and the
largest read under the cap is 1.2 MB; `noaa_sanctuaries` is 6,584 rows and 25 KB at res 5 (the whole read at res 3 is
3.4 KB); `noaa_efh` is 36,606 rows at res 3 (88.6 KB read), 181,590 at res 4 (225 KB read) and 1,036,984 at res 5
(3.8 MB, over by rows: not read). `mr_eez` has no H3 membership in the gazetteer today (`layers.json` `h3: null`,
its `membership.json` answers 403), so the line says "no H3 membership in the gazetteer, so no hexagons". The
manifest is itself a read: 52 KB for `noaa_sanctuaries` and 292 KB for `noaa_efh` (a file row per parent). The 60,000
hexagons the map's filter holds (`FILTER_MAX_CELLS`) still apply after the read: the sanctuaries at res 7 read 214 files (215 requests, 1.10 MB with the manifest, 7.2 s) and then say "Too many hexagons at res 7" (302,343 rows); at res 6, 60 files, 61 requests, 242 KB with the manifest, 3.8 s, 43,916 hexagons drawn. (Found by that run: `push(...cells)` over 302,343 cells overflowed the stack and froze the note; `allCells` loops, regression test in `place.test.ts`.)

Tests: `tests/obis/codec.test.ts` ('filter=coll:<slug> round-trips'), `tests/obis/place.test.ts` (the plan, the cap's
edges, the words, the collection's membership and the choices), `tests/obis/coverage.test.ts` ('the coverage line of a
filter'), `e2e/obis.spec.ts` (the select and its words; a collection over the cap reads no file). Shot
`obis_coll_filter_sanctuaries_1280_light` (the sanctuaries' res-3 hexagons off California, 108 of 161 with ≥ 50 records).

## Still open after the second pass

- **Bytes in the footer** (parity row 80). The tiles are read in MapLibre's worker by the map package's
  `releaseReader`, which keeps its `stats` (bytes, requests) but has no message to the page, and a worker's
  resource timings are not the page's. The footer has every other part of obis-hex's line. Needs a map package
  change (a `h3r-stats` request or a worker message, with the page's own readers added): about 2 hours in
  `oceanmetrics/platform` plus the atlas wiring, then a re-measure.
- **Monterey zoom 9 and the Cell pane bars** (rows 30, 63): unchanged, measured above.
- **The WoRMS subtree** (rows 7, 9, 10, 11): designed below, not built (over a day).

### The WoRMS subtree, in the page (design; estimate 1.5 to 2 days)

What obis-hex's h3t service did for any AphiaID, from the release's own species tables, through the DuckDB-WASM engine
the atlas already ships (`src/lib/engine/`, lazy, the `parquet` extension self-hosted; no `h3` extension).

1. **Search all of WoRMS** (row 9). The names a search can serve without a service: the species lookup
   (`species/species.parquet`: `species`, `genus`, `family`, `order`, `class`, `phylum`, `lineage`; 1.97 MB for the
   name columns, once per page, the Cell pane already reads it) and the heads (`heads.json`). An intermediate rank
   (infraorder Cetacea, suborder, tribe) has no row: its name and AphiaID come from the WoRMS REST API
   (`https://www.marinespecies.org/rest/AphiaRecordsByName/<name>?like=true&marine_only=true`, CORS-open, live), which
   also gives the status and the accepted name of a synonym (row 10's line and its "in WoRMS" link). Two letters,
   250 ms debounce, 20 hits, accepted first: the rule of obis-hex's `AphiaSearch`, its tests moved.
2. **The subtree's cells** (rows 7, 11). For AphiaID `a`: the taxa `SELECT aphiaid, name_key, class FROM lookup WHERE
list_contains(lineage, a)` (the lookup's `lineage` is self first, then the ancestors), then the class partitions
   those taxa fall in, `species/res=<r>/class=<c>/data_0.parquet` (res 3, 4 and 5 only: the table's resolutions),
   read whole (Cetacea is Mammalia: 0.28 MB at res 3, 0.76 MB at res 4, 1.94 MB at res 5; Aves 1.5 / 3.4 / 7.6 MB;
   Teleostei 4.9 / 8.2 / 13.8 MB, so a fish subtree caps at res 4 and res 5 only with the view's box, `cell_id`
   ranges of the viewport's parents, as `tileRanges` forms them), with `n` summed per (cell, name_key) and per cell
   the five indicators in SQL: records `sum(n)`, richness `count(DISTINCT name_key)`, Shannon and Simpson over the
   name shares, ES(50) `sum(1 - exp(lgamma(N-n_i+1) + lgamma(N-50+1) - lgamma(N-n_i-50+1) - lgamma(N+1)))` where
   `N >= 50`. A decade reads `species_decade/res=<r>/decade=<d>/class=<c>/` (res 3 and 4). Res 1 and 2 roll res 3 up
   by the parent's `cell_id` bits (the indicators recomputed from the summed (cell, name) counts, never averaged).
   The cap: res 5 at most, the view's box from res 5 (obis-hex: res 7 with a bbox; the release has no species table
   past res 5), a class set over 25 MB (the engine's `MATERIALIZE_MAX_BYTES`) refused with a line that says which
   resolution would serve it.
3. **Drawing them**. The cells go back to the map package's own renderer: DuckDB writes them sorted by `cell_id`
   as Parquet (`COPY ... TO 'subtree_<res>.parquet'`), handed to the slot as a `blob:` url per resolution in a
   one-layer `H3CollectionLike` (the `h3r://` worker reads it by range like any release file; to be proven: Range on a
   `blob:` url in the worker, else a whole-file read, which these sizes allow). The legend is the loaded hexagons'
   (`dom=view`, built in this pass: a subtree has no stats.parquet), the coverage line counts the subtree's cells, the
   sentence's taxon chip reads "Whales and dolphins (infraorder Cetacea, WoRMS)".
4. **Tests and shots**: a species-table fixture (a class partition trimmed to two res-3 parents) for the SQL (spike
   2's rows, `_none`, a name shared by two AphiaIDs), the search parser over a recorded WoRMS answer, the cap and its
   words, an e2e search-and-draw on the fixture; shots `obis_cetacea_res4` and `obis_worms_search`.

Estimate: search and the taxon line 0.5 day; the SQL, its tests and the cap 0.5 day; the blob hand-off to the slot
and its proof 0.25 to 0.5 day; words, e2e and shots 0.25 day. 1.5 to 2 days.

## Not built yet

- `taxon=aphia:<id>` for a taxon that is no head, and "Search all of WoRMS": designed above. The layer says the id is
  not one of the release's precomputed taxa.
- The view as places (obis-hex `v=places`, waiting on Ben's word to drop). A whole collection as the place filter is
  built (`filter=coll:<slug>`, above); obis-hex's `f=<coll>|<id>,<id>` (a collection and some of its places) is the
  places filter with `#pl=`.
- The decade filter of the Cell pane is the species whose first and last years span the period (their records
  are every year's); the per-decade species table (`species_decade/`, class-partitioned) is not read.
- An EOV's or a head's species list is every taxon's (the lookup has no EOV column and no ranks above phylum);
  the pane says so.
- obis-hex's "Register a product" (Help) and its Start here card (row 94, Ben's word).

## Shots of the second pass (`docs/shots/obis_*`, headless Chromium on the Mac mini, the live release)

`obis_sentence_layers_1280_light` (the chips and the EOV list with counts), `obis_sentence_390_light` (phone),
`obis_domain_view_seabirds_1990s_1280_dark` (the loaded hexagons' range, 7.55 to 19), `obis_cinms_outline_1280_light`
(CINMS outlined over species richness, res 6 "in view", its credit in the attribution), `obis_cinms_filtered_1280_dark`
(the filter: 138 res-6 hexagons, "124 of 138 hexagons in the place have ≥ 50 records"), `obis_places_filter_switch_1280_dark`
(the Places tool's switch on the layer), `obis_res7_wide_note_1280_light` (res 7 pinned over the California Current:
res 5 drawn, the note), `obis_status_no_records_1280_light` (sea turtles, 1960s, Svalbard), `obis_cite_reproduce_1280_dark`,
`obis_sources_about_1280_light`, `obis_help_layer_1280_dark`, `obis_about_layer_1280_light`, `obis_tour_h3_layer_1280_dark`
(stop 5 of 13), `obis_sea_gulf_of_maine_1280_light`, and the downloaded figure `obis_png_seabirds_1990s_1280_dark`.
