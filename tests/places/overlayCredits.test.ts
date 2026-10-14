import { describe, expect, it } from "vitest";
import { createOverlayCredits, overlayCredits } from "../../src/places/overlayCredits";

describe("the overlayCredits store (read by the Layers panel, the map attribution and the About page)", () => {
  it("subscribe calls back immediately with the current value, then on every set; unsubscribe stops it", () => {
    const store = createOverlayCredits();
    const seen: number[] = [];
    const stop = store.subscribe((v) => seen.push(v.length));
    store.set([{ slug: "a", title: "A", attribution: "A credit.", license: null }]);
    stop();
    store.set([]);
    expect(seen).toEqual([0, 1]);
    expect(store.get()).toEqual([]);
  });
  it("the app-wide store starts empty", () => {
    expect(overlayCredits.get()).toEqual([]);
  });
});
