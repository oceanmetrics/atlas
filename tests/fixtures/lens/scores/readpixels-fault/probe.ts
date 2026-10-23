// SEEDED FAULT for tests/lens/scores/no-readpixels.test.ts — this file exists only to be scanned.
//
// Reading the popup's cell value off a rendered canvas (a `readPixels` sample of the raster tile)
// is the bug plan D4 forbids: "numbers never come from the tile server". The real value comes from
// `analysis/queries.ts#cellValue()`, a read of the wide `cell` Parquet tile.
interface Gl {
  readPixels(x: number, y: number, w: number, h: number, format: number, type: number): void;
}

export function probeCellColor(gl: Gl): void {
  gl.readPixels(0, 0, 1, 1, 0, 0);
}
