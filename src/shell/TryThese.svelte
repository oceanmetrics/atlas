<script lang="ts">
  // Help -> "Try these" and About's same list: five atlas views as plain links (src/lib/tryThese.ts, the codec's own
  // urls). A lazy component of an instance with `tryThese` (the instance module table): it loads the example module
  // itself, so the example labels and ids stay off the static path; a link is a real anchor (open in a new tab, copy).
  import { onMount } from "svelte";
  import { loadTryThese } from "virtual:instance-modules";

  let rows = $state<{ id: string; label: string; href: string }[]>([]);
  onMount(() => {
    loadTryThese?.()
      .then(
        (m) => (rows = m.TRY_THESE.map((t) => ({ id: t.id, label: t.label, href: m.tryHref(t) }))),
      )
      .catch(() => {});
  });
</script>

{#if rows.length > 0}
  <div class="try-these" data-testid="try-these">
    <h3>Try these</h3>
    <ul>
      {#each rows as r (r.id)}
        <li><a href={r.href} data-testid="try-these-{r.id}">{r.label}</a></li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  h3 {
    margin: 0 0 var(--space-2);
    font-size: var(--text-sm);
    font-weight: 600;
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--text-sm);
  }
  a {
    color: var(--text-accent);
  }
</style>
