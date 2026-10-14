<script lang="ts">
  // R3-W2: the Download control -- desktop = a top-bar icon button (beside Share, same
  // `data-tooltip` convention) opening `Menu.svelte`; phone = TopBarActions.svelte's ⋯ menu gets a
  // "Download…" entry that opens THIS component's own Modal instead of trying to nest a second
  // `role="menu"` inside the phone overflow menu -- TopBarActions.svelte's `onDocumentPointerdown`
  // closes ITS menu on any outside pointerdown, including one that lands inside a nested Menu's own
  // panel, so a live menu-inside-a-menu would fight that handler. A Modal is the SAME pattern
  // "About this release" (TopBarActions.svelte) already uses for a phone-only secondary surface --
  // not a new idiom.
  //
  // LAZY (Shell.svelte's own dynamic `import()`, the SAME convention FeedbackDialog.svelte's own
  // header/`Shell.svelte#openFeedback` already establish): this component's map-capture/SVG/COG-
  // fetch logic is a real, non-trivial chunk, and a download is never needed before first
  // interaction. Shell.svelte renders a cheap STATIC placeholder `<button>` (carrying the real
  // `data-tour`/`data-control`/`data-tooltip`) until the first click, then lazy-imports this
  // component and passes `autoOpen` (the mode the click intended) so the menu/Modal opens the
  // MOMENT the chunk resolves, continuing the click rather than requiring a second one. Once
  // mounted, THIS component's own `<Menu>`-driven trigger button takes over for every later
  // open/close (Shell.svelte's placeholder is gone by then, so there is never a doubled control) --
  // see Shell.svelte's own "lazy lens/panel chunks" section for the identical pattern applied to
  // the lens panels, and `scripts/size-budget.mjs`'s FORBIDDEN_LAZY_MARKERS-adjacent
  // rule this keeps this repo honest about ("before first interaction" stays under 450 KB gzip).
  import { onMount } from "svelte";
  import Icon from "../lib/ui/Icon.svelte";
  import Menu from "../lib/ui/Menu.svelte";
  import Modal from "../lib/ui/Modal.svelte";
  import Toast from "../lib/ui/Toast.svelte";
  import type { MenuItem } from "../lib/ui/menuItem";
  import type { MapHandle } from "../lib/map/map";
  import type { Place } from "../lib/geo/placeCodec";
  import { placesToGeoJson, downloadGeoJson } from "../places/download";
  import {
    buildDownloadItems,
    type DownloadItemKind,
    type DownloadLens,
  } from "../lib/download/items";
  import { mapFigureName, cogFileName, placesFileName } from "../lib/download/filename";
  import { compositeMapFigure, canvasToPngBlob } from "../lib/download/mapCapture";
  import { buildMapSvgFromMap } from "../lib/download/mapSvgExport";
  import { downloadCog } from "../lib/download/cogDownload";
  import { saveBlob } from "../lib/download/saveBlob";
  import { legendValueFormatter } from "../lib/download/legendFormat";
  import type { LegendStop } from "../lib/raster/ramps";

  interface Props {
    lens: DownloadLens;
    ver: string | null;
    mapHandle: MapHandle | undefined;
    /** the SHORT layer/species title -- the metric's short display label (never its long
     * description, D3 fix) or the species' `sci` name. */
    title: string;
    /** the layer's own LONG description, ALREADY deduped against `title` by the caller
     * (`Shell.svelte`'s `phoneLegendDescription`) -- `null`/omitted for species (no per-model
     * description) or when the release publishes none. An optional second, smaller footer line;
     * dropped instead if it does not fit the figure's width (`footer.ts#fitsWidth`, applied in
     * `mapCapture.ts`/`mapSvgExport.ts`, not here -- this component only passes the candidate through). */
    description?: string | null;
    unit?: string;
    /** the id the GeoTIFF filename carries -- a collection item id (collection) or `mdl_key` (species). */
    metricOrMdlKey: string | null;
    cogUrl: string | null;
    cogDisabledReason?: string;
    legendStops?: readonly LegendStop[];
    formatValue?: (v: number) => string;
    places: readonly Place[];
    track: (name: "download_export", params: { kind: string; lens: string }) => void;
    /** `"right"` on desktop (the top bar's rightmost icon group) -- the phone Modal ignores this. */
    align?: "left" | "right";
    /** which surface to open the INSTANT this chunk mounts -- the click that triggered the lazy
     * import (Shell.svelte's `openDownload(mode)`), continued once loading finishes. `undefined`/
     * omitted opens nothing (not expected in practice: this component only ever mounts because a
     * click already asked for one of the two). */
    autoOpen?: "desktop" | "phone";
    // literal `data-*` keys (not camelCase) so the CALLER's own template text carries the literal
    // `data-tour="download"`/`data-control="download"` substrings `tests/shell/shell-
    // invariants.test.ts`'s source-scan looks for in Shell.svelte -- the same round-trip
    // `data-control` the skeleton (index.html) must also carry (see that test's own header on why
    // a new top-bar-control-owning component must still round-trip this way).
    "data-tour"?: string;
    "data-control"?: string;
    "data-tooltip"?: string;
  }

  let {
    lens,
    ver,
    mapHandle,
    title,
    description = null,
    unit,
    metricOrMdlKey,
    cogUrl,
    cogDisabledReason,
    legendStops = [],
    formatValue = legendValueFormatter(lens),
    places,
    track,
    align = "right",
    autoOpen,
    "data-tour": dataTour = "download",
    "data-control": dataControl = "download",
    "data-tooltip": dataTooltip = "Download",
  }: Props = $props();

  let toast: ReturnType<typeof Toast> | undefined;
  let menu: ReturnType<typeof Menu> | undefined;
  let phoneModalOpen = $state(false);

  onMount(() => {
    if (autoOpen === "desktop") void menu?.openMenu();
    else if (autoOpen === "phone") phoneModalOpen = true;
  });

  const itemSpecs = $derived(
    buildDownloadItems({ cogUrl, cogDisabledReason, hasPlacesSelection: places.length > 0 }),
  );

  function footerInfo() {
    // `location.href` -- the SAME absolute string `Shell.svelte#onShare` copies (D3 fix: never
    // stripped to a relative path); `footer.ts#canonicalShareUrl` drops `theme` from it.
    return { title, description, unit, ver, url: location.href };
  }

  async function downloadMapPng() {
    if (!mapHandle) {
      toast?.push("The map isn't ready yet.");
      return;
    }
    try {
      const canvas = await compositeMapFigure(mapHandle.map, {
        footer: footerInfo(),
        legendStops,
        formatValue,
      });
      const blob = await canvasToPngBlob(canvas);
      saveBlob(blob, mapFigureName(lens, title, ver ?? "unknown", "png"));
    } catch {
      toast?.push("Couldn't capture the map view.");
    }
  }

  async function downloadMapSvg() {
    if (!mapHandle) {
      toast?.push("The map isn't ready yet.");
      return;
    }
    try {
      const svg = await buildMapSvgFromMap(mapHandle.map, {
        footer: footerInfo(),
        legendStops,
        formatValue,
      });
      saveBlob(
        new Blob([svg], { type: "image/svg+xml" }),
        mapFigureName(lens, title, ver ?? "unknown", "svg"),
      );
    } catch {
      toast?.push("Couldn't build the SVG.");
    }
  }

  async function downloadCogTif() {
    if (!cogUrl) return; // the menu item is disabled in this state -- unreachable via the UI
    const name = cogFileName(lens, metricOrMdlKey ?? title);
    await downloadCog(cogUrl, name, saveBlob, {
      onStart: () => toast?.push("Fetching GeoTIFF…"),
      onSuccess: () => toast?.push(`Downloaded ${name}`),
      onError: (message) => toast?.push(message),
    });
  }

  function downloadPlacesGeojson() {
    const fc = placesToGeoJson(places);
    downloadGeoJson(fc, placesFileName(ver ?? "unknown"));
  }

  const ACTIONS: Record<DownloadItemKind, () => void | Promise<void>> = {
    "map-png": downloadMapPng,
    "map-svg": downloadMapSvg,
    "cog-tif": downloadCogTif,
    "places-geojson": downloadPlacesGeojson,
  };

  function runItem(kind: DownloadItemKind) {
    track("download_export", { kind, lens });
    void ACTIONS[kind]();
  }

  const menuItems = $derived<MenuItem[]>(
    itemSpecs.map((spec) => ({
      id: spec.id,
      label: spec.label,
      hint: spec.hint,
      icon: spec.icon,
      disabled: spec.disabled,
      onSelect: () => runItem(spec.id),
    })),
  );

  function onPhoneItemClick(kind: DownloadItemKind) {
    phoneModalOpen = false;
    runItem(kind);
  }

  /** TopBarActions.svelte's ⋯ "Download…" item calls this (via `bind:this` on this component) --
   * see this file's own header for why the phone route is a Modal, not a second Menu instance. */
  export function openPhoneModal() {
    phoneModalOpen = true;
  }
