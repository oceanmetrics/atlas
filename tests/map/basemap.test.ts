// One fixture per rule (CLAUDE.md "Testing pyramid"): the theme -> CARTO style URL table,
// `loadBasemapStyle()`'s cache/fallback behaviour, and the drift guard tying the WebGL background
// to the CSS token the page paints behind it.
//
// CARTO's RASTER basemap (`dark_all`/`light_all`, `{z}/{x}/{y}.png`) now answers with an "API KEY
// REQUIRED" watermark (owner report, 2026-09-23) -- this file's own history is the raster version
// of these tests; `tests/map/no-raster-basemap.test.ts` is the permanent regression guard that
// those literals never come back.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { instanceTokensJson } from "../../scripts/instance.mjs";
import {
  CARTO_STYLE_BASE,
  EMPTY_BASEMAP_STYLE,
  GLYPHS_URL,
  MAP_BACKGROUND_BY_THEME,
  basemapForTheme,
  getCachedBasemapStyle,
  loadBasemapStyle,
  resetBasemapStyleCacheForTests,
  warmBasemapStyles,
  type BasemapStyleResponseLike,
  type CartoStyleLike,
} from "../../src/lib/map/layers/basemap";

const tokens = JSON.parse(readFileSync(instanceTokensJson(), "utf8")) as Record<
  "navy" | "paper",
  Record<string, string>
>;

beforeEach(() => {
  resetBasemapStyleCacheForTests();
});

describe("basemapForTheme (spec.md §3: navy → dark-matter, paper → positron)", () => {
  it("navy is CARTO's dark-matter GL style", () => {
    expect(basemapForTheme("navy").url).toBe(`${CARTO_STYLE_BASE}/dark-matter-gl-style/style.json`);
  });

  it("paper is CARTO's positron GL style", () => {
    expect(basemapForTheme("paper").url).toBe(`${CARTO_STYLE_BASE}/positron-gl-style/style.json`);
  });

  it("is an absolute https URL with an attribution string (no key, no raster endpoint)", () => {
    const b = basemapForTheme("navy");
    expect(b.attribution).toContain("OpenStreetMap");
    expect(b.attribution).toContain("CARTO");
    // plan D2 / CLAUDE.md "Relative base": a data or tile URL is never relative to the mount point.
    expect(b.url.startsWith("https://")).toBe(true);
  });

  it("the glyph endpoint is absolute and carries MapLibre's own placeholders", () => {
    expect(GLYPHS_URL).toMatch(/^https:\/\//);
    expect(GLYPHS_URL).toContain("{fontstack}");
    expect(GLYPHS_URL).toContain("{range}");
  });
});

function fakeStyle(): unknown {
  return {
    sources: { carto: { type: "vector", url: "https://tiles.example/tiles.json" } },
    sprite: "https://tiles.example/sprite",
    glyphs: GLYPHS_URL,
    layers: [{ id: "background", type: "background", paint: { "background-color": "#000" } }],
  };
}

function okResponse(body: unknown): BasemapStyleResponseLike {
  return { ok: true, json: () => Promise.resolve(body) } as BasemapStyleResponseLike;
}

describe("loadBasemapStyle", () => {
  it("fetches basemapForTheme(theme)'s URL and returns the parsed style", async () => {
    const fetchStyle = vi.fn().mockResolvedValue(okResponse(fakeStyle()));
    const style = await loadBasemapStyle("navy", fetchStyle);
    expect(fetchStyle).toHaveBeenCalledWith(basemapForTheme("navy").url);
    expect(style).toEqual(fakeStyle());
  });

  it("caches per theme: a second call for the SAME theme never fetches again", async () => {
    const fetchStyle = vi.fn().mockResolvedValue(okResponse(fakeStyle()));
    await loadBasemapStyle("navy", fetchStyle);
    await loadBasemapStyle("navy", fetchStyle);
    expect(fetchStyle).toHaveBeenCalledTimes(1);
  });

  it("concurrent calls for the same theme share one in-flight fetch", async () => {
    let resolveFetch: (v: BasemapStyleResponseLike) => void = () => {};
    const fetchStyle = vi.fn(
      () =>
        new Promise<BasemapStyleResponseLike>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const p1 = loadBasemapStyle("paper", fetchStyle);
    const p2 = loadBasemapStyle("paper", fetchStyle);
    resolveFetch(okResponse(fakeStyle()));
    await Promise.all([p1, p2]);
    expect(fetchStyle).toHaveBeenCalledTimes(1);
  });

  it("a different theme is fetched separately (independent caches)", async () => {
    const fetchStyle = vi.fn().mockResolvedValue(okResponse(fakeStyle()));
    await loadBasemapStyle("navy", fetchStyle);
    await loadBasemapStyle("paper", fetchStyle);
    expect(fetchStyle).toHaveBeenCalledTimes(2);
  });

  it("a non-ok response resolves to EMPTY_BASEMAP_STYLE, never throws", async () => {
    const fetchStyle = vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) });
    const style = await loadBasemapStyle("navy", fetchStyle);
    expect(style).toEqual(EMPTY_BASEMAP_STYLE);
  });

  it("a network error (rejected fetch) resolves to EMPTY_BASEMAP_STYLE, never throws", async () => {
    const fetchStyle = vi.fn().mockRejectedValue(new Error("offline"));
    const style = await loadBasemapStyle("navy", fetchStyle);
    expect(style).toEqual(EMPTY_BASEMAP_STYLE);
  });

  it("unparsable JSON resolves to EMPTY_BASEMAP_STYLE, never throws", async () => {
    const fetchStyle = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new SyntaxError("bad json")),
    });
    const style = await loadBasemapStyle("navy", fetchStyle);
    expect(style).toEqual(EMPTY_BASEMAP_STYLE);
  });

  it("a failed fetch is NOT cached — a later call may retry and succeed", async () => {
    const fetchStyle = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({}) })
      .mockResolvedValueOnce(okResponse(fakeStyle()));
    const first = await loadBasemapStyle("navy", fetchStyle);
    expect(first).toEqual(EMPTY_BASEMAP_STYLE);
    const second = await loadBasemapStyle("navy", fetchStyle);
    expect(second).toEqual(fakeStyle());
    expect(fetchStyle).toHaveBeenCalledTimes(2);
  });
});

