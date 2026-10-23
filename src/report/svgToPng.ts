// report/svgToPng.ts -- atlas-7 step 3: rasterizes an inline `<svg>` string to a PNG, for the DOCX
// exporter's flower figures (Word has no vector-drawing surface this app can target; `docx`'s
// `ImageRun` wants raster bytes). Browser-only (canvas + `Image`), so this is never unit-tested
// under vitest's node environment -- it is exercised by the e2e DOCX-open gate instead.
import { REPORT_RASTER_BACKGROUND } from "./colors";

export interface RasterizedSvg {
  bytes: Uint8Array;
  width: number;
  height: number;
}

/** `svg` MUST carry explicit `width`/`height` attributes (every flower this app draws does, via
 * Flower.svelte's own viewBox convention) -- an SVG with no intrinsic size rasterizes to 0x0. */
export function rasterizeSvg(svg: string, width: number, height: number): Promise<RasterizedSvg> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("svgToPng: 2d canvas context unavailable"));
        return;
      }
      // white background: a flower's petals are painted at partial opacity over a transparent
      // SVG canvas, and a transparent PNG dropped into a Word paragraph shows through as black
      // in some renderers.
      ctx.fillStyle = REPORT_RASTER_BACKGROUND;
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((pngBlob) => {
        if (!pngBlob) {
          reject(new Error("svgToPng: canvas.toBlob returned null"));
          return;
        }
        pngBlob.arrayBuffer().then((buf) => resolve({ bytes: new Uint8Array(buf), width, height }));
      }, "image/png");
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("svgToPng: the flower SVG failed to load as an <img>"));
    };
    img.src = url;
  });
}
