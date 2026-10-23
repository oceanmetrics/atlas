import { describe, expect, it } from "vitest";
import { formatSel, hasViewState, parseSel, type UrlLike } from "../../src/lib/state/codec";
import {
  DEFAULT_SEL,
  defaultLens,
  isPlacesSelectionEmpty,
  resolveTheme,
  type Sel,
} from "../../src/lib/state/types";
import type { AliasLookup } from "../../src/lib/state/legacy";

const EMPTY: UrlLike = { search: "", hash: "" };

describe("parseSel: the shipped default view is the empty URL", () => {
  it("with no query and no hash, every field equals DEFAULT_SEL", () => {
    expect(parseSel(EMPTY)).toEqual(DEFAULT_SEL);
  });
});

describe("formatSel: emits ONLY non-default fields (the seeded fault: a default value in the URL)", () => {
  it("DEFAULT_SEL formats to an empty search and an empty hash", () => {
    expect(formatSel(DEFAULT_SEL)).toEqual({ search: "", hash: "" });
  });

  it("a single non-default field writes exactly one key", () => {
    expect(formatSel({ ...DEFAULT_SEL, pal: "viridis" }).search).toBe("?pal=viridis");
  });

  it("setting a field back to its default omits it again", () => {
    const sel: Sel = { ...DEFAULT_SEL, pal: "viridis" };
    sel.pal = DEFAULT_SEL.pal;
    expect(formatSel(sel).search).toBe("");
  });
});

describe("lens: default 'collection', or 'species' when sp is present", () => {
  it("parses to 'collection' with no sp", () => {
    expect(parseSel(EMPTY).lens).toBe("collection");
  });

  it("parses to 'species' when sp is present and lens is unset", () => {
    expect(parseSel({ search: "?sp=whale-x", hash: "" }).lens).toBe("species");
  });

  it("an explicit lens overrides the sp-derived default", () => {
    expect(parseSel({ search: "?sp=whale-x&lens=collection", hash: "" }).lens).toBe("collection");
  });

  it("formatSel omits lens when it equals the sp-derived default", () => {
    expect(formatSel({ ...DEFAULT_SEL, sp: "whale-x", lens: "species" }).search).toBe(
      "?sp=whale-x",
    );
  });

  it("formatSel writes lens when it does NOT equal the sp-derived default", () => {
    const search = formatSel({ ...DEFAULT_SEL, sp: "whale-x", lens: "collection" }).search;
    expect(search).toContain("lens=collection");
  });

  it("an unrecognized lens value falls back to the (contextual) default", () => {
    expect(parseSel({ search: "?lens=bogus", hash: "" }).lens).toBe("collection");
    expect(parseSel({ search: "?sp=x&lens=bogus", hash: "" }).lens).toBe("species");
  });
});

describe("retired keys (ver, lyr, unit, area, out): ignored, never round-tripped", () => {
  // an instance that builds neither the Scores lens nor a release registry (codec.mst.test.ts has them)
  it("parse leaves them at their defaults and format never writes them back", () => {
    const sel = parseSel({
      search: "?ver=v9&lyr=extrisk_bird&unit=ecoregion&area=GEO&out=ecoregion&pal=viridis",
      hash: "",
    });
    expect(sel.pal).toBe("viridis");
    for (const k of ["ver", "lyr"]) {
      expect((sel as unknown as Record<string, unknown>)[k]).toBeUndefined();
    }
    expect(sel.unit).toBe(DEFAULT_SEL.unit);
    expect(sel.area).toBe(DEFAULT_SEL.area);
    expect(sel.out).toBe(DEFAULT_SEL.out);
    expect(formatSel(sel).search).toBe("?pal=viridis");
  });
});

describe("pal: enum, default spectral_r", () => {
  it("accepts every documented value", () => {
    for (const v of ["spectral_r", "viridis", "cividis", "magma"]) {
      expect(parseSel({ search: `?pal=${v}`, hash: "" }).pal).toBe(v);
    }
  });

  it("an unknown value falls back to spectral_r", () => {
    expect(parseSel({ search: "?pal=rainbow", hash: "" }).pal).toBe("spectral_r");
  });
});

