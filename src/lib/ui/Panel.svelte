<script lang="ts">
  // R1 (docs/usability.md §7, owner decision 2026-09-24): ONE dockable panel with drag-resize on the
  // panel's map-facing edge (320-720 px) and collapse to the edge pill.
  //
  // R4-B (owner decision, 2026-09-30): the rail (the spine) is attached to this panel's outer edge
  // and moves with it; the panel docks LEFT by default and swaps to RIGHT with one header button
  // ("dock bottom" and "maximize / full screen" retired -- control-grammar.md rules 4 and 5). A
  // tool that needs the whole stage (Table) passes `fullStage`: the panel then reports
  // `maximized: true` through `ongeometry` (shell.css reads it to fill the stage beside the rail),
  // hides the resize handle, and keeps every other behaviour -- no backdrop, no focus trap, it is
  // an ordinary surface, not a modal. Leaving that tool restores the side dock automatically,
  // because the stored dock/size were never touched.
  //
  // Geometry (collapsed + dock + size) is chrome, remembered per viewport size in localStorage
  // (src/lib/ui/panelGeometry.ts), never the URL. Esc collapses the panel to its pill.
  import { onMount, tick, type Snippet } from "svelte";
  import Icon from "./Icon.svelte";
  import Pill from "./Pill.svelte";
  import {
    clampPanelSize,
    DEFAULT_PANEL_GEOMETRY,
    loadPanelGeometry,
    PANEL_RESIZE_STEP,
    PANEL_RESIZE_STEP_FAST,
    PANEL_SIZE_MAX,
    PANEL_SIZE_MIN,
    savePanelGeometry,
    viewportBucket,
    type Dock,
    type PanelGeometry,
  } from "./panelGeometry";

  interface Props {
    /** used for the localStorage key and the body's element id (the collapse control's
     * aria-controls target) -- must be unique among panels on the page */
    id: string;
    title: string;
    children: Snippet;
    /** R1: this component is the source of truth for its own dock/size/maximized geometry, but
     * shell.css positions `#panel-region` (this component never sets its own position -- see this
     * file's own header) -- so the shell needs to know what that geometry currently is. Called
     * once on mount (the loaded-from-storage value) and again on every change; never read back. */
    ongeometry?: (geometry: PanelGeometry) => void;
    /** R3-W8 item 3: "Share reproduces the UI arrangement" — when a shared link carries a `ui=`
     * token, Shell.svelte passes the dock/size it decoded here so the FIRST geometry this panel
     * ever reports is the restored one, not whatever localStorage happens to remember for this
     * viewport. Applied ONCE, on mount, on top of the loaded (or default) geometry — never
     * overrides `collapsed`/`maximized` (chrome habits the link does not try to reproduce). `null`/
     * omitted keeps the ordinary localStorage-only load (every existing caller). */
    initialGeometryOverride?: { dock: Dock; size: number } | null;
    /** R4-B: the active tool takes the whole stage (Table) -- reported as `maximized: true`. */
    fullStage?: boolean;
  }

  let {
    id,
    title,
    children,
    ongeometry,
    initialGeometryOverride,
    fullStage = false,
  }: Props = $props();

  const bodyId = $derived(`panel-body-${id}`);
  const titleId = $derived(`panel-title-${id}`);
  let rootEl: HTMLDivElement | undefined;
  let geometry = $state<PanelGeometry>(DEFAULT_PANEL_GEOMETRY);

  function storage(): Storage | null {
    try {
      return window.localStorage;
    } catch {
      return null; // private mode / storage disabled: chrome, not correctness
    }
  }

  onMount(() => {
    const loaded = loadPanelGeometry(storage(), id, viewportBucket(window.innerWidth));
    geometry = initialGeometryOverride
      ? {
          ...loaded,
          dock: initialGeometryOverride.dock,
          size: clampPanelSize(initialGeometryOverride.size),
        }
      : loaded;
    report();
    // Esc-inside-a-panel is a keyboard shortcut for the whole panel, not a per-element widget
    // interaction, so it is wired imperatively (not a template `onkeydown` on a non-interactive
    // element, which svelte-check's a11y rule flags -- rightly, for the usual case of a fake
    // button, but this really is a root-level shortcut).
    const el = rootEl;
    el?.addEventListener("keydown", handleKeydown);
    // `focusin` on `document`, not `rootEl` -- a WebKit-only escape (see `onFocusEscape`'s own
    // header) lands the NEW focus target OUTSIDE `rootEl` entirely, so listening on `rootEl` itself
    // would never see it bubble (a `focusin` only bubbles up the TARGET's own ancestor chain).
    return () => {
      el?.removeEventListener("keydown", handleKeydown);
    };
  });

  // what the shell sees: the stored geometry, with `maximized` DERIVED from `fullStage` (R4-B).
  // `mounted` keeps the effect from reporting before the loaded geometry exists.
  let mounted = false;
  function report() {
    mounted = true;
    ongeometry?.({ ...geometry, maximized: fullStage });
  }
  $effect(() => {
    void fullStage;
    if (mounted) report();
  });

  function persist(next: PanelGeometry) {
    // `maximized` is never stored (panelGeometry.ts header) -- the stored copy is always false.
    geometry = { ...next, maximized: false };
    savePanelGeometry(storage(), id, viewportBucket(window.innerWidth), geometry);
    report();
  }

  /** collapse the panel to its pill. `moveFocus: false` (a click on the ACTIVE rail entry) leaves
   * focus on that rail button, matching `expand()`. */
  export async function collapse(moveFocus = true) {
    persist({ ...geometry, collapsed: true });
    if (!moveFocus) return;
    await tick();
    rootEl?.querySelector<HTMLButtonElement>(".panel-pill")?.focus();
  }

  // usability M3: a rail click on a collapsed desktop panel used to do nothing but change the
  // pill's own label -- Shell.svelte's `selectTool()` calls this so a tool switch always shows its
  // panel. No focus move (unlike `restore()`, called from the pill itself): the user's focus
  // stays on the rail button they just activated, matching `armRailFocusRestore`'s own intent.
  // Idempotent -- a no-op when the panel is already open.
  export function expand(): void {
    if (geometry.collapsed) persist({ ...geometry, collapsed: false });
  }

  async function restore() {
    persist({ ...geometry, collapsed: false });
    await tick();
    rootEl?.querySelector<HTMLButtonElement>('[data-panel-control="collapse"]')?.focus();
  }

  /** the one "move to the other side" control (R4-B) -- the rail moves with the panel. */
  function swapSide() {
    persist({ ...geometry, dock: geometry.dock === "left" ? "right" : "left" });
  }

  function setSize(size: number) {
    persist({ ...geometry, size: clampPanelSize(size) });
  }

  // --- resize: drag on the map-facing edge, or arrow keys on the same handle (APG "window
  // splitter" pattern: role="separator", tabindex, aria-value*, arrow-key operable). -------------
  let dragStartPos = 0;
  let dragStartSize = 0;
  let dragging = false;

  function pointerPos(e: PointerEvent): number {
    return e.clientX;
  }

  // the sign a drag delta must be multiplied by so that dragging the handle TOWARD the map always
  // grows the panel, regardless of which edge it sits on (left dock: right edge, growing size as
  // the pointer moves right = "+1"; right dock: left edge, growing size as the pointer moves left
  // = "-1").
  function dragSign(): 1 | -1 {
    return geometry.dock === "left" ? 1 : -1;
  }

  function onHandlePointerDown(e: PointerEvent) {
    if (fullStage) return;
    dragging = true;
    dragStartPos = pointerPos(e);
    dragStartSize = geometry.size;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    window.addEventListener("pointermove", onHandlePointerMove);
    window.addEventListener("pointerup", onHandlePointerUp);
  }

  function onHandlePointerMove(e: PointerEvent) {
    if (!dragging) return;
    const delta = (pointerPos(e) - dragStartPos) * dragSign();
    setSize(dragStartSize + delta);
  }

  function onHandlePointerUp() {
    dragging = false;
    window.removeEventListener("pointermove", onHandlePointerMove);
    window.removeEventListener("pointerup", onHandlePointerUp);
  }

  onMount(() => () => {
    window.removeEventListener("pointermove", onHandlePointerMove);
    window.removeEventListener("pointerup", onHandlePointerUp);
  });

  function onHandleKeydown(e: KeyboardEvent) {
    const step = e.shiftKey ? PANEL_RESIZE_STEP_FAST : PANEL_RESIZE_STEP;
    let delta = 0;
    if (geometry.dock === "left") {
      if (e.key === "ArrowRight") delta = step;
      else if (e.key === "ArrowLeft") delta = -step;
    } else {
      if (e.key === "ArrowLeft") delta = step;
      else if (e.key === "ArrowRight") delta = -step;
    }
    if (delta === 0) return;
    e.preventDefault();
    setSize(geometry.size + delta);
  }

  function handleKeydown(event: KeyboardEvent) {
    // the innermost open layer handles Esc first: if some other open layer (a Select, a Popover)
    // already handled this SAME keydown and called preventDefault() on it, this panel must not
    // ALSO react to it. Esc means "back off one level" -- for the panel, collapse.
    if (event.key !== "Escape" || event.defaultPrevented || geometry.collapsed) return;
    event.preventDefault();
    collapse();
  }
