<script lang="ts" module>
  // exported from the MODULE context (a real ES export other files can import, unlike a plain
  // instance-script `export`) so callers building tree data can name the type:
  // `import Treemap, { type TreemapInputNode } from "./Treemap.svelte"`.
  export interface TreemapInputNode {
    name: string;
    /** resolved through categories.ts; falls back to `name` when omitted */
    categoryKey?: string;
    /** ignored on a node with children (d3-hierarchy sums children instead, same convention as
     * d3.hierarchy().sum()) */
    value?: number;
    children?: TreemapInputNode[];
  }

  let nextId = 0;
  // wrapped in a function so the increment's result is provably "used" within the function that
  // performs it -- see Flower.svelte's identical nextUid() for why a bare top-level `nextId++` in
  // the instance script trips eslint's no-useless-assignment.
  function nextUid(): string {
    return `treemap-${nextId++}`;
  }
</script>

<script lang="ts">
  // atlas-3 step 2b: the species-composition treemap (replaces plotly's "spp_comp", parity scores
  // app.md §7.6). d3-hierarchy is used ONLY to build the tree and roll up values
  // (`hierarchy(data).sum(...)`) -- reached ONLY via a dynamic import() below, so it never enters
  // index.html's static graph (scripts/size-budget-core.mjs's FORBIDDEN_LAZY_MARKERS already lists
  // "treemap"; the exact package name is pinned in package.json). The squarified RECTANGLE math is
  // this repo's own pure function, src/lib/ui/treemapLayout.ts, unit-tested independently of d3.
  // Category colors come from categories.ts; no literal color anywhere in this component.
  import { categoryFor, type Category } from "./categories";
  import {
    describeTreemapSummary,
    formatTreemapValue,
    squarify,
    treemapPercent,
    type TreemapRect,
  } from "./treemapLayout";

  interface Props {
    title: string;
    data: TreemapInputNode;
    /** what a positive `value` represents (e.g. "species" for a literal count, or a longer
     * phrase for a weighted sum) -- REQUIRED, no default: see `describeTreemapSummary`'s own
     * header (G-23) for why this component must never guess. */
    valueLabel: string;
    /** SVG px */
    width?: number;
    height?: number;
    /** R4-C: take the pane's width (the SVG scales via its viewBox, capped by `width`) and keep the
     * title visually hidden when the caller's own header already states the subject. */
    fluid?: boolean;
  }

  let { title, data, valueLabel, width = 480, height = 280, fluid = false }: Props = $props();

  const summaryId = nextUid();

  interface Leaf {
    id: string;
    name: string;
    category: Category;
    value: number;
  }

  let leaves = $state<Leaf[]>([]);
  let rects = $state<TreemapRect[]>([]);
  let loading = $state(true);
  let showTable = $state(false);

  const total = $derived(leaves.reduce((s, l) => s + l.value, 0));
  const cells = $derived(
    rects.map((rect) => ({ rect, leaf: leaves.find((l) => l.id === rect.id)! })),
  );

  async function layout(node: TreemapInputNode, w: number, h: number) {
    loading = true;
    // dynamic import ONLY -- see the module header. `hierarchy` is destructured from the resolved
    // module rather than the module itself being re-exported, so nothing here re-introduces a
    // static binding to "d3-hierarchy" anywhere in this file's own top-level scope.
    const { hierarchy } = await import("d3-hierarchy");
    const root = hierarchy<TreemapInputNode>(node, (n) => n.children).sum((n) => n.value ?? 0);
    const nextLeaves: Leaf[] = (root.children ?? []).map((child) => ({
      id: child.data.name,
      name: child.data.name,
      category: categoryFor(child.data.categoryKey ?? child.data.name),
      value: child.value ?? 0,
    }));
    leaves = nextLeaves;
    rects = squarify(
      nextLeaves.map((l) => ({ id: l.id, value: l.value })),
      0,
      0,
      w,
      h,
    );
    loading = false;
  }

  $effect(() => {
    // read reactively BEFORE the async gap below, so this effect re-runs when any of them change
    // (a value read only after an `await` is not tracked as a dependency)
    const node = data;
    const w = width;
    const h = height;
    layout(node, w, h);
  });

  // both wrappers exist only so the template below reads `formatValue`/`pctOf` (its own local,
  // short names) rather than the imported ones directly -- `pctOf` also closes over `total` so
  // call sites don't have to repeat it.
  function formatValue(v: number): string {
    return formatTreemapValue(v);
  }

  function pctOf(value: number): number {
    return treemapPercent(value, total);
  }

  // SAME leaves the SVG/table draw, so the summary can never disagree with what is on screen
  // (Flower.svelte's `describeFlowerSummary` follows the identical rule). `valueLabel` is the
  // caller's, never guessed here -- see the component header and `describeTreemapSummary`'s own.
  const summaryText = $derived(
    describeTreemapSummary(
      title,
      leaves.map((l) => ({ label: l.category.label, value: l.value })),
      valueLabel,
    ),
  );
