# `tests/fixtures/mst/`

- `v7-taxon-e1.json`: the real `marine-atlas/v7/app/taxon/e1.json` shard (fetched 2026-10-14), trimmed
  to the one taxon `54241` (_Dermochelys coriacea_). Unlike `tests/fixtures/species/v7/taxon/e1.json`
  (an older backfill whose inputs have no assets) this one carries the live `model` COG and `native`
  COG / PMTiles assets of every input, which is what the per-taxon Items are built from.
