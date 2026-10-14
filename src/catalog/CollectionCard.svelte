<script lang="ts">
  // One collection on the catalog page: what it is, the numbers that size it, and the credits block
  // (WHO made it, how to cite it, under what license) -- every field from `model.ts#buildCard`.
  import type { CatalogCard } from "./model";
  import ExtentSketch from "./ExtentSketch.svelte";

  interface Props {
    card: CatalogCard;
  }
  let { card }: Props = $props();

  const headingId = $derived(`c-${card.id}`);
  const bboxText = $derived(
    card.bbox ? card.bbox.map((n) => (Math.round(n * 100) / 100).toString()).join(", ") : null,
  );
</script>

<article class="card" class:unavailable={card.status === "unavailable"} aria-labelledby={headingId}>
  <header class="head">
    <div class="titles">
      <h3 id={headingId}>{card.title}</h3>
      <code class="cid">{card.id}</code>
    </div>
    {#if card.openInMap}
      <a class="open" href={card.openInMap}>Open in map</a>
    {/if}
  </header>

  {#if card.status === "unavailable"}
    <p class="note" role="status">
      This collection is listed in the catalog but could not be reached right now ({card.unavailableReason}).
      The rest of the catalog is unaffected.
    </p>
  {:else}
    {#if card.description}
      <p class="desc">{card.description}</p>
    {/if}

    <div class="facts">
      <dl class="meta">
        {#if card.responseType || card.method}
          <dt>Response</dt>
          <dd>
            {card.responseType ?? "not stated"}{#if card.method}
              <span class="sub"> &middot; method: {card.method}</span>{/if}
          </dd>
        {/if}
        {#if card.temporal}
          <dt>Time</dt>
          <dd>{card.temporal}</dd>
        {/if}
        {#each card.dims as d (d.label)}
          <dt>{d.label}</dt>
          <dd>
            {d.values.join(", ")}{#if d.more > 0}<span class="sub"> and {d.more} more</span>{/if}
          </dd>
        {/each}
        <dt>Items</dt>
        <dd>{card.itemCount}</dd>
        {#if bboxText}
          <dt>Extent</dt>
          <dd class="bbox">{bboxText} <span class="sub">(W, S, E, N)</span></dd>
        {/if}
      </dl>
      {#if card.bbox}
        <ExtentSketch bbox={card.bbox} />
      {/if}
    </div>

    {#if card.credits}
      {@const cr = card.credits}
      <section class="credits" aria-label="Credits for {card.title}">
        <h4>Credits</h4>
        <dl>
          {#if cr.citation}
            <dt>Cite</dt>
            <dd>
              {cr.citation}
              {#if cr.doiUrl}<a href={cr.doiUrl} target="_blank" rel="noopener">DOI</a>{/if}
            </dd>
          {:else if cr.doiUrl}
            <dt>DOI</dt>
            <dd><a href={cr.doiUrl} target="_blank" rel="noopener">{cr.doiUrl}</a></dd>
          {/if}
          {#if cr.license}
            <dt>License</dt>
            <dd>
              {#if cr.license.url}
                <a href={cr.license.url} target="_blank" rel="noopener">{cr.license.label}</a>
              {:else}
                {cr.license.label}
              {/if}
            </dd>
          {/if}
          {#if cr.sourceAuthority}
            <dt>Source</dt>
            <dd>{cr.sourceAuthority}</dd>
          {/if}
          {#if cr.version}
            <dt>Version</dt>
            <dd>{cr.version}</dd>
          {/if}
          {#if cr.contacts.length > 0}
            <dt>People</dt>
            <dd>
              <ul>
                {#each cr.contacts as p (p.line)}
                  <li>
                    <strong>{p.name}</strong>{#if p.position}, {p.position}{/if}{#if p.organization && p.organization !== p.name}
                      ({p.organization}){/if}
                    {#if p.roles.length > 0}<span class="sub"> &middot; {p.roles.join(", ")}</span>{/if}
                    {#if p.emails.length > 0}<span class="email">{p.emails.join(", ")}</span>{/if}
                  </li>
                {/each}
              </ul>
            </dd>
          {/if}
          {#if cr.providers.length > 0}
            <dt>Providers</dt>
            <dd>
              <ul>
                {#each cr.providers as p (p.name)}
                  <li>
                    {#if p.url}<a href={p.url} target="_blank" rel="noopener">{p.name}</a>{:else}{p.name}{/if}
                    {#if p.roles.length > 0}<span class="sub"> &middot; {p.roles.join(", ")}</span>{/if}
                  </li>
                {/each}
              </ul>
            </dd>
          {/if}
          {#if cr.funders.length > 0}
            <dt>Funders</dt>
            <dd>{cr.funders.join(", ")}</dd>
          {/if}
        </dl>
      </section>
    {/if}
  {/if}

  <footer class="links">
    {#each card.links as l (l.href)}
      <a href={l.href} target="_blank" rel="noopener">{l.label}</a>
    {/each}
  </footer>

  {#if card.assets.length > 0}
    <section class="assets" aria-label="Data assets of {card.title}">
      <h4>Data assets</h4>
      <ul>
        {#each card.assets as a (a.key)}
          <li>
            {#if a.href}<a href={a.href} target="_blank" rel="noopener">{a.title}</a>{:else}{a.title}{/if}
            <span class="sub"> &middot; {a.type}{#if a.size}, {a.size}{/if}</span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</article>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
    padding: var(--space-4);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-card);
    background: var(--surface-raised);
    box-shadow: var(--elev-1);
  }
  .card.unavailable {
    border-style: dashed;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2) var(--space-3);
  }
  .titles {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1) var(--space-2);
    min-width: 0;
  }
  h3 {
    margin: 0;
    font-size: var(--text-lg);
    line-height: var(--leading-tight);
    overflow-wrap: anywhere;
  }
  h4 {
    margin: 0 0 var(--space-1);
    font-size: var(--text-sm);
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .cid {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-secondary);
    overflow-wrap: anywhere;
  }
  .open {
    flex: none;
    display: inline-flex;
    align-items: center;
    min-height: var(--size-touch);
    padding: 0 var(--space-3);
    border-radius: var(--radius-control);
    background: var(--fill-accent);
    color: var(--text-on-accent);
    font-weight: 600;
    font-size: var(--text-sm);
    text-decoration: none;
  }
  .open:hover {
    text-decoration: underline;
  }
  .desc,
  .note {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .note {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-control);
    background: var(--surface-sunken);
    color: var(--text-secondary);
  }
  .facts {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
  }
  dl {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: var(--space-1) var(--space-3);
    margin: 0;
    font-size: var(--text-sm);
  }
  .meta {
    flex: 1 1 260px;
  }
  dt {
    color: var(--text-secondary);
  }
  dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .sub {
    color: var(--text-secondary);
  }
  .bbox {
    font-variant-numeric: tabular-nums;
  }
  .email {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }
  .credits,
  .assets {
    padding: var(--space-3);
    border-radius: var(--radius-control);
    background: var(--surface-sunken);
  }
  .assets {
    font-size: var(--text-sm);
  }
  .links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-4);
    font-size: var(--text-sm);
  }
  .links a {
    display: inline-flex;
    align-items: center;
    min-height: 32px;
  }
  @media (max-width: 520px) {
    .card {
      padding: var(--space-3);
    }
    dl {
      grid-template-columns: minmax(0, 1fr);
      gap: 0;
    }
    dd {
      margin-bottom: var(--space-2);
    }
  }
</style>
