#!/usr/bin/env bash
# publish the staged atlas catalog through oceanmetrics/platform scripts/om-publish.sh (the one publisher: BOTH stores, R2
# `oceanmetrics-io-public-enam` first, then S3 `oceanmetrics.io-public`; it never deletes). DRY RUN by default; --really uploads.
#   pipeline/publish.sh            # om-publish --dry-run (read-only listings of both stores)
#   pipeline/publish.sh --really   # real upload (R2 keys: ~/.config/oceanmetrics/r2.env; AWS: the host's profile)
#   pipeline/publish.sh --only swfsc_cce_becker2020b [--really]   # ONE restricted collection (+ its COGs), nothing else
#   pipeline/publish.sh --only aquamaps_eov [--really]   # the EOV score + density COGs, their _3857 copies, Items, collection.json; no delete
#   pipeline/publish.sh --only aquamaps_native [--really]   # ONLY aquamaps_native/collection.json (repointed at registry/v2); nothing else, no delete
#   pipeline/publish.sh --only catalog [--really]   # ONLY catalog.json (the root; no-cache); nothing else, no delete
# the restricted species collection goes to an unlisted prefix kept in pipeline/restricted_prefix.txt (git-ignored);
# a collection published with --only has its own prefix file (pipeline/restricted_prefix_<name>.txt, git-ignored).
# a restricted destination must be atlas-restricted/<26-character ULID>/<name> or nothing runs.
# the publisher is $OM_PUBLISH, else a platform checkout beside this repo, else ~/Github/oceanmetrics/platform.
# exit 3 (from om-publish, a dry run too): an immutable key would be overwritten with different bytes. atlas/<collection>/
# **/v<N>/** is edge-immutable (the storage Worker caches it for a year), so a re-publish of atlas/aquamaps_native/registry/v<N>/
# with other bytes exits 3 BY DESIGN: publish a new registry/v<N+1>/ and repoint collection.json (--only aquamaps_native).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(dirname "$here")"
stage="${ATLAS_STAGE:-$repo/catalog/staging}"
prefix_dir="${ATLAS_PREFIX_DIR:-$here}"
bucket="${ATLAS_BUCKET:-oceanmetrics.io-public}"   # only for the head-object read of --only aquamaps_native

mode="--dry-run"
only=""
while [ $# -gt 0 ]; do
  case "$1" in
    --really) mode="--really" ;;
    --dry-run|--dryrun) mode="--dry-run" ;;
    --only) [ $# -ge 2 ] || { echo "--only needs a collection name" >&2; exit 2; }; only="$2"; shift ;;
    --only=*) only="${1#--only=}" ;;
    -h|--help) sed -n "2,16p" "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

# the publisher: OM_PUBLISH wins; else a platform checkout beside this repo; else ~/Github/oceanmetrics/platform
P="${OM_PUBLISH:-}"
if [ -z "$P" ]; then
  for c in "$(dirname "$repo")/platform/scripts/om-publish.sh" "$HOME/Github/oceanmetrics/platform/scripts/om-publish.sh"; do
    if [ -x "$c" ]; then P="$c"; break; fi
  done
fi
[ -n "$P" ] && [ -x "$P" ] || { echo "om-publish.sh not found (set OM_PUBLISH to oceanmetrics/platform scripts/om-publish.sh)" >&2; exit 1; }

[ "$mode" = "--really" ] && echo "PUBLISHING through $P (both stores)" || echo "DRY RUN (add --really to publish)"

# the guard: a restricted destination is atlas-restricted/<26-character ULID>/<name> exactly, or nothing runs
restricted_dest() {   # restricted_dest <prefix> <name> -> the key prefix on stdout
  local dest="atlas-restricted/$1/$2"
  [[ "$dest" =~ ^atlas-restricted/[0-9A-HJKMNP-TV-Z]{26}/$2$ ]] || {
    echo "refusing: destination $dest is not atlas-restricted/<ULID>/$2" >&2; return 1; }
  printf '%s' "$dest"
}

# one restricted collection folder: everything but collection.json, then collection.json alone (no-cache) last, so a
# visitor never gets a collection whose items or COGs are not there yet
publish_restricted() {   # publish_restricted <source folder> <key prefix>
  [ -f "$1/collection.json" ] || { echo "nothing staged at $1 (no collection.json)" >&2; exit 1; }
  "$P" "$mode" --exclude collection.json "$1" "$2"
  "$P" "$mode" --cache-control no-cache "$1/collection.json" "$2"
  echo "restricted collection: $2/collection.json (do not share publicly)"
}

# ---- --only aquamaps_eov: the score and density COGs, their _3857 copies, the Items and collection.json of the PUBLIC EOV collection ----
# the rest of the product (Parquet) is written and uploaded by oceanmetrics/workflows/aquamaps_eov.qmd; this
# is the narrow re-publish after `build.py cog-assets` (the staging folder holds score_*.tif, score_*_3857.tif, items/ and a
# collection.json read from the bucket with the new file:size/file:checksum). om-publish never deletes and --size-only skips a
# key whose size is unchanged, so a COG or Item already published as it stands is not touched.
# order (--last): COGs, their _3857 copies, Items, collection.json last (a visitor never gets a collection whose files are not there yet).
if [ "$only" = "aquamaps_eov" ]; then
  src="$stage/aquamaps_eov"
  [ -f "$src/collection.json" ] || { echo "nothing staged at $src" >&2; exit 1; }
  echo "target: atlas/aquamaps_eov/"
  "$P" "$mode" --size-only --include 'score_*' --include 'density_*' --include 'items/*' --include collection.json \
    --exclude '*.orig.tif' --last 'score_*_3857.tif' --last 'density_*_3857.tif' --last 'items/*' --last collection.json \
    "$src" atlas/aquamaps_eov
  exit 0
