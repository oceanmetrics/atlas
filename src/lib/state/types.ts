// The `Sel` object — one plain shape, every field a piece of view state that a shared link has to
// reproduce (plan atlas-2 `state/`, master-plan D8's "the URL is the whole view"; key table in
// `../workflows/.claude/plans_todo/atlas-2 core runtime (release, state, grid, engine, OPFS,
// places).md`). No svelte here — see sel.svelte.ts for the one file in this directory that wraps
// this plain shape in a `$state` rune; everything else must stay plain-module testable under Node
// (CLAUDE.md "Testing pyramid" / "keep the parse/format core a plain module").
//
// `ver` is carried here purely so it round-trips structurally; WHETHER to ever write it back to the
// query is a host-mode decision ("release (public host only)") that belongs to whoever wires state/
// to release/ in a later phase — this module does not know if it is running on the public host or
// the preview host.

// R3 layer stack model (round-2 plan §5 U4): `LayerStackEntry`/`LayerGroupId` are the map domain's
// own types (`../map/layerStack.ts` — classification, opacity application, the `layers=` codec all
// live there). Importing them here is the SAME cross-domain precedent `../map/layers/zones.ts`
// already sets in the other direction (it imports `Outline` FROM this file) — this module still has
// no svelte/DOM/MapLibre dependency, only a plain type import.
import type { LayerStackEntry } from "../map/layerStack";
import { INSTANCE } from "../brand/instance";
export type { LayerStackEntry } from "../map/layerStack";

/** every lens this codebase can build; an instance builds the subset its `lenses` names (`LENSES`). */
export type Lens = "collection" | "species" | "scores";
export type Palette = "spectral_r" | "viridis" | "cividis" | "magma";
export type Projection = "globe" | "mercator";
/** `native` / `model` are the species lens' representations; `005` is the registry collections' (AquaMaps
 * native 0.5 degree) switch to the downscaled 0.05 degree surface. The species lens ignores it (its
 * `pickAsset` falls back to native). */
export type Representation = "native" | "model" | "005";
/** tri-state (fix round 1, atlas-3): `"auto"` is the default — never written to the URL — and
 * follows `prefers-color-scheme` at render time (`resolveTheme`, below); `"light"`/`"dark"` are
 * explicit OVERRIDES, and BOTH must round-trip (before this fix, `theme=light` was silently dropped
 * because "light" was treated as the constant default — a sender on a dark system shared a light
 * view and the recipient saw dark). */
export type Theme = "light" | "dark" | "auto";
export type Tour = "on" | "off";
/** the zone outline drawn over the map (`out=`): a release capability, read only by an instance that
 * declares `release` (its `boot.units`); `none` everywhere else. */
export type Outline = "programarea" | "ecoregion" | "none";
/** the resolved, renderable theme — plan atlas-3's two brand themes. */
export type ResolvedTheme = "navy" | "paper";

/** `map=lon,lat,zoom[,bearing,pitch]` — bearing/pitch travel together (both present or both absent),
 * matching the compact 3- or 5-field tuple the URL carries (`atlas-refs/"calcofi explore review.md"`
 * §4's `parseCam`/`parseMap` pattern). */
export interface MapView {
  lon: number;
  lat: number;
  zoom: number;
  bearing?: number;
  pitch?: number;
}

