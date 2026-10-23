#!/usr/bin/env bash
# publish the staged atlas catalog to S3. DRY RUN by default; pass --really to upload.
#   pipeline/publish.sh            # aws s3 sync --dryrun
#   pipeline/publish.sh --really   # real upload (needs AWS keys with write access to the bucket)
#   pipeline/publish.sh --only swfsc_cce_becker2020b [--really]   # ONE restricted collection (+ its COGs), nothing else
#   pipeline/publish.sh --only aquamaps_eov [--really]   # the EOV score + density COGs, their _3857 copies, Items, collection.json; no delete
#   pipeline/publish.sh --only aquamaps_native [--really]   # ONLY aquamaps_native/collection.json (repointed at registry/v2); nothing else, no delete
# the restricted species collection goes to an unlisted prefix kept in pipeline/restricted_prefix.txt (git-ignored);
# a collection published with --only has its own prefix file (pipeline/restricted_prefix_<name>.txt, git-ignored).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(dirname "$here")"
stage="${ATLAS_STAGE:-$repo/catalog/staging}"
prefix_dir="${ATLAS_PREFIX_DIR:-$here}"
bucket="${ATLAS_BUCKET:-oceanmetrics.io-public}"

flag="--dryrun"
only=""
while [ $# -gt 0 ]; do
  case "$1" in
    --really) flag="" ;;
    --only) [ $# -ge 2 ] || { echo "--only needs a collection name" >&2; exit 2; }; only="$2"; shift ;;
    --only=*) only="${1#--only=}" ;;
    -h|--help) sed -n "2,8p" "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done
[ -n "$flag" ] && echo "DRY RUN (add --really to publish)" || echo "PUBLISHING to s3://$bucket"

# ---- --only aquamaps_eov: the score and density COGs, their _3857 copies, the Items and collection.json of the PUBLIC EOV collection ----
# the rest of the product (Parquet) is written and uploaded by oceanmetrics/workflows/aquamaps_eov.qmd; this
# is the narrow re-publish after `build.py cog-assets` (the staging folder holds score_*.tif, score_*_3857.tif, items/ and a
# collection.json read from the bucket with the new file:size/file:checksum). Nothing is deleted (no --delete) and a key
# whose size is unchanged is skipped (--size-only), so a COG or Item already published as it stands is not touched.
# order: COGs, their copies, Items, collection.json last (a visitor never gets a collection whose files are not there yet).
if [ "$only" = "aquamaps_eov" ]; then
  src="$stage/aquamaps_eov"
  dest="s3://$bucket/atlas/aquamaps_eov"
  [ -f "$src/collection.json" ] || { echo "nothing staged at $src" >&2; exit 1; }
  echo "target: $dest/"
  # the score and density originals (rewritten with nearest overviews), then the _3857 copies of both
  aws s3 sync "$src" "$dest" --exclude '*' --include 'score_*.tif' --include 'density_*.tif' --exclude '*_3857.tif' --exclude '*.orig.tif' --size-only --content-type image/tiff $flag
  aws s3 sync "$src" "$dest" --exclude '*' --include 'score_*_3857.tif' --include 'density_*_3857.tif' --size-only --content-type image/tiff $flag
  if [ -d "$src/items" ]; then
    aws s3 sync "$src/items" "$dest/items" --exclude '*' --include '*.json' --size-only --content-type application/json $flag
  fi
  aws s3 cp "$src/collection.json" "$dest/collection.json" --content-type application/json $flag
  exit 0
fi

# ---- --only aquamaps_native: the collection.json alone, repointed at a registry version already on the bucket ----
# `build.py aquamaps-registry <registry/v2/registry.parquet>` writes the staged collection.json (the live one with its
# registry asset's href, file:size, file:checksum and table:columns following the new file, version bumped). The registry
# file itself was uploaded by `build.py cog-3857-batch --pool` and is NOT touched here: one `s3 cp` of collection.json, no
# sync, no --delete, and only after the file the collection names is confirmed on the bucket (a collection never points at
# a registry that is not there). The old unversioned registry.parquet stays, so a cached collection.json still works.
if [ "$only" = "aquamaps_native" ]; then
  src="$stage/aquamaps_native"
  dest="s3://$bucket/atlas/aquamaps_native"
  [ -f "$src/collection.json" ] || { echo "nothing staged at $src (run: uv run pipeline/build.py aquamaps-registry <registry.parquet>)" >&2; exit 1; }
  href="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["assets"]["registry"]["href"])' "$src/collection.json")"
  [[ "$href" =~ ^\./[A-Za-z0-9_./-]+\.parquet$ && "$href" != *..* ]] || { echo "refusing: registry href '$href' is not a relative .parquet path" >&2; exit 1; }
  echo "target: $dest/collection.json (registry asset: $href)"
  aws s3api head-object --bucket "$bucket" --key "atlas/aquamaps_native/${href#./}" > /dev/null || {
    echo "refusing: $dest/${href#./} is not on the bucket" >&2; exit 1; }
  aws s3 cp "$src/collection.json" "$dest/collection.json" --content-type application/json --cache-control "no-cache" $flag
  exit 0
fi

