# The OBIS layer (build week 4, step 5)

The obis-h3 release (OBIS snapshot 2026-10-11, release `v20261012`, obisindicators 0.11) is a collection of the
atlas catalog: `catalog.json` links its stable `collection.json`
(`https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/obis-h3/collection.json`, id `obis_h3`, the platform
`h3` profile 1.1) by absolute href, in the picker group `obis` (the link's `atlas:group`), listed by the
oceanmetrics instance only (decision D2: not the marinesensitivity instance in week 4).

## How it is drawn

- **The hook is the profile.** `src/lib/catalog/h3.ts` (`parseH3`, registered as `h3` in `hooks.ts`) reads the
  profile's fields; nothing in `src/` names the collection id.
- **The renderer is the map package's.** `@oceanmetrics/map` 0.3.3 `h3ReleaseSlot` reads the release's own Parquet
  in MapLibre's worker (`h3r://` tiles, every indicator in each tile, the resolution ladder of the release, never a
  roll-up). The slot is mounted on a style recorder, as `cogSlot` is, and its source and fill go into the one
  composed style (`composeStyle({ h3 })`, roles `h3` and `h3-selected` in the data group).
- **Lazy.** `src/lens/collection/h3/` (the layer, its controls and Cell pane) is imported only when an `h3`
  collection opens; the h3 worker module joins MapLibre's worker then (a second `setupMapLibre({ h3WorkerUrl })`).

| file              | what                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `view.ts`         | the URL (`i`, `taxon`, `dim.indicator`, `dim.period`, `res`) against what the Item or taxon publishes: the target (templates resolved from the Item's assets, or `taxon_groups.parquet` `url_path`), the period set, the resolution clamp and its note; heads by `heads.json` `served_by`                                                                                                                                                                                                                                                          |
| `paint.ts`        | the fill (viridis over stats.parquet p02 to p98 per resolution, a step on the zoom in auto; records on a log scale), the legend, the coverage line, the hexagon area, the sentence, the hover                                                                                                                                                                                                                                                                                                                                                      |
| `periods.ts`      | the period strip: decades and years from `h3:periods`, each bar the hexagons with records at res 3 (stats.parquet `n_cells`), ←/→ and Esc                                                                                                                                                                                                                                                                                                                                                                                                          |
| `taxa.ts`         | the taxon field: the release's taxon layers by rank (the heads above class first), common names, families only while searching                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `cellSpecies.ts`  | the Cell pane's species: `cellPlan` picks the file from `obis:species.flat` (res 1 and 2 their own `species_flat/res={res}.parquet`; res 3 the file of its res-1 parent, `res=3/p=<parent>.parquet`, a 64 KiB tail, read as a file, not a hive dataset; a finer hexagon its res-3 parent's; `res=3.parquet` only without a split), read by the map package's `speciesForCell` (the row groups by `cell_id` statistics), names, ranks and `eov` from `species/species.parquet` (whole, once per page), filter, sort, CSV, the line of what was read |
| `layer.svelte.ts` | the wiring: the slot, the reads, hover and click, the style parts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `subtree.ts`      | the WoRMS subtree's rules: the taxa from `species/lineage.parquet`, their class files from the lookup's `class` (`classesOf`), obisindicators' indicator SQL (ES(50) by `lgamma`), the roll-up to res 1 and 2, the view's box at res 5, the cap and the words                                                                                                                                                                                                                                                                                      |
| `subtreeRun.ts`   | the subtree's runner (lazy): DuckDB-WASM over the lineage file and the class files (the lookup's class columns by range reads beside it), the cells COPY'd to Parquet, a `blob:` url for the slot                                                                                                                                                                                                                                                                                                                                                  |
| `worms.ts`        | the WoRMS REST API: "Search all of WoRMS" (`AphiaRecordsByName`, `like=true`), the record of an AphiaID, a `rank:name` resolved                                                                                                                                                                                                                                                                                                                                                                                                                    |

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

- **Monterey zoom 9 and the Cell pane bars** (rows 30, 63): measured above. The footer (below) now reads the Monterey
  view at z9 as 9 requests and 135.1 KB, the same bytes as the page's own responses of `all/res=7/` (135,141 B); the
  bar is obis-hex's 118 KB.
- **Bytes in the footer** (parity row 80): built with `@oceanmetrics/map` 0.3.3 (below).
- **The WoRMS subtree** (rows 7, 9, 10, 11): built (below).

### The footer's tile costs (parity row 80, `@oceanmetrics/map` ^0.3.3)

The release slot's `stats()` (the map package's worker posts one message per built tile on `BroadcastChannel('om-h3')`,
the slot totals its own) is fed to the layer by `onStats`, at most once per animation frame (`share.ts`
`feedTileStats`; a view loads tens of tiles), and the footer carries "N requests, X KB in Y ms, Z row groups skipped"
(`tilesLine`, KB of 1,000 bytes, the ms the sum of the tiles' own reads) before the app: "OBIS 2026-10-11 · WoRMS
2026-10-01 · release v20261012 · res 7 (auto) · 9 requests, 135.1 KB in 3,163 ms, 0 row groups skipped · OceanMetrics
Atlas 0.5.0" (Monterey Bay at z9, the live release). The counts are the slot's since it was mounted (an indicator
change resets nothing; a new layer or taxon is a new slot); a subtree's slot counts its `blob:` file ("1 request,
8.4 KB in 179 ms"). Tests: `tests/obis/share.test.ts` ("the footer's tile costs": the line, the footer, and the feed
with a stubbed `onStats`: one write per frame, none after it stops). Shot `obis_footer_tiles_1280_light`.

