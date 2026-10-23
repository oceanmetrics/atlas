// "N of M rasters drawn from the browser" (build week 6 step 5): the evidence for titiler's retirement, on the page.
// Every raster layer the composed style draws (the score COG, a species surface, a collection raster, the mask
// overlay) is one of two origins, told apart by its tile template: `cog://` is the browser (the 3857 copy through
// the COG protocol, `raster/cog.ts`), a `/cog/tiles/` url is titiler. The tally counts each raster once per visit
// (by its file, so a new ramp or rescale of the same file is not a second raster) and only while it is visible (a
// hidden layer asks for no tiles). The About dialog shows the line; M - N is what still depends on titiler.
import type { RasterLayerSpec } from "../map/types";

export type RasterOrigin = "browser" | "titiler";

/** the raster a layer draws and who draws it, or null for a layer that is neither (a hidden one included). */
export function rasterOriginOf(
  spec: Pick<RasterLayerSpec, "tiles" | "visible"> | null | undefined,
): { key: string; origin: RasterOrigin } | null {
  if (!spec || spec.visible === false) return null;
  const t = spec.tiles[0];
  if (typeof t !== "string") return null;
  if (t.startsWith("cog://")) {
    // cog://<href>#color:.../{z}/{x}/{y}: the file is the href before the hash (or before the tile path)
    const rest = t.slice("cog://".length);
    const hash = rest.indexOf("#");
    const file = hash >= 0 ? rest.slice(0, hash) : rest.replace(/\/\{z\}\/\{x\}\/\{y\}$/, "");
    return { key: file, origin: "browser" };
  }
  const m = /\/cog\/tiles\/[^?]*\?(?:.*&)?url=([^&]+)/.exec(t);
  if (m) {
    let url = m[1];
    try {
      url = decodeURIComponent(url);
    } catch {
      // a malformed escape: the encoded form still names the file
    }
    return { key: url, origin: "titiler" };
  }
  return null;
}

/** `seen` with the rasters of `specs` added (a raster keeps the origin it was first drawn with); the same object
 * when nothing is new, so a caller can skip a reactive write. */
export function tallyRasters(
  seen: Readonly<Record<string, RasterOrigin>>,
  specs: readonly (Pick<RasterLayerSpec, "tiles" | "visible"> | null | undefined)[],
): Readonly<Record<string, RasterOrigin>> {
  let out: Record<string, RasterOrigin> | null = null;
  for (const s of specs) {
    const o = rasterOriginOf(s);
    if (!o || o.key in seen || (out && o.key in out)) continue;
    out ??= { ...seen };
    out[o.key] = o.origin;
  }
  return out ?? seen;
}

export interface RasterTally {
  browser: number;
  total: number;
}

export function tallyCounts(seen: Readonly<Record<string, RasterOrigin>>): RasterTally {
  const origins = Object.values(seen);
  return { browser: origins.filter((o) => o === "browser").length, total: origins.length };
}

/** the About line: "N of M rasters drawn from the browser" (one raster: "raster"). */
export function tallyLine(t: RasterTally): string {
  return `${t.browser} of ${t.total} ${t.total === 1 ? "raster" : "rasters"} drawn from the browser`;
}