fi

# ---- --only aquamaps_native: the collection.json alone, repointed at a registry version already on the bucket ----
# `build.py aquamaps-registry <registry/v2/registry.parquet>` writes the staged collection.json (the live one with its
# registry asset's href, file:size, file:checksum and table:columns following the new file, version bumped). The registry
# file itself was uploaded by `build.py cog-3857-batch --pool` and is NOT touched here: one file, and only after the file
# the collection names is confirmed on the bucket (a collection never points at a registry that is not there; a read).
# The old unversioned registry.parquet stays, so a cached collection.json still works.
if [ "$only" = "aquamaps_native" ]; then
  src="$stage/aquamaps_native"
  [ -f "$src/collection.json" ] || { echo "nothing staged at $src (run: uv run pipeline/build.py aquamaps-registry <registry.parquet>)" >&2; exit 1; }
  href="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["assets"]["registry"]["href"])' "$src/collection.json")"
  [[ "$href" =~ ^\./[A-Za-z0-9_./-]+\.parquet$ && "$href" != *..* ]] || { echo "refusing: registry href '$href' is not a relative .parquet path" >&2; exit 1; }
  echo "target: atlas/aquamaps_native/collection.json (registry asset: $href)"
  aws s3api head-object --bucket "$bucket" --key "atlas/aquamaps_native/${href#./}" > /dev/null || {
    echo "refusing: s3://$bucket/atlas/aquamaps_native/${href#./} is not on the bucket" >&2; exit 1; }
  "$P" "$mode" --cache-control no-cache "$src/collection.json" atlas/aquamaps_native
  exit 0
fi

# ---- --only catalog: the root catalog.json alone (additive: a child link added) ----
# `build.py build --collection catalog` writes the staged catalog.json. One file, no-cache as in the full publish.
if [ "$only" = "catalog" ]; then
  [ -f "$stage/catalog.json" ] || { echo "nothing staged at $stage/catalog.json (run: uv run pipeline/build.py build --collection catalog)" >&2; exit 1; }
  echo "target: atlas/catalog.json"
  "$P" "$mode" --cache-control no-cache --keep-history --as catalog.json "$stage/catalog.json" atlas
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
  pf="$(only_prefix_file "$only")" || { echo "--only: unknown collection '$only' (known: swfsc_cce_becker2020b, aquamaps_eov, aquamaps_native, catalog)" >&2; exit 2; }
  src="$stage/$only"
  [ -f "$src/collection.json" ] || { echo "nothing staged at $src (run: uv run pipeline/build.py build --collection $only)" >&2; exit 1; }
  [ -f "$pf" ] || { echo "missing $pf (the build creates it)" >&2; exit 1; }
  dest="$(restricted_dest "$(tr -d '[:space:]' < "$pf")" "$only")" || exit 1
  echo "target: $dest/"
  publish_restricted "$src" "$dest"
  exit 0
fi

[ -d "$stage/biotrack_indicators" ] || { echo "nothing staged at $stage (run: uv run pipeline/build.py build --collection all)" >&2; exit 1; }

# public: collection(s) + root catalog (catalog.json is a single file, not a folder)
"$P" "$mode" "$stage/biotrack_indicators" atlas/biotrack_indicators
# aquamaps_native: registry + collection + docs + thumbnails (the COGs it references already live under marine-atlas/)
# registry_index.json is served gzip-encoded (1.1 MB -> ~300 KB; the app's size budget assumes it): it is left out of the
# folder and published from a gzip -9 -n copy (no name, no time: the same bytes every run, so an unchanged file is skipped) with Content-Encoding gzip
if [ -d "$stage/aquamaps_native" ]; then
  "$P" "$mode" --exclude registry_index.json "$stage/aquamaps_native" atlas/aquamaps_native
  if [ -f "$stage/aquamaps_native/registry_index.json" ]; then
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT
    gzip -9 -n -c "$stage/aquamaps_native/registry_index.json" > "$tmp/registry_index.json"
    "$P" "$mode" --content-encoding gzip "$tmp/registry_index.json" atlas/aquamaps_native
  fi
fi
# aquamaps_eov/ is NOT published from here: it is written (and uploaded) by oceanmetrics/workflows/aquamaps_eov.qmd.
# Only catalog.json is published from this repo, and it links ./aquamaps_eov/collection.json as its FIRST child.
# no-cache: without it S3 sends no Cache-Control and Chrome keeps the old catalog for hours (seen 2026-10-16:
# the app kept opening on BioTrack after the EOV collection was published), so the app must revalidate. --keep-history
# keeps the replaced one at atlas/_history/<date>/ on R2.
"$P" "$mode" --cache-control no-cache --keep-history "$stage/catalog.json" atlas

# restricted: unlisted prefix, never linked from catalog.json
if [ -d "$stage/biotrack_species" ]; then
  prefix_file="$prefix_dir/restricted_prefix.txt"
  [ -f "$prefix_file" ] || { echo "missing $prefix_file (run the species build first)" >&2; exit 1; }
  dest="$(restricted_dest "$(tr -d '[:space:]' < "$prefix_file")" biotrack_species)" || exit 1
  publish_restricted "$stage/biotrack_species" "$dest"
fi
