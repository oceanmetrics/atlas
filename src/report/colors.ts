// report/colors.ts -- THE ONLY place the report module writes a colour literal, the same pattern
// `src/lib/map/colors.ts` establishes for the map module (see that file's own header) and
// `tests/raster/ramps.wiring.test.ts` polices by exact path for both files.
//
// Every color here is used OUTSIDE any stylesheet context -- a standalone `<svg>` string rasterized
// with no parent document (flowerSvg.ts/svgToPng.ts), a MapLibre style JSON's paint properties
// (reportMap.ts), or a JS fallback for a CSS custom property that failed to resolve
// (Report.svelte's DOCX color resolver) -- so none of them can simply be `var(--token)` the way
// the live document's own CSS can. Put a new report color here or nowhere; never a bare literal in
// another report/** file.
export const REPORT_NODATA_COLOR = "#b6bfd0"; // tokens.css's --cat-other
// the background/basemap layers reuse composeStyle()'s own colors (fix round 1) -- no
// REPORT_MAP_BACKGROUND literal here any more.
export const REPORT_MAP_OUTLINE = "#333333";
export const REPORT_MAP_LABEL_TEXT = "#1a1f29";
export const REPORT_MAP_LABEL_HALO = "#ffffff";

export const REPORT_FLOWER_PETAL_STROKE = "#ffffff";
export const REPORT_FLOWER_HUB_FILL = "#ffffff";
export const REPORT_FLOWER_HUB_STROKE = "#8a8f9c";
export const REPORT_FLOWER_TEXT = "#1a1f29";

export const REPORT_RASTER_BACKGROUND = "#ffffff";

/** the DOCX color resolver's fallback when a `--cat-*` custom property could not be read at all
 * (a non-browser test run, or a page with no tokens.css loaded). */
export const REPORT_COLOR_UNRESOLVED = "#999999";
