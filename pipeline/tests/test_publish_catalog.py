"""publish.sh --only catalog: the root catalog.json alone, published additively (no sync, no --delete, no other key)."""

import os
import stat
import subprocess
from pathlib import Path

PIPE = Path(__file__).resolve().parent.parent
DEST = "s3://oceanmetrics.io-public/atlas/catalog.json"


def run_publish(tmp_path, stage, *args):
  bindir = tmp_path / "bin"
  bindir.mkdir(exist_ok=True)
  aws = bindir / "aws"
  aws.write_text('#!/usr/bin/env bash\necho "$@" >> "$AWS_LOG"\nexit 0\n')
  aws.chmod(aws.stat().st_mode | stat.S_IEXEC)
  log = tmp_path / "aws.log"
  log.write_text("")
  env = os.environ | {"PATH": f"{bindir}:{os.environ['PATH']}", "AWS_LOG": str(log), "ATLAS_STAGE": str(stage),
                      "ATLAS_BUCKET": "oceanmetrics.io-public"}
  r = subprocess.run(["bash", str(PIPE / "publish.sh"), *args], env=env, capture_output=True, text=True)
  return r, [l for l in log.read_text().splitlines() if l]


def stage_root(tmp_path):
  d = tmp_path / "stage"
  (d / "aquamaps_native").mkdir(parents=True)
  (d / "biotrack_indicators").mkdir()
  (d / "catalog.json").write_text("{}")
  (d / "aquamaps_native" / "collection.json").write_text("{}")   # must never go
  return d


def test_dry_run_by_default_uploads_only_catalog_json_no_cache(tmp_path):
  d = stage_root(tmp_path)
  r, calls = run_publish(tmp_path, d, "--only", "catalog")
  assert r.returncode == 0, r.stderr
  assert "DRY RUN" in r.stdout
  assert calls == [f"s3 cp {d}/catalog.json {DEST} --content-type application/json --cache-control no-cache --dryrun"]


def test_really_uploads_one_file_and_never_syncs_or_deletes(tmp_path):
  d = stage_root(tmp_path)
  r, calls = run_publish(tmp_path, d, "--only", "catalog", "--really")
  assert r.returncode == 0, r.stderr
  assert calls == [f"s3 cp {d}/catalog.json {DEST} --content-type application/json --cache-control no-cache"]
  assert not any("sync" in c or "--delete" in c or "--dryrun" in c for c in calls)


def test_without_a_staged_catalog_nothing_runs(tmp_path):
  r, calls = run_publish(tmp_path, tmp_path / "empty", "--only", "catalog", "--really")
  assert r.returncode == 1 and calls == []
