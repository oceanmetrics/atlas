<script lang="ts">
  import { onMount } from "svelte";

  // reads window.__early (index.html's inline early-fetch script) to show which release and mode
  // (public/preview) the shell is showing. this is the one bit of the shell that JS enhances — the
  // rest of the page (topbar, rail, panel skeleton) already paints from static HTML + inlined CSS
  // before this component ever mounts.
  interface Early {
    version: Promise<string | null>;
    session: Promise<{ preview: boolean }>;
  }

  let label = $state("");
  let preview = $state(false);
  // R2/U1 fix (owner decision, then CI run 35956406448): at <= 380px (the same breakpoint the
  // brand mark hides at) the full "PREVIEW" text no longer fits the 320px topbar alongside a v9
  // preview session's wider chip (verify.mjs: 17 species-lens phoneNarrow states off-screen).
  // FIRST attempt kept both "PREVIEW" and "PRE" always in the DOM (one hidden via a CSS media
  // query) -- visually correct, but `.textContent` (what `toHaveText`/a screen scraper reads)
  // concatenates BOTH regardless of `display: none`, so every text-content assertion against the
  // badge read "PREVIEW PRE" on the clean CI runner (e2e/shell.smoke.spec.ts, three engines).
  // Fixed the honest way instead: exactly ONE text value in the DOM at a time, tracked the SAME
  // `matchMedia` way `isPhone` already is in Shell.svelte, so `textContent` and the accessible
  // name always agree with what is actually rendered.
  let compact = $state(false);

  onMount(() => {
    const early = (window as unknown as { __early?: Early }).__early;
    if (early) {
      Promise.all([
        early.version.catch(() => null),
        early.session.catch(() => ({ preview: false })),
      ]).then(([version, session]) => {
        label = version ?? "";
        preview = !!session?.preview;
      });
    }

    const mql = matchMedia("(max-width: 380px)");
    compact = mql.matches;
    const onChange = (e: MediaQueryListEvent) => (compact = e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  });
</script>

{#if label}
  <span class="ms-version">{label}</span>
{/if}
{#if preview}
  <span class="ms-preview-badge">{compact ? "PRE" : "PREVIEW"}</span>
{/if}
