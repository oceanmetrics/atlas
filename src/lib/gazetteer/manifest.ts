// The gazetteer's layers manifest (`index/layers.json`) read with a plain `fetch`: no parquet, no
// hyparquet, so the overlay list can load from the static graph without pulling the places index
// (which is parquet, lazy, and only read when someone searches). The vendored client reads the same
// file for `creditsFor`; this is the lean copy for the Layers panel.
import { gazetteerDataBase, layersManifestUrl, toDataUrl } from "./config";
import type { Layer } from "./vendor/types";

/** `layers.json` is `{layers: [...]}` (the live shape) or a bare array (older publishes). */
export function layersFromManifest(json: unknown, base = gazetteerDataBase()): Layer[] {
  const rows = Array.isArray(json) ? json : (json as { layers?: unknown } | null)?.layers;
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(
      (r): r is Layer =>
        !!r && typeof r === "object" && typeof r.slug === "string" && typeof r.pmtiles === "string",
    )
    .map((r) => ({ ...r, pmtiles: toDataUrl(r.pmtiles, base) }));
}

/**
 * Fetch the manifest. Rejects on a network failure or a non-2xx answer (`index/` first, then the
 * root copy `layers.json`, which older publishes carry) -- the caller shows a retry, never a blank.
 */
export async function fetchLayersManifest(
  fetchImpl: typeof fetch = fetch,
  base = gazetteerDataBase(),
): Promise<Layer[]> {
  const url = layersManifestUrl(base);
  let res = await fetchImpl(url);
  if (!res.ok && (res.status === 403 || res.status === 404)) {
    const alt = await fetchImpl(`${base}layers.json`);
    if (alt.ok) res = alt;
  }
  if (!res.ok) throw new Error(`layers.json: HTTP ${res.status}`);
  return layersFromManifest(await res.json(), base);
}