describe("proj / rep / tour: enums with fixed defaults", () => {
  it("proj defaults to globe and clamps garbage", () => {
    expect(parseSel(EMPTY).proj).toBe("globe");
    expect(parseSel({ search: "?proj=flat", hash: "" }).proj).toBe("globe");
    expect(parseSel({ search: "?proj=mercator", hash: "" }).proj).toBe("mercator");
  });

  it("rep defaults to native and clamps garbage", () => {
    expect(parseSel(EMPTY).rep).toBe("native");
    expect(parseSel({ search: "?rep=bogus", hash: "" }).rep).toBe("native");
    expect(parseSel({ search: "?rep=model", hash: "" }).rep).toBe("model");
  });

  it("tour defaults to on; only tour=off is ever written or read as off", () => {
    expect(parseSel(EMPTY).tour).toBe("on");
    expect(parseSel({ search: "?tour=off", hash: "" }).tour).toBe("off");
    expect(parseSel({ search: "?tour=bogus", hash: "" }).tour).toBe("on");
    expect(formatSel({ ...DEFAULT_SEL, tour: "on" }).search).toBe("");
    expect(formatSel({ ...DEFAULT_SEL, tour: "off" }).search).toBe("?tour=off");
  });
});

describe("theme: tri-state, default 'dark' (U2a, round 2 — was 'auto', fix round 1/atlas-3)", () => {
  it("defaults to 'dark' with no key (U2a: no longer follows prefers-color-scheme by default)", () => {
    expect(parseSel(EMPTY).theme).toBe("dark");
  });

  it("parses explicit light/dark/auto, and clamps garbage to the default 'dark'", () => {
    expect(parseSel({ search: "?theme=light", hash: "" }).theme).toBe("light");
    expect(parseSel({ search: "?theme=dark", hash: "" }).theme).toBe("dark");
    expect(parseSel({ search: "?theme=auto", hash: "" }).theme).toBe("auto");
    expect(parseSel({ search: "?theme=blue", hash: "" }).theme).toBe("dark");
  });

  it("an explicit theme=auto reads back as auto — still a legal, explicit override", () => {
    expect(parseSel({ search: "?theme=auto", hash: "" }).theme).toBe("auto");
  });

  // the fix-round-1 seeded fault: theme=light used to be silently dropped on format, because
  // "light" was (wrongly) treated as the constant default. It must still survive now that the
  // constant default is "dark" instead of "auto".
  it("formatSel writes theme=light — the seeded fault this guards (light was silently dropped)", () => {
    expect(formatSel({ ...DEFAULT_SEL, theme: "light" }).search).toBe("?theme=light");
  });

  it("formatSel omits theme=dark — U2a: dark is now the default, so it is never written", () => {
    expect(formatSel({ ...DEFAULT_SEL, theme: "dark" }).search).toBe("");
  });

  // U2a flips this: "auto" differs from the new default ("dark"), so an explicit choice to
  // follow the OS must survive a round trip exactly like light/dark do — the opposite of the old
  // "formatSel never writes theme=auto" rule, which depended on "auto" being the default.
  it("formatSel WRITES theme=auto now that dark, not auto, is the default", () => {
    expect(formatSel({ ...DEFAULT_SEL, theme: "auto" }).search).toBe("?theme=auto");
  });

  it("light, dark and auto all round-trip exactly (parse . format = identity)", () => {
    for (const theme of ["light", "dark", "auto"] as const) {
      const { search } = formatSel({ ...DEFAULT_SEL, theme });
      expect(parseSel({ search, hash: "" }).theme).toBe(theme);
    }
  });
});

describe("resolveTheme: the tri-state Sel.theme -> the two renderable brand themes", () => {
  it("'dark' resolves to navy regardless of prefersDark", () => {
    expect(resolveTheme("dark", true)).toBe("navy");
    expect(resolveTheme("dark", false)).toBe("navy");
    expect(resolveTheme("dark", null)).toBe("navy");
  });

  it("'light' resolves to paper regardless of prefersDark", () => {
    expect(resolveTheme("light", true)).toBe("paper");
    expect(resolveTheme("light", false)).toBe("paper");
    expect(resolveTheme("light", null)).toBe("paper");
  });

  it("'auto' + prefersDark true resolves to navy", () => {
    expect(resolveTheme("auto", true)).toBe("navy");
  });

  it("'auto' + prefersDark false resolves to paper", () => {
    expect(resolveTheme("auto", false)).toBe("paper");
  });

  // the seeded fault: auto resolving to paper when prefers-color-scheme is unavailable — it must
  // resolve to navy (the MMA dark theme) instead, matching "navy when the media query is unavailable".
  it("'auto' + prefersDark null (media query unavailable) resolves to navy, NOT paper", () => {
    expect(resolveTheme("auto", null)).toBe("navy");
  });
});

