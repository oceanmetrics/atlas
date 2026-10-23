<script lang="ts">
  // atlas-4 step 3 — the welcome modal (parity doc §5.5 modal 2): shown on first paint unless
  // suppressed via localStorage ("Don't show this again"), `?tour=off`, an explicit `?tour=on`
  // (U6, round 2 -- the real tour starts itself instead, see below), or the URL already naming a
  // deep link (M5 fix, docs/usability.md). `tour=off` also hides the tour invitation, since
  // starting one makes no sense when the URL itself says not to.
  //
  // U6 (round 2): "Take a Tour" now calls the real guided tour (`onTakeTour`, Shell.svelte's own
  // `beginTour()` -- driver.js is a lazy chunk Shell.svelte owns loading, never this component)
  // instead of announcing a stub. The modal closes FIRST (same as "Explore" -- it must not cover
  // the tour's first popover) and only then hands off.
  //
  // M5 fix: before this, `tour` was read ONLY to decide whether the "Take a Tour" BUTTON showed —
  // despite this file's own header comment claiming `?tour=off` suppressed the MODAL, nothing here
  // ever checked it for that. A deep link (`?sp=…`, `?sel=…`, `#pl=…`, …) also used to be
  // interrupted by the "first-timer" welcome copy on every load, species deep links included
  // (docs/usability.md's `species-deeplink-bogus-sp-1280-dark.jpg`) — `isDeepLink()`
  // (lib/state/codec.ts) is the SAME "differs from the default view" rule `formatSel` already
  // enforces for what a URL writes, so "this is a deep link" never drifts into a second,
  // hand-rolled definition of the term. Shell.svelte passes only `tour` -- the deep-link AND the
  // explicit-`tour=on` checks read `window.location` directly instead of a new prop, the same
  // self-contained pattern this component already uses for localStorage.
  import { onMount } from "svelte";
  import Modal from "../../lib/ui/Modal.svelte";
  import { WORDMARK_TEXT } from "../../lib/brand/instance";
  import { DOCS_ROOT } from "../../lib/release/docsUrl";
  import { isDeepLink } from "../../lib/state/codec";
  import type { Tour } from "../../lib/state/types";

  const STORAGE_KEY = "atlas.welcome.dontShowAgain";

  interface Props {
    tour: Tour;
    /** U6, round 2: starts the real guided tour (Shell.svelte's `beginTour()`) for the CURRENT
     * lens. Optional so this component still renders (with the modal's plain "Explore" flow) in
     * a context that has not wired it, e.g. an isolated component test. */
    onTakeTour?: () => void;
    /** UI-15 (round-3 review): switches to the Species lens IN PLACE and closes the modal --
     * `Shell.svelte`'s own `onLensChange`, the SAME handler the top-bar lens switch calls, never a
     * second lens-switch path. Optional so this component still renders standalone (component
     * test) without it wired. */
    onSwitchToSpecies?: () => void;
    /** UI-15: this version's own docs URL (`Shell.svelte`'s `docsHref`, `src/lib/release/
     * docsUrl.ts#atlasDocsUrl`'s hand-duplicate) -- never a bare, version-less docs-root guess. */
    docsHref?: string;
    /** UI-15: the resolved release label ("v7"), named in reader copy as "data release {ver}" --
     * replaces the old "published marine-atlas release" wording, which named an internal data-repo
     * concept ("marine-atlas") a reader has no reason to know. `null`/omitted before it resolves. */
    ver?: string | null;
  }

  let { tour, onTakeTour, onSwitchToSpecies, docsHref, ver }: Props = $props();

  function handleSpeciesLens(event: MouseEvent) {
    if (!onSwitchToSpecies) return; // no handler wired (e.g. an isolated component test) -- let
    // the plain href navigate as a fallback rather than doing nothing.
    event.preventDefault();
    close();
    onSwitchToSpecies();
  }

  let open = $state(false);
  let dontShowAgain = $state(false);

  function storage(): Storage | null {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }

  onMount(() => {
    const suppressed = storage()?.getItem(STORAGE_KEY) === "1";
    const deepLink = isDeepLink(location);
    // U6: `?tour=on` explicitly asked for the guided tour, which starts itself (Shell.svelte's own
    // onMount) -- showing the welcome modal on top of/behind it would stack two overlays for no
    // reason. `sel.tour` cannot distinguish "the default" from "an explicit ?tour=on" (both parse
    // to "on" -- codec.ts's `DEFAULT_SEL.tour`), so this reads the query string directly, the same
    // way `isDeepLink` reads `location` above.
    let explicitTourOn = false;
    try {
      explicitTourOn = new URLSearchParams(location.search).get("tour") === "on";
    } catch {
      /* location.search unavailable -- treat as absent, never as an error */
    }
    open = !suppressed && tour !== "off" && !deepLink && !explicitTourOn;
  });

  function close() {
    open = false;
    if (dontShowAgain) {
      try {
        storage()?.setItem(STORAGE_KEY, "1");
      } catch {
        /* private mode / storage disabled — chrome, not correctness */
      }
    }
  }

  function handleTakeTour() {
    close(); // the tour's first popover must not be covered by this modal
    onTakeTour?.();
  }
</script>

<Modal {open} title={`Welcome to the ${WORDMARK_TEXT}`} onclose={close}>
  <p>
    Explore composite marine-sensitivity scores for U.S. federal waters, drawn from data release
    {ver ?? "the current release"} — by Program Area, or by clicking any 0.05° cell.
  </p>
  <p>
    See also the
    <a href="?lens=species" onclick={handleSpeciesLens}>Species lens</a>
    and the
    <a href={docsHref ?? DOCS_ROOT} target="_blank" rel="noopener">documentation</a>.
  </p>
  <label class="dont-show">
    <input type="checkbox" bind:checked={dontShowAgain} />
    Don't show this again
  </label>
  <div class="actions">
    {#if tour !== "off"}
      <button type="button" class="tour-btn" onclick={handleTakeTour}>Take a tour</button>
    {/if}
    <button type="button" class="explore-btn" onclick={close}>Explore</button>
  </div>
</Modal>

<style>
  .dont-show {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: var(--space-3) 0;
    font-size: var(--text-sm);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  .tour-btn,
  .explore-btn {
    height: var(--size-touch);
    padding: 0 var(--space-4);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--fill-control);
    color: var(--text-primary);
    font: inherit;
    cursor: pointer;
  }

  .explore-btn {
    background: var(--fill-accent);
    color: var(--text-on-accent);
    border-color: transparent;
  }

  .tour-btn:focus-visible,
  .explore-btn:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
</style>
