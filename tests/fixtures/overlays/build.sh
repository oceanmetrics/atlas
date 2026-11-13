#!/usr/bin/env bash
# Rebuilds the tiny collection-overlays fixture (tests/fixtures/overlays/): the hand-written GeoJSON under
# src/ -> PMTiles (tippecanoe) and the Item values -> Parquet (duckdb). The outputs are committed; run this
# only after editing src/*.geojson. Needs tippecanoe (>= 2.17, writes .pmtiles) and the duckdb CLI.
set -euo pipefail
cd "$(dirname "$0")"
out=sefsc_fixture
tip() { tippecanoe --force --quiet -o "$1" -l "$2" -Z0 -z10 -r1 --no-feature-limit --no-tile-size-limit "$3"; }
tip "$out/hex.pmtiles" hex src/hex.geojson
tip "$out/overlays/hexagons.pmtiles" hexagons src/hexagons.geojson
tip "$out/overlays/sightings_vessel.pmtiles" sightings_vessel src/sightings_vessel.geojson
tip "$out/overlays/effort_vessel.pmtiles" effort_vessel src/effort_vessel.geojson
duckdb -no-agent -c "COPY (SELECT FID::BIGINT AS FID, rices_whale::DOUBLE AS rices_whale_density,
  bottlenose::DOUBLE AS bottlenose_dolphin_density FROM (VALUES (1, 0.82, 0.35), (2, 0.07, 0.91))
  t(FID, rices_whale, bottlenose)) TO '$out/values.parquet' (FORMAT parquet)"
ls -la "$out" "$out/overlays"
