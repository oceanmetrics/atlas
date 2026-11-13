// `cov=` / `covf=`: which of a collection's own overlays are on, and "Only features matching the selected
// layer" (src/lib/state/codec.ts, src/lib/gazetteer/overlayUrl.ts). Absent is the collection's defaults,
// `cov=` (present, empty) is none, a list is those; unknown ids are the lens' to ignore, malformed ones are
// dropped here, nothing throws. An instance without the Collections lens neither reads nor writes them.
import { describe, expect, it } from "vitest";
import { formatSel, parseSel } from "../../src/lib/state/codec";
import { formatCov, parseCov } from "../../src/lib/gazetteer/overlayUrl";
import { COLLECTION_KEYS, DEFAULT_SEL, type Sel } from "../../src/lib/state/types";

const url = (search: string) => ({ search, hash: "" });
const roundTrip = (sel: Sel) => parseSel(formatSel(sel));

describe("parseCov / formatCov", () => {
  it("absent is undefined (the defaults); empty is none; a list keeps its ids once", () => {
    expect(parseCov(null)).toBeUndefined();
    expect(parseCov("")).toEqual([]);
    expect(parseCov("sightings_vessel,effort_vessel,sightings_vessel")).toEqual([
      "sightings_vessel",
      "effort_vessel",
    ]);
  });
  it("drops a malformed id, never throws", () => {
    expect(parseCov(" ok , <x>,,a b,.dot,v2.1-a ")).toEqual(["ok", "v2.1-a"]);
  });
  it("writes nothing for undefined, an empty value for none, the ids otherwise", () => {
    expect(formatCov(undefined)).toBeNull();
    expect(formatCov([])).toBe("");
    expect(formatCov(["a", "b"])).toBe("a,b");
  });
});

describe.runIf(COLLECTION_KEYS)(
  "the codec: cov / covf (an instance with the Collections lens)",
  () => {
    it("round-trips absent, empty and a list as three different things", () => {
      expect(roundTrip({ ...DEFAULT_SEL }).cov).toBeUndefined();
      expect(roundTrip({ ...DEFAULT_SEL, cov: [] }).cov).toEqual([]);
      expect(roundTrip({ ...DEFAULT_SEL, cov: ["sightings_vessel", "effort_vessel"] }).cov).toEqual(
        ["sightings_vessel", "effort_vessel"],
      );
    });
    it("writes `cov=` for none and nothing for the defaults", () => {
      expect(formatSel({ ...DEFAULT_SEL }).search).not.toContain("cov");
      expect(new URLSearchParams(formatSel({ ...DEFAULT_SEL, cov: [] }).search).get("cov")).toBe(
        "",
      );
      expect(formatSel({ ...DEFAULT_SEL, cov: ["a", "b"] }).search).toContain("cov=a,b");
    });
    it("covf=1 is the only 'on'; it round-trips; anything else is off", () => {
      expect(formatSel({ ...DEFAULT_SEL, covf: true }).search).toContain("covf=1");
      expect(roundTrip({ ...DEFAULT_SEL, covf: true }).covf).toBe(true);
      expect(parseSel(url("?covf=1")).covf).toBe(true);
      for (const v of ["0", "true", "yes", ""])
        expect(parseSel(url(`?covf=${v}`)).covf).toBeUndefined();
      expect(parseSel(url("")).covf).toBeUndefined();
    });
    it("an unknown id survives the codec (the lens ignores it), a malformed one does not", () => {
      expect(parseSel(url("?cov=retired_layer,<b>,sightings_vessel")).cov).toEqual([
        "retired_layer",
        "sightings_vessel",
      ]);
    });
    it("travels with ?collection= and the view's other keys", () => {
      const share = "https://data.test/atlas-restricted/abc/sefsc_gomx/collection.json";
      const sel = parseSel(
        url(`?collection=${encodeURIComponent(share)}&c=sefsc_gomx&cov=effort_vessel&covf=1`),
      );
      expect(sel).toMatchObject({
        collection: share,
        c: "sefsc_gomx",
        cov: ["effort_vessel"],
        covf: true,
      });
    });
  },
);

describe.runIf(!COLLECTION_KEYS)(
  "the codec: cov / covf (an instance without the Collections lens)",
  () => {
    it("are neither read nor written", () => {
      expect(parseSel(url("?cov=a,b&covf=1"))).toMatchObject({ cov: undefined, covf: undefined });
      const { search } = formatSel({ ...DEFAULT_SEL, cov: ["a"], covf: true });
      expect(search).not.toContain("cov");
    });
  },
);
