// `Sel` <-> URL, exactly per the key table in `atlas-2 core runtime ...md`'s `state/` section. A
// plain module, no DOM/svelte dependency — Node-testable (CLAUDE.md "Testing pyramid"). Every rule
// here follows `atlas-refs/"calcofi explore review.md"` §4's precedent: query for short scalars,
// hash for places + title only; `,`/`:` left un-escaped for a readable, paste-able link; every field
// written only when it differs from its default; an unknown key or a malformed value never throws —
// it is ignored / clamped to the default instead.
// R3 (round-2 plan §5 U4): `layers=`'s parse/format live in the map domain's own layer-stack model
// (`../map/layerStack.ts`), not duplicated here — this module just calls them, exactly like every
// other field's parser.
import { validateCatalogBase, validateCollectionUrl } from "../catalog/base";
import { formatOv, parseFilter, parseOv } from "../gazetteer/overlayUrl";
import { formatLayerStack, parseLayerStack } from "../map/layerStack";
import { isVersionLabel } from "../release/version";
import {
  NO_ALIAS_LOOKUP,
  legacyToolFromParams,
  rewriteLegacyParams,
  type AliasLookup,
} from "./legacy";
import {
  DEFAULT_SEL,
  LENSES,
  OUTLINES,
  PALETTES,
  PROJECTIONS,
  REPRESENTATIONS,
  RELEASE_KEYS,
  SCORES_KEYS,
  THEMES,
  defaultLens,
  defaultOut,
  type Lens,
  type MapView,
  type Sel,
} from "./types";

export interface UrlLike {
  search: string;
  hash: string;
}

// --- shared write-side helper: readable, paste-able values (§4) --------------------------------

/** un-escape `%2C` -> `,`, `%3A` -> `:` and `%2F` -> `/` AFTER `URLSearchParams` serializes — all
 * three are legal, unreserved-enough in a query/fragment that no server or parser needs them escaped
 * (`/` appears in the `catalog=` URL), and a
 * link a person reads and pastes keeps them raw (same call CalCOFI Explorer made, §4). Parsing needs
 * no matching "re-escape" step: `URLSearchParams` reads a literal `,`/`:` in a value identically to
 * its percent-encoded form, since neither is a `&`/`=` delimiter. */
export function prettyEncode(params: URLSearchParams): string {
  return params.toString().replace(/%2C/g, ",").replace(/%3A/g, ":").replace(/%2F/g, "/");
}

// --- per-field parsers: each returns a clamped value, never throws -----------------------------

