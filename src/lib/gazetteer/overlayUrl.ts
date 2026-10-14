// `?ov=` -- which gazetteer collections are toggled on in the Layers panel's "Place layers" group.
// Plain and static-safe (state/codec.ts imports it). The grammar:
//   - key absent            -> the default set (`DEFAULT_OVERLAYS`); never written back
//   - `ov=a,b`              -> exactly those collections, in that order
//   - `ov=` (present, empty)-> none
// A value that equals the default set is not written (the default view writes nothing); an unknown
// or malformed slug is dropped on read (a link to a collection the gazetteer later retires still
// loads, minus that overlay), never thrown on.

/** shown on first load: the national sanctuaries and the BOEM wind leases. */
export const DEFAULT_OVERLAYS: readonly string[] = ["noaa_sanctuaries", "boem_wind_leases"];

export const MAX_OVERLAYS = 40;
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** `ov=` value -> list; `null` (key absent) -> `undefined` meaning "the default set". */
export function parseOv(v: string | null): string[] | undefined {
  if (v === null) return undefined;
  const seen = new Set<string>();
  for (const part of v.split(",")) {
    const slug = part.trim();
    if (SLUG_RE.test(slug)) seen.add(slug);
    if (seen.size >= MAX_OVERLAYS) break;
  }
  return [...seen];
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((s) => b.includes(s));

/** the value to write, or `null` for "write nothing" (undefined, or the default set). */
export function formatOv(ov: readonly string[] | undefined): string | null {
  if (ov === undefined || sameSet(ov, DEFAULT_OVERLAYS)) return null;
  return ov.join(",");
}

/** the set actually shown: `undefined` is the default. */
export function effectiveOv(ov: readonly string[] | undefined): readonly string[] {
  return ov ?? DEFAULT_OVERLAYS;
}

/** the `Sel.ov` after switching `slug` on or off: the default set collapses back to `undefined`. */
export function toggledOv(
  ov: readonly string[] | undefined,
  slug: string,
  on: boolean,
): string[] | undefined {
  const cur = effectiveOv(ov);
  const next = on ? (cur.includes(slug) ? [...cur] : [...cur, slug]) : cur.filter((s) => s !== slug);
  return sameSet(next, DEFAULT_OVERLAYS) ? undefined : next;
}

// `?filter=places` -- dim the hex cells outside the selected places.
export type PlaceFilter = "places";
export function parseFilter(v: string | null): PlaceFilter | undefined {
  return v === "places" ? "places" : undefined;
}
