// report/provenance.ts -- what replaces `devtools::session_info()` (atlas-7 §8, spec §6.1 row 4:
// "Replace with a provenance block: ver, manifest status/access, table URLs + ETags, app git SHA,
// DuckDB-WASM version, timestamp. Strictly better.").
//
// "Strictly better" is a claim this module has to earn: `session_info()` recorded which R packages
// the SERVER had, which says nothing about which bytes were read. What a reader of a printed report
// actually needs is (a) which release, and whether it was public, (b) which published objects were
// read and at which digest -- so a re-run against a re-published release is DETECTABLE, not a
// silent difference, and (c) a command that reproduces the numbers outside the browser.
//
// (c) is the "Reproduce in R" snippet. It carries the REAL place token, because the token IS the
// geometry (master plan D8: every analysis runs on `decode(encode(geometry))`, so R analysing
// `place_decode(token)` analyses exactly what the browser analysed -- not a re-digitised outline
// that differs on edge cells' `pct_covered`).
import { isoInstant } from "./format";

export interface TableRead {
  /** the `boot.tables` key: `cell`, `taxon`, `zone_taxon`, `taxonomy`, `model`. */
  name: string;
  /** the absolute published URL, verbatim from `boot.tables[name].href`. */
  href: string | null;
  /** `boot.tables[name].digest` -- the content hash atlas-1 publishes, or `null`. */
  digest: string | null;
  bytes: number | null;
}

interface RawTable {
  href?: unknown;
  digest?: unknown;
  bytes?: unknown;
}

/**
 * The `boot.tables` rows for the objects this report read, in the order given.
 *
 * A name with no row still gets an entry, with everything `null`: "this report read `cell_model`
 * tiles and the release publishes no digest for them" is a fact worth printing, and dropping the
 * row would print a shorter, more confident list instead.
 */
export function tablesRead(boot: unknown, names: readonly string[]): TableRead[] {
  const tables = (boot as { tables?: Record<string, RawTable> } | null | undefined)?.tables;
  return names.map((name) => {
    const row = tables && typeof tables === "object" ? tables[name] : undefined;
    return {
      name,
      href: typeof row?.href === "string" ? row.href : null,
      digest: typeof row?.digest === "string" ? row.digest : null,
      bytes: typeof row?.bytes === "number" && Number.isFinite(row.bytes) ? row.bytes : null,
    };
  });
}

/** a `sql/*.sql` twin that actually ran, named and quoted in full (§8: "the SQL that ran
 * (collapsed)"). */
export interface SqlRun {
  /** the twin's basename, e.g. `scores_for_cells`. */
  name: string;
  sql: string;
}

export interface ReproduceTarget {
  ver: string;
  gridId: string | null;
  /** a custom place: its `g1` token. */
  token?: string;
  /** a zone place: the `boot.units[0].fld` and the picked keys. */
  zoneFld?: string;
  zoneKeys?: readonly string[];
}

/**
 * The "Reproduce in R" snippet (§8), runnable as written against a msens checkout.
 *
 * Zone places take the precomputed path (`zone_metric` / `zone_taxon`), custom places the D7b
 * clipped path -- the same split the document itself made, so a reader who runs this gets the
 * number printed above it and not a different-but-defensible one.
 *
 * fix round 2 (Opus review): two corrections. (1) `msensVersion` (the release's own `boot.msens`,
 * threaded in by `buildProvenance` below) prints a `# requires msens >= {version}` line -- three of
 * these functions (`scores_for_pra`, `species_for_zone`, `cells_in_study_area`) are unexported on
 * `main` as of this writing, so "paste this into R" silently fails without knowing which msens
 * checkout to build first. (2) the custom-place path no longer calls `cells_in_study_area()` as its
 * own step: `scores_for_cells(..., denominator = "study_area")` already clips to the study area
 * internally (that IS what the `denominator` argument means), so the extra call recomputed the
 * same clip a second time for nothing -- it never changed the result, only the reader's confidence
 * that TWO cell sets were involved.
 */
export function reproduceInR(t: ReproduceTarget, msensVersion?: string | null): string {
  const head = [
    "# every number in this report, recomputed outside the browser",
    ...(msensVersion ? [`# requires msens >= ${msensVersion}`] : []),
    `con <- msens::sdm_db_con(version = ${q(t.ver)}, read_only = TRUE)`,
  ];
  if (t.zoneKeys && t.zoneKeys.length > 0) {
    const fld = t.zoneFld ?? "programarea_key";
    const lines = t.zoneKeys.flatMap((k) => [
      `msens::scores_for_pra(con, ${q(k)})                       # the 8 published components`,
      `msens::species_for_zone(con, ${q(fld)}, ${q(k)})  # the species table`,
    ]);
    return [...head, ...lines].join("\n");
  }
  const grid = t.gridId ? `msens::grid_spec_for(${q(t.gridId)})` : "msens::grid_spec_for(grid_id)";
  return [
    ...head,
    `g     <- msens::place_decode(${q(t.token ?? "")})[[1]]$geometry`,
    `cells <- msens::cells_in_polygon_grid(g, ${grid})`,
    'msens::scores_for_cells(con, cells, blend = TRUE, denominator = "study_area")  # D7b: clips internally',
    "msens::species_for_cells(con, cells)",
  ].join("\n");
}

function q(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export interface Provenance {
  ver: string;
  status: string | null;
  access: string | null;
  /** the app's git SHA, supplied by the caller (`__APP_VERSION__`/CI, never read here). */
  appSha: string;
  /** `@duckdb/duckdb-wasm`'s version string, supplied by the caller. */
  duckdbWasm: string | null;
  /** when the document was generated, ISO-8601 UTC. */
  generatedAt: string;
  /** `boot.built_at` -- when the RELEASE was built, which is the data's date, not the render's. */
  releaseBuiltAt: string | null;
  /** the msens version that built the release (`boot.msens`). */
  msens: string | null;
  tables: TableRead[];
  sql: SqlRun[];
  /** one snippet per place, in the report's order. */
  reproduceInR: string[];
}

export interface ProvenanceInput {
  ver: string;
  boot: unknown;
  status: string | null;
  access: string | null;
  appSha: string;
  duckdbWasm?: string | null;
  now: Date;
  tables: readonly string[];
  sql: readonly SqlRun[];
  targets: readonly ReproduceTarget[];
}

export function buildProvenance(input: ProvenanceInput): Provenance {
  const boot = input.boot as { built_at?: unknown; msens?: unknown } | null | undefined;
  const msens = typeof boot?.msens === "string" ? boot.msens : null;
  return {
    ver: input.ver,
    status: input.status,
    access: input.access,
    appSha: input.appSha,
    duckdbWasm: input.duckdbWasm ?? null,
    generatedAt: isoInstant(input.now),
    releaseBuiltAt: typeof boot?.built_at === "string" ? boot.built_at : null,
    msens,
    tables: tablesRead(input.boot, input.tables),
    sql: [...input.sql],
    reproduceInR: input.targets.map((t) => reproduceInR(t, msens)),
  };
}
