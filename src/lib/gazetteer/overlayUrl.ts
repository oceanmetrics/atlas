// `?ov=` -- which gazetteer collections are toggled on in the Layers panel's "Place layers" group.
// Plain and static-safe (state/codec.ts imports it). The grammar:
//   - key absent            -> the default set (`DEFAULT_OVERLAYS`); never written back
//   - `ov=a,b`              -> exactly those collections, in that order
//   - `ov=` (present, empty)-> none
// A value that equals the default set is not written (the default view writes nothing); an unknown
// or malformed slug is dropped on read (a link to a collection the gazetteer later retires still
// loads, minus that overlay), never thrown on.

/** shown on first load: none (Ben, 2026-10-15: the sanctuaries and BOEM wind leases used to be on by
 * default; people turn layers on from the Place layers list or a link carries `ov=`). */
export const DEFAULT_OVERLAYS: readonly string[] = [];

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
  const next = on
    ? cur.includes(slug)
      ? [...cur]
      : [...cur, slug]
    : cur.filter((s) => s !== slug);
  return sameSet(next, DEFAULT_OVERLAYS) ? undefined : next;
}

// `?cov=` -- which of a collection's own overlays (`atlas:overlays`, lib/catalog/overlays.ts) are on. The same
// grammar as `ov=` with one difference: the default set belongs to the collection, so absent (`undefined`) is
// "its defaults" and any list that is present is written back as it is (`cov=` = none). The Collections lens
// collapses a toggle back to `undefined` when it lands on the defaults (`catalog/overlays.ts#toggledCov`).
/** an overlay id: a URL token (no `,`), the one rule `catalog/overlays.ts` parses `atlas:overlays` ids with. */
export const COV_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

/** `cov=` value -> list (malformed ids dropped, duplicates once); `null` (key absent) -> `undefined`. */
export function parseCov(v: string | null): string[] | undefined {
  if (v === null) return undefined;
  const seen = new Set<string>();
  for (const part of v.split(",")) {
    const id = part.trim();
    if (COV_ID_RE.test(id)) seen.add(id);
    if (seen.size >= MAX_OVERLAYS) break;
  }
  return [...seen];
}

/** the value to write, or `null` for "write nothing" (`undefined`: the collection's defaults). */
export function formatCov(cov: readonly string[] | undefined): string | null {
  return cov === undefined ? null : cov.filter((id) => COV_ID_RE.test(id)).join(",");
}

// `?cff=` -- a collection's overlay feature filters (`atlas:overlay_filters`, lib/catalog/featureFilters.ts): one
// key, `;`-separated `<filter id>:<value>` pairs (`cff=species:1576133;month:7;year:2017-2018`, `month:all`). An
// absent pair is that filter's default (follow the map / all / the whole range); a malformed pair is dropped here,
// an unknown id or a value no option has is the lens' to ignore. Written sorted by id, so a link is stable.

/** a filter value a URL carries: an option's value, `all`, or a range `<from>-<to>` (never `;` or `:`). */
export const FILTER_VALUE_RE = /^[A-Za-z0-9_.-]{1,64}$/;

/** `cff=` value -> {id: value}; `null` (absent), empty or nothing valid -> `undefined`. */
export function parseCff(v: string | null): Record<string, string> | undefined {
  if (v === null) return undefined;
  const out: Record<string, string> = {};
  for (const pair of v.split(";")) {
    const i = pair.indexOf(":");
    if (i <= 0) continue;
    const id = pair.slice(0, i).trim();
    const value = pair.slice(i + 1).trim();
    if (COV_ID_RE.test(id) && FILTER_VALUE_RE.test(value) && !Object.hasOwn(out, id))
      out[id] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** the value to write, or `null` for none (every filter at its default). */
export function formatCff(cff: Readonly<Record<string, string>> | undefined): string | null {
  if (!cff) return null;
  const pairs = Object.entries(cff)
    .filter(([id, value]) => COV_ID_RE.test(id) && FILTER_VALUE_RE.test(value))
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return pairs.length > 0 ? pairs.map(([id, value]) => `${id}:${value}`).join(";") : null;
}

// `?filter=places` -- dim the hex cells outside the selected places. `?filter=coll:<slug>` (an h3 layer only) keeps
// the hexagons of a whole gazetteer polygon collection, by the collection's H3 membership (obis-hex `f=<coll>`).
export type PlaceFilter = "places" | `coll:${string}`;
export function parseFilter(v: string | null): PlaceFilter | undefined {
  if (v === "places") return "places";
  if (v !== null && v.startsWith("coll:")) {
    const slug = v.slice(5);
    if (SLUG_RE.test(slug)) return `coll:${slug}`;
  }
  return undefined;
}

/** the collection slug of a `coll:<slug>` filter, else null */
export function filterColl(f: PlaceFilter | undefined): string | null {
  return f !== undefined && f.startsWith("coll:") ? f.slice(5) : null;
}
