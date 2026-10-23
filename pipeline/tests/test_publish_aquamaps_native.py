"""publish.sh --only aquamaps_native: the collection.json alone, repointed at registry/v2, published additively.

Seeded faults the gate must catch: a --delete or a folder publish anywhere (a registry rewrite), a destination outside
atlas/aquamaps_native, an upload before the registry file it names is confirmed on the bucket.
"""

import json

from publish_fakes import BUCKET, run_publish

PREFIX = "atlas/aquamaps_native"


def stage_native(tmp_path, href="./registry/v2/registry.parquet"):
  d = tmp_path / "stage" / "aquamaps_native"
  (d / "registry" / "v2").mkdir(parents=True, exist_ok=True)
  (d / "collection.json").write_text(json.dumps({"assets": {"registry": {"href": href}}}))
  # files a full publish would send: they must never go
  (d / "registry" / "v2" / "registry.parquet").write_text("x")
  (d / "registry.parquet").write_text("x")
  (d / "registry_index.json").write_text("[]")
  return d


def test_dry_run_by_default_publishes_only_the_collection_no_cache(tmp_path):
  d = stage_native(tmp_path)
  r, calls, _ = run_publish(tmp_path, d.parent, "--only", "aquamaps_native")
  assert r.returncode == 0, r.stderr
  assert "DRY RUN" in r.stdout
  assert calls == [f"--dry-run --cache-control no-cache {d}/collection.json {PREFIX}"]
  assert not any("--delete" in c for c in calls)


def test_really_publishes_the_one_collection_file_and_no_registry(tmp_path):
  d = stage_native(tmp_path)
  r, calls, _ = run_publish(tmp_path, d.parent, "--only", "aquamaps_native", "--really")
  assert r.returncode == 0, r.stderr
  assert calls == [f"--really --cache-control no-cache {d}/collection.json {PREFIX}"]


def test_the_registry_the_collection_names_is_checked_on_the_bucket_first(tmp_path):
  d = stage_native(tmp_path)
  r, calls, aws = run_publish(tmp_path, d.parent, "--only", "aquamaps_native", "--really")
  assert aws == [f"s3api head-object --bucket {BUCKET} --key atlas/aquamaps_native/registry/v2/registry.parquet"]
  assert len(calls) == 1


def test_a_registry_that_is_not_on_the_bucket_publishes_nothing(tmp_path):
  d = stage_native(tmp_path)
  r, calls, _ = run_publish(tmp_path, d.parent, "--only", "aquamaps_native", "--really", head_fails=True)
  assert r.returncode == 1 and "not on the bucket" in r.stderr and calls == []


def test_a_registry_href_outside_the_collection_folder_is_refused(tmp_path):
  for href in ("../other/registry.parquet", "https://evil.test/r.parquet", "./a/../../r.parquet", "./registry.csv"):
    d = stage_native(tmp_path, href)
    r, calls, _ = run_publish(tmp_path, d.parent, "--only", "aquamaps_native", "--really")
    assert r.returncode == 1 and calls == [], href


def test_without_a_staged_collection_nothing_runs(tmp_path):
  r, calls, _ = run_publish(tmp_path, tmp_path / "empty", "--only", "aquamaps_native", "--really")
  assert r.returncode == 1 and calls == []
