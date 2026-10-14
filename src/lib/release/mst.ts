// release/mst.ts -- the ONE pinned MarineSensitivity release the Species lens still reads.
//
// The species lens was written against the MST release bucket layout (`{base}{ver}/app/taxon/...`,
// `{ver}/app/boot.json`). OceanMetrics Atlas has no release registry (no `latest.txt`, no
// `versions.json`, no preview session), so that lens gets a fixed version here.
//
// WP6 (docs/mst-by-reference.md): the Collections lens draws the catalog's v7 MST collections from the
// SAME `app/` bundle at this SAME pin (`catalog/mst/`): the MST STAC API serves release v9 only (a v7
// `/search` is an HTTP 500), and the v7 collections the catalog links publish one `model_cell` Item,
// not per-taxon Items. Moving the pin moves both lenses.
import { boot, type Boot } from "./boot";

/** the MST release the Species lens reads. */
export const MST_SPECIES_VER = "v7";

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

/** `{ver}/app/boot.json` for the pinned release, or `null` (never a throw) when it is unreachable. */
export function loadMstBoot(ver: string = MST_SPECIES_VER): Promise<Boot | null> {
  return boot(ver, { fetchJson }).catch(() => null);
}
