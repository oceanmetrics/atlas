// The H3 layer's place filter (build week 4, step 5, second pass; obis-hex `places/membership.ts`, `PlaceFilter`):
// `?filter=places` with gazetteer places in the hash (`#pl=p.<id>.<name>`) keeps the hexagons of the places, by the
// gazetteer's place x H3 membership (`<slug>/h3/membership.json`: res 1 to 7, a cell kept when at least `min_share` of
// it is inside the place or it holds that share of the place), never by geometry in the browser. A whole file per resolution up to res 5; res 6 and 7 are
// split by a parent (`parent_res`), read for the place's own parents only. The map draws the kept hexagons (a filter
// on the fill), and the legend, the coverage line and the status say "statistics of the hexagons": the mean of the
// hexagons' ES(50) is not the place's own ES(50), which the Place page has.
//
// Pure functions plus one reader (hyparquet, a dynamic import); Node-tested (tests/obis/place.test.ts).
import { COMPRESSORS, openRangeFile } from "@oceanmetrics/map";
import type { ExpressionSpecification, FilterSpecification } from "maplibre-gl";

export interface MembershipFile {
  res: number;
  parent: string | null;
  /** the file's url, absolute */
  url: string;
  rows: number;
  /** the file's size in bytes (membership.json `bytes`), 0 when it does not say */
  bytes: number;
}

export interface MembershipManifest {
  minShare: number;
  res: number[];
  parentRes: Record<string, number>;
  files: MembershipFile[];
}

/** `membership.json` (`<slug>/h3/membership.json`), its paths (`h3/res=5/membership.parquet`, relative to the
 * collection's folder `<slug>/`) made absolute. null when it is not one. */
export function parseMembership(json: unknown, url: string): MembershipManifest | null {
  const j = (json && typeof json === "object" ? json : null) as Record<string, unknown> | null;
  if (!j || !Array.isArray(j.files)) return null;
  const files: MembershipFile[] = [];
  for (const f of j.files as Record<string, unknown>[]) {
    if (!f || typeof f.path !== "string" || !Number.isInteger(f.res)) continue;
    let abs: string;
    try {
      // the paths are the collection's (`h3/res=5/...` under `<slug>/`), not the manifest folder's
      abs = new URL(f.path, new URL("../", url)).href;
    } catch {
      continue;
    }
    files.push({
      res: f.res as number,
      parent: typeof f.parent === "string" ? f.parent : null,
      url: abs,
      rows: Number(f.rows ?? 0),
      bytes: Number(f.bytes ?? 0),
    });
  }
  const pr: Record<string, number> = {};
  if (j.parent_res && typeof j.parent_res === "object")
    for (const [k, v] of Object.entries(j.parent_res as Record<string, unknown>))
      if (Number.isInteger(v)) pr[k] = v as number;
  return {
    minShare: typeof j.min_share === "number" ? j.min_share : 0.01,
    res: Array.isArray(j.res)
      ? (j.res as unknown[]).filter((r): r is number => Number.isInteger(r))
      : [],
    parentRes: pr,
    files,
  };
}

/** the files a resolution needs: its whole file, or (a split resolution) the files of the given parents */
export function membershipFiles(
  m: MembershipManifest,
  res: number,
  parents: ReadonlySet<string> | null = null,
): MembershipFile[] {
  const split = m.parentRes[String(res)] !== undefined;
  return m.files.filter(
    (f) =>
      f.res === res && (split ? f.parent !== null && !!parents?.has(f.parent) : f.parent === null),
  );
}

/** a membership file's hexagons of the given places (hyparquet; a buffer for tests), or of every place when `placeIds`
 * is null (a whole collection). Every row counts: the gazetteer keeps a cell when at least `min_share` of it is inside
 * the place OR it holds that share of the place (a small place in a large hexagon), so a row's own `share` may be
 * under `min_share`. */
export async function readMembershipCells(
  source: string | ArrayBuffer,
  placeIds: readonly string[] | null,
): Promise<string[]> {
  const { parquetMetadataAsync, parquetReadObjects } = await import("hyparquet");
  const file = typeof source === "string" ? await openRangeFile(source) : source;
  if (!file) return [];
  const metadata = await parquetMetadataAsync(file, { initialFetchSize: 65_536 });
  const rows = (await parquetReadObjects({
    file,
    metadata,
    columns: placeIds === null ? ["h3"] : ["place_id", "h3"],
    compressors: COMPRESSORS,
  })) as { place_id?: unknown; h3?: unknown }[];
  const want = placeIds === null ? null : new Set(placeIds);
  const out = new Set<string>();
  for (const r of rows) {
    if (want && !want.has(String(r.place_id))) continue;
    out.add(String(r.h3).toLowerCase());
  }
  return [...out].sort();
}

