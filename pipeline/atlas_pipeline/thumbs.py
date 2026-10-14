"""collection thumbnails (thumbnail.png 1200x800, thumbnail-sm.png 400 px wide) rendered from the hex geometry.

  indicators_thumbnail: all_summer_richness on the hex grid (Spectral reversed, dark navy background)
  species_thumbnail:    2x2 panel of four species probability surfaces (summer)

The coastline is a light outline of Natural Earth 50m land, downloaded once into pipeline/cache/ne/; when it
cannot be had the thumbnail is drawn without it. Only matplotlib draws; the PNG is palette-quantized to stay
small (rashid PTL-VIZ-001 asks for a thumbnail asset per collection).
"""

from __future__ import annotations

import io
import warnings
from pathlib import Path

import geopandas as gpd
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from matplotlib.colors import LinearSegmentedColormap  # noqa: E402
from PIL import Image  # noqa: E402

from .docs import SPECTRAL_11_REV  # noqa: E402

BACKGROUND = "#05294d"
LAND_EDGE  = "#9db4cc"
LAND_FILL  = "#0c3a68"
TEXT       = "#e8f0f8"
SIZE       = (1200, 800)
SMALL_W    = 400
MAX_BYTES  = 300_000
NE_URL     = "https://naturalearth.s3.amazonaws.com/50m_physical/ne_50m_land.zip"
CACHE_DIR  = Path(__file__).resolve().parent.parent / "cache" / "ne"
CMAP       = LinearSegmentedColormap.from_list("spectral_r", SPECTRAL_11_REV)
SPECIES    = ["Sphyrna mokarran", "Caretta caretta", "Mobula birostris", "Epinephelus itajara"]
DPI        = 100


# ---- helpers ----

def land(bounds: tuple[float, float, float, float], cache: Path = CACHE_DIR) -> gpd.GeoDataFrame | None:
  """Natural Earth 50m land clipped to bounds (lon/lat), or None when it is unavailable offline."""
  zpath = cache / "ne_50m_land.zip"
  try:
    if not zpath.exists():
      import requests
      r = requests.get(NE_URL, timeout=30)
      r.raise_for_status()
      cache.mkdir(parents=True, exist_ok=True)
      zpath.write_bytes(r.content)
    g = gpd.read_file(f"zip://{zpath}")
  except Exception:
    return None
  return g.cx[bounds[0]:bounds[2], bounds[1]:bounds[3]]


def _pad(bounds, frac: float = 0.03):
  w, s, e, n = bounds
  dx, dy = (e - w) * frac, (n - s) * frac
  return w - dx, s - dy, e + dx, n + dy


def _draw(ax, hexg: gpd.GeoDataFrame, values: pd.Series, bounds, coast, edge: float = 0.4) -> None:
  hexg = hexg.assign(_v=values.to_numpy())
  hexg = hexg[hexg["_v"].notna()]
  ax.set_facecolor(BACKGROUND)
  if coast is not None and len(coast):
    coast.plot(ax=ax, color=LAND_FILL, linewidth=0)
  if len(hexg):
    hexg.plot(column="_v", ax=ax, cmap=CMAP, vmin=0, vmax=1, linewidth=edge, edgecolor="face", rasterized=True)
  if coast is not None and len(coast):
    coast.boundary.plot(ax=ax, color=LAND_EDGE, linewidth=0.5, alpha=0.8)
  w, s, e, n = bounds
  ax.set_xlim(w, e)
  ax.set_ylim(s, n)
  with warnings.catch_warnings():
    warnings.simplefilter("ignore", UserWarning)   # "ignoring fixed x limits": the view is widened on purpose
    ax.set_aspect(1 / np.cos(np.radians((s + n) / 2)), adjustable="datalim")   # fill the panel, widen the view
  ax.set_axis_off()


def save_png(fig, path: Path, size: tuple[int, int] = SIZE, max_bytes: int = MAX_BYTES) -> Path:
  """fig -> PNG of exactly `size` pixels; palette-quantized when the truecolor file exceeds max_bytes."""
  buf = io.BytesIO()
  fig.savefig(buf, format="png", dpi=DPI, facecolor=BACKGROUND)
  plt.close(fig)
  img = Image.open(io.BytesIO(buf.getvalue())).convert("RGB")
  assert img.size == size, f"rendered {img.size}, wanted {size}"
  path = Path(path)
  path.parent.mkdir(parents=True, exist_ok=True)
  img.save(path, optimize=True)
  if path.stat().st_size > max_bytes:
    img.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(path, optimize=True)
  return path


