// "Search all of WoRMS" and the taxon's record (obis-hex parity rows 9 and 10; src/lens/collection/h3/worms.ts): the
// WoRMS REST answers recorded on 2026-10-23 (tests/fixtures/obis_h3/subtree/worms_*.json) through a stubbed fetch.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWormsSearch,
  hitLabel,
  isSynonym,
  parseWormsRecord,
  parseWormsRecords,
  SEARCH_DEBOUNCE_MS,
  SEARCH_LIMIT,
  searchWorms,
  wormsByName,
  wormsPageUrl,
  wormsRecord,
  wormsSearchUrl,
} from "../../src/lens/collection/h3/worms";

const fx = (f: string) =>
  JSON.parse(readFileSync(`tests/fixtures/obis_h3/subtree/${f}`, "utf8")) as unknown;
const SEARCH = fx("worms_search_delphinus.json");

/** a fetch that answers by url, counting what it was asked */
function stub(answers: Record<string, unknown>) {
  const asked: string[] = [];
  const f = vi.fn(async (url: string) => {
    asked.push(url);
    for (const [k, v] of Object.entries(answers))
      if (url.includes(k))
        return v === 204 ? new Response(null, { status: 204 }) : new Response(JSON.stringify(v));
    return new Response("{}", { status: 500 });
  });
  return { f, asked };
}

describe("the WoRMS records", () => {
  it("a record: name, authority, rank, status, the accepted id (itself when accepted)", () => {
    expect(parseWormsRecord(fx("worms_record_2688.json"))).toEqual({
      id: 2688,
      name: "Cetacea",
      authority: "Brisson, 1762",
      rank: "Infraorder",
      status: "accepted",
      acceptedId: 2688,
      acceptedName: "Cetacea",
      kingdom: "Animalia",
      phylum: "Chordata",
      class: "Mammalia",
    });
    expect(parseWormsRecord(null)).toBeNull();
    expect(parseWormsRecord({ AphiaID: "x", scientificname: "a" })).toBeNull();
    expect(parseWormsRecord({ AphiaID: 5 })).toBeNull();
  });
  it("the search: 20 hits at most, the accepted names first, a synonym with its accepted AphiaID", () => {
    const hits = parseWormsRecords(SEARCH);
    expect(hits).toHaveLength(SEARCH_LIMIT);
    const firstOther = hits.findIndex((h) => h.status !== "accepted");
    expect(hits.slice(0, firstOther).every((h) => h.status === "accepted")).toBe(true);
    expect(hits.slice(firstOther).every((h) => h.status !== "accepted")).toBe(true);
    expect(hits[0]).toMatchObject({ id: 137015, name: "Delphinus", rank: "Genus" });
    const syn = hits.find((h) => h.id === 384361)!;
    expect(isSynonym(syn)).toBe(true);
    expect(syn.acceptedId).toBe(343899);
    expect(hitLabel(syn)).toMatch(
      /^Delphinus \(Chaenodelphinus\) edentulus · species · unaccepted → .+ \(343899\)$/,
    );
    expect(hitLabel(hits[0])).toBe("Delphinus · genus · accepted");
    expect(parseWormsRecords({ not: "a list" })).toEqual([]);
    expect(
      parseWormsRecords([
        { AphiaID: 1, scientificname: "A" },
        { AphiaID: 1, scientificname: "A" },
      ]),
    ).toHaveLength(1);
  });
  it("the urls: a prefix search by name, the record, the page", () => {
    expect(wormsSearchUrl(" Cetac ")).toBe(
      "https://www.marinespecies.org/rest/AphiaRecordsByName/Cetac?like=true&marine_only=true&offset=1",
    );
    expect(wormsSearchUrl("Delphinus d")).toContain("AphiaRecordsByName/Delphinus%20d?");
    expect(wormsPageUrl(2688)).toBe("https://www.marinespecies.org/aphia.php?p=taxdetails&id=2688");
  });
});

describe("the calls, on a stubbed fetch", () => {
  it("search: below 2 letters asks nothing; no match (204) is no hits; an error throws", async () => {
    const { f, asked } = stub({
      "AphiaRecordsByName/Delph": SEARCH,
      "AphiaRecordsByName/zzq": 204,
    });
    expect(await searchWorms("D", f)).toEqual([]);
    expect(asked).toEqual([]);
    expect((await searchWorms("Delph", f)).length).toBe(20);
    expect(await searchWorms("zzq", f)).toEqual([]);
    await expect(searchWorms("other", f)).rejects.toThrow("HTTP 500");
  });
  it("a record by id, a rank:name resolved to its AphiaID", async () => {
    const { f } = stub({
      "AphiaRecordByAphiaID/2688": fx("worms_record_2688.json"),
      "AphiaRecordsByName/Cetacea?like=false": fx("worms_name_cetacea.json"),
    });
    expect((await wormsRecord(2688, f))?.name).toBe("Cetacea");
    expect((await wormsByName("infraorder", "Cetacea", f))?.id).toBe(2688);
    expect(await wormsByName("order", "Cetacea", f)).toBeNull(); // the rank must match
  });
});

describe("the debounced field", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("asks once, 250 ms after the last key, and only for 2 letters or more", async () => {
    const { f, asked } = stub({ "AphiaRecordsByName/": SEARCH });
    const seen: string[] = [];
    const s = createWormsSearch({ fetch: f, onresult: (r) => seen.push(r.phase) });
    s.set("D");
    s.set("De");
    s.set("Del");
    s.set("Delp");
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 1);
    expect(asked).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await vi.runAllTimersAsync();
    expect(asked).toEqual([wormsSearchUrl("Delp")]);
    expect(seen).toEqual(["idle", "searching", "ready"]);
    s.set("x");
    expect(seen.at(-1)).toBe("idle");
  });
  it("a newer text drops an older answer; a failure says so", async () => {
    let n = 0;
    const f = vi.fn(async (url: string) => {
      n++;
      if (url.includes("bad")) return new Response(null, { status: 503 });
      return new Response(JSON.stringify(SEARCH));
    });
    const got: { phase: string; error: string | null }[] = [];
    const s = createWormsSearch({ fetch: f, onresult: (r) => got.push(r) });
    s.set("bad");
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    await vi.runAllTimersAsync();
    expect(got.at(-1)).toEqual({
      phase: "error",
      hits: [],
      error: "The WoRMS search failed: WoRMS answered HTTP 503",
    });
    expect(n).toBe(1);
  });
});
