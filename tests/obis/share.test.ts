// The OBIS layer's Cite, Reproduce, Data sources, About, footer, PNG stamp and the Cell pane's checklist line
// (src/lens/collection/h3/share.ts; build week 4, step 5, second pass).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mapFigureName } from "../../src/lib/download/filename";
import { DOWNLOAD_PREFIX } from "../../src/lib/brand/instance";
import {
  aboutLines,
  boxOfRings,
  cellFileUrls,
  citeText,
  footerText,
  obisChecklistUrl,
  pngStamp,
  releaseMetaOf,
  reproduceSql,
  sourceRows,
  speciesErrorLine,
} from "../../src/lens/collection/h3/share";
import { FIX, REL } from "./support";

const meta = releaseMetaOf(JSON.parse(readFileSync(`${FIX}release.json`, "utf8")));
const ALL = {
  template: `${REL}all/res={res}/data_0.parquet`,
  parentTemplate: `${REL}all/res={res}/p={parent}/data_0.parquet`,
  parentRes: { "6": 2, "7": 3 },
  columns: ["cell_id", "n", "sp", "shannon", "simpson", "es"],
};

describe("release.json", () => {
  it("the release's metadata: id, OBIS snapshot, WoRMS, obisindicators, DuckDB, build date, esn", () => {
    expect(meta).toEqual({
      release: "v20261012",
      snapshot: "2026-10-11",
      worms: "2026-10-01",
      obisindicators: "0.11.0",
      duckdb: "v1.5.6",
      builtAt: "2026-10-12",
      esn: 50,
    });
    expect(releaseMetaOf(null).release).toBeNull();
    expect(releaseMetaOf({ built_at: "junk" }).builtAt).toBeNull();
  });
});

