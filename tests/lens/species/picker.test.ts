// picker.ts: the index, the two lists, the default species and the search ranking.
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SPECIES_SCI,
  MatchRank,
  SEARCH_DEBOUNCE_MS,
  createSearchLogger,
  defaultSpecies,
  foldText,
  groupByCat,
  keepSelection,
  loadTaxa,
  parseTaxaIndex,
  pickerLabel,
  searchTaxa,
  shouldLogSearch,
  visibleRows,
  type TaxaIndex,
} from "../../../src/lens/species/data/picker";
import { fixtureFetch, readFixture, taxaIndexFor, type FetchLog } from "./fixtures";

const LEATHERBACK = "ms_merge|WORMS:137209";
const WRYBILL = "ms_merge|BOTW:22693928"; // valid_usa false
const index = (): TaxaIndex => taxaIndexFor("v9");

describe("loadTaxa", () => {
  it("fetches app/taxa.json through dataUrl and validates it", async () => {
    const log: FetchLog = { urls: [] };
    const res = await loadTaxa("v9", { fetchJson: fixtureFetch(log) });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.ver).toBe("v9");
    expect(res.value.rows).toHaveLength(13);
    expect(log.urls).toEqual(["https://storage.oceanmetrics.io/marine-atlas/v9/app/taxa.json"]);
  });

  it("a malformed index is a typed schema error", async () => {
    const res = await loadTaxa("v9", {
      fetchJson: fixtureFetch(undefined, { "v9/app/taxa.json": { schema: 1, ver: "v9" } }),
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe("schema");
  });
});

describe("the index", () => {
  it("resolves cat_idx into sp_cat and flags into the two validity bits", () => {
    const row = index().byKey.get(WRYBILL);
    expect(row?.cat).toBe("bird");
    expect(row?.validUsa).toBe(false);
    expect(row?.validGlobal).toBe(true);
  });

  it("builds the option label of 5.4", () => {
    expect(index().byKey.get(LEATHERBACK)?.label).toBe(
      "turtle: Dermochelys coriacea (Leatherback Turtle)",
    );
    expect(pickerLabel("fish", "Zeus faber", null)).toBe("fish: Zeus faber");
    expect(pickerLabel("fish", "Zeus faber", "")).toBe("fish: Zeus faber");
  });

  it("v7's mdl_seq keys are ordinary index keys", () => {
    expect(taxaIndexFor("v7").byKey.get("54383")?.sci).toBe("Odobenus rosmarus");
  });
});

describe("foldText", () => {
  it("folds diacritics, straightens the curly apostrophe and lowercases", () => {
    expect(foldText("señorita")).toBe("senorita");
    expect(foldText("deadman’s fingers")).toBe("deadman's fingers");
    expect(foldText("  Zeus   FABER ")).toBe("zeus faber");
  });
});

describe("the two lists", () => {
  it("US-only hides a non-US taxon; unticking shows it", () => {
    const i = index();
    expect(visibleRows(i, true).map((r) => r.key)).not.toContain(WRYBILL);
    expect(visibleRows(i, false).map((r) => r.key)).toContain(WRYBILL);
  });

  it("is sorted by sp_cat then label, and groups into optgroups in that order", () => {
    const groups = groupByCat(visibleRows(index(), false));
    expect(groups.map((g) => g.cat)).toEqual([
      "bird",
      "coral",
      "fish",
      "invertebrate",
      "mammal",
      "turtle",
    ]);
    const birds = groups[0].rows.map((r) => r.sci);
    expect(birds).toEqual([...birds].sort());
  });

  it("KEEPS a selection that is in both lists when the checkbox flips", () => {
    const i = index();
    expect(keepSelection(i, LEATHERBACK, false)).toBe(LEATHERBACK);
    expect(keepSelection(i, LEATHERBACK, true)).toBe(LEATHERBACK);
  });

  it("drops a non-US selection when the US-only box is ticked, falling back to the default", () => {
    const i = index();
    expect(keepSelection(i, WRYBILL, false)).toBe(WRYBILL);
    expect(keepSelection(i, WRYBILL, true)).toBe(LEATHERBACK);
  });

  it("an unknown selection falls back to the default", () => {
    expect(keepSelection(index(), "ms_merge|WORMS:0", false)).toBe(LEATHERBACK);
    expect(keepSelection(index(), null, false)).toBe(LEATHERBACK);
  });
});

describe("the default species", () => {
  it("is Dermochelys coriacea among the US-valid taxa", () => {
    expect(index().byKey.get(defaultSpecies(index())!)?.sci).toBe(DEFAULT_SPECIES_SCI);
  });

  it("falls back to the FIRST US-valid taxon in published order when it is absent", () => {
    const raw = JSON.parse(JSON.stringify(readFixture("v9/taxa.json"))) as Record<
      string,
      unknown[]
    >;
    // drop the leatherback (row 0) from every parallel array
    for (const k of ["key", "sci", "common", "cat_idx", "flags"]) raw[k].shift();
    (raw as unknown as { n: number }).n -= 1;
    const i = parseTaxaIndex(raw);
    if (typeof i === "string") throw new Error(i);
    // row 0 is now the walrus, which IS US-valid; the wrybill (not US-valid) is skipped entirely
    expect(i.byKey.get(defaultSpecies(i)!)?.sci).toBe("Odobenus rosmarus");
  });

  it("skips non-US rows before it (it is the first US-VALID row, not the first row)", () => {
    const raw = JSON.parse(JSON.stringify(readFixture("v9/taxa.json"))) as Record<
      string,
      unknown[]
    >;
    const order = [3, 1, 2]; // wrybill (non-US) first, then the walrus, then the auklet
    for (const k of ["key", "sci", "common", "cat_idx", "flags"])
      raw[k] = order.map((j) => raw[k][j]);
    (raw as unknown as { n: number }).n = order.length;
    const i = parseTaxaIndex(raw);
    if (typeof i === "string") throw new Error(i);
    expect(i.byKey.get(defaultSpecies(i)!)?.sci).toBe("Odobenus rosmarus");
  });

  it("with no US-valid taxon at all, still selects something (R yields NA there)", () => {
    const raw = JSON.parse(JSON.stringify(readFixture("v9/taxa.json"))) as Record<string, unknown>;
    (raw.flags as number[]) = (raw.flags as number[]).map(() => 2);
    const i = parseTaxaIndex(raw);
    if (typeof i === "string") throw new Error(i);
    expect(defaultSpecies(i)).toBe(LEATHERBACK);
  });

  it("an empty index has no default", () => {
    const i = parseTaxaIndex({
      schema: 1,
      ver: "v9",
      n: 0,
      cat: [],
      key: [],
      sci: [],
      common: [],
      cat_idx: [],
      flags: [],
    });
    if (typeof i === "string") throw new Error(i);
    expect(defaultSpecies(i)).toBeNull();
  });
});

describe("searchTaxa", () => {
  it("matches a diacritic-free query against a diacritic name", () => {
    expect(searchTaxa(index(), "senorita", { usOnly: true })[0].row.sci).toBe(
      "Oxyjulis californica",
    );
  });

  it("matches across the curly apostrophe", () => {
    expect(searchTaxa(index(), "deadman's", { usOnly: true })[0].row.sci).toBe(
      "Briareum asbestinum",
    );
  });

  it("searches the scientific AND the common name", () => {
    expect(searchTaxa(index(), "walrus", {})[0].row.sci).toBe("Odobenus rosmarus");
    expect(searchTaxa(index(), "odobenus", {})[0].row.common).toBe("Walrus");
  });

  it("ranks exact > prefix > word-start > substring", () => {
    const hits = searchTaxa(index(), "aethia", {});
    expect(hits[0].rank).toBe(MatchRank.PrefixSci);
    expect(hits.map((h) => h.row.sci)).toEqual([
      "Aethia cristatella",
      "Aethia psittacula",
      "Aethia pusilla",
    ]);
    const exact = searchTaxa(index(), "Zeus faber", {});
    expect(exact[0].rank).toBe(MatchRank.ExactSci);
    const word = searchTaxa(index(), "grebe", {});
    expect(word[0].rank).toBe(MatchRank.WordCommon);
  });

  it("applies usOnly BEFORE ranking: a non-US exact match is not offered", () => {
    expect(searchTaxa(index(), "Anarhynchus frontalis", { usOnly: true })).toHaveLength(0);
    expect(searchTaxa(index(), "Anarhynchus frontalis", { usOnly: false })[0].row.key).toBe(
      WRYBILL,
    );
  });

  it("an empty query is the plain list, and limit is honoured", () => {
    expect(searchTaxa(index(), "  ", { usOnly: false, limit: 3 })).toHaveLength(3);
    expect(searchTaxa(index(), "", { usOnly: false })).toHaveLength(13);
  });

  it("logs a search only at >= 3 characters", () => {
    expect(shouldLogSearch("ae")).toBe(false);
    expect(shouldLogSearch("aet")).toBe(true);
    expect(shouldLogSearch("  a  ")).toBe(false);
  });
});

// fix round 3 #2: this rule used to live inline in SpeciesPicker.svelte (a setTimeout + a bare
// `lastLogged` variable) — a reviewer's fault there (900 -> 90 ms; letting a repeat through)
// stayed GREEN because nothing exercised the TIMING/DEDUP half at all, only `shouldLogSearch`'s
// character-count gate above. `createSearchLogger` pulls the whole rule out so a fake clock can
// pin it.
describe("createSearchLogger", () => {
  it("is 900 ms by default", () => {
    expect(SEARCH_DEBOUNCE_MS).toBe(900);
  });

  it("debounces: only the LAST call within 900 ms logs, after 900 ms of silence", () => {
    vi.useFakeTimers();
    try {
      const logged: string[] = [];
      const logger = createSearchLogger({ onLog: (q) => logged.push(q) });
      logger.onInput("aet");
      vi.advanceTimersByTime(500);
      logger.onInput("aeth"); // resets the debounce — "aet" must never log
      vi.advanceTimersByTime(899);
      expect(logged).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(logged).toEqual(["aeth"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never logs under 3 folded characters, even after the debounce fires", () => {
    vi.useFakeTimers();
    try {
      const logged: string[] = [];
      const logger = createSearchLogger({ onLog: (q) => logged.push(q) });
      logger.onInput("ae");
      vi.advanceTimersByTime(900);
      expect(logged).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("REGRESSION: never logs the same query as the immediately preceding logged one", () => {
    vi.useFakeTimers();
    try {
      const logged: string[] = [];
      const logger = createSearchLogger({ onLog: (q) => logged.push(q) });
      logger.onInput("aethia");
      vi.advanceTimersByTime(900);
      // a repeat of the LAST logged query (e.g. a retriggered debounce with no real edit) must
      // not log again
      logger.onInput("aethia");
      vi.advanceTimersByTime(900);
      expect(logged).toEqual(["aethia"]);
      // a DIFFERENT query in between clears the dedup, so the original query can log again later
      logger.onInput("aethia c");
      vi.advanceTimersByTime(900);
      logger.onInput("aethia");
      vi.advanceTimersByTime(900);
      expect(logged).toEqual(["aethia", "aethia c", "aethia"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a custom debounceMs is honoured (the fault this pins: 900 silently becoming 90)", () => {
    vi.useFakeTimers();
    try {
      const logged: string[] = [];
      const logger = createSearchLogger({ onLog: (q) => logged.push(q), debounceMs: 90 });
      logger.onInput("aethia");
      vi.advanceTimersByTime(89);
      expect(logged).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(logged).toEqual(["aethia"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("destroy() cancels a pending flush", () => {
    vi.useFakeTimers();
    try {
      const logged: string[] = [];
      const logger = createSearchLogger({ onLog: (q) => logged.push(q) });
      logger.onInput("aethia");
      logger.destroy();
      vi.advanceTimersByTime(1000);
      expect(logged).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