describe("isPlacesSelectionEmpty: the Layers pane's Selection row dims when Sel.sel is unset", () => {
  it("undefined (no place selection) is empty", () => {
    expect(isPlacesSelectionEmpty(undefined)).toBe(true);
  });

  it("an empty string is empty", () => {
    expect(isPlacesSelectionEmpty("")).toBe(true);
  });

  it("a drawn/uploaded place selection is NOT empty", () => {
    expect(isPlacesSelectionEmpty("place:0")).toBe(false);
  });

  // R3-rr fix 3 (Opus 5.5 eyes-on review round 3, 2026-09-25): `?pl=z.pa.GAA` loads one place
  // (Places panel: "1 / 20 places", Download menu offers "Selected places · GeoJSON") with NO
  // `sel.sel` pick at all — the row used to stay dimmed for want of a SECOND thing this predicate
  // never checked.
  it("BUG: places present (placeCount > 0), no sel pick — NOT empty", () => {
    expect(isPlacesSelectionEmpty(undefined, 1)).toBe(false);
    expect(isPlacesSelectionEmpty("", 20)).toBe(false);
  });

  it("no sel pick and no places (placeCount 0, the default) — still empty", () => {
    expect(isPlacesSelectionEmpty(undefined, 0)).toBe(true);
    expect(isPlacesSelectionEmpty(undefined)).toBe(true);
  });

  it("a sel pick with zero places is still NOT empty (sel alone is enough, as before)", () => {
    expect(isPlacesSelectionEmpty("place:2", 0)).toBe(false);
  });
});

describe("us: default true (US-only); only us=0 turns it off", () => {
  it("defaults to true with no key", () => {
    expect(parseSel(EMPTY).us).toBe(true);
  });

  it("us=0 parses to false", () => {
    expect(parseSel({ search: "?us=0", hash: "" }).us).toBe(false);
  });

  it("any other value (including us=1) falls back to the default true", () => {
    expect(parseSel({ search: "?us=1", hash: "" }).us).toBe(true);
    expect(parseSel({ search: "?us=bogus", hash: "" }).us).toBe(true);
  });

  it("formatSel writes us=0 only when false, and never writes us=1", () => {
    expect(formatSel({ ...DEFAULT_SEL, us: false }).search).toBe("?us=0");
    expect(formatSel({ ...DEFAULT_SEL, us: true }).search).toBe("");
  });
});

describe("zl: default true (zoom-to-layer on); only zl=0 turns it off (R3-W8 item 2)", () => {
  it("defaults to true with no key", () => {
    expect(parseSel(EMPTY).zl).toBe(true);
  });

  it("zl=0 parses to false", () => {
    expect(parseSel({ search: "?zl=0", hash: "" }).zl).toBe(false);
  });

  it("any other value (including zl=1) falls back to the default true", () => {
    expect(parseSel({ search: "?zl=1", hash: "" }).zl).toBe(true);
    expect(parseSel({ search: "?zl=bogus", hash: "" }).zl).toBe(true);
  });

  it("formatSel writes zl=0 only when false, and never writes zl=1", () => {
    expect(formatSel({ ...DEFAULT_SEL, zl: false }).search).toBe("?zl=0");
    expect(formatSel({ ...DEFAULT_SEL, zl: true }).search).toBe("");
  });
});

describe("obis: default false (off); only obis=1 turns it on", () => {
  it("defaults to false", () => {
    expect(parseSel(EMPTY).obis).toBe(false);
  });

  it("obis=1 parses to true; anything else is false", () => {
    expect(parseSel({ search: "?obis=1", hash: "" }).obis).toBe(true);
    expect(parseSel({ search: "?obis=true", hash: "" }).obis).toBe(false);
  });

  it("formatSel writes obis=1 only when true", () => {
    expect(formatSel({ ...DEFAULT_SEL, obis: true }).search).toBe("?obis=1");
    expect(formatSel({ ...DEFAULT_SEL, obis: false }).search).toBe("");
  });
});

