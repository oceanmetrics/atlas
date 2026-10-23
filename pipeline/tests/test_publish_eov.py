"""publish.sh --only aquamaps_eov: the narrow re-publish of the EOV score COGs after `build.py cog-assets`.

Seeded faults the gate must catch: a --delete anywhere, a destination outside atlas/aquamaps_eov/, a collection.json
uploaded before the COGs and Items it names.
"""

import os
import stat
import subprocess
from pathlib import Path

PIPE = Path(__file__).resolve().parent.parent
DEST = "s3://oceanmetrics.io-public/atlas/aquamaps_eov"


def run_publish(tmp_path, stage, *args):
  bindir = tmp_path / "bin"
  bindir.mkdir(exist_ok=True)
  aws = bindir / "aws"
  aws.write_text('#!/usr/bin/env bash\necho "$@" >> "$AWS_LOG"\n')
  aws.chmod(aws.stat().st_mode | stat.S_IEXEC)
  log = tmp_path / "aws.log"
  log.write_text("")
  env = os.environ | {"PATH": f"{bindir}:{os.environ['PATH']}", "AWS_LOG": str(log), "ATLAS_STAGE": str(stage),
                      "ATLAS_BUCKET": "oceanmetrics.io-public"}
  r = subprocess.run(["bash", str(PIPE / "publish.sh"), *args], env=env, capture_output=True, text=True)
  return r, [l for l in log.read_text().splitlines() if l]


def stage_eov(tmp_path):
  d = tmp_path / "stage" / "aquamaps_eov"
  (d / "items").mkdir(parents=True)
  (d / "collection.json").write_text("{}")
  return d


def test_only_aquamaps_eov_is_a_dry_run_by_default_and_never_deletes(tmp_path):
  d = stage_eov(tmp_path)
  r, calls = run_publish(tmp_path, d.parent, "--only", "aquamaps_eov")
  assert r.returncode == 0, r.stderr
  assert calls and all("--dryrun" in c for c in calls)
  assert not any("--delete" in c for c in calls)


def test_only_aquamaps_eov_stays_under_its_prefix_and_ends_with_the_collection(tmp_path):
  d = stage_eov(tmp_path)
  r, calls = run_publish(tmp_path, d.parent, "--only", "aquamaps_eov", "--really")
  assert r.returncode == 0, r.stderr
  assert calls and not any("--dryrun" in c for c in calls)
  for c in calls:
    dests = [w for w in c.split() if w.startswith("s3://")]
    assert len(dests) == 1 and dests[0].startswith(DEST), c
  assert "--include score_*.tif" in calls[0] and "--exclude score_*_3857.tif" in calls[0]
  assert "--include score_*_3857.tif" in calls[1] and all("image/tiff" in c for c in calls[:2])
  assert calls[2].startswith(f"s3 sync {d}/items {DEST}/items")
  assert calls[-1].startswith(f"s3 cp {d}/collection.json {DEST}/collection.json")


def test_only_aquamaps_eov_without_a_staged_collection_uploads_nothing(tmp_path):
  r, calls = run_publish(tmp_path, tmp_path / "empty", "--only", "aquamaps_eov", "--really")
  assert r.returncode == 1 and calls == []
