"""the step 5 gate counter: COGs referenced without an EPSG:3857 copy, over the MST releases' side tables
(`marine-atlas/<ver>/tables/cog_3857.parquet`), the OM aquamaps_native registry (`cog_3857_url*`) and the OM Items
(a `*_3857` asset beside each COG asset), printed as one line. The gate is that number at 0.

  uv run python scripts/sweep_3857.py [--release v7 --release v7b ...] [--side-dir <cog-3857-batch --out dir>]

`--side-dir` reads a release's side table from a local batch dir before it is uploaded. Exit 0 when the count is 0,
1 otherwise.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from atlas_pipeline import cog3857  # noqa: E402


def main(argv=None) -> int:
  ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
  ap.add_argument("--release", action="append", default=None, help=f"MST release (default: {cog3857.SWEEP_RELEASES})")
  ap.add_argument("--base", default=cog3857.BASE, help="the marine-atlas/ root")
  ap.add_argument("--om-base", default=cog3857.OM_BASE, help="the OM atlas/ root")
  ap.add_argument("--side-dir", type=Path, default=None, help="a local cog-3857-batch --out dir")
  a = ap.parse_args(argv)
  r = cog3857.sweep(a.release or cog3857.SWEEP_RELEASES, a.base, a.om_base, a.side_dir)
  print(cog3857.sweep_line(r))
  return 0 if r["missing"] == 0 else 1


if __name__ == "__main__":
  sys.exit(main())
