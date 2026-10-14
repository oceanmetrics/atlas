// places/geomPlace.ts -- turn a raw drawn/entered/uploaded geometry into a GeomPlace ready for
// `#pl=` (Deliverable 3): `analysisGeometry()` FIRST (unwrap, then decode(encode(...))) so the
// place this app holds is ALREADY what a shared link will reproduce -- "what is displayed is what
// is analyzed" starts the moment a place is created, not at share time.
import { analysisGeometry } from "../lib/geo/analysisGeometry";
import { clampName, type GeomPlace } from "../lib/geo/placeCodec";
import type { AreaGeometry } from "../lib/geo/types";

export function geomPlaceFrom(geometry: AreaGeometry, name: string): GeomPlace {
  const clamped = clampName(name.trim());
  return { kind: "geom", name: clamped || "Place", geometry: analysisGeometry(geometry) };
}
