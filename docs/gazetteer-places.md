# Gazetteer places in the atlas (the `p.` place_id token)

> **Status in OceanMetrics Atlas (WP11, 2026-10-14).** Current for places by reference (`p.` token), the vendored client, overlays and summaries. The lines that mention `report.html` and `src/report/gazPlaces.ts` describe the retired Report: OceanMetrics Atlas has no report page, and the Places tool's list, summaries and GeoJSON download replace it.

The atlas can hold a place from the Ocean Metrics places gazetteer **by reference**: the link carries
the gazetteer `place_id`, not the geometry. This note is the contract the `msens` R package mirrors
(the g1 codec is implemented in both; this repo does not touch msens).

## Token grammar (new kind; everything else in `g1` is unchanged)

```
place  = ... | "p." id "." name
id     = percent-encoded UTF-8 of the gazetteer place_id      1..120 encoded chars
name   = percent-encoded UTF-8 display name                   0..60 encoded chars (EMPTY is valid)
```

- `percent-encoded` is exactly the `g1` `name` encoding: unreserved set `A-Za-z0-9_-`, every other UTF-8
  byte as `%XX` with **uppercase** hex. So `:`, space, `.`, `~` are always escaped and the existing
  split rules hold: places split on `~`, a token splits on `.` into **exactly 3** parts.
- `p` is the scheme (like `z`, `g1`, `u`); the middle part is the id and the last is the name. An empty
  name leaves an empty last part (`p.BOEM%3AOCS-P%200562.`).
- Old decoders drop a `p.` token (unknown scheme), which is `decodePlaces`' existing rule for any
  unreadable token, so old readers never fail on a new link; they just lose that place.
- Examples (from `tests/fixtures/place_codec_place_id.json`, hand-written, both directions tested):

  | place_id          | name                 | token                                          |
  | ----------------- | -------------------- | ---------------------------------------------- |
  | `BOEM:OCS-P 0562` | `OCS-P 0562`         | `p.BOEM%3AOCS-P%200562.OCS-P%200562`           |
  | `NMS:CINMS`       | `Channel Islands`    | `p.NMS%3ACINMS.Channel%20Islands`              |
  | `MPAINV:CA-123`   | (empty)              | `p.MPAINV%3ACA-123.`                           |
  | `A.B~C:D`         | `St. George ~ Basin` | `p.A%2EB%7EC%3AD.St%2E%20George%20%7E%20Basin` |

  A hash mixes kinds freely: `z.pa.GAA~p.NMS%3ACINMS.Channel%20Islands~u.My%20area.0123abcd`.

- Invalid (rejected by `decodePlace`, dropped by `decodePlaces`): two parts; empty id; a raw `:` or
  other unescaped character; a truncated `%XX`; id over 120 or name over 60 encoded chars.
- The shared `tests/fixtures/place_codec.json` is **unchanged**; the new kind has its own fixture,
  `tests/fixtures/place_codec_place_id.json`. msens copies it to `inst/fixtures/` when it adds the kind.

## Resolution (what a reader does with the id)

The geometry is fetched at load from the gazetteer tree
(`https://storage.oceanmetrics.io/gazetteer/<collection>/places.parquet`, a `place_id`-filtered read):

1. find the collection: `NMS:`, `MRGID:`, `PSGID:` ids are in `places/`; any other authority is found
   through `index/layers.json` (403 until published);
2. **unwrap** the antimeridian split. The gazetteer cuts places at +/-180; every MultiPolygon part
   whose longitude centre is west of 0 is shifted by +360 when the place has a part touching +180 and a
   part touching -180, so longitudes run contiguously past 180 (`NMS:PMNM` spans 177.8 .. 199.0). This
   is the atlas's (and g1's) unwrapped convention: g1 stores no wrapped ring;
3. analyse `decode(encode(geometry))` like any other place (`analysisGeometry()`).

R: read the same parquet with DuckDB (`bbox` struct pushdown, `WHERE place_id = ?`), apply
`unwrap_polygon()` per part as above, then the existing `place.R` path. The `@oceanmetrics/places`
README has the SQL.

A failed fetch never removes the token: the place stays in the link and the list (a row reading
"couldn't load" with a Retry), a toast says why, and `report.html` leaves that place out and says so.

## What was added in the atlas

- `src/lib/geo/placeCodec.ts`: `GazPlace {kind:"gaz", id, name}`, `p.` encode/decode, `MAX_ID_CHARS`.
- `src/lib/gazetteer/`: `config.ts` (bases, built-in credits; static-safe), `resolve.ts` (lazy: fetch,
  unwrap, manifest, credits), `vendor/` (see below).
