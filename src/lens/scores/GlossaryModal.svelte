<script lang="ts">
  // atlas-4 step 2/3 — the species table's column glossary (parity doc §5.5 modal 3 / app.R:2604-2628),
  // including the er_score rule verbatim. The data itself lives in glossary.ts (CLAUDE.md: "keep
  // core logic in an exported function... a component only calls it") — tests/lens/scores/
  // glossary.test.ts pins the ER rule's exact weights, so a typo here would be caught there.
  import Modal from "../../lib/ui/Modal.svelte";
  import { ER_RULE, GLOSSARY_COLUMNS } from "./glossary";

  interface Props {
    open: boolean;
    onclose: () => void;
  }

  let { open, onclose }: Props = $props();
</script>

<Modal {open} title="Species table columns" {onclose}>
  <dl class="glossary">
    {#each GLOSSARY_COLUMNS as c (c.term)}
      <dt>{c.term}</dt>
      <dd>{c.def}</dd>
    {/each}
  </dl>
  <h3>The extinction-risk rule</h3>
  <table class="er-rule">
    <thead>
      <tr><th scope="col">Category</th><th scope="col">Weight</th></tr>
    </thead>
    <tbody>
      {#each ER_RULE as row (row.label)}
        <tr><td>{row.label}</td><td class="num">{row.weight}</td></tr>
      {/each}
    </tbody>
  </table>
</Modal>

<style>
  .glossary {
    margin: 0 0 var(--space-4);
  }

  .glossary dt {
    font-weight: 700;
    margin-top: var(--space-2);
  }

  .glossary dd {
    margin: 0 0 var(--space-1) 0;
    color: var(--text-secondary);
  }

  h3 {
    font-size: var(--text-md);
    margin: var(--space-2) 0;
  }

  .er-rule {
    border-collapse: collapse;
    width: 100%;
    font-size: var(--text-sm);
  }

  .er-rule th,
  .er-rule td {
    padding: var(--space-1) var(--space-2);
    text-align: left;
    border-bottom: 1px solid var(--divider);
  }

  .er-rule .num {
    text-align: right;
  }
</style>
