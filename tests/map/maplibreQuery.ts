// A `queryRenderedFeatures` stand-in that reads its first argument the way MapLibre does
// (maplibre-gl `Map#queryRenderedFeatures`: `geometryOrOptions instanceof Point || Array.isArray(...)` is a
// geometry, ANYTHING else is "no geometry", i.e. the whole viewport). Features are screen rectangles per
// layer; a point hits the rectangles that contain it, a box the ones that overlap it. Not a test file.
export interface FakeRendered {
  layer: string;
  /** [x0, y0, x1, y1] on screen. */
  rect: [number, number, number, number];
  properties: Record<string, unknown>;
  id?: number;
}

type Geometry = unknown;

export function maplibreLikeQuery(features: readonly FakeRendered[]) {
  return (geometry: Geometry, options: { layers: string[] }) => {
    const isGeometry = Array.isArray(geometry);
    let box: [number, number, number, number];
    if (!isGeometry) box = [-Infinity, -Infinity, Infinity, Infinity];
    else if (typeof (geometry as unknown[])[0] === "number") {
      const [x, y] = geometry as [number, number];
      box = [x, y, x, y];
    } else {
      const [[x0, y0], [x1, y1]] = geometry as [[number, number], [number, number]];
      box = [x0, y0, x1, y1];
    }
    return features
      .filter((f) => options.layers.includes(f.layer))
      .filter(
        (f) =>
          f.rect[0] <= box[2] && f.rect[2] >= box[0] && f.rect[1] <= box[3] && f.rect[3] >= box[1],
      )
      .map((f) => ({
        layer: { id: f.layer },
        properties: f.properties,
        geometry: { type: "Polygon" },
        ...(f.id === undefined ? {} : { id: f.id }),
      }));
  };
}
