# the obisindicators 0.12 additions to the fixture release, made from its own res-3 species table and lookup (the
# release made them the same way: obisindicators R/species.R), so the atlas's tests read the 0.12 layout:
#   species_flat/res=1.parquet, res=2.parquet   the res-3 rows summed by parent (n added, years min and max), no h3
#   species_flat/res=3/p=<res-1 parent>.parquet the res-3 rows split by their res-1 parent, no h3, row groups of 4
#   species/lineage.parquet                     aphiaid, name_key, lineage, sorted by aphiaid
#   species/species.parquet                     the lookup with `eov` (Teleostei fish, Aves seabirds, Cetacea
#                                               marineMammals, else NULL: a synthetic rule, not IOOS's)
# run from the repo root: uv run --with pyarrow python tests/fixtures/obis_h3/scripts/make_v012.py
import os

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

FIX = "tests/fixtures/obis_h3/"
RES_MASK = 15 << 52


def finer_than(r):
    return (1 << (3 * (15 - r))) - 1


def parent(cell, r):
    # h3Bits parentId: the resolution field set to r, the digits finer than r set to 7
    return (cell & ~(RES_MASK | finer_than(r)) & ((1 << 64) - 1)) | (r << 52) | finer_than(r)


flat = pq.read_table(FIX + "species_flat/res=3.parquet")
rows = flat.to_pylist()
cols = ["cell_id", "name_key", "aphiaid", "n", "year_min", "year_max"]
schema = pa.schema([flat.schema.field(c) for c in cols])


def write(path, recs, group):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    recs = sorted(recs, key=lambda x: (x["cell_id"], x["aphiaid"]))
    t = pa.Table.from_pylist([{c: x[c] for c in cols} for x in recs], schema=schema)
    pq.write_table(t, path, row_group_size=group, compression="zstd", write_statistics=True)


def mn(a, b):
    return b if a is None else a if b is None else min(a, b)


def mx(a, b):
    return b if a is None else a if b is None else max(a, b)


for r in (1, 2):
    acc = {}
    for x in rows:
        k = (parent(x["cell_id"], r), x["aphiaid"])
        h = acc.get(k)
        if h is None:
            acc[k] = {**x, "cell_id": k[0]}
        else:
            h["n"] += x["n"]
            h["year_min"] = mn(h["year_min"], x["year_min"])
            h["year_max"] = mx(h["year_max"], x["year_max"])
    write(f"{FIX}species_flat/res={r}.parquet", list(acc.values()), 8)

by_parent = {}
for x in rows:
    by_parent.setdefault(parent(x["cell_id"], 1), []).append(x)
for p, recs in by_parent.items():
    write(f"{FIX}species_flat/res=3/p={p:015x}.parquet", recs, 4)

lk = pq.read_table(FIX + "species/species.parquet")
if "eov" in lk.column_names:
    lk = lk.drop_columns(["eov"])
eov = []
for c, lin in zip(lk.column("class").to_pylist(), lk.column("lineage").to_pylist()):
    eov.append(
        "fish" if c == "Teleostei" else "seabirds" if c == "Aves"
        else "marineMammals" if 2688 in (lin or []) else None
    )
lk = lk.append_column(pa.field("eov", pa.string()), pa.array(eov, pa.string()))
pq.write_table(lk, FIX + "species/species.parquet", compression="zstd")

lin = lk.select(["aphiaid", "name_key", "lineage"])
lin = lin.take(pc.sort_indices(lin, sort_keys=[("aphiaid", "ascending")]))
pq.write_table(lin, FIX + "species/lineage.parquet", row_group_size=32, compression="zstd")
print({"parents": sorted(f"{p:015x}" for p in by_parent), "eov": {e: eov.count(e) for e in set(eov)}})