export interface Sel {
  /** release version (`ver=`), read only by an instance with a release registry (`instance.release`);
   * public-host-only (see the module header). `undefined` = "unset here". */
  ver?: string;
  lens: Lens;
  /** score layer `metric_key` (the Scores lens' `lyr=`); opaque string, no default written. */
  lyr?: string;
  pal: Palette;
  /** the Scores lens' spatial unit (`unit=`): `"cell"` or a drawable unit key from `boot.units`. */
  unit: string;
  /** study-area camera preset key (`area=`, a release's `boot.study_areas`), applied only when `map`
   * is absent. */
  area: string;
  map?: MapView;
  proj: Projection;
  /** species key. */
  sp?: string;
  /** input `ds_key`. */
  in: string;
  rep: Representation;
  /** `true` = US-only (default, `us` key omitted); `false` = include non-US (`us=0` written). */
  us: boolean;
  /** the zone outline (`out=`); its default is per lens (`defaultOut`). */
  out: Outline;
  obis: boolean;
  /** `place:<n>`: the place list entry highlighted on the map; with the Scores lens also
   * `cell:<id>` | `zone:<unit>:<key>` (a clicked cell or zone). */
  sel?: string;
  /** panel-visibility deltas against the shipped default (plan: "deltas", not an absolute list). */
  show: string[];
  hide: string[];
  /** R3 (round-2 plan §5 U4): deviations from the release's default layer stack (order + each
   * group's visible/opacity) — `layers=`, `../map/layerStack.ts#parseLayerStack`/`formatLayerStack`.
   * `undefined` = the default stack (never written to the URL), matching every other "deltas, not an
   * absolute list" field on this type (`show`/`hide`). */
  layers?: readonly LayerStackEntry[];
  theme: Theme;
  tour: Tour;
  /** the Collections lens' active collection id (`?c=`); `undefined` = the first available one. */
  c?: string;
  /** the active item id within that collection (`?i=`); `undefined` = its default item. The item's
   * own `atlas:dims` say which value each dimension selector shows (`catalog/dims.ts`). */
  i?: string;
  /** a validated `https` catalog base overriding the default (`?catalog=`, `catalog/base.ts`). */
  catalog?: string;
  /** WP11: `?collection=<https url of a collection.json>`: one extra, unlisted collection loaded into the
   * picker (a private link to a restricted collection), `catalog/base.ts#validateCollectionUrl`. */
  collection?: string;
  /** WP4: the gazetteer collections toggled on in the "Place layers" group (`?ov=a,b`); `undefined` =
   * the default set (none since 2026-10-15), never written; `[]` = none (`ov=`).
   * `../gazetteer/overlayUrl.ts`. */
  ov?: readonly string[];
  /** WP4: `?filter=places` dims hex cells whose centroid lies outside every place in the list. */
  filter?: "places";
  /** R3-W8 item 2: the species lens' "Zoom to layer on change" preference — `true` (default, never
   * written) refits the camera to whatever input/representation the viewer just picked
   * (`data/camera.ts`'s `refitOnInputChange`); `false` writes `zl=0` so the viewer can flip between
   * inputs at a fixed camera and a shared link reproduces that choice. */
  zl: boolean;
  /** hash only: the place codec (`g1`, opaque here — that codec belongs to another agent). */
  pl?: string;
  /** hash only: the report title. */
  t?: string;
}

/** query keys `formatSel`/`parseSel` know about, in the order they are written (stable, readable
 * URLs — not load-bearing for parsing, which is key-based via URLSearchParams). */
export const QUERY_KEYS = [
  "ver",
  "lens",
  "lyr",
  "pal",
  "unit",
  "area",
  "map",
  "proj",
  "sp",
  "in",
  "rep",
  "us",
  "out",
  "obis",
  "sel",
  "show",
  "hide",
  "layers",
  "theme",
  "tour",
  "zl",
  "c",
  "i",
  "catalog",
  "collection",
  "ov",
  "filter",
] as const;

/** hash keys: places and the report title only — a fragment is never sent to a server or a
 * referrer, which is exactly why these two (and only these two) live there (plan `state/` header). */
export const HASH_KEYS = ["pl", "t"] as const;

export const PALETTES: readonly Palette[] = ["spectral_r", "viridis", "cividis", "magma"];
export const PROJECTIONS: readonly Projection[] = ["globe", "mercator"];
export const REPRESENTATIONS: readonly Representation[] = ["native", "model", "005"];
/** every value `theme=` may parse from, including `"auto"` (the default, read back identically to
 * an absent key — see `parseSel`). */
export const THEMES: readonly Theme[] = ["light", "dark", "auto"];
export const OUTLINES: readonly Outline[] = ["programarea", "ecoregion", "none"];
/** every lens this codebase knows, in the lens switch's order. */
export const ALL_LENSES: readonly Lens[] = ["collection", "scores", "species"];
/** the lenses this build carries: the instance's `lenses` (instances/<id>/instance.json), in its
 * order, narrowed to the ones the codebase knows. A `?lens=` outside it falls back to the default. */
export const LENSES: readonly Lens[] = INSTANCE.lenses.filter((l): l is Lens =>
  (ALL_LENSES as readonly string[]).includes(l),
);

/** the URL keys that belong to a capability the instance may not build: the Scores lens' (`lyr`,
 * `unit`, `out`, the `cell:`/`zone:` selections) and the release registry's (`ver`, `area`). An
 * instance without the capability never reads or writes them (`?ver=v9` on such an atlas is
 * ignored, as before the MarineSensitivity instance moved in). */
export const SCORES_KEYS = LENSES.includes("scores");
export const RELEASE_KEYS = INSTANCE.release !== undefined;

/** the instance's own default for a key (`defaults` in instances/<id>/instance.json) when it is a
 * member of `allowed`, else `fallback`: an instance can choose among the values this build knows,
 * never add one. */
