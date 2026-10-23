// The About dialog's release and app lines (src/shell/aboutRelease.ts): the release with its status
// and date as ONE string (MarineSensitivity/atlas UI-16: a separator at a Svelte block boundary lost
// its space, "v7· 2026-06-12"), and the code + instance line the thin repo's first publish is checked by.
import { describe, expect, it } from "vitest";
import { appLine, releaseLine } from "../../src/shell/aboutRelease";

describe("releaseLine", () => {
  const base = { ver: "v7", restricted: false, status: "released", released: "2026-06-12" };

  it("a released version: the version and its date, the plain status left out", () => {
    expect(releaseLine(base)).toBe("v7 · 2026-06-12");
  });

  it("any other status is named between them", () => {
    expect(releaseLine({ ...base, ver: "v9", status: "draft", released: "2026-10-01" })).toBe(
      "v9 · draft · 2026-10-01",
    );
  });

  it("an unresolved release reads as a dash, never 'null'", () => {
    expect(releaseLine({ ver: null, restricted: true, status: null, released: null })).toBe("—");
  });

  it("SEEDED FAULT: a separator built at a block boundary (no leading space) is not this", () => {
    const naive = (r: typeof base) => `${r.ver}${r.released ? `· ${r.released}` : ""}`;
    expect(naive(base)).not.toBe(releaseLine(base));
  });
});

describe("appLine", () => {
  it("names the code's repository, its version and the instance", () => {
    expect(appLine("oceanmetrics/atlas", "0.5.0", "marinesensitivity")).toBe(
      "oceanmetrics/atlas 0.5.0 · instance marinesensitivity",
    );
  });
});
