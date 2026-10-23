// R3-W8 item 3: the `ui=` token's parse/format core. See src/shell/uiState.ts's own header for
// what it carries and why it is a SEPARATE token from Sel's own query keys. R4-B (2026-09-30) bumped
// it to version 4: four tools (details added), side left|right only, no `tab` field, no bottom dock,
// no maximized. Versions 1-3 stay readable, with `tab=info` -> tool `details` and dock `bottom` ->
// side `left`.
import { describe, expect, it } from "vitest";
import { PANEL_SIZE_MAX, PANEL_SIZE_MIN } from "../../src/lib/ui/panelGeometry";
import { formatUi, parseUi, UI_TOKEN_VERSION, type UiState } from "../../src/shell/uiState";

const FULL: UiState = {
  tool: "table",
  dock: "left",
  size: 420,
  detent: "full",
  expandedRow: "data-zones",
};

describe("formatUi / parseUi: round trip (v4)", () => {
  it("round-trips every tool, including details", () => {
    for (const tool of ["layers", "details", "table", "report"] as const) {
      expect(parseUi(formatUi({ ...FULL, tool }))).toEqual({ ...FULL, tool });
    }
  });

  it("round-trips both sides", () => {
    for (const dock of ["left", "right"] as const) {
      expect(parseUi(formatUi({ ...FULL, dock }))).toEqual({ ...FULL, dock });
    }
  });

  it("round-trips every detent", () => {
    for (const detent of ["peek", "half", "full"] as const) {
      expect(parseUi(formatUi({ ...FULL, detent }))).toEqual({ ...FULL, detent });
    }
  });

  it("round-trips every expandedRow, including null (neither row expanded)", () => {
    for (const expandedRow of ["data-raster", "data-zones", null] as const) {
      expect(parseUi(formatUi({ ...FULL, expandedRow }))).toEqual({ ...FULL, expandedRow });
    }
  });

  // R4-D: the report-tab field is retired; a fresh token has 6 fields and carries none.
  it("a fresh v4 token has six fields and no report-tab field", () => {
    expect(formatUi(FULL)).toBe("4.t.l.420.f.z");
    expect(formatUi(FULL).split(".")).toHaveLength(6);
  });

  it("a pre-R4-D v4 token (seven fields) still parses; its report-tab field is ignored", () => {
    expect(parseUi("4.r.l.420.f.z.2")).toEqual({ ...FULL, tool: "report" });
    expect(parseUi("4.r.l.420.f.z.anything")).toEqual({ ...FULL, tool: "report" });
  });

  it("round-trips the panel size boundaries", () => {
    expect(parseUi(formatUi({ ...FULL, size: PANEL_SIZE_MIN }))?.size).toBe(PANEL_SIZE_MIN);
    expect(parseUi(formatUi({ ...FULL, size: PANEL_SIZE_MAX }))?.size).toBe(PANEL_SIZE_MAX);
  });

  it("the token starts with version 4 and has 6 dot-separated fields (no tab fields)", () => {
    const token = formatUi(FULL);
    expect(UI_TOKEN_VERSION).toBe("4");
    expect(token.startsWith("4.")).toBe(true);
    expect(token.split(".")).toHaveLength(6);
  });

  it("the tool field is the one that carries Details (regression: ui-token-tab-dropped)", () => {
    expect(formatUi({ ...FULL, tool: "details" }).split(".")[1]).toBe("d");
    expect(parseUi("4.d.l.380.h.d")?.tool).toBe("details");
  });
});

describe("parseUi: unknown/malformed input is ignored entirely (never a partial apply)", () => {
  it("null/undefined is absent", () => {
    expect(parseUi(null)).toBeNull();
    expect(parseUi(undefined)).toBeNull();
  });

  it("a wrong version is rejected whole", () => {
    expect(parseUi("5.l.r.380.h.d.1")).toBeNull();
  });

  it("a wrong field count is rejected whole (v4 is 6 fields, or 7 from before R4-D)", () => {
    expect(parseUi("4.l.r.380.h")).toBeNull();
    expect(parseUi("4.l.r.380.h.d.1.x.y")).toBeNull();
  });

  it("a bottom dock is not a v4 side", () => {
    expect(parseUi("4.l.b.380.h.d")).toBeNull();
  });

  it("an unrecognized tool/side/detent code is rejected whole", () => {
    expect(parseUi("4.x.r.380.h.d")).toBeNull();
    expect(parseUi("4.l.x.380.h.d")).toBeNull();
    expect(parseUi("4.l.r.380.x.d")).toBeNull();
  });

  it("an unrecognized expandedRow code is rejected whole", () => {
    expect(parseUi("4.l.r.380.h.x")).toBeNull();
  });

  it("a non-numeric or out-of-range size is rejected whole", () => {
    expect(parseUi("4.l.r.bogus.h.d")).toBeNull();
    expect(parseUi("4.l.r.-10.h.d")).toBeNull();
    expect(parseUi(`4.l.r.${PANEL_SIZE_MIN - 1}.h.d`)).toBeNull();
    expect(parseUi(`4.l.r.${PANEL_SIZE_MAX + 1}.h.d`)).toBeNull();
  });

  it("garbage input entirely is rejected", () => {
    expect(parseUi("not-a-token-at-all")).toBeNull();
    expect(parseUi("")).toBeNull();
  });
});

