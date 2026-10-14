"""synthetic fixtures: 3 small hexes near Cape Canaveral, no network, no raw data needed."""
import geopandas as gpd
import pandas as pd
import pytest
import shapely


def hexagon(cx: float, cy: float, r: float = 0.05):
  """flat-ish hexagon polygon with circumradius r degrees."""
  import math
  return shapely.Polygon([(cx + r * math.cos(math.radians(60 * i)), cy + r * math.sin(math.radians(60 * i))) for i in range(6)])


@pytest.fixture
def hexes() -> gpd.GeoDataFrame:
  geoms = [hexagon(-80.6, 28.4), hexagon(-80.6 + 0.0866 * 2 * 0.5 * 2, 28.4), hexagon(-80.6, 28.4 + 0.15)]
  return gpd.GeoDataFrame({"FID": [0, 1, 2]}, geometry=geoms, crs=4326)


@pytest.fixture
def species_sheet() -> pd.DataFrame:
  return pd.DataFrame({
    "name": ["Alopias vulpinus", "Caretta caretta", "Old name"],
    "numeric_id": [1, 17, 99],
    "abbreviation": ["Alovul", "Carcar", "Oldnam"],
    "iucn_code": ["VU", "EN", "LC"],
    "redlisted": [True, True, False],
    "group1": ["Shark", "Turtle", "Fish"],
    "group2": ["Shark", "Turtle", "Fish"],
  })


@pytest.fixture
def worms_json() -> dict:
  return {
    "Alopias vulpinus": [{"AphiaID": 105836, "scientificname": "Alopias vulpinus", "status": "accepted",
                          "valid_AphiaID": 105836, "valid_name": "Alopias vulpinus", "valid_authority": "(Bonnaterre, 1788)",
                          "match_type": "exact"}],
    "Caretta caretta": [{"AphiaID": 137205, "scientificname": "Caretta caretta", "status": "accepted",
                         "valid_AphiaID": 137205, "valid_name": "Caretta caretta", "valid_authority": "(Linnaeus, 1758)",
                         "match_type": "exact"}],
    "Old name": [{"AphiaID": 111111, "scientificname": "Old name", "status": "unaccepted",
                  "valid_AphiaID": 222222, "valid_name": "New name", "valid_authority": "X, 1900",
                  "match_type": "exact"}],
  }
