# Proposal: stac-sdm v1.1, multi-species products

Status: draft from the OceanMetrics Atlas BioTrack pipeline (2026-10-14). Target: `marinesensitivity/stac-sdm`.

## Why

stac-sdm v1.0.0 describes one taxon per Item (`sdm:taxon`) with a `sdm:response_type` drawn from `occurrence`,
`range`, `suitability`, `probability`, `density`, `biomass`, `mixed`. Biodiversity indicators such as the MBON
BioTrack ecoregion-weighted species richness and cumulative uncertainty are derived from many per-species models
and do not fit: there is no single taxon and the value is neither a probability nor a density.

## Today (stopgap used by the atlas)

- Collection and Items use `sdm:response_type: "mixed"` and `sdm:method: "derived_merge"`.
- The kind of value is carried by an `atlas:metric` property (`richness` or `uncertainty`), and the slice by
  `atlas:dims` (`group`, `season`, `metric`), with `cube:dimensions` listing the values.
- The taxa behind a product are described in text (`sdm:method_detail`) and in a README.

This validates against the v1.0.0 schema but is not machine-readable by other clients.

## Proposed additions

1. New `sdm:response_type` values:
   - `richness`: number of taxa (or a ratio of it) per cell, derived by summing per-taxon predictions.
   - `uncertainty`: spread of a derived or modeled quantity per cell (for example the sum of per-taxon standard
     deviations), unitless or in the unit of the underlying value.
   `mixed` stays for merged products of heterogeneous response types.
2. `sdm:taxa` (array of Taxon Objects, same shape as `sdm:taxon`): the taxa that contribute to a multi-species
   Item or Collection. `sdm:taxon` and `sdm:taxa` are mutually exclusive on one node. For large lists the array may
   be replaced by an `sdm:taxa_href` pointing at a Parquet table of taxon objects.
3. `sdm:aggregation` (object) describing how a multi-species value was formed:
   - `level` (string): the grouping, for example `all`, `group`, `family`, `redlist`.
   - `n_taxa` (integer): number of taxa included.
   - `rule` (string, optional): `sum`, `mean`, `max`, `weighted_sum`, `ecoregion_weighted`.
   - `group` (string, optional): the group name when `level` is `group`.
4. `sdm:value_unit` gains the recommended value `species` (count of species) alongside `unitless`.

## Example (BioTrack, shark richness, summer)

```json
{
  "sdm:response_type": "richness",
  "sdm:method": "derived_merge",
  "sdm:source_authority": "MBON BioTrack",
  "sdm:temporal_interval": "seasonal",
  "sdm:season": "summer",
  "sdm:aggregation": {"level": "group", "group": "shark", "n_taxa": 16, "rule": "ecoregion_weighted"},
  "sdm:taxa": [{"scientific_name": "Alopias vulpinus", "authorities": {"worms": 105836}, "group": "shark", "redlist_code": "VU"}]
}
```

## Migration

Items written today with `mixed` + `atlas:metric` map one-to-one: `atlas:metric: richness` becomes
`sdm:response_type: richness`, `atlas:dims.group` becomes `sdm:aggregation.group`. The pipeline emits the stopgap
until v1.1 ships, then switches with one change in `stac.py`.

## Open questions

- Whether `richness` of an ecoregion-ratio (0-1) deserves its own value or `sdm:value_unit: unitless` suffices.
- Whether `sdm:taxa` should allow `weight` per taxon for weighted aggregations.
