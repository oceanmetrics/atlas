<script lang="ts">
  // R4-D (Ben, 2026-09-30): "Places vs Report ... consolidate Places into simply Report." The Report
  // tool is ONE scrolling flow, no sub-tabs: Places (count, Last clicked row, the list), then "Add a
  // place", then a footer pinned to the bottom of the pane (the subject sentence, the primary Open
  // report button, Share, Download places). `Places.svelte` renders the flow; this component owns what
  // only the shell knows -- the report action, the subject sentence and "Reports opened this session"
  // -- and hands them in as snippets. A plain component (not inlined into Shell.svelte) so its
  // anchors need no stub in index.html's static skeleton (`shell-invariants.test.ts` scans only
  // Shell.svelte + TopBarActions.svelte).
  import type { Snippet } from "svelte";
  import Icon from "../lib/ui/Icon.svelte";
  import { reportSubjectSentence, type ReportSubject } from "../lib/state/subjects";
  import type { Sel } from "../lib/state/types";
  import {
    loadRecentReports,
    recordRecentReport,
    reportAction,
    reportOpenEnabled,
    type RecentReport,
  } from "./report";

  /** what the `places` snippet is handed to pass on to `Places.svelte`. */
  export interface ReportFlowSlots {
    lastClickedLabel: string | null;
    onAddLastClicked: () => void;
    footerLead: Snippet;
    recentsExtra: Snippet;
  }

  interface Props {
    sel: Sel;
    ver: string | null;
    places: Snippet<[ReportFlowSlots]>;
    /** the SAME `reportSubjects()` result the Table's subject line reads. */
    subject: ReportSubject;
    /** `lastClicked.ts#lastClickedLabel` -- `null` hides the Last-clicked row. */
    lastClickedLabel: string | null;
    onAddLastClicked: () => void;
    /** #10: the clicked cell encoded as a one-place `#pl=` token (Shell.svelte), so Open report
     * can report on it; `null` for no cell click or while the place codec is still loading. */
    lastClickedPl?: string | null;
  }

  let {
    sel,
    ver,
    places,
    subject,
    lastClickedLabel,
    onAddLastClicked,
    lastClickedPl = null,
  }: Props = $props();

  function storage(): Storage | null {
    try {
      return window.sessionStorage;
    } catch {
      return null; // private mode / storage disabled -- chrome, not correctness
    }
  }

  let recents = $state<RecentReport[]>(loadRecentReports(storage()));

  const action = $derived(reportAction(sel, ver, lastClickedPl));
  const enabled = $derived(reportOpenEnabled(action));

  function openReport() {
    if (action.kind !== "open") return;
    // window.open() runs SYNCHRONOUSLY in the click handler, no `await` before it, or the popup
    // blocker treats the tab as not user-initiated (report-model.md, windowOpenSync.wiring.test.ts).
    window.open(action.href, "_blank", "noopener");
    recents = recordRecentReport(storage(), { href: action.href, label: action.label });
  }
</script>

{#snippet footerLead()}
  <p class="report-subject-sentence" data-testid="report-subject-sentence">
    {reportSubjectSentence(subject)}
  </p>
  <button
    type="button"
    class="report-primary"
    data-testid="open-report"
    disabled={!enabled}
    onclick={openReport}
  >
    <Icon name="report" size={16} />Open report
  </button>
{/snippet}

{#snippet recentsExtra()}
  {#if recents.length}
    <h4 class="recents-heading">Reports opened this session</h4>
    <ul class="report-recent">
      {#each recents as r (r.href)}
        <li><a href={r.href} target="_blank" rel="noopener">{r.label}</a></li>
      {/each}
    </ul>
  {/if}
{/snippet}

{@render places({ lastClickedLabel, onAddLastClicked, footerLead, recentsExtra })}

<style>
  .report-subject-sentence {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .report-primary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    height: var(--size-touch);
    padding: 0 var(--space-4);
    border: 1px solid transparent;
    border-radius: var(--radius-control);
    background: var(--fill-accent);
    color: var(--text-on-accent);
    font: inherit;
    cursor: pointer;
  }

  .report-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .report-primary:focus-visible,
  .report-recent a:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .recents-heading {
    margin: 0 0 var(--space-1);
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .report-recent {
    list-style: none;
    margin: 0 0 var(--space-2);
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .report-recent a {
    color: var(--text-link);
    font-size: var(--text-sm);
  }
</style>
