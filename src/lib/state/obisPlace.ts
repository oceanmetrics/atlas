// The Place page's "Species on the map" link (build week 4, step 5): from a gazetteer place to the atlas OBIS layer
// with the place selected. The places web Place page (oceanmetrics/places `web/`) copies this function as it is;
// tests/obis/placeLink.test.ts drives what it writes through the atlas's own parseSel. Pure, never throws.
//
//   placeObisUrl({ placeId: "NMS:CINMS", name: "Channel Islands", bbox: [-120.65, 33.2, -118.85, 34.25] })
//   https://oceanmetrics.io/atlas/?c=obis_h3&i=all&dim.indicator=es&dim.period=all&res=auto&map=-119.75,33.725,8.38#pl=p.NMS%253ACINMS.Channel%2520Islands
//
// The rule:
//   - the query is the OBIS layer's grammar (tests/fixtures/obis_redirect_cases.json): `c=obis_h3`, `i=all` (or an
//     EOV item), `dim.indicator` (default es), `dim.period` (default all), `res=auto`;
//   - `map=lon,lat,zoom` frames the place's bbox (`[west, south, east, north]`, degrees; east may be past 180 or
//     less than west across the antimeridian): the centre, and the zoom at which the larger side fills about two
//     thirds of a 1280 px map, clamped to 1..10 (no bbox: no `map`, the atlas's own opening camera);
//   - the hash `pl` is the place as the gazetteer `p.` token (`p.<id>.<name>`, docs/gazetteer-places.md), written
//     the way the atlas's codec writes a hash value (URLSearchParams, then `,`, `:` and `/` unescaped), so its `%`
//     is `%25`.
import { encodePlace } from "../geo/placeCodec";
import { prettyEncode } from "./codec";

export interface PlaceObisLink {
  /** the gazetteer place_id (`NMS:CINMS`, `MRGID:8432`) */
  placeId: string;
  /** the display name carried in the token (shortened by the codec past 60 encoded characters) */
  name?: string;
  /** [west, south, east, north] in degrees; omitted, the link carries no camera */
  bbox?: readonly [number, number, number, number] | null;
  /** `all` (default) or an EOV item id */
  item?: string;
  indicator?: "es" | "sp" | "shannon" | "simpson" | "n";
  /** `all` (default), a decade `1990s` or a year `2015` */
  period?: string;
  /** the site origin; default https://oceanmetrics.io */
  origin?: string;
}

const round = (v: number, d: number) => Number(v.toFixed(d));

/** the camera that frames a bbox: centre and zoom (see the module header), or null for a malformed one. */
export function cameraForBbox(
  bbox: readonly [number, number, number, number] | null | undefined,
): { lon: number; lat: number; zoom: number } | null {
  if (!bbox || bbox.length !== 4 || !bbox.every(Number.isFinite)) return null;
  const [w, s, e0, n] = bbox;
  if (s > n || s < -90 || n > 90) return null;
  const e = e0 < w ? e0 + 360 : e0; // across the antimeridian
  const dLon = Math.max(e - w, 1e-6);
  const dLat = Math.max(n - s, 1e-6);
  let lon = (w + e) / 2;
  if (lon > 180) lon -= 360;
  const lat = (s + n) / 2;
  // a 1280 px map at zoom z spans 1280/512 * 360 / 2^z degrees of longitude (512 px tiles); the side fills 2/3
  const span = Math.max(dLon, dLat / Math.max(Math.cos((lat * Math.PI) / 180), 0.2));
  const zoom = Math.log2((2.5 * 360 * (2 / 3)) / span);
  return {
    lon: round(lon, 3),
    lat: round(lat, 3),
    zoom: round(Math.min(10, Math.max(1, zoom)), 2),
  };
}

/** the atlas URL of the OBIS layer with a gazetteer place selected (the Place page's "Species on the map"). */
export function placeObisUrl(link: PlaceObisLink): string {
  const origin = String(link.origin || "https://oceanmetrics.io").replace(/\/+$/, "");
  const q = new URLSearchParams();
  q.set("c", "obis_h3");
  q.set("i", link.item ?? "all");
  q.set("dim.indicator", link.indicator ?? "es");
  q.set("dim.period", link.period ?? "all");
  q.set("res", "auto");
  const cam = cameraForBbox(link.bbox);
  if (cam) q.set("map", `${cam.lon},${cam.lat},${cam.zoom}`);
  const h = new URLSearchParams();
  try {
    h.set("pl", encodePlace({ kind: "gaz", id: link.placeId, name: link.name ?? "" }));
  } catch {
    /* an id the codec refuses: the link opens the layer without the place */
  }
  const hash = h.has("pl") ? `#${prettyEncode(h)}` : "";
  return `${origin}/atlas/?${prettyEncode(q)}${hash}`;
}
