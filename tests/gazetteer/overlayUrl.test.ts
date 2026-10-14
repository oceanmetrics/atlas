import { describe, expect, it } from "vitest";
import {
  DEFAULT_OVERLAYS,
  effectiveOv,
  formatOv,
  parseFilter,
  parseOv,
  toggledOv,
} from "../../src/lib/gazetteer/overlayUrl";
import { formatSel, parseSel } from "../../src/lib/state/codec";

const loc = (search: string) => ({ search, hash: "" });

describe("?ov= (overlay set) grammar", () => {
  it("the default set is empty (2026-10-15: no overlay on by default)", () => {
    expect([...DEFAULT_OVERLAYS]).toEqual([]);
  });
  it("absent key = default (undefined) = none; the default set is never written", () => {
    expect(parseOv(null)).toBeUndefined();
    expect(effectiveOv(undefined)).toEqual(DEFAULT_OVERLAYS);
    expect(formatOv(undefined)).toBeNull();
    expect(formatOv([])).toBeNull(); // none IS the default now, so it is not written either
  });
  it("present and empty (`ov=`) reads as none and collapses to the default on write", () => {
    expect(parseOv("")).toEqual([]);
    expect(formatOv(parseOv(""))).toBeNull();
  });
  it("a list round-trips in order; duplicates and malformed slugs are dropped", () => {
    expect(parseOv("a_b,c-d")).toEqual(["a_b", "c-d"]);
    expect(parseOv("a,a, b ,Bad Slug,../x,,UPPER")).toEqual(["a", "b"]);
    expect(formatOv(["x", "y"])).toBe("x,y");
  });
  it("toggling: on adds, off removes, and returning to the (empty) default collapses to undefined", () => {
    expect(toggledOv(undefined, "mpa_inventory", true)).toEqual(["mpa_inventory"]);
    expect(toggledOv(["noaa_sanctuaries", "mpa_inventory"], "noaa_sanctuaries", false)).toEqual([
      "mpa_inventory",
    ]);
    expect(toggledOv(["a"], "a", true)).toEqual(["a"]); // already on: no change
    expect(toggledOv(["a"], "a", false)).toBeUndefined(); // back to the default set
    expect(toggledOv(undefined, "a", false)).toBeUndefined(); // off when already off
  });
  it("?filter=places is the only filter value", () => {
    expect(parseFilter("places")).toBe("places");
    expect(parseFilter("everything")).toBeUndefined();
    expect(parseFilter(null)).toBeUndefined();
  });
});

describe("URL round trip through the Sel codec", () => {
  it("the default view writes neither ov nor filter", () => {
    const sel = parseSel(loc(""));
    expect(sel.ov).toBeUndefined();
    expect(sel.filter).toBeUndefined();
    expect(formatSel(sel).search).toBe("");
  });
  it("?ov=a,b round-trips verbatim (commas stay readable)", () => {
    const sel = parseSel(loc("?ov=noaa_sanctuaries,mpa_inventory"));
    expect(sel.ov).toEqual(["noaa_sanctuaries", "mpa_inventory"]);
    expect(formatSel(sel).search).toBe("?ov=noaa_sanctuaries,mpa_inventory");
  });
  it("?ov= (none) reads as none and writes nothing, because none is the default", () => {
    const sel = parseSel(loc("?ov="));
    expect(sel.ov).toEqual([]);
    expect(formatSel(sel).search).toBe("");
  });
  it("an old link with the former default pair stays an explicit pair (it is no longer the default)", () => {
    const sel = parseSel(loc("?ov=boem_wind_leases,noaa_sanctuaries"));
    expect(formatSel(sel).search).toBe("?ov=boem_wind_leases,noaa_sanctuaries");
  });
  it("?filter=places round-trips; any other value is ignored", () => {
    const sel = parseSel(loc("?filter=places&ov=x"));
    expect(sel.filter).toBe("places");
    expect(formatSel(sel).search).toBe("?ov=x&filter=places");
    expect(parseSel(loc("?filter=nope")).filter).toBeUndefined();
  });
});
