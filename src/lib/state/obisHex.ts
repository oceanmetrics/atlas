// An obis-hex link -> the atlas URL that shows the same OBIS layer (build week 4, step 1: the grammar of the OBIS
// layer in the atlas query string). One case table drives both sides: tests/fixtures/obis_redirect_cases.json is read
// by tests/state/obisHex.test.ts here and copied into obis-hex's tests/redirect.test.ts, whose `redirectFor` is
// rewritten to the same grammar in step 5. Pure, never throws; nothing in the app imports it yet (the obis-hex
// redirect page and the atlas OBIS layer of step 5 are its callers).
//
//   obis-hex   https://oceanmetrics.io/obis-hex/?tour=off#i=es&l=eov:fish&p=1990&r=3&o=0.85&t=dark&d=release&c=-20,5,1.4
//   atlas      https://oceanmetrics.io/atlas/?c=obis_h3&i=fish&dim.indicator=es&dim.period=1990s&res=3&map=-20,5,1.4&proj=globe&tour=off
//
// The keys, in the order written: `c=obis_h3` (the collection), `i=<item>` (`all` or an EOV key; a taxon has no item
// of its own and filters `all`), `dim.indicator` (es|sp|shannon|simpson|n), `dim.period` (`<decade>s` or `all`),
// `res` (`auto` or 1..7, clamped to what the atlas serves), `map=lon,lat,zoom` (obis-hex's camera `c`, read from the
// old hash only), `taxon=<rank>:<name>` or `aphia:<id>` (split on the FIRST `:`, so a name may hold one), `proj`
// (globe|mercator, always written: obis-hex's default is the globe), `theme` and `tour` (only from obis-hex's query
// switches), and in the hash `pl=` the outlined place as the atlas's `p.` token (docs/gazetteer-places.md). A place
// outlined with no layer view chosen goes to the Place page instead. Everything else is dropped; the table's `keys`
// says why for each.
import { encodePlace } from "../geo/placeCodec";
import { prettyEncode } from "./codec";

export const OM_ORIGIN = "https://oceanmetrics.io";
/** the atlas collection id of the obis-h3 release */
export const OBIS_COLLECTION = "obis_h3";

export type ObisIndicator = "es" | "sp" | "shannon" | "simpson" | "n";
const INDICATORS: readonly ObisIndicator[] = ["es", "sp", "shannon", "simpson", "n"];
/** obis-hex's decades (src/lib/state/url.ts DECADES) */
export const OBIS_DECADES = [1960, 1970, 1980, 1990, 2000, 2010, 2020] as const;
/** obis-hex's EOV keys, which are the atlas item ids of the EOV layers */
export const OBIS_EOVS = [
  "fish",
  "hardCorals",
  "mangroves",
  "marineMammals",
  "seabirds",
  "seagrasses",
  "seaTurtles",
] as const;
/** obis-hex's opening camera (DEFAULT_STATE), written when a link has no valid `c` */
export const OBIS_DEFAULT_CAMERA = { lon: -103.7, lat: 33.2, zoom: 2.57 } as const;

/** the resolutions the atlas serves: 7; 5 with a decade (the release's decade layers stop at 5); 5 for a WoRMS
 * subtree, 4 with a decade (the species table's decade variant is res 3 and 4, D8) */
export const RES_MAX = 7;
export const RES_DECADE_MAX = 5;
export const RES_SUBTREE_MAX = 5;
export const RES_SUBTREE_DECADE_MAX = 4;

const PLACE_ID_RE = /^[A-Za-z0-9:_. -]{1,80}$/;
const PLACE_COLL_RE = /^[a-z][a-z0-9_]{0,63}$/;

type Layer =
  | { kind: "all" }
  | { kind: "eov"; eov: string }
  | { kind: "taxon"; rank: string; name: string }
  | { kind: "aphia"; id: number };

export interface ObisHexRedirect {
  /** the atlas (or Place page) URL */
  url: string;
  /** true when the target shows what the obis-hex link showed */
  exact: boolean;
  /** the keys of the obis-hex link (hash keys, and `?<key>` for query switches) the target does not carry, sorted */
  dropped: string[];
  /** what changed, when anything did */
  notes: string[];
}

/** obis-hex's layer key (`all`, `eov:<key>`, `taxon:<rank>:<name>` with each part percent-encoded, `aphia:<id>`),
 * split BEFORE decoding as obis-hex's parseLayerKey does, so an encoded `:` stays inside the name */
