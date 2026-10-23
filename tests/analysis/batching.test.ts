// The bounded-memory gate (atlas-2 Step 3b): batching a place's `cell_model` tiles must be a
// MEMORY decision and nothing else. One fixture proves batched == unbatched to 1e-12; the rest pin
// the two expressions being partitioned and the seeded fault that would break them.
import { describe, expect, it } from "vitest";
import {
  combineSpeciesPartials,
  type SpeciesAgg,
  type SpeciesPartial,
} from "../../src/lib/analysis/combine";
import { batchTiles, MAX_CELL_MODEL_TILES } from "../../src/lib/analysis/place";

/** a deterministic pseudo-random stream -- no Math.random in a gate. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const identity = (k: number) => ({
  sp_cat: ["bird", "fish", "mammal"][k % 3],
  sp_common: `common ${k}`,
  sp_scientific: `Genus species${k}`,
  taxon_id: String(100000 + k),
  taxon_authority: "worms",
  er_code: "LC",
  er_score: 0.1,
  is_mmpa: false,
  is_mbta: k % 2 === 0,
  mdl_key: `mdl|${k}`,
});

/**
 * A synthetic place: `nCells` cells spread over `nTiles` tiles, `nSpecies` models, each model
 * present in a random subset of the cells. The per-(tile, species) partials are what
 * `sql/species_for_cells.sql` returns for one batch.
 */
function fixture(opts: { nTiles: number; nSpecies: number; seed: number }) {
  const rand = rng(opts.seed);
  const perTile: SpeciesPartial[][] = [];
  for (let t = 0; t < opts.nTiles; t++) {
    const rows: SpeciesPartial[] = [];
    for (let k = 0; k < opts.nSpecies; k++) {
      if (rand() < 0.25) continue; // this model has no cell in this tile
      // a handful of cells' worth of sums, with the awkward magnitudes real data has
      let area = 0;
      let valPct = 0;
      let pct = 0;
      const nCells = 1 + Math.floor(rand() * 40);
      for (let c = 0; c < nCells; c++) {
        const p = 1 + rand() * 99; // pct_covered 1..100
        const v = rand() * 100; // suitability 0..100
        const a = 8 + rand() * 4; // area_km2 of a 0.05 deg cell
        area += (a * p) / 100;
        valPct += v * p;
        pct += p;
      }
      rows.push({ ...identity(k), sum_area: area, sum_val_pct: valPct, sum_pct: pct });
    }
    perTile.push(rows);
  }
  return perTile;
}

/**
 * Regroup per-tile partials into batches of `size` tiles, exactly as the caller walks them -- AND
 * aggregate within each batch, because that is what `sql/species_for_cells.sql` does: one query per
 * batch, `GROUP BY` the identity columns, so a model present in three tiles of one batch comes back
 * as ONE row, not three. A fixture that merely concatenated the tiles' rows would hand the combine
 * the same multiset for every batch size and could not tell an associative fold from a broken one.
 */
function asBatches(perTile: SpeciesPartial[][], size: number): SpeciesPartial[][] {
  const tiles = perTile.map((_, i) => i);
  return batchTiles(tiles, size).map((group) => {
    const acc = new Map<string, SpeciesPartial>();
    for (const i of group) {
      for (const r of perTile[i]) {
        const e = acc.get(r.mdl_key);
        if (!e) acc.set(r.mdl_key, { ...r });
        else {
          e.sum_area += r.sum_area;
          e.sum_val_pct += r.sum_val_pct;
          e.sum_pct += r.sum_pct;
        }
      }
    }
    return [...acc.values()];
  });
}

const byKey = (rows: SpeciesAgg[]) => new Map(rows.map((r) => [r.mdl_key, r]));

