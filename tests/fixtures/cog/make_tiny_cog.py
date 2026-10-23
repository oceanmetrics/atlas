# the tiny COG tests/raster/cogPoint.test.ts reads over HTTP Range: 9 bands (the EOV flower's band order: all,
# fish, hardCorals, mangroves, marineMammals, seabirds, seagrasses, seaTurtles, n_eov), uint8, nodata 255,
# EPSG:4326, 8 x 4 pixels of 0.5 degree from (0, 2) to (4, 0). pixel (col 1, row 1), centre (0.75, 1.25), holds
# tests/catalog/flower.test.ts's BANDS (seabirds masked, seagrasses the Byte nodata); every other pixel holds
# band * 10 + col. regenerate:
#   uv run --with rasterio --with numpy python tests/fixtures/cog/make_tiny_cog.py tests/fixtures/cog/tiny_eov_4326.tif
import sys

import numpy as np
import rasterio
from rasterio.transform import from_origin

dst = sys.argv[1]
bands, rows, cols = 9, 4, 8
a = np.zeros((bands, rows, cols), dtype="uint8")
for b in range(bands):
  for c in range(cols):
    a[b, :, c] = (b + 1) * 10 + c
a[:, 1, 1] = [50, 80, 60, 40, 20, 255, 255, 50, 5]
profile = dict(
  driver="COG", width=cols, height=rows, count=bands, dtype="uint8", nodata=255, crs="EPSG:4326",
  transform=from_origin(0, 2, 0.5, 0.5), blocksize=16, compress="deflate", overview_resampling="nearest",
)
with rasterio.open(dst, "w", **profile) as ds:
  ds.write(a)
