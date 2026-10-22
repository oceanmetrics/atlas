<script lang="ts">
  // atlas-3 spec.md §5.3/§10/§5.4: the phone bottom sheet -- peek / half / full, a wave top edge,
  // a grab handle, and the SAME three header controls as a desktop Panel (spec.md §5.3), sized for
  // touch. Unlike Panel, collapsing to peek does not swap the sheet for a different component: the
  // header (grab handle, title, the three controls) stays visible at every detent, so "collapse"
  // here is itself one of the three detents, not a disclosure to something else.
  import { onMount, tick, type Snippet } from "svelte";
  import Icon from "./Icon.svelte";
  import {
    DEFAULT_SHEET_DETENT,
    loadSheetDetent,
    saveSheetDetent,
    type SheetDetent,
    type SheetGeometry,
  } from "./sheetGeometry";

  interface Props {
    /** used for the localStorage key and the body's element id */
    id: string;
    title: string;
    children: Snippet;
    /** P1 fix: a compact, non-scrolling row rendered directly under the header (grab handle +
     * title/controls), above the scrolling body -- real layout space, not an overlay, so it can
     * never cover the header's own controls nor get lost in the scrolling content. Shell.svelte
     * uses this to move the phone legend chip INSIDE the sheet at the "full" detent. */
    headerExtra?: Snippet;
    /** reports the sheet's current detent + measured height on every change (mirrors Panel.svelte's
     * own `ongeometry`) -- Shell.svelte uses this to keep the floating legend chip anchored to the
     * sheet's REAL top edge instead of a fixed offset that used to land on the header controls at
     * "peek" and the last table row at "half" (Ben's phone report, 2026-09-24). */
    ongeometry?: (geometry: SheetGeometry) => void;
    /** R3-W8 item 3: same restoration Panel.svelte's `initialGeometryOverride` provides, for the
     * phone's own detent. Applied once, on mount, on top of the loaded (or default) detent. */
    initialDetentOverride?: SheetDetent | null;
  }

  let { id, title, children, headerExtra, ongeometry, initialDetentOverride }: Props = $props();

  const bodyId = $derived(`sheet-body-${id}`);
  const titleId = $derived(`sheet-title-${id}`);
  let detent = $state<SheetDetent>(DEFAULT_SHEET_DETENT);
  let rootEl: HTMLElement | undefined;
  // P1 fix: the sheet's real rendered height (svh-based CSS, not a JS-known number) -- Svelte's
  // built-in `bind:offsetHeight` keeps this current across a detent change AND any future
  // drag-resize, without this component needing to duplicate its own height formula elsewhere.
  let measuredHeight = $state(0);

  $effect(() => {
    ongeometry?.({ detent, height: measuredHeight });
  });

  function storage(): Storage | null {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }

  onMount(() => {
    detent = initialDetentOverride ?? loadSheetDetent(storage(), id);
    // Esc-inside-the-sheet-collapses-it is a keyboard shortcut for the whole sheet, wired
    // imperatively for the same reason Panel.svelte's identical handler is (a template
    // `onkeydown` on this non-interactive element trips svelte-check's a11y rule).
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && detent !== "peek") {
        event.preventDefault();
        collapseToPeek();
      }
    };
    rootEl?.addEventListener("keydown", handleKeydown);
    return () => rootEl?.removeEventListener("keydown", handleKeydown);
  });

  function setDetent(next: SheetDetent) {
    detent = next;
    saveSheetDetent(storage(), id, next);
  }

  // SC 2.4.3 (Focus Order): moves focus to the collapse control itself before/after the detent
  // changes -- without this, Esc left focus on whatever had it inside the now-hidden body (peek
  // hides .sheet-body via `display: none`), which strands it on an element no longer in the
  // accessibility tree, and the next Tab press starts from nowhere predictable. Mirrors
  // Panel.svelte's collapse() moving focus to its own control 1.
  async function collapseToPeek() {
    setDetent("peek");
    await tick();
    rootEl?.querySelector<HTMLButtonElement>('[data-sheet-control="collapse"]')?.focus();
  }
</script>

<section
  class="sheet detent-{detent}"
  aria-labelledby={titleId}
  bind:this={rootEl}
  bind:offsetHeight={measuredHeight}