</script>

<figure class="treemap" class:treemap--fluid={fluid} aria-describedby={summaryId}>
  <figcaption class="treemap-title" class:sr-only={fluid}>{title}</figcaption>

  {#if !loading && leaves.length === 0}
    <p class="empty">No species data for this selection.</p>
  {:else}
    <button
      type="button"
      class="toggle"
      aria-pressed={showTable}
      onclick={() => (showTable = !showTable)}
    >
      {showTable ? "Show chart" : "Show table"}
    </button>

    <div class="treemap-body">
      <svg
        class="treemap-svg"
        class:sr-only={showTable}
        viewBox={`0 0 ${width} ${height}`}
        width={fluid ? undefined : Math.min(width, 480)}
        height={fluid ? undefined : Math.min(height, 280)}
        aria-hidden={showTable ? "true" : undefined}
      >
        {#each cells as c (c.rect.id)}
          <!-- each cell is its own focusable, individually-named data point (spec.md §11:
               "keyboard reachable cells with accessible names"); an SVG <g> has no native
               interactive role, so svelte-check's a11y rule does not recognize tabindex here as
               the correct pattern -- there is no more accurate native element or role to reach for.
               role="img" is required, not decorative: aria-label on an element with no role at
               all is prohibited (axe aria-prohibited-attr) -- a <g> with no role has none. -->
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <g
            class="cell"
            tabindex={showTable ? -1 : 0}
            role="img"
            aria-label={`${c.leaf.category.label}: ${formatValue(c.leaf.value)} (${pctOf(c.leaf.value)}%)`}
            transform={`translate(${c.rect.x}, ${c.rect.y})`}
          >
            <rect
              width={c.rect.width}
              height={c.rect.height}
              style={`fill: var(${c.leaf.category.color})`}
            >
              <title
                >{`${c.leaf.category.label}: ${formatValue(c.leaf.value)} (${pctOf(c.leaf.value)}%)`}</title
              >
            </rect>
            {#if c.rect.width > 44 && c.rect.height > 18}
              <text x="4" y="16" class="cell-label">{c.leaf.category.label}</text>
            {/if}
          </g>
        {/each}
      </svg>

      <table class="treemap-table" class:sr-only={!showTable}>
        <caption>{title}, by category</caption>
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col" title={`Total ${valueLabel} for this category`}>Value</th>
            <th scope="col">Share</th>
          </tr>
        </thead>
        <tbody>
          {#each leaves.slice().sort((a, b) => b.value - a.value) as l (l.id)}
            <tr>
              <td>{l.category.label}</td>
              <td class="num">{formatValue(l.value)}</td>
              <td class="num">{pctOf(l.value)}%</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  <p class="summary" id={summaryId}>{summaryText}</p>
</figure>

<style>
  .treemap {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    max-width: 520px;
  }

  .treemap--fluid {
    max-width: none;
  }

  .treemap--fluid .treemap-svg {
    width: 100%;
    max-width: var(--treemap-max, 960px);
  }

  .treemap-title {
    font-family: var(--font-display);
    font-size: var(--text-lg);
    letter-spacing: var(--tracking-display);
  }

  .toggle {
    align-self: flex-start;
    height: var(--size-touch);
    padding: 0 var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--fill-control);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .toggle:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .toggle[aria-pressed="true"] {
    background: var(--fill-accent);
    color: var(--text-on-accent);
    border-color: transparent;
  }

  .treemap-svg {
    max-width: 100%;
    height: auto;
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
  }

  .cell rect {
    stroke: var(--surface-panel);
    stroke-width: 2;
  }

  .cell:hover rect,
  .cell:focus-visible rect {
    stroke: var(--focus-ring);
    stroke-width: 2;
  }

  .cell:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .cell-label {
    fill: var(--text-on-accent);
    font-size: 11px;
    font-weight: 700;
    pointer-events: none;
  }

  .treemap-table {
    border-collapse: collapse;
    width: 100%;
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }

  .treemap-table caption {
    text-align: left;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    margin-bottom: var(--space-2);
  }

  .treemap-table th,
  .treemap-table td {
    padding: var(--space-1) var(--space-2);
    text-align: left;
    border-bottom: 1px solid var(--divider);
  }

  .treemap-table .num {
    text-align: right;
  }

  .empty {
    padding: var(--space-4);
    text-align: center;
    color: var(--text-secondary);
    border: 1px dashed var(--border-control);
    border-radius: var(--radius-control);
  }

  .summary {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
