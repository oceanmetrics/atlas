# The OBIS layer (build week 4, step 5)

The obis-h3 release (OBIS snapshot 2026-10-11, release `v20261012`, obisindicators 0.11) is a collection of the
atlas catalog: `catalog.json` links its stable `collection.json`
(`https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/obis-h3/collection.json`, id `obis_h3`, the platform
`h3` profile 1.1) by absolute href, in the picker group `obis` (the link's `atlas:group`), listed by the
oceanmetrics instance only (decision D2: not the marinesensitivity instance in week 4).

## How it is drawn

- **The hook is the profile.** `src/lib/catalog/h3.ts` (`parseH3`, registered as `h3` in `hooks.ts`) reads the
  profile's fields; nothing in `src/` names the collection id.
- **The renderer is the map package's.** `@oceanmetrics/map` 0.3.0 `h3ReleaseSlot` reads the release's own Parquet
  in MapLibre's worker (`h3r://` tiles, every indicator in each tile, the resolution ladder of the release, never a
  roll-up). The slot is mounted on a style recorder, as `cogSlot` is, and its source and fill go into the one
  composed style (`composeStyle({ h3 })`, roles `h3` and `h3-selected` in the data group).
- **Lazy.** `src/lens/collection/h3/` (the layer, its controls and Cell pane) is imported only when an `h3`
  collection opens; the h3 worker module joins MapLibre's worker then (a second `setupMapLibre({ h3WorkerUrl })`).

| file              | what                                                                                                                                                                                                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `view.ts`         | the URL (`i`, `taxon`, `dim.indicator`, `dim.period`, `res`) against what the Item or taxon publishes: the target (templates resolved from the Item's assets, or `taxon_groups.parquet` `url_path`), the period set, the resolution clamp and its note; heads by `heads.json` `served_by` |
| `paint.ts`        | the fill (viridis over stats.parquet p02 to p98 per resolution, a step on the zoom in auto; records on a log scale), the legend, the coverage line, the hexagon area, the sentence, the hover                                                                                             |
| `periods.ts`      | the period strip: decades and years from `h3:periods`, each bar the hexagons with records at res 3 (stats.parquet `n_cells`), ←/→ and Esc                                                                                                                                                 |
| `taxa.ts`         | the taxon field: the release's taxon layers by rank (the heads above class first), common names, families only while searching                                                                                                                                                            |
| `cellSpecies.ts`  | the Cell pane's species: `species_flat/res=3.parquet` (a coarser hexagon sums its res-3 children exactly; a finer one shows its res-3 parent's), names from `species/species.parquet`, filter, sort, CSV                                                                                  |
| `layer.svelte.ts` | the wiring: the slot, the reads, hover and click, the style parts                                                                                                                                                                                                                         |

Sizes (gzip, `npm run build`, oceanmetrics): static path 432.4 of 450 KB (428.9 before step 5: the parser, the
codec keys, the style role, the lens wiring, and the map package's shared modules split into chunks of their
own); the H3 layer's lazy closure 38.9 KB (the layer 5.6, its view, paint, taxa and species modules, hyparquet and
the package's release slot and reader), its controls and Cell pane 6.9 KB more; the h3 worker module 99.7 KB
(`h3Worker-*.mjs`, not in the runtime-worker budget: it is loaded by the lazy layer); the stats reader 0.6 KB.

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

| check                                               | result                                                                                                                                                                                                                                                                   | bar                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| hover via `queryRenderedFeatures`                   | the fill's features carry `{h3, es, sp, shannon, simpson, n}` (e.g. `816afffffffffff`: ES(50) 16.97, 39 species, Shannon 2.84, Simpson 0.078, 1,948 records); the hover popup shows the five, the chosen one bold; a click writes `cell=` and its popup links to Details | spike 1 did not test hover or click                             |
| the globe                                           | the default projection: 145 hexagons rendered at z2 (2020s), drawn and queried on the globe                                                                                                                                                                              | one shot, `obis_global_es_2020s_z2_1280_dark`                   |
| p95 frame over a 5 s pan                            | Mercator 16.7 ms (p50 16.7, max 16.8, 303 frames); globe 16.8 ms (p50 16.7, max 16.8, 304 frames)                                                                                                                                                                        | within 1.5 × 16.7 ms                                            |
| the same under SwiftShader (no GPU)                 | Mercator 33.4 ms, globe 50.1 ms: the software rasterizer, not the layer                                                                                                                                                                                                  | (reference only)                                                |
| Monterey Bay, zoom 9 (res 7), tile bytes            | **169,560 B** in 11 parent files (`all/res=7/p=<res-3 parent>`), suffix reads of the files' tails                                                                                                                                                                        | obis-hex 118 KB (7 partitions): **over**, see below             |
| first view (all, res auto, world)                   | 352,874 B of obis-h3 (collection, 8 Items, stats footers and groups, 25,665 B of tiles); tiles loaded 1.35 to 1.55 s after navigation (this link, not throttled)                                                                                                         | ≤ 1 MB, ≤ 1.5 s at 50 Mbit/s: bytes well under, time at the bar |
| Cell pane, `81197ffffffffff` (res 1, 8,963 species) | 819 KB of the flat table in 12 requests, 2.14 s; the lookup once per page (about 2.0 MB: aphiaid, species, phylum, class, order, family)                                                                                                                                 | ≤ 0.6 MB, ≤ 0.3 s: **over**                                     |
| Cell pane, `8329a9fffffffff` (res 3, Monterey)      | 580 KB in 5 requests, 1.60 s, plus the lookup once                                                                                                                                                                                                                       | ≤ 0.6 MB, ≤ 0.3 s: bytes at the bar, time over                  |

What is over and why:

- **Monterey z9.** The release provider asks the parents under each 512 px tile, its buffer and two cells
  (`tileParents`), so a 1280 × 800 view at z9 reads 11 res-3 parents where obis-hex, which planned from the
  viewport's own bounds, read 7. The provider is the map package's (`h3Parquet.ts`); the fix (planning parents from
  the cells the tile can show, not the grown bbox) belongs there.
- **The Cell pane.** The flat table's row groups are 10,000 rows, so a dense res-3 cell reads whole groups; the
  lookup has no row-group order by AphiaID (two groups), so it is read once, whole, in the columns the list shows.
  A per-cell index or AphiaID-sorted lookup groups in obisindicators would bring both under the bar.

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