</script>

<div
  class="panel"
  class:panel--collapsed={geometry.collapsed}
  class:panel--full={fullStage}
  data-dock={geometry.dock}
  bind:this={rootEl}
>
  {#if geometry.collapsed}
    <Pill label={title} expanded={false} controls={bodyId} onclick={restore} class="panel-pill" />
  {:else}
    <section
      class="panel-surface"
      class:panel-surface--full={fullStage}
      data-dock={geometry.dock}
      aria-labelledby={titleId}
      tabindex="-1"
    >
      {#if !fullStage}
        <!-- the APG "window splitter" pattern: role=separator, tabindex, aria-value*, arrow-key
             operable -- a legitimate custom widget, not a plain div a11y's rule assumes it is. -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div
          class="resize-handle"
          role="separator"
          aria-label="Resize panel"
          aria-orientation="vertical"
          aria-valuenow={geometry.size}
          aria-valuemin={PANEL_SIZE_MIN}
          aria-valuemax={PANEL_SIZE_MAX}
          aria-controls={bodyId}
          tabindex="0"
          onpointerdown={onHandlePointerDown}
          onkeydown={onHandleKeydown}
        ></div>
      {/if}
      <div class="panel-head">
        <h2 class="panel-title" id={titleId}>{title}</h2>
        <div class="panel-controls" role="group" aria-label="Panel position">
          <!-- R4-B: two controls -- "move to the other side" and collapse. `data-tooltip` equal to
               `aria-label` (UI-11). The swap button's icon points at the side it will move TO. -->
          <button
            type="button"
            data-panel-control="swap-side"
            aria-label={geometry.dock === "left"
              ? "Move panel to the right"
              : "Move panel to the left"}
            data-tooltip={geometry.dock === "left" ? "Move to the right" : "Move to the left"}
            onclick={swapSide}
          >
            <Icon name={geometry.dock === "left" ? "dockRight" : "dockLeft"} size={18} />
          </button>
          <button
            type="button"
            data-panel-control="collapse"
            aria-expanded="true"
            aria-controls={bodyId}
            aria-label="Collapse to a pill"
            data-tooltip="Collapse to a pill"
            onclick={() => collapse()}
          >
            <Icon name={geometry.dock === "left" ? "collapseSideLeft" : "collapseSide"} size={18} />
          </button>
        </div>
      </div>
      <!-- atlas-8 fix: a plain `group` (NOT a landmark role) named by aria-label, still reachable by
           keyboard (tabindex, the scrollable-region-focusable fix Sheet.svelte's own body carries;
           svelte-check's a11y rule does not know that exception). fix list #7 (SC 4.1.2): the name
           is what keeps this tab stop from being announced as nothing. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div class="panel-body" id={bodyId} role="group" aria-label={`${title} details`} tabindex="0">
        {@render children()}
      </div>
    </section>
  {/if}
</div>

<style>
  .panel {
    /* SC 1.4.10 (Reflow): --size-panel (380px) as a fixed width overflowed the viewport at 320px
       CSS width -- max plus 100% lets it shrink on a narrower viewport instead of forcing
       horizontal scroll. 720px (not --size-panel/380): R1's widest dock, PANEL_SIZE_MAX
       (panelGeometry.ts) -- this component is also used with NO `#panel-region` ancestor at all
       (the gallery, src/gallery/sections/Panel.svelte), where `height: 100%` below resolves to
       `auto` (percentage heights never resolve against an auto-height containing block, and the
       gallery's own `.stage` is exactly that) -- so this ceiling is what keeps a resized/dragged
       demo panel from growing unbounded there, the same job --size-panel's ceiling used to do. */
    width: 100%;
    max-width: 720px;
    /* the real app shell's `#panel-region` has a DEFINITE height (top+bottom, both set -- shell.
       css) so this resolves there; the gallery's ancestor does not, so this is simply `auto` there
       (see above) -- either way `.panel-surface`'s own `height: 100%` needs SOMETHING definite to
       resolve against, which is what this supplies when one exists. */
    height: 100%;
  }

  /* R4-B: a full-stage tool (Table) lifts the 720px docked-width cap -- `#panel-region[data-maximized=
     "true"]` (shell.css) spans the stage beside the rail, and this element's own ceiling would
     otherwise keep the content box 720px wide inside that frame. */
  .panel--full {
    max-width: none;
  }

  /* usability M3: collapsed, `.panel` held its FULL width basis (`.panel-region`'s own width,
     shell.css) with the pill left-aligned inside it -- since `.panel-region` is docked at the
     STAGE's right edge, the pill floated near the LEFT edge of that reserved width, mid-top
     (observed: x≈888 of a 1280px viewport), not at the panel's own edge. Shrinking to the pill's
     own content width and pushing it flush right (the side `.panel-region` docks to) puts it where
     a "collapsed to an edge pill" affordance should read: right at the stage's edge. `height:
     fit-content` (not the 100% above): a collapsed panel is a small pill, not a tall invisible box
     that would otherwise sit over the map for the panel's full docked height and steal its clicks. */
  .panel--collapsed {
    width: fit-content;
    height: fit-content;
    margin-left: auto;
  }
  .panel--collapsed[data-dock="right"] {
    margin-left: auto;
    margin-right: 0;
  }

  /* R4-B: the default side is LEFT, so the pill flushes to the rail (the region's left edge);
     dock=right flips it (below). */
  .panel--collapsed[data-dock="left"] {
    margin-left: 0;
    margin-right: auto;
  }

  .panel-surface {
    position: relative;
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    border: 1px solid var(--border-control);
    border-radius: var(--radius-card);
    background: color-mix(in srgb, var(--surface-panel) var(--glass-opacity), transparent);
    backdrop-filter: blur(var(--glass-blur));
    box-shadow: var(--elev-3);
    overflow: hidden;
  }

  .panel-surface:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  /* R4-B full stage: square corners are NOT wanted (the panel stays a card beside the rail);
     shell.css sizes `.panel-region` itself. */
  .panel-surface--full {
    box-shadow: var(--elev-2);
  }

  /* the resize handle sits ON the panel's map-facing edge -- shell.css decides WHICH edge (`[data-
     dock]` on `.panel-region`) by placing this element via `inset`; here it only sizes/cursors
     itself, per this file's own "components size only themselves" convention. */
  .resize-handle {
    position: absolute;
    z-index: 2;
    /* SC 2.5.5: a coarse-pointer target is widened by shell.css's own media query below; this
       base size is the desktop (fine-pointer) one. */
    touch-action: none;
  }

  .resize-handle:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  [data-dock="left"] .resize-handle,
  [data-dock="right"] .resize-handle {
    top: 0;
    bottom: 0;
    width: 6px;
    cursor: ew-resize;
  }
  /* INSIDE the surface's own edge (not straddling it): `.panel-surface` is `overflow: hidden`, so a
     handle centred ON the edge had its outer half clipped -- a pointer at the handle's own
     bounding-box centre hit the map underneath instead (R4-B: the left-docked default put the
     handle's centre just outside the surface's right edge). */
  [data-dock="left"] .resize-handle {
    right: 0;
  }
  [data-dock="right"] .resize-handle {
    left: 0;
  }
  @media (pointer: coarse) {
    [data-dock="left"] .resize-handle,
    [data-dock="right"] .resize-handle {
      width: var(--size-touch);
    }
    [data-dock="left"] .resize-handle {
      right: 0;
    }
    [data-dock="right"] .resize-handle {
      left: 0;
    }
  }

  .panel-head {
    position: relative;
    /* 84px: R4-B's 2 controls (32px + var(--space-1)/4px gap each = 72px) plus the group's own
       `right: var(--space-2)`/8px offset, plus a small buffer. index.html/shell.css's
       `.sk-panel-head` mirrors this number for the CLS gate. */
    padding: var(--space-3) 84px var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--divider);
    flex: none;
  }

  .panel-head::before {
    content: "";
    position: absolute;
    inset: 0;
    background: var(--motif-color);
    opacity: var(--motif-hex-opacity);
    -webkit-mask: url("@instance/assets/motifs/hex.svg") repeat center / var(--motif-hex-size);
    mask: url("@instance/assets/motifs/hex.svg") repeat center / var(--motif-hex-size);
    pointer-events: none;
  }

  .panel-title {
    position: relative;
    font-family: var(--font-display);
    font-size: var(--text-xl);
    letter-spacing: var(--tracking-display);
    margin: 0;
  }

  .panel-controls {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
    display: flex;
    gap: var(--space-1);
  }

  .panel-controls button {
    display: inline-grid;
    place-items: center;
    width: 32px;
    height: 32px;
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

  .panel-controls button:disabled {
    color: var(--icon-inactive);
    cursor: not-allowed;
  }

  @media (pointer: coarse) {
    .panel-controls button {
      width: var(--size-touch);
      height: var(--size-touch);
    }
  }

  .panel-body {
    flex: 1;
    overflow: auto;
    padding: var(--space-3) var(--space-4) var(--space-4);
  }
</style>
