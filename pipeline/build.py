# /// script
# requires-python = ">=3.11"
# dependencies = ["geopandas>=1.0", "shapely>=2.1", "pyarrow>=17", "duckdb>=1.1", "h3>=4.1", "openpyxl>=3.1", "requests>=2.31", "pmtiles>=3.4", "numpy>=1.26", "pandas>=2.2", "pystac>=1.10", "jsonschema>=4"]
# ///
"""atlas pipeline entry: `uv run pipeline/build.py build --collection biotrack_indicators`, `... check`."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from atlas_pipeline.cli import main  # noqa: E402

if __name__ == "__main__":
  sys.exit(main())
