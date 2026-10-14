<script lang="ts">
  // A markdown document in a Modal: a collection's Methods README (the credits strip and the catalog
  // page). The fetch, the safe render and the "Open raw" link are `DocBody.svelte`'s.
  import Modal from "./Modal.svelte";
  import DocBody from "./DocBody.svelte";

  interface Props {
    open: boolean;
    title: string;
    /** absolute URL of the markdown file. */
    url: string;
    onclose?: () => void;
  }
  let { open, title, url, onclose }: Props = $props();
</script>

<Modal {open} {title} {onclose} size="lg">
  {#if open}<DocBody {url} />{/if}
</Modal>
