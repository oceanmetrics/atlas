<script lang="ts">
  // "Supported by" with each supporter's logo (dark-theme variant when it has one), used by About
  // and the catalog footer so the two cannot drift.
  import { SUPPORTERS } from "./instance";
  let { testid = "supporter-logos" }: { testid?: string } = $props();
</script>

<p class="support" data-testid={testid}>
  <span class="label">Supported by</span>
  {#each SUPPORTERS as s (s.label)}
    <a class="supporter" href={s.href} target="_blank" rel="noopener" title={s.name}>
      <img class="logo light" src={s.logo} alt={s.name} loading="lazy" />
      {#if s.logoDark}<img class="logo dark" src={s.logoDark} alt="" loading="lazy" />{/if}
    </a>
  {/each}
</p>

<style>
  .support {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3, 12px) var(--space-4, 16px);
    margin: 0;
  }
  .label {
    color: var(--text-secondary, inherit);
  }
  .supporter {
    display: inline-flex;
    align-items: center;
    line-height: 0;
  }
  .logo {
    height: 40px;
    width: auto;
    max-width: 240px;
  }
  /* the round seal reads smaller than a wide wordmark at the same height */
  .supporter:first-child .logo {
    height: 64px;
  }
  .logo.dark {
    display: none;
  }
  :global(:root[data-theme="navy"]) .supporter:has(.dark) .logo.light,
  :global(:root:not([data-theme="paper"])) .supporter:has(.dark) .logo.light {
    display: none;
  }
  :global(:root[data-theme="navy"]) .logo.dark,
  :global(:root:not([data-theme="paper"])) .logo.dark {
    display: inline;
  }
</style>
