"""publish.sh through om-publish: the default run, the restricted collections (the ULID guard), the help and the exit codes.

Each test pins the exact om-publish call lines of one mode. Seeded faults the gate must catch: a --delete anywhere,
registry_index.json published without Content-Encoding gzip (or not gzipped), catalog.json before the folders it links,
catalog.json without no-cache or history, a restricted destination outside atlas-restricted/<ULID>/<name>, the
restricted collection.json published before the rest, a real run on a dry-run default.
"""

from publish_fakes import ULID, run_publish


def stage_all(tmp_path, species=True):
  d = tmp_path / "stage"
  (d / "biotrack_indicators").mkdir(parents=True)
  (d / "biotrack_indicators" / "collection.json").write_text("{}")
  (d / "aquamaps_native").mkdir()
  (d / "aquamaps_native" / "collection.json").write_text("{}")
  (d / "aquamaps_native" / "registry_index.json").write_text('["a"]')
  (d / "catalog.json").write_text("{}")
  if species:
    (d / "biotrack_species").mkdir()
    (d / "biotrack_species" / "collection.json").write_text("{}")
  return d


def test_default_run_is_a_dry_run_and_calls_om_publish_in_order(tmp_path):
  d = stage_all(tmp_path, species=False)
  r, calls, aws = run_publish(tmp_path, d)
  assert r.returncode == 0, r.stderr
  assert "DRY RUN" in r.stdout and aws == []
  assert len(calls) == 5   # folder, folder, gzip copy (+ its gz: line), catalog
  assert calls[0] == f"--dry-run {d}/biotrack_indicators atlas/biotrack_indicators"
  assert calls[1] == f"--dry-run --exclude registry_index.json {d}/aquamaps_native atlas/aquamaps_native"
  assert calls[2].startswith("--dry-run --content-encoding gzip ") and calls[2].endswith("/registry_index.json atlas/aquamaps_native")
  assert calls[3] == "gz:1f8b080000000000"   # gzip, and reproducible (-n: no name, no mtime), so an unchanged file is skipped
  assert calls[4] == f"--dry-run --cache-control no-cache --keep-history {d}/catalog.json atlas"


def test_default_really_maps_to_really_and_catalog_json_is_after_the_folders(tmp_path):
  d = stage_all(tmp_path, species=False)
  r, calls, _ = run_publish(tmp_path, d, "--really")
  assert r.returncode == 0, r.stderr
  assert "PUBLISHING" in r.stdout
  real = [c for c in calls if not c.startswith("gz:")]
  assert len(real) == 4 and all(c.startswith("--really ") for c in real)
  assert not any("--dry-run" in c or "--delete" in c for c in calls)
  assert real[-1] == f"--really --cache-control no-cache --keep-history {d}/catalog.json atlas"


def test_default_run_with_the_restricted_species_collection(tmp_path):
  d = stage_all(tmp_path)
  r, calls, _ = run_publish(tmp_path, d, "--really", prefix_files={"restricted_prefix.txt": ULID})
  assert r.returncode == 0, r.stderr
  real = [c for c in calls if not c.startswith("gz:")]
  dest = f"atlas-restricted/{ULID}/biotrack_species"
  assert real[-2:] == [f"--really --exclude collection.json {d}/biotrack_species {dest}",
                       f"--really --cache-control no-cache {d}/biotrack_species/collection.json {dest}"]
  assert "restricted collection:" in r.stdout


def test_default_run_refuses_a_restricted_prefix_that_is_not_a_ulid(tmp_path):
  d = stage_all(tmp_path)
  for bad in ("public", "01HZX3K9M2Q7R8S4T5V6W7X8Y", "../" + ULID[3:], "01hzx3k9m2q7r8s4t5v6w7x8y9", ULID + "/x"):
    r, calls, _ = run_publish(tmp_path, d, "--really", prefix_files={"restricted_prefix.txt": bad})
    assert r.returncode == 1 and "is not atlas-restricted/<ULID>/biotrack_species" in r.stderr, bad
    assert not any("atlas-restricted" in c for c in calls), bad   # the public part ran, the restricted never did