function cleanString(v: string | null): string | undefined {
  if (v === null) return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

function parseEnum<T extends string>(v: string | null, allowed: readonly T[], fallback: T): T {
  return v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** the legacy theme-name convention (`navy`/`paper`) as
 * aliases of the real app's `dark`/`light` (atlas-8 fix). index.html's inline pre-paint script
 * carries the identical alias table (it must run before this module's bundle parses); both are
 * driven through the same case rows in tests/shell/theme-preboot.test.ts and
 * tests/shell/themeAliases.test.ts, exported so a test can address it directly. */
export const THEME_ALIASES: Readonly<Record<string, "dark" | "light">> = {
  navy: "dark",
  paper: "light",
};

function aliasTheme(v: string | null): string | null {
  return v !== null && v in THEME_ALIASES ? THEME_ALIASES[v] : v;
}

/** `us`: default true (US-only); only `"0"` (exactly) turns it off — any other value, including
 * garbage, falls back to the default (unknown values fall back to defaults). */
function parseUs(v: string | null): boolean {
  return v !== "0";
}

function parseFlag(v: string | null): boolean {
  return v === "1";
}

/** `zl`: default true (zoom-to-layer on); only `"0"` (exactly) turns it off — same "unknown values
 * fall back to the default" rule as `us`. */
function parseZoomToLayer(v: string | null): boolean {
  return v !== "0";
}

function parseVersionLike(v: string | null): string | undefined {
  return v !== null && isVersionLabel(v) ? v : undefined;
}

// a clicked cell or zone (`cell:<id>`, `zone:<unit>:<key>`) is a Scores-lens selection: an instance
// that does not build that lens reads only `place:<n>`
const SEL_TOKEN_RE = SCORES_KEYS ? /^(cell:[^:,]+|zone:[^:,]+:[^:,]+|place:\d+)$/ : /^place:\d+$/;

function parseSelToken(v: string | null): string | undefined {
  return v !== null && SEL_TOKEN_RE.test(v) ? v : undefined;
}

function parseList(v: string | null): string[] {
  if (v === null) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const NUMBER_RE = /^-?\d+(?:\.\d+)?$/;

function parseNum(s: string): number | null {
  if (!NUMBER_RE.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** `map=lon,lat,zoom` (3 fields) or `map=lon,lat,zoom,bearing,pitch` (5 fields, travelling
 * together); any other field count, or any non-numeric field, is malformed and clamps to `undefined`
 * (falls back to the default camera). */
function parseMapView(v: string | null): MapView | undefined {
  if (v === null) return undefined;
  const parts = v.split(",");
  if (parts.length !== 3 && parts.length !== 5) return undefined;
  const nums = parts.map(parseNum);
  if (nums.some((n) => n === null)) return undefined;
  const [lon, lat, zoom, bearing, pitch] = nums as number[];
  return parts.length === 3 ? { lon, lat, zoom } : { lon, lat, zoom, bearing, pitch };
}

function formatMapView(m: MapView): string {
  const base = `${m.lon},${m.lat},${m.zoom}`;
  return m.bearing === undefined && m.pitch === undefined
    ? base
    : `${base},${m.bearing ?? 0},${m.pitch ?? 0}`;
}

// --- parseSel ------------------------------------------------------------------------------------

function parseSelUnsafe(loc: UrlLike, alias: AliasLookup): Sel {
  const params = new URLSearchParams(loc.search ?? "");
  rewriteLegacyParams(params, alias);
  const hashParams = new URLSearchParams((loc.hash ?? "").replace(/^#/, ""));

  const sp = cleanString(params.get("sp"));
  const c = cleanString(params.get("c"));
  const lens: Lens = parseEnum(params.get("lens"), LENSES, defaultLens(sp, c));
  // the Scores lens' and the release registry's keys are read only by an instance that builds them
  // (`SCORES_KEYS`, `RELEASE_KEYS`); elsewhere they stay at their defaults and are never written
  const scores = (k: string) => (SCORES_KEYS ? params.get(k) : null);
  const release = (k: string) => (RELEASE_KEYS ? params.get(k) : null);
  const out = parseEnum(scores("out"), OUTLINES, defaultOut(lens));

  return {
    ver: parseVersionLike(release("ver")),
    lens,
    lyr: cleanString(scores("lyr")),
    pal: parseEnum(params.get("pal"), PALETTES, DEFAULT_SEL.pal),
    unit: cleanString(scores("unit")) ?? DEFAULT_SEL.unit,
    area: cleanString(release("area")) ?? DEFAULT_SEL.area,
    map: parseMapView(params.get("map")),
    proj: parseEnum(params.get("proj"), PROJECTIONS, DEFAULT_SEL.proj),
    sp,
    in: cleanString(params.get("in")) ?? DEFAULT_SEL.in,
    rep: parseEnum(params.get("rep"), REPRESENTATIONS, DEFAULT_SEL.rep),
    us: parseUs(params.get("us")),
    out,
    obis: parseFlag(params.get("obis")),
    sel: parseSelToken(params.get("sel")),
    show: parseList(params.get("show")),
    hide: parseList(params.get("hide")),
    layers: parseLayerStack(params.get("layers")) ?? undefined,
    theme: parseEnum(aliasTheme(params.get("theme")), THEMES, DEFAULT_SEL.theme),
    tour: parseEnum(params.get("tour"), ["on", "off"] as const, DEFAULT_SEL.tour),
    zl: parseZoomToLayer(params.get("zl")),
    c,
    i: cleanString(params.get("i")),
    catalog: validateCatalogBase(params.get("catalog")) ?? undefined,
    collection: validateCollectionUrl(params.get("collection")) ?? undefined,
    ov: parseOv(params.get("ov")),
    filter: parseFilter(params.get("filter")),
    pl: cleanString(hashParams.get("pl")),
    t: cleanString(hashParams.get("t")),
  };
}

/**
 * Parse a `Sel` out of the current URL. Never throws (clamps every malformed value to its default,
 * ignores every unknown key) — even a `loc` whose `search`/`hash` getters themselves throw resolves
 * to `DEFAULT_SEL` rather than propagating, so a bad `location` can never crash the app's boot.
 */
export function parseSel(loc: UrlLike, alias: AliasLookup = NO_ALIAS_LOOKUP): Sel {
  try {
    return parseSelUnsafe(loc, alias);
  } catch {
    return { ...DEFAULT_SEL };
  }
}

// --- formatSel -----------------------------------------------------------------------------------

/**
 * A `Sel` whose required fields (those with a non-undefined default) are `undefined` is a bug at the
 * caller, but it must never reach the address bar: `undefined !== "native"` is true, so
 * `rep: undefined` used to be written as the literal `rep=undefined` (a legacy `?mdl_seq=` link
 * rewrote itself to `...&rep=undefined&us=0`). An undefined field means "the default".
 * (MarineSensitivity/atlas 0.10.92.)
 */
function fillUndefinedFromDefaults(sel: Sel): Sel {
  const out: Record<string, unknown> = { ...sel };
  for (const [k, def] of Object.entries(DEFAULT_SEL)) {
    if (out[k] === undefined && def !== undefined) out[k] = def;
  }
  return out as unknown as Sel;
}

/**
 * Serialize `sel` back to a URL, writing ONLY fields that differ from their default (the shipped
 * default view is `""`/`""` — no query, no hash) and using `,`/`:` un-escaped for readability. Query
 * holds every field except `pl`/`t`, which live in the hash (plan: a fragment is never sent to a
 * server or a referrer).
 */
export function formatSel(input: Sel): { search: string; hash: string } {
  const sel = fillUndefinedFromDefaults(input);
  const params = new URLSearchParams();

  if (RELEASE_KEYS && sel.ver !== undefined) params.set("ver", sel.ver);
  const lensDefault = defaultLens(sel.sp, sel.c);
  if (sel.lens !== lensDefault) params.set("lens", sel.lens);
  if (SCORES_KEYS && sel.lyr) params.set("lyr", sel.lyr);
  if (sel.pal !== DEFAULT_SEL.pal) params.set("pal", sel.pal);
  if (SCORES_KEYS && sel.unit !== DEFAULT_SEL.unit) params.set("unit", sel.unit);
  if (RELEASE_KEYS && sel.area !== DEFAULT_SEL.area) params.set("area", sel.area);
  if (sel.map) params.set("map", formatMapView(sel.map));
  if (sel.proj !== DEFAULT_SEL.proj) params.set("proj", sel.proj);
  if (sel.sp) params.set("sp", sel.sp);
  if (sel.in !== DEFAULT_SEL.in) params.set("in", sel.in);
  if (sel.rep !== DEFAULT_SEL.rep) params.set("rep", sel.rep);
  if (sel.us === false) params.set("us", "0");
  if (SCORES_KEYS && sel.out !== defaultOut(sel.lens)) params.set("out", sel.out);
  if (sel.obis === true) params.set("obis", "1");
  if (sel.sel) params.set("sel", sel.sel);
  if (sel.show.length > 0) params.set("show", sel.show.join(","));
  if (sel.hide.length > 0) params.set("hide", sel.hide.join(","));
  const layersToken = formatLayerStack(sel.layers);
  if (layersToken !== null) params.set("layers", layersToken);
  if (sel.theme !== DEFAULT_SEL.theme) params.set("theme", sel.theme);
  if (sel.tour !== DEFAULT_SEL.tour) params.set("tour", sel.tour);
  if (sel.zl === false) params.set("zl", "0");
  if (sel.c) params.set("c", sel.c);
  if (sel.i) params.set("i", sel.i);
  if (sel.catalog) params.set("catalog", sel.catalog);
  if (sel.collection) params.set("collection", sel.collection);
  const ovToken = formatOv(sel.ov);
  if (ovToken !== null) params.set("ov", ovToken);
  if (sel.filter === "places") params.set("filter", "places");

  const hashParams = new URLSearchParams();
  if (sel.pl) hashParams.set("pl", sel.pl);
  if (sel.t) hashParams.set("t", sel.t);

  const searchKeys = [...params.keys()];
  const hashKeys = [...hashParams.keys()];
  return {
    search: searchKeys.length > 0 ? `?${prettyEncode(params)}` : "",
    hash: hashKeys.length > 0 ? `#${prettyEncode(hashParams)}` : "",
  };
}

/**
 * Whether `loc` carries any view state at all — i.e., a round trip through `parseSel`/`formatSel`
 * would write at least one field back, meaning `loc` differs from the app's own default view. This
 * is "is this a deep link" in exactly this module's own vocabulary (`formatSel`'s header: "writing
 * ONLY fields that differ from their default"), never a second, hand-rolled notion of it — a caller
 * that wants "did the visitor arrive via a link that names something" (the first-timer welcome must never
 * interrupt a deep link) calls this instead of
 * re-deriving it from `location.search`/`.hash` directly.
 */
export function hasViewState(loc: UrlLike): boolean {
  const { search, hash } = formatSel(parseSel(loc));
  return search !== "" || hash !== "";
}

/**
 * Whether `loc` is a deep link for the purpose of the first-visit Welcome modal: any `Sel` view
 * state (`hasViewState`) OR a recognised `?tool=` (the rail tool to open). `tool` is not a `Sel`
 * key, so `hasViewState` cannot see it, and a bare `?tool=report` used to open Report underneath
 * the modal. A malformed `tool=` value is not a deep link (`legacyToolFromParams` returns null),
 * like every other malformed value. (MarineSensitivity/atlas 0.10.91.)
 */
export function isDeepLink(loc: UrlLike): boolean {
  if (hasViewState(loc)) return true;
  try {
    return legacyToolFromParams(new URLSearchParams(loc.search ?? "")) !== null;
  } catch {
    return false;
  }
}
