<script lang="ts">
  // A tiny equirectangular sketch of a collection's bounding box over a coarse world outline. Purely
  // decorative (the extent is also printed as numbers next to it), so it is aria-hidden.
  import { sketchRect, type BBox } from "./model";
  import { WORLD_PATH } from "./world";

  interface Props {
    bbox: BBox;
  }
  let { bbox }: Props = $props();
  const rect = $derived(sketchRect(bbox));
</script>

<svg class="sketch" viewBox="0 0 360 180" aria-hidden="true" focusable="false">
  <rect class="sea" x="0" y="0" width="360" height="180" />
  <path class="land" d={WORLD_PATH} />
  <rect class="box" x={rect.x} y={rect.y} width={rect.width} height={rect.height} />
</svg>

<style>
  .sketch {
    display: block;
    width: 132px;
    height: 66px;
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
  }
  .sea {
    fill: var(--fill-control);
  }
  .land {
    fill: var(--fill-track);
    stroke: none;
  }
  .box {
    fill: color-mix(in srgb, var(--fill-accent) 35%, transparent);
    stroke: var(--border-accent);
    vector-effect: non-scaling-stroke;
    stroke-width: 1.5px;
  }
</style>
