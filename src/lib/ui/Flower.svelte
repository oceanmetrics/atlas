<script lang="ts" module>
  let nextId = 0;
  // wrapped in a function (rather than a bare `nextId++` in the instance script below) so the
  // increment's result is provably "used" within the function that performs it -- a bare top-level
  // increment in the instance script trips eslint's no-useless-assignment, since that rule does not
  // credit a later component instantiation as a future read of the module-scoped counter.
  function nextUid(): string {
    return `flower-${nextId++}`;
  }
</script>

<script lang="ts">
  // atlas-3 step 2b, spec.md §11: "every chart has a table equivalent and a text summary". The SVG
  // and the <table> below both render straight off the SAME `geometry`/`components` data, so they
  // cannot drift (the seeded fault: "the table equivalent of the flower showing different numbers
  // from the petals"). geometry/rules live in flowerGeometry.ts (computeFlowerGeometry),
  // unit-tested there.
  //
  // atlas-4 fix round 3 (owner, phone/dark/Scores/Flower, cell 3092526, 2026-09-24): three defects
  // in the SAME panel. (1) the figure was not centred in `.flower-panel` -- `.flower`'s own default
  // flex `align-items: stretch` fills up to `max-width` and then sits flush at the cross-axis
  // START the moment the panel is wider than that cap, rather than centering the capped box in the
  // leftover space (`margin: 0 auto` below fixes the figure itself; `.flower-body`'s own
  // `align-items: center` fixes the <svg> -- a default-`display: inline` replaced element that
  // never centered itself inside its own full-width wrapper). (2) tabbing to/tapping a petal drew
  // a SOLID RECTANGLE -- `outline` on an SVG `<path>` always paints the element's BOUNDING BOX, not
  // its actual annular-sector shape, no matter what color it is set to; replaced with a purpose-
  // drawn `stroke` highlight, which (unlike `outline`) follows the path's own geometry. (3) the
  // table (added atlas-4 fix round 2, "component | score") was toggle-hidden behind a "Show table"
  // button, so by default only the always-visible `.summary` PROSE sentence carried the numbers --
  // the toggle is gone; chart and table are both always shown, and `.summary` becomes the SCREEN-
  // READER-ONLY text alternative the table's own `<caption>`/`<th>` headers no longer need
  // duplicated visibly (a `<table>` with real headers already satisfies "every chart has a table
  // equivalent" on its own -- the sentence stays only for SC 1.1.1's separate "text summary").
  //
  // P round deliverable 2 (Ben, live-review of 0.10.62, 2026-09-24): "Flower plot should be bigger
  // and needs a reference outer circle (low contrast gray given theme), but that should be based on
  // the maximum component score for given version and stated with a small label". Two changes: (1)
  // the SVG now GROWS to fill its container up to the `size` prop's cap (raised from 220 to 480) --
  // it used to carry `width`/`height` HTML attributes pinning it to a literal px value regardless of
  // how much panel space existed (measured stuck at ~105-130px on a 1280px stage). (2) a dashed
  // reference ring at `maxScore`'s radius (`lens/scores/boot.ts#flowerMaxComponentScore`, or the
  // fallback 100 when the release publishes none), with its own small grey "contour" label
  // (`computeFlowerReferenceRing`/`flowerReferenceRingLabel`, flowerGeometry.ts).
  import { categoryFor } from "./categories";
  import { announce } from "./announcer";
  import { formatScore } from "../format";
  import {
    computeFlowerGeometrySafe,
    computeFlowerReferenceRing,
    describeFlowerSummary,
    flowerReferenceRingLabel,
    flowerViewBox,
    petalCentroid,
    petalLabelText,
    type FlowerComponentInput,
    type FlowerPetal,
  } from "./flowerGeometry";

  interface Props {
    /** flower_panel_title equivalent: "Cell 123", a zone name, or "Full study area (default)" */
    title: string;
    /** R4-B: a panel header already names this subject -- the caption stays in the DOM (screen
     * readers, hover target) but is visually hidden so the subject is shown once. */
    titleInHeader?: boolean;
    components: FlowerComponentInput[];
    /** labels the CALLER already dropped before handing `components` to this component (the
     * real-world case: `flower.ts`'s `dedupeFlowerComponents`, atlas-4 fix round 2's v8/v9
     * "primprod"/"primary producer" collision) -- announced the same way as a drop this
     * component detects itself, so the one real data quirk is not silently invisible to an
     * assistive-tech user just because the de-dup happened upstream. */
    droppedLabels?: string[];
    /** CSS px CAP; the SVG viewBox is fixed (flowerViewBox()) but the drawing itself now GROWS to
     * fill its container up to this cap (P round, Ben's live review 2026-09-24: "Flower plot should
     * be bigger... use the panel's free area" — measured stuck at ~105-130px on a 1280px stage
     * regardless of how much room the panel actually had). Default 480 -- a generous ceiling for the
     * scores-lens Flower panel (Panel.svelte's own docked width tops out at 720px); a caller with a
     * tighter box (ResultsPanel.svelte's card, the gallery's demo tiles) still passes a smaller cap
     * explicitly, unchanged from before. */
    size?: number;
    /** the release's own MAXIMUM published component score (`lens/scores/boot.ts#flowerMaxComponentScore`)
     * -- draws the reference ring at this radius (`null`/`undefined`, or omitted entirely, falls back
     * to `FLOWER_MAX_FALLBACK` and the label says so). Ben: "needs a reference outer circle... based
     * on the maximum component score for given version... stated with a small label". */
    maxScore?: number | null;
    /** Q3 fix round 1 (coordinator finding): "one table" -- a caller that already renders its OWN
     * component table beside this flower (`src/places/ResultsPanel.svelte`, whose DataTable also
     * carries coverage/mean-where-present columns this component's own table does not) sets this
     * `false` so the two tables stop duplicating the same rows. The SR-only `.summary` paragraph
     * below already states every component's name and score in text (`describeFlowerSummary()`),
     * so hiding the visible table loses no accessible information -- it just stops being the one
     * that also has to exist as a SECOND on-screen copy of a caller's own table. Every other
     * caller (`FlowerPanel.svelte`, the gallery) has no such table of its own, so the default stays
     * `true` -- unchanged there. */
    showTable?: boolean;
  }

  let {
    title,
    titleInHeader = false,
    components,
    droppedLabels = [],
    size = 480,
    maxScore = null,
    showTable = true,
  }: Props = $props();

  const uid = nextUid();
  const summaryId = `${uid}-summary`;
  const tableId = `${uid}-table`;
  const tableCaptionId = `${uid}-table-caption`;

  // `computeFlowerGeometrySafe` never throws: a same-category collision in `components` (a caller
  // that did not already de-duplicate its own data -- a belt-and-braces fallback; the real v8/v9
  // "primprod"/"primary producer" case is de-duplicated upstream by `flower.ts` and arrives here
  // via `droppedLabels` instead) degrades to "drop the duplicate, draw the rest" rather than
  // blanking the whole flower -- see flowerGeometry.ts.
  const safe = $derived(computeFlowerGeometrySafe(components));
  const geometry = $derived(safe.geometry);
  const roundedCenter = $derived(
    geometry.centerValue !== null ? Math.round(geometry.centerValue) : null,
  );

  // P round deliverable 2: the reference ring -- `maxScore` (`boot.ts#flowerMaxComponentScore`)
  // when the caller has one, else `computeFlowerReferenceRing`'s own fallback. Uses the SAME
  // `innerRadius` `geometry` drew its petals with, so the two can never independently drift.
  const ring = $derived(
    computeFlowerReferenceRing(maxScore, { innerRadius: geometry.innerRadius }),
  );
  const ringLabel = $derived(flowerReferenceRingLabel(ring));
  // the label's own on-screen position: a small inset from the ring's TOPMOST point (never past
  // the ring itself, never past the viewBox edge) so it never clips regardless of how large `ring`
  // is -- a contour label sitting just inside its own line.
  const ringLabelTopPct = $derived((100 - Math.min(ring.radius + 6, 96)) / 2);

  // announce every duplicate-component drop -- the caller's (`droppedLabels`) and any this
  // component caught itself (`safe.droppedKeys`) -- exactly ONCE per distinct set (not on every
  // re-render while the same selection stays active); keyed by the joined, order-preserving list
  // so a genuinely different drop (a different selection) still announces again.
  let announcedDropKey = "";
  $effect(() => {
    const dropped = [...droppedLabels, ...safe.droppedKeys];
    if (dropped.length === 0) return;
    const dropKey = dropped.join("\u0000");
    if (dropKey === announcedDropKey) return;
    announcedDropKey = dropKey;
    announce(`duplicate component skipped: ${dropped.join(", ")}`);
  });

  // built from the SAME geometry the SVG draws (describeFlowerSummary), never re-derived from the
  // raw `components` prop here -- the seeded fault this closes: the summary's "N components" used
  // to count every input including ones with no score, disagreeing with how many petals the ring
  // actually drew.
  const summaryText = $derived(describeFlowerSummary(title, geometry));

  // --- the tap/hover/focus petal label (owner: "values of petal show on click (and for desktop on
  // hover)") ------------------------------------------------------------------------------------
  // `activeKey`: the petal a tap/click or keyboard focus selected -- persists until dismissed
  // (tapping the SAME petal again, or focus/click moving elsewhere); this is also the ONLY thing
  // the purpose-drawn selection stroke (`.petal.active` below) reacts to -- fix round 3's own bug
  // was specifically "the last-TAPPED petal", so the indicator stays scoped to a real
  // tap/click/keyboard selection, never to a mouse merely resting over a petal. `hoveredKey`: a
  // desktop-only, transient LABEL highlight (no stroke) that never needs a dismiss gesture (it
  // clears on its own when the pointer leaves). `activeKey` always wins over a stale hover for the
  // LABEL so a keyboard user's selection is never silently replaced by wherever the mouse happens
  // to be resting.
  let activeKey = $state<string | null>(null);
  let hoveredKey = $state<string | null>(null);
  // was THIS element already focused at the moment the current click's pointer went down --
  // captured in `onmousedown` (which always fires before `focus`/`click`) because `focus` does not
  // re-fire for an element that is already focused: without this, a second tap on an
  // already-active petal is indistinguishable from the first tap that just focused it (both see
  // `activeKey === p.key` by the time `onclick` runs).
  let wasFocusedBeforeClick = false;

  // "(hover: hover) and (pointer: fine)" -- the brief's own gate: a touch device (no true hover)
  // must never get a phantom label stuck on screen from the last thing a finger happened to pass
  // over.
  let supportsHover = $state(false);
  $effect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    supportsHover = mq.matches;
    const onChange = () => (supportsHover = mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  });

  const shownKey = $derived(activeKey ?? hoveredKey);
  const shownPetal = $derived<FlowerPetal | null>(
    geometry.petals.find((p) => p.key === shownKey) ?? null,
  );

  function selectPetal(p: FlowerPetal, e: MouseEvent) {
    if (wasFocusedBeforeClick && activeKey === p.key) {
      // second tap/click on the already-active petal: dismiss (also drop focus so no stray
      // highlight lingers on an element the user just closed).
      activeKey = null;
      (e.currentTarget as SVGElement).blur();
    } else {
      activeKey = p.key;
    }
  }
