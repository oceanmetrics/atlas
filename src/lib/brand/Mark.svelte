<script lang="ts">
  // the instance's mark (instances/<id>/instance.json `mark`, an SVG in the instance folder), inlined
  // so it inherits `currentColor` from the wordmark beside it and reads the theme's custom properties
  // (the OceanMetrics ensō's spark is `--om-mark-spark`). vite.config.ts's atlas-instance plugin
  // serves the file as `virtual:instance-mark` ({ viewBox, body }); the body is the instance's own
  // markup, checked at build time (scripts/instance.mjs#parseMark), never user input.
  import mark from "virtual:instance-mark";
  let { size = "1.1em", title = "" }: { size?: string; title?: string } = $props();
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  viewBox={mark.viewBox}
  class="mark"
  width={size}
  height={size}
  aria-hidden={title ? undefined : "true"}
  role={title ? "img" : undefined}
  focusable="false"
>
  {#if title}<title>{title}</title>{/if}
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- the instance's own mark file, not user input -->
  {@html mark.body}
</svg>

<style>
  .mark {
    display: inline-block;
    vertical-align: -0.15em;
    flex: none;
  }
</style>
