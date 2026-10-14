import { describe, expect, it } from "vitest";
import {
  FIT_GUTTER_PX,
  desktopPanelPadding,
  phoneLiveChromePadding,
} from "../../src/lib/map/chromePadding";
import {
  MIN_OPEN_SHARE,
  fitReserve,
  insideStage,
  livePadding,
  paddingEqual,
  residualFitPadding,
} from "../../src/lib/map/livePadding";
import { NO_PADDING } from "../../src/lib/map/camera";
import { DEFAULT_PANEL_GEOMETRY } from "../../src/lib/ui/panelGeometry";

// WP13: the live camera padding is the shell's chrome reserve, minus the fit gutter on the sides,
// applied only while it leaves MIN_OPEN_SHARE of the stage (obis-hex's `mapPadding` rule). One test
// per rule, on a 1280x800 desktop stage and a 390x844 phone stage.
const W = 1280;
const H = 800;
const TOPBAR = 48;
const RAIL_OFFSET = 80 + 12; // rail footprint + the panel's outer inset: where the panel's own edge starts

describe("livePadding (WP13): the open area the panel leaves", () => {
  it("MIN_OPEN_SHARE is obis-hex's 0.4", () => {
    expect(MIN_OPEN_SHARE).toBe(0.4);
  });

  it("left dock: pads the left by the panel + rail + inset, WITHOUT the fit gutter, and the top bar", () => {
    const chrome = desktopPanelPadding(DEFAULT_PANEL_GEOMETRY);
    expect(livePadding(W, H, chrome)).toEqual({
      top: TOPBAR,
      right: 0,
      bottom: 0,
      left: 380 + RAIL_OFFSET,
    });
  });

  it("right dock: pads the right, never the left", () => {
    const chrome = desktopPanelPadding({ ...DEFAULT_PANEL_GEOMETRY, dock: "right" });
    expect(livePadding(W, H, chrome)).toEqual({
      top: TOPBAR,
      right: 380 + RAIL_OFFSET,
      bottom: 0,
      left: 0,
    });
  });

  it("collapsed panel: only the rail (+ inset) is reserved on the dock side", () => {
    const chrome = desktopPanelPadding({ ...DEFAULT_PANEL_GEOMETRY, collapsed: true });
    expect(livePadding(W, H, chrome)).toEqual({
      top: TOPBAR,
      right: 0,
      bottom: 0,
      left: 80 - 8 + 12,
    });
  });

  it("maximized panel: no side and no bottom padding (nothing of the map is open), top bar kept", () => {
    const chrome = desktopPanelPadding({ ...DEFAULT_PANEL_GEOMETRY, maximized: true });
    expect(livePadding(W, H, chrome, { maximized: true })).toEqual({
      ...NO_PADDING,
      top: TOPBAR,
    });
  });

  it("a panel wide enough to leave less than 40% open pads nothing sideways (obis-hex rule)", () => {
    // 720px panel on a 900px-wide stage: 900 - (720 + 92) = 88px open, 10% < 40%
    const chrome = desktopPanelPadding({ ...DEFAULT_PANEL_GEOMETRY, size: 720 });
    expect(livePadding(900, H, chrome).left).toBe(0);
    // ...and exactly at the share it still pads: open = 40% of 1000 = 400px
    const open = { ...NO_PADDING, left: 600 + FIT_GUTTER_PX };
    expect(livePadding(1000, H, open).left).toBe(600);
    expect(livePadding(1000, H, { ...open, left: 601 + FIT_GUTTER_PX }).left).toBe(0);
  });

  it("when both sides would be padded the larger is dropped first", () => {
    const both = { ...NO_PADDING, left: 300 + FIT_GUTTER_PX, right: 400 + FIT_GUTTER_PX };
    // 1000 - 700 = 300 < 400 open: drop the right (400) -> 1000 - 300 = 700 open
    expect(livePadding(1000, H, both)).toEqual({ ...NO_PADDING, left: 300 });
  });

  it("phone sheet at half: pads the bottom (sheet + rail row) while it leaves >= 40% of the height", () => {
    const chrome = phoneLiveChromePadding(388, "half", 844, false);
    expect(chrome.bottom).toBe(388 + 64);
    expect(livePadding(390, 844, chrome)).toEqual({
      top: TOPBAR,
      right: 0, // the phone's 20px side gutter is a fit gutter, not live padding
      bottom: 388 + 64,
      left: 0,
    });
  });

  it("phone sheet at full height: no bottom padding (it leaves under 40% of the height)", () => {
    const chrome = phoneLiveChromePadding(800, "full", 844, false);
    expect(livePadding(390, 844, chrome).bottom).toBe(0);
    expect(livePadding(390, 844, chrome).top).toBe(TOPBAR);
  });

  it("phone sheet at peek: pads the small reserve", () => {
    const chrome = phoneLiveChromePadding(96, "peek", 844, false);
    expect(livePadding(390, 844, chrome).bottom).toBe(96 + 64);
  });

  it("zero width: no side padding (the stage is not laid out yet)", () => {
    const chrome = desktopPanelPadding(DEFAULT_PANEL_GEOMETRY);
    expect(livePadding(0, H, chrome)).toEqual({ ...NO_PADDING, top: TOPBAR });
  });

  it("zero height: no top or bottom padding either", () => {
    const chrome = phoneLiveChromePadding(388, "half", 844, false);
    expect(livePadding(390, 0, chrome)).toEqual(NO_PADDING);
  });
});

