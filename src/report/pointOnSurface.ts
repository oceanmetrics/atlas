// report/pointOnSurface.ts -- atlas-7 step 2: a label anchor that is guaranteed to sit ON a
// place's own polygon (report.qmd:168's `st_point_on_surface(all_areas)`), never a bbox/centroid
// that can land outside a concave ring or in a hole -- a label floating off its own shape is
// exactly the defect PostGIS's `ST_PointOnSurface` exists to avoid.
//
// Pure and dependency-free (no turf, no PostGIS): the centroid of the LARGEST ring by area (a
// MultiPolygon's biggest part; a Polygon's own exterior ring) is used when it actually falls
// inside that ring; otherwise the ring's own vertex nearest the centroid is used instead, which by
// definition lies ON the boundary. Good enough for a report label -- this is not a scoring input.
import { polygonsOf, type AreaGeometry, type Position, type Ring } from "../lib/geo/types";

/** the shoelace centroid of one ring (its OWN winding; the caller decides which ring to use). */
export function ringCentroid(ring: Ring): Position {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    const cross = x0 * y1 - x1 * y0;
    a += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (a === 0) {
    // degenerate (collinear/zero-area) ring: fall back to the plain vertex mean.
    let sx = 0;
    let sy = 0;
    for (const [x, y] of ring) {
      sx += x;
      sy += y;
    }
    return [sx / ring.length, sy / ring.length];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/** signed area of a ring, shoelace/2 -- sign carries winding, magnitude is what picks "the
 * largest part" of a MultiPolygon. */
function signedArea(ring: Ring): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

/** ray-casting point-in-polygon over a ring's own edges (even-odd rule). */
export function pointInRing(pt: Position, ring: Ring): boolean {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length - 1; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi !== yj && y >= Math.min(yi, yj) && y < Math.max(yi, yj);
    if (!intersects) continue;
    const xCross = xi + ((y - yi) / (yj - yi)) * (xj - xi);
    if (xCross > x) inside = !inside;
  }
  return inside;
}

function nearestVertex(pt: Position, ring: Ring): Position {
  let best = ring[0];
  let bestD = Infinity;
  for (const v of ring) {
    const d = (v[0] - pt[0]) ** 2 + (v[1] - pt[1]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return best;
}

/**
 * A point guaranteed to lie ON `geom`'s largest ring: that ring's centroid when it is actually
 * inside it, else the vertex of that ring nearest the centroid (always on the boundary).
 */
export function pointOnSurface(geom: AreaGeometry): Position {
  const rings = polygonsOf(geom).flatMap((poly) => (poly.length ? [poly[0]] : []));
  if (rings.length === 0) return [0, 0];
  let biggest = rings[0];
  let biggestArea = Math.abs(signedArea(rings[0]));
  for (const r of rings.slice(1)) {
    const a = Math.abs(signedArea(r));
    if (a > biggestArea) {
      biggestArea = a;
      biggest = r;
    }
  }
  const centroid = ringCentroid(biggest);
  return pointInRing(centroid, biggest) ? centroid : nearestVertex(centroid, biggest);
}
