<script lang="ts">
  // A collection's `atlas:note` made visible: an amber line (an amber chip ahead of the sentence when the
  // note is about non-commercial terms). The text is the collection's own, from `lib/catalog/note.ts`;
  // this only presents it. Amber is the brand's spark yellow mixed into the panel colour, so the text
  // stays the theme's ordinary text colour on a tint of it in both themes.
  import type { CollectionNote } from "../catalog/note";

  interface Props {
    note: CollectionNote;
    testid?: string;
  }
  let { note, testid = "collection-note" }: Props = $props();
</script>

<p class="note-chip" role="note" data-testid={testid} data-noncommercial={note.nonCommercial}>
  {#if note.nonCommercial}<span class="chip">Non-commercial</span>{/if}
  <span class="text">{note.text}</span>
</p>

<style>
  .note-chip {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1) var(--space-2);
    margin: 0;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--om-mark-spark);
    border-radius: var(--radius-control);
    background: color-mix(in srgb, var(--om-mark-spark) 22%, var(--surface-panel));
    color: var(--text-primary);
    font-size: var(--text-xs);
  }
  .chip {
    flex: none;
    padding: 0 var(--space-2);
    border-radius: var(--radius-pill);
    background: var(--om-mark-spark);
    color: var(--om-navy);
    font-weight: 700;
    white-space: nowrap;
  }
  .text {
    min-width: 0;
    overflow-wrap: anywhere;
  }
</style>