describe("bounded memory: batched == unbatched", () => {
  const perTile = fixture({ nTiles: 37, nSpecies: 120, seed: 20260921 });
  const unbatched = combineSpeciesPartials([perTile.flat()]);

  it("the fixture is big enough to matter (a 37-tile place is ~5 batches)", () => {
    expect(batchTiles(perTile.map((_, i) => i))).toHaveLength(5);
    expect(MAX_CELL_MODEL_TILES).toBe(8);
    expect(unbatched.length).toBeGreaterThan(100);
  });

  // THE GATE. Every batch size must give the same answer as one big batch, to 1e-12 -- the
  // difference is floating-point ASSOCIATIVITY and nothing else (`combine.ts`'s header).
  //
  // 1e-12 RELATIVE for `area_km2`, absolute for `avg_suit`, and the distinction is not a softening:
  // `avg_suit` is a suitability in [0, 1], where an absolute 1e-12 is ~4,500 ulps of headroom,
  // while `area_km2` is a SUM over cells -- ~7,400 in this fixture and ~1e6 km² for a real Program
  // Area, where one ulp is already 1.8e-12 and 2.3e-10 respectively. An absolute 1e-12 on a
  // megametre-squared sum is below the representable gap between adjacent doubles: it would not be
  // a strict gate, it would be an unsatisfiable one. Relative 1e-12 is ~4,500 ulps either way, the
  // same real strictness, and it stays meaningful whatever the place's size.
  const near = (a: number, b: number) => Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b));

  for (const size of [1, 2, 3, 5, 8, 13, 37, 64]) {
    it(`batch size ${size} reproduces the unbatched result to 1e-12`, () => {
      const got = combineSpeciesPartials(asBatches(perTile, size));
      expect(got).toHaveLength(unbatched.length);
      const want = byKey(unbatched);
      for (const g of got) {
        const w = want.get(g.mdl_key)!;
        expect(w, `missing ${g.mdl_key}`).toBeDefined();
        expect(near(g.area_km2, w.area_km2), `area_km2 ${g.mdl_key}`).toBe(true);
        expect(Math.abs(g.avg_suit - w.avg_suit)).toBeLessThan(1e-12);
      }
    });
  }

  it("carries every identity column through unchanged", () => {
    const row = unbatched.find((r) => r.mdl_key === "mdl|3")!;
    expect(row).toMatchObject(identity(3));
  });

  // The seeded fault the gate above exists to catch: averaging the batches' avg_suit instead of
  // dividing the summed numerator by the summed weight. It is right when every batch carries the
  // same weight and wrong the rest of the time, which is exactly the kind of bug a single-batch
  // test would never see.
  it("is NOT a mean of the batches' means (the seeded fault)", () => {
    const batches = asBatches(perTile, 8);
    const naive = new Map<string, { n: number; sum: number }>();
    for (const b of batches) {
      for (const r of b) {
        const e = naive.get(r.mdl_key) ?? { n: 0, sum: 0 };
        e.n += 1;
        e.sum += r.sum_val_pct / r.sum_pct / 100;
        naive.set(r.mdl_key, e);
      }
    }
    let worst = 0;
    for (const w of unbatched) {
      const e = naive.get(w.mdl_key)!;
      worst = Math.max(worst, Math.abs(e.sum / e.n - w.avg_suit));
    }
    expect(worst).toBeGreaterThan(1e-6);
  });

  it("sums area rather than averaging it", () => {
    const total = perTile.flat().reduce((a, r) => a + r.sum_area, 0);
    const got = combineSpeciesPartials(asBatches(perTile, 4)).reduce((a, r) => a + r.area_km2, 0);
    expect(Math.abs(got - total)).toBeLessThan(1e-9);
  });
});

describe("batchTiles", () => {
  it("splits in order, with a short last batch", () => {
    expect(batchTiles([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it("defaults to the plan's 8", () => {
    expect(batchTiles(Array.from({ length: 17 }, (_, i) => i)).map((b) => b.length)).toEqual([
      8, 8, 1,
    ]);
  });
  it("is empty for no tiles and refuses a nonsense size", () => {
    expect(batchTiles([])).toEqual([]);
    expect(() => batchTiles([1], 0)).toThrow(/bad size/);
  });
});

describe("combineSpeciesPartials edge cases", () => {
  it("a species with zero weight gets avg_suit 0, never NaN", () => {
    const row: SpeciesPartial = { ...identity(1), sum_area: 0, sum_val_pct: 0, sum_pct: 0 };
    expect(combineSpeciesPartials([[row]])[0].avg_suit).toBe(0);
  });
  it("groups by mdl_key, so two models of one species stay two rows", () => {
    const a: SpeciesPartial = { ...identity(1), sum_area: 1, sum_val_pct: 10, sum_pct: 1 };
    const b: SpeciesPartial = { ...a, mdl_key: "mdl|other" };
    expect(combineSpeciesPartials([[a, b]])).toHaveLength(2);
  });
});