- Pick from gazetteer: a Places-panel toggle that shows a gazetteer PMTiles collection (composeStyle
  `gazetteer` input, `src/lib/map/layers/gazetteer.ts`, role group "Selection") and adds the clicked
  polygon's `place_id` (`src/places/gazPick.ts`, `model.ts#addGazPlace`). The `places` collection is
  always offered; others appear when `index/layers.json` is published.
- Credits: the gazetteer's `attribution` joins the map credit line (`Shell.svelte`) while its layer or a
  gazetteer place is on the map. Source order: the index (`places_index.parquet`) per place, then
  `layers.json`, then a built-in line for the `places` collection.
- Report: `src/report/gazPlaces.ts` resolves `p.` places before the report expands them.

## Decisions to know about

- **Vendored client, not a dependency.** `@oceanmetrics/places` is private and unpublished, and a
  `file:../../oceanmetrics/places/client` dependency would break `npm ci` everywhere but one machine. The
  files needed are copied to `src/lib/gazetteer/vendor/` (provenance header in each: v0.1.0, commit
  `3ff9fbf`); `client.ts` is trimmed (no `addLayer`/`search`: the atlas builds map layers through
  `composeStyle`). When the package is published, replace the folder with the dependency. It brings
  `hyparquet@1.31.3` and `hyparquet-compressors@1.1.2` (exact pins, lazy only).
- **Reads go to the bucket URL, not `storage.oceanmetrics.io`.** That host 302s every object request,
  including the CORS preflight a `Range` read triggers, and browsers reject a redirected preflight
  (`OPTIONS .../places.parquet` -> 302, checked 2026-10-08). The same tree on
  `https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/gazetteer/` answers CORS for `Range`. This
  mirrors how `marine-atlas/` data is read (`src/lib/release/dataBase.ts`). Override with
  `VITE_GAZETTEER_BASE`. URLs inside `layers.json` under the canonical root are re-based the same way.
- **Layer group.** The gazetteer tile layer rides in the Layers panel's "Selection" group (it is a
  picking aid shown beside the selection highlight), under the pink outline.

## WP4: overlays, search, summaries (2026-10-14)

- **Place layers.** `src/places/overlays.ts` (pure model), `overlays.svelte.ts` (URL + manifest wiring),
  `PlaceLayerList.svelte` (the list under the Layers panel's "Place layers" stack group,
  `data-overlays`), `src/lib/map/layers/overlays.ts` (style objects), `overlayInteraction.ts` (hover,
  click, "Add <name> to Places"). The manifest is read with a plain `fetch`
  (`src/lib/gazetteer/manifest.ts`), never through the parquet client, so the overlay list adds nothing
  to the static graph beyond a few KB. `?ov=` grammar: `src/lib/gazetteer/overlayUrl.ts`. The overlays are
  drawn in both lenses (WP11): `SpeciesLens.svelte` mounts `PlaceLayerList` through `LayersPanel`'s
  `placeLayers` snippet like the Collections lens, and `Shell.svelte` no longer conditions the overlays on
  the lens, so `?ov=` works in either.
- **Search.** `searchGazetteer()` (`resolve.ts`, lazy) wraps the vendored client's `search()`: areas only,
  one hit per place_id. A `p.` token carries the id alone, so an id that lives in two collections
  resolves to the first by authority order (the same lease in both BOEM layers: the same polygon).
- **Summaries.** `summary.ts` (pure), `summary.svelte.ts` (wiring), `hex_centroids` read by
  `lib/catalog/centroids.ts`, point-in-polygon in `lib/geo/pip.ts`, raster statistics in
  `lib/raster/statistics.ts`. DuckDB-WASM is not involved: the centroid table and the item's value
  column are both read with hyparquet and joined in memory.
- **Raster statistics (live 2026-10-14).** titiler-v8 now allows POST in its CORS preflight, so
  `/cog/statistics` answers a browser: a place over a raster item shows pixels, mean, min, max as
  "display-grid statistics", on the band the map draws (`bidx`).
- **Layer info dialog (WP11).** The "i" button of a place-layer row (`PlaceLayerList.svelte`) opens
  `LayerInfoModal.svelte`: `lib/gazetteer/layerInfo.ts` reads `<root>/<slug>/collection.json` (the canonical
  host, then the path-style bucket URL, cached per slug) and `layerInfoModel` merges it with the manifest
  row (tested against the published `gebco_undersea` and `boem_wind_planning_rescinded` collections,
  `tests/fixtures/gazetteer/`). The places site's layer page is `https://oceanmetrics.io/places/l/<slug>`.
