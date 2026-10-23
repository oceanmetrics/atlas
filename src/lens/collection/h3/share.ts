// The H3 layer's share, cite and help words (build week 4, step 5, second pass; obis-hex `export/cite.ts`,
// `help/sources.ts`, `help/keys.ts`, `color/ramp.ts` `viewStats`, `view/viewport.ts` `planView` notice): pure functions
// of the release's own metadata (`release.json`, the collection's `release` asset), the view and the layer's
// templates. A lazy module (the layer, its controls and the Help section import it). Node-tested
// (tests/obis/share.test.ts, keys.test.ts, resolution.test.ts).
import { cellIdOf, cellIdRes, h3OfCellId, parentId } from "@oceanmetrics/map";
import { HEX_AREA_KM2 } from "./paint";

// ---- the release's metadata -------------------------------------------------------------------------------------

/** what `release.json` says about the release (each field null when absent or malformed) */
export interface ReleaseMeta {
  release: string | null;
  /** the OBIS snapshot date (`obis_snapshot`, YYYY-MM-DD) */
  snapshot: string | null;
  /** the WoRMS (ChecklistBank) version of the taxonomy */
  worms: string | null;
  obisindicators: string | null;
  duckdb: string | null;
  /** the build date (`built_at`, the UTC calendar date) */
  builtAt: string | null;
  /** the ES(50) threshold (`esn`) */
  esn: number | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const isoDate = (v: unknown): string | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(str(v) ?? "");
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

export function releaseMetaOf(json: unknown): ReleaseMeta {
  const r = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  return {
    release: str(r.release),
    snapshot: isoDate(r.obis_snapshot),
    worms: isoDate(r.worms_version) ?? str(r.worms_version),
    obisindicators: str(r.obisindicators_version),
    duckdb: str(r.duckdb_version),
    builtAt: isoDate(r.built_at),
    esn: typeof r.esn === "number" && Number.isFinite(r.esn) ? r.esn : null,
  };
}

// ---- Cite -----------------------------------------------------------------------------------------------------

/** the year a citation carries: the OBIS snapshot's, else the build's, else the fallback */
export function citeYear(
  m: Pick<ReleaseMeta, "snapshot" | "builtAt"> | null,
  fallback = "2026",
): string {
  const y = (m?.snapshot ?? m?.builtAt ?? "").slice(0, 4);
  return /^\d{4}$/.test(y) ? y : fallback;
}

/** OBIS's recommended citation for the database as a whole (manual.obis.org/citing.html) */
export const obisCitation = (year: string) =>
  `OBIS (${year}) Ocean Biodiversity Information System. Intergovernmental Oceanographic Commission of UNESCO. https://obis.org`;

/**
 * "Cite this data" for the layer: the collection's own `sci:citation` when it publishes one, else the release's
 * (the producer, the release and the inputs `release.json` names, the view's link); then OBIS's own line, as the OBIS
 * manual asks.
 */
export function citeText(o: {
  /** the collection's `sci:citation` */
  citation?: string | null;
  title: string;
  meta: ReleaseMeta | null;
  /** the atlas's version (`__APP_VERSION__`) and name */
  app: string;
  url: string;
}): string {
  const m = o.meta;
  const year = citeYear(m);
  const own =
    o.citation?.trim() ||
    [
      `Ocean Metrics for MBON (${year}). ${o.title}`,
      m?.release ? `, release ${m.release}` : "",
      m?.builtAt ? `, built ${m.builtAt}` : "",
      " (",
      [
        m?.snapshot ? `OBIS data as of ${m.snapshot}` : "",
        m?.worms ? `WoRMS ${m.worms}` : "",
        `indicators by obisindicators${m?.obisindicators ? ` ${m.obisindicators}` : ""} (https://github.com/marinebon/obisindicators)`,
      ]
        .filter(Boolean)
        .join("; "),
      ").",
    ].join("");
  return `${own} Mapped in ${o.app}: ${o.url}\n\n${obisCitation(year)}`;
}

// ---- the footer line ------------------------------------------------------------------------------------------

/** the layer's footer line (obis-hex `footerReleaseText`): "OBIS 2026-10-11 · WoRMS 2026-10-01 · release v20261012 ·
 * res 3 (auto) · OceanMetrics Atlas 0.5.0", each date left out until release.json has loaded. The tiles' bytes are
 * read in MapLibre's worker, which the map package does not report to the page yet. */
export function footerText(o: { meta: ReleaseMeta | null; res: string; app: string }): string {
  const m = o.meta;
  return [
    m?.snapshot ? `OBIS ${m.snapshot}` : "",
    m?.worms ? `WoRMS ${m.worms}` : "",
    m?.release ? `release ${m.release}` : "",
    o.res,
    o.app,
  ]
    .filter(Boolean)
    .join(" · ");
}

// ---- Reproduce ---------------------------------------------------------------------------------------------------

/** the slice of the slot's layer the snippet reads (`H3ReleaseSlot.layer()`): the templates of the layer and period */
export interface LayerFiles {
  template: string;
  parentTemplate?: string | null;
  parentRes?: Record<string, number> | null;
  columns: readonly string[];
}

/** the file a hexagon's row is in: its parent's file at a split resolution (then the whole file, the release keeps
 * a small layer whole), else the layer's file at the hexagon's resolution */
export function cellFileUrls(l: LayerFiles, h3: string): string[] {
  const id = cellIdOf(h3);
  const res = cellIdRes(id);
  const whole = l.template.replaceAll("{res}", String(res));
  const pr = l.parentRes?.[String(res)];
  return l.parentTemplate && pr !== undefined
    ? [
        l.parentTemplate
          .replaceAll("{res}", String(res))
          .replaceAll("{parent}", h3OfCellId(parentId(id, pr))),
        whole,
      ]
    : [whole];
}

const sqlStr = (s: string) => `'${s.replaceAll("'", "''")}'`;

/**
 * Reproduce: DuckDB SQL that reads the layer's own file for the period and resolution on the map (as the Place
 * page's Reproduce reads the place file): with a hexagon selected, its row by `cell_id` (the file is sorted by it,
 * so DuckDB reads one row group); without one, the file's hexagons by the indicator. A split resolution without a
 * hexagon has one file per parent: the snippet lists them from the manifest (`files.parquet`).
 */
export function reproduceSql(o: {
  layer: LayerFiles;
  res: number;
  indicator: string;
  /** what the map shows, for the comment line */
  title: string;
  cell?: string | null;
  /** the release's `files.parquet` */
  manifest?: string | null;
}): string {
  const cols = ["h3", ...o.layer.columns.filter((c) => c !== "cell_id")].join(", ");
  if (o.cell) {
    const urls = cellFileUrls(o.layer, o.cell);
    const res = cellIdRes(cellIdOf(o.cell));
    return [
      `-- ${o.title}: hexagon ${o.cell} (res ${res})`,
      `SELECT ${cols}`,
      `FROM ${sqlStr(urls[0])}`,
      `WHERE cell_id = ${cellIdOf(o.cell).toString()};`,
    ].join("\n");
  }
  const pr = o.layer.parentRes?.[String(o.res)];
  if (o.layer.parentTemplate && pr !== undefined) {
    const prefix = o.layer.parentTemplate.replaceAll("{res}", String(o.res)).split("{parent}")[0];
    return [
      `-- ${o.title}, res ${o.res}: one file per res-${pr} parent hexagon; the manifest lists them`,
      `SELECT url_path, rows, bytes`,
      `FROM ${sqlStr(o.manifest ?? "files.parquet")}`,
      `WHERE path LIKE ${sqlStr(`%${tail(prefix)}%`)}`,
      `ORDER BY bytes DESC LIMIT 20;`,
      `-- then read one: SELECT ${cols} FROM ${sqlStr(`${prefix}<parent h3>/data_0.parquet`)} ORDER BY ${o.indicator} DESC;`,
    ].join("\n");
  }
  return [
    `-- ${o.title}, res ${o.res}`,
    `SELECT ${cols}`,
    `FROM ${sqlStr(o.layer.template.replaceAll("{res}", String(o.res)))}`,
    `ORDER BY ${o.indicator} DESC NULLS LAST`,
    `LIMIT 100;`,
  ].join("\n");
}

/** the release-relative part of a url (`all/res=7/p=`), for a LIKE over the manifest's `path` */
function tail(url: string): string {
  const m = /\/v\d{8}\/(.*)$/.exec(url);
  return m ? m[1] : url.split("/").slice(-3).join("/");
}

// ---- the OBIS checklist of a hexagon (the Cell pane's fallback) ---------------------------------------------------

/** the OBIS API checklist of a box (live OBIS: its counts differ from the release's), the hexagon's box from the
 * tile features that draw it (`[west, south, east, north]`) */
export function obisChecklistUrl(box: readonly [number, number, number, number]): string {
  const [w, s, e, n] = box.map((v) => Number(v.toFixed(4)));
  const wkt = `POLYGON((${w} ${s},${e} ${s},${e} ${n},${w} ${n},${w} ${s}))`;
  return `https://api.obis.org/v3/checklist?geometry=${encodeURIComponent(wkt)}&size=500`;
}

/** the box of a hexagon from the rings of the tile features that draw it (a hexagon cut by tile edges is several) */
export function boxOfRings(
  rings: readonly (readonly (readonly number[])[])[],
): [number, number, number, number] | null {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const r of rings)
    for (const p of r) {
      if (p.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
      w = Math.min(w, p[0]);
      e = Math.max(e, p[0]);
      s = Math.min(s, p[1]);
      n = Math.max(n, p[1]);
    }
  return Number.isFinite(w) ? [w, s, e, n] : null;
}

/** the Cell pane's line when the species table cannot be read (obis-hex `speciesErrorLine`) */
export const speciesErrorLine = (why: string) =>
  `The species of this hexagon could not be read (${why}). OBIS's own checklist for the hexagon's box is live OBIS, so its counts differ from the release's:`;

// ---- Data sources ------------------------------------------------------------------------------------------------

export interface SourceRow {
  name: string;
  href: string;
  role: string;
  citation?: string;
  licence?: string;
  doi?: string;
}

export const IOOS_EOV_URL =
  "https://github.com/ioos/marine_life_data_network/tree/main/eov_taxonomy";

/** the layer's Data sources (obis-hex `sources()`): OBIS, WoRMS (DOI), the IOOS EOV definitions, the basemap, the
 * gazetteer (the outlined place's collection when one is selected) and the software. */
export function sourceRows(o: {
  meta: ReleaseMeta | null;
  place?: { title: string; citation?: string | null; license?: string | null } | null;
}): SourceRow[] {
  const m = o.meta;
  const year = citeYear(m);
  return [
    {
      name: "OBIS",
      href: "https://obis.org",
      role: `The occurrence records${m?.snapshot ? ` (data as of ${m.snapshot})` : ""}, aggregated to H3 hexagons in release ${m?.release ?? "…"}${m?.builtAt ? ` (built ${m.builtAt})` : ""}.`,
      citation: obisCitation(year),
      licence:
        "CC0, CC BY or CC BY-NC, per dataset (cite the datasets you use: manual.obis.org/citing.html)",
    },
    {
      name: "WoRMS",
      href: "https://www.marinespecies.org",
      role: `The taxonomy behind the taxon layers${m?.worms ? ` (the ${m.worms} version, from ChecklistBank)` : ""} and the EOVs.`,
      citation: `WoRMS Editorial Board (${year}). World Register of Marine Species. https://www.marinespecies.org`,
      licence: "CC BY 4.0",
      doi: "10.14284/170",
    },
    {
      name: "IOOS Marine Life Data Network: EOV definitions",
      href: IOOS_EOV_URL,
      role: "Which WoRMS taxa make up each biological Essential Ocean Variable (every descendant of the root AphiaIDs).",
    },
    {
      name: "Ocean Metrics gazetteer",
      href: "https://storage.oceanmetrics.io/gazetteer/",
      role: o.place
        ? `The places of the Places tool; the selected one is from the collection "${o.place.title}".`
        : "The places of the Places tool, outlined on the map, and their H3 membership (the place filter).",
      ...(o.place?.citation ? { citation: o.place.citation } : {}),
      ...(o.place?.license ? { licence: o.place.license } : {}),
    },
    {
      name: "Basemap",
      href: "https://carto.com/attributions",
      role: "The land, labels and bathymetry under the hexagons (the atlas basemap).",
      citation: "© CARTO, © OpenStreetMap contributors, GEBCO",
      licence: "OpenStreetMap data: ODbL",
    },
    {
      name: "Software",
      href: "https://github.com/marinebon/obisindicators",
      role: `obisindicators${m?.obisindicators ? ` ${m.obisindicators}` : ""} (MIT) computes the indicators${m?.duckdb ? ` in DuckDB ${m.duckdb}` : ""}; H3 (Apache-2.0) hexagons; MapLibre GL (BSD-3-Clause) draws them from the release's Parquet, read in your browser by hyparquet (MIT).`,
    },
  ];
}

/** the About section of the layer (obis-hex About): what it maps, the release, its inputs, the credit, the licence */
export function aboutLines(o: { meta: ReleaseMeta | null; description?: string | null }): string[] {
  const m = o.meta;
  return [
    o.description?.trim() ||
      "Records, species richness, Shannon, Simpson and ES(50) per H3 hexagon from the Ocean Biodiversity Information System (OBIS).",
    [
      m?.release ? `Release ${m.release}` : "The release",
      m?.builtAt ? `, built ${m.builtAt}` : "",
      m?.snapshot ? ` from the OBIS snapshot of ${m.snapshot}` : "",
      m?.worms ? `, WoRMS ${m.worms}` : "",
      m?.obisindicators ? `, obisindicators ${m.obisindicators}` : "",
      ".",
    ].join(""),
    "Computed by obisindicators for the Marine Biodiversity Observation Network (MBON). The records are OBIS's, under each dataset's licence; cite OBIS and the datasets you use.",
  ];
}

// ---- keys -----------------------------------------------------------------------------------------------------

/** the layer's keys (obis-hex `SHORTCUTS`, the ones the atlas does not already have): listed in Help */
export const H3_SHORTCUTS: readonly { keys: string[]; what: string }[] = [
  { keys: ["g"], what: "globe or flat map" },
  { keys: ["←", "→"], what: "the period strip (focused): previous, next period; Esc all years" },
];

export interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  targetTag?: string;
  targetEditable?: boolean;
}