describe("in / sp: free-form strings, structural clamping only", () => {
  it("in/sp round-trip an arbitrary opaque string", () => {
    const sel = parseSel({ search: "?in=raw_ds_1&sp=whale-x", hash: "" });
    expect(sel.in).toBe("raw_ds_1");
    expect(sel.sp).toBe("whale-x");
  });

  it("in falls back to its default ('merged') on an empty value", () => {
    expect(parseSel({ search: "?in=", hash: "" }).in).toBe("merged");
  });

  it("sp falls back to undefined (its default) on an empty value", () => {
    expect(parseSel({ search: "?sp=", hash: "" }).sp).toBeUndefined();
  });
});

describe("sel: place:<n>, clamps anything else (cell/zone tokens belonged to the retired scores lens)", () => {
  it("accepts a place token", () => {
    expect(parseSel({ search: "?sel=place:3", hash: "" }).sel).toBe("place:3");
  });

  it("clamps a malformed or retired token to undefined rather than passing it through", () => {
    expect(parseSel({ search: "?sel=bogus", hash: "" }).sel).toBeUndefined();
    expect(parseSel({ search: "?sel=place:abc", hash: "" }).sel).toBeUndefined();
    expect(parseSel({ search: "?sel=cell:12345", hash: "" }).sel).toBeUndefined();
    expect(parseSel({ search: "?sel=zone:programarea:GEO", hash: "" }).sel).toBeUndefined();
  });
});

describe("show / hide: comma-joined panel-id deltas, default empty", () => {
  it("defaults to an empty array", () => {
    expect(parseSel(EMPTY).show).toEqual([]);
    expect(parseSel(EMPTY).hide).toEqual([]);
  });

  it("splits a comma-joined list and drops blank tokens", () => {
    expect(parseSel({ search: "?show=legend,,flowers", hash: "" }).show).toEqual([
      "legend",
      "flowers",
    ]);
  });

  it("formatSel joins back with commas, and omits the key when empty", () => {
    expect(formatSel({ ...DEFAULT_SEL, show: ["legend", "flowers"] }).search).toBe(
      "?show=legend,flowers",
    );
    expect(formatSel({ ...DEFAULT_SEL, show: [] }).search).toBe("");
  });
});

// R3 layer stack model (round-2 plan §5 U4, `docs/usability.md` §7 R3): `layers=` -- the STACK's own
// rule-level tests live in `tests/map/layerStack.test.ts` (parseLayerStack/formatLayerStack); this
// describe block only proves `parseSel`/`formatSel` actually WIRE that codec in, the same
// integration-proof shape `describe("composeStyle + zoneUnitsWithOutline (G-25...")` in
// `tests/map/style.test.ts` uses for `out=`.
describe("layers: the R3 layer stack (deltas against the default, via ../map/layerStack.ts)", () => {
  it("defaults to undefined (the release's default stack; never written to the URL)", () => {
    expect(parseSel(EMPTY).layers).toBeUndefined();
    expect(formatSel(DEFAULT_SEL).search).toBe("");
  });

  it("a hidden group survives a parseSel round trip (a partial token also names every OTHER group, appended, per layerStack.ts's own forward-compat rule — so the re-formatted URL is IDEMPOTENT, not byte-identical to the hand-written partial input)", () => {
    const loc = { search: "?layers=basemap-labels:h", hash: "" };
    const sel = parseSel(loc);
    expect(sel.layers?.find((e) => e.id === "basemap-labels")).toEqual({
      id: "basemap-labels",
      visible: false,
      opacity: 1,
    });
    const reformatted = formatSel(sel).search;
    expect(reformatted).not.toBe(""); // still a deviation from the default -- the key survives
    expect(formatSel(parseSel({ search: reformatted, hash: "" })).search).toBe(reformatted); // idempotent
  });

  it("a reordered + dimmed stack round-trips", () => {
    const loc = {
      search:
        "?layers=basemap-land,basemap-bathymetry,basemap-boundaries,data-raster:o50,basemap-roads,basemap-labels,data-overlays,data-places",
      hash: "",
    };
    const sel = parseSel(loc);
    expect(sel.layers?.map((e) => e.id)).toEqual([
      "basemap-land",
      "basemap-bathymetry",
      "basemap-boundaries",
      "data-raster",
      "basemap-roads",
      "basemap-labels",
      "data-overlays",
      "data-places",
    ]);
    expect(sel.layers?.find((e) => e.id === "data-raster")?.opacity).toBe(0.5);
    expect(formatSel(sel).search).toBe(loc.search);
  });

  it("a garbage layers= value clamps to the default (never throws)", () => {
    expect(() => parseSel({ search: "?layers=%%%not,a,valid,token%%%", hash: "" })).not.toThrow();
    expect(parseSel({ search: "?layers=", hash: "" }).layers).toBeUndefined();
  });

  it("an unknown key sitting next to layers= is ignored (this field's own clamping doesn't widen)", () => {
    const sel = parseSel({ search: "?layers=basemap-labels:h&bogus=1", hash: "" });
    expect(sel.layers?.find((e) => e.id === "basemap-labels")?.visible).toBe(false);
  });
});

