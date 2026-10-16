#!/usr/bin/env bash
# publish the staged atlas catalog to S3. DRY RUN by default; pass --really to upload.
#   pipeline/publish.sh            # aws s3 sync --dryrun
#   pipeline/publish.sh --really   # real upload (needs AWS keys with write access to the bucket)
# the restricted species collection goes to an unlisted prefix kept in pipeline/restricted_prefix.txt (git-ignored).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(dirname "$here")"
stage="$repo/catalog/staging"
bucket="${ATLAS_BUCKET:-oceanmetrics.io-public}"

flag="--dryrun"
for a in "$@"; do
  case "$a" in
    --really) flag="" ;;
    -h|--help) sed -n '2,5p' "$0"; exit 0 ;;
    *) echo "unknown argument: $a" >&2; exit 2 ;;
  esac
done
[ -n "$flag" ] && echo "DRY RUN (add --really to publish)" || echo "PUBLISHING to s3://$bucket"

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
aws s3 cp "$stage/catalog.json" "s3://$bucket/atlas/catalog.json" --content-type application/json $flag

# restricted: unlisted prefix, never linked from catalog.json
if [ -d "$stage/biotrack_species" ]; then
  prefix_file="$here/restricted_prefix.txt"
  [ -f "$prefix_file" ] || { echo "missing $prefix_file (run the species build first)" >&2; exit 1; }
  prefix="$(tr -d '[:space:]' < "$prefix_file")"
  sync "$stage/biotrack_species" "s3://$bucket/atlas-restricted/$prefix/biotrack_species"
  echo "restricted collection: atlas-restricted/$prefix/biotrack_species/collection.json (do not share publicly)"
fi
