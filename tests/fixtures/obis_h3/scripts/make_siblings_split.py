# a small split file whose res-1 parent (8129bffffffffff) holds res-3 hexagons under THREE res-2 hexagons:
# species_flat/res=3/p=8129bffffffffff.parquet. res-3 832980 and 832981 (res-2 parent 822987), 832988 (82298f) and
# 8329b0 (8229b7); 12 of 16 species each, the AphiaIDs shared between hexagons (so a res-2 hexagon sums); species with
# aphia % 5 == 0 have no years; row groups of 8 rows (so a res-2 hexagon skips the groups of its siblings); sorted by
# cell id; arithmetic columns, the same on every run. The cell ids are cellIdOf of each hex id (h3Bits).
# run from the repo root: uv run --with pyarrow python tests/fixtures/obis_h3/scripts/make_siblings_split.py
import pyarrow as pa
import pyarrow.parquet as pq

CELLS = [0x832980FFFFFFFFF, 0x832981FFFFFFFFF, 0x832988FFFFFFFFF, 0x8329B0FFFFFFFFF]
rows = []
for i, cell in enumerate(CELLS):
    for a in range(1, 17):
        if (a + i) % 4 == 0:
            continue
        years = a % 5 != 0
        rows.append(
            {
                "cell_id": cell,
                "name_key": 100000 + a * 37,
                "aphiaid": 2000000 + a,
                "n": 1 + (cell * 31 + a * 17) % 50,
                "year_min": 1950 + (cell + a * 7) % 40 if years else None,
                "year_max": 1990 + (cell + a * 11) % 35 if years else None,
                "res": 3,
            }
        )
rows.sort(key=lambda r: (r["cell_id"], r["aphiaid"]))
schema = pa.schema(
    [
        ("cell_id", pa.int64()),
        ("name_key", pa.int32()),
        ("aphiaid", pa.int64()),
        ("n", pa.int64()),
        ("year_min", pa.int16()),
        ("year_max", pa.int16()),
        ("res", pa.int64()),
    ]
)
t = pa.Table.from_pylist(rows, schema=schema)
pq.write_table(
    t,
    "tests/fixtures/obis_h3/species_flat/res=3/p=8129bffffffffff.parquet",
    compression="zstd",
    row_group_size=8,
)
print(len(rows), "rows")