>
  <div class="sheet-grab" role="separator" aria-label="Drag to resize the sheet"></div>
  <div class="sheet-head">
    <h2 class="sheet-title" id={titleId}>{title}</h2>
    <div class="panel-controls" role="group" aria-label="Sheet size">
      <!-- UI-19 fix (Opus 5.5 eyes-on review, round 3): at "peek" this button used to stay
           "Collapse to a peek" -- already the current detent, so clicking it was a no-op with no
           visual "pressed" state anywhere on the row, unlike "half"/"full" which both frame the
           current detent via `aria-pressed`. It now flips to "Expand to half" at peek, keeping
           this row a real three-way control with no dead button. -->
      <button
        type="button"
        data-sheet-control="collapse"
        aria-expanded={detent !== "peek"}
        aria-controls={bodyId}
        aria-label={detent === "peek" ? "Expand to half" : "Collapse to a peek"}
        data-tooltip={detent === "peek" ? "Expand to half" : "Collapse to a peek"}
        onclick={() => (detent === "peek" ? setDetent("half") : collapseToPeek())}
      >
        <Icon name={detent === "peek" ? "collapseUp" : "collapseDown"} size={18} />
      </button>
      <button
        type="button"
        aria-pressed={detent === "half"}
        aria-label="Half height"
        data-tooltip="Half height"
        onclick={() => setDetent("half")}
      >
        <Icon name="dockBottom" size={18} />
      </button>
      <button
        type="button"
        aria-pressed={detent === "full"}
        aria-label="Full height"
        data-tooltip="Full height"
        onclick={() => setDetent("full")}
      >
        <Icon name="expand" size={18} />
      </button>
    </div>
  </div>
  {#if headerExtra}
    <!-- P1 fix: real flex-row layout space (flex: none, see below), NOT an absolutely-positioned
         overlay -- it pushes `.sheet-body` down instead of covering it. -->
    <div class="sheet-header-extra">
      {@render headerExtra()}
    </div>
  {/if}
  <!-- tabindex="0": a scrollable region with no focusable child of its own must still be
       reachable by keyboard (axe scrollable-region-focusable); svelte-check's own a11y rule does
       not know that exception, hence the ignore below (spec.md §10 asks for exactly this). -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="sheet-body" id={bodyId} role="region" aria-label="{title} details" tabindex="0">
    {@render children()}
  </div>
</section>

<style>
  .sheet {
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--border-control);
    border-radius: var(--radius-card) var(--radius-card) 0 0;
    background: color-mix(in srgb, var(--surface-panel) var(--glass-opacity), transparent);
    backdrop-filter: blur(var(--glass-blur));
    box-shadow: var(--elev-3);
    overflow: hidden;
    position: relative;
    height: var(--size-sheet-half);
  }

  .sheet.detent-peek {
    height: var(--size-sheet-peek);
  }

  /* B4 fix (docs/usability.md, shell.css's own header on `.panel-region`): a flat `92svh` grew
     the sheet back down over the tool rail's own reserved row -- `--size-rail-row` (set by
     shell.css on this element's parent, `.panel-region`, so it inherits here) is that row's exact
     height; `--size-topbar` is the one other fixed chrome above the sheet. Both default to `0px`
     so this degrades to the old, simpler `92svh` if ever rendered somewhere neither custom
     property is defined (never happens today -- Sheet.svelte only ever mounts on the phone
     layout, inside `.panel-region`). */
  .sheet.detent-full {
    height: min(92svh, calc(100svh - var(--size-topbar, 0px) - var(--size-rail-row, 0px)));
  }

  /* the sheet's upper edge is the wave (guide p. 10) */
  .sheet::before {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    height: var(--motif-wave-height);
    background: var(--motif-color);
    opacity: var(--motif-wave-opacity);
    -webkit-mask: url("@instance/assets/motifs/wave.svg") repeat-x center / auto 100%;
    mask: url("@instance/assets/motifs/wave.svg") repeat-x center / auto 100%;
    transform: scaleY(-1);
    pointer-events: none;
  }

  .sheet-grab {
    width: 44px;
    height: 4px;
    margin: var(--space-3) auto var(--space-2);
    border-radius: var(--radius-pill);
    background: var(--border-control);
    flex: none;
  }

  .sheet-head {
    position: relative;
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    padding: 0 var(--space-4) var(--space-2);
    flex: none;
  }

  .sheet-title {
    font-family: var(--font-display);
    font-size: var(--text-xl);
    letter-spacing: var(--tracking-display);
    margin: 0;
  }

  /* P1 fix: a real flex-row child (flex: none, own top-to-bottom space) directly under the header
     and above the scrolling body -- never covers the header's own buttons, never scrolls away with
     nothing (it has no scroll of its own; it just occupies its own row). */
  .sheet-header-extra {
    flex: none;
    padding: 0 var(--space-4) var(--space-2);
  }

  .panel-controls {
    display: flex;
    gap: var(--space-1);
    margin-left: auto;
  }

  .panel-controls button {
    display: inline-grid;
    place-items: center;
    width: var(--size-touch);
    height: var(--size-touch);
    border: 1px solid transparent;
    border-radius: var(--radius-control);
    background: none;
    color: var(--icon-muted);
    cursor: pointer;
  }

  .panel-controls button:hover {
    color: var(--text-primary);
    background: var(--fill-control);
  }

  .panel-controls button:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  /* SC 1.4.1: aria-expanded="true" is NOT in this selector -- the collapse control's own
     aria-expanded is true for BOTH the half and full detents (only false at peek), so matching on
     it here painted collapse as pressed alongside whichever detent was actually active, with no
     way to tell them apart (atlas-3 closing review, item 1). */
  .panel-controls button[aria-pressed="true"] {
    color: var(--text-primary);
    border-color: var(--border-control);
    background: var(--fill-control);
  }

  .sheet-body {
    flex: 1;
    overflow: auto;
    padding: 0 var(--space-4) var(--space-4);
  }

  .sheet-body:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .detent-peek .sheet-body {
    display: none;
  }
</style>
