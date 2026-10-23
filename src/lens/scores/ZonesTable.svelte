<script lang="ts">
  // atlas-4 step 3 — the zones table: every zone of the unit, ranked by the current layer, with
  // every component alongside. The keyboard/screen-reader equivalent of the choropleth (atlas-4
  // subplan's "New" bullet): a sighted user reads colour-by-value on the map; this table is the
  // SAME ranking as text, and clicking a row selects that zone exactly as clicking its polygon
  // would (`sel=zone:<unit>:<key>`).
  import { SvelteSet } from "svelte/reactivity";
  import { categoryLabel } from "../../lib/ui/categories";
  import { columnWidthPx, totalTableWidthPx } from "../../lib/ui/dataTableCore";
  import { zonesTableRows, type ZonesTableRow } from "./zonesTable";
  import type { ZoneRow } from "./boot";

  // P3 fix (owner-reported, 2026-09-24): the checkbox column's own fixed width, and the pseudo
  // "columns" `columnWidthPx()`/`totalTableWidthPx()` size this table by -- Rank/Score/each
  // component are short and NARROW, Zone (the identifying column) gets the readable text minimum.
  // `dataTableCore.ts`'s own header explains why the `<table>` needs an EXPLICIT summed pixel
  // width (not `max-content`/`auto`) for `table-layout: fixed` to actually honour these.
  const CHECKBOX_COLUMN_PX = 40;
  const ZONE_COLUMN = {};
  const NARROW_COLUMN = { narrow: true };

  interface Props {
    zones: ZoneRow[];
    metricKey: string;
    metricLabel: string;
    componentKeys: string[];
    onSelectZone: (key: string) => void;
    /** atlas-7 step 4: "Report on selected" -- omit to hide the checkbox column/button entirely
     * (a caller with no report entry point wired up yet, e.g. a gallery/mockup usage). */
    onReportSelected?: (keys: string[]) => void;
  }

  let { zones, metricKey, metricLabel, componentKeys, onSelectZone, onReportSelected }: Props =
    $props();

  const rows = $derived(zonesTableRows(zones, metricKey, componentKeys));

  // a plain Set, not derived from `rows`: the selection is the user's OWN choice and must survive
  // a re-sort/re-rank when the ranked metric changes underneath it (atlas-4's layer picker can
  // change `metricKey` while this panel stays open).
  const selected = new SvelteSet<string>();

  function toggle(key: string, checked: boolean) {
    if (checked) selected.add(key);
    else selected.delete(key);
  }

  // rank order (the table's own current order), not selection order -- a report's Table of Scores
  // is submission order, and this table's rank order is the closest thing to "the order the user
  // was looking at" for a multi-select made here.
  const selectedInRankOrder = $derived(rows.map((r) => r.key).filter((k) => selected.has(k)));

  // UI-8 (round-3 review): "29" beside "29.7" -- `maximumFractionDigits` alone has no MINIMUM, so
  // an integer-valued score prints with no decimal at all beside one that has one. Both bounds
  // fixed at 1 read as the SAME rounding rule everywhere in this column.
  function formatValue(v: number | null): string {
    return v === null
      ? "—"
      : v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  // Rank + Zone + Score + one NARROW column per published component.
  const tableWidthPx = $derived(
    totalTableWidthPx(
      [
        NARROW_COLUMN,
        ZONE_COLUMN,
        NARROW_COLUMN,
        ...(rows[0]?.components ?? []).map(() => NARROW_COLUMN),
      ],
      onReportSelected ? CHECKBOX_COLUMN_PX : 0,
    ),
  );
</script>

<div class="zones-table-wrap">
  {#if onReportSelected}
    <div class="zones-table-toolbar">
      <button
        type="button"
        disabled={selectedInRankOrder.length === 0}
        onclick={() => onReportSelected?.(selectedInRankOrder)}
      >
        Report on selected ({selectedInRankOrder.length})
      </button>
    </div>
  {/if}
  <div class="zones-table">
    <!-- P3 fix (owner-reported, 2026-09-24): explicit per-column widths (same rule
         SpeciesTable.svelte uses, dataTableCore.ts#columnWidthPx's constants) -- Rank/Score/
         components are short and NARROW, Zone (the identifying column) gets the readable text
         minimum -- PLUS an explicit summed `width` on the table itself (`tableWidthPx`, above);
         `dataTableCore.ts`'s own header explains why `table-layout: fixed` needs that to honour
         the `<colgroup>` at all, rather than sizing every column from its own content. -->
    <table
      class="grid"
      style={`width:${tableWidthPx}px`}
      aria-label="Zones ranked by {metricLabel}"
    >
      <colgroup>
        {#if onReportSelected}<col style={`width:${CHECKBOX_COLUMN_PX}px`} />{/if}
        <col style={`width:${columnWidthPx(NARROW_COLUMN)}px`} />
        <col style={`width:${columnWidthPx(ZONE_COLUMN)}px`} />
        <col style={`width:${columnWidthPx(NARROW_COLUMN)}px`} />
        {#if rows[0]}
          {#each rows[0].components as c (c.label)}
            <col style={`width:${columnWidthPx(NARROW_COLUMN)}px`} />
          {/each}
        {/if}
      </colgroup>
      <thead>
        <tr>
          {#if onReportSelected}
            <th scope="col"><span class="sr-only">Select</span></th>
          {/if}
          <th scope="col" class="num">Rank</th>
          <!-- the zone/name column: sticky on the left, same convention as SpeciesTable.svelte's
               own "Scientific name" -- a `position: sticky; left: 0` cell need not be the row's
               first cell to pin correctly (it covers whatever scrolls out from under it). -->
          <th scope="col" class="sticky-col">Zone</th>
          <!-- G-24 fix (docs/parity.html): the header used to print the metric's WHOLE published
               `label` (a full sentence on a real release), which wrapped to one word per line and
               pushed every data row out of view. "Score" is a short, fixed header text; the full
               label is still reachable as a hover `title` AND as the accessible name (`aria-label`)
               so "Score" alone is never the only cue to which metric is ranked. -->
          <th scope="col" class="num" title={metricLabel} aria-label={`Score (${metricLabel})`}
            >Score</th
          >
          {#if rows[0]}
            {#each rows[0].components as c (c.label)}
              <!-- P round V2 fix (Opus eyes-on: raw lowercase component labels show in the UI):
                   `c.label` (the each-block KEY, matching `r.components` below positionally) stays
                   RAW -- only the displayed text goes through `categoryLabel()`. -->
              <th scope="col" class="num">{categoryLabel(c.label)}</th>
            {/each}
          {/if}
        </tr>
      </thead>
      <tbody>
        {#each rows as row, i (row.key)}
          {@const r = row as ZonesTableRow}
          <tr>
            {#if onReportSelected}
              <td>
                <input
                  type="checkbox"
                  aria-label={`Select ${r.name} for report`}
                  checked={selected.has(r.key)}
                  onchange={(e) => toggle(r.key, (e.currentTarget as HTMLInputElement).checked)}
                />
              </td>
            {/if}
            <td class="num">{i + 1}</td>
            <td class="sticky-col" title={r.name}>
              <button type="button" class="zone-link" onclick={() => onSelectZone(r.key)}>
                {r.name}
              </button>
            </td>
            <td class="num" title={formatValue(r.value)}>{formatValue(r.value)}</td>
            {#each r.components as c (c.label)}
              <td class="num" title={`${categoryLabel(c.label)}: ${formatValue(c.score)}`}
                >{formatValue(c.score)}</td
              >
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style>
  .zones-table-toolbar {
    display: flex;
    justify-content: flex-end;
    margin-bottom: var(--space-2);
  }

  .zones-table-toolbar button {
    height: var(--size-touch);
    padding: 0 var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--fill-control);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .zones-table-toolbar button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  /* W3 hand-off (round-3 review, B9's own fix for SpeciesTable.svelte, applied here the same way):
     a fixed `max-height: 50vh` left blank panel below the table on a tall desktop dock (the box
     never grew past half the viewport no matter how tall the panel actually was). `.zones-table-wrap`
     (this file's own root) now matches `SpeciesTable.svelte`'s `.species-table` -- a flex column
     filling whatever height `TablePanel.svelte`'s own `.table-panel { height: 100% }` hands down --
     so `.zones-table` (`flex: 1`) can grow to fill it instead. `min-height` keeps a handful of rows
     visible where the panel is short (the phone sheet's "half" detent). */
  .zones-table-wrap {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .zones-table {
    overflow: auto;
    flex: 1;
    min-height: 160px;
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
  }

  /* P3 fix (owner-reported, 2026-09-24) -- REPLACES the old "R1" rule (which divided every column
     evenly across the panel's own width and squeezed a wide release's component columns to a
     couple of characters). `width` (the SUM of the `<colgroup>` widths, `tableWidthPx`) is set
     inline above, per dataTableCore.ts's own header -- `table-layout: fixed` only honours a
     `<colgroup>` once the table has a DEFINITE width. `min-width: 100%` still stretches it
     (proportionally) to fill a panel wide enough to hold every column without scrolling; a
     narrower panel scrolls the TABLE (`.zones-table`'s own `overflow: auto`, above), never itself. */
  .grid {
    min-width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }

  th {
    position: sticky;
    top: 0;
    background: var(--surface-sunken);
    text-align: left;
    padding: var(--space-1) var(--space-2);
    /* P3 fix: a header label is never truncated -- it wraps instead of ellipsizing (unlike a DATA
       cell, below, which keeps its ellipsis + hover/`title` full value).
       UI-12 (round-3 review): plain `overflow-wrap: break-word` let "Primary production" break
       mid-word ("Primary producti/on") the instant the column got narrow. `hyphens: auto` (real
       hyphenation points, e.g. "Inverte-brate") is tried FIRST -- `<html lang="en">` gives Chromium
       what it needs on a real desktop build. `overflow-wrap: break-word` stays as the fallback
       (not `normal`): a CI/headless Chromium build missing its hyphenation dictionary data still
       must not let a long, unhyphenatable word overflow its own column
       (`e2e/scores.table.spec.ts`'s own phone-width gate caught exactly this when `normal` alone
       left "Invertebrate and coral" wider than its box). */
    white-space: normal;
    overflow-wrap: break-word;
    hyphens: auto;
  }

  /* UI-8 (round-3 review): the "Score" header sat left-aligned over its own right-aligned numeric
     column (`.num` below) -- every numeric header now right-aligns to match its data. */
  th.num {
    text-align: right;
  }

  /* the Zone column: sticky on the left, stacking above a plain top-sticky header cell scrolling
     underneath it once BOTH axes are in play. */
  th.sticky-col {
    left: 0;
    z-index: 2;
  }

  td.sticky-col {
    position: sticky;
    left: 0;
    z-index: 1;
    /* opaque -- must fully cover whatever column scrolled out from underneath it. */
    background: var(--surface-raised);
  }

  td {
    padding: var(--space-1) var(--space-2);
    border-bottom: 1px solid var(--divider);
    /* R4-C: at full stage a cell wraps instead of truncating (the readable column minimum + the
       table's own horizontal scroll still cover a phone). */
    overflow-wrap: anywhere;
  }

  .num {
    text-align: right;
  }

  .zone-link {
    display: block;
    width: 100%;
    text-align: left;
    overflow-wrap: anywhere;
    border: 0;
    background: none;
    color: var(--text-link);
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
    padding: 0;
    text-align: left;
  }

  .zone-link:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
</style>