# ---- --only <collection>: one restricted collection to its own unlisted prefix; touches nothing else ----
# the collections this mode knows, each with its prefix file. catalog.json, the public collections and biotrack_species
# are never uploaded here.
only_prefix_file() {
  case "$1" in
    swfsc_cce_becker2020b) echo "$prefix_dir/restricted_prefix_swfsc_cce.txt" ;;
    *) return 1 ;;
  esac
}
if [ -n "$only" ]; then
  pf="$(only_prefix_file "$only")" || { echo "--only: unknown collection '$only' (known: swfsc_cce_becker2020b, aquamaps_eov, aquamaps_native)" >&2; exit 2; }
  src="$stage/$only"
  [ -f "$src/collection.json" ] || { echo "nothing staged at $src (run: uv run pipeline/build.py build --collection $only)" >&2; exit 1; }
  [ -f "$pf" ] || { echo "missing $pf (the build creates it)" >&2; exit 1; }
  prefix="$(tr -d '[:space:]' < "$pf")"
  dest="s3://$bucket/atlas-restricted/$prefix/$only"
  # the guard: a 26-character ULID prefix and exactly this collection, or nothing runs
  [[ "$dest" =~ ^s3://[a-z0-9.-]+/atlas-restricted/[0-9A-HJKMNP-TV-Z]{26}/${only}$ ]] || {
    echo "refusing: destination $dest is not atlas-restricted/<ULID>/$only" >&2; exit 1; }
  echo "target: $dest/"
  # COGs first, then items and the rest, collection.json last (no-cache): a visitor never gets a collection whose
  # items or COGs are not there yet
  if [ -d "$src/cog" ]; then
    # the EPSG:4326 originals (numbers), then their EPSG:3857 copies <stem>_3857.tif beside them (what the browser's
    # cog protocol draws; written by atlas_pipeline/cog.py), both before the items that name them
    aws s3 sync "$src/cog" "$dest/cog" --exclude '*' --include '*.tif' --exclude '*_3857.tif' --content-type image/tiff $flag
    aws s3 sync "$src/cog" "$dest/cog" --exclude '*' --include '*_3857.tif' --content-type image/tiff $flag
  fi
  if [ -d "$src/items" ]; then
    aws s3 sync "$src/items" "$dest/items" --exclude '*' --include '*.json' --content-type application/json $flag
  fi
  if [ -f "$src/README.md" ]; then
    aws s3 cp "$src/README.md" "$dest/README.md" --content-type "text/markdown; charset=utf-8" $flag
  fi
  if [ -f "$src/models.csv" ]; then
    aws s3 cp "$src/models.csv" "$dest/models.csv" --content-type "text/csv; charset=utf-8" $flag
  fi
  for png in "$src"/thumbnail*.png; do
    if [ -f "$png" ]; then
      aws s3 cp "$png" "$dest/$(basename "$png")" --content-type image/png $flag
    fi
  done
  aws s3 cp "$src/collection.json" "$dest/collection.json" --content-type application/json --cache-control "no-cache" $flag
  echo "restricted collection: atlas-restricted/$prefix/$only/collection.json (do not share publicly)"
  exit 0
fi

[ -d "$stage/biotrack_indicators" ] || { echo "nothing staged at $stage (run: uv run pipeline/build.py build --collection all)" >&2; exit 1; }

sync() { aws s3 sync "$1" "$2" --exclude '.DS_Store' $flag; }

# public: collection(s) + root catalog (catalog.json is a single file, not a directory sync)
sync "$stage/biotrack_indicators" "s3://$bucket/atlas/biotrack_indicators"
# aquamaps_native: registry + collection + docs + thumbnails (the COGs it references already live under marine-atlas/)
# registry_index.json is served gzip-encoded (1.1 MB -> ~300 KB; the app's size budget assumes it): it is excluded from
# the sync and uploaded from a gzip -9 copy with Content-Encoding gzip
if [ -d "$stage/aquamaps_native" ]; then
  aws s3 sync "$stage/aquamaps_native" "s3://$bucket/atlas/aquamaps_native" --exclude '.DS_Store' --exclude 'registry_index.json' $flag
  if [ -f "$stage/aquamaps_native/registry_index.json" ]; then
    tmp="$(mktemp -d)"
    gzip -9 -c "$stage/aquamaps_native/registry_index.json" > "$tmp/registry_index.json"
    aws s3 cp "$tmp/registry_index.json" "s3://$bucket/atlas/aquamaps_native/registry_index.json" \
      --content-encoding gzip --content-type application/json $flag
    rm -rf "$tmp"
  fi
fi
# aquamaps_eov/ is NOT synced from here: it is written (and uploaded) by oceanmetrics/workflows/aquamaps_eov.qmd.
# Only catalog.json is published from this repo, and it links ./aquamaps_eov/collection.json as its FIRST child.
# no-cache: without it S3 sends no Cache-Control and Chrome keeps the old catalog for hours (seen 2026-10-16:
# the app kept opening on BioTrack after the EOV collection was published), so the app must revalidate.
aws s3 cp "$stage/catalog.json" "s3://$bucket/atlas/catalog.json" --content-type application/json --cache-control "no-cache" $flag

# restricted: unlisted prefix, never linked from catalog.json
if [ -d "$stage/biotrack_species" ]; then
  prefix_file="$here/restricted_prefix.txt"
  [ -f "$prefix_file" ] || { echo "missing $prefix_file (run the species build first)" >&2; exit 1; }
  prefix="$(tr -d '[:space:]' < "$prefix_file")"
  sync "$stage/biotrack_species" "s3://$bucket/atlas-restricted/$prefix/biotrack_species"
  echo "restricted collection: atlas-restricted/$prefix/biotrack_species/collection.json (do not share publicly)"
fi
