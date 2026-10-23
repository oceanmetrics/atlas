// The class files the subtree keeps in DuckDB-WASM's memory (`subtreeRun.ts`). A file stays registered after its
// computation, so a zoom back or a pan reads nothing again; but a page that walks through taxa piles them up
// (Teleostei res 3 to 5 is 27 MB; the heap of a phone is not). Past a cap the tables of the files the current taxon
// and resolution do not use are dropped, least recently used first, and never one a computation in flight holds.
// The total is the files' byte sizes (what the store recorded when it registered them); the lookup is not counted.
// Lazy (imported by `subtreeRun.ts` only); Node-tested on a stub engine (tests/obis/subtreeCache.test.ts).

/** the loaded class files past which the oldest are dropped (a subtree itself may read up to 25 MB) */
export const LOADED_CAP_BYTES = 32 * 1024 * 1024;

/** the slice of the engine the cache needs */
export interface CacheEngine {
  store: { get(name: string): { bytes: number } | undefined } | null;
  drop(name: string): Promise<void>;
}

export interface Trimmed {
  dropped: string[];
  droppedBytes: number;
  /** the class files still loaded, their bytes */
  loadedBytes: number;
}

export class ClassFileCache {
  #engine: CacheEngine;
  #cap: number;
  #tick = 0;
  /** name -> the tick of its last use */
  #used = new Map<string, number>();
  /** name -> computations holding it */
  #held = new Map<string, number>();

  constructor(engine: CacheEngine, cap = LOADED_CAP_BYTES) {
    this.#engine = engine;
    this.#cap = cap;
  }

  get cap(): number {
    return this.#cap;
  }

  /** a computation takes these files: they count as just used and none of them is dropped until the returned
   * release is called (the current taxon and resolution; a run still in flight when another starts) */
  acquire(names: readonly string[]): () => void {
    for (const n of names) {
      this.#used.set(n, ++this.#tick);
      this.#held.set(n, (this.#held.get(n) ?? 0) + 1);
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const n of names) {
        const k = (this.#held.get(n) ?? 1) - 1;
        if (k > 0) this.#held.set(n, k);
        else this.#held.delete(n);
      }
    };
  }

  /** the bytes of the class files loaded now */
  loadedBytes(): number {
    let t = 0;
    for (const n of this.#used.keys()) t += this.#engine.store?.get(n)?.bytes ?? 0;
    return t;
  }

  /** while the loaded total passes the cap, drop the least recently used file nothing holds */
  async trim(): Promise<Trimmed> {
    const dropped: string[] = [];
    let droppedBytes = 0;
    let loaded = this.loadedBytes();
    while (loaded > this.#cap) {
      let victim: string | null = null;
      for (const [n, t] of this.#used)
        if (!this.#held.has(n) && (victim === null || t < this.#used.get(victim)!)) victim = n;
      if (victim === null) break;
      const bytes = this.#engine.store?.get(victim)?.bytes ?? 0;
      await this.#engine.drop(victim);
      this.#used.delete(victim);
      dropped.push(victim);
      droppedBytes += bytes;
      loaded -= bytes;
    }
    return { dropped, droppedBytes, loadedBytes: loaded };
  }
}