describe("residualFitPadding (WP13): fits never pad twice", () => {
  const chrome = desktopPanelPadding(DEFAULT_PANEL_GEOMETRY);

  it("with the live padding applied, a fit keeps only the breathing gutter on the dock side", () => {
    const live = livePadding(W, H, chrome);
    expect(residualFitPadding(chrome, live)).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: FIT_GUTTER_PX,
    });
  });

  it("an edge the live rule declined to pad keeps its whole reserve", () => {
    const live = livePadding(W, H, chrome, { maximized: true });
    expect(residualFitPadding(chrome, live)).toEqual({ ...chrome, top: 0 });
  });

  it("the legend card's bottom reserve (not applied live) still reaches the fit", () => {
    const withLegend = desktopPanelPadding(DEFAULT_PANEL_GEOMETRY, true);
    const live = livePadding(W, H, desktopPanelPadding(DEFAULT_PANEL_GEOMETRY, false));
    expect(residualFitPadding(withLegend, live)).toMatchObject({ bottom: withLegend.bottom });
  });

  it("never goes negative, and no live padding means the reserve unchanged", () => {
    expect(residualFitPadding(NO_PADDING, { ...NO_PADDING, left: 50 })).toEqual(NO_PADDING);
    expect(residualFitPadding(chrome, NO_PADDING)).toEqual(chrome);
  });

  it("a bare number is breathing room, not a chrome reserve: it passes through", () => {
    expect(residualFitPadding(40, livePadding(W, H, chrome))).toBe(40);
  });
});

describe("paddingEqual", () => {
  it("compares all four edges", () => {
    expect(paddingEqual(NO_PADDING, { ...NO_PADDING })).toBe(true);
    expect(paddingEqual(NO_PADDING, { ...NO_PADDING, bottom: 1 })).toBe(false);
  });
});

describe("insideStage / fitReserve (WP13): the top bar is a row above the stage, not over it", () => {
  const chrome = desktopPanelPadding(DEFAULT_PANEL_GEOMETRY);

  it("a stage that starts below the 48px bar reserves none of it", () => {
    expect(insideStage(chrome, 48).top).toBe(0);
    expect(livePadding(W, 752, insideStage(chrome, 48)).top).toBe(0);
  });

  it("a stage the bar floats over still reserves it (and only the overlap)", () => {
    expect(insideStage(chrome, 0).top).toBe(TOPBAR);
    expect(insideStage(chrome, 20).top).toBe(TOPBAR - 20);
  });

  it("a fit keeps a gutter above and below, and leaves the sides alone", () => {
    expect(fitReserve(chrome, 48)).toEqual({
      top: FIT_GUTTER_PX,
      right: 0,
      bottom: FIT_GUTTER_PX,
      left: chrome.left,
    });
  });

  it("a fit's bottom reserve (legend card, phone sheet) is never reduced to the gutter", () => {
    expect(fitReserve(desktopPanelPadding(DEFAULT_PANEL_GEOMETRY, true), 48).bottom).toBe(
      desktopPanelPadding(DEFAULT_PANEL_GEOMETRY, true).bottom,
    );
  });
});