/** the layer's shortcut for a key, or null: never while typing (input, textarea, select, contenteditable), with
 * Ctrl, Alt or Meta, or while a modal or the tour is open (`busy`) */
export function h3ShortcutFor(e: KeyLike, opts: { busy?: boolean } = {}): "projection" | null {
  if (opts.busy || e.ctrlKey || e.altKey || e.metaKey) return null;
  const tag = (e.targetTag ?? "").toUpperCase();
  if (e.targetEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return null;
  if (e.key === "g" || e.key === "G") return "projection";
  return null;
}

// ---- the domain of the loaded hexagons ----------------------------------------------------------------------------

/** the p-quantile of sorted values, type 7 (linear between order statistics: DuckDB `quantile_cont`, R's default) */
export function quantileSorted(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo);
}

/** the ramp domain of the loaded hexagons (obis-hex `viewStats`, `d=view`): p02 to p98 of their values, min to max
 * when the two meet; null with no value. A log indicator's domain starts at 1. */
export function viewDomain(values: Iterable<unknown>, log = false): [number, number] | null {
  const v: number[] = [];
  for (const x of values) {
    const n = typeof x === "number" ? x : typeof x === "string" && x.trim() ? Number(x) : NaN;
    if (Number.isFinite(n)) v.push(n);
  }
  if (v.length === 0) return null;
  v.sort((a, b) => a - b);
  let d: [number, number] = [quantileSorted(v, 0.02), quantileSorted(v, 0.98)];
  if (!(d[1] > d[0])) d = [v[0], v[v.length - 1]];
  return log ? [Math.max(1, d[0]), Math.max(1, d[1])] : d;
}

