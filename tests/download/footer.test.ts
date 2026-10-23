import { describe, expect, it } from "vitest";
import { BRAND_NAME } from "../../src/lib/brand/instance";
import {
  canonicalShareUrl,
  fitsWidth,
  footerLines,
  titleWithUnit,
} from "../../src/lib/download/footer";

describe("canonicalShareUrl", () => {
  it("keeps the ABSOLUTE URL (D3 fix: never origin-stripped -- a relative link is useless off-site)", () => {
    expect(canonicalShareUrl("https://marinesensitivity.org/atlas/?lens=species&sp=Fis-1")).toBe(
      "https://marinesensitivity.org/atlas/?lens=species&sp=Fis-1",
    );
  });

  it("drops `theme` (a per-viewer preference, not part of the shared view)", () => {
    expect(canonicalShareUrl("https://marinesensitivity.org/atlas/?ver=v7&theme=dark#pl=x")).toBe(
      "https://marinesensitivity.org/atlas/?ver=v7#pl=x",
    );
  });

  it("keeps every other query param, in order, when theme is not present", () => {
    expect(canonicalShareUrl("https://x/atlas/?ver=v9&lens=species")).toBe(
      "https://x/atlas/?ver=v9&lens=species",
    );
  });

  it("drops a bare `?theme=...` query entirely, not a trailing `?`", () => {
    expect(canonicalShareUrl("https://x/atlas/?theme=light")).toBe("https://x/atlas/");
  });

  it("handles http too", () => {
    expect(canonicalShareUrl("http://localhost:4331/atlas/?theme=dark#h1")).toBe(
      "http://localhost:4331/atlas/#h1",
    );
  });

  it("returns a malformed/relative URL unchanged, never throws", () => {
    expect(canonicalShareUrl("/atlas/?ver=v9")).toBe("/atlas/?ver=v9");
  });
});

describe("fitsWidth", () => {
  it("fits when the measured width is within the max", () => {
    expect(fitsWidth("short", () => 40, 100)).toBe(true);
  });

  it("does not fit when the measured width exceeds the max", () => {
    expect(fitsWidth("a very long description indeed", () => 400, 100)).toBe(false);
  });

  it("fits exactly at the boundary", () => {
    expect(fitsWidth("x", () => 100, 100)).toBe(true);
  });
});

describe("titleWithUnit", () => {
  it('BUG: "score" title + "score" unit does not repeat (R3-rr fix 2 — the live default Scores layer)', () => {
    expect(titleWithUnit("score", "score")).toBe("score");
  });

  it("case-insensitive, trimmed: differing case/whitespace still counts as the same word", () => {
    expect(titleWithUnit("Score", "score")).toBe("Score");
    expect(titleWithUnit("Score", "  Score  ")).toBe("Score");
  });

  it("a species title + a distinct unit still joins, unaffected", () => {
    expect(titleWithUnit("Odobenus rosmarus", "suitability")).toBe(
      "Odobenus rosmarus · suitability",
    );
  });

  it("no unit at all: the bare title, unaffected", () => {
    expect(titleWithUnit("Walrus", undefined)).toBe("Walrus");
  });
});

describe("footerLines", () => {
  it("BUG: the default Scores layer's title+unit ('score'/'score') collapses to one word, not 'score · score' (R3-rr fix 2)", () => {
    const [l1] = footerLines({
      title: "score",
      unit: "score",
      ver: "v9",
      url: "https://x/atlas/",
    });
    expect(l1).toBe("score");
  });

  it("puts the title+unit on line 1 and the app/version/canonical-url on the LAST line (2 lines, no description)", () => {
    const lines = footerLines({
      title: "Richness",
      unit: "species",
      ver: "v9",
      url: "https://oceanmetrics.io/atlas/?lens=collection&theme=dark",
    });
    expect(lines).toEqual([
      "Richness · species",
      `${BRAND_NAME} · v9 · https://oceanmetrics.io/atlas/?lens=collection`,
    ]);
  });

  it("omits the release segment entirely when there is no release (a collection)", () => {
    const lines = footerLines({ title: "Richness", ver: null, url: "https://x/atlas/" });
    expect(lines).toEqual(["Richness", `${BRAND_NAME} · https://x/atlas/`]);
  });

  it("omits the unit separator when unit is absent", () => {
    const [l1] = footerLines({ title: "Walrus", ver: "v9", url: "https://x/y" });
    expect(l1).toBe("Walrus");
  });

  it("inserts the description as its own middle line when present (3 lines)", () => {
    const lines = footerLines({
      title: "Sensitivity",
      unit: "score",
      ver: "v9",
      url: "https://x/atlas/",
      description:
        "Combined score of extinction risk per species category and primary productivity",
    });
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("Sensitivity · score");
    expect(lines[1]).toBe(
      "Combined score of extinction risk per species category and primary productivity",
    );
    expect(lines[2]).toBe(`${BRAND_NAME} · v9 · https://x/atlas/`);
  });

  it("omits the description line when null/undefined (2 lines)", () => {
    const lines = footerLines({
      title: "Walrus",
      ver: "v9",
      url: "https://x/y",
      description: null,
    });
    expect(lines).toHaveLength(2);
  });
});
