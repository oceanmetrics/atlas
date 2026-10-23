// atlas-3 step 2b: the squarified treemap algorithm (Bruls, Huizing & van Wijk, "Squarified
// Treemaps", 1999) as a pure, synchronous, exported function -- CLAUDE.md's "core logic lives in
// an exported function; a component only calls it" sibling to flowerGeometry.ts's sectorPath().
//
// d3-hierarchy (an exact-pinned dependency, package.json's pinReasons) is what Treemap.svelte uses
// to build the TREE and roll up values (`hierarchy(data).sum(...)`), reached ONLY via a dynamic
// import() so it never enters index.html's static graph. This file deliberately has NO dependency
// on d3 at all -- it only turns an already-flat list of `{ id, value }` leaves for ONE container
// into rectangles -- so the layout math itself is synchronous and unit-testable without any async
// import machinery.
export interface TreemapLeafInput {
  id: string;
  /** must be > 0 to receive area; a leaf with value <= 0 is silently dropped (see `squarify()`) */
  value: number;
}

export interface TreemapRect {
  id: string;
  value: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface AreaLeaf {
  id: string;
  value: number;
  area: number;
}

/** the worst (largest) aspect ratio among `areas` if they were laid out as a strip of thickness
 * `sum / side` along `side`. Lower is better (1 = a perfect square). */
function worstRatio(areas: readonly number[], sum: number, side: number): number {
  const thickness = sum / side;
  let worst = 0;
  for (const area of areas) {
    const length = area / thickness;
    const ratio = Math.max(thickness / length, length / thickness);
    if (ratio > worst) worst = ratio;
  }
  return worst;
}

function recurse(
  items: readonly AreaLeaf[],
  x: number,
  y: number,
  w: number,
  h: number,
): TreemapRect[] {
  if (items.length === 0 || w <= 0 || h <= 0) return [];
  if (items.length === 1) {
    const it = items[0];
    return [{ id: it.id, value: it.value, x, y, width: w, height: h }];
  }

  const side = Math.min(w, h); // the axis rows are squared against
  const row: AreaLeaf[] = [items[0]];
  let rowAreas = [items[0].area];
  let rowSum = items[0].area;
  let i = 1;
  while (i < items.length) {
    const candidate = [...rowAreas, items[i].area];
    const candidateSum = rowSum + items[i].area;
    // <= (not <): ties prefer growing the row, matching the reference algorithm and keeping the
    // result deterministic for equal-value inputs (unit-tested directly).
    if (worstRatio(candidate, candidateSum, side) <= worstRatio(rowAreas, rowSum, side)) {
      row.push(items[i]);
      rowAreas = candidate;
      rowSum = candidateSum;
      i++;
    } else {
      break;
    }
  }

  const rects: TreemapRect[] = [];
  const remaining = items.slice(row.length);

  if (w >= h) {
    // lay the row out as a COLUMN on the left, width = rowSum / h
    const colWidth = rowSum / h;
    let cursorY = y;
    for (const it of row) {
      const itemHeight = it.area / colWidth;
      rects.push({
        id: it.id,
        value: it.value,
        x,
        y: cursorY,
        width: colWidth,
        height: itemHeight,
      });
      cursorY += itemHeight;
    }
    rects.push(...recurse(remaining, x + colWidth, y, w - colWidth, h));
  } else {
    // lay the row out as a STRIP at the top, height = rowSum / w
    const rowHeight = rowSum / w;
    let cursorX = x;
    for (const it of row) {
      const itemWidth = it.area / rowHeight;
      rects.push({
        id: it.id,
        value: it.value,
        x: cursorX,
        y,
        width: itemWidth,
        height: rowHeight,
      });
      cursorX += itemWidth;
    }
    rects.push(...recurse(remaining, x, y + rowHeight, w, h - rowHeight));
  }

  return rects;
}

/**
 * PURE: a squarified treemap layout for `leaves` inside a `width` x `height` rectangle anchored at
 * `(x, y)`. Sorted internally by descending value (stable tie-break by input order), so the result
 * is deterministic regardless of the order `leaves` is passed in. Leaves with `value <= 0` are
 * dropped (they would receive zero or negative area). The sum of every returned rect's area equals
 * `width * height` exactly (modulo floating point), and every rect nests entirely inside the
 * container -- both invariants are asserted directly in treemapLayout.test.ts.
 */
export function squarify(
  leaves: readonly TreemapLeafInput[],
  x: number,
  y: number,
  width: number,
  height: number,
): TreemapRect[] {
  const positive = leaves.filter((l) => l.value > 0);
  if (positive.length === 0 || width <= 0 || height <= 0) return [];

  const total = positive.reduce((s, l) => s + l.value, 0);
  const scale = (width * height) / total;

  const sorted = positive
    .map((l, i) => ({ ...l, i }))
    .sort((a, b) => b.value - a.value || a.i - b.i)
    .map((l): AreaLeaf => ({ id: l.id, value: l.value, area: l.value * scale }));

  return recurse(sorted, x, y, width, height);
}

// --- Treemap.svelte's text summary (G-23 fix) ---------------------------------------------------
//
// PURE, no d3 dependency here either -- same reasoning as squarify() above.

const GROUPED = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/**
 * 0 dp, comma-grouped -- matches `report/format.ts`'s OWN `comma(round(suit_er_area, 0))`
 * convention for this exact quantity. The bug this replaces (G-23, `docs/parity.html`):
 * `Number.prototype.toLocaleString()`'s default keeps up to 3 fraction digits, so a raw
 * `suit_er_area` sum printed as "210,671,300.041" -- neither a species count nor rounded the way
 * every other consumer of this number already is.
 */
export function formatTreemapValue(v: number): string {
  return GROUPED.format(Math.round(v));
}

/** a leaf's share of `total`, 0 dp -- `0` when `total` is not positive (an empty/all-zero tree),
 * never `NaN` or `Infinity`. */
export function treemapPercent(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

export interface TreemapSummaryLeaf {
  label: string;
  value: number;
}

/**
 * PURE: Treemap.svelte's text summary (spec.md §11, SC 1.1.1 -- "every chart has a table
 * equivalent AND a text summary"), also used verbatim as the figure's `aria-describedby`
 * paragraph.
 *
 * `valueLabel` names what a positive `value` REPRESENTS -- there is no safe default, because
 * Treemap.svelte is a generic component two real callers size differently: the gallery fixture's
 * boxes are a literal per-category species COUNT, while `src/lens/scores/composition.ts` sizes
 * them by the SUMMED `suit_er_area` ("combined suitability x extinction-risk x area" --
 * `glossary.ts`'s own phrase for that column, matched here on purpose so the two can never drift
 * apart). G-23's root cause was this component silently ASSUMING "species" for every caller.
 */
export function describeTreemapSummary(
  title: string,
  leaves: readonly TreemapSummaryLeaf[],
  valueLabel: string,
): string {
  if (leaves.length === 0) return `${title}. No data.`;
  const total = leaves.reduce((s, l) => s + l.value, 0);
  const parts = leaves
    .slice()
    .sort((a, b) => b.value - a.value)
    .map((l) => `${l.label} ${formatTreemapValue(l.value)} (${treemapPercent(l.value, total)}%)`);
  return (
    `${title}. ${formatTreemapValue(total)} ${valueLabel} across ${leaves.length} categories: ` +
    `${parts.join(", ")}.`
  );
}