</script>

<figure class="flower" style={`--flower-size: ${size}px`} aria-describedby={summaryId}>
  <figcaption class="flower-title" class:sr-only={titleInHeader}>{title}</figcaption>

  <div class="flower-body">
    <div class="flower-chart">
      <svg
        class="flower-svg"
        viewBox={flowerViewBox()}
        role="group"
        aria-label={`Composite mean ${roundedCenter !== null ? roundedCenter : "no data"}, reference ${ringLabel}`}
      >
        <!-- role="group" (never "img") on the SVG above: an "img" role makes its whole subtree
             presentational, which is exactly what swallowed each petal's own name (axe
             aria-prohibited-attr: aria-label on a role-less <path> is prohibited in the first
             place, but even fixing that alone would still leave every petal unreachable as long as
             the ancestor kept role="img"). Each petal below gets its OWN role="img" (a single
             static shape with one accessible name) so its aria-label is valid AND individually
             exposed in the accessibility tree; the tap/hover/focus behavior added in fix round 3
             only ever reveals the SAME name+score this aria-label already carries, so role="img"
             (rather than a widget role) still describes what assistive tech is told. -->

        <!-- P round deliverable 2: the reference ring, drawn BEFORE the petals so a petal that
             reaches it (score === maxScore) paints cleanly over the dashed line rather than the
             line drawing a visible seam across the topmost petal. Decorative (aria-hidden): the
             SAME value is already stated in the group's own aria-label above and in the visible
             `.ring-label` beside it -- never a THIRD, competing source of this number. -->
        <circle
          cx="100"
          cy="100"
          r={ring.radius}
          class="reference-ring"
          data-testid="flower-reference-ring"
          data-ring-value={ring.value}
          aria-hidden="true"
        />
        {#each geometry.petals as p (p.key)}
          <!-- data-cx/data-cy below: this petal's own on-screen (viewBox) centroid (petalCentroid --
               flowerGeometry.ts), so e2e/scores.flower.spec.ts can probe the exact pixel a petal's
               colored annular band covers via `SVGGraphicsElement.getScreenCTM()` rather than
               parsing `d` or trusting a computed-style read that cannot tell "defined" from
               "covered by the hub" apart (the gap the reported defect slipped through). -->
          {@const c = petalCentroid(p, 100, 100)}
          <!-- a <path> has no native interactive role, so svelte-check's a11y rule does not
               recognize tabindex+role="img"+aria-label (nor the click/hover handlers fix round 3
               adds to reveal the SAME info visually) as the correct pattern here -- there is no
               more accurate native element or role to reach for. -->
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <path
            d={p.path}
            class="petal"
            class:active={p.key === activeKey}
            style={`fill: var(${p.category.color})`}
            tabindex="0"
            role="img"
            aria-label={petalLabelText(p)}
            data-cx={c.x}
            data-cy={c.y}
            onmousedown={(e) => {
              wasFocusedBeforeClick = document.activeElement === e.currentTarget;
            }}
            onclick={(e) => selectPetal(p, e)}
            onfocus={() => (activeKey = p.key)}
            onblur={() => {
              if (activeKey === p.key) activeKey = null;
            }}
            onmouseenter={() => {
              if (supportsHover) hoveredKey = p.key;
            }}
            onmouseleave={() => {
              if (hoveredKey === p.key) hoveredKey = null;
            }}
          >
            <title>{petalLabelText(p)}</title>
          </path>
        {/each}
        <circle cx="100" cy="100" r={geometry.innerRadius} class="hub" />
        <!-- P3 fix (Opus eyes-on review, 2026-09-24, phone-07/desktop-07, new with the bigger
             flower): the hub number's own glyph feet used to poke out below the `.petal-label`
             HTML overlay (below) as two white stubs -- the SVG number and the HTML chip are drawn
             in different layout systems (viewBox units vs. percentage-centered CSS), so the chip's
             content-sized box was never guaranteed to fully cover the wider glyph footprint the
             bigger flower's larger hub renders. The composite mean is already stated in this SVG
             group's own `aria-label` above AND, while a petal label is showing, in that same
             chip's text -- so the simplest fix is to never draw both at once, rather than try to
             out-guess the chip's box against every possible number's glyph metrics. -->
        {#if !shownPetal}
          <text x="100" y="100" text-anchor="middle" dy="0.35em" class="hub-text">
            {roundedCenter !== null ? roundedCenter : "—"}
          </text>
        {/if}
      </svg>

      <!-- the ring's own small "contour label" (Ben: "stated with a small label (also gray, like a
           topographic contour label)") -- an HTML overlay, not SVG <text>, so its contrast is
           against this component's own OPAQUE surface token regardless of which petal happens to
           sit behind the ring at this angle (an SVG <text> here would sit over whatever colored
           petal reaches this high, an untestable/uncheckable contrast pair). Purely visual: the
           SAME value is already in the SVG group's own aria-label above. -->
      <div class="ring-label" style={`top: ${ringLabelTopPct}%`} aria-hidden="true">
        {ringLabel}
      </div>

      {#if shownPetal}
        <!-- purely visual (the SAME text already reaches assistive tech via the petal's own
             aria-label on focus -- see the role="img" comment above) -- never double-announced. -->
        <div class="petal-label" aria-hidden="true">{petalLabelText(shownPetal)}</div>
      {/if}
    </div>

    {#if showTable}
      <!-- R3-B10 (Opus eyes-on review, 2026-09-25, desktop-06-flower-half): with a big flower
           (P round, up to 480px) stacked above a full 8-component table in a docked side panel,
           the "Mean" row -- the LAST row -- landed right at (and half under) the panel's own
           bottom edge, reachable only by scrolling the whole panel body, which gave no visible
           scroll affordance in that screenshot. A bounded, its OWN `overflow-y: auto` region
           (same pattern as `SpeciesTable.svelte`'s `.scroll-region`) keeps the table's total
           height predictable regardless of how tall the panel/flower happen to be, and its own
           border + scrollbar make "there is more below" visible on sight rather than only on
           scroll.

           R3-W3b (CI run 36158947685, axe scrollable-region-focusable): this box scrolls
           independently of the panel (max-height + overflow-y above) but had no way to reach it
           by keyboard -- a mouse/touch user could scroll it, a keyboard-only user could not. Named
           via aria-labelledby to the table's own <caption> (below) rather than a fresh aria-label,
           so the region's accessible name and the table's own name can never drift apart. The
           visible focus ring is the SAME token/shape every other keyboard-focusable scroll region
           in this app uses (`Sheet.svelte`'s `.sheet-body`, `Panel.svelte`'s `.panel-surface`):
           `outline: 2px solid var(--focus-ring); outline-offset: -2px;`. svelte-check's own a11y
           rule does not know the role="region" + aria-labelledby exception, hence the ignore
           below (same as Sheet.svelte's .sheet-body). -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div class="flower-table-scroll" tabindex="0" role="region" aria-labelledby={tableCaptionId}>
        <table class="flower-table" id={tableId}>
          <caption class="sr-only" id={tableCaptionId}>Component scores for {title}</caption>
          <thead>
            <tr>
              <th scope="col"><span class="sr-only">Color</span></th>
              <th scope="col">Component</th>
              <th scope="col">Score</th>
            </tr>
          </thead>
          <tbody>
            {#each safe.keptComponents as c (c.key)}
              <tr>
                <td class="swatch-cell">
                  <span class="swatch" style={`background: var(${categoryFor(c.key).color})`}
                  ></span>
                </td>
                <td>{categoryFor(c.key).label}</td>
                <td class="num">{c.score === null ? "No data" : formatScore(c.score)}</td>
              </tr>
            {/each}
            <tr class="mean-row">
              <td class="swatch-cell"></td>
              <th scope="row">Mean</th>
              <td class="num">{roundedCenter !== null ? roundedCenter : "No data"}</td>
            </tr>
          </tbody>
        </table>
      </div>
    {/if}
  </div>

  <!-- SC 1.1.1's "text summary" alongside the chart's own table equivalent -- the table above
       (real <table>, real <th> headers) already IS an accessible equivalent, so this sentence is
       screen-reader-only rather than a second, visible copy of the same numbers (the duplicate
       "Cell ID: … (x:, y:)" header the owner reported: the figcaption above already states it
       once). -->
  <p class="summary sr-only" id={summaryId}>{summaryText}</p>
</figure>

<style>
  .flower {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    /* owner (phone, 390px): "Flower plot should be centered" -- `width: 100%` gives `margin: 0
       auto` a DEFINITE box to centre (never a shrink-to-fit one, which could grow as wide as the
       unwrapped summary sentence and overflow a narrow panel) rather than the default flex
       `align-items: stretch`, which fills up to `max-width` and then sits flush at the cross-axis
       start once the panel is wider than that cap. */
    width: 100%;
    margin: 0 auto;
    /* W5 fix (Opus 5.5 eyes-on review 5, 2026-09-25, phone-06/07): the size cap used to live HERE,
       on the whole figure (title + chart + table) -- at the phone half detent's compact cap
       (`FlowerPanel.svelte`'s `FLOWER_SIZE_HALF_DETENT`, 170px) that squeezed the `.flower-title`
       figcaption into the SAME 170px column as the chart, wrapping "Cell ID: ... (x: ..., y: ...)"
       onto two lines and starting it well right of the sheet's own gutter (the whole figure, cap
       included, is centred by the `margin: 0 auto` above). The cap now lives on `.flower-body`
       alone (below) -- the header spans this figure's own full width (unconstrained here), and
       only the chart+table stay capped and centred beneath it. */
  }

  .flower-title {
    font-family: var(--font-display);
    font-size: var(--text-lg);
    letter-spacing: var(--tracking-display);
  }

  .flower-body {
    display: flex;
    flex-direction: column;
    /* the other half of the centering fix: a bare <svg> is a `display: inline` replaced element
       by default, so without this it sits flush at the inline-start (left) edge of this
       full-width wrapper -- exactly the "empty space on the right" the owner saw. */
    align-items: center;
    gap: var(--space-2);
    /* W5 fix: the size cap moved here from `.flower` above (see that rule's own comment) -- same
       `width: 100%; margin: 0 auto;` pairing that centers a capped flex item in a column flex
       parent (`.flower`'s own header comment explains why `margin: auto` alone is not enough
       without a definite `width` to centre against). Tracks `size` directly (the SAME custom
       property `.flower-svg`'s own max-width reads), so the chart+table grow together, independent
       of the title's own now-uncapped width. */
    width: 100%;
    margin: 0 auto;
    max-width: var(--flower-size, 320px);
  }

  .flower-chart {
    position: relative;
    /* P round: `width: 100%` (a `.flower-body` flex child, `align-items: center` -- a cross-axis
       item shrinks to its CONTENT's width by default, never stretches) so `.flower-svg` below has
       a real, non-circular width to compute its own `width: 100%` against, rather than the two
       trying to size off each other. `.petal-label`/`.ring-label`'s 50%/50% below still line up
       with the hub/ring: both track THIS box, which now exactly matches the svg's own rendered
       size (both are `width: 100%` of the same chain), whatever `--flower-size` resolves to. */
    display: block;
    width: 100%;
  }

  .flower-svg {
    /* P round: no more `width`/`height` attributes on the element (those pinned the rendered size
       to a literal px value no matter how much room the panel had -- the actual bug behind "stays
       ~105-130px on a 1280px stage"). Fills its container up to `--flower-size` (the `size` prop,
       default 480) and shrinks below that on a narrow phone sheet -- `aspect-ratio` keeps it square
       with no explicit width/height attribute to derive that from (the viewBox is always square). */
    display: block;
    width: 100%;
    max-width: var(--flower-size, 220px);
    aspect-ratio: 1 / 1;
    height: auto;
  }

  /* the reference ring (P round deliverable 2): a dashed, LOW-CONTRAST line -- decoration, not
     data a viewer reads off directly (the value is in `.ring-label` beside it and the group's own
     aria-label) -- so `--border-control` (already the "quiet outline" token, e.g. the flower
     table's own row borders use `--divider`, its sibling) rather than a `--cat-*`/`--focus-ring`
     color that would read as a selected/active state. */
  .reference-ring {
    fill: none;
    stroke: var(--border-control);
    stroke-width: 1;
    stroke-dasharray: 4 3;
    opacity: 0.6;
  }

  /* the ring's own small label -- "like a topographic contour label" (Ben): quiet grey text on an
     OPAQUE chip (never bare over the chart, where a colored petal could sit behind it at this
     angle and make its contrast unpredictable/untestable). `--text-secondary`/`--surface-raised`
     is the SAME already-checked pair `.note`/`.petal-label` use elsewhere in this file. */
  .ring-label {
    position: absolute;
    left: 50%;
    transform: translate(-50%, -50%);
    padding: 1px var(--space-1);
    border-radius: var(--radius-control);
    background: var(--surface-raised);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    line-height: 1.2;
    white-space: nowrap;
    pointer-events: none;
  }

  /* full opacity: scripts/contrast.mjs measures each --cat-* token AS COMMITTED in tokens.css --
     compositing it at 0.85 here over --surface-panel-basis after the fact would have shipped a
     color the gate never actually checked. Ship the measured color. */
  .petal {
    stroke: var(--surface-panel);
    stroke-width: 1;
    cursor: pointer;
    /* NEVER the UA/default outline: `outline` on an SVG `<path>` always paints the element's
       BOUNDING BOX, not its actual annular-sector shape -- the "solid blue rectangle" the owner
       saw around the last-tapped petal. Unconditional (not just on :focus-visible) so no browser
       state can reintroduce it. The purpose-drawn indicator below (a thicker STROKE, which DOES
       follow the path's own geometry) replaces it. */
    outline: none;
  }

  .petal.active,
  .petal:focus-visible {
    stroke: var(--focus-ring);
    stroke-width: 3;
  }

  .petal-label {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    max-width: 90%;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-control);
    background: var(--surface-raised);
    border: 1px solid var(--border-control);
    color: var(--text-primary);
    font-size: var(--text-sm);
    font-weight: 600;
    text-align: center;
    pointer-events: none;
  }

  .hub {
    fill: var(--surface-raised);
    stroke: var(--border-control);
    stroke-width: 1;
  }

  .hub-text {
    fill: var(--text-primary);
    font-family: var(--font-display);
    font-size: 28px;
    font-weight: 700;
  }

  /* R3-B10: bounds the table's own height so it never depends on how much of the panel's total
     height the flower ABOVE it already used -- the last row (Mean) is then always reachable by
     scrolling this small, visibly-bordered box, not the whole panel. 260px comfortably fits the
     header plus ~6 rows at this font-size before it starts scrolling. */
  .flower-table-scroll {
    width: 100%;
    max-height: 260px;
    overflow-y: auto;
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
  }

  /* R3-W3b: same focus-ring token/shape as Sheet.svelte's .sheet-body and Panel.svelte's
     .panel-surface -- the app's one established pattern for a keyboard-focusable scroll region. */
  .flower-table-scroll:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .flower-table {
    border-collapse: collapse;
    width: 100%;
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }

  .flower-table th,
  .flower-table td {
    padding: var(--space-1) var(--space-2);
    text-align: left;
    border-bottom: 1px solid var(--divider);
  }

  .flower-table .swatch-cell {
    width: 1em;
    padding-right: 0;
  }

  .swatch {
    display: inline-block;
    width: 0.75em;
    height: 0.75em;
    border-radius: 2px;
  }

  .flower-table .num {
    text-align: right;
  }

  .flower-table .mean-row {
    font-weight: 700;
  }

  .summary {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }

  /* visually hidden but still in the accessibility tree. */
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