### The WoRMS subtree, in the page (built 2026-10-23; parity rows 7, 9, 10, 11)

What obis-hex's h3t service did on a server for any AphiaID, the page now does from the release's own species table,
through the DuckDB-WASM 1.32 engine the atlas already ships (`src/lib/engine/`, its own lazy instance; the `parquet`
extension self-hosted). No h3t, no service of our own: WoRMS's REST API names the taxon, the species lookup's
`lineage` holds the descendants (WoRMS's `AphiaChildrenByAphiaID` is never asked).

**The URL.** `taxon=aphia:<id>` for an AphiaID that is no head (`heads.json`: a head stays the release's own layer), and
`taxon=<rank>:<name>` for a taxon the release has no layer for (`infraorder:Cetacea`, resolved by WoRMS's
`AphiaRecordsByName/<name>?like=false` at that rank). The case table's `aphia:` cases (`l=aphia:137092` of obis-hex) open
the subtree instead of the "heads only" note (`tests/obis/subtree.test.ts` "the case table's aphia cases open the
subtree", `tests/obis/view.test.ts` "an AphiaID that is no head is a subtree computed in the page").

**The steps** (`subtree.ts`, the rules, Node-tested on DuckDB-WASM's own engine; `subtreeRun.ts`, the runner, lazy):

1. WoRMS's record (`AphiaRecordByAphiaID/<id>`): name, authority, rank, status; a synonym's subtree is its accepted
   AphiaID's, and the taxon line says so.
2. The lineage (`species/lineage.parquet`, 1,678,360 B since obisindicators 0.12: `aphiaid, name_key, lineage`, whole,
   once per page, registered in the engine from a copy, `Engine.loadBytes`; a release without it: the whole lookup, as
   before): the taxa `list_contains(lineage, <id>)`; the classes they fall in and their records from the lookup's
   `aphiaid, class, records` columns (`classesOf`, the rule of `subtreeClassesSql`; range reads of those columns,
   started beside the lineage, or out of the whole lookup when the page's Cell pane has read it; a NULL class is
   `_none`, `obis:species.null_class`).
3. The class files at the table resolution: `species/res=<r>/class=<c>/data_0.parquet` (a class with a space is
   `%2520` in the url, as the store holds it), or `species_decade/res=<r>/decade=<d>/class=<c>/` for a decade
   (`obis:species.decade`, res 3 and 4). Their sizes by HEAD (Content-Length, exposed by the bucket's CORS) are summed
   before a byte is read: over 25 MB (the engine's `MATERIALIZE_MAX_BYTES`) the subtree is refused with its estimate
   and the coarser resolution that would serve it ("The subtree of X at res 5 would read 30.0 MB of the species table
   (2 files), over the 25.0 MB the page reads at once: pin res 4 (12.00 MB) or coarser."). No single-class subtree
   of v20261012 is over it (the largest class file is Teleostei's res 5, 13.8 MB), so on the live release the line
   is a guard; a taxon spanning classes is a head.
4. The files, whole (`Engine.load`, kept registered: a zoom back or a pan reads nothing again; past 32 MB loaded the
   oldest files the current taxon and resolution do not use are dropped, "Eviction" below), then obisindicators'
   own SQL ported as it is (`.h3t_indicators_sql()` over `obis_h3_species_subtree_sql()`'s source: the rows joined to
   the lookup, `n` summed per (cell, `name_key`), so richness counts names; Shannon and Simpson over the shares; ES(50)
   `1 - exp(lgamma(N-n_i+1) + lgamma(N-50+1) - lgamma(N-n_i-50+1) - lgamma(N+1))`, 1 for a species that leaves fewer
   than 50, NULL under 50 records). Res 1 and 2 take res 3's rows to the parent's cell id by its bits
   (`parentIdSql`; DuckDB-WASM has no h3 extension), the counts summed and the indicators recomputed. From res 5 the
   rows are those of the view's box: the view grown by a quarter and rounded out to half degrees (obis-hex's
   `subtreeBbox`), its cell_id ranges formed as the map package's worker forms a tile's (`tileRanges` over the box's
   tiles), and recomputed only when the view leaves the box.
5. The cells `COPY`'d to Parquet (`Engine.exportParquet`, sorted by `cell_id`, row groups of 10,240) and handed to the
   map package's own renderer as a one-resolution `H3CollectionLike` whose template is a `blob:` url
   (`subtreeTarget`, no stats.parquet). **The path is the blob url, not the in-memory fallback**: Chromium answers a
   Range request on a `blob:` url in a worker with 206 and Content-Range (a suffix range `bytes=-65536` too; checked
   alone first, then end to end), so the `h3r://` reader in MapLibre's worker opens it as it opens a release file,
   and the tiles carry all five indicators (the in-memory `h3Slot` carries one value per cell: no five-indicator
   hover, no Cell pane values). A 200 with the whole file would work as well (the reader takes it). The page revokes a
   blob url two computations later (the worker may still read the one before).

**What it shows.** The sentence's chip "Whales and dolphins (infraorder Cetacea, WoRMS)" (a common name first, else the
name), at res 5 "in view (the view's box at res 5)"; under the taxon field the line "subtree of Cetacea (computed in
the browser from the species table, res ≤ 5)", the taxon line ("Cetacea Brisson, 1762 · infraorder · accepted ·
2,339,779 records · in WoRMS ↗"; a synonym adds "accepted name …, whose subtree is shown"), and what was read ("Read
0.26 MB of the species table (1 file) and the lookup (3.90 MB, once per page); 15,617 hexagons in 1,486 ms."). The
legend is the computed cells' p02 to p98 (`quantile_cont`, the release's rule; "subtree p02–p98"; records on the log
scale), or the loaded hexagons' with `dom=view`; the coverage line "1,755 of 15,617 hexagons of the subtree have ≥ 50
records"; the status line "Computing the subtree of Cetacea in the browser…", the refusal, or "The subtree could not
be computed: …". The Cell pane reads the hexagon's five values from the same blob and keeps the species of the subtree
(the lookup's lineage) in its list; Reproduce is the subtree's SQL over the release's own urls (DuckDB with httpfs). A
pin past the cap is res 5 (4 with a decade) and says so; auto past zoom 7 stays at res 5 and says so. "Search all of
WoRMS" (row 9): `AphiaRecordsByName/<text>?like=true&marine_only=true`, 2 letters, 250 ms after the last key, 20 hits,
the accepted names first, a synonym with "→ <accepted name> (<AphiaID>)" (`createWormsSearch`); a pick writes
`taxon=aphia:<id>` on the all-taxa item (a decade kept, a year dropped).

**Parity with the release** (the week 4 export proved obisindicators' head equals its subtree SQL; this proves the port):

- `tests/obis/subtree.test.ts` runs the SQL on DuckDB-WASM 1.32's own engine (the in-process node build): a
  hand-computed 3-cell fixture (n, sp by name, Shannon, Simpson, ES(50) by exact binomials; a name under two AphiaIDs,
  a taxon outside the lineage, a NULL class, the roll-up, the box) and the real cell 831914fffffffff of Animalia
  at res 3 (227 rows of every class, 146 in Animalia): n 2,086 and sp 146 exactly, Shannon and Simpson to 1e-12,
  ES(50) 16.2897650257 against the head's 16.2897650254 (2e-11 relative).
- **Animalia at res 3, cell for cell, in the browser**: `runSubtree` (the built chunk) for AphiaID 2 in headless
  Chromium against the live release read the lookup and 99 class files (18,664,955 B, 199 requests, 23.7 s cold) and
  wrote 36,854 cells; against the published head `taxon/rank=kingdom/taxon=Animalia/res=3`: 36,854 = 36,854, none
  unmatched, `n` and `sp` equal in every cell, ES(50) NULL in the same cells, Shannon within 5.7e-13 and Simpson 2.6e-14,
  ES(50) within 2.3e-5 absolute (4.2e-6 relative; 429 cells past 1e-9 relative, all with N in the millions, where the
  four `lgamma` terms are about 7e7 and the browser's libm rounds them differently from the native build's; the two
  decimals shown never differ). The same SQL in native DuckDB 1.5.6 over the same files: every cell equal to 1.8e-13
  (res 3, 36,854 cells) and 3.1e-13 (res 2 through the roll-up, 5,789 cells).

**Measured** (2026-10-23, headless Chromium 1243 on the Mac mini M4 Pro, ANGLE Metal, 1280 × 800, the built app under
`vite preview`, the live S3 release, a new browser context per run (cold cache), three runs each; "page" is from
navigation to the read line, which includes the app's and DuckDB-WASM's boot; "compute" is the read line's own time,
from the lookup's read to the blob url):

| subtree, view                                  | species table read                                          | lookup      | hexagons | compute (ms)        | page (s)         |
| ---------------------------------------------- | ----------------------------------------------------------- | ----------- | -------- | ------------------- | ---------------- |
| Cetacea (2688), res 3, world (`map=-150,30,4`) | 276,067 B (`class=Mammalia`, 1 file)                        | 4,086,019 B | 15,617   | 1,486, 1,532, 1,501 | 3.94, 3.94, 3.92 |
| Cetacea, res 4, world                          | 755,665 B (1 file)                                          | 4,086,019 B | 52,203   | 1,562, 1,438, 1,691 | 3.44, 3.43, 3.97 |
| Cetacea, res 5, Monterey Bay's box (z6.5)      | 1,938,991 B (1 file, read whole; the box keeps 1,905)       | 4,086,019 B | 1,905    | 1,698, 1,656, 1,632 | 3.94, 3.92, 3.98 |
| Teleostei (293496), res 3, world               | 5,170,744 B (`class=Teleostei` 4,938,095 + `_none` 232,649) | 4,086,019 B | 21,819   | 2,581, 2,430, 2,143 | 4.93, 4.45, 4.43 |

In one page (warm: the lookup and the files kept), Cetacea res 3 → 4 read 0.72 MB in 0.66 s, 4 → 5 1.85 MB in 0.69 s,
and back to 3 or 4 nothing, 36 and 58 ms (the SQL alone). A subtree's tiles are one small file (Cetacea res 1: 1
request, 20.6 KB). The first reader of a page pays the lookup (4.09 MB, the whole file, once: the subtree's lineage filter and the Cell pane's names are read from the same bytes, below).

**Sizes**: the static path is unchanged (434.6 to 434.7 KB of 450: the Details title follows the taxon); the H3 layer's
chunk 7.5 to 13.0 KB gzip (the subtree's rules, the WoRMS client, the wiring), its controls 5.3 to 6.3 KB, the runner
1.6 KB more and the engine's own lazy chunks, loaded the first time a subtree is asked.

**Tests and shots**: `tests/obis/subtree.test.ts` (the SQL, the files, the cap and its words, the box, the case table),
`tests/obis/worms.test.ts` (WoRMS's answers recorded on 2026-10-23, a stubbed fetch, the debounced field),
`tests/obis/subtreeLayer.svelte.test.ts` (the wiring in the real runes layer with a stubbed runner and WoRMS: the
chip, the line, the legend, the coverage, a head stays a head, a rank:name, the pin and the decade, the refusal, the
status, a pick), `e2e/obis.spec.ts` "the WoRMS subtree: search, pick, computed in the page" (hermetic: the fixture's
`species/res=3/class=Mammalia` and a lookup with `lineage`, WoRMS routed; 832834fffffffff's richness 22 read back from
the tiles the worker built from the blob). Seeded faults `obis-subtree-es-small-term-dropped`,
`obis-subtree-sp-counts-aphiaids`. Shots `obis_worms_cetacea_1280_dark` (res 3 off the US east coast, the taxon
block), `obis_worms_search_1280_light` ("Delphin": accepted names first, synonyms with their accepted AphiaID),
`obis_worms_cell_390_dark` (phone, 832834fffffffff: ES(50) 5.86, 22 species, 63,741 records, the subtree's species).

**The lookup, read once per page** (2026-10-23, `src/lens/collection/h3/lookup.ts`). The subtree read the lookup whole (4.09 MB) and
the Cell pane read its name columns again by range requests (1.97 MB in 7 requests); now one lazy loader fetches the
file once and hands the same bytes to both: the subtree registers a copy in DuckDB-WASM (`Engine.loadBytes`; the
database takes the array over, so it gets a copy), the pane parses its names and ranks from the buffer (`readLookup(spec, buffer)`).
Whoever asks first fetches, whoever asks second (or at the same moment) gets the same promise; a failed read is
forgotten. The read lines say "once per page" on the reader that made the read only. Measured in headless Chromium
1243 against the live release (the built app under `vite preview`, a fresh context, the catalog routed to link the
obis-h3 collection, 1280 x 900; `species/species.parquet` requests counted with Playwright's `request.sizes()`),
Cetacea at res 3 (`map=-150,30,4`) and then a click on a hexagon to open the Cell pane:

| flow                                        | requests for `species.parquet` | bytes     |
| ------------------------------------------- | ------------------------------ | --------- |
| Cetacea subtree, then the Cell pane, before | 8 (1 whole, 7 ranges)          | 6,105,418 |
| Cetacea subtree, then the Cell pane, after  | 1                              | 4,086,019 |
| Cell pane alone (`cell=`), before           | 7 (ranges)                     | 2,019,399 |
| Cell pane alone (`cell=`), after            | 1                              | 4,086,019 |

The page that does both saves 2,019,399 B and 7 requests; the page that only opens a Cell pane now reads 2.07 MB
more (the whole file, not its name columns): the price of one read for both, chosen so a subtree after a pane does not read the
file again either (a release that splits the lineage into its own small file would take it back). The pane's line no
longer says "plus the names, 1,972 KB" after a subtree (the subtree's line carries the lookup's bytes); alone it says 3,990 KB.
Test: `tests/obis/subtreeCache.test.ts` ("the lookup is read once per page": a subtree then the pane's names, the pane then a subtree, both at
once, a failed read retried; a stubbed fetch counts the GETs). Seeded fault `obis-lookup-read-twice`.

**Eviction** (`src/lens/collection/h3/subtreeCache.ts`). The class files stay registered in DuckDB-WASM after a computation
(a zoom back reads nothing). Past a cap of 32 MB of loaded class files (their byte sizes as the store recorded them; the
lookup is not counted), the tables of the files not used by the current taxon and resolution are dropped
(`Engine.drop`, the store's registration and the database's file), least recently used first, never a file a
computation in flight holds (each run holds its files from its first byte to its last query, so a second run's
trim cannot take what the first is reading). One taxon's files are at most 25 MB (the page's own cap), under the 32.
The read line says what is held: "Read 0.26 MB of the species table (1 file) and the lookup (3.90 MB, once per page);
15,617 hexagons in 1,483 ms. 0.26 MB of species tables loaded; older ones are dropped past 32 MB." (a drop adds
"Dropped 2 older files (14 MB)."). Dropped files are freed in the engine; the WASM heap itself does not shrink, it is
reused. Test: `tests/obis/subtreeCache.test.ts` (a stub engine with three files and a small cap: the oldest goes, the current stays; use order, not
registration order; a held file stays; a current set over the cap alone is kept; the runner dropping
across three taxa and a zoom back reading nothing). Seeded fault `obis-subtree-drops-held`. Not exercised live: no
one session of the live release goes over 32 MB without many taxa (Teleostei res 3 to 5 is 27 MB).

**Still open**: records in the search hits (obis-hex showed the subtree's records per hit; WoRMS's search has none, the taxon line has them once picked); res 6 and 7 (the species table stops at res 5).

## obisindicators 0.12's files (2026-10-24, atlas `b64c857`)

obisindicators 0.12 amended v20261012 additively (`obis:species` in the stable collection): `species_flat/res=1.parquet`
and `res=2.parquet` (the res-3 rows summed by parent, no `h3`), `species_flat/res=3/p=<res-1 parent>.parquet` (842
files, median 9.6 KB, 728 whole in a 64 KiB tail; `parent_template`, `parent_res {"3": 1}`), `species/lineage.parquet`
(1.68 MB: `aphiaid, name_key, lineage`) and an `eov` column in `species/species.parquet`. What the atlas reads now:

- **The Cell pane** (`cellPlan`, from the collection, no ids in `src/`): res 1 and 2 read their own file (the plan did so
  from `flat.resolutions` before any code: the live atlas read `res=1.parquet` as soon as the collection listed it); res
  3 and finer read the file of the res-1 parent of the hexagon's res-3 ancestor through a reader with a 64 KiB tail,
  then the row groups by `cell_id` statistics (the path's `res=` and `p=` are not columns: a DuckDB reader passes
  `hive_partitioning = false`); `res=3.parquet` only when the collection has no `parent_template`; a parent with no file
  (no records under it) is an empty list, a failing one an error. Whole-resolution files open with a 128 KiB tail (the
  footers are 68,486 B at res 1 and 117,567 B at res 2).
- **The species readers fetch uncached** (`uncachedFetch`, `cache: "no-store"`): Chromium's HTTP cache lets one request
  per url write at a time, so concurrent ranges of one file came back one after another (69 column-chunk ranges of the
  lookup: 12 s, about 180 ms each; uncached: 1.1 s).
- **The names** stay one whole read of `species/species.parquet` per page (4.5 MB now, 0.25 to 0.67 s): its column
  chunks alone are 2.29 MB but 69 ranges, 0.6 to 1.2 s on the storage host.
- **The WoRMS subtree** registers `species/lineage.parquet` (1.68 MB) in DuckDB-WASM for the taxa and the cells' SQL
  (`subtreeSql` over `aphiaid, name_key, lineage` equals it over the whole lookup: `tests/obis/subtree.test.ts`); the
  classes and records come from the lookup's `aphiaid, class, records` chunks (`classesOf`; merged across 16 KiB gaps,
  36 requests, 0.55 MB, started beside the lineage), or from the Cell pane's whole read when the page has it.
- **The EOV species lists** keep the species whose `eov` is the layer's key: the fish layer at `832834fffffffff`
  (Monterey, res 3) lists 481 species and 254,837 records, the hexagon's own `sp` and `n` on the map.

**Measured** (2026-10-24, headless Chromium 1243 on the Mac mini, the live site https://oceanmetrics.io/atlas/ and the
live release, a new browser context per run, 1280 × 900, 3 runs each; the page opened with `cell=` for the pane and
`taxon=infraorder:Cetacea&res=3&map=-150,30,4` for the subtree; bytes are response bodies of `obis-h3/` counted by
Playwright `request.sizes()`; "ms" for a file is its first request's start to its last response's end, the pane's own
line beside it; before = atlas `6158e57`, after = `b64c857`):

| what is read                                                 | before: species table                                              | after: species table                                                                                                         | names (`species.parquet`) before → after | pane's line, ms, before → after                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| Cell pane, res 1 `81283ffffffffff`                           | 337,081 B, 2 req (`res=1`, 256 KiB tail), 519 to 544 ms            | **205,981 B**, 2 req (`res=1`, 128 KiB tail), 471 to 492 ms                                                                  | 4,505,124 B, 1 req, both                 | 544 to 573 → 488 to 765                                                                       |
| Cell pane, res 2 `822837fffffffff`                           | 395,671 B, 3 req, 660 to 869 ms                                    | **264,595 B**, 3 req, 468 to 704 ms                                                                                          | 4.5 MB, 1 req, both                      | 682 to 893 → 505 to 734                                                                       |
| Cell pane, res 3 `832834fffffffff`                           | 328,576 B, 2 req (`res=3.parquet`, 1 of 370 groups), 475 to 734 ms | **83,064 B**, 2 req (`res=3/p=81283ffffffffff`, 3 of 13 groups), 433 to 564 ms                                               | 4.5 MB, 1 req, both                      | 501 to 761 → 460 to 585                                                                       |
| Cell pane, res 5 `852834c7fffffff` (its res-3 parent's list) | 328,578 B, 2 req, 523 to 587 ms                                    | **83,066 B**, 2 req (the same parent file), 466 to 530 ms                                                                    | 4.5 MB, 1 req, both                      | 537 to 637 → 548 to 863                                                                       |
| WoRMS subtree, Cetacea, res 3                                | the whole lookup, 4,505,191 B, 1 req, + `class=Mammalia` 276,734 B | **`lineage.parquet` 1,679,167 B (1 req) + the class columns 546,885 B (36 req)** = 2,226,052 B, + `class=Mammalia` 276,724 B | —                                        | compute 1,264 to 2,713 → 1,301 to 6,739 (the slow run is a page's first, its 36 ranges 1.5 s) |

The species-table bytes of a pane fall 39% at res 1, 33% at res 2 and 75% at res 3 and finer, and the subtree's lookup
read 51% (4.51 → 2.23 MB). The bar of obis-hex row 63 (0.6 MB and 0.3 s for a page's first hexagon) is met in bytes at
every resolution (it already was for res 1 and 2 once the collection listed their files) and not in time: each read is
two requests (a tail, then the row groups; the res-3 parent of Monterey is 135 KB, over the 64 KiB tail) at about
0.2 s each on the storage host, so the table alone takes 0.43 to 0.70 s, and the pane waits on the names (0.25 to
0.67 s). Under 0.3 s would need one request: a split file inside its tail (728 of 842 are) or a larger tail.

**A split file in one request** (2026-10-24, atlas `094c4ea`, `SPLIT_TAIL` 256 KiB; the first request of a split file asks
for its last 256 KiB, which is the whole file when the file is no larger: 828 of the 842 files, the median 9.6 KB; the
size of a larger one comes in the first response's Content-Range, then its row groups by range). Monterey's parent
`species_flat/res=3/p=81283ffffffffff.parquet` is 198,841 B in `files.parquet` (not 135 KB), so it is one request of
199.6 KB where it was two of 83 KB. The pane does not load `files.parquet` (it would be a request of its own before the
first byte of the table), so the size is not known before the first request. Measured as above, on the laptop (headless
Chromium 1243, macOS; the "before" runs are of the same hour and are the build of `ce10db2` served by
`vite preview` against the live release; the Mac mini was not reachable from this session, so these are not the
mini's numbers of the table above), the live site https://oceanmetrics.io/atlas/ after the Pages deploy, a new context per
run, 3 runs each; "table" is the species-table files' first request start to last response end, "pane" the line the
Cell pane prints (the table and the names, read together):

| Cell pane at                         | before (`ce10db2`): table ms (runs), median; requests, bytes | after (`094c4ea`): table ms (runs), median; requests, bytes | pane's line, ms (runs), median: before → after |
| ------------------------------------ | ------------------------------------------------------------ | ----------------------------------------------------------- | ---------------------------------------------- |
| res 1 `81283ffffffffff`              | 577 / 713 / 505, **577**; 2 req, 206,011 B                   | 501 / 607 / 517, **517**; 2 req, 206,000 B                  | 967 / 1029 / 1092, 1029 → 871 / 986 / 676, 871 |
| res 2 `822837fffffffff`              | 497 / 531 / 558, **531**; 3 req, 264,631 B                   | 520 / 598 / 710, **598**; 3 req, 264,641 B                  | 923 / 658 / 650, 658 → 670 / 847 / 1029, 847   |
| res 3 `832834fffffffff`              | 605 / 648 / 619, **619**; 2 req, 83,085 B                    | 180 / 189 / 197, **189**; 1 req, 199,561 B                  | 1119 / 1085 / 798, 1085 → 604 / 616 / 604, 604 |
| res 5 `852834c7fffffff` (its parent) | 426 / 523 / 559, **523**; 2 req, 83,095 B                    | 242 / 207 / 195, **207**; 1 req, 199,565 B                  | 1236 / 707 / 652, 707 → 725 / 628 / 623, 628   |

The split read is one request of about 0.19 s (a 3.3x cut at res 3, 2.5x at res 5) and 200 KB for Monterey's parent (the
whole file; the table's bytes are 0.2 MB at every resolution, under the bar's 0.6 MB). **The time bar of row 63 (0.3 s for
the species table, median of 3) is met at res 3 and finer and not at res 1 and 2**: their whole-resolution files (9.0
and 14.6 MB, footers of 68 and 118 KB) keep the 128 KiB tail and are still a tail, then the row groups (res 2: two
groups of 218, three requests), 0.52 to 0.60 s. The pane's own line stays at 0.6 s or more at every resolution because it
waits for the names (`species.parquet`, 4.5 MB: 0.25 to 0.40 s to arrive, then its columns are parsed). A way to the
other two, not built or measured: a res-1 or res-2 hexagon's rows are the sums of its res-3 children's, which lie in
its res-1 parent's split file (`p=<parent>`, one request for 828 of 842 parents), so the pane could read that file and
sum the children's rows itself, as it does for a `children` scope, instead of the whole-resolution file's footer and
row groups.

## Not built yet

- The view as places (obis-hex `v=places`, waiting on Ben's word to drop). A whole collection as the place filter is
  built (`filter=coll:<slug>`, above); obis-hex's `f=<coll>` redirects to it; `f=<coll>|<id>,<id>` (a collection and some
  of its places) is not carried (the places filter with `#pl=` is its nearest).
- The decade filter of the Cell pane is the species whose first and last years span the period (their records
  are every year's); the per-decade species table (`species_decade/`, class-partitioned) is not read.
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
