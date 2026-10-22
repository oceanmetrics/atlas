// R3-W2 Deliverable 2: the map-figure footer's text content, pure (CLAUDE.md) -- `mapCapture.ts`/
// `mapSvgExport.ts`/`svgWrapper.ts` draw these lines onto a canvas/SVG; this module only decides
// what the lines SAY. Shape borrowed from CalCOFI explore's `export.ts#stampLines` (the common
// brief's own reference), not its code: this app has its own release/version vocabulary (`ver`,
// not "release ###").
//
// Fix round (Opus 5.5 eyes-on review, D3): two real defects, both here.
//   1. The title/filename used the layer's LONG description (`boot.layers[].label`, ~190 chars for
//      `primprod`), not the short display label the Layer select/legend chip show
//      (`metricKeyLabel()`/the manifest's `metricLabels`, `Shell.svelte`'s `phoneLegend.title`) --
//      fixed at the CALL SITE (`Shell.svelte`'s `downloadTitle`), not here; this module never knew
//      which label was long or short, it only formats whatever `title` it is handed.
//   2. The footer's own "share URL" line printed the ORIGIN-STRIPPED (relative) path, which is
//      useless pasted anywhere off-site, and carried `theme=` (a per-viewer preference, not part
//      of the shared VIEW). `canonicalShareUrl()` (below) replaces `shareUrlWithoutOrigin` (removed
//      -- nothing else called it): it keeps the full absolute URL (the exact string the Share
//      button already copies, `location.href`) and drops only `theme`.

import { BRAND_NAME } from "../brand/instance";

export interface FooterInfo {
  /** the SHORT layer/species title -- a metric's short label (never its long description) or a
   * species' scientific name; the caller resolves which is short (`Shell.svelte`'s
   * `downloadTitle`, sourced from `phoneLegend.title`/`metricKeyLabel()` for scores). */
  title: string;
  /** the value's unit, e.g. "score", "1-100" -- omitted when the surface has none worth stating. */
  unit?: string;
  /** the pinned release (species lens only); omitted for a collection, which has no release. */
  ver?: string | null;
  /** the app's own share URL, e.g. `location.href` -- ALREADY absolute (this module never strips
   * the origin now, and never reads `location` itself -- the same "inject, don't read the live
   * page" rule `src/lib/analytics` follows, so this stays Node-testable). */
  url: string;
  /** the layer's own LONG description (`boot.layers[].label`, `Shell.svelte`'s
   * `phoneLegendDescription` -- already deduped there against `title`), for an optional second,
   * smaller footer line. `null`/omitted when there is none (species; a scores layer with no
   * distinct description; the DOM-touching caller decided it does not fit -- see
   * `mapCapture.ts`/`mapSvgExport.ts`'s own width-fit check, which runs BEFORE this function and
   * passes `null` through when it decided to drop the line). */
  description?: string | null;
}

/** the absolute canonical share URL: the SAME string `Shell.svelte#onShare` already copies
 * (`location.href`), minus `theme` -- never the origin-stripped relative path (useless pasted
 * anywhere off-site: Slack, email, a paper). Malformed input is returned unchanged rather than
 * thrown on -- a footer must never be the reason a download fails. */
export function canonicalShareUrl(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete("theme");
    return u.toString();
  } catch {
    return url;
  }
}

/** R3-rr fix 2 (Opus 5.5 eyes-on review round 3, 2026-09-25): the Scores lens' default layer's
 * title AND unit are both literally "score" (`Shell.svelte`'s `downloadTitle` falls back to
 * `phoneLegend?.title`, `downloadUnit` is a flat `"score"` for every scores layer), so the old
 * unconditional `${title} · ${unit}` join printed "score · score" on the live download, both
 * themes. A unit that only restates the title adds nothing -- joins it only when the two say
 * something DIFFERENT, compared case-insensitively and trimmed so "Score"/"score" still count as
 * the same word (a species title + a "suitability"-style unit, which never matches the title, still
 * joins exactly as before). */
export function titleWithUnit(title: string, unit?: string): string {
  if (!unit) return title;
  return unit.trim().toLowerCase() === title.trim().toLowerCase() ? title : `${title} · ${unit}`;
}

/** 2 or 3 lines: title(+unit), an optional long-description line, then
 * "OceanMetrics Atlas · {ver} · {canonical share URL}" (the `{ver} · ` part only when there is a
 * release) -- CalCOFI's own 3-line stamp minus the per-panel "datasets" line. `ver` is already the
 * `^v[0-9]+[a-z]?$`-shaped label -- never prefixed with a second "v" here. */
export function footerLines(info: FooterInfo): string[] {
  const first = titleWithUnit(info.title, info.unit);
  const last = `${BRAND_NAME} · ${info.ver ? `${info.ver} · ` : ""}${canonicalShareUrl(info.url)}`;
  return info.description ? [first, info.description, last] : [first, last];
}

/** whether `text` fits within `maxWidth`, measured by an INJECTED `measure` function (a real
 * `CanvasRenderingContext2D#measureText(text).width` in the DOM-touching callers -- `mapCapture.ts`
 * has a real canvas already; `mapSvgExport.ts` creates a scratch, never-rendered one purely to
 * measure, matching CalCOFI explore's own `ellipsize()` -- this module never touches a DOM). Pure
 * so the DECISION is unit-testable with a fake `measure`, per CLAUDE.md's "core logic lives in an
 * exported function; a component only calls it". */
export function fitsWidth(
  text: string,
  measure: (text: string) => number,
  maxWidth: number,
): boolean {
  return measure(text) <= maxWidth;
}