def small_copy(path: Path, width: int = SMALL_W) -> Path:
  """thumbnail-sm.png next to thumbnail.png: same picture, `width` px wide."""
  path = Path(path)
  img = Image.open(path).convert("RGB")
  h = round(img.height * width / img.width)
  out = path.with_name(path.stem + "-sm.png")
  img.resize((width, h), Image.Resampling.LANCZOS).save(out, optimize=True)
  return out


def _figure(size: tuple[int, int], nrows: int = 1, ncols: int = 1):
  fig, axes = plt.subplots(nrows, ncols, figsize=(size[0] / DPI, size[1] / DPI), dpi=DPI, squeeze=False)
  fig.patch.set_facecolor(BACKGROUND)
  fig.subplots_adjust(left=0, right=1, bottom=0, top=1, wspace=0.01, hspace=0.01)
  return fig, axes


def _colorbar(fig, label: str, rect=(0.03, 0.075, 0.2, 0.015)) -> None:
  cax = fig.add_axes(rect)
  sm = plt.cm.ScalarMappable(cmap=CMAP, norm=plt.Normalize(0, 1))
  cb = fig.colorbar(sm, cax=cax, orientation="horizontal", ticks=[0, 0.5, 1])
  cb.outline.set_visible(False)
  cb.ax.tick_params(colors=TEXT, labelsize=8, length=2)
  cb.set_label(label, color=TEXT, fontsize=9)


# ---- per collection ----

def indicators_thumbnail(hexg: gpd.GeoDataFrame, values: pd.DataFrame, out: Path,
                         column: str = "all_summer_richness", size: tuple[int, int] = SIZE,
                         coast: gpd.GeoDataFrame | None = None, use_land: bool = True) -> tuple[Path, Path]:
  """biotrack_indicators: `column` of values (joined to hexg by FID) coloured Spectral reversed on navy.
  Returns (thumbnail.png, thumbnail-sm.png)."""
  v = hexg[["FID"]].merge(values[["FID", column]], on="FID", how="left")[column]
  bounds = _pad(tuple(hexg.total_bounds))
  if coast is None and use_land:
    coast = land(bounds)
  fig, axes = _figure(size)
  _draw(axes[0, 0], hexg, v, bounds, coast)
  fig.text(0.02, 0.95, "MBON BioTrack: ecoregion-weighted species richness, summer", color=TEXT, fontsize=13,
           fontweight="bold", va="top")
  _colorbar(fig, "richness (0-1)")
  png = save_png(fig, out, size)
  return png, small_copy(png)


def species_thumbnail(hexg: gpd.GeoDataFrame, prob: pd.DataFrame, columns: dict[str, str], out: Path,
                      size: tuple[int, int] = SIZE, coast: gpd.GeoDataFrame | None = None,
                      use_land: bool = True) -> tuple[Path, Path]:
  """biotrack_species: 2x2 panel of probability surfaces. `columns` maps a panel label (scientific name) to its
  column in `prob` (FID + aphia_<id> columns), at most four. Returns (thumbnail.png, thumbnail-sm.png)."""
  assert 1 <= len(columns) <= 4, "a 2x2 panel holds one to four species"
  bounds = _pad(tuple(hexg.total_bounds))
  if coast is None and use_land:
    coast = land(bounds)
  fig, axes = _figure(size, 2, 2)
  for ax in axes.flat:
    ax.set_facecolor(BACKGROUND)
    ax.set_axis_off()
  for ax, (name, col) in zip(axes.flat, columns.items()):
    v = hexg[["FID"]].merge(prob[["FID", col]], on="FID", how="left")[col]
    _draw(ax, hexg, v, bounds, coast)
    ax.text(0.03, 0.97, name, transform=ax.transAxes, color=TEXT, fontsize=12, style="italic", va="top")
  fig.text(0.985, 0.012, "probability of occurrence, summer", color=TEXT, fontsize=8, ha="right")
  png = save_png(fig, out, size)
  return png, small_copy(png)


def species_panel_columns(species: pd.DataFrame, names: list[str] = SPECIES) -> dict[str, str]:
  """{scientific_name: aphia_<id>} for the wanted names present in the species lookup (order kept)."""
  by_name = dict(zip(species["scientific_name"], species["aphia_id"].astype(int)))
  return {n: f"aphia_{by_name[n]}" for n in names if n in by_name}
