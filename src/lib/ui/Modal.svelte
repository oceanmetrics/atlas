<script lang="ts">
  // atlas-3: focus trap and focus return, Esc closes the top layer -- all three come from the
  // native <dialog> element's showModal(), which the HTML spec requires browsers to implement
  // (top-layer focus containment, Escape fires 'cancel' then 'close', and closing restores focus
  // to whatever had it before showModal() was called). Hand-rolling any of that would only
  // reproduce what the platform already guarantees, less reliably.
  import { onMount, type Snippet } from "svelte";
  import Icon from "./Icon.svelte";
  import { uid } from "./uid";

  interface Props {
    open: boolean;
    title: string;
    children: Snippet;
    /** fired when the dialog closes for ANY reason (the close button, Esc, or a caller-driven
     * `open = false`) -- the caller is expected to set its own `open` state to false here, so a
     * `<dialog>` closed by the platform (Esc) and one closed by the caller stay in sync. */
    onclose?: () => void;
    /** `lg` is for documents (a README with tables); the default suits a short dialog. */
    size?: "md" | "lg";
  }

  let { open, title, children, onclose, size = "md" }: Props = $props();
  let dialogEl: HTMLDialogElement | undefined;
  // per-INSTANCE, not per-title (SC 4.1.2) -- see HexButton.svelte's identical fix.
  const titleId = uid("modal-title");

  $effect(() => {
    if (!dialogEl) return;
    // R3-B4 (Opus eyes-on review, 2026-09-25): `showModal()`'s own default -- focus the first
    // focusable descendant -- landed on the CLOSE BUTTON in every modal here (it is always the
    // first focusable element in the head), so first paint showed a thick gold focus ring around
    // the little "x" nobody asked to interact with yet. Focusing the dialog CONTAINER itself
    // instead (needs `tabindex="-1"` below, since a `<dialog>` is not natively focusable) is the
    // one fix that works for every `Modal` caller without each one having to name its own
    // "primary action" -- a keyboard user's first Tab still lands on the first real control, and
    // `:focus-visible` keeps ringing every focus a keyboard interaction actually produces.
    if (open && !dialogEl.open) {
      dialogEl.showModal();
      dialogEl.focus();
    }
    if (!open && dialogEl.open) dialogEl.close();
  });

  // fix list #2 (SC 2.4.3): `:not(:disabled)` on every selector that can carry it -- the trap
  // below fires only when `document.activeElement === last`, and a DISABLED control (the
  // coordinate dialog's own "Add place", disabled until you type something) can never actually
  // hold focus, so a bare selector that still matched it made `last` unreachable and the trap
  // dead. `isVisible` below additionally filters a HIDDEN one (display:none/visibility:hidden),
  // for the same reason: neither can be the real boundary a Tab cycle should wrap at.
  const FOCUSABLE_SELECTOR =
    "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), " +
    "textarea:not(:disabled), [tabindex]:not([tabindex='-1'])";

  function isVisible(el: HTMLElement): boolean {
    return typeof el.checkVisibility === "function"
      ? el.checkVisibility()
      : el.offsetParent !== null;
  }

  // fix list #1 (SC 2.4.3/3.2.x): attached IMPERATIVELY on the dialog element itself, in
  // onMount -- exactly Popover.svelte's own pattern (see its header comment for the full
  // reasoning). Svelte 5 DELEGATES a template `onkeydown` to the app root: the native keydown has
  // already finished bubbling through every REAL ancestor listener (including an enclosing
  // Panel's own Esc-collapses-it handler, attached the same imperative way) by the time a
  // delegated handler ever runs, so `stopPropagation()` there is always too late. A real listener
  // on `dialogEl` -- BELOW any ancestor Panel in the DOM -- runs during the actual bubble phase,
  // before the event ever reaches that ancestor, so stopping it here actually stops it.
  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      // NOT preventDefault() here: measured (chromium AND firefox), calling it suppresses the
      // browser's own "Escape closes a modal <dialog>" default action entirely, so the dialog
      // never closes at all -- that behaviour is tied to the keydown's default action, not (as
      // MDN's `cancel`-event guidance might suggest) a separate mechanism. stopPropagation() alone
      // is enough to stop an ancestor Panel's Esc-collapses-it listener from also seeing this
      // event, without touching the platform's own close.
      event.stopPropagation();
      return;
    }
    if (event.key !== "Tab" || !dialogEl) return;
    const focusable = [...dialogEl.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
      isVisible,
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    }
  }

  onMount(() => {
    const el = dialogEl;
    el?.addEventListener("keydown", handleKeydown);
    return () => el?.removeEventListener("keydown", handleKeydown);
  });
</script>

<dialog
  bind:this={dialogEl}
  tabindex="-1"
  data-size={size}
  aria-labelledby={titleId}
  onclose={() => onclose?.()}
>
  <div class="modal-head">
    <h2 id={titleId}>{title}</h2>
    <button type="button" class="modal-close" aria-label="Close" onclick={() => dialogEl?.close()}>
      <Icon name="close" size={18} />
    </button>
  </div>
  <div class="modal-body">
    {@render children()}
  </div>
</dialog>

<style>
  dialog {
    max-width: min(560px, calc(100vw - var(--space-6)));
    max-height: calc(100vh - var(--space-6));
    padding: 0;
    border: 1px solid var(--border-control);
    border-radius: var(--radius-card);
    background: var(--surface-raised);
    color: var(--text-primary);
    box-shadow: var(--elev-3);
  }

  dialog[data-size="lg"] {
    width: min(920px, calc(100vw - var(--space-6)));
    max-width: min(920px, calc(100vw - var(--space-6)));
  }

  dialog::backdrop {
    background: var(--scrim);
    opacity: 0.6;
  }

  /* R3-B4: the container itself is the programmatic focus target on open (see the `$effect`
     above) -- browsers do not treat a `.focus()` call as a KEYBOARD interaction, so `:focus-visible`
     already skips this in practice, but this is the explicit, don't-rely-on-heuristics version of
     that: no ring around the whole card just because it holds focus. A REAL keyboard Tab into the
     dialog still lands on a real control inside it, which keeps its own `:focus-visible` ring. */
  dialog:focus {
    outline: none;
  }

  .modal-head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-4);
    border-bottom: 1px solid var(--divider);
  }

  .modal-head h2 {
    flex: 1;
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--text-2xl);
    letter-spacing: var(--tracking-display);
  }

  .modal-close {
    display: inline-grid;
    place-items: center;
    width: var(--size-touch);
    height: var(--size-touch);
    flex: none;
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    color: var(--icon-muted);
    cursor: pointer;
  }

  .modal-close:hover {
    color: var(--text-primary);
    background: var(--fill-control);
  }

  .modal-close:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .modal-body {
    padding: var(--space-4);
    overflow: auto;
    font-size: var(--text-md);
    line-height: var(--leading-normal);
  }
</style>