function instanceDefault<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** the lens a fresh view opens on (the instance's `defaults.lens`). */
export const INSTANCE_LENS: Lens = instanceDefault(
  INSTANCE.defaults.lens,
  LENSES,
  LENSES[0] ?? "collection",
);

/**
 * `lens`'s context-dependent default: `"species"` when a species key is present in the URL and no
 * collection is, `"collection"` otherwise. A collection id (`c`) wins because the Collections lens
 * also uses `sp` -- the taxon picked inside an MST taxon collection (`?c=msens-v7-rng_iucn&sp=54241`,
 * docs/mst-by-reference.md) -- and that link must open the Collections lens, not the Species lens.
 * Shared between `parseSel` and `formatSel` so a value that equals its OWN default is omitted
 * symmetrically in both directions (the URL round-trip property).
 */
export function defaultLens(sp: string | undefined, c?: string): Lens {
  return sp && !c ? "species" : INSTANCE_LENS;
}

/**
 * `out`'s context-dependent default, per lens: the Scores lens' primary unit is the Program Area, so
 * outlines default on there; every other lens defaults to none. ONE table: `parseSel` (the default
 * when `out` is absent) and `formatSel` (the "is this a default?" comparison) both read it.
 */
export const DEFAULT_OUT_BY_LENS: Record<Lens, Outline> = {
  collection: "none",
  scores: "programarea",
  species: "none",
};

export function defaultOut(lens: Lens): Outline {
  return DEFAULT_OUT_BY_LENS[lens];
}

/**
 * The renderable theme (plan atlas-3): `"dark"` -> navy, `"light"` -> paper, `"auto"` follows
 * `prefersDark` (the live `matchMedia("(prefers-color-scheme: dark)").matches` value, injected so
 * this stays a pure function) and resolves to **navy** when that signal is unavailable (`null`) —
 * i.e. only an explicit `prefersDark === false` ever yields paper from `"auto"`.
 */
export function resolveTheme(theme: Theme, prefersDark: boolean | null): ResolvedTheme {
  if (theme === "dark") return "navy";
  if (theme === "light") return "paper";
  return prefersDark === false ? "paper" : "navy";
}

/**
 * Layers pane R3-W1 fix round (Ben: "dim Selection if there is none to display, otherwise its
 * presence can cause confusion"). `Sel.sel` unifies every kind of PICK this app has ("cell:<id>" |
 * "zone:<unit>:<key>" | "place:<n>", this file's own header) into one optional string — a
 * picked/drawn/uploaded place and a clicked cell/zone all write it, and nothing else does.
 *
 * R3-rr fix 3 (Opus 5.5 eyes-on review round 3, 2026-09-25): `sel.sel` is not the only thing the
 * Selection row draws — a loaded PLACES LIST (the `pl=` hash token, decoded by
 * `places/model.ts#placesFromHash`) shows on its own even with no `sel` pick at all (`?pl=z.pa.GAA`
 * loads a place with no cell/zone SELECTED yet, and the Places panel + Download menu both treat
 * that as "places present"). The row used to dim on `?pl=` alone because this predicate only ever
 * checked `sel`. `placeCount` is the second thing that must ALSO be empty (0, the default) — a
 * pure predicate over both so both lenses' `rowState` and this file's own test agree on the one
 * definition, exactly as before.
 */
export function isPlacesSelectionEmpty(sel: string | undefined, placeCount = 0): boolean {
  return !sel && placeCount === 0;
}

/** every field's context-INDEPENDENT default (see `defaultLens`/`defaultOut` for the two that are
 * not constants). Used both to seed a fresh `Sel` and as the "is this a default?" comparison for
 * every other field when formatting. */
export const DEFAULT_SEL: Sel = {
  // the instance's defaults (lens, theme, tour; instances/<id>/instance.json `defaults`)
  ver: undefined,
  lens: INSTANCE_LENS,
  lyr: undefined,
  pal: "spectral_r",
  unit: "cell",
  area: "FULL",
  map: undefined,
  proj: "globe",
  sp: undefined,
  in: "merged",
  rep: "native",
  us: true,
  out: defaultOut(INSTANCE_LENS),
  obis: false,
  sel: undefined,
  show: [],
  hide: [],
  layers: undefined,
  // U2a (round 2): the default is DARK, not "auto" -- matching both Shiny apps and the brand's
  // dark lockup, regardless of the OS's prefers-color-scheme. "auto" stays a legal, explicit
  // Theme value (an old `?theme=auto` link, or a future auto-follow control, still resolves
  // through prefers-color-scheme via resolveTheme()) -- it is simply no longer what an absent or
  // malformed `?theme=` falls back to. See docs/usability.md p3 and "Ben's items" (theme default).
  theme: instanceDefault(INSTANCE.defaults.theme, THEMES, "dark"),
  tour: instanceDefault(INSTANCE.defaults.tour, ["on", "off"] as const, "on"),
  c: undefined,
  i: undefined,
  catalog: undefined,
  collection: undefined,
  ov: undefined,
  filter: undefined,
  zl: true,
  pl: undefined,
  t: undefined,
};