</script>

<!-- desktop: a top-bar icon button, matching Share's own tool/data-tooltip convention
     (Shell.svelte's Share button, `data-tour="share"` etc.) -->
<span class="topbar-desktop-only">
  <Menu
    bind:this={menu}
    label="Download"
    {align}
    items={menuItems}
    triggerClass="tool"
    triggerAttrs={{
      "data-tour": dataTour,
      "data-control": dataControl,
      "data-tooltip": dataTooltip,
    }}
  >
    {#snippet trigger()}
      <Icon name="download" size={18} />
    {/snippet}
  </Menu>
</span>

<!-- phone: opened from TopBarActions.svelte's ⋯ "Download…" item via `openPhoneModal()` below. -->
<Modal open={phoneModalOpen} title="Download" onclose={() => (phoneModalOpen = false)}>
  <ul class="phone-list">
    {#each itemSpecs as spec (spec.id)}
      <li>
        <button
          type="button"
          class="phone-item"
          disabled={spec.disabled}
          onclick={() => onPhoneItemClick(spec.id)}
        >
          <Icon name={spec.icon} size={18} />
          <span class="phone-item-text">
            <span class="phone-item-label">{spec.label}</span>
            {#if spec.hint}<span class="phone-item-hint">{spec.hint}</span>{/if}
          </span>
        </button>
      </li>
    {/each}
  </ul>
</Modal>

<Toast bind:this={toast} />

<style>
  .phone-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .phone-item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-height: var(--size-touch);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-raised);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
  }

  .phone-item:disabled {
    color: var(--text-secondary);
    cursor: not-allowed;
    opacity: 0.6;
  }

  .phone-item:not(:disabled):hover {
    background: var(--fill-control);
  }

  .phone-item:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .phone-item-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .phone-item-hint {
    color: var(--text-secondary);
    font-size: var(--text-xs);
  }
</style>
