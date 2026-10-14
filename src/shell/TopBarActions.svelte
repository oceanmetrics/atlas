<script lang="ts">
  // The top bar's right end: Feedback + About (desktop), and the phone ⋯ overflow menu that carries
  // Share/Download/Feedback/About/Tour/Docs/Theme (those are `topbar-desktop-only` otherwise, and
  // so unreachable on a phone).
  //
  // Feedback stays behind ONE function boundary (`onFeedbackClick`, Shell.svelte's `openFeedback`):
  // a click opens the dialog and `handleFeedback` calls `preventDefault()` so the tab never also
  // navigates to the issue-link fallback in the background. The phone "Take a tour" item runs the
  // SAME `onTakeTour` the desktop Help menu uses -- this file never imports `./tourRuntime`/driver.js
  // itself, keeping that dynamic import's lazy-loading boundary exactly where it is.
  //
  // tests/shell/shell-invariants.test.ts scans this file (alongside Shell.svelte) for its
  // data-control/data-tour anchors and the "no history.pushState" invariant.
  import { onMount, tick } from "svelte";
  import Icon from "../lib/ui/Icon.svelte";
  import About from "./About.svelte";
  import { nextRovingIndex } from "../lib/ui/roving";
  import { uid } from "../lib/ui/uid";

  interface Props {
    appVersion: string;
    feedbackHref: string;
    onFeedbackClick: (e: MouseEvent) => void;
    onShare: () => void;
    /** the Help menu's own "Docs" destination (Shell.svelte's `docsHref`) -- the phone ⋯ menu's
     * "Docs" item opens this directly rather than toggling Shell.svelte's Help disclosure, which
     * is `topbar-desktop-only` and so invisible at the width the ⋯ menu itself only exists at.
     * UI-16 (round 3): the About modal's own "Documentation" link now uses THIS, the release's
     * versioned Atlas chapter -- it used to be a hardcoded `marinesensitivity.org/docs/` (the book
     * root), while the Help menu right next to it already linked the real chapter. */
    helpDocsHref: string;
    /** the About modal's "What changed" -- the app's CHANGELOG. */
    changelogHref: string;
    /** starts the SAME guided tour the desktop Help menu's "Take a tour" item starts
     * (Shell.svelte's `onHelpTakeTour`, passed through verbatim) -- the phone ⋯ menu's own
     * "Take a tour" item. */
    onTakeTour: () => void;
    /** P5 fix round 2 (coordinator finding, 390px eyes-on evidence): the desktop theme toggle
     * (Shell.svelte's own button) is now `topbar-desktop-only` -- its own width was what pushed
     * the theme button itself, and everything after it, past the phone viewport's right edge once
     * the P1 search button was added beside it. `resolvedTheme` mirrors Shell.svelte's own
     * `$derived` (never re-resolved here from `sel`/`prefersDark`); `onToggleTheme` is its
     * `toggleTheme`, passed through verbatim, same convention as `onTakeTour` above. */
    resolvedTheme: "navy" | "paper";
    onToggleTheme: () => void;
    /** R3-W2: opens `DownloadMenu.svelte`'s own phone Modal (`bind:this` on that component,
     * `openPhoneModal()`) -- see that file's header for why the phone route is a Modal rather than
     * a second Menu instance nested inside this one. */
    onOpenDownload: () => void;
  }

  let {
    appVersion,
    feedbackHref,
    onFeedbackClick,
    onShare,
    helpDocsHref,
    changelogHref,
    onTakeTour,
    resolvedTheme,
    onToggleTheme,
    onOpenDownload,
  }: Props = $props();

  // --- About popover-dialog -----------------------------------------------------------------
  let aboutOpen = $state(false);

  // --- Send feedback: a real <a>, not only a button (Deliverable 4's original zero-JS rationale,
  // carried over from the old on-map link -- `feedbackHref` still works with JS disabled/failed).
  // U3 (round 2): `onFeedbackClick` is now Shell.svelte's `openFeedback` (the dialog, not a plain
  // navigation) -- `preventDefault()` first, same as U3's own "Report a problem" anchor, so a
  // normal click opens ONLY the dialog and never also navigates the tab to the GitHub fallback
  // link in the background.
  function handleFeedback(e: MouseEvent) {
    e.preventDefault();
    onFeedbackClick(e);
  }

  // --- phone ⋯ overflow menu: role="menu"/"menuitem", roving tabindex (the same `roving.ts` the
  // rail uses), Esc closes and returns focus to the trigger, a click outside also closes. --------
  let moreOpen = $state(false);
  let moreTriggerEl: HTMLButtonElement | undefined;
  let moreMenuEl: HTMLDivElement | undefined = $state();
  let moreRovingIndex = $state(0);
  const moreMenuId = uid("more-menu");

  interface MoreItem {
    label: string;
    icon:
      | "share"
      | "download"
      | "report"
      | "feedback"
      | "info"
      | "help"
      | "tour"
      | "themeSun"
      | "themeMoon";
    run: (e: MouseEvent) => void;
    href?: string;
  }
  // R2, round 2: "Help" split into its two destinations ("Take a tour" / "Docs") so the tour is
  // actually reachable on the phone -- see this file's header comment. Order: Share, Download,
  // Feedback, About, Take a tour, Docs, Theme -- e2e/shell.chrome.spec.ts asserts
  // this exact item-name list. "Theme" (P5 fix round 2) is last, mirroring its own rightmost
  // position in the desktop topbar; "Download" (R3-W2) sits right after "Share", mirroring ITS own
  // rightmost-of-the-left-group position in the desktop topbar.
  //
  // UI-16 (round 3, Opus 5.5 eyes-on review): "Report" DROPPED from this menu -- the desktop top
  // bar has never had a Report item here (Report is a rail tool, not a top-bar action, on both
  // viewports), so this menu carrying one was the one thing that did NOT match its desktop
  // equivalent. `onReportTop` is kept as a prop (Shell.svelte's own mount line is unchanged, so
  // reinstating a Report row later is a one-line revert) but nothing in this file calls it now.
  const moreItems = $derived<MoreItem[]>([
    { label: "Share", icon: "share", run: () => onShare() },
    { label: "Download…", icon: "download", run: () => onOpenDownload() },
    { label: "Feedback", icon: "feedback", run: handleFeedback, href: feedbackHref },
    { label: "About", icon: "info", run: () => (aboutOpen = true) },
    // `run` (not `href`): starts the tour directly, same as the desktop Help menu's own button --
    // never a link, so no `<a>`/no-op split like Docs below.
    // P7 (Opus eyes-on assessment, 2026-09-24): this used to reuse the "help" (?) glyph, so "Take
    // a tour" and "Docs" (below) were visually identical rows in this menu -- its own `icon` name
    // (icon-map.json's `mdiCompassOutline`, added by this fix via
    // `scripts/build-icon-paths.mjs`), distinct from Docs' "help" glyph just below.
    { label: "Take a tour", icon: "tour", run: () => onTakeTour() },
    // a real <a>, same as Feedback above -- opens the SAME docs link the desktop Help menu's own
    // "Docs" item does (Shell.svelte's `docsHref`), rather than toggling that disclosure itself
    // (invisible at the width this ⋯ menu only exists at -- see helpDocsHref's own doc comment).
    // `run` is a no-op: the `<a href target="_blank">` below does the whole job on its own.
    { label: "Docs", icon: "help", run: () => {}, href: helpDocsHref },
    // P5 fix round 2: the SAME vocabulary/icon-swap as the desktop button (this file's own
    // `resolvedTheme` doc comment) -- "the DESTINATION theme", never "navy"/"paper".
    {
      label: resolvedTheme === "navy" ? "Switch to light theme" : "Switch to dark theme",
      icon: resolvedTheme === "navy" ? "themeSun" : "themeMoon",
      run: () => onToggleTheme(),
    },
  ]);

  async function openMore() {
    moreOpen = true;
    moreRovingIndex = 0;
    await tick();
    moreMenuEl?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }

  function closeMore() {
    if (!moreOpen) return;
    moreOpen = false;
    moreTriggerEl?.focus();
  }

  function onMoreItemClick(item: MoreItem, e: MouseEvent) {
    closeMore();
    item.run(e);
  }

  function onMenuKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMore();
      return;
    }
    const items = moreMenuEl?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    if (!items || items.length === 0) return;
    const current = [...items].indexOf(document.activeElement as HTMLElement);
    const next = nextRovingIndex(current === -1 ? 0 : current, items.length, event.key, "vertical");
    if (next === null) return;
    event.preventDefault();
    moreRovingIndex = next;
    items[next]?.focus();
  }

  function onDocumentPointerdown(event: PointerEvent) {
    if (!moreOpen) return;
    const target = event.target as Node;
    if (moreMenuEl?.contains(target) || moreTriggerEl?.contains(target)) return;
    moreOpen = false; // dismissed by clicking elsewhere -- focus was already elsewhere
  }

  onMount(() => {
    document.addEventListener("pointerdown", onDocumentPointerdown);
    return () => document.removeEventListener("pointerdown", onDocumentPointerdown);
  });
