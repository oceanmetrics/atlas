// report/gazPlaces.ts -- report.html's half of the `p.` place_id token (docs/gazetteer-places.md).
// A gazetteer place has no geometry in the link, so before the report expands its places each `p.`
// place is fetched and swapped for a `geom` place carrying the resolved (unwrapped, quantised)
// geometry: from there the report treats it exactly like a drawn place, with no `gaz` branch in the
// data loader, the model or the map. The ORIGINAL `p.` token is kept for the report's provenance /
// permalinks (`tokens`), so a report never rewrites a reference into inline geometry.
//
// A place that cannot be fetched is dropped from THIS report and named in `failed`; the caller says
// so. (The map's Places panel keeps the token and offers a retry instead; a printed report with a
// silently missing place would be the wrong failure.)
import { encodePlace, type Place } from "../lib/geo/placeCodec";
import type { GazResolved } from "../lib/gazetteer/resolve";

export interface ResolvedForReport {
  places: Place[];
  /** resolved-geom-place -> its original `p.` token, for `expandPlaces(…, tokens)` */
  tokens: Map<Place, string>;
  /** the place_ids that could not be loaded, with the reason */
  failed: { id: string; message: string }[];
}

export async function resolveGazForReport(
  places: readonly Place[],
  resolve: (id: string) => Promise<GazResolved>,
): Promise<ResolvedForReport> {
  const out: Place[] = [];
  const tokens = new Map<Place, string>();
  const failed: ResolvedForReport["failed"] = [];
  const cache = new Map<string, Promise<GazResolved>>();
  for (const p of places) {
    if (p.kind !== "gaz") {
      out.push(p);
      continue;
    }
    try {
      if (!cache.has(p.id)) cache.set(p.id, resolve(p.id));
      const r = await cache.get(p.id)!;
      const geom: Place = { kind: "geom", name: p.name || r.name, geometry: r.geometry };
      tokens.set(geom, encodePlace(p));
      out.push(geom);
    } catch (err) {
      failed.push({ id: p.id, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return { places: out, tokens, failed };
}
