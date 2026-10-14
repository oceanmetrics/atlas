// The clicked hex cell, as a plain store (the Svelte store contract: `subscribe` calls back
// immediately and returns an unsubscribe, so a component can use `$cellSelection`). Written by the
// hex layer's click handler (`lib/map/layers/hex.ts`), read by whatever shows the cell: today the
// Details tool's one-line summary; WP3's species-list panel next. Plain TypeScript so it is
// testable under Node and importable from lib, lens and shell alike.
export interface CellSelection {
  /** the collection id the cell was clicked in. */
  collection: string;
  /** the item id whose values were on the map. */
  item: string;
  /** the hex FID (the PMTiles `promoteId` / the Parquet join key). */
  fid: number;
  /** the item's value in that cell; `null` when the model has none there. */
  value: number | null;
  /** where it was clicked. */
  lngLat: [number, number];
}

export interface CellSelectionStore {
  get(): CellSelection | null;
  set(selection: CellSelection | null): void;
  subscribe(run: (value: CellSelection | null) => void): () => void;
}

export function createCellSelection(): CellSelectionStore {
  let current: CellSelection | null = null;
  const subscribers = new Set<(value: CellSelection | null) => void>();
  return {
    get: () => current,
    set(selection) {
      current = selection;
      for (const run of subscribers) run(current);
    },
    subscribe(run) {
      subscribers.add(run);
      run(current);
      return () => {
        subscribers.delete(run);
      };
    },
  };
}

/** the app-wide selection (one map, one clicked cell). */
export const cellSelection: CellSelectionStore = createCellSelection();
