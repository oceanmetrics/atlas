<script lang="ts">
  // The swatch of one of a collection's own overlays (`atlas:overlays`): its colour in the shape of its
  // geometry (a dot, a line, a square), the same shapes the map draws. Used by the Layers panel's
  // "Collection layers" list and the legend's overlay chips; decorative (the title beside it is the name).
  import type { OverlayGeometry } from "../../lib/catalog/overlays";

  interface Props {
    geometry: OverlayGeometry;
    color: string;
  }
  let { geometry, color }: Props = $props();
</script>

<span class="ov-swatch ov-swatch--{geometry}" style:--ov-color={color} aria-hidden="true"></span>

<style>
  .ov-swatch {
    flex: none;
    display: inline-block;
    box-sizing: border-box;
    background: var(--ov-color);
  }
  .ov-swatch--point {
    width: 10px;
    height: 10px;
    margin: 0 2px;
    border-radius: 50%;
    box-shadow: 0 0 0 1px var(--border-control);
  }
  .ov-swatch--line {
    width: 14px;
    height: 3px;
    border-radius: 2px;
  }
  .ov-swatch--polygon {
    width: 12px;
    height: 12px;
    margin: 0 1px;
    border: 1.5px solid var(--ov-color);
    border-radius: 2px;
    background: color-mix(in srgb, var(--ov-color) 20%, transparent);
  }
</style>
