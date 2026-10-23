// The WoRMS subtree's runner (obis-hex parity rows 7 and 11): the rules of `subtree.ts` fed to the atlas's DuckDB-WASM
// engine (`src/lib/engine/`, the same self-hosted 1.32 build the engine lens boots, its own instance here), and the
// computed cells handed to the map package's worker as Parquet through a `blob:` url: the h3r:// reader opens it by
// a suffix Range like any release file (Chromium answers Range on a blob: url with 206 and Content-Range; a 200 with
// the whole file works as well). A LAZY module: the layer imports it the first time a subtree is asked, so neither
// the engine nor this file is in the layer's own chunk.
//
//   1. the lookup (`species/species.parquet`), whole, once per page (the engine's materialize-then-query)
//   2. the classes of the taxa whose lineage holds the AphiaID, and their files at the table resolution
//   3. the files' sizes (HEAD, Content-Length) summed against the cap before a byte of them is read
//   4. the files, whole (kept registered: a zoom or a pan reads nothing again), the SQL, COPY to Parquet, a blob url
import { Engine } from "../../../lib/engine/engine";
import {
  classFileUrl,
  domainsOf,
  subtreeClassesSql,
  subtreePlan,
  subtreeSql,
  subtreeSummarySql,
  subtreeTaxaSql,
  SUBTREE_MAX_BYTES,
  type SubtreeDomain,
  type SubtreeFile,
  type SubtreeTable,
} from "./subtree";

export interface SubtreeRequest {
  table: SubtreeTable;
  aphiaid: number;
  /** the taxon's name, for the words */
  name: string;
  res: number;
  tableRes: number;
  decade: string | null;
  ranges: [bigint, bigint][] | null;
  indicators: readonly string[];
  esn: number;
  max?: number;
}

export interface SubtreeRead {
  /** bytes of the species table's files fetched by this computation (0 when they were registered already) */
  bytes: number;
  /** the files' sizes, fetched or not */
  filesBytes: number;
  files: number;
  /** the lookup's bytes when this computation fetched it (once per page), else 0 */
  lookupBytes: number;
  /** HEAD and GET requests made */
  requests: number;
  ms: number;
}

export type SubtreeOutcome =
  | {
      kind: "ready";
      /** the cells as Parquet, a blob: url (the caller revokes it when it is replaced) */
      href: string;
      parquetBytes: number;
      cells: number;
      domains: Record<string, SubtreeDomain | null>;
      read: SubtreeRead;
      /** the subtree's aphiaids (the Cell pane keeps their species) and records (the lookup's) */
      taxa: ReadonlySet<number>;
      records: number;
      classes: string[];
      /** the same SQL over the release's own urls, for Reproduce */
      sql: string;
    }
  | { kind: "refused"; line: string; bytes: number; read: SubtreeRead }
  | { kind: "empty"; read: SubtreeRead };

let engine: Engine | null = null;
const getEngine = () => (engine ??= new Engine({}));
const LOOKUP = "subtree_lookup.parquet";
let lookupBytesCounted = false;
let runs = 0;
const sizes = new Map<string, Promise<number | null>>();
const taxaCache = new Map<
  number,
  Promise<{ taxa: Set<number>; classes: { class: string; records: number }[] }>
>();

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const sq = (s: string) => `'${s.replaceAll("'", "''")}'`;

/** a file's size from a HEAD (the bucket's CORS exposes Content-Length); null when unknown */
function sizeOf(url: string, f: typeof fetch, read: SubtreeRead): Promise<number | null> {
  let p = sizes.get(url);
  if (!p) {
    read.requests++;
    p = f(url, { method: "HEAD" }).then(
      (r) => {
        if (r.status === 403 || r.status === 404) return 0;
        const n = Number(r.headers.get("Content-Length"));
        return r.ok && Number.isFinite(n) ? n : null;
      },
      () => null,
    );
    sizes.set(url, p);
  }
  return p;
}

const fileName = (url: string) =>
  `subtree_${url.replace(/^https?:\/\//, "").replace(/[^A-Za-z0-9]+/g, "_")}.parquet`;

