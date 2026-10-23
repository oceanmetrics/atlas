// URL round-trip PROPERTY test: random Sel -> URL -> Sel, seeded and reproducible (plan atlas-2 Step
// 2's gate). Hand-rolled seeded PRNG rather than a new `fast-check` dependency — the instructions
// only ask for it "if you need it", and a fixed-seed mulberry32 generator gives the same
// reproducibility guarantee (same seed -> same failing case, forever) without adding a dependency
// this repo would then have to pin/justify (see package.json's `pinReasons`).
import { describe, expect, it } from "vitest";
import { formatSel, parseSel } from "../../src/lib/state/codec";
import {
  DEFAULT_SEL,
  OUTLINES,
  PALETTES,
  PROJECTIONS,
  REPRESENTATIONS,
  THEMES,
  defaultLens,
  defaultOut,
  type Sel,
} from "../../src/lib/state/types";

const SEED = 20260921; // fixed: a failing case reproduces forever, per the plan's "seeded and reproducible"

function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seed: number) {
  const next = mulberry32(seed);
  return {
    float: () => next(),
    bool: (pTrue = 0.5) => next() < pTrue,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick<T>(arr: readonly T[]): T {
      return arr[Math.floor(next() * arr.length)];
    },
    maybe<T>(fn: () => T, pDefined = 0.5): T | undefined {
      return next() < pDefined ? fn() : undefined;
    },
    /** an opaque token: no leading/trailing whitespace (cleanString trims those — tested separately
     * in codec.test.ts), but DOES include `,`/`:` and a few unicode code points to stress the
     * un-escape/re-parse path this test exists to cover. */
    token(minLen = 1, maxLen = 12): string {
      const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_,:éü";
      const len = this.int(minLen, maxLen);
      let out = "";
      for (let i = 0; i < len; i++) out += chars[Math.floor(next() * chars.length)];
      return out;
    },
    /** like `token`, but WITHOUT `,`/`:` — for pieces that sit inside a comma-joined list
     * (`show`/`hide`) or a colon-delimited compound (`sel`'s `zone:<unit>:<key>`), where those two
     * characters are the format's own delimiters, not content a single field can carry. */
    safeToken(minLen = 1, maxLen = 12): string {
      const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_éü";
      const len = this.int(minLen, maxLen);
      let out = "";
      for (let i = 0; i < len; i++) out += chars[Math.floor(next() * chars.length)];
      return out;
    },
    num(min: number, max: number, decimals = 4): number {
      const n = min + next() * (max - min);
      return Number(n.toFixed(decimals));
    },
  };
}

type Rng = ReturnType<typeof makeRng>;

function randomSel(rng: Rng): Sel {
  const sp = rng.maybe(() => rng.token(2, 10), 0.5);
  const lens = rng.bool() ? defaultLens(sp) : rng.pick(["scores", "species"] as const);
  const out = rng.bool() ? defaultOut(lens) : rng.pick(OUTLINES);
  const us = rng.bool(0.7); // skew toward the default (true), same as real traffic would
  const obis = rng.bool(0.3);

  return {
    ver: rng.maybe(() => `v${rng.int(1, 12)}${rng.bool(0.3) ? "b" : ""}`, 0.3),
    lens,
    lyr: rng.maybe(() => rng.token(3, 15), 0.4),
    pal: rng.pick(PALETTES),
    unit: rng.bool(0.6) ? DEFAULT_SEL.unit : rng.token(2, 10),
    area: rng.bool(0.6) ? DEFAULT_SEL.area : rng.token(2, 10),
    map: rng.maybe(
      () => ({
        lon: rng.num(-180, 180),
        lat: rng.num(-85, 85),
        zoom: rng.num(0, 20, 2),
        ...(rng.bool(0.5) ? { bearing: rng.num(0, 360, 1), pitch: rng.num(0, 85, 1) } : {}),
      }),
      0.4,
    ),
    proj: rng.pick(PROJECTIONS),
    sp,
    in: rng.bool(0.6) ? DEFAULT_SEL.in : rng.token(3, 12),
    rep: rng.pick(REPRESENTATIONS),
    us,
    out,
    obis,
    sel: rng.maybe(() => {
      const kind = rng.int(0, 2);
      if (kind === 0) return `cell:${rng.int(1, 999999)}`;
      if (kind === 1) return `zone:${rng.safeToken(2, 8)}:${rng.safeToken(1, 8)}`;
      return `place:${rng.int(0, 99)}`;
    }, 0.4),
    show: rng.bool(0.4) ? Array.from({ length: rng.int(1, 4) }, () => rng.safeToken(2, 8)) : [],
    hide: rng.bool(0.4) ? Array.from({ length: rng.int(1, 4) }, () => rng.safeToken(2, 8)) : [],
    theme: rng.pick(THEMES),
    tour: rng.pick(["on", "off"] as const),
    zl: rng.bool(0.8), // skew toward the default (true), same as `us` above
    pl: rng.maybe(() => `g1.${rng.token(1, 6)}.${rng.token(4, 40)}`, 0.4),
    t: rng.maybe(() => rng.token(3, 30), 0.3),
  };
}

const N = 300;

describe(`URL round trip property test (seed ${SEED}, N=${N})`, () => {
  const rng = makeRng(SEED);

  it("random Sel -> URL -> Sel is the identity, for every generated case", () => {
    for (let i = 0; i < N; i++) {
      const original = randomSel(rng);
      const { search, hash } = formatSel(original);
      const roundTripped = parseSel({ search, hash });
      expect(roundTripped, `case #${i}: ${search}${hash}`).toEqual(original);
    }
  });

  it("formatting is idempotent: formatting a round-tripped Sel gives back the same URL", () => {
    for (let i = 0; i < N; i++) {
      const original = randomSel(rng);
      const once = formatSel(original);
      const twice = formatSel(parseSel(once));
      expect(twice, `case #${i}`).toEqual(once);
    }
  });

  it("every generated URL keeps ver/lens/... out of the hash and pl/t out of the query", () => {
    for (let i = 0; i < N; i++) {
      const { search, hash } = formatSel(randomSel(rng));
      if (hash) {
        const hashKeys = [...new URLSearchParams(hash.slice(1)).keys()];
        for (const k of hashKeys) expect(["pl", "t"]).toContain(k);
      }
      if (search) {
        const searchKeys = [...new URLSearchParams(search.slice(1)).keys()];
        expect(searchKeys).not.toContain("pl");
        expect(searchKeys).not.toContain("t");
      }
    }
  });
});
