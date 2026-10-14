// WP14: the "Auto-zoom to layer" choice (a browser preference, default on) and when a layer change
// moves the camera.
import { describe, expect, it } from "vitest";
import {
  AUTO_ZOOM_KEY,
  boundsKey,
  loadAutoZoom,
  saveAutoZoom,
  shouldAutoZoom,
} from "../../src/lib/map/autoZoom";

function memory(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    m,
  };
}

describe("the persisted switch", () => {
  it("defaults to ON: nothing stored, no storage, or a value that is not ours", () => {
    expect(loadAutoZoom(memory())).toBe(true);
    expect(loadAutoZoom(null)).toBe(true);
    expect(loadAutoZoom(memory({ [AUTO_ZOOM_KEY]: "banana" }))).toBe(true);
  });
  it("remembers off and on across loads", () => {
    const s = memory();
    saveAutoZoom(s, false);
    expect(loadAutoZoom(s)).toBe(false);
    saveAutoZoom(s, true);
    expect(loadAutoZoom(s)).toBe(true);
  });
  it("storage that throws (private mode, quota) is the default, never an error", () => {
    const bad = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(loadAutoZoom(bad)).toBe(true);
    expect(() => saveAutoZoom(bad, false)).not.toThrow();
  });
});

describe("when a layer change moves the camera", () => {
  it("map= wins on load: the first layer of a page that opened with map= never moves it", () => {
    expect(shouldAutoZoom({ on: true, first: true, hasMapParam: true })).toBe(false);
  });
  it("the first layer of a page with no map= is fitted; later layers are fitted even when map= is in the URL", () => {
    expect(shouldAutoZoom({ on: true, first: true, hasMapParam: false })).toBe(true);
    expect(shouldAutoZoom({ on: true, first: false, hasMapParam: true })).toBe(true);
  });
  it("switched off, nothing moves the camera", () => {
    expect(shouldAutoZoom({ on: false, first: false, hasMapParam: false })).toBe(false);
    expect(shouldAutoZoom({ on: false, first: true, hasMapParam: false })).toBe(false);
  });
});

describe("boundsKey", () => {
  it("is equal for the same frame and differs for another", () => {
    const a: [number, number][] = [
      [-100, 20],
      [-60, 50],
    ];
    expect(boundsKey(a)).toBe(boundsKey([...a]));
    expect(boundsKey(a)).not.toBe(
      boundsKey([
        [-100, 20],
        [-60, 51],
      ]),
    );
  });
});