describe("Cite", () => {
  it("citation text: the release's own line (snapshot, WoRMS, obisindicators, link) then OBIS's", () => {
    const t = citeText({
      title: "OBIS biodiversity indicators on H3 hexagons",
      meta,
      app: "Atlas 0.5.0",
      url: "https://x/?c=obis_h3",
    });
    const [own, obis] = t.split("\n\n");
    expect(own).toBe(
      "Ocean Metrics for MBON (2026). OBIS biodiversity indicators on H3 hexagons, release v20261012, built 2026-10-12 " +
        "(OBIS data as of 2026-10-11; WoRMS 2026-10-01; indicators by obisindicators 0.11.0 (https://github.com/marinebon/obisindicators)). " +
        "Mapped in Atlas 0.5.0: https://x/?c=obis_h3",
    );
    expect(obis).toBe(
      "OBIS (2026) Ocean Biodiversity Information System. Intergovernmental Oceanographic Commission of UNESCO. https://obis.org",
    );
  });
  it("the collection's sci:citation wins when it publishes one; no release.json yet leaves the dates out", () => {
    expect(
      citeText({ citation: "Someone (2026). The thing.", title: "t", meta, app: "A", url: "u" }),
    ).toMatch(/^Someone \(2026\)\. The thing\. Mapped in A: u\n\nOBIS \(2026\)/);
    expect(citeText({ title: "T", meta: null, app: "A", url: "u" })).toMatch(
      /^Ocean Metrics for MBON \(2026\)\. T \(indicators by obisindicators \(https/,
    );
  });
});

describe("Reproduce", () => {
  it("reproduce sql for a whole file: the layer's file at the drawn res, by the indicator", () => {
    expect(reproduceSql({ layer: ALL, res: 3, indicator: "es", title: "All taxa" })).toBe(
      [
        "-- All taxa, res 3",
        "SELECT h3, n, sp, shannon, simpson, es",
        `FROM '${REL}all/res=3/data_0.parquet'`,
        "ORDER BY es DESC NULLS LAST",
        "LIMIT 100;",
      ].join("\n"),
    );
  });
  it("a selected hexagon: its own file (its parent's at a split res) filtered by cell_id", () => {
    const sql = reproduceSql({
      layer: ALL,
      res: 7,
      indicator: "es",
      title: "All taxa",
      cell: "872830828ffffff",
    });
    expect(sql).toContain(`FROM '${REL}all/res=7/p=832830fffffffff/data_0.parquet'`);
    expect(sql).toContain(`WHERE cell_id = ${BigInt("0x872830828ffffff").toString()};`);
    expect(cellFileUrls(ALL, "8329a9fffffffff")).toEqual([`${REL}all/res=3/data_0.parquet`]);
  });
  it("reproduce sql for a parent union: a split res without a hexagon lists its files from the manifest", () => {
    const sql = reproduceSql({
      layer: ALL,
      res: 7,
      indicator: "sp",
      title: "All taxa",
      manifest: `${REL}files.parquet`,
    });
    expect(sql).toContain(`FROM '${REL}files.parquet'`);
    expect(sql).toContain("WHERE path LIKE '%all/res=7/p=%'");
    expect(sql).toContain(`FROM '${REL}all/res=7/p=<parent h3>/data_0.parquet' ORDER BY sp DESC;`);
  });
  it("a period's template is the slot's own (the decade path), quotes escaped", () => {
    const sql = reproduceSql({
      layer: {
        ...ALL,
        template: `${REL}decade/all/decade=1990/res={res}/it's.parquet`,
        parentTemplate: null,
      },
      res: 2,
      indicator: "n",
      title: "x",
    });
    expect(sql).toContain(`FROM '${REL}decade/all/decade=1990/res=2/it''s.parquet'`);
  });
});

describe("Data sources, About, footer", () => {
  it("sources rows and licences: OBIS, WoRMS with its DOI, IOOS EOVs, the gazetteer, the basemap, the software", () => {
    const rows = sourceRows({ meta });
    expect(rows.map((r) => r.name)).toEqual([
      "OBIS",
      "WoRMS",
      "IOOS Marine Life Data Network: EOV definitions",
      "Ocean Metrics gazetteer",
      "Basemap",
      "Software",
    ]);
    expect(rows[0].role).toContain("data as of 2026-10-11");
    expect(rows[0].licence).toMatch(/^CC0, CC BY or CC BY-NC, per dataset/);
    expect(rows[1]).toMatchObject({ licence: "CC BY 4.0", doi: "10.14284/170" });
    expect(rows[1].role).toContain("the 2026-10-01 version");
    expect(rows[5].role).toContain("obisindicators 0.11.0");
    const withPlace = sourceRows({
      meta,
      place: { title: "Places", citation: "NOAA ONMS …", license: "CC-PDDC" },
    });
    expect(withPlace[3]).toMatchObject({ citation: "NOAA ONMS …", licence: "CC-PDDC" });
    expect(withPlace[3].role).toContain('"Places"');
  });
  it("about names the release, its inputs and the MBON credit", () => {
    const l = aboutLines({ meta, description: "Records … per H3 cell." });
    expect(l[0]).toBe("Records … per H3 cell.");
    expect(l[1]).toBe(
      "Release v20261012, built 2026-10-12 from the OBIS snapshot of 2026-10-11, WoRMS 2026-10-01, obisindicators 0.11.0.",
    );
    expect(l[2]).toMatch(/Marine Biodiversity Observation Network \(MBON\)/);
  });
  it("the footer line: the two sources' dates, the release, the resolution, the app", () => {
    expect(footerText({ meta, res: "res 7 (auto)", app: "Atlas 0.5.0" })).toBe(
      "OBIS 2026-10-11 · WoRMS 2026-10-01 · release v20261012 · res 7 (auto) · Atlas 0.5.0",
    );
    expect(footerText({ meta: null, res: "res 3 (fixed)", app: "Atlas 0.5.0" })).toBe(
      "res 3 (fixed) · Atlas 0.5.0",
    );
  });
});

describe("PNG", () => {
  it("png name and stamp text: the legend title, the sentence, the release as the figure's version", () => {
    const s = pngStamp({
      legendTitle: "Seabirds (class Aves) · ES(50)",
      sentence: "Seabirds (class Aves) (EOV), 1990s, worldwide, ~12,400 km² hexagons: ES(50)",
      release: "v20261012",
    });
    expect(s).toEqual({
      title: "Seabirds (class Aves) · ES(50)",
      description: "Seabirds (class Aves) (EOV), 1990s, worldwide, ~12,400 km² hexagons: ES(50)",
      ver: "v20261012",
    });
    expect(
      mapFigureName("collection", s.title, s.ver!, "png", () => new Date("2026-10-23T12:00:00Z")),
    ).toBe(`${DOWNLOAD_PREFIX}_collection_seabirds-class-aves-es-50_v20261012_20261023.png`);
    const f = pngStamp({
      legendTitle: "t",
      sentence: "s",
      release: null,
      format: (v) => v.toFixed(2),
    });
    expect(f.formatValue?.(27.01180712915645)).toBe("27.01");
    expect(pngStamp({ legendTitle: "t", sentence: "", release: "not a release" })).toEqual({
      title: "t",
      description: null,
      ver: null,
    });
  });
});

describe("the Cell pane's fallback", () => {
  it("error line and checklist url: the hexagon's box from its tile pieces, as WKT, live OBIS", () => {
    const box = boxOfRings([
      [
        [-122.5, 36.5],
        [-122.0, 36.9],
      ],
      [[-121.8, 36.6]],
    ]);
    expect(box).toEqual([-122.5, 36.5, -121.8, 36.9]);
    const u = new URL(obisChecklistUrl(box!));
    expect(u.origin + u.pathname).toBe("https://api.obis.org/v3/checklist");
    expect(u.searchParams.get("geometry")).toBe(
      "POLYGON((-122.5 36.5,-121.8 36.5,-121.8 36.9,-122.5 36.9,-122.5 36.5))",
    );
    expect(boxOfRings([])).toBeNull();
    expect(speciesErrorLine("HTTP 503")).toMatch(
      /^The species of this hexagon could not be read \(HTTP 503\)\. OBIS's own checklist .* counts differ from the release's:$/,
    );
  });
});

describe("the footer's tile costs (parity row 80; @oceanmetrics/map 0.3.3 stats())", () => {
  it("the line: requests, KB of 1,000 bytes, the tiles' ms, row groups skipped; nothing before a tile", async () => {
    const { tilesLine } = await import("../../src/lens/collection/h3/share");
    expect(tilesLine(null)).toBeNull();
    expect(tilesLine({ tiles: 0, requests: 0, bytes: 0, ms: 0, rowGroupsSkipped: 0 })).toBeNull();
    expect(
      tilesLine({ tiles: 9, requests: 12, bytes: 162_964, ms: 1234.4, rowGroupsSkipped: 23 }),
    ).toBe("12 requests, 163.0 KB in 1,234 ms, 23 row groups skipped");
    expect(tilesLine({ tiles: 1, requests: 1, bytes: 1500, ms: 5, rowGroupsSkipped: 1 })).toBe(
      "1 request, 1.5 KB in 5 ms, 1 row group skipped",
    );
  });
  it("the footer carries it before the app", async () => {
    const { footerText } = await import("../../src/lens/collection/h3/share");
    expect(
      footerText({
        meta: null,
        res: "res 3 (auto)",
        app: "Atlas",
        tiles: "2 requests, 1.0 KB in 3 ms, 0 row groups skipped",
      }),
    ).toBe("res 3 (auto) · 2 requests, 1.0 KB in 3 ms, 0 row groups skipped · Atlas");
  });
  it("feedTileStats: the counts now, then at most one write per frame from a stubbed onStats, none after it stops", async () => {
    const { feedTileStats } = await import("../../src/lens/collection/h3/share");
    let counts = { tiles: 0, requests: 0, bytes: 0, ms: 0, rowGroupsSkipped: 0 };
    const listeners: ((s: typeof counts) => void)[] = [];
    const slot = {
      stats: () => counts,
      onStats: (cb: (s: typeof counts) => void) => {
        listeners.push(cb);
        return () => listeners.splice(listeners.indexOf(cb), 1);
      },
    };
    const frames: (() => void)[] = [];
    const writes: (typeof counts)[] = [];
    const stop = feedTileStats(
      slot,
      (s) => writes.push({ ...s }),
      (cb) => frames.push(cb),
    );
    expect(writes).toEqual([counts]);
    // three tiles in one frame: one write, with the last counts
    for (let i = 1; i <= 3; i++) {
      counts = { tiles: i, requests: i, bytes: 1000 * i, ms: 10 * i, rowGroupsSkipped: i };
      listeners.forEach((l) => l(counts));
    }
    expect(frames).toHaveLength(1);
    frames.shift()!();
    expect(writes).toHaveLength(2);
    expect(writes[1].tiles).toBe(3);
    counts = { ...counts, tiles: 4 };
    listeners.forEach((l) => l(counts));
    stop();
    expect(listeners).toHaveLength(0);
    frames.shift()!();
    expect(writes).toHaveLength(2);
  });
});
