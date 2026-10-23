// atlas-3 step 3, spec.md §5.1 / R4-B: the spine is FOUR controls, the SAME four, in the SAME order,
// on every viewport AND every lens: Layers, Details, Table, Report (control-grammar.md). This pins src/shell/tools.ts's data against that rule directly,
// and also closes the loop on the ONE piece of text index.html's static skeleton duplicates by hand
// (its default "Layers" panel body): if this drifts from TOOL_BODY.layers, the CLS gate would
// eventually catch the resulting height mismatch in a real browser, but this test catches the TEXT
// drift itself, immediately.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildRailItems,
  panelHeaderTitle,
  TOOL_BODY,
  TOOL_ICON,
  TOOL_LABEL,
  TOOL_ORDER,
  toolTakesFullStage,
  type PanelContext,
} from "../../src/shell/tools";
import { legacyToolFromParams } from "../../src/lib/state/legacy";

describe("TOOL_ORDER: the spine is Layers, Details, Table, Report -- in that order", () => {
  it("has exactly these four tools, in this exact order (spec.md §5.1)", () => {
    expect(TOOL_ORDER).toEqual(["layers", "details", "table", "report"]);
  });

  it("every tool has a label and a body sentence -- nothing is missing", () => {
    for (const name of TOOL_ORDER) {
      expect(TOOL_LABEL[name]).toBeTruthy();
      expect(TOOL_BODY[name]).toBeTruthy();
    }
  });
});

describe("buildRailItems", () => {
  it("returns the four tools in TOOL_ORDER, with the right icon and label", () => {
    const items = buildRailItems();
    expect(items.map((i) => i.name)).toEqual([...TOOL_ORDER]);
    for (const item of items) {
      expect(item.icon).toBe(TOOL_ICON[item.name]);
      expect(item.label).toBe(TOOL_LABEL[item.name]);
    }
  });

  it("no tool is ever inactive -- every tool is active in both lenses", () => {
    const items = buildRailItems();
    for (const item of items) {
      expect("inactive" in item).toBe(false);
    }
  });
});

describe("the skeleton's default panel body text equals TOOL_BODY.layers", () => {
  it("index.html's static skeleton shows the exact same sentence main.ts's default tool shows", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html).toContain(TOOL_BODY.layers);
  });
});

describe("Details uses one icon in both lenses", () => {
  it("the icon is the info glyph and is not lens-dependent (no lens argument exists)", () => {
    expect(TOOL_ICON.details).toBe("info");
  });
});

describe("toolTakesFullStage: only Table takes the whole stage", () => {
  it("table yes; layers, details and report no", () => {
    expect(TOOL_ORDER.filter(toolTakesFullStage)).toEqual(["table"]);
  });
});

describe("panelHeaderTitle: the header says what is shown, not the tool name", () => {
  const ctx: PanelContext = {
    layer: "Score",
    unit: "Raster cells",
    subject: "Cell 3058375",
    tableSubject: "2 places · Zones",
    placeCount: 3,
    lastClicked: "Cell 3058375",
  };
  it("layers: <layer> · <unit>", () => {
    expect(panelHeaderTitle("layers", ctx)).toBe("Score · Raster cells");
  });
  it("details: the clicked subject or the species", () => {
    expect(panelHeaderTitle("details", ctx)).toBe("Cell 3058375");
  });
  it("table: its subject line", () => {
    expect(panelHeaderTitle("table", ctx)).toBe("2 places · Zones");
  });
  it("report: N places, else Last clicked place, else the tool label", () => {
    expect(panelHeaderTitle("report", ctx)).toBe("3 places");
    expect(panelHeaderTitle("report", { ...ctx, placeCount: 1 })).toBe("1 place");
    expect(panelHeaderTitle("report", { ...ctx, placeCount: 0 })).toBe("Last clicked place");
    expect(panelHeaderTitle("report", { ...ctx, placeCount: 0, lastClicked: null })).toBe("Report");
  });
  it("falls back to the tool label when nothing is known", () => {
    const empty: PanelContext = {
      layer: null,
      unit: null,
      subject: null,
      tableSubject: null,
      placeCount: 0,
      lastClicked: null,
    };
    expect(panelHeaderTitle("layers", empty)).toBe("Layers");
    expect(panelHeaderTitle("details", empty)).toBe("Details");
    expect(panelHeaderTitle("table", empty)).toBe("Table");
    expect(panelHeaderTitle("layers", { ...empty, layer: "Score" })).toBe("Score");
  });
});

describe("legacyToolFromParams: ?tool= legacy values (R4-B)", () => {
  const q = (s: string) => legacyToolFromParams(new URLSearchParams(s));
  it("tool=flower opens Details; tool=places opens Report", () => {
    expect(q("tool=flower")).toBe("details");
    expect(q("tool=places")).toBe("report");
  });
  it("the four current names pass through; anything else is absent", () => {
    for (const t of ["layers", "details", "table", "report"]) expect(q(`tool=${t}`)).toBe(t);
    expect(q("tool=bogus")).toBeNull();
    expect(q("")).toBeNull();
  });
});
