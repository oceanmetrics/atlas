"""WoRMS alignment of the 66 BioTrack species (AphiaRecordsByMatchNames, cached)."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import requests

WORMS_URL = "https://www.marinespecies.org/rest/AphiaRecordsByMatchNames"
BATCH     = 50


# ---- fetch (cached) ----

def fetch_worms(names: list[str], cache: Path, marine_only: bool = True, session=None) -> dict:
  """{name: [aphia records]} for scientific names; the response is cached as json at `cache`.
  names missing from the cache are fetched in batches of 50, so a re-run costs nothing."""
  cache = Path(cache)
  have = json.loads(cache.read_text()) if cache.exists() else {}
  todo = [n for n in names if n not in have]
  sess = session or requests
  for i in range(0, len(todo), BATCH):
    batch  = todo[i:i + BATCH]
    params = [("scientificnames[]", n) for n in batch] + [("marine_only", str(marine_only).lower())]
    r = sess.get(WORMS_URL, params=params, timeout=60)
    r.raise_for_status()
    # 204 = no match for any name in the batch
    results = r.json() if r.status_code != 204 and r.text.strip() else [[] for _ in batch]
    if len(results) != len(batch):
      raise ValueError(f"WoRMS returned {len(results)} result sets for {len(batch)} names")
    for n, recs in zip(batch, results):
      have[n] = [rec for rec in (recs or []) if rec]
  if todo:
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(have, indent=1))
  return have


# ---- resolve ----

def pick_record(records: list[dict]) -> dict | None:
  """best record: exact matches first, then accepted over unaccepted."""
  if not records:
    return None
  rank = lambda r: (r.get("match_type") != "exact", r.get("status") != "accepted")
  return sorted(records, key=rank)[0]


def worms_match_status(name: str, rec: dict | None) -> str:
  """'exact' (exact match, accepted), 'unaccepted:<status>' (accepted id taken from valid_AphiaID),
  'fuzzy:<match_type>' or 'unmatched'."""
  if rec is None:
    return "unmatched"
  if rec.get("match_type") != "exact":
    return f"fuzzy:{rec.get('match_type')}"
  if rec.get("status") != "accepted":
    return f"unaccepted:{rec.get('status')}"
  return "exact"


def resolve_taxa(species: pd.DataFrame, worms: dict) -> pd.DataFrame:
  """species sheet (name, numeric_id, abbreviation, iucn_code, redlisted, group1, group2) + WoRMS records ->
  species lookup keyed by the accepted AphiaID; the matched (original) AphiaID is kept."""
  rows = []
  for r in species.itertuples(index=False):
    rec = pick_record(worms.get(r.name, []))
    status = worms_match_status(r.name, rec)
    rows.append({
      "aphia_id":           int(rec["valid_AphiaID"]) if rec else None,
      "scientific_name":    rec["valid_name"] if rec else r.name,
      "authority":          rec.get("valid_authority") if rec else None,
      "abbreviation":       r.abbreviation,
      "numeric_id":         int(r.numeric_id),
      "iucn_code":          r.iucn_code,
      "redlisted":          bool(r.redlisted),
      "group1":             r.group1,
      "group2":             r.group2,
      "input_name":         r.name,
      "matched_aphia_id":   int(rec["AphiaID"]) if rec else None,
      "worms_match_status": status,
    })
  d = pd.DataFrame(rows)
  d["aphia_id"] = d["aphia_id"].astype("Int64")
  d["matched_aphia_id"] = d["matched_aphia_id"].astype("Int64")
  return d


def check_taxa(taxa: pd.DataFrame) -> None:
  """every species resolved and no two species share an accepted AphiaID."""
  bad = taxa[taxa["aphia_id"].isna()]
  if len(bad):
    raise ValueError(f"unmatched in WoRMS: {bad['input_name'].tolist()}")
  dup = taxa[taxa["aphia_id"].duplicated(keep=False)]
  if len(dup):
    raise ValueError(f"species share an accepted AphiaID: {dup[['input_name', 'aphia_id']].values.tolist()}")


def species_column(aphia_id: int) -> str:
  return f"aphia_{int(aphia_id)}"
