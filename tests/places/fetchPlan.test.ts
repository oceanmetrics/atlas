import { describe, expect, it } from "vitest";
import {
  ASK_BYTES,
  ASK_TILE_COUNT,
  AVERAGE_TILE_BYTES,
  estimateFetchPlan,
  formatMb,
  needsConfirmation,
} from "../../src/places/fetchPlan";

function fakeFetch(lengths: Record<string, number | null>): typeof fetch {
  return (async (url: string) => {
    const len = lengths[url];
    return {
      ok: len !== undefined,
      headers: { get: () => (len === null || len === undefined ? null : String(len)) },
    } as unknown as Response;
  }) as typeof fetch;
}

describe("estimateFetchPlan", () => {
  it("sums real Content-Length headers", async () => {
    const fetchImpl = fakeFetch({ "a.parquet": 1_000_000, "b.parquet": 2_000_000 });
    const plan = await estimateFetchPlan(["a.parquet", "b.parquet"], fetchImpl);
    expect(plan.tileCount).toBe(2);
    expect(plan.bytes).toBe(3_000_000);
    expect(plan.measured).toBe(true);
  });

  it("falls back to the average when a HEAD has no Content-Length", async () => {
    const fetchImpl = fakeFetch({ "a.parquet": null });
    const plan = await estimateFetchPlan(["a.parquet"], fetchImpl);
    expect(plan.bytes).toBe(AVERAGE_TILE_BYTES);
    expect(plan.measured).toBe(false);
  });

  it("falls back to the average when the request itself throws (network/CORS)", async () => {
    const fetchImpl = (async () => {
      throw new Error("network error");
    }) as unknown as typeof fetch;
    const plan = await estimateFetchPlan(["a.parquet"], fetchImpl);
    expect(plan.bytes).toBe(AVERAGE_TILE_BYTES);
    expect(plan.measured).toBe(false);
  });

  it("falls back to the average for a non-ok response", async () => {
    const fetchImpl = fakeFetch({});
    const plan = await estimateFetchPlan(["missing.parquet"], fetchImpl);
    expect(plan.measured).toBe(false);
  });

  it("an empty tile list is zero tiles, zero bytes, measured", async () => {
    const plan = await estimateFetchPlan([], fakeFetch({}));
    expect(plan).toEqual({ tileCount: 0, bytes: 0, measured: true });
  });
});

describe("needsConfirmation", () => {
  it("is false comfortably under both thresholds", () => {
    expect(needsConfirmation({ tileCount: 5, bytes: 1_000_000, measured: true })).toBe(false);
  });

  it("is true above the tile-count threshold alone", () => {
    expect(needsConfirmation({ tileCount: ASK_TILE_COUNT + 1, bytes: 0, measured: true })).toBe(
      true,
    );
  });

  it("is true above the byte threshold alone", () => {
    expect(needsConfirmation({ tileCount: 1, bytes: ASK_BYTES + 1, measured: true })).toBe(true);
  });

  it("is false exactly AT either threshold (strictly greater-than, per the task's 'above')", () => {
    expect(needsConfirmation({ tileCount: ASK_TILE_COUNT, bytes: ASK_BYTES, measured: true })).toBe(
      false,
    );
  });
});

describe("formatMb", () => {
  it("renders one decimal place", () => {
    expect(formatMb(1_500_000)).toBe("1.4 MB");
  });
});
