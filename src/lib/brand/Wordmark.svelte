<script lang="ts">
  // the instance's wordmark beside its mark: three parts render as `<wm-0><wm-1> <wm-2>` (the first two
  // run together, a space, then the third: "OceanMetrics Atlas"), one part as `<wm-0>` alone. The same
  // spans sit in index.html's static skeleton (scripts/instance.mjs#wordmarkHtml), so nothing shifts
  // when the app hydrates. Styling is the page's (`.wm-1` the accent, `.wm-2` the light part).
  import Mark from "./Mark.svelte";
  import { WORDMARK } from "./instance";
  let { size = "1.1em" }: { size?: string } = $props();
</script>

<Mark {size} />{#if WORDMARK.length === 3}<span class="wm-0">{WORDMARK[0]}</span><span class="wm-1"
    >{WORDMARK[1]}</span
  >
  <span class="wm-2">{WORDMARK[2]}</span>{:else}<span class="wm-0">{WORDMARK[0]}</span>{/if}
