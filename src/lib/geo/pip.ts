// geo/pip.ts -- point-in-polygon for place summaries and the "only inside places" filter: ray casting
// over the same planar lon/lat rings the rest of src/lib/geo reads (coverage.ts), nothing geodesic.
//
// A place's longitudes are UNWRAPPED (geo/unwrap.ts: a Bering polygon runs 170..190), while a hex
// centroid lies in [-180, 180]. So a point is tried at its own longitude and at +/-360: whichever
// copy falls inside the polygon's bounding box is tested, which puts a centroid at -175 inside a ring
// that spans 170..190 without wrapping the ring (the ring is never modified).
//
// Rules: a polygon contains a point when the point is inside its outer ring and inside none of its
// holes (even-odd per ring); a MultiPolygon contains it when any part does. A point exactly on an
// edge may fall either way (ray casting's usual half-open rule) -- for the 10 km hexagon centroids
// this is used on, an edge hit is a measure-zero event, and never an error.
import { polygonsOf, type AreaGeometry, type Position, type Ring } from "./types";

/** `[xmin, ymin, xmax, ymax]` of one outer ring, in its own (unwrapped) longitudes. */
type Box = [number, number, number, number];

interface PreparedPolygon {
  box: Box;
  outer: Ring;
  holes: Ring[];
}

/** an area geometry with each polygon's bounding box computed once, for testing many points. */
export interface PreparedArea {
  polygons: PreparedPolygon[];
}

function boxOf(ring: Ring): Box {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const [x, y] of ring) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

export function prepareArea(geometry: AreaGeometry): PreparedArea {
  return {
    polygons: polygonsOf(geometry)
      .filter((rings) => rings.length > 0 && rings[0].length >= 3)
      .map((rings) => ({ box: boxOf(rings[0]), outer: rings[0], holes: rings.slice(1) })),
  };
}

/** even-odd ray cast of (x, y) against one ring (closed or open: the closing edge is implicit). */
export function pointInRing(x: number, y: number, ring: readonly Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const SHIFTS = [0, 360, -360] as const;

function inPolygon(p: PreparedPolygon, lon: number, lat: number): boolean {
  const [x0, y0, x1, y1] = p.box;
  if (lat < y0 || lat > y1) return false;
  for (const shift of SHIFTS) {
    const x = lon + shift;
    if (x < x0 || x > x1) continue;
    if (!pointInRing(x, lat, p.outer)) continue;
    if (p.holes.some((h) => pointInRing(x, lat, h))) continue;
    return true;
  }
  return false;
}

/** is (lon, lat) inside the prepared area (any of its polygons)? */
export function pointInArea(area: PreparedArea, lon: number, lat: number): boolean {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
  for (const p of area.polygons) if (inPolygon(p, lon, lat)) return true;
  return false;
}

/** one-shot convenience over {@link prepareArea} + {@link pointInArea}. */
export function pointInGeometry(geometry: AreaGeometry, lon: number, lat: number): boolean {
  return pointInArea(prepareArea(geometry), lon, lat);
}
