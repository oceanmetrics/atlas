"""command line: `build --collection <slug>` and `check` (see pipeline/build.py)."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import secrets
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from . import biotrack as bt
from . import docs, grid, stac, taxa

PIPE_DIR   = Path(__file__).resolve().parent.parent
REPO_DIR   = PIPE_DIR.parent
RAW_DIR    = Path("~/My Drive/projects/oceanmetrics/data/raw/couto.thiagoba@gmail.com_indicators").expanduser()
STAGING    = REPO_DIR / "catalog" / "staging"
COLLECTIONS = ["biotrack_indicators", "biotrack_species", "catalog"]
CROCKFORD  = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
H3_DECIMALS = 4


# ---- helpers ----

def ulid(now_ms: int | None = None) -> str:
  """26-char ULID (48-bit ms timestamp + 80 random bits), Crockford base32."""
  t = int(time.time() * 1000) if now_ms is None else now_ms
  n = (t << 80) | secrets.randbits(80)
  return "".join(CROCKFORD[(n >> (5 * i)) & 31] for i in reversed(range(26)))


def restricted_prefix(path: Path = PIPE_DIR / "restricted_prefix.txt") -> str:
  """random unlisted prefix for the restricted collection, created once and kept (git-ignored)."""
  if not path.exists():
    path.write_text(ulid() + "\n")
  return path.read_text().strip()


def write_parquet(df: pd.DataFrame, path: Path, row_group_size: int = 50_000) -> None:
  path.parent.mkdir(parents=True, exist_ok=True)
  pq.write_table(pa.Table.from_pandas(df, preserve_index=False), path, compression="zstd", row_group_size=row_group_size)


def pa_types(path: Path) -> dict[str, str]:
  s = pq.read_schema(path)
  return {f.name: str(f.type) for f in s}


def log(msg: str) -> None:
  print(f"[{dt.datetime.now():%H:%M:%S}] {msg}", flush=True)


def raw_paths(raw: Path) -> dict[str, Path]:
  base = raw / bt.RAW_SUBDIR
  return {"shp": base / "Shapefiles", "sp": base / "spList", "xlsx": base / bt.XLSX_NAME, "fid": raw / "fid.geojson"}


# ---- biotrack_indicators ----

PUBLIC_SPECIES_COLUMNS = ["aphia_id", "scientific_name", "abbreviation", "iucn_code", "redlisted", "group1", "group2", "common_name"]
CELL_SPECIES_COLUMNS   = ["FID", "season", "aphia_id", "prob", "class"]


def public_species_tables(raw: Path = RAW_DIR, session=None) -> tuple[pd.DataFrame, pd.DataFrame]:
  """the public species list: (cell_species long table, species lookup with English common names).
  Neil Hammerschlag asked for "click a cell, see the list of species" as a public feature; the per-species MAP
  surfaces (prob_*/class_*) stay restricted, so only these two small tables go into biotrack_indicators."""
  rp = raw_paths(raw)
  sp = bt.read_species_sheet(rp["xlsx"])
  worms = taxa.fetch_worms(sp["name"].tolist(), PIPE_DIR / "cache" / "worms.json", session=session)
  taxa_df = taxa.resolve_taxa(sp, worms)
  taxa.check_taxa(taxa_df)
  vern = taxa.fetch_vernaculars(taxa_df["aphia_id"].astype(int).tolist(), PIPE_DIR / "cache" / "vernaculars.json", session=session)
  species = taxa.add_common_names(taxa_df, vern)
  species = species.assign(aphia_id=species["aphia_id"].astype("int32"))[PUBLIC_SPECIES_COLUMNS]
  longs = []
  for season in bt.SEASONS:
    prob = bt.read_sppresence(rp["sp"] / f"Indicator_SpPresence_Prob_{season}.csv")
    cls  = bt.read_sppresence(rp["sp"] / f"Indicator_SpPresence_Class_{season}.csv")
    p, c = species_tables(prob, cls, taxa_df)
    longs.append(cell_species_long(p, c, season))
  return pd.concat(longs, ignore_index=True)[CELL_SPECIES_COLUMNS], species.reset_index(drop=True)


def provenance_sources(raw: Path, paths: list[Path]) -> list[dict]:
  return [{"path": str(p.relative_to(raw)), "bytes": p.stat().st_size, "sha256": bt.sha256_file(p)} for p in paths]


def build_indicators(raw: Path = RAW_DIR, out: Path = STAGING, skip_tiles: bool = False) -> dict:
  rp = raw_paths(raw)
  dest = out / "biotrack_indicators"
  dest.mkdir(parents=True, exist_ok=True)

  log("reading hex grid and 36 shapefiles")
  hexg = grid.read_hex(rp["fid"])
  values = bt.read_values(rp["shp"])
  if set(hexg["FID"]) != set(values["FID"]):
    raise ValueError("FID sets differ between fid.geojson and the shapefiles")
  vcols = [c for c in values.columns if c != "FID"]
  write_parquet(values, dest / "values.parquet")
  log(f"values.parquet: {len(values)} rows x {len(vcols)} columns")

  hex_info = {}
  if skip_tiles and (dest / "hex.pmtiles").exists():
    hex_info = {"bytes": (dest / "hex.pmtiles").stat().st_size, "cmd": None}
  else:
    log("tippecanoe -> hex.pmtiles")
    hex_info = grid.build_pmtiles(hexg, dest / "hex.pmtiles")
  hex_info["tile_stats"] = grid.tile_size_stats(dest / "hex.pmtiles").to_dict("records")

  write_parquet(grid.hex_centroids(hexg), dest / "hex_centroids.parquet")
  log("hex_centroids.parquet")

  log("h3 crosswalk")
  xw = grid.build_crosswalk(hexg)
  write_parquet(xw, dest / "hex_h3.parquet")
  num_cols = [c for c in vcols if not c.endswith(tuple(bt.CLASS_SUFFIXES))]
  vh3 = grid.aggregate_to_h3(values, xw, num_cols)
  vh3[num_cols] = vh3[num_cols].round(H3_DECIMALS)   # 4 dp: 166 MB -> ~70 MB, far below the models' precision
  write_parquet(vh3, dest / "values_h3.parquet")
  log(f"hex_h3.parquet {len(xw)} rows; values_h3.parquet {len(vh3)} cells")

  log("public species list (cell_species.parquet, species.parquet)")
  cell_sp, species = public_species_tables(raw)
  write_parquet(cell_sp, dest / "cell_species.parquet")
  write_parquet(species, dest / "species.parquet")
  log(f"cell_species.parquet: {len(cell_sp):,} rows; species.parquet: {len(species)} species, "
      f"{int((species['common_name'] != '').sum())} with an English common name")

  # stac
  bbox = [round(float(x), 6) for x in hexg.total_bounds]
  dtypes = {k: ("string" if v == "string" or v.startswith("large_string") else "double") for k, v in pa_types(dest / "values.parquet").items()}
  stac.write_json(dest / "styles" / "default.json", docs.style_default())
  fcache: dict = {}
  coll = stac.indicators_collection(bbox, vcols, dtypes, num_cols, len(values), len(vh3), hex_info,
                                    species_rows={"cell_species": len(cell_sp), "species": len(species)})
  stac.write_json(dest / "collection.json", stac.add_file_info(coll, dest, fcache))
  ranges = {c: (float(values[c].min()), float(values[c].max())) for c in num_cols}
  items = stac.indicator_items(bbox, ranges)
  for iid, item in items.items():
    stac.write_json(dest / "items" / f"{iid}.json", stac.add_file_info(item, dest / "items", fcache))

  fields = bt.read_fields_sheet(rp["xlsx"])
  counts = {"n_hex": len(values), "n_values_cols": len(vcols),
            "n_null_richness": int(values["all_summer_richness"].isna().sum())}
  counts |= {"n_cell_species": len(cell_sp), "n_species": len(species)}
  (dest / "README.md").write_text(docs.indicators_readme(fields, counts))
  (dest / "AGENTS.md").write_text(docs.indicators_agents(counts))

  log("provenance (checksums)")
  srcs = sorted(rp["shp"].glob("Ind_*.shp")) + sorted(rp["shp"].glob("Ind_*.dbf")) + sorted(rp["sp"].glob("*.csv")) + [rp["xlsx"], rp["fid"]]
  prov = {
    "collection": "biotrack_indicators",
    "retrieved": dt.date.today().isoformat(),
    "built": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
    "source_dir": "Google Drive: projects/oceanmetrics/data/raw/couto.thiagoba@gmail.com_indicators",
    "sources": provenance_sources(raw, srcs),
    "record_counts": {"hexes": len(values), "shapefiles": len(list(rp["shp"].glob("Ind_*.shp"))),
                      "value_columns": len(vcols), "cell_species_rows": len(cell_sp), "species": len(species), "h3_crosswalk_rows": len(xw), "h3_cells": len(vh3),
                      "items": len(items)},
    "tippecanoe": {"version": grid.tippecanoe_version(), "cmd": hex_info.get("cmd")},
    "hex_pmtiles_bytes": hex_info["bytes"],
    "tile_size_by_zoom": hex_info["tile_stats"],
  }
  stac.write_json(dest / "provenance.json", prov)
  return {"dest": dest, "counts": prov["record_counts"], "hex_info": hex_info}


# ---- biotrack_species (restricted) ----

def species_tables(prob: pd.DataFrame, cls: pd.DataFrame, taxa_df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
  """abbreviation-keyed tables -> aphia-keyed (aphia_<id>) tables."""
  rename = {r.abbreviation: taxa.species_column(r.aphia_id) for r in taxa_df.itertuples()}
  keep = ["FID"] + list(rename)
  return prob[keep].rename(columns=rename), cls[keep].rename(columns=rename)


def cell_species_long(prob: pd.DataFrame, cls: pd.DataFrame, season: str) -> pd.DataFrame:
  """wide prob/class -> long rows FID, season, aphia_id, prob, class, only Likely and Very likely."""
  p = prob.melt(id_vars="FID", var_name="col", value_name="prob")
  c = cls.melt(id_vars="FID", var_name="col", value_name="class")
  d = p.merge(c, on=["FID", "col"])
  d = d[d["class"].isin(["Likely", "Very likely"])].copy()
  d["aphia_id"] = d["col"].str.removeprefix("aphia_").astype("int32")
  d["season"] = season
  d["FID"] = d["FID"].astype("int32")
  d["prob"] = d["prob"].astype("float32")
  return d[["FID", "season", "aphia_id", "prob", "class"]].sort_values(["FID", "aphia_id"]).reset_index(drop=True)


def build_species(raw: Path = RAW_DIR, out: Path = STAGING) -> dict:
  rp = raw_paths(raw)
  dest = out / "biotrack_species"
  dest.mkdir(parents=True, exist_ok=True)
  sp = bt.read_species_sheet(rp["xlsx"])
  worms = taxa.fetch_worms(sp["name"].tolist(), PIPE_DIR / "cache" / "worms.json")
  taxa_df = taxa.resolve_taxa(sp, worms)
  taxa.check_taxa(taxa_df)
  write_parquet(taxa_df.assign(aphia_id=taxa_df["aphia_id"].astype("int64"), matched_aphia_id=taxa_df["matched_aphia_id"].astype("int64")),
                dest / "species.parquet")

  tables, longs, ranges, mismatches = {}, [], {}, 0
  for season in bt.SEASONS:
    prob = bt.read_sppresence(rp["sp"] / f"Indicator_SpPresence_Prob_{season}.csv")
    cls  = bt.read_sppresence(rp["sp"] / f"Indicator_SpPresence_Class_{season}.csv")
    p, c = species_tables(prob, cls, taxa_df)
    write_parquet(p, dest / f"prob_{season}.parquet")
    write_parquet(c, dest / f"class_{season}.parquet")
    for k, df, ty, title in (("prob", p, "double", f"probability of occurrence, {season}"),
                             ("class", c, "string", f"probability class, {season}")):
      tables[f"{k}_{season}"] = {"title": f"{title}, one column per species (aphia_<id>)",
                                 "columns": [{"name": "FID", "type": "int64"}] +
                                            [{"name": n, "type": ty} for n in df.columns if n != "FID"]}
    for r in taxa_df.itertuples():
      col = taxa.species_column(r.aphia_id)
      ranges[(int(r.aphia_id), season)] = (float(p[col].min()), float(p[col].max()))
    longs.append(cell_species_long(p, c, season))
  cell = pd.concat(longs, ignore_index=True)
  write_parquet(cell, dest / "cell_species.parquet")

  hexg_bbox = [round(float(x), 6) for x in grid.read_hex(rp["fid"]).total_bounds]
  rows = taxa_df.assign(aphia_id=taxa_df["aphia_id"].astype(int)).to_dict("records")
  nhex = len(prob)
  coll = stac.species_collection(hexg_bbox, rows, nhex, len(cell), tables)
  fcache: dict = {}
  stac.write_json(dest / "collection.json", stac.add_file_info(coll, dest, fcache))
  items = stac.species_items(hexg_bbox, rows, ranges)
  for iid, item in items.items():
    stac.write_json(dest / "items" / f"{iid}.json", stac.add_file_info(item, dest / "items", fcache))
  (dest / "README.md").write_text(docs.species_readme({"n_hex": nhex, "cell_rows": len(cell)}))
  (dest / "AGENTS.md").write_text(docs.species_agents())
  restricted_prefix()   # create the unlisted prefix once (pipeline/restricted_prefix.txt, git-ignored)
  return {"dest": dest, "items": len(items), "species": len(taxa_df), "cell_rows": len(cell),
          "cell_bytes": (dest / "cell_species.parquet").stat().st_size, "taxa": taxa_df}


# ---- catalog ----

def fetch_external_titles(children: list[dict]) -> list[dict]:
  """keep the configured titles, refreshing the two v8 ones from their live collection.json when reachable."""
  import requests
  out = []
  for c in children:
    title = c["title"]
    if "/v8/" in c["href"]:
      try:
        title = requests.get(c["href"], timeout=20).json().get("title", title)
      except Exception:
        pass
    out.append({"href": c["href"], "title": title})
  return out


def build_catalog(out: Path = STAGING, fetch_titles: bool = True) -> Path:
  children = fetch_external_titles(stac.EXTERNAL_CHILDREN) if fetch_titles else stac.EXTERNAL_CHILDREN
  path = out / "catalog.json"
  stac.write_json(path, stac.root_catalog(children))
  (out / "README.md").write_text(docs.catalog_readme())
  (out / "AGENTS.md").write_text(docs.catalog_agents())
  return path


# ---- check ----

def load_json(p: Path) -> dict:
  return json.loads(p.read_text())


def check_staging(out: Path = STAGING) -> list[str]:
  """offline structural checks of everything staged; returns the list of problems (empty = ok)."""
  bad: list[str] = []
  cat = out / "catalog.json"
  if not cat.exists():
    return [f"{cat} missing"]
  c = load_json(cat)
  bad += [f"catalog: {m}" for m in stac.check_stac_required({**c, "type": "Catalog"}) if m.startswith("missing") and "extent" not in m]
  if "biotrack_species" in json.dumps(c) or "atlas-restricted" in json.dumps(c):
    bad.append("catalog.json links the restricted collection")
  for coll_dir in sorted(p for p in out.iterdir() if p.is_dir()):
    cj = coll_dir / "collection.json"
    if not cj.exists():
      continue
    coll = load_json(cj)
    bad += [f"{coll_dir.name}: {m}" for m in stac.check_stac_required(coll)]
    for k, a in coll.get("assets", {}).items():
      if coll_dir.name != "biotrack_indicators" or a["href"].startswith("http"):
        continue
      f = (coll_dir / a["href"]).resolve()
      if not f.exists():
        bad.append(f"{coll_dir.name}: collection asset {k} -> {a['href']} not found")
      elif f.suffix == ".parquet" and "table:columns" in a:
        have = pq.read_schema(f).names
        want = [c["name"] for c in a["table:columns"]]
        if k in ("cell_species", "species") and have != want:
          bad.append(f"{coll_dir.name}: asset {k} columns {have} differ from table:columns {want}")
    for item_link in [l for l in coll["links"] if l["rel"] == "item"]:
      ip = coll_dir / item_link["href"]
      if not ip.exists():
        bad.append(f"{coll_dir.name}: missing item {item_link['href']}")
        continue
      item = load_json(ip)
      bad += [f"{ip.name}: {m}" for m in stac.check_stac_required(item)]
      for k, a in item["assets"].items():
        if a["href"].startswith("http"):
          continue
        if not (ip.parent / a["href"]).resolve().exists():
          bad.append(f"{ip.name}: asset {k} -> {a['href']} not found")
        elif "atlas:value_column" in a:
          cols = pq.read_schema((ip.parent / a["href"]).resolve()).names
          if a["atlas:value_column"] not in cols:
            bad.append(f"{ip.name}: {a['atlas:value_column']} not a column of {a['href']}")
    if coll_dir.name == "biotrack_indicators":
      hx = coll_dir / "hex.pmtiles"
      if hx.exists() and grid.pmtiles_attribute_names(hx) != ["FID"]:
        bad.append(f"hex.pmtiles attributes are {grid.pmtiles_attribute_names(hx)}, expected ['FID']")
      xw = coll_dir / "hex_h3.parquet"
      if xw.exists():
        s = pq.read_table(xw).to_pandas().groupby("FID")["weight"].sum()
        if not np.allclose(s, 1.0):
          bad.append("hex_h3 weights do not sum to 1 per FID")
  return bad


def validate_stac(out: Path = STAGING) -> list[str]:
  """pystac core validation (network for core/extension schemas) plus the stac-sdm schema when reachable."""
  import jsonschema
  import pystac
  bad = []
  sdm_local = Path("~/Github/MarineSensitivity/stac-sdm/json-schema/schema.json").expanduser()
  sdm = json.loads(sdm_local.read_text()) if sdm_local.exists() else None
  for p in sorted(out.rglob("*.json")):
    if p.parent.name == "styles" or p.name in ("provenance.json",):
      continue
    obj = load_json(p)
    if sdm is not None and stac.EXT["sdm"] in obj.get("stac_extensions", []):
      try:
        jsonschema.validate(obj, sdm)
      except jsonschema.ValidationError as e:
        bad.append(f"{p.relative_to(out)}: sdm schema: {e.message[:200]}")
    try:
      cls = {"Collection": pystac.Collection, "Feature": pystac.Item, "Catalog": pystac.Catalog}[obj["type"]]
      cls.from_file(str(p)).validate()
    except Exception as e:
      bad.append(f"{p.relative_to(out)}: pystac: {str(e)[:300]}")
  return bad


# ---- main ----

def main(argv=None) -> int:
  ap = argparse.ArgumentParser(prog="build.py", description=__doc__)
  sub = ap.add_subparsers(dest="cmd", required=True)
  b = sub.add_parser("build", help="build one collection into catalog/staging/")
  b.add_argument("--collection", choices=COLLECTIONS + ["all"], required=True)
  b.add_argument("--raw", type=Path, default=RAW_DIR)
  b.add_argument("--out", type=Path, default=STAGING)
  b.add_argument("--skip-tiles", action="store_true", help="reuse an existing hex.pmtiles")
  c = sub.add_parser("check", help="check the staged catalog (offline)")
  c.add_argument("--out", type=Path, default=STAGING)
  c.add_argument("--validate", action="store_true", help="also run pystac + stac-sdm schema validation (network)")
  a = ap.parse_args(argv)

  if a.cmd == "build":
    todo = COLLECTIONS if a.collection == "all" else [a.collection]
    for slug in todo:
      log(f"== {slug}")
      if slug == "biotrack_indicators":
        r = build_indicators(a.raw, a.out, a.skip_tiles)
        log(f"done: {r['counts']}")
      elif slug == "biotrack_species":
        r = build_species(a.raw, a.out)
        log(f"done: {r['species']} species, {r['items']} items, cell_species {r['cell_rows']:,} rows, {r['cell_bytes']/1e6:.1f} MB")
      else:
        log(f"wrote {build_catalog(a.out)}")
    return 0
  bad = check_staging(a.out)
  if a.validate:
    bad += validate_stac(a.out)
  for m in bad:
    print("PROBLEM:", m)
  print("check: ok" if not bad else f"check: {len(bad)} problem(s)")
  return 1 if bad else 0
