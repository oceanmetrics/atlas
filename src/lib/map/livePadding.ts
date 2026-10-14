// WP13: the camera padding the shell applies LIVE, so the map's centre (and, with the sphere
// projection on, the globe) sits in the part of the stage the panel and the phone sheet leave open.
// The precedent is obis-hex (`src/lib/view/padding.ts#mapPadding`, `MIN_OPEN_SHARE = 0.4`): pad a
// side only while that leaves at least 40% of the stage, otherwise centring in a sliver would push
// the view off screen.
//
// Pure and DOM-free, like chromePadding.ts and camera.ts, so every rule is a unit test. The input is
// the shell's own chrome reserve (`chromePadding.ts`: `desktopPanelPadding` / `phoneLiveChromePadding`),
// which is the SAME number the fits use -- one source of truth for "how much of the stage is chrome".
//
// Two numbers come out of one reserve and must never be added twice:
//   - the LIVE padding below, which MapLibre keeps in `transform.padding` and which moves where the
//     centre is drawn (a standing property of the map), and
//   - the FIT's own padding, which MapLibre's `cameraForBounds` adds ON TOP of `transform.padding`
//     (measured in the 6.10 source: availableWidth = width - (transform.padding + options.padding)).
//     {@link residualFitPadding} is what is left of the reserve once the live padding is taken out,
//     i.e. the breathing gutter on the dock side and whatever the live rule declined to pad.
import type { ChromePadding } from "./camera";
import { NO_PADDING } from "./camera";
import { FIT_GUTTER_PX } from "./chromePadding";

/** the least share of the stage the live padding may leave open on an axis (obis-hex's value): an
 * expanded or very wide panel, or a full-height sheet, covers the map, and centring the view in the
 * sliver left would only push it off screen. */
export const MIN_OPEN_SHARE = 0.4;

export interface LivePaddingOptions {
  /** the panel fills the whole stage (the Table tool): nothing of the map is open, so no side or
   * bottom padding -- the view stays centred on the stage it will return to. */
  maximized?: boolean;
}

/**
 * The padding to apply to the map for a stage `stageWidthPx` x `stageHeightPx` whose chrome reserves
 * `chrome` (the shell's reserve, gutter included on the sides).
 *
 *  - top: the top bar, as reserved (it is always there, and a bar of 48px never threatens the share).
 *  - left / right: the reserve MINUS the fit gutter (`FIT_GUTTER_PX` is a fit concept: the centre of
 *    the open area is the centre of what the chrome does not cover), kept only while the open width
 *    stays at or above {@link MIN_OPEN_SHARE} of the stage; the larger side is dropped first.
 *  - bottom: the phone sheet (and the rail row under it), kept only while it leaves at least
 *    {@link MIN_OPEN_SHARE} of the stage height. A full-height sheet leaves almost nothing, so none.
 *  - a zero-size stage (not laid out yet) pads nothing.
 */
export function livePadding(
  stageWidthPx: number,
  stageHeightPx: number,
  chrome: ChromePadding,
  opts: LivePaddingOptions = {},
): ChromePadding {
  const pad: ChromePadding = { ...NO_PADDING };
  const hasHeight = stageHeightPx > 0;
  if (hasHeight) pad.top = Math.max(0, chrome.top);
  if (opts.maximized) return pad;

  if (stageWidthPx > 0) {
    let left = Math.max(0, chrome.left - FIT_GUTTER_PX);
    let right = Math.max(0, chrome.right - FIT_GUTTER_PX);
    const openShare = () => (stageWidthPx - left - right) / stageWidthPx;
    while (left + right > 0 && openShare() < MIN_OPEN_SHARE) {
      if (left >= right) left = 0;
      else right = 0;
    }
    pad.left = left;
    pad.right = right;
  }

  if (hasHeight) {
    const bottom = Math.max(0, chrome.bottom);
    if ((stageHeightPx - bottom) / stageHeightPx >= MIN_OPEN_SHARE) pad.bottom = bottom;
  }
  return pad;
}

/**
 * The part of a chrome reserve that lies INSIDE the stage. `chromePadding.ts` reserves the top bar
 * (48px) as if it floated over the map, but the shell lays it out as its own row ABOVE the stage
 * (measured at 1280x800 and 390x844: the stage starts at y=48), so padding the map for it would
 * pull the centre 24px up for nothing. `stageTopPx` is how far down the viewport the stage starts;
 * the bar's reserve is whatever of it still overlaps the stage (none today, all of it if a layout
 * ever floats the bar over the map).
 */
export function insideStage(chrome: ChromePadding, stageTopPx: number): ChromePadding {
  return { ...chrome, top: Math.max(0, chrome.top - Math.max(0, stageTopPx)) };
}

/** the reserve a fit measures from the stage edge: {@link insideStage}, with at least the breathing
 * gutter above and below so an extent never lands flush against the stage's own edge (the sides
 * already carry theirs, `chromePadding.ts`). */
export function fitReserve(chrome: ChromePadding, stageTopPx: number): ChromePadding {
  const inside = insideStage(chrome, stageTopPx);
  return {
    ...inside,
    top: Math.max(FIT_GUTTER_PX, inside.top),
    bottom: Math.max(FIT_GUTTER_PX, inside.bottom),
  };
}

/** are two paddings the same, to the pixel? (the shell only eases the map when this is false) */
export function paddingEqual(a: ChromePadding, b: ChromePadding): boolean {
  return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;
}

/**
 * What a fit still has to pass to `cameraForBounds` when `applied` is already the map's
 * `transform.padding`: a fit's `ChromePadding` is the chrome reserve measured from the viewport edge,
 * and `applied` already covers part of it, so only the rest is requested (never both -- that would
 * pad twice and push the extent out of the open area). With the live padding active this leaves the
 * breathing gutter on the dock side and, on an edge the live rule declined to pad (a maximized
 * panel, a full-height sheet), the whole reserve.
 *
 * A bare number is NOT a chrome reserve (the species lens' flat 40px fallback): it is extra
 * breathing room around the open area and passes through unchanged.
 */
export function residualFitPadding(
  requested: number | ChromePadding,
  applied: ChromePadding,
): number | ChromePadding {
  if (typeof requested === "number") return requested;
  const rest = (want: number, have: number) => Math.max(0, want - have);
  return {
    top: rest(requested.top, applied.top),
    right: rest(requested.right, applied.right),
    bottom: rest(requested.bottom, applied.bottom),
    left: rest(requested.left, applied.left),
  };
}
