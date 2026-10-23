// report/flowerSvg.ts -- a STANDALONE `<svg>` markup string for one place's flower, built from the
// SAME `FlowerGeometry` the on-screen figure draws (lib/ui/flowerGeometry.ts) -- never a second
// geometry computation. "Standalone" matters for two exports that render OUTSIDE this document's own
// CSS cascade: the DOCX exporter rasterizes this (svgToPng.ts) in a blank `<img>` context that
// cannot see this page's `var(--cat-*)` custom properties, and the self-contained HTML download
// re-parses the whole page in a browser with no stylesheet at all. `resolveColor` is the seam: the
// live document (Report.svelte) resolves each `--cat-*` token via `getComputedStyle`, and a test
// can pass a trivial identity/lookup function instead.
//
// atlas-4 fix round 2: `geometry.petals[*].path` is now an ANNULAR sector, not a pie slice from the
// centre (`flowerGeometry.ts`'s header) -- this file's own hub circle used to sit ON TOP of full
// pie slices and silently cover any petal whose score was below the hub's radius, the exact
// mechanism behind the live "flower draws only ~4 of 8 petals" defect. Reading `geometry.innerRadius`
// for the hub (rather than a hardcoded literal) means this export can never drift from the petals
// drawn around it again.
//
// P round V2 fix (Opus eyes-on, 2026-09-24): `opacity="0.92"` here used to paint the exported
// (DOCX/standalone-HTML) flower's petals slightly PALER than a full-opacity `--cat-*` swatch --
// the same "petals pale, legend dark" mismatch `Report.svelte`'s own inline `<svg>` had at
// `opacity="0.5"` (a worse case of the identical bug). Dropped: `resolveColor()` already reads the
// measured, committed token, so the color it returns should be drawn as-is (see `Flower.svelte`'s
// own ".petal" rule, which makes this same call for the live app).
import type { FlowerGeometry } from "../lib/ui/flowerGeometry";
import { formatScore } from "../lib/format";
import {
  REPORT_FLOWER_HUB_FILL,
  REPORT_FLOWER_HUB_STROKE,
  REPORT_FLOWER_PETAL_STROKE,
  REPORT_FLOWER_TEXT,
} from "./colors";

export interface FlowerSvgOptions {
  size?: number;
  /** resolves a CSS custom-property NAME (e.g. "--cat-fish") to a concrete color the SVG can use
   * with no external stylesheet. */
  resolveColor: (cssVarName: string) => string;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** the flower's standalone SVG, with `centre` overridden by the caller (model.ts: the table's
 * `Overall`, not the drawn petals' own mean -- see `ReportFlower.centre`'s header). */
export function flowerStandaloneSvg(
  title: string,
  geometry: FlowerGeometry,
  centre: number | null,
  opts: FlowerSvgOptions,
): string {
  const size = opts.size ?? 220;
  const petals = geometry.petals
    .map(
      (p) =>
        `<path d="${p.path}" fill="${opts.resolveColor(p.category.color)}" stroke="${REPORT_FLOWER_PETAL_STROKE}" stroke-width="1">` +
        `<title>${esc(p.category.label)}: ${formatScore(p.score)}</title></path>`,
    )
    .join("");
  const centreText = centre !== null ? String(Math.round(centre)) : "—";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="${size}" height="${size}" ` +
    `role="img" aria-label="${esc(title)} flower, centre ${centreText}">` +
    `${petals}` +
    `<circle cx="100" cy="100" r="${geometry.innerRadius}" fill="${REPORT_FLOWER_HUB_FILL}" stroke="${REPORT_FLOWER_HUB_STROKE}" stroke-width="1"/>` +
    `<text x="100" y="100" text-anchor="middle" dy="0.35em" font-family="sans-serif" ` +
    `font-size="28" font-weight="700" fill="${REPORT_FLOWER_TEXT}">${esc(centreText)}</text>` +
    `</svg>`
  );
}
