// A one-shot request to open a specific tab of the Table tool. The tab is TablePanel's own local
// state (it is not in the URL), so the guided tour cannot reach it directly; the tour's "Table"
// step promises "every Program Area ranked; tick some and report on them", which is the Zones tab,
// while the panel opens on Species. TablePanel consumes the request (applies it, then clears it),
// so a later, ordinary open of the Table tool is never steered by a stale one.
export type TableTab = "species" | "zones" | "composition";

export const tableTabRequest = $state<{ tab: TableTab | null }>({ tab: null });

export function requestTableTab(tab: TableTab): void {
  tableTabRequest.tab = tab;
}

/** read-and-clear: the tab a pending request asks for, or null. */
export function takeTableTabRequest(): TableTab | null {
  const tab = tableTabRequest.tab;
  tableTabRequest.tab = null;
  return tab;
}