function parseLayer(raw: string | undefined): Layer {
  if (!raw || raw === "all") return { kind: "all" };
  const parts = raw.split(":");
  try {
    if (
      parts[0] === "eov" &&
      parts.length === 2 &&
      (OBIS_EOVS as readonly string[]).includes(parts[1])
    )
      return { kind: "eov", eov: parts[1] };
    if (parts[0] === "aphia" && parts.length === 2 && /^[1-9][0-9]{0,9}$/.test(parts[1]))
      return { kind: "aphia", id: Number(parts[1]) };
    if (parts[0] === "taxon" && parts.length === 3 && parts[1] && parts[2])
      return {
        kind: "taxon",
        rank: decodeURIComponent(parts[1]),
        name: decodeURIComponent(parts[2]),
      };
  } catch {
    /* malformed percent-encoding: all taxa, as obis-hex */
  }
  return { kind: "all" };
}

/** the hash's pairs: `l` raw, every other value decoded once (`+` is a space); an undecodable value is skipped */
function hashPairs(hash: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const kv of hash.split("&")) {
    const i = kv.indexOf("=");
    if (i <= 0) continue;
    const k = kv.slice(0, i);
    const raw = kv.slice(i + 1);
    try {
      out.set(k, k === "l" ? raw : decodeURIComponent(raw.replace(/\+/g, " ")));
    } catch {
      /* skip */
    }
  }
  return out;
}

/** obis-hex's zoomToRes (src/lib/state/resolution.ts): breaks 0, 2.2, 3.4 ... 11.8, 22, clamped to 1..10 */
export function zoomToRes(zoom: number): number {
  let k = 0;
  for (let i = 0; i <= 10; i++) if (zoom >= (i === 0 ? 0 : i === 10 ? 22 : 1 + (12 * i) / 10)) k++;
  return Math.max(1, Math.min(10, k));
}

const placesPath = (id: string) =>
  encodeURIComponent(id).replace(/%3A/gi, ":").replace(/%2C/gi, ",").replace(/%7C/gi, "|");

/** split a link (a whole URL, `?query#hash` or `#hash`) into its query and hash, without the `?` and `#` */
function splitLink(url: string): { query: string; hash: string } {
  const s = String(url ?? "");
  const h = s.indexOf("#");
  const before = h < 0 ? s : s.slice(0, h);
  const q = before.indexOf("?");
  return { query: q < 0 ? "" : before.slice(q + 1), hash: h < 0 ? "" : s.slice(h + 1) };
}