// ---- a pinned split resolution over a wide view ----------------------------------------------------------------------

/** at most this many parent files for one view (obis-hex `MAX_PARENTS`) */
export const MAX_PARENTS = 64;

/** the area of a lon/lat box, km² (on the sphere) */
export function boxKm2(w: number, s: number, e: number, n: number): number {
  const R = 6371.0088;
  const rad = Math.PI / 180;
  const dLon = Math.max(0, Math.min(360, e - w)) * rad;
  const band = Math.abs(
    Math.sin(Math.max(-90, Math.min(90, n)) * rad) - Math.sin(Math.max(-90, Math.min(90, s)) * rad),
  );
  return R * R * dLon * band;
}

/**
 * The resolution to draw for a pinned one (obis-hex `planView`'s fallback): a split resolution reads one file per
 * parent hexagon under the map, so when the view needs more than `MAX_PARENTS` of them (its area over a parent's) it
 * steps down a resolution until it does not, or to the finest whole one, and says so. Auto is never stepped (the zoom
 * rule keeps a split resolution to a few parents).
 */
export function pinForView(
  pin: number | "auto",
  parentRes: Readonly<Record<string, number>> | null | undefined,
  viewKm2: number,
  max = MAX_PARENTS,
): { res: number | "auto"; note: string | null } {
  if (pin === "auto" || !parentRes) return { res: pin, note: null };
  let r = pin;
  const need = (res: number) => {
    const p = parentRes[String(res)];
    return p === undefined ? 0 : Math.ceil(viewKm2 / HEX_AREA_KM2[p]);
  };
  while (parentRes[String(r)] !== undefined && need(r) > max && r > 0) r--;
  if (r === pin) return { res: pin, note: null };
  return {
    res: r,
    note: `Res ${pin} needs more than ${max} parent files for this view: showing res ${r}. Zoom in for res ${pin}.`,
  };
}

// ---- the PNG (the atlas's Download: map PNG) ------------------------------------------------------------------------

/**
 * What the map figure of an h3 layer is stamped with (obis-hex `stampPng`): the legend's title above the colour scale,
 * the title sentence as the description line, and the release id as the figure's version, so the footer reads
 * "<atlas> · v20261012 · <the view's link>" and the file is named `<prefix>_collection_<title>_v20261012_<date>.png`
 * (`mapFigureName`). The resolution, period and place are in the link and the sentence.
 */
export function pngStamp(o: { legendTitle: string; sentence: string; release: string | null }): {
  title: string;
  description: string | null;
  ver: string | null;
} {
  return {
    title: o.legendTitle,
    description: o.sentence || null,
    ver: o.release && /^v[0-9]+[a-z]?$/.test(o.release) ? o.release : null,
  };
}
