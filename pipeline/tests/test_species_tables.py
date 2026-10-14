import pandas as pd

from atlas_pipeline import cli, taxa


def tables():
  taxa_df = pd.DataFrame({"abbreviation": ["Alovul", "Carcar"], "aphia_id": [105836, 137205]})
  prob = pd.DataFrame({"FID": [0, 1, 2], "Alovul": [0.9, 0.7, 0.1], "Carcar": [0.6, 0.599, 0.8], "Extra": [0, 0, 0]})
  cls  = pd.DataFrame({"FID": [0, 1, 2], "Alovul": ["Very likely", "Likely", "Unlikely"],
                       "Carcar": ["Likely", "Unlikely", "Very likely"], "Extra": ["Unlikely"] * 3})
  return prob, cls, taxa_df


def test_species_columns_are_keyed_by_aphia_id():
  prob, cls, t = tables()
  p, c = cli.species_tables(prob, cls, t)
  assert list(p.columns) == ["FID", "aphia_105836", "aphia_137205"] == list(c.columns)


def test_cell_species_keeps_only_likely_rows():
  prob, cls, t = tables()
  p, c = cli.species_tables(prob, cls, t)
  d = cli.cell_species_long(p, c, "summer")
  assert list(d.columns) == ["FID", "season", "aphia_id", "prob", "class"]
  assert d[["FID", "aphia_id", "class"]].values.tolist() == [
    [0, 105836, "Very likely"], [0, 137205, "Likely"], [1, 105836, "Likely"], [2, 137205, "Very likely"]]
  assert (d["season"] == "summer").all() and d["prob"].min() >= 0.6
