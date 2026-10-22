"""every Collection and Item under the app's `tests/fixtures/catalog/**` and `tests/fixtures/registry/**` passes the
platform profiles (atlas-collection, atlas-item, sdm-dossier, cog), so the app's synthetic catalog cannot drift from
the contract the pipeline writes. The fixtures are synthetic; none carries restricted data or geometry."""

import json
from pathlib import Path

import pytest

from atlas_pipeline import profiles

FIXTURES = Path(__file__).resolve().parents[2] / "tests" / "fixtures"
# `catalog/mst/` mimics the EXTERNAL MarineSensitivity collections (https://file.marinesensitivity.org/stac/), which the
# atlas reads but does not write and the profiles do not govern (no `atlas:dims`, no `stac_version`); they stay as the
# app's parser tests need them.
EXTERNAL = "catalog/mst/"


def documents():
  out = []
  for sub in ("catalog", "registry"):
    for p in sorted((FIXTURES / sub).rglob("*.json")):
      doc = json.loads(p.read_text())
      if p.relative_to(FIXTURES).as_posix().startswith(EXTERNAL):
        continue
      if isinstance(doc, dict) and doc.get("type") in ("Collection", "Feature"):
        out.append(pytest.param(p, doc, id=str(p.relative_to(FIXTURES))))
  return out


def test_the_fixtures_are_found():
  kinds = {d.values[1]["type"] for d in documents()}
  assert kinds == {"Collection", "Feature"} and len(documents()) >= 10


@pytest.mark.parametrize(("path", "doc"), documents())
def test_fixture_passes_its_profiles(path, doc):
  bad = profiles.check_profiles(doc, []) if doc["type"] == "Collection" else profiles.check_profiles({"id": "-"}, [doc])
  bad = [m for m in bad if not m.startswith("-: ")]   # the stand-in collection is not under test
  assert bad == [], f"{path.name}: " + "; ".join(bad)