describe("map: lon,lat,zoom[,bearing,pitch], default undefined (preset applies)", () => {
  it("parses a 3-field tuple", () => {
    expect(parseSel({ search: "?map=-122.4,37.8,6", hash: "" }).map).toEqual({
      lon: -122.4,
      lat: 37.8,
      zoom: 6,
    });
  });

  it("parses a 5-field tuple (bearing, pitch travel together)", () => {
    expect(parseSel({ search: "?map=-122.4,37.8,6,45,30", hash: "" }).map).toEqual({
      lon: -122.4,
      lat: 37.8,
      zoom: 6,
      bearing: 45,
      pitch: 30,
    });
  });

  it("clamps a wrong field count (4) to undefined — falls back to the area preset", () => {
    expect(parseSel({ search: "?map=-122.4,37.8,6,45", hash: "" }).map).toBeUndefined();
  });

  it("clamps a non-numeric field to undefined", () => {
    expect(parseSel({ search: "?map=abc,37.8,6", hash: "" }).map).toBeUndefined();
  });

  it("formatSel round-trips both tuple shapes", () => {
    expect(formatSel({ ...DEFAULT_SEL, map: { lon: -122.4, lat: 37.8, zoom: 6 } }).search).toBe(
      "?map=-122.4,37.8,6",
    );
    expect(
      formatSel({
        ...DEFAULT_SEL,
        map: { lon: -122.4, lat: 37.8, zoom: 6, bearing: 45, pitch: 30 },
      }).search,
    ).toBe("?map=-122.4,37.8,6,45,30");
  });
});

describe("hash: #pl and #t only, never mixed with the query (the seeded fault: hash copied into query)", () => {
  it("pl and t parse from the hash, not the query", () => {
    const sel = parseSel({ search: "", hash: "#pl=g1.a.b~z.pa.1&t=My%20Report" });
    expect(sel.pl).toBe("g1.a.b~z.pa.1");
    expect(sel.t).toBe("My Report");
  });

  it("pl/t in the QUERY position are ignored (they only ever live in the hash)", () => {
    const sel = parseSel({ search: "?pl=g1.a.b&t=Ignored", hash: "" });
    expect(sel.pl).toBeUndefined();
    expect(sel.t).toBeUndefined();
  });

  it("formatSel writes pl/t ONLY into the hash, never the search", () => {
    const { search, hash } = formatSel({ ...DEFAULT_SEL, pl: "g1.a.b", t: "Title" });
    expect(search).toBe("");
    expect(hash).toBe("#pl=g1.a.b&t=Title");
  });

  it("no other field is ever written into the hash", () => {
    const { hash } = formatSel({ ...DEFAULT_SEL, pal: "viridis", lens: "species", sp: "x" });
    expect(hash).toBe("");
  });

  it("`,`/`:` inside the place codec survive the hash un-escaped", () => {
    const pl = "z.pa.1,2,3";
    const { hash } = formatSel({ ...DEFAULT_SEL, pl });
    expect(hash).toBe(`#pl=${pl}`);
    expect(parseSel({ search: "", hash }).pl).toBe(pl);
  });
});

describe("readability: `,` and `:` are un-escaped in the emitted URL", () => {
  it("a comma-joined show list is not percent-encoded", () => {
    const { search } = formatSel({ ...DEFAULT_SEL, show: ["a", "b"] });
    expect(search).not.toContain("%2C");
    expect(search).toBe("?show=a,b");
  });

  it("a colon inside sel is not percent-encoded", () => {
    const { search } = formatSel({ ...DEFAULT_SEL, sel: "place:2" });
    expect(search).not.toContain("%3A");
    expect(search).toBe("?sel=place:2");
  });
});