/** compute a subtree's cells at one resolution (and decade, and box) */
export async function runSubtree(
  req: SubtreeRequest,
  f: typeof fetch = fetch,
): Promise<SubtreeOutcome> {
  const t0 = now();
  const e = getEngine();
  const read: SubtreeRead = {
    bytes: 0,
    filesBytes: 0,
    files: 0,
    lookupBytes: 0,
    requests: 0,
    ms: 0,
  };
  const done = () => ((read.ms = now() - t0), read);

  // 1. the lookup, once per page
  const hadLookup = e.store?.has(LOOKUP) ?? false;
  await e.load(LOOKUP, req.table.lookup, req.table.lookup);
  if (!hadLookup) read.requests++;
  if (!lookupBytesCounted) {
    read.lookupBytes = e.store?.get(LOOKUP)?.bytes ?? 0;
    lookupBytesCounted = true;
  }
  const lookupRef = `read_parquet(${sq(LOOKUP)})`;

  // 2. the taxa and their classes (once per AphiaID)
  let tp = taxaCache.get(req.aphiaid);
  if (!tp) {
    tp = (async () => {
      const classes = (
        await e.exec<{ class: string; taxa: number; records: number }>(
          subtreeClassesSql(lookupRef, req.aphiaid, req.table.nullClass),
        )
      ).map((r) => ({ class: String(r.class), records: Number(r.records) }));
      const ids = await e.exec<{ aphiaid: bigint | number }>(
        subtreeTaxaSql(lookupRef, req.aphiaid),
      );
      return { taxa: new Set(ids.map((r) => Number(r.aphiaid))), classes };
    })();
    tp.catch(() => taxaCache.delete(req.aphiaid));
    taxaCache.set(req.aphiaid, tp);
  }
  const { taxa, classes } = await tp;
  if (classes.length === 0) return { kind: "empty", read: done() };

  // 3. the files and their sizes, against the cap
  const files: SubtreeFile[] = await Promise.all(
    classes.map(async (c) => {
      const url = classFileUrl(req.table, req.tableRes, c.class, req.decade);
      return { url, cls: c.class, bytes: await sizeOf(url, f, read) };
    }),
  );
  const present = files.filter((x) => x.bytes !== 0);
  read.files = present.length;
  read.filesBytes = present.reduce((a, x) => a + (x.bytes ?? 0), 0);
  const max = req.max ?? SUBTREE_MAX_BYTES;
  let plan = subtreePlan({ name: req.name, res: req.res, files: present, max });
  if (plan.over) {
    const table =
      req.decade && req.table.decade ? req.table.decade.resolutions : req.table.resolutions;
    const coarser = await Promise.all(
      table
        .filter((r) => r < req.tableRes)
        .map(async (r) => ({
          res: r,
          bytes: (
            await Promise.all(
              classes.map((c) => sizeOf(classFileUrl(req.table, r, c.class, req.decade), f, read)),
            )
          ).reduce<number>((a, b) => a + (b ?? 0), 0),
        })),
    );
    plan = subtreePlan({ name: req.name, res: req.res, files: present, max, coarser });
    return { kind: "refused", line: plan.line!, bytes: plan.bytes, read: done() };
  }
  if (present.length === 0) return { kind: "empty", read: done() };

  // 4. the files, the cells, the Parquet
  const names: string[] = [];
  for (const x of present) {
    const name = fileName(x.url);
    const had = e.store?.has(name) ?? false;
    await e.load(name, x.url, x.url);
    if (!had) {
      read.requests++;
      read.bytes += e.store?.get(name)?.bytes ?? 0;
    }
    names.push(name);
  }
  const rowsOf = (refs: string[]) =>
    `(${refs.map((r) => `SELECT cell_id, aphiaid, n FROM read_parquet(${r})`).join(" UNION ALL ")})`;
  const opts = {
    aphiaid: req.aphiaid,
    res: req.res,
    tableRes: req.tableRes,
    ranges: req.ranges,
    esn: req.esn,
  };
  const sql = subtreeSql({ rows: rowsOf(names.map(sq)), lookup: lookupRef, ...opts });
  // a table of its own per run: two runs in flight (a zoom, then another) interleave on the engine's one chain
  const tbl = `subtree_cells_${++runs}`;
  let d: ReturnType<typeof domainsOf>;
  let bytes: Uint8Array;
  try {
    await e.exec(`CREATE TABLE ${tbl} AS ${sql}`);
    const [summary] = await e.exec(subtreeSummarySql(tbl, req.indicators));
    d = domainsOf(summary, req.indicators);
    if (d.cells === 0) return { kind: "empty", read: done() };
    bytes = await e.exportParquet(
      `${tbl}.parquet`,
      `SELECT * FROM ${tbl} ORDER BY cell_id`,
      "ROW_GROUP_SIZE 10240",
    );
  } finally {
    void e.exec(`DROP TABLE IF EXISTS ${tbl}`).catch(() => {});
  }
  const href = URL.createObjectURL(
    new Blob([new Uint8Array(bytes)], { type: "application/vnd.apache.parquet" }),
  );
  return {
    kind: "ready",
    href,
    parquetBytes: bytes.byteLength,
    cells: d.cells,
    domains: d.byIndicator,
    read: done(),
    taxa,
    records: classes.reduce((a, c) => a + c.records, 0),
    classes: classes.map((c) => c.class),
    sql: subtreeSql({
      rows: rowsOf(present.map((x) => sq(x.url))),
      lookup: `read_parquet(${sq(req.table.lookup)})`,
      ...opts,
    }),
  };
}
