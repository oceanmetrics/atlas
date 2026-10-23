"""publish.sh --only aquamaps_native: the collection.json alone, repointed at registry/v2, published additively.

Seeded faults the gate must catch: a --delete or a sync anywhere (a registry rewrite), a destination outside
atlas/aquamaps_native/collection.json, an upload before the registry file it names is confirmed on the bucket.
"""

import json
import os
import stat
import subprocess
from pathlib import Path

PIPE = Path(__file__).resolve().parent.parent
DEST = "s3://oceanmetrics.io-public/atlas/aquamaps_native/collection.json"


def run_publish(tmp_path, stage, *args, head_fails=False):
  bindir = tmp_path / "bin"
  bindir.mkdir(exist_ok=True)
  aws = bindir / "aws"
  aws.write_text('#!/usr/bin/env bash\necho "$@" >> "$AWS_LOG"\n[ "$1 $2" = "s3api head-object" ] && [ -n "${HEAD_FAILS:-}" ] && exit 254\nexit 0\n')
  aws.chmod(aws.stat().st_mode | stat.S_IEXEC)
  log = tmp_path / "aws.log"
  log.write_text("")
  env = os.environ | {"PATH": f"{bindir}:{os.environ['PATH']}", "AWS_LOG": str(log), "ATLAS_STAGE": str(stage),
                      "ATLAS_BUCKET": "oceanmetrics.io-public"} | ({"HEAD_FAILS": "1"} if head_fails else {})
  r = subprocess.run(["bash", str(PIPE / "publish.sh"), *args], env=env, capture_output=True, text=True)
  return r, [l for l in log.read_text().splitlines() if l]


def stage_native(tmp_path, href="./registry/v2/registry.parquet"):
  d = tmp_path / "stage" / "aquamaps_native"
  (d / "registry" / "v2").mkdir(parents=True, exist_ok=True)
  (d / "collection.json").write_text(json.dumps({"assets": {"registry": {"href": href}}}))
  # files a full sync would upload: they must never go
  (d / "registry" / "v2" / "registry.parquet").write_text("x")
  (d / "registry.parquet").write_text("x")
  (d / "registry_index.json").write_text("[]")
  return d


def uploads(calls):
  return [c for c in calls if c.startswith("s3 ")]


def test_dry_run_by_default_uploads_only_the_collection_and_never_deletes(tmp_path):
  d = stage_native(tmp_path)
  r, calls = run_publish(tmp_path, d.parent, "--only", "aquamaps_native")
  assert r.returncode == 0, r.stderr
  assert "DRY RUN" in r.stdout
  assert uploads(calls) == [f"s3 cp {d}/collection.json {DEST} --content-type application/json --cache-control no-cache --dryrun"]
  assert not any("--delete" in c or "sync" in c for c in calls)


def test_really_uploads_the_one_collection_file_and_no_registry(tmp_path):
  d = stage_native(tmp_path)
  r, calls = run_publish(tmp_path, d.parent, "--only", "aquamaps_native", "--really")
  assert r.returncode == 0, r.stderr
  assert uploads(calls) == [f"s3 cp {d}/collection.json {DEST} --content-type application/json --cache-control no-cache"]
  assert not any("--dryrun" in c or "--delete" in c or "registry" in c.replace("registry/v2/registry.parquet", "") for c in uploads(calls))
  assert not any(w.startswith("s3://") and w != DEST for c in uploads(calls) for w in c.split())


def test_the_registry_the_collection_names_is_checked_on_the_bucket_first(tmp_path):
  d = stage_native(tmp_path)
  r, calls = run_publish(tmp_path, d.parent, "--only", "aquamaps_native", "--really")
  assert calls[0] == "s3api head-object --bucket oceanmetrics.io-public --key atlas/aquamaps_native/registry/v2/registry.parquet"
  assert len(calls) == 2 and calls[1].startswith("s3 cp")


def test_a_registry_that_is_not_on_the_bucket_uploads_nothing(tmp_path):
  d = stage_native(tmp_path)
  r, calls = run_publish(tmp_path, d.parent, "--only", "aquamaps_native", "--really", head_fails=True)
  assert r.returncode == 1 and "not on the bucket" in r.stderr and uploads(calls) == []


def test_a_registry_href_outside_the_collection_folder_is_refused(tmp_path):
  for href in ("../other/registry.parquet", "https://evil.test/r.parquet", "./a/../../r.parquet", "./registry.csv"):
    d = stage_native(tmp_path, href)
    r, calls = run_publish(tmp_path, d.parent, "--only", "aquamaps_native", "--really")
    assert r.returncode == 1 and calls == [], href


def test_without_a_staged_collection_nothing_runs(tmp_path):
  r, calls = run_publish(tmp_path, tmp_path / "empty", "--only", "aquamaps_native", "--really")
  assert r.returncode == 1 and calls == []
