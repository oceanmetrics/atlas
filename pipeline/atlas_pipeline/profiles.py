"""the Ocean Metrics STAC layer profiles (JSON Schemas of oceanmetrics/platform `packages/catalog`) as a build check.

`check_profiles(collection, items)` runs at build time (`cli.check_staging`): a Collection against `atlas-collection`
(and `sdm-dossier` when it has `sdm:response_type`), each Item against `atlas-item`, `sdm-dossier` and, when a data
asset is a cloud-optimized GeoTIFF, `cog`. The schemas are read from, in order: `$OM_SCHEMAS_DIR`,
`<repo>/node_modules/@oceanmetrics/catalog/schemas`, the sibling checkout `<repo>/../platform/packages/catalog/schemas`
(the same rule as oceanmetrics/extract `om_extract.schemas`)."""
import json
import os
from functools import lru_cache
from pathlib import Path

from jsonschema import Draft202012Validator

SCHEMA_ENV = "OM_SCHEMAS_DIR"
COG_MEDIA_TYPE = "image/tiff; application=geotiff; profile=cloud-optimized"


def _repo_root() -> Path:
  return Path(__file__).resolve().parents[2]


def _places(root: Path) -> list[tuple[str, Path | None]]:
  return [
    (f"${SCHEMA_ENV}", Path(os.environ[SCHEMA_ENV]) if os.environ.get(SCHEMA_ENV) else None),
    ("<repo>/node_modules/@oceanmetrics/catalog/schemas", root / "node_modules" / "@oceanmetrics" / "catalog" / "schemas"),
    ("<repo>/../platform/packages/catalog/schemas", root.parent / "platform" / "packages" / "catalog" / "schemas"),
  ]


def schema_dir(root: Path | None = None) -> Path:
  """the folder of `<profile>.schema.json` files; `$OM_SCHEMAS_DIR` is authoritative when set. Raises
  FileNotFoundError naming the three places when none exists."""
  places = _places(Path(root) if root else _repo_root())
  listing = "; ".join(f"{label} ({p if p is not None else 'unset'})" for label, p in places)
  env = places[0][1]
  if env is not None:
    if env.is_dir():
      return env
    raise FileNotFoundError(f"{places[0][0]}={env} is not a directory; the profiles are looked up in: {listing}")
  for _, p in places[1:]:
    if p.is_dir():
      return p
  raise FileNotFoundError(
    f"no catalog profiles found; looked in: {listing}. Run `npm ci` (devDependency @oceanmetrics/catalog), "
    f"check out oceanmetrics/platform beside this repo (../platform) or set {SCHEMA_ENV}.")


@lru_cache(maxsize=None)
def _validator(folder: str, profile: str) -> Draft202012Validator:
  path = Path(folder) / f"{profile}.schema.json"
  if not path.is_file():
    raise FileNotFoundError(f"profile {profile!r} not found: {path}")
  return Draft202012Validator(json.loads(path.read_text()))


def validate(profile: str, doc: dict) -> list[str]:
  """errors of `doc` against the named profile, `"<json pointer>: <message>"` each (empty = valid)."""
  v = _validator(str(schema_dir()), profile)
  errs = sorted(v.iter_errors(doc), key=lambda e: [str(p) for p in e.absolute_path])
  return [f"/{'/'.join(str(p) for p in e.absolute_path)}: {e.message}" for e in errs]


def has_data_cog(item: dict) -> bool:
  """true when an asset has the `data` role and the COG media type."""
  return any(a.get("type") == COG_MEDIA_TYPE and "data" in (a.get("roles") or [])
             for a in (item.get("assets") or {}).values())


def check_profiles(collection: dict, items: list[dict] | dict[str, dict] = ()) -> list[str]:
  """profile errors of a Collection and its Items, each prefixed by the document id (`<id>: <pointer>: <message>`)."""
  items = list(items.values()) if isinstance(items, dict) else list(items)
  bad = []
  profiles = ["atlas-collection"] + (["sdm-dossier"] if "sdm:response_type" in collection else [])
  for p in profiles:
    bad += [f"{collection.get('id')}: [{p}] {m}" for m in validate(p, collection)]
  for item in items:
    for p in ["atlas-item", "sdm-dossier"] + (["cog"] if has_data_cog(item) else []):
      bad += [f"{item.get('id')}: [{p}] {m}" for m in validate(p, item)]
  return bad