/** at most this many hexagons in the map's filter (a literal list); past it the filter says to zoom in or pin a
 * coarser resolution */
export const FILTER_MAX_CELLS = 60_000;

// ---- a whole collection as the filter (`filter=coll:<slug>`; obis-hex `f=<collection>`) -------------------------------

/** a collection's membership is read whole for the drawn resolution (every file of it: no polygon in the browser), so
 * it has a cap, measured on the gazetteer's membership files (2026-10-23, 36 collections with an H3 build): a file
 * costs 2.4 to 11 bytes a row (about 8 on the densest large one, `noaa_state_submerged_lands` res 7: 145,680 rows,
 * 1.2 MB), so 500,000 rows are 1.2 to 5 MB, and the largest read under the cap is about 1.4 MB. Above it, or above
 * `COLLECTION_MAX_BYTES` by the manifest's own sizes, the filter says "filter by one place instead". */
export const COLLECTION_MAX_CELLS = 500_000;
export const COLLECTION_MAX_BYTES = 5 * 1024 * 1024;

export interface CollectionPlan {
  files: MembershipFile[];
  /** membership rows (a hexagon of two places is two rows) and bytes of the files the resolution reads */
  rows: number;
  bytes: number;
  /** over the cap: nothing is read */
  over: boolean;
}

/** what a collection filter reads at a resolution: every file of the resolution (a split resolution has one file per
 * parent, all of them), counted from the manifest before any byte is read */
export function collectionPlan(m: MembershipManifest, res: number): CollectionPlan {
  const files = m.files.filter((f) => f.res === res);
  const rows = files.reduce((a, f) => a + f.rows, 0);
  const bytes = files.reduce((a, f) => a + f.bytes, 0);
  return { files, rows, bytes, over: rows > COLLECTION_MAX_CELLS || bytes > COLLECTION_MAX_BYTES };
}

/** every resolution's cells in one list. A loop, not `push(...cells)`: a collection at res 7 holds hundreds of
 * thousands of hexagons, and spreading that many arguments overflows the call stack. */
export function allCells(byRes: ReadonlyMap<number, readonly string[]>): string[] {
  const out: string[] = [];
  for (const cells of byRes.values()) for (const c of cells) out.push(c);
  return out;
}

/** the fill's filter with the place's hexagons: the layer's own filter and `h3` in the list */
export function placeFilterExpr(
  base: FilterSpecification | ExpressionSpecification | undefined,
  cells: readonly string[],
): FilterSpecification {
  const keep = ["in", ["get", "h3"], ["literal", [...cells]]] as unknown as FilterSpecification;
  return (base ? ["all", base, keep] : keep) as FilterSpecification;
}

/** the filter's line (obis-hex `filterNote`): what it keeps, or why it keeps nothing yet */
export function placeFilterNote(o: {
  phase: "idle" | "loading" | "ready" | "error";
  places: number;
  /** places that have no H3 membership (points, lines, a collection without one) */
  without: readonly string[];
  cells: number | null;
  res: number;
  minShare: number;
  error?: string | null;
  tooMany?: boolean;
}): string | null {
  if (o.places === 0) return "Add a place from the gazetteer to keep only its hexagons.";
  if (o.phase === "loading") return "Reading the places' H3 membership…";
  if (o.phase === "error")
    return `The places' H3 membership could not be read (${o.error ?? "unknown"}).`;
  const lines: string[] = [];
  if (o.without.length)
    lines.push(
      `${o.without.join(", ")}: no H3 membership in the gazetteer (a point, a line or no build), so no hexagons.`,
    );
  if (o.tooMany)
    lines.push(
      `Too many hexagons at res ${o.res} for this filter: zoom out or pin a coarser hexagon size.`,
    );
  else if (o.cells !== null)
    lines.push(
      `${o.cells.toLocaleString("en-US")} res-${o.res} hexagons of the place${o.places > 1 ? "s" : ""} (the gazetteer's H3 membership: at least ${Math.round(o.minShare * 100)}% of the hexagon inside, or ${Math.round(o.minShare * 100)}% of the place in it). The legend and the coverage line are statistics of the hexagons, not the place's own values: the Place page has those.`,
    );
  return lines.join(" ") || null;
}

