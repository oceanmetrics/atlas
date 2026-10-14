import numpy as np
import pandas as pd
import pytest
from PIL import Image

from atlas_pipeline import stac, thumbs


@pytest.fixture
def values():
  return pd.DataFrame({"FID": [0, 1, 2], "all_summer_richness": [0.0, 0.5, 1.0]})


def test_indicators_thumbnail_has_requested_size_and_small_copy(hexes, values, tmp_path):
  png, small = thumbs.indicators_thumbnail(hexes, values, tmp_path / "thumbnail.png", size=(600, 400), use_land=False)
  assert png.name == "thumbnail.png" and small.name == "thumbnail-sm.png"
  assert Image.open(png).size == (600, 400)
  assert Image.open(small).size == (thumbs.SMALL_W, round(400 * thumbs.SMALL_W / 600))
  assert png.stat().st_size < thumbs.MAX_BYTES


def test_indicators_thumbnail_is_navy_with_colored_hexes(hexes, values, tmp_path):
  png, _ = thumbs.indicators_thumbnail(hexes, values, tmp_path / "t.png", size=(600, 400), use_land=False)
  px = np.asarray(Image.open(png).convert("RGB")).reshape(-1, 3)
  corner = tuple(np.asarray(Image.open(png).convert("RGB"))[-1, -1])
  assert corner == (5, 41, 77)                       # #05294d background
  assert len({tuple(p) for p in px[::37]}) > 3        # more than background: hex fills, text, colorbar


def test_species_thumbnail_is_a_2x2_panel_of_requested_size(hexes, tmp_path):
  prob = pd.DataFrame({"FID": [0, 1, 2], **{f"aphia_{i}": [0.1 * i, 0.5, 0.9] for i in range(1, 5)}})
  cols = {f"Species {i}": f"aphia_{i}" for i in range(1, 5)}
  png, small = thumbs.species_thumbnail(hexes, prob, cols, tmp_path / "thumbnail.png", size=(600, 400), use_land=False)
  assert Image.open(png).size == (600, 400) and Image.open(small).size[0] == thumbs.SMALL_W


def test_species_thumbnail_rejects_more_than_four_species(hexes, tmp_path):
  prob = pd.DataFrame({"FID": [0, 1, 2], **{f"aphia_{i}": [0.5] * 3 for i in range(5)}})
  with pytest.raises(AssertionError):
    thumbs.species_thumbnail(hexes, prob, {f"s{i}": f"aphia_{i}" for i in range(5)}, tmp_path / "t.png", use_land=False)


def test_species_panel_columns_keeps_present_names_in_order():
  sp = pd.DataFrame({"scientific_name": ["Caretta caretta", "Sphyrna mokarran"], "aphia_id": [137205, 105837]})
  assert thumbs.species_panel_columns(sp) == {"Sphyrna mokarran": "aphia_105837", "Caretta caretta": "aphia_137205"}


def test_collections_declare_thumbnail_asset_and_preview_link(tmp_path):
  (tmp_path / "thumbnail.png").write_bytes(b"\x89PNG fake")
  coll = stac.species_collection([0, 0, 1, 1], [{"scientific_name": "A b", "aphia_id": 1}], 3, 0, {})
  stac.add_file_info(coll, tmp_path)
  a = coll["assets"]["thumbnail"]
  assert a["roles"] == ["thumbnail"] and a["type"] == "image/png"
  assert a["file:size"] == 9 and a["file:checksum"].startswith("1220")
  assert any(l["rel"] == "preview" and l["href"] == "./thumbnail.png" for l in coll["links"])