describe("formatUi: size is clamped, never emitted out of range", () => {
  it("clamps a too-small or too-large size before formatting", () => {
    expect(parseUi(formatUi({ ...FULL, size: 1 }))?.size).toBe(PANEL_SIZE_MIN);
    expect(parseUi(formatUi({ ...FULL, size: 99999 }))?.size).toBe(PANEL_SIZE_MAX);
  });
});

const BASE = { size: 380, detent: "half", expandedRow: "data-raster" } as const;

describe("parseUi: version-3 backward compatibility (R4-B mapping)", () => {
  it("tab=info on the layers tool opens Details", () => {
    expect(parseUi("3.l.r.380.h.d.i.1")).toEqual({
      ...BASE,
      tool: "details",
      dock: "right",
    });
  });

  it("tab=layers on the layers tool stays Layers", () => {
    expect(parseUi("3.l.r.380.h.d.l.1")?.tool).toBe("layers");
  });

  it("tab=info on another tool does not change that tool", () => {
    expect(parseUi("3.t.r.380.h.d.i.1")?.tool).toBe("table");
    expect(parseUi("3.r.r.380.h.d.i.2")).toMatchObject({ tool: "report" });
    expect(parseUi("3.r.r.380.h.d.i.2")).not.toHaveProperty("reportTab");
  });

  it("a bottom dock maps to the left side", () => {
    expect(parseUi("3.l.b.380.h.d.l.1")?.dock).toBe("left");
  });

  it("a v3 token still needs exactly 8 fields and valid codes", () => {
    expect(parseUi("3.l.r.380.h.d.l")).toBeNull();
    expect(parseUi("3.l.r.380.h.d.l.1.x")).toBeNull();
    expect(parseUi("3.x.r.380.h.d.l.1")).toBeNull();
    expect(parseUi("3.l.x.380.h.d.l.1")).toBeNull();
    expect(parseUi("3.l.r.380.h.d.x.1")).toBeNull();
    expect(parseUi("3.l.r.380.h.d.l.x")).toMatchObject({ tool: "layers" }); // report-tab ignored (R4-D)
    expect(parseUi("3.l.r.bogus.h.d.l.1")).toBeNull();
  });
});

// R3-W8 item 4: "an old `?tool=flower` ... must still open the Layers pane on the Flower tab" --
// (now: the Details tool) the retired rail tool's own version-1 token shape (6 fields, tool code "f").
describe("parseUi: version-1 backward compatibility (the retired 'flower' rail tool)", () => {
  it("a v1 token naming the old 'flower' tool code opens Details", () => {
    expect(parseUi("1.f.r.380.h.d")).toEqual({
      ...BASE,
      tool: "details",
      dock: "right",
    });
  });

  it("a v1 token naming the old 'places' tool code opens Report on the places tab", () => {
    expect(parseUi("1.p.r.380.h.d")).toEqual({
      ...BASE,
      tool: "report",
      dock: "right",
    });
  });

  it("a v1 token naming any OTHER (still-current) tool maps straight across", () => {
    for (const [code, tool] of [
      ["l", "layers"],
      ["t", "table"],
      ["r", "report"],
    ] as const) {
      expect(parseUi(`1.${code}.r.380.h.n`)).toEqual({
        ...BASE,
        expandedRow: null,
        tool,
        dock: "right",
      });
    }
  });

  it("a v1 bottom dock maps to the left side", () => {
    expect(parseUi("1.l.b.380.h.d")?.dock).toBe("left");
  });

  it("a v1 token still needs exactly 6 fields and valid dock/detent/row codes", () => {
    expect(parseUi("1.f.r.380.h")).toBeNull();
    expect(parseUi("1.f.r.380.h.d.x")).toBeNull();
    expect(parseUi("1.f.x.380.h.d")).toBeNull();
    expect(parseUi("1.f.r.380.x.d")).toBeNull();
    expect(parseUi("1.f.r.380.h.x")).toBeNull();
    expect(parseUi("1.f.r.bogus.h.d")).toBeNull();
  });
});

describe("parseUi: version-2 backward compatibility (the retired 'places' rail tool)", () => {
  it("a v2 token naming the old 'places' tool code opens Report on the places tab", () => {
    expect(parseUi("2.p.r.380.h.d.i")).toEqual({
      ...BASE,
      tool: "report",
      dock: "right",
    });
  });

  it("a v2 layers token with tab=info opens Details; with tab=layers stays Layers", () => {
    expect(parseUi("2.l.r.380.h.d.i")?.tool).toBe("details");
    expect(parseUi("2.l.r.380.h.d.l")?.tool).toBe("layers");
  });

  it("a v2 token naming any OTHER (still-current) tool maps straight across", () => {
    for (const [code, tool] of [
      ["t", "table"],
      ["r", "report"],
    ] as const) {
      expect(parseUi(`2.${code}.r.380.h.n.l`)).toEqual({
        ...BASE,
        expandedRow: null,
        tool,
        dock: "right",
      });
    }
  });

  it("a v2 token still needs exactly 7 fields and valid dock/detent/row/tab codes", () => {
    expect(parseUi("2.p.r.380.h.d")).toBeNull();
    expect(parseUi("2.p.r.380.h.d.l.x")).toBeNull();
    expect(parseUi("2.p.x.380.h.d.l")).toBeNull();
    expect(parseUi("2.p.r.380.x.d.l")).toBeNull();
    expect(parseUi("2.p.r.380.h.x.l")).toBeNull();
    expect(parseUi("2.p.r.380.h.d.x")).toBeNull();
    expect(parseUi("2.p.r.bogus.h.d.l")).toBeNull();
  });
});
