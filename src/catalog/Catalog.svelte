<script lang="ts">
  // The catalog page: every collection the loader returns, grouped OceanMetrics / MarineSensitivity
  // v7 / v8, each with its credits block. Reads the same `catalog.json` the map does (`?catalog=`
  // overrides the base, validated by `base.ts`), so the two pages never disagree.
  import { onMount } from "svelte";
  import { loadCatalog, type AtlasCatalog, type LoadError } from "../lib/catalog/load";
  import { resolveCatalogBase } from "../lib/catalog/base";
  import { BRAND_CREDIT, BRAND_NAME, SUPPORTERS } from "../lib/brand/brand";
  import { ABOUT_LINKS, CITE_ATLAS, CITE_COLLECTION_NOTE } from "../lib/brand/about";
  import { groupCards, type CardGroup } from "./model";
  import CollectionCard from "./CollectionCard.svelte";

  let state = $state<
    | { phase: "loading" }
    | { phase: "error"; error: LoadError }
    | { phase: "ready"; catalog: AtlasCatalog; groups: CardGroup[] }
  >({ phase: "loading" });

  onMount(async () => {
    const override = new URLSearchParams(location.search).get("catalog");
    const res = await loadCatalog({ base: resolveCatalogBase(override) });
    state = res.ok
      ? { phase: "ready", catalog: res.value, groups: groupCards(res.value.entries) }
      : { phase: "error", error: res.error };
  });

  const total = $derived(
    state.phase === "ready" ? state.groups.reduce((n, g) => n + g.cards.length, 0) : 0,
  );
  const unavailable = $derived(
    state.phase === "ready"
      ? state.groups.reduce((n, g) => n + g.cards.filter((c) => c.status === "unavailable").length, 0)
      : 0,
  );
</script>

<header class="top">
  <div class="top-inner">
    <a class="wordmark" href="./catalog.html" aria-label="{BRAND_NAME} catalog">
      <span class="wm-ocean">Ocean</span><span class="wm-metrics">Metrics</span>
      <span class="wm-atlas">Atlas</span>
    </a>
    <nav aria-label="Pages">
      <a href="./index.html">Open the map</a>
    </nav>
  </div>
</header>

<main id="main">
  <h1>OceanMetrics Atlas catalog</h1>
  <p class="lede">
    Every collection the atlas can map, with who made it, how to cite it and under what license.
    Cite each collection by its own citation; to cite the atlas itself: {CITE_ATLAS}.
  </p>

  {#if state.phase === "loading"}
    <p class="status" role="status">Loading the catalog&hellip;</p>
  {:else if state.phase === "error"}
    <p class="status error" role="alert">
      The catalog could not be loaded ({state.error.message}). Try again later, or open the
      <a href="./index.html">map</a>.
    </p>
  {:else}
    <p class="status" role="status">
      {total} collection{total === 1 ? "" : "s"}{#if unavailable > 0}, {unavailable} not reachable
        right now{/if}.
    </p>
    {#if state.groups.length > 1}
      <nav class="jump" aria-label="Collection groups">
        {#each state.groups as g (g.group)}
          <a href="#g-{g.group}">{g.label} ({g.cards.length})</a>
        {/each}
      </nav>
    {/if}
    {#each state.groups as g (g.group)}
      <section class="group" aria-labelledby="g-{g.group}">
        <h2 id="g-{g.group}">{g.label}</h2>
        <div class="cards">
          {#each g.cards as card (card.id + card.group)}
            <CollectionCard {card} />
          {/each}
        </div>
      </section>
    {/each}
  {/if}
</main>

<footer class="foot">
  <div class="foot-inner">
    <p class="credit">{BRAND_CREDIT}</p>
    <p class="supporters">
      Supported by
      {#each SUPPORTERS as s, i (s.href)}{#if i > 0}{i === SUPPORTERS.length - 1 ? " and " : ", "}{/if}<a
          href={s.href}
          target="_blank"
          rel="noopener">{s.label}</a
        >{/each}.
    </p>
    <p class="cite">{CITE_ATLAS}. {CITE_COLLECTION_NOTE}</p>
    <p class="links">
      {#each ABOUT_LINKS as l (l.href)}
        <a href={l.href} target="_blank" rel="noopener">{l.label}</a>
      {/each}
    </p>
  </div>
</footer>
