<script lang="ts">
  // The H3 layer's controls in the Collections lens (build week 4, step 5): the taxon field (the release's taxon
  // layers as a search, heads included), the indicator, the period strip (decades and years from `h3:periods`) and
  // the resolution (auto by zoom, or pinned). It wires the H3 layer (`layer.svelte.ts`); every rule is in the plain
  // modules beside it. A lazy chunk of its own (CollectionLens.svelte imports it only for an h3 collection).
  import Select from "../../../lib/ui/Select.svelte";
  import Segmented from "../../../lib/ui/Segmented.svelte";
  import type { H3Layer } from "./layer.svelte";
  import { hexAreaLabel } from "./paint";
  import { shortCount, stepPeriod } from "./periods";
  import { taxonGroups, rowLabel } from "./taxa";
  import type { H3Spec } from "../../../lib/catalog/h3";
  import type { SentencePart } from "./paint";
  import { SEAS } from "./placeFilter";
  import { aboutLines, citeText, H3_SHORTCUTS, IOOS_EOV_URL, sourceRows } from "./share";
  import { createWormsSearch, hitLabel, isSynonym, SEARCH_MIN, type WormsRecord } from "./worms";

  interface Props {
    layer: H3Layer;
    spec: H3Spec;
  }
  let { layer, spec }: Props = $props();

  // ---- layer: all taxa and the EOVs, most records first (the counts come with the taxon list) ----
  $effect(() => {
    layer.ensureTaxa();
  });
  const layerRows = $derived(layer.layers);

  // ---- the title sentence's chips open the field of their control ----
  let root = $state<HTMLDivElement | null>(null);
  function openControl(p: SentencePart) {
    const el = root?.querySelector<HTMLElement>(`[data-control-field="${p.control}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "nearest" });
    el.querySelector<HTMLElement>("input, select, button, [tabindex]")?.focus();
  }
  let seaPick = $state(0);
  // the collection filter's choices (layers.json: the polygon collections with an H3 build), read once
  $effect(() => {
    layer.ensureCollections();
  });
  const SEPS = [", ", ", ", ", ", ": ", ""];
  const chips = $derived(
    layer.parts
      ? [
          layer.parts.taxon,
          layer.parts.period,
          layer.parts.place,
          layer.parts.scale,
          layer.parts.indicator,
        ]
      : [],
  );

  // ---- the period strip folds (a per-viewer convenience, not the view) ----
  let stripFolded = $state(readFold());
  function readFold(): boolean {
    try {
      return localStorage.getItem("atlas.h3.stripFolded") === "1";
    } catch {
      return false;
    }
  }
  function setFold(on: boolean) {
    stripFolded = on;
    try {
      localStorage.setItem("atlas.h3.stripFolded", on ? "1" : "0");
    } catch {
      /* private window: the fold lasts the page */
    }
  }

  // ---- cite, reproduce, sources, about ----
  let copied = $state<string | null>(null);
  const cite = $derived(
    citeText({
      citation: spec.citation,
      title: "OBIS biodiversity indicators on H3 hexagons",
      meta: layer.meta,
      app: layer.app,
      url: typeof location === "undefined" ? "" : location.href,
    }),
  );
  const sources = $derived(sourceRows({ meta: layer.meta, place: layer.placeSources[0] ?? null }));
  const about = $derived(aboutLines({ meta: layer.meta }));
  async function copy(what: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copied = what;
    } catch {
      copied = null;
    }
  }

  // ---- taxon ----
  let query = $state("");
  let searching = $state(false);
  const current = $derived(layer.taxon ? `${layer.taxon.rank}:${layer.taxon.taxon}` : null);
  const groups = $derived(searching && layer.taxa ? taxonGroups(layer.taxa, query, current) : []);
  function pick(row: (typeof groups)[number]["rows"][number]) {
    layer.setTaxon(row);
    query = "";
    searching = false;
  }

  // ---- "Search all of WoRMS": a name prefix, 250 ms after the last key; a pick shows that AphiaID's subtree ----
  let wormsQuery = $state("");
  let wormsHits = $state.raw<WormsRecord[]>([]);
  let wormsPhase = $state<"idle" | "searching" | "ready" | "error">("idle");
  let wormsError = $state<string | null>(null);
  const wormsSearch = createWormsSearch({
    onresult: (r) => {
      wormsPhase = r.phase;
      wormsHits = r.hits;
      wormsError = r.error;
    },
  });
  $effect(() => {
    wormsSearch.set(wormsQuery);
  });
  $effect(() => () => wormsSearch.cancel());
  function pickWorms(h: WormsRecord) {
    layer.setAphia(h.id);
    wormsQuery = "";
    wormsHits = [];
  }
  const sub = $derived(layer.subtree);

  // ---- period ----
  const view = $derived(layer.view);
  let grain = $state<string | null>(null);
  const grains = $derived([...new Set(layer.bars.map((b) => b.grain))]);
  const shownGrain = $derived(
    grain && grains.includes(grain)
      ? grain
      : (layer.bars.find((b) => b.token === view?.period)?.grain ?? grains[0] ?? null),
  );
  const shownBars = $derived(layer.bars.filter((b) => b.grain === shownGrain));
  function onStripKey(e: KeyboardEvent) {
    if (!view) return;
    if (e.key === "Escape") {
      layer.setPeriod(spec.allPeriod);
      e.preventDefault();
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const from = view.period === spec.allPeriod ? shownBars[0]?.token : view.period;
      const next = from ? stepPeriod(layer.bars, from, e.key === "ArrowRight" ? 1 : -1) : null;
      if (view.period === spec.allPeriod && from) layer.setPeriod(from);
      else if (next) layer.setPeriod(next);
      e.preventDefault();
    }
  }

  // the strip scrolls to the period on the map (the years run from the 12th century: the latest are at the end)
  let stripEl = $state<HTMLDivElement | null>(null);
  $effect(() => {
    const el = stripEl;
    void view?.period;
    void shownBars.length;
    if (!el) return;
    const on = el.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (on) el.scrollLeft = on.offsetLeft - el.clientWidth / 2;
    else el.scrollLeft = el.scrollWidth;
  });

  // ---- resolution ----
  const ladder = $derived(view?.ladder ?? spec.resolutions);
  const pinned = $derived(view && view.res !== "auto" ? view.res : null);
  const sliderRes = $derived(pinned ?? layer.shownRes ?? ladder[0]);
</script>

<div class="h3-controls" data-testid="h3-controls" bind:this={root}>
  {#if chips.length}
    <!-- the title sentence: each chip opens the field of its control -->
    <p class="sentence" data-testid="h3-sentence" data-tour="h3-sentence">
      {#each chips as c, i (c.control)}<button
          type="button"
          class="chip-word"
          data-chip={c.control}
          onclick={() => openControl(c)}>{c.label}</button
        >{#if c.qual}<span class="qual">{` ${c.qual}`}</span>{/if}{SEPS[i]}{/each}
    </p>
  {/if}
  {#if layer.status}
    <p class="note status" role="status" data-testid="h3-status">{layer.status}</p>
  {/if}

  <!-- layer: all taxa or an EOV (the collection's Items) -->
  <div class="field" data-testid="h3-layer" data-tour="h3-layer">
    <span class="field-label">Layer</span>
    <div class="layers" role="listbox" aria-label="Layer: all taxa or an Essential Ocean Variable">
      {#each layerRows as r (r.id)}
        <button
          type="button"
          role="option"
          class="row"
          aria-selected={!layer.taxon && !layer.subtree && layer.layerId === r.id}
          data-testid="h3-layer-row"
          data-layer={r.id}
          onclick={() => layer.setLayer(r.id)}
        >
          <span class="name">{r.label}</span>
          {#if r.n !== null}<span class="count">{shortCount(r.n)}</span>{/if}
          <span class="bar" style={`--w:${(r.bar * 100).toFixed(1)}%`}></span>
        </button>
      {/each}
    </div>
    <a class="link-out" href={IOOS_EOV_URL} target="_blank" rel="noopener"
      >What defines each EOV? ↗</a
    >
  </div>

  <!-- taxon -->
  <div class="field" data-testid="h3-taxon" data-control-field="taxon" data-tour="h3-taxon">
    <span class="field-label">Taxon</span>
    {#if layer.taxon}
      <p class="current" data-testid="h3-taxon-current">
        {rowLabel(layer.taxon)} <span class="muted">({layer.taxon.rank})</span>
        <button type="button" class="link" onclick={() => layer.setTaxon(null)}>All taxa</button>
      </p>
    {/if}
    <input
      type="search"
      class="search"
      placeholder="Search a taxon: phylum to family, the groups above class"
      aria-label="Search a taxon"
      data-testid="h3-taxon-search"
      bind:value={query}
      onfocus={() => {
        searching = true;
        layer.ensureTaxa();
      }}
    />
    {#if searching}
      <div class="taxa" role="listbox" aria-label="Taxa" data-testid="h3-taxa">
        {#if layer.taxaPhase === "loading"}
          <p class="note" role="status">Loading the taxa…</p>
        {:else if layer.taxaPhase === "error"}
          <p class="note" role="alert">The taxon list could not be loaded.</p>
        {:else if groups.length === 0}
          <p class="note">No taxon layer matches “{query}”.</p>
        {/if}
        {#each groups as g (g.rank)}
          <p class="group">{g.label}</p>
          {#each g.rows as r (r.urlPath)}
            <button
              type="button"
              role="option"
              aria-selected={current === `${r.rank}:${r.taxon}`}
              class="row"
              data-testid="h3-taxon-row"
              onclick={() => pick(r)}
            >
              <span class="name">{r.label}</span>
              <span class="count">{shortCount(r.n)}</span>
              <span class="bar" style={`--w:${(r.bar * 100).toFixed(1)}%`}></span>
            </button>
          {/each}
          {#if g.more > 0}<p class="note">… {g.more} more, type to search</p>{/if}
        {/each}
        <button type="button" class="link close" onclick={() => (searching = false)}>Close</button>
      </div>
    {/if}
    {#if layer.taxonNote}<p class="note" role="status">{layer.taxonNote}</p>{/if}
    {#if sub}
      <!-- the WoRMS subtree computed in the page (obis-hex's aphia layer) -->
      <div class="subtree" data-testid="h3-subtree">
        <p class="current">
          <i>{sub.name}</i>
          {#if sub.rank}<span class="muted">({sub.rank.toLowerCase()})</span>{/if}
          <button type="button" class="link" onclick={() => layer.setTaxon(null)}>All taxa</button>
        </p>
        <p class="note" data-testid="h3-subtree-line">{sub.line}</p>
        {#if sub.taxonLine}
          <p class="note" data-testid="h3-taxon-line">
            {sub.taxonLine}
            {#if sub.wormsUrl}·
              <a class="link-out" href={sub.wormsUrl} target="_blank" rel="noopener">in WoRMS ↗</a>
            {/if}
          </p>
        {/if}
        {#if sub.message}
          <p class="note" role="status" data-testid="h3-subtree-message">{sub.message}</p>
        {:else if sub.readLine}
          <p class="note" data-testid="h3-subtree-read">{sub.readLine}</p>
        {/if}
      </div>
    {/if}
    <label class="field-label" for="h3-worms-search">Search all of WoRMS</label>
    <input
      id="h3-worms-search"
      type="search"
      class="search"
      placeholder={`Any WoRMS name (≥ ${SEARCH_MIN} letters): its subtree, computed here`}
      data-testid="h3-worms-search"
      bind:value={wormsQuery}
    />
    {#if wormsHits.length}
      <div class="taxa" role="listbox" aria-label="WoRMS names" data-testid="h3-worms-hits">
        {#each wormsHits as h (h.id)}
          <button
            type="button"
            role="option"
            aria-selected={sub?.aphiaid === h.acceptedId}
            class="row"
            class:syn={isSynonym(h)}
            data-testid="h3-worms-hit"
            title={`AphiaID ${h.id}`}
            onclick={() => pickWorms(h)}
          >
            <span class="name">{hitLabel(h)}</span>
            <span class="count">{h.id}</span>
          </button>
        {/each}
      </div>
    {:else if wormsPhase === "searching"}
      <p class="note" role="status">Searching WoRMS…</p>
    {:else if wormsError}
      <p class="note" role="status">{wormsError}</p>
    {/if}
  </div>

  <!-- indicator -->
  {#if view}
    <div class="field" data-control-field="indicator" data-tour="h3-indicator">
      <span class="field-label">Indicator</span>
      <Select
        label="Indicator"
        value={view.indicator}
        options={spec.indicators.map((i) => ({ value: i.value, label: i.label }))}
        onchange={(v) => layer.setIndicator(v)}
      />
      <div class="domain" data-testid="h3-domain">
        <span class="field-label">Colour range</span>
        <Segmented
          ariaLabel="Colour range: the release's or the loaded hexagons'"
          value={layer.domain}
          options={[
            {
              value: "release",
              label: "Release",
              title: "p02 to p98 of the release's hexagons at this size",
            },
            {
              value: "view",
              label: "Loaded",
              title: "p02 to p98 of the hexagons in the map's loaded tiles",
            },
          ]}
          onchange={(d) => layer.setDomain(d === "view" ? "view" : "release")}
        />
      </div>
    </div>
  {/if}

  <!-- period -->
  <div class="field" data-testid="h3-period" data-control-field="period" data-tour="h3-period">
    <span class="field-label"
      >Period
      {#if !layer.stripNote && view}<button
          type="button"
          class="link fold"
          aria-expanded={!stripFolded}
          data-testid="h3-strip-fold"
          onclick={() => setFold(!stripFolded)}
          >{stripFolded ? "Show the bars" : "Hide the bars"}</button
        >{/if}</span
    >
    {#if layer.stripNote}
      <p class="note" data-testid="h3-strip-note">{layer.stripNote}</p>
    {:else if view}
      <div class="period-head">
        <button
          type="button"
          class="chip"
          aria-pressed={view.period === spec.allPeriod}
          onclick={() => layer.setPeriod(spec.allPeriod)}>All years</button
        >
        {#if grains.length > 1 && shownGrain}
          <Segmented
            ariaLabel="Decades or years"
            value={shownGrain}
            options={grains.map((g) => ({ value: g, label: g === "decade" ? "Decades" : "Years" }))}
            onchange={(g) => (grain = g)}
          />
        {/if}
      </div>
      <div
        class="strip"
        hidden={stripFolded}
        class:years={shownGrain === "year"}
        role="toolbar"
        bind:this={stripEl}
        aria-label="Hexagons with records per period (res 3); ←/→ step, Esc all years"
        tabindex="0"
        data-testid="h3-strip"
        onkeydown={onStripKey}
      >
        {#each shownBars as b (b.token)}
          <button
            type="button"
            class="pbar"
            aria-pressed={view.period === b.token}
            title={`${b.token}: ${b.cells.toLocaleString("en-US")} hexagons with records (res 3)`}
            data-period={b.token}
            onclick={() => layer.setPeriod(view.period === b.token ? spec.allPeriod : b.token)}
          >
            <span class="fill" style={`--h:${Math.max(4, b.height * 100).toFixed(0)}%`}></span>
            {#if shownGrain === "decade"}<span class="lab">{b.token}</span>{/if}
          </button>
        {/each}
      </div>
      <p class="note">
        {view.period === spec.allPeriod
          ? "All years. Bars: hexagons with records per period (res 3)."
          : `${spec.periodLabels[view.period] ?? view.period}. Click it again, or Esc, for all years.`}
      </p>
    {/if}
  </div>

  <!-- resolution -->
  {#if view}
    <div class="field" data-testid="h3-res" data-control-field="scale" data-tour="h3-res">
      <span class="field-label">Hexagon size</span>
      <label class="auto">
        <input
          type="checkbox"
          checked={view.res === "auto"}
          onchange={(e) =>
            layer.setRes((e.currentTarget as HTMLInputElement).checked ? "auto" : sliderRes)}
        />
        <span>Auto from zoom</span>
      </label>
      <input
        type="range"
        min={Math.min(...ladder)}
        max={Math.max(...ladder)}
        step="1"
        value={sliderRes}
        aria-label="Resolution"
        disabled={view.res === "auto"}
        oninput={(e) => layer.setRes(Number((e.currentTarget as HTMLInputElement).value))}
      />
      <p class="note">res {sliderRes} · {hexAreaLabel(sliderRes)}</p>
    </div>
  {/if}

  <div class="field" data-control-field="place" data-testid="h3-place">
    <span class="field-label">Place</span>
    <!-- a preset moves the map; the select returns to its prompt (the map can be panned away) -->
    {#key seaPick}
      <Select
        label="Go to a sea or ocean"
        value=""
        options={[
          { value: "", label: "Go to a sea or ocean…" },
          ...SEAS.map((s) => ({ value: s.id, label: s.label })),
        ]}
        onchange={(id) => {
          if (!id) return;
          layer.goToSea(id);
          seaPick++;
        }}
      />
    {/key}
    {#if layer.collections?.length || layer.filterColl}
      <!-- a whole gazetteer collection as the filter (obis-hex f=<collection>); the listed places are the Places tool's -->
      <Select
        label="Only inside a collection"
        value={layer.filterColl ?? ""}
        options={[
          { value: "", label: "Only inside a collection…" },
          ...(layer.collections ?? []).map((c) => ({ value: c.slug, label: c.title })),
          ...(layer.filterColl && !layer.collections?.some((c) => c.slug === layer.filterColl)
            ? [{ value: layer.filterColl, label: layer.filterColl }]
            : []),
        ]}
        onchange={(slug) => layer.setFilterColl(slug || null)}
      />
    {/if}
    {#if layer.coverage}
      <p class="note" data-testid="h3-coverage">{layer.coverage}</p>
    {/if}
    {#if layer.filterNote}
      <p class="note" role="status" data-testid="h3-filter-note">{layer.filterNote}</p>
    {:else}
      <p class="note">
        Only the hexagons of a place: add it in Places and turn on “Only inside places”.
      </p>
    {/if}
  </div>
  {#each layer.notes as n (n)}
    <p class="note" role="status" data-testid="h3-note">{n}</p>
  {/each}
  {#if layer.footer}
    <p class="note footer" data-testid="h3-footer">{layer.footer}</p>
  {/if}

  <!-- cite, reproduce, sources, about, keys -->
  <details class="more" data-testid="h3-cite" data-tour="h3-share">
    <summary>Cite this data</summary>
    <pre class="text">{cite}</pre>
    <button type="button" class="chip" onclick={() => copy("cite", cite)}
      >{copied === "cite" ? "Copied" : "Copy citation"}</button
    >
  </details>
  <details class="more" data-testid="h3-reproduce">
    <summary>Reproduce</summary>
    <p class="note">
      DuckDB reads the layer's own file{layer.view?.periodRef ? " for the period" : ""} at the size on
      the map{layer.cell ? ", the selected hexagon by cell_id" : ""}:
    </p>
    <pre class="text"><code>{layer.reproduce}</code></pre>
    <button type="button" class="chip" onclick={() => copy("sql", layer.reproduce)}
      >{copied === "sql" ? "Copied" : "Copy DuckDB SQL"}</button
    >
  </details>
  <details class="more" data-testid="h3-sources">
    <summary>Data sources and attribution</summary>
    <ul class="sources">
      {#each sources as r (r.name)}
        <li>
          <a href={r.href} target="_blank" rel="noopener">{r.name}</a>: {r.role}
          {#if r.citation}<br /><span class="muted">{r.citation}</span>{/if}
          {#if r.licence}<br /><span class="muted">Licence: {r.licence}</span>{/if}
          {#if r.doi}<br /><a href={`https://doi.org/${r.doi}`} target="_blank" rel="noopener"
              >doi:{r.doi}</a
            >{/if}
        </li>
      {/each}
    </ul>
  </details>
  <details class="more" data-testid="h3-about">
    <summary>About this layer</summary>
    {#each about as line (line)}<p class="note">{line}</p>{/each}
    <p class="note">Keys:</p>
    <ul class="sources" data-testid="h3-keys">
      {#each H3_SHORTCUTS as k (k.what)}
        <li><kbd>{k.keys.join(" ")}</kbd> {k.what}</li>
      {/each}
    </ul>
  </details>
</div>

<style>
  .h3-controls {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .field-label {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }
  .current {
    margin: 0;
    font-size: var(--text-sm);
  }
  .muted,
  .note {
    color: var(--text-secondary);
  }
  .note {
    margin: 0;
    font-size: var(--text-xs);
  }
  .sentence {
    margin: 0;
    font-size: var(--text-sm);
    line-height: 1.6;
  }
  .chip-word {
    padding: 0 var(--space-1);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-pill);
    background: var(--fill-control);
    color: var(--text-primary);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .qual {
    color: var(--text-secondary);
  }
  .layers {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .link-out {
    font-size: var(--text-xs);
    color: var(--text-link);
  }
  .domain {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .fold {
    margin-left: var(--space-2);
  }
  .more summary {
    cursor: pointer;
    font-size: var(--text-sm);
  }
  .text {
    margin: var(--space-1) 0;
    padding: var(--space-1);
    max-height: 14rem;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: var(--text-xs);
    background: var(--fill-control);
    border-radius: var(--radius-control);
  }
  .sources {
    margin: var(--space-1) 0;
    padding-left: var(--space-3);
    font-size: var(--text-xs);
  }
  .search {
    width: 100%;
    box-sizing: border-box;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--fill-control);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
  }
  .taxa {
    max-height: 18rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--space-1);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-raised);
  }
  .group {
    margin: var(--space-1) 0 0;
    font-size: var(--text-xs);
    font-weight: 700;
    color: var(--text-secondary);
  }
  .row {
    position: relative;
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
    padding: 2px var(--space-1);
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
  }
  .row:hover,
  .row:focus-visible,
  .row[aria-selected="true"] {
    background: var(--fill-control);
  }
  .row .count {
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }
  .row .bar {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 2px;
    width: var(--w);
    background: var(--border-control);
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-link);
    font: inherit;
    font-size: var(--text-xs);
    text-decoration: underline;
    cursor: pointer;
  }
  .close {
    align-self: flex-end;
  }
  .subtree {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--space-1) var(--space-2);
    border-left: 2px solid var(--border-control);
  }
  .row.syn .name {
    color: var(--text-secondary);
  }
  .period-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .chip {
    padding: 0 var(--space-2);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-pill);
    background: var(--fill-control);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }
  .chip[aria-pressed="true"],
  .pbar[aria-pressed="true"] .fill {
    outline: 2px solid var(--text-primary);
    outline-offset: 1px;
  }
  .strip {
    position: relative;
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 56px;
    min-height: 48px;
    max-height: 240px;
    resize: vertical;
    overflow-x: auto;
  }
  .strip[hidden] {
    display: none;
  }
  .pbar {
    position: relative;
    flex: 1 0 auto;
    min-width: 28px;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: stretch;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
  }
  .strip.years .pbar {
    min-width: 4px;
    flex: 0 0 4px;
  }
  .pbar .fill {
    display: block;
    height: var(--h);
    background: var(--text-secondary);
    border-radius: 2px 2px 0 0;
  }
  .pbar[aria-pressed="true"] .fill {
    background: var(--text-primary);
  }
  .pbar .lab {
    font-size: 10px;
    color: var(--text-secondary);
    text-align: center;
  }
  .auto {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
  }
</style>