/** where an obis-hex link lives in Ocean Metrics, with what it loses. Never throws. */
export function obisHexRedirect(url: string, origin: string = OM_ORIGIN): ObisHexRedirect {
  const base = String(origin || OM_ORIGIN).replace(/\/+$/, "");
  const { query, hash } = splitLink(url);
  const p = hashPairs(hash);
  const q = new URLSearchParams(query);
  const notes: string[] = [];
  let exact = true;

  // ---- the obis-hex view, by obis-hex's own parse rules ----
  const i = p.get("i");
  const indicator: ObisIndicator = (INDICATORS as readonly string[]).includes(i ?? "")
    ? (i as ObisIndicator)
    : "es";
  const layer = parseLayer(p.get("l"));
  const per = p.get("p");
  let decade: number | null =
    per && per !== "all" && (OBIS_DECADES as readonly number[]).includes(Number(per))
      ? Number(per)
      : null;
  const r = p.get("r");
  const rn = Number(r);
  let res: number | "auto" =
    r && r !== "auto" && Number.isInteger(rn) && rn >= 1 && rn <= RES_MAX ? rn : "auto";
  const proj = p.get("g") === "flat" ? "mercator" : "globe";
  const cam = (p.get("c") ?? "").split(",").map(Number);
  const camOk =
    cam.length === 3 &&
    cam.every(Number.isFinite) &&
    cam[0] >= -540 &&
    cam[0] <= 540 &&
    cam[1] >= -90 &&
    cam[1] <= 90 &&
    cam[2] >= 0 &&
    cam[2] <= 22;
  const [lon, lat, zoom] = camOk
    ? cam
    : [OBIS_DEFAULT_CAMERA.lon, OBIS_DEFAULT_CAMERA.lat, OBIS_DEFAULT_CAMERA.zoom];
  const plRaw = (p.get("pl") ?? "").trim();
  const place = PLACE_ID_RE.test(plRaw) ? plRaw : null;
  const placeColl = place && PLACE_COLL_RE.test(p.get("pc") ?? "") ? p.get("pc")! : null;

  const present = [...p.keys(), ...[...q.keys()].map((k) => `?${k}`)];
  const dropOf = (carried: Set<string>) =>
    [...new Set(present.filter((k) => !carried.has(k)))].sort();

  // ---- a place outlined and no layer view chosen: the Place page (exact values, not hexagon statistics) ----
  const realView = layer.kind !== "all" || indicator !== "es" || decade !== null || res !== "auto";
  if (place && !realView) {
    return {
      url: `${base}/places/p/${placesPath(place)}`,
      exact: true,
      dropped: dropOf(new Set(["pl"])),
      notes,
    };
  }

  // ---- the atlas OBIS layer ----
  if (layer.kind === "taxon" && decade !== null) {
    decade = null;
    exact = false;
    notes.push(
      "a taxon group has no decade layers in the release (obis-hex loaded nothing): the period is all",
    );
  }
  const cap =
    layer.kind === "aphia"
      ? decade === null
        ? RES_SUBTREE_MAX
        : RES_SUBTREE_DECADE_MAX
      : decade === null
        ? RES_MAX
        : RES_DECADE_MAX;
  if (typeof res === "number" && res > cap) {
    // obis-hex clamped a release decade to 5 itself, so that clamp loses nothing; a live AphiaID subtree drew 7
    if (layer.kind === "aphia") {
      exact = false;
      notes.push(`the atlas serves a WoRMS subtree up to res ${cap}; obis-hex drew res ${res}`);
    } else notes.push(`res ${res} with a decade is res ${cap}, as obis-hex drew it`);
    res = cap;
  } else if (res === "auto" && layer.kind === "aphia" && Math.min(zoomToRes(zoom), RES_MAX) > cap) {
    exact = false;
    notes.push(
      `at zoom ${zoom} obis-hex drew a WoRMS subtree at res ${Math.min(zoomToRes(zoom), RES_MAX)}; the atlas serves up to res ${cap}`,
    );
  }

  const params = new URLSearchParams();
  params.set("c", OBIS_COLLECTION);
  params.set("i", layer.kind === "eov" ? layer.eov : "all");
  params.set("dim.indicator", indicator);
  params.set("dim.period", decade === null ? "all" : `${decade}s`);
  params.set("res", String(res));
  params.set("map", `${lon},${lat},${zoom}`);
  if (layer.kind === "taxon") params.set("taxon", `${layer.rank}:${layer.name}`);
  if (layer.kind === "aphia") params.set("taxon", `aphia:${layer.id}`);
  params.set("proj", proj);
  const carried = new Set(["i", "l", "p", "r", "c", "g"]);
  const theme = (q.get("theme") ?? "").toLowerCase();
  if (theme === "dark" || theme === "light") {
    params.set("theme", theme);
    carried.add("?theme");
  }
  const tour = (q.get("tour") ?? "").toLowerCase();
  if (tour === "on" || tour === "off") {
    params.set("tour", tour);
    carried.add("?tour");
  }

  let hashOut = "";
  if (place) {
    const pl = new URLSearchParams();
    pl.set("pl", encodePlace({ kind: "gaz", id: place, name: "" }));
    hashOut = `#${prettyEncode(pl)}`;
    carried.add("pl");
    if (placeColl) {
      exact = false;
      notes.push(
        "the place's collection (pc) is not carried: the atlas resolves the id through the gazetteer index",
      );
    }
  }
  if (p.has("x")) {
    exact = false;
    notes.push("the selected hexagon (x) is not carried");
  }
  if (p.has("f") || p.get("v") === "places") {
    exact = false;
    notes.push(
      "the place filter (f) and the view as places (v) are not carried; the Place page has the exact values",
    );
  }
  if (q.has("data")) {
    exact = false;
    notes.push(
      "the pinned release (?data=) is not carried: the atlas reads the current obis-h3 collection",
    );
  }
  return {
    url: `${base}/atlas/?${prettyEncode(params)}${hashOut}`,
    exact,
    dropped: dropOf(carried),
    notes,
  };
}

/** the atlas (or Place page) URL of an obis-hex link */
export function obisHexToAtlas(url: string): string {
  return obisHexRedirect(url).url;
}