describe("unknown keys are ignored; unknown values fall back to defaults", () => {
  it("an unrecognized query key is dropped silently, not surfaced as an error", () => {
    expect(() => parseSel({ search: "?wat=1&foo=bar", hash: "" })).not.toThrow();
    const sel = parseSel({ search: "?wat=1&pal=viridis", hash: "" });
    expect(sel.pal).toBe("viridis");
    expect((sel as unknown as Record<string, unknown>).wat).toBeUndefined();
  });

  it("an unrecognized value on a known enum key falls back to the default, not an error", () => {
    // U2a: the default is "dark", not "auto" -- see the "theme: tri-state" describe block above.
    expect(parseSel({ search: "?theme=neon", hash: "" }).theme).toBe("dark");
  });

  it("a formatted-then-reparsed Sel never carries an unknown key forward", () => {
    const sel = parseSel({ search: "?wat=1&pal=viridis", hash: "" });
    const { search } = formatSel(sel);
    expect(search).not.toContain("wat");
  });
});

describe("parsing never throws, even given a hostile loc", () => {
  it("a loc whose search/hash getters throw resolves to DEFAULT_SEL, not an exception", () => {
    const hostile: UrlLike = {
      get search(): string {
        throw new Error("boom");
      },
      hash: "",
    };
    expect(() => parseSel(hostile)).not.toThrow();
    expect(parseSel(hostile)).toEqual(DEFAULT_SEL);
  });

  it("null/undefined-ish search and hash values do not throw", () => {
    expect(() => parseSel({ search: undefined as unknown as string, hash: "" })).not.toThrow();
  });
});

describe("er_clr (legacy debug overlay): tolerated, never rewritten, never round-tripped", () => {
  it("does not error and does not get treated as a legacy sp trigger", () => {
    const sel = parseSel({ search: "?er_clr=1&pal=viridis", hash: "" });
    expect(sel.pal).toBe("viridis");
    expect(sel.sp).toBeUndefined();
  });

  it("does not survive a format round-trip (it is not part of Sel)", () => {
    const sel = parseSel({ search: "?er_clr=1", hash: "" });
    expect(formatSel(sel).search).toBe("");
  });
});

describe("an injected AliasLookup is honoured for the sp/in legacy rewrite", () => {
  it("resolves `in` from a legacy mdl_key via the injected lookup", () => {
    const alias: AliasLookup = {
      resolveInput: (rawKey) => (rawKey === "42" ? { in: "raw_ds_1" } : null),
    };
    const sel = parseSel({ search: "?mdl_key=42", hash: "" }, alias);
    expect(sel.sp).toBe("42");
    expect(sel.in).toBe("raw_ds_1");
  });

  it("with NO_ALIAS_LOOKUP (the default), sp carries through with no `in` resolved", () => {
    const sel = parseSel({ search: "?mdl_seq=99", hash: "" });
    expect(sel.sp).toBe("99");
    expect(sel.in).toBe("merged"); // default, unresolved
  });
});

describe("defaultLens is pure (used identically by parse and format)", () => {
  it("defaultLens", () => {
    expect(defaultLens(undefined)).toBe("collection");
    expect(defaultLens("x")).toBe("species");
  });
});

// "is this a deep link" -- must agree
// EXACTLY with formatSel's own "differs from default" rule (a hand-rolled second definition is
// exactly how the two could silently drift).
describe("hasViewState — 'is this a deep link' (a deep link must never be interrupted by a first-timer welcome)", () => {
  it("the bare default URL (no query, no hash) carries no view state", () => {
    expect(hasViewState(EMPTY)).toBe(false);
    expect(hasViewState({ search: "", hash: "" })).toBe(false);
  });

  it("a species deep link carries view state", () => {
    expect(hasViewState({ search: "?lens=species&sp=54241", hash: "" })).toBe(true);
  });

  it("a place selection carries view state", () => {
    expect(hasViewState({ search: "?sel=place:1", hash: "" })).toBe(true);
  });

  it("a places hash alone (no query) carries view state", () => {
    expect(hasViewState({ search: "", hash: "#pl=z.pa.GAA" })).toBe(true);
  });

  it("?tour=off alone already counts as view state (tour differs from its default)", () => {
    expect(hasViewState({ search: "?tour=off", hash: "" })).toBe(true);
  });

  it("an unrecognized/malformed query string still resolves to false, never throws", () => {
    expect(() => hasViewState({ search: "?bogus=xyz&also=nope", hash: "" })).not.toThrow();
    expect(hasViewState({ search: "?bogus=xyz&also=nope", hash: "" })).toBe(false);
  });
});
