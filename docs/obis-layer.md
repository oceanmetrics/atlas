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

## Not built yet

- `taxon=aphia:<id>` for a taxon that is no head (a WoRMS subtree computed in the page over the class-partitioned
  species table, DuckDB-WASM, spike 2's SQL): the layer says the id is not one of the release's precomputed taxa.
  "Search all of WoRMS" over the lookup's names comes with it.
- The place filter (`f=`, H3 membership from the gazetteer, "statistics of the hexagons") and the view as places.
- The decade filter of the Cell pane is the species whose first and last years span the period (their records
  are every year's); the per-decade species table (`species_decade/`, class-partitioned) is not read.
- An EOV's or a head's species list is every taxon's (the lookup has no EOV column and no ranks above phylum);
  the pane says so.
- The tour stops, keys (`g`), Help entries, Cite and Reproduce lines of obis-hex.
