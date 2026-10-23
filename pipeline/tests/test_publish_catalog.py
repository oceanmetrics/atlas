"""publish.sh --only catalog: the root catalog.json alone, through om-publish (no other key, no delete, no-cache, history kept)."""

from publish_fakes import run_publish


def stage_root(tmp_path):
  d = tmp_path / "stage"
  (d / "aquamaps_native").mkdir(parents=True)
  (d / "biotrack_indicators").mkdir()
  (d / "catalog.json").write_text("{}")
  (d / "aquamaps_native" / "collection.json").write_text("{}")   # must never go
  return d


def test_dry_run_by_default_publishes_only_catalog_json_no_cache_with_history(tmp_path):
  d = stage_root(tmp_path)
  r, calls, aws = run_publish(tmp_path, d, "--only", "catalog")
  assert r.returncode == 0, r.stderr
  assert "DRY RUN" in r.stdout
  assert calls == [f"--dry-run --cache-control no-cache --keep-history --as catalog.json {d}/catalog.json atlas"]
  assert aws == []


def test_really_publishes_one_file_and_never_deletes(tmp_path):
  d = stage_root(tmp_path)
  r, calls, _ = run_publish(tmp_path, d, "--only", "catalog", "--really")
  assert r.returncode == 0, r.stderr
  assert calls == [f"--really --cache-control no-cache --keep-history --as catalog.json {d}/catalog.json atlas"]
  assert not any("--delete" in c or "--dry-run" in c for c in calls)


def test_without_a_staged_catalog_nothing_runs(tmp_path):
  r, calls, _ = run_publish(tmp_path, tmp_path / "empty", "--only", "catalog", "--really")
  assert r.returncode == 1 and calls == []
