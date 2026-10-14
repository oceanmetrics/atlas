import json

import pandas as pd
import pytest

from atlas_pipeline import taxa


class FakeSession:
  def __init__(self, payload):
    self.payload, self.calls = payload, []

  def get(self, url, params=None, timeout=None):
    self.calls.append(params)
    names = [v for k, v in params if k == "scientificnames[]"]
    return FakeResp([self.payload.get(n, []) for n in names])


class FakeResp:
  status_code = 200
  def __init__(self, data):
    self.data, self.text = data, json.dumps(data)
  def raise_for_status(self): pass
  def json(self): return self.data


def test_fetch_worms_batches_and_caches(tmp_path, worms_json):
  s = FakeSession(worms_json)
  names = list(worms_json)
  got = taxa.fetch_worms(names, tmp_path / "w.json", session=s)
  assert set(got) == set(names) and len(s.calls) == 1
  assert ("marine_only", "true") in s.calls[0]
  s2 = FakeSession(worms_json)
  taxa.fetch_worms(names, tmp_path / "w.json", session=s2)   # fully cached: no request
  assert s2.calls == []


def test_fetch_worms_batch_size_is_50(tmp_path):
  names = [f"Genus sp{i}" for i in range(120)]
  s = FakeSession({})
  taxa.fetch_worms(names, tmp_path / "w.json", session=s)
  assert len(s.calls) == 3


def test_resolve_uses_accepted_id_and_keeps_original(species_sheet, worms_json):
  t = taxa.resolve_taxa(species_sheet, worms_json).set_index("input_name")
  assert t.loc["Alopias vulpinus", "aphia_id"] == 105836
  assert t.loc["Alopias vulpinus", "worms_match_status"] == "exact"
  old = t.loc["Old name"]
  assert old["aphia_id"] == 222222 and old["matched_aphia_id"] == 111111
  assert old["scientific_name"] == "New name" and old["worms_match_status"] == "unaccepted:unaccepted"


def test_unmatched_name_is_reported_and_fails_check(species_sheet, worms_json):
  worms = {k: v for k, v in worms_json.items() if k != "Caretta caretta"}
  t = taxa.resolve_taxa(species_sheet, worms)
  assert t.set_index("input_name").loc["Caretta caretta", "worms_match_status"] == "unmatched"
  with pytest.raises(ValueError, match="unmatched"):
    taxa.check_taxa(t)


def test_duplicate_accepted_id_fails_check(species_sheet, worms_json):
  worms = dict(worms_json)
  worms["Old name"] = [dict(worms["Alopias vulpinus"][0], AphiaID=1)]
  with pytest.raises(ValueError, match="share"):
    taxa.check_taxa(taxa.resolve_taxa(species_sheet, worms))


def test_species_column_name():
  assert taxa.species_column(105836) == "aphia_105836"


# ---- common names ----

class FakeVernacularSession:
  """stands in for requests: 204 for ids in `none`, else the canned records; counts calls."""
  def __init__(self, records, none=()):
    self.records, self.none, self.calls = records, set(none), []

  def get(self, url, timeout=0):
    aphia = int(url.rsplit("/", 1)[1])
    self.calls.append(aphia)
    if aphia in self.none:
      return type("R", (), {"status_code": 204, "text": "", "raise_for_status": lambda s: None, "json": lambda s: None})()
    return type("R", (), {"status_code": 200, "text": "x", "raise_for_status": lambda s: None, "json": lambda s: self.records[aphia]})()


THRESHER = [{"vernacular": "allopia", "language_code": "ita"}, {"vernacular": " common thresher ", "language_code": "eng"},
            {"vernacular": "fox shark", "language_code": "eng"}]


def test_common_name_is_first_english_vernacular_trimmed():
  assert taxa.pick_common_name(THRESHER) == "common thresher"


def test_common_name_blank_without_english_or_records():
  assert taxa.pick_common_name([{"vernacular": "Fuchshai", "language_code": "deu"}]) == ""
  assert taxa.pick_common_name([]) == "" and taxa.pick_common_name(None) == ""
  assert taxa.pick_common_name([{"vernacular": "  ", "language_code": "eng"}]) == ""


def test_add_common_names_falls_back_to_blank_per_species():
  df = pd.DataFrame({"aphia_id": [105836, 137205]})
  out = taxa.add_common_names(df, {"105836": THRESHER, "137205": []})
  assert out["common_name"].tolist() == ["common thresher", ""]
  assert "common_name" not in df.columns   # input untouched


def test_fetch_vernaculars_caches_including_204(tmp_path):
  sess = FakeVernacularSession({105836: THRESHER}, none=[137205])
  cache = tmp_path / "cache" / "vernaculars.json"
  got = taxa.fetch_vernaculars([105836, 137205], cache, session=sess)
  assert got == {"105836": THRESHER, "137205": []} and sess.calls == [105836, 137205]
  again = taxa.fetch_vernaculars([137205, 105836], cache, session=sess)
  assert again == got and sess.calls == [105836, 137205]   # a re-run costs nothing
