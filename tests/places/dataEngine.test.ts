import { describe, expect, it } from "vitest";
import { buildDataUrl, resetDataEngine } from "../../src/places/dataEngine";
import { dataUrl } from "../../src/lib/release/dataBase";

describe("buildDataUrl", () => {
  it("matches release/dataBase.ts's own dataUrl() for the public path", () => {
    const url = buildDataUrl("v9");
    expect(url("app/boot.json")).toBe(dataUrl("v9", "app/boot.json"));
    expect(url("tables/cell.parquet")).toBe(dataUrl("v9", "tables/cell.parquet"));
  });

  it("is absolute, per CLAUDE.md's 'a release URL is always absolute' rule", () => {
    expect(buildDataUrl("v9")("app/boot.json")).toMatch(/^https:\/\//);
  });
});

describe("resetDataEngine", () => {
  it("is callable with no cached engine (never throws)", () => {
    expect(() => resetDataEngine()).not.toThrow();
  });
});
