"""one-off: write hex_centroids.parquet (FID, lon, lat) from the raw fid.geojson.

  uv run python scripts/hex_centroids.py [fid.geojson] [out.parquet]

Defaults: the raw BioTrack folder on Google Drive -> catalog/staging/biotrack_indicators/hex_centroids.parquet
(the repo-relative staging folder, git-ignored). A normal `build.py build` writes the same file
(atlas_pipeline.cli.build_indicators), so this script only exists to publish the file without a rebuild.
Publish (both stores, no delete; dry run unless --really):
  ../platform/scripts/om-publish.sh --really <out> atlas/biotrack_indicators --as hex_centroids.parquet
"""
import sys
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from atlas_pipeline import grid  # noqa: E402

RAW = Path.home() / "My Drive/projects/oceanmetrics/data/raw/couto.thiagoba@gmail.com_indicators/fid.geojson"
OUT = Path(__file__).resolve().parents[2] / "catalog/staging/biotrack_indicators/hex_centroids.parquet"


def main(src: Path = RAW, out: Path = OUT) -> None:
  df = grid.hex_centroids(grid.read_hex(src))
  out.parent.mkdir(parents=True, exist_ok=True)
  pq.write_table(pa.Table.from_pandas(df, preserve_index=False), out, compression="zstd")
  print(f"{len(df)} rows -> {out} ({out.stat().st_size:,} bytes)")


if __name__ == "__main__":
  main(*(Path(a) for a in sys.argv[1:3]))
