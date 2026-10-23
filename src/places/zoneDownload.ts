// places/zoneDownload.ts -- "Download places" for an instance with a release: a `zone` place (a
// Program Area, say) named in full and drawn with its REAL polygon, queried live off the release's
// PMTiles zone source (moved from MarineSensitivity/atlas 0.10.93's `places/download.ts`, owner
// review item 2: "Download places returns `geometry: null` and `name: GAA`"). The generic builder is
// `places/download.ts#placesToGeoJson`; this module only supplies its `zoneFeature`, so the other
// place kinds are written by ONE function. Reached only through the Report tool's Places flow and
// the shell's release-aware download (the instance module table), never by an instance without zones.
//
// The polygon query is INJECTED (`ZonePolygonSource`), so this stays Node-testable without MapLibre.
import type { FeatureCollection, Geometry, Polygon } from "geojson";
import type { MapHandle } from "../lib/map/map";
import { zoneKeyProperty, zoneSourceId, zoneUnitsFromBoot } from "../lib/map/layers/zones";
import type { Place, ZonePlace } from "../lib/geo/placeCodec";
import type { AreaGeometry } from "../lib/geo/types";
import { placesToGeoJson, type NullableFeature } from "./download";
import { unitForZoneSet } from "./model";
import { ringsFromFeatures, zoneCenterFromBoot, zoneDisplayName, zoneStatsFor } from "./zoneStats";

/** a zone place's own REAL polygon feature(s), queried live off the release's PMTiles source --
 * `querySourceFeatures`-shaped (not viewport-limited, unlike `queryRenderedFeatures`), so a zone
 * added to Places earlier in the session still resolves even if it is off-screen now. `[]` when
 * the covering tile has not loaded, or the unit/key genuinely is not in the archive -- the caller
 * degrades further rather than throwing. */
export interface ZonePolygonSource {
  queryZonePolygons(
    unit: string,
    keys: readonly string[],
  ): readonly { geometry?: { type: string; coordinates: unknown } | null }[];
}

/** a small square around a point (`combinedBbox`'s own "point ± 0.5°" convention, `report/
 * reportMap.ts`) -- the BBOX fallback (`geometry_source: "bbox"`) for when no polygon tile has
 * loaded but the release at least publishes a label point for this zone. */
function bboxPolygonAround(lon: number, lat: number, d = 0.5): Polygon {
  return {
    type: "Polygon",
    coordinates: [
      [
        [lon - d, lat - d],
        [lon + d, lat - d],
        [lon + d, lat + d],
        [lon - d, lat + d],
        [lon - d, lat - d],
      ],
    ],
  };
}

export function zoneFeature(
  p: ZonePlace,
  boot: unknown,
  polygons: ZonePolygonSource | undefined,
): NullableFeature {
  const unit = unitForZoneSet(p.set);
  const name = zoneDisplayName(zoneStatsFor(boot, unit, p.keys));
  const properties: Record<string, unknown> = { kind: "zone", set: p.set, keys: p.keys, name };

  const rendered = polygons?.queryZonePolygons(unit, p.keys) ?? [];
  const rings = ringsFromFeatures(
    rendered.filter((f): f is { geometry: { type: string; coordinates: unknown } } => !!f.geometry),
  );
  if (rings.length) {
    return { type: "Feature", geometry: { type: "MultiPolygon", coordinates: rings }, properties };
  }

  const center = zoneCenterFromBoot(boot, unit, p.keys);
  if (center) {
    return {
      type: "Feature",
      geometry: bboxPolygonAround(center.lon, center.lat),
      properties: { ...properties, geometry_source: "bbox" },
    };
  }

  // neither a loaded polygon tile nor a published label point (docs/parity.html's own "known gap
  // G-01") -- an honest, reported gap rather than a silent one; still never dropped from the file.
  return {
    type: "Feature",
    geometry: null,
    properties: {
      ...properties,
      note: "no polygon tile loaded and no label point published for this zone yet",
    },
  };
}

/**
 * One Feature per place, a zone place resolved through `boot` (its full "Name (KEY)" label) and
 * `polygons` (its real geometry) -- both optional, so a caller with neither still gets a feature per
 * place (bare keys, `geometry: null`), never a thrown error.
 */
export function zonePlacesToGeoJson(
  places: readonly Place[],
  boot?: unknown,
  polygons?: ZonePolygonSource,
  gazGeometry?: (id: string) => AreaGeometry | null | undefined,
): FeatureCollection<Geometry | null> {
  return placesToGeoJson(places, gazGeometry, (p) => zoneFeature(p, boot, polygons));
}

/** R3-W2: a `ZonePolygonSource` off a real, live `MapHandle` -- extracted so the Download menu
 * (`src/shell/DownloadMenu.svelte`) can build one without duplicating `Places.svelte`'s own
 * identical inline `zonePolygonSource()` a third time. Additive: `Places.svelte` keeps its own copy
 * unchanged (round-3's file-ownership rule -- a file another slice may be mid-edit on is left
 * alone; this is the same logic, exported once, so a FUTURE change only has one place to make). */
export function zonePolygonSourceFromMap(
  mapHandle: MapHandle | undefined,
  boot: unknown,
): ZonePolygonSource | undefined {
  if (!mapHandle) return undefined;
  const handle = mapHandle;
  return {
    queryZonePolygons(unit, keys) {
      const spec = zoneUnitsFromBoot(boot).find((u) => u.unit === unit);
      if (!spec) return [];
      const wanted = new Set(keys.map(String));
      try {
        return handle.map.querySourceFeatures(zoneSourceId(unit), {
          sourceLayer: spec.sourceLayer,
          filter: ["in", ["get", zoneKeyProperty(unit)], ["literal", [...wanted]]] as never,
        }) as never;
      } catch {
        return []; // source not added/loaded yet — never a throw for a download click
      }
    },
  };
}
