// places/overlayCredits.ts -- the credits of the gazetteer overlays that are ON in the "Place layers"
// group, as a plain store (the Svelte store contract: `subscribe` calls back immediately and returns
// an unsubscribe, so a component can use `$overlayCredits`). The Layers panel shows these lines under
// the Places group, the shell joins them into the map attribution, and WP5's About / catalog page
// reads the store to print a "Place layers" section of the credits.
//
// Written by `overlays.svelte.ts` whenever the set of overlays on (or the manifest) changes; empty
// while no overlay is on. Plain TypeScript so it is testable under Node and importable from anywhere.
import type { OverlayCredit } from "./overlays";

export type { OverlayCredit };

export interface OverlayCreditsStore {
  get(): readonly OverlayCredit[];
  set(credits: readonly OverlayCredit[]): void;
  subscribe(run: (value: readonly OverlayCredit[]) => void): () => void;
}

export function createOverlayCredits(): OverlayCreditsStore {
  let current: readonly OverlayCredit[] = [];
  const subscribers = new Set<(value: readonly OverlayCredit[]) => void>();
  return {
    get: () => current,
    set(credits) {
      current = credits;
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

/** the app-wide store (one map, one set of overlays). */
export const overlayCredits: OverlayCreditsStore = createOverlayCredits();
