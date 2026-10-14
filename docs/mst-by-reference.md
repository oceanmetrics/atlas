# MarineSensitivity collections by reference (WP6)

The catalog links the MarineSensitivity (MST) STAC by reference: the v7 parent (nine child collections)
and the two v8 density collections (`gm`, `nc`), all under `https://file.marinesensitivity.org/stac/`.
The Collections lens draws them. This page records what the MST STAC does and does not publish today,
the route chosen for per-taxon Items, and every URL.

## What the MST STAC publishes (probed 2026-10-14)

- Each collection has ONE Item, `*-model_cell`, whose `data` asset is a per-model registry or a
  partitioned Parquet (`model_asset.parquet`, `dist_merged/`): rows per taxon, not Items per taxon. The
  Collections lens cannot draw that, so before WP6 it said "cannot be drawn yet".
- Collection titles and credits: `sci:citation` and `license` only. No `providers`, `contacts` or
  `sci:doi`; `ms_merge`'s citation is empty. `sdm:source_authority` names the producer (shown in Details).
- The v7 collection ids are `msens-v7-{ds_key}` (`am_0.05`, `bl`, `ca_nmfs`, `ch_fws`, `ch_nmfs`,
  `ms_merge`, `rng_fws`, `rng_iucn`, `rng_turtle_swot_dps`); the v8 ones are `msens-v8-gm`,
  `msens-v8-nc`.
- The STAC API (`https://stac-api.marinesensitivity.org/`) answers `/search` with
  `access-control-allow-origin: *` and one Item per model (COG `native` and `model` assets,
  `sdm:rescale_min/max`, `sdm:colormap`, `sdm:scientific_name`). **But it serves release v9 only**
  (`msens-v9-am`, ...). `/search?collections=msens-v7-am_0.05` is an HTTP 500 ("No Parquet configured
  for collection"). The catalog links v7 and v8, so the API cannot be the source today.

## The route: v7 `app/` bundle for taxa, a manifest for nc and gm

| collection       | Items come from                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| v7 (nine)        | the v7 `app/` bundle the Species lens reads: `taxa.json` (index) + `taxon/{xx}.json` (one shard per taxon) |
| `msens-v8-nc/gm` | `public/mst/{nc,gm}_models.json`, a static per-model table (a stopgap, below)                              |

v7 taxa: `lib/release/mst.ts` pins the release (`MST_SPECIES_VER = "v7"`, shared with the Species lens).
A shard's `inputs[]` has one entry per source dataset (`ds_key` = the collection's key) with `model`
(on the 0.05 degree analysis grid) and `native` assets; `ms_merge` uses the shard's `merged` surface.
`lib/catalog/mst/taxon.ts#taxonItem` turns that into a STAC Item (one COG `data` asset with
`atlas:rescale`, `atlas:colormap`; `atlas:value_range`; `sdm:taxon`) so everything downstream (legend,
tile URL, Details) is the generic Collections path. The rescale and colormap are the asset's own,
verbatim; an asset that names none asks for titiler's statistics, never a guessed range. The collection
is listed under the STAC id and credits; only the picker title of `am_0.05` is the atlas' own
("AquaMaps habitat suitability (0.05 degree)", `catalog/mst/kinds.ts`).

Why not the API: it is the cleaner source (per-model Items, CORS) **once it serves v7/v8**. When it does,
`loadTaxonItem` becomes a `/search?collections=...&ids=` call and the pin goes away; nothing else changes.
Until then reading the v7 bundle keeps the Species lens and the Collections lens on one release.

What is drawn: COG surfaces (`model` representation). A taxon whose dataset model is vector only
(PMTiles `native` with a `source_layer`) is drawn as a presence fill (WP11): the Item carries a PMTiles
`data` asset (`pmtiles:layers`, `atlas:key_property` = `mdl_key`, `atlas:key` = the shard's `source_key`,
else the input's `mdl_key`) and the lens draws a vector fill filtered to that key, with a "range
(presence)" legend (the shard carries no value column, so there is nothing to colour by). In the pinned
v7 release every input that has a PMTiles also has a COG, so today the COG wins; the fill is for a
release that publishes ranges only. A model with no registered file, or a vector range that names no
tile layer, shows a sentence saying so instead of a layer (`noSurfaceMessage`). The raw 0.5 degree AquaMaps collection is the atlas' own `aquamaps_native` (WP7): a registry-backed taxon collection, built from `atlas:taxa_registry` and `atlas:item_template` (`src/lib/catalog/registry/`, `src/lens/collection/registry.svelte.ts`); `?c=aquamaps_native&sp=<sp_key>&rep=native|005`.

## nc and gm: dimensions from a manifest (stopgap)

`scripts/mst/build-manifests.mjs` writes `public/mst/nc_models.json` and `gm_models.json` from the MST
workflows' own tables (`data/nc_models.csv`, `data/nc_taxon_crosswalk.csv`; the v8 `model_gm.csv` and
`gm_cog_registry.csv`). It is a stopgap until the MST STAC publishes per-model Items; `--check` exits 1
when a committed manifest differs from its inputs. The files load lazily (about 9 KB gzip for nc).