describe("getCachedBasemapStyle (the SYNCHRONOUS read composeStyle() uses)", () => {
  it("EMPTY_BASEMAP_STYLE before loadBasemapStyle() ever resolves for a theme", () => {
    expect(getCachedBasemapStyle("navy")).toEqual(EMPTY_BASEMAP_STYLE);
  });

  it("the real style once loadBasemapStyle() has resolved", async () => {
    await loadBasemapStyle("navy", () => Promise.resolve(okResponse(fakeStyle())));
    expect(getCachedBasemapStyle("navy")).toEqual(fakeStyle());
  });

  it("a different (still-cold) theme stays EMPTY_BASEMAP_STYLE", async () => {
    await loadBasemapStyle("navy", () => Promise.resolve(okResponse(fakeStyle())));
    expect(getCachedBasemapStyle("paper")).toEqual(EMPTY_BASEMAP_STYLE);
  });

  it("a failed fetch leaves the cache EMPTY_BASEMAP_STYLE (never a stale partial style)", async () => {
    await loadBasemapStyle("navy", () => Promise.reject(new Error("offline")));
    expect(getCachedBasemapStyle("navy")).toEqual(EMPTY_BASEMAP_STYLE);
  });
});

// 0.10.20: the invalidation half of the "basemap silently never paints" fix. `composeStyle()` is
// synchronous and takes the resolved CARTO style as an input; before this, nothing told the caller
// when that input had changed, so a style.json landing after the last reactive recompose was never
// read again and the basemap never appeared at all (measured on Firefox under load, and
// deterministically with the style.json delayed 3 s: ocean pixel `247,171,122` -- the raster over
// the flat `--surface-map` colour -- with zero `basemap-` layers in `getStyle()`).
describe("warmBasemapStyles (0.10.20: the caller is TOLD when a theme's style lands)", () => {
  it("reports each requested theme exactly once, with its resolved style", async () => {
    const seen: Array<[string, unknown]> = [];
    const styles: Record<"navy" | "paper", CartoStyleLike> = {
      navy: { sources: {}, layers: [{ id: "dark", type: "background" }] },
      paper: { sources: {}, layers: [{ id: "light", type: "background" }] },
    };
    warmBasemapStyles(
      ["navy", "paper"],
      (t, s) => seen.push([t, s]),
      (t) => Promise.resolve(styles[t]),
    );
    await vi.waitFor(() => expect(seen).toHaveLength(2));
    expect(Object.fromEntries(seen)).toEqual(styles);
  });

  it("REGRESSION: a REJECTED load still reports, with EMPTY_BASEMAP_STYLE", async () => {
    // the caller keys reactive state on "has this theme reported in" -- a theme that never reports
    // would leave the effect waiting forever, which is the failure mode this whole fix is about.
    // `loadBasemapStyle` resolves rather than rejects, but this helper must not depend on that.
    const seen: Array<[string, unknown]> = [];
    warmBasemapStyles(
      ["navy"],
      (t, s) => seen.push([t, s]),
      () => Promise.reject(new Error("offline")),
    );
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toEqual(["navy", EMPTY_BASEMAP_STYLE]);
  });

  it("defaults to loadBasemapStyle, so a warmed theme is also in the synchronous cache", async () => {
    const seen: string[] = [];
    // the real default path, with `loadBasemapStyle`'s own injectable fetch left alone: no global
    // fetch in this environment, so it takes the catch branch -- what matters here is that the
    // default argument is wired at all and still reports.
    warmBasemapStyles(["paper"], (t) => seen.push(t));
    await vi.waitFor(() => expect(seen).toEqual(["paper"]));
  });
});

describe("the map background equals the --surface-map token (drift guard)", () => {
  // a style is not CSS and cannot read a custom property, so the value is duplicated by necessity
  // — this is the gate that keeps the duplicate honest, in both themes, and is also the FALLBACK
  // colour painted when loadBasemapStyle()'s fetch fails (EMPTY_BASEMAP_STYLE has no layers).
  it.each(["navy", "paper"] as const)("%s", (theme) => {
    expect(MAP_BACKGROUND_BY_THEME[theme]).toBe(tokens[theme]["--surface-map"].toLowerCase());
  });
});