/** a collection filter's line: what it keeps, or why it keeps nothing */
export function collFilterNote(o: {
  title: string | null;
  slug: string;
  phase: "idle" | "loading" | "ready" | "error";
  /** the collection has no H3 membership (a point or line collection, no build, or not in the gazetteer) */
  without: boolean;
  over: boolean;
  cells: number | null;
  res: number;
  minShare: number;
  error?: string | null;
  tooMany?: boolean;
}): string {
  const name = o.title ?? o.slug;
  if (o.without) return `${name}: no H3 membership in the gazetteer, so no hexagons.`;
  if (o.phase === "loading") return `Reading the H3 membership of ${name}…`;
  if (o.phase === "error")
    return `The H3 membership of ${name} could not be read (${o.error ?? "unknown"}).`;
  if (o.over)
    return `${name} has too many hexagons at res ${o.res} to filter by (over ${COLLECTION_MAX_CELLS.toLocaleString("en-US")} membership rows): filter by one place instead, or pin a coarser hexagon size.`;
  if (o.tooMany)
    return `Too many hexagons at res ${o.res} for this filter: zoom out or pin a coarser hexagon size.`;
  if (o.cells === null) return "";
  const pct = Math.round(o.minShare * 100);
  return `${o.cells.toLocaleString("en-US")} res-${o.res} hexagons of ${name} (the gazetteer's H3 membership: at least ${pct}% of the hexagon inside a place, or ${pct}% of a place in it). The legend and the coverage line are statistics of the hexagons, not any place's own values: the Place page has those.`;
}

// ---- seas and oceans: camera presets (obis-hex `view/regions.ts`) ------------------------------------------------

export interface Sea {
  id: string;
  label: string;
  lon: number;
  lat: number;
  zoom: number;
}

/** the 13 "Seas & oceans" cameras of obis-hex 0.11.3: a camera each (no gazetteer feature), chosen so the region fills
 * a laptop-sized map */
export const SEAS: readonly Sea[] = [
  { id: "world", label: "Whole world", lon: -20, lat: 5, zoom: 1.4 },
  { id: "pacific", label: "Pacific Ocean", lon: -160, lat: 5, zoom: 1.8 },
  { id: "atlantic", label: "Atlantic Ocean", lon: -35, lat: 15, zoom: 1.9 },
  { id: "indian", label: "Indian Ocean", lon: 75, lat: -15, zoom: 2.2 },
  { id: "southern", label: "Southern Ocean", lon: 0, lat: -62, zoom: 1.6 },
  { id: "arctic", label: "Arctic Ocean", lon: 0, lat: 78, zoom: 2.2 },
  { id: "caribbean", label: "Caribbean Sea", lon: -75, lat: 16, zoom: 4.2 },
  { id: "gulf-maine", label: "Gulf of Maine", lon: -68.5, lat: 42.8, zoom: 6.2 },
  { id: "north-sea", label: "North Sea", lon: 3, lat: 56, zoom: 4.8 },
  { id: "mediterranean", label: "Mediterranean Sea", lon: 18, lat: 38, zoom: 3.9 },
  { id: "gbr", label: "Great Barrier Reef", lon: 150, lat: -18, zoom: 4.6 },
  { id: "coral-triangle", label: "Coral Triangle", lon: 125, lat: 0, zoom: 4 },
  { id: "benguela", label: "Benguela Current", lon: 14, lat: -27, zoom: 4.6 },
];

/** going to a sea: the camera to fly to, and the URL patch: the camera written (a programmatic move never writes
 * `map=` itself) and the places, their filter and the hexagon cleared (a sea has no gazetteer feature, so the outlined
 * place no longer says where the map is) */
export function seaPatch(id: string): {
  camera: { key: string; label: string; lon: number; lat: number; zoom: number };
  sel: {
    map: { lon: number; lat: number; zoom: number };
    pl: undefined;
    filter: undefined;
    cell: undefined;
  };
} | null {
  const s = SEAS.find((x) => x.id === id);
  if (!s) return null;
  return {
    camera: { key: s.id, label: s.label, lon: s.lon, lat: s.lat, zoom: s.zoom },
    sel: {
      map: { lon: s.lon, lat: s.lat, zoom: s.zoom },
      pl: undefined,
      filter: undefined,
      cell: undefined,
    },
  };
}