</script>

<!-- owner review item 5 (live 0.10.62): icon-only + a CSS hover/focus tooltip (shell.css's
     `.tool[data-tooltip]` rule, shared with Shell.svelte's Share/Help) -- `aria-label` keeps the
     SAME accessible name the visible "Feedback" text used to give. -->
<a
  class="tool topbar-desktop-only"
  data-tour="feedback"
  data-control="feedback"
  aria-label="Feedback"
  data-tooltip="Feedback"
  href={feedbackHref}
  target="_blank"
  rel="noopener"
  onclick={handleFeedback}
>
  <Icon name="feedback" size={18} />
</a>

<button
  type="button"
  class="tool topbar-desktop-only"
  data-tour="about"
  data-control="about"
  aria-label="About"
  aria-haspopup="dialog"
  data-tooltip="About"
  onclick={() => (aboutOpen = true)}
>
  <Icon name="info" size={18} />
</button>

<button
  type="button"
  class="tool topbar-phone-only"
  data-tour="more"
  data-control="more-menu"
  aria-label="More: Share, Download, Feedback, About, Take a tour, Docs, Theme"
  aria-haspopup="menu"
  aria-expanded={moreOpen}
  bind:this={moreTriggerEl}
  onclick={() => (moreOpen ? closeMore() : openMore())}
>
  <Icon name="more" size={18} />
</button>

<!-- always rendered (never {#if moreOpen}), toggled with `hidden` -- `aria-controls` on the ⋯
     trigger above must reference an element that actually EXISTS in the DOM at all times (SC
     4.1.2); axe's `aria-valid-attr-value` rule flags exactly the {#if}-gated version (measured:
     "Unable to determine if aria-controls referenced ID exists... while using aria-haspopup").
     Same fix as Popover.svelte/Accordion.svelte's own identical rule. -->
<div
  class="more-menu"
  id={moreMenuId}
  role="menu"
  aria-label="More"
  tabindex="-1"
  hidden={!moreOpen}
  bind:this={moreMenuEl}
  onkeydown={onMenuKeydown}
>
  {#each moreItems as item, i (item.label)}
    {#if item.href}
      <a
        class="more-item"
        role="menuitem"
        tabindex={i === moreRovingIndex ? 0 : -1}
        href={item.href}
        target="_blank"
        rel="noopener"
        onclick={(e) => onMoreItemClick(item, e)}
      >
        <Icon name={item.icon} size={16} /><span>{item.label}</span>
      </a>
    {:else}
      <button
        type="button"
        class="more-item"
        role="menuitem"
        tabindex={i === moreRovingIndex ? 0 : -1}
        onclick={(e) => onMoreItemClick(item, e)}
      >
        <Icon name={item.icon} size={16} /><span>{item.label}</span>
      </button>
    {/if}
  {/each}
</div>

<About
  open={aboutOpen}
  onclose={() => (aboutOpen = false)}
  {appVersion}
  {helpDocsHref}
  {changelogHref}
/>

<style>
  /* an explicit `[hidden]` override: this element sets its OWN `display` (flex, for the column
     layout below), and an author style with higher specificity than the plain `.more-menu` rule
     is needed to win over it -- the UA stylesheet's `[hidden] { display: none }` is lowest
     priority regardless of specificity, so without this the menu would stay visible (`display:
     flex`) even while `hidden` -- see this component's own header comment for why it is always
     rendered, never `{#if moreOpen}`, and toggled with `hidden` instead. */
  .more-menu[hidden] {
    display: none;
  }

  .more-menu {
    position: absolute;
    top: calc(100% + var(--space-2));
    right: var(--space-2);
    z-index: 25;
    display: flex;
    flex-direction: column;
    min-width: 220px;
    padding: var(--space-1);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-card);
    background: var(--surface-raised);
    box-shadow: var(--elev-3);
  }

  .more-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    height: var(--size-touch);
    padding: 0 var(--space-3);
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    text-decoration: none;
    text-align: left;
    cursor: pointer;
  }
  .more-item:hover {
    background: var(--fill-control);
  }
  .more-item:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }
</style>