- **nc** (NOAA NCCOS seabird density), 690 band rows: **region** (Atlantic, Pacific) x **species or group**
  (82; a group such as "Cormorant spp." is its own row, labelled "(group)") x **season** (spring, summer,
  fall, winter) x **variable** (`n_per_km2`, `cv_n_per_km2`; `ci90_n_per_km2` for the Atlantic only).
  One COG per (region, species, season) with the variables as bands 1, 2, 3 (`bidx`). The COGs are in a
  projected CRS; titiler reprojects them.
- **gm** (NOAA SEFSC, Gulf of Mexico): **taxon** (17, genus or species) x **time**. Only the annual
  surfaces are published as COGs (`v8/native/gm/gm_WORMS_{id}.tif`); the monthly ones exist only as
  Parquet, so `time` has the single value "Annual". Values are a relative 0-100 index (monthly density
  over the taxon's 99.5th-percentile cap, capped at 100; the cap is in each item's description), drawn
  at the fixed rescale 1-100, not as individuals per km2.

Rescale for nc: `[min, 98th percentile]` of the band from titiler `/cog/statistics?url=..&bidx=..`
(`lib/raster/rescale.ts`), cached per COG band for the session and shared between concurrent requests;
a failed read is not cached. The percentile is deliberate: densities are heavily right-skewed (ARTE
summer: max 0.81, 98th percentile 0.0079). The layer is not drawn until the range is known, so the legend
and the colours always agree. The colormap is `spectral_r`.

## URL grammar

| link                                              | meaning                                                         |
| ------------------------------------------------- | --------------------------------------------------------------- |
| `?c=msens-v7-rng_iucn&sp=54241`                   | taxon collection + taxon (the v7 merged key, `taxa.json` `key`) |
| `?c=msens-v8-nc&i=atlantic.ARTE.summer.n_per_km2` | nc model: `i` = `region.species.season.variable`                |
| `?c=msens-v8-gm&i=WORMS:137209.annual`            | gm model: `i` = `taxon.time`                                    |

- A default taxon (the leatherback) is not written until a taxon is picked; picking one writes both `c`
  and `sp`. The taxon travels between v7 collections (compare the IUCN range with AquaMaps for the same
  species) and is dropped from the URL on any other collection.
- `?sp=` alone still opens the Species lens. With a `c` present, `sp` belongs to the Collections lens
  (`defaultLens(sp, c)`); `lens=species` in the link still wins. "Open in Species lens" in Details hands
  the taxon over (`in` = the collection's dataset).
- nc and gm use `i=`, the catalog's own item grammar, instead of one query key per dimension: one `i`
  names the whole selection, and the dimension values are derived from it. Round trips are tested in
  `tests/lens/collection/mstMapInputs.test.ts` and `tests/catalog/mst/manifest.test.ts`.

## Credits and Details

Credits (citation, license) are the STAC collection's, shown by the credits strip as for any collection.
Details adds, for taxon Items, the identifiers from `sdm:taxon`: scientific and common name, category,
WoRMS AphiaID (linked to its page), BOTW (BirdLife) id, GBIF id, IUCN Red List, ESA listing; and the
collection's `sdm:source_authority`.

## Code map

- `src/lib/catalog/mst/kinds.ts` (which collections, titles), `taxon.ts` (shard -> Item, facts),
  `manifest.ts` (manifest -> Items and `cube:dimensions`), `items.ts` (loading).
- `src/lib/raster/rescale.ts`; `bidx` in `raster/tiles.ts`.
- `src/lens/collection/mst.svelte.ts` (taxon index, taxon Item), `TaxonField.svelte` (search, the
  `SpeciesPicker`), `MstDetails.svelte`; `state.svelte.ts` wires them.
