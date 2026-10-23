"""publish.sh --only aquamaps_eov: the narrow re-publish of the EOV score COGs after `build.py cog-assets`, through om-publish.

Seeded faults the gate must catch: a --delete anywhere, a destination outside atlas/aquamaps_eov, a collection.json
published before the COGs and Items it names (the --last chain), the density_* files left out, a missing --size-only.
"""

from publish_fakes import run_publish

PREFIX = "atlas/aquamaps_eov"
FLAGS = ("--size-only --include score_* --include density_* --include items/* --include collection.json "
         "--exclude *.orig.tif --last score_*_3857.tif --last density_*_3857.tif --last items/* --last collection.json")


def stage_eov(tmp_path):
  d = tmp_path / "stage" / "aquamaps_eov"
  (d / "items").mkdir(parents=True)
  (d / "collection.json").write_text("{}")
  return d


def test_only_aquamaps_eov_is_a_dry_run_by_default_and_never_deletes(tmp_path):
  d = stage_eov(tmp_path)
  r, calls, aws = run_publish(tmp_path, d.parent, "--only", "aquamaps_eov")
  assert r.returncode == 0, r.stderr
  assert calls == [f"--dry-run {FLAGS} {d} {PREFIX}"]
  assert not any("--delete" in c for c in calls) and aws == []


def test_only_aquamaps_eov_is_one_call_to_its_prefix_with_the_collection_last(tmp_path):
  d = stage_eov(tmp_path)
  r, calls, _ = run_publish(tmp_path, d.parent, "--only", "aquamaps_eov", "--really")
  assert r.returncode == 0, r.stderr
  assert calls == [f"--really {FLAGS} {d} {PREFIX}"]
  c = calls[0]
  assert "--include density_*" in c and "--last density_*_3857.tif" in c   # the README one-liner once lacked density_*
  # the order of --last: score copies, density copies, Items, then collection.json
  lasts = [w for a, w in zip(c.split(), c.split()[1:]) if a == "--last"]
  assert lasts == ["score_*_3857.tif", "density_*_3857.tif", "items/*", "collection.json"]
  assert c.endswith(f" {PREFIX}") and "--dry-run" not in c


def test_only_aquamaps_eov_without_a_staged_collection_publishes_nothing(tmp_path):
  r, calls, _ = run_publish(tmp_path, tmp_path / "empty", "--only", "aquamaps_eov", "--really")
  assert r.returncode == 1 and calls == []
