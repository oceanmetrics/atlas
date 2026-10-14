import { describe, expect, it } from "vitest";
import { formatSel, parseSel } from "../../src/lib/state/codec";
import { DEFAULT_SEL, defaultLens } from "../../src/lib/state/types";

const parse = (search: string) => parseSel({ search, hash: "" });

describe("?c=aquamaps_native&sp=<sp_key>&rep=native|005 round-trips", () => {
  it("c and sp survive, and with a c the link opens the Collections lens", () => {
    const sel = parse("?c=aquamaps_native&sp=Rep-3437");
    expect(sel).toMatchObject({ c: "aquamaps_native", sp: "Rep-3437", rep: "native" });
    expect(sel.lens).toBe("collection");
    expect(defaultLens("Rep-3437", "aquamaps_native")).toBe("collection");
    expect(parse(formatSel(sel).search)).toEqual(sel);
  });
  it("rep=005 round-trips; native (the default) is never written", () => {
    const sel = parse("?c=aquamaps_native&sp=Fis-49220&rep=005");
    expect(sel.rep).toBe("005");
    const out = formatSel(sel).search;
    expect(new URLSearchParams(out).get("rep")).toBe("005");
    expect(parse(out)).toEqual(sel);
    expect(formatSel({ ...sel, rep: "native" }).search).not.toContain("rep=");
    expect(formatSel(DEFAULT_SEL).search).toBe("");
  });
  it("an unknown rep clamps to native", () => {
    expect(parse("?c=aquamaps_native&sp=Rep-3437&rep=0.05").rep).toBe("native");
  });
  it("SeaLifeBase and WoRMS-style keys with a dash survive untouched", () => {
    for (const key of ["SLB-64971", "W-Por-134241", "Fis-49220"]) {
      const sel = parse(`?c=aquamaps_native&sp=${key}`);
      expect(sel.sp).toBe(key);
      expect(parse(formatSel(sel).search).sp).toBe(key);
    }
  });
});
