// places/download.ts -- the footer's "Download places": a GeoJSON FeatureCollection of the DECODED
// geometries actually analysed -- never the geometry as drawn/uploaded (plan D8: every analysis, and
// therefore every export, runs on decode(encode(geometry))).
//
// A `zone` place (an older link naming Program Areas by key) carries no geometry client-side and the
// zone layers are gone, so it exports its keys with `geometry: null` and says so; a `gaz` place
// exports its fetched geometry when the session has it.
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { Place, ZonePlace } from "../lib/geo/placeCodec";
import type { AreaGeometry } from "../lib/geo/types";

/** RFC 7946 permits `"geometry": null` (a place with no resolvable geometry at all); the
 * `@types/geojson` `Feature` type does not model that directly, so this local widening is the
 * narrowest fix rather than an `any`. */
export type NullableFeature = Feature<Geometry | null>;

/**
 * One Feature per place -- never a thrown error, never a dropped place.
 */
export function placesToGeoJson(
  places: readonly Place[],
  /** a gazetteer (`p.`) place's resolved geometry, when the session has fetched it; `null`/absent
   * leaves `geometry: null` with the place_id, which names it fully for anyone with the gazetteer. */
  gazGeometry?: (id: string) => AreaGeometry | null | undefined,
  /** a zone place's feature when the caller can resolve it (a release's zone units: its full name
   * and its real polygon, `places/zoneDownload.ts`); absent, the keys with `geometry: null`. */
  zoneFeature?: (p: ZonePlace) => NullableFeature,
): FeatureCollection<Geometry | null> {
  const features: NullableFeature[] = places.map((p) => {
    if (p.kind === "gaz") {
      return {
        type: "Feature",
        geometry: gazGeometry?.(p.id) ?? null,
        properties: { kind: "gaz", place_id: p.id, name: p.name || p.id },
      };
    }
    if (p.kind === "geom") {
      return {
        type: "Feature",
        geometry: p.geometry,
        properties: { kind: "geom", name: p.name },
      };
    }
    if (p.kind === "upload") {
      return {
        type: "Feature",
        geometry: null,
        properties: {
          kind: "upload",
          name: p.name,
          digest: p.digest,
          note: "geometry too large for the link — ask the sender for the GeoJSON",
        },
      };
    }
    if (zoneFeature) return zoneFeature(p);
    return {
      type: "Feature",
      geometry: null,
      properties: {
        kind: "zone",
        set: p.set,
        keys: p.keys,
        name: p.keys.join(", "),
        note: "a zone place from an older link: its polygon is no longer published here",
      },
    };
  });
  return { type: "FeatureCollection", features };
}

/** browser-only side effect (an anchor click); kept separate from the pure builder above so
 * `placesToGeoJson` stays Node-testable. */
export function downloadGeoJson(
  fc: FeatureCollection<Geometry | null>,
  fileName = "places.geojson",
): void {
  const blob = new Blob([JSON.stringify(fc, null, 2)], { type: "application/geo+json" });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