def test_default_run_without_a_prefix_file_publishes_no_restricted_collection(tmp_path):
  d = stage_all(tmp_path)
  r, calls, _ = run_publish(tmp_path, d, "--really")
  assert r.returncode == 1 and "missing" in r.stderr
  assert not any("atlas-restricted" in c for c in calls)


def test_only_a_restricted_collection_goes_to_its_ulid_prefix_with_collection_json_last(tmp_path):
  d = tmp_path / "stage"
  (d / "swfsc_cce_becker2020b" / "cog").mkdir(parents=True)
  (d / "swfsc_cce_becker2020b" / "collection.json").write_text("{}")
  pf = {"restricted_prefix_swfsc_cce.txt": ULID}
  src = f"{d}/swfsc_cce_becker2020b"
  dest = f"atlas-restricted/{ULID}/swfsc_cce_becker2020b"
  r, calls, _ = run_publish(tmp_path, d, "--only", "swfsc_cce_becker2020b", prefix_files=pf)
  assert r.returncode == 0, r.stderr
  assert calls == [f"--dry-run --exclude collection.json {src} {dest}",
                   f"--dry-run --cache-control no-cache {src}/collection.json {dest}"]
  r, calls, _ = run_publish(tmp_path, d, "--only", "swfsc_cce_becker2020b", "--really", prefix_files=pf)
  assert calls == [f"--really --exclude collection.json {src} {dest}",
                   f"--really --cache-control no-cache {src}/collection.json {dest}"]
  assert not any("--delete" in c for c in calls)


def test_only_a_restricted_collection_refuses_a_bad_prefix_and_an_unknown_name(tmp_path):
  d = tmp_path / "stage"
  (d / "swfsc_cce_becker2020b").mkdir(parents=True)
  (d / "swfsc_cce_becker2020b" / "collection.json").write_text("{}")
  for bad in ("public", "01HZX3K9M2Q7R8S4T5V6W7X8", "ILOU" + ULID[4:]):   # I, L, O, U are not Crockford base32
    r, calls, _ = run_publish(tmp_path, d, "--only", "swfsc_cce_becker2020b", "--really",
                              prefix_files={"restricted_prefix_swfsc_cce.txt": bad})
    assert r.returncode == 1 and calls == [], bad
  r, calls, _ = run_publish(tmp_path, d, "--only", "nope", "--really")
  assert r.returncode == 2 and calls == []


def test_an_immutable_rewrite_exit_3_stops_the_run_before_catalog_json(tmp_path):
  d = stage_all(tmp_path)
  # the second call is aquamaps_native/ (registry/v<N>/ is edge-immutable): om-publish exits 3, nothing after it runs
  r, calls, _ = run_publish(tmp_path, d, "--really", fail_call=2, prefix_files={"restricted_prefix.txt": ULID})
  assert r.returncode == 3
  assert len(calls) == 2 and not any("catalog.json" in c or "atlas-restricted" in c for c in calls)


def test_a_missing_publisher_stops_with_its_name(tmp_path):
  d = stage_all(tmp_path)
  r, calls, _ = run_publish(tmp_path, d, "--really", publisher=False)
  assert r.returncode == 1 and "om-publish.sh not found" in r.stderr and calls == []


def test_help_names_om_publish_and_the_edge_immutable_exit_3(tmp_path):
  r, calls, _ = run_publish(tmp_path, tmp_path / "x", "--help")
  assert r.returncode == 0 and calls == []
  assert "om-publish.sh" in r.stdout and "exits 3 BY DESIGN" in r.stdout and "registry/v<N>/" in r.stdout


def test_unknown_arguments_and_a_dry_run_flag(tmp_path):
  d = stage_all(tmp_path, species=False)
  r, calls, _ = run_publish(tmp_path, d, "--delete")
  assert r.returncode == 2 and calls == []
  r, calls, _ = run_publish(tmp_path, d, "--really", "--dry-run")   # the last flag wins
  assert r.returncode == 0 and calls[0].startswith("--dry-run ")
