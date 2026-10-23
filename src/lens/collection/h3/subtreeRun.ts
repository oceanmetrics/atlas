// The WoRMS subtree's runner (obis-hex parity rows 7 and 11): the rules of `subtree.ts` fed to the atlas's DuckDB-WASM
// engine (`src/lib/engine/`, the same self-hosted 1.32 build the engine lens boots, its own instance here), and the
// computed cells handed to the map package's worker as Parquet through a `blob:` url: the h3r:// reader opens it by
// a suffix Range like any release file (Chromium answers Range on a blob: url with 206 and Content-Range; a 200 with
// the whole file works as well). A LAZY module: the layer imports it the first time a subtree is asked, so neither
// the engine nor this file is in the layer's own chunk.
//
//   1. the lineage (`species/lineage.parquet`, 1.68 MB, obisindicators 0.12; a release without it: the whole lookup),
//      whole, once per page (`lookup.ts`), registered in the engine from a copy
//   2. the taxa whose lineage holds the AphiaID; their classes and records from the lookup's `aphiaid, class,
//      records` columns (out of the whole lookup when the page holds it, else range reads of those columns, once per
//      page: `loadColumns`), and the classes' files at the table resolution
//   3. the files' sizes (HEAD, Content-Length) summed against the cap before a byte of them is read
//   4. the files, whole (kept registered: a zoom or a pan reads nothing again; past 32 MB loaded the oldest files the
//      current taxon and resolution do not use are dropped, `subtreeCache.ts`), the SQL, COPY to Parquet, a blob url
import { Engine } from "../../../lib/engine/engine";
import { readColumns } from "./cellSpecies";
import { hasLookup, loadColumns, loadLookup } from "./lookup";
import { ClassFileCache, LOADED_CAP_BYTES } from "./subtreeCache";
import {
  classesOf,
  classFileUrl,
  domainsOf,
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
  /** the lineage's and the lookup's class columns' bytes this computation fetched (once per page), else 0 */
  lookupBytes: number;
  /** HEAD and GET requests made */
  requests: number;
  /** the class files loaded in the engine after this computation (the lookup not counted), the cap past which the
   * oldest are dropped, and what this computation dropped */
  loadedBytes: number;
  capBytes: number;
  droppedFiles: number;
  droppedBytes: number;
  ms: number;
}

/** the slice of the engine the runner uses (a stub in tests) */
export type SubtreeEngine = Pick<
  Engine,
  "exec" | "load" | "loadBytes" | "drop" | "exportParquet" | "store"
>;

export interface SubtreeDeps {
  engine?: SubtreeEngine;
  /** the loaded class files' cap in bytes */
  cap?: number;
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
interface State {
  cache: ClassFileCache;
  /** the lineage registered in the engine, by url (once per engine) */
  lineage: Map<string, Promise<void>>;
  /** the lookup's fetch has been reported by a computation */
  runs: number;
  sizes: Map<string, Promise<number | null>>;
  taxa: Map<number, Promise<{ taxa: Set<number>; classes: { class: string; records: number }[] }>>;
}
const states = new WeakMap<object, State>();
const stateOf = (e: SubtreeEngine, cap: number): State => {
  let st = states.get(e);
  if (!st)
    states.set(
      e,
      (st = {
        cache: new ClassFileCache(e, cap),
        lineage: new Map(),
        runs: 0,
        sizes: new Map(),
        taxa: new Map(),
      }),
    );
  return st;
};

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const sq = (s: string) => `'${s.replaceAll("'", "''")}'`;

/** a file's size from a HEAD (the bucket's CORS exposes Content-Length); null when unknown */
function sizeOf(
  sizes: State["sizes"],
  url: string,
  f: typeof fetch,
  read: SubtreeRead,
): Promise<number | null> {
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
  deps: SubtreeDeps = {},
): Promise<SubtreeOutcome> {
  const t0 = now();
  const e: SubtreeEngine = deps.engine ?? getEngine();
  const st = stateOf(e, deps.cap ?? LOADED_CAP_BYTES);
  const { sizes, cache } = st;
  const read: SubtreeRead = {
    bytes: 0,
    filesBytes: 0,
    files: 0,
    lookupBytes: 0,
    requests: 0,
    loadedBytes: 0,
    capBytes: cache.cap,
    droppedFiles: 0,
    droppedBytes: 0,
    ms: 0,
  };
  const done = () => ((read.loadedBytes = cache.loadedBytes()), (read.ms = now() - t0), read);

  // the class columns, started now beside the lineage (neither waits on the other): out of the whole lookup when the
  // page holds it (the Cell pane's read, or a release with no lineage file), else by range reads of those columns
  const want = [req.table.key, "class", "records"];
  const colsP = st.taxa.has(req.aphiaid)
    ? null
    : hasLookup(req.table.lookup) || !req.table.lineage
      ? loadLookup(req.table.lookup, f).then(async (w) => ({
          rows: await readColumns(w.buffer, want),
          fetched: w.fetched,
          requests: w.fetched > 0 ? 1 : 0,
        }))
      : loadColumns(req.table.lookup, want, f === fetch ? undefined : f);
  colsP?.catch(() => {});

  // 1. the lineage, once per page (a read counts when this computation made it), registered in the engine from a copy
  // (the database takes the array over); a release with no lineage file: the whole lookup, which holds it
  const lineageUrl = req.table.lineage ?? req.table.lookup;
  const lin = await loadLookup(lineageUrl, f);
  if (lin.fetched > 0) {
    read.requests++;
    read.lookupBytes += lin.fetched;
  }
  const lineageName = `subtree_lineage_${fileName(lineageUrl)}`;
  let reg = st.lineage.get(lineageUrl);
  if (!reg) {
    reg = e.loadBytes(lineageName, lineageUrl, new Uint8Array(lin.buffer.slice(0)));
    st.lineage.set(lineageUrl, reg);
    reg.catch(() => st.lineage.delete(lineageUrl));
  }
  await reg;
  const lineageRef = `read_parquet(${sq(lineageName)})`;

  // 2. the taxa (the lineage), their classes and records (the lookup's columns, once per page), once per AphiaID
  let tp = st.taxa.get(req.aphiaid);
  if (!tp) {
    tp = (async () => {
      const ids = await e.exec<{ aphiaid: bigint | number }>(
        subtreeTaxaSql(lineageRef, req.aphiaid),
      );
      const taxa = new Set(ids.map((r) => Number(r.aphiaid)));
      const cols = await (colsP ??
        loadColumns(req.table.lookup, want, f === fetch ? undefined : f));
      read.requests += cols.requests;
      read.lookupBytes += cols.fetched;
      const classes = classesOf(taxa, cols.rows, req.table.key, req.table.nullClass).map((c) => ({
        class: c.class,
        records: c.records,
      }));
      return { taxa, classes };
    })();
    tp.catch(() => st.taxa.delete(req.aphiaid));
    st.taxa.set(req.aphiaid, tp);
  }
  const { taxa, classes } = await tp;
  if (classes.length === 0) return { kind: "empty", read: done() };

  // 3. the files and their sizes, against the cap
  const files: SubtreeFile[] = await Promise.all(
    classes.map(async (c) => {
      const url = classFileUrl(req.table, req.tableRes, c.class, req.decade);
      return { url, cls: c.class, bytes: await sizeOf(sizes, url, f, read) };
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
              classes.map((c) =>
                sizeOf(sizes, classFileUrl(req.table, r, c.class, req.decade), f, read),
              ),
            )
          ).reduce<number>((a, b) => a + (b ?? 0), 0),
        })),
    );
    plan = subtreePlan({ name: req.name, res: req.res, files: present, max, coarser });
    return { kind: "refused", line: plan.line!, bytes: plan.bytes, read: done() };
  }
  if (present.length === 0) return { kind: "empty", read: done() };

  // 4. the files, the cells, the Parquet. The files are held from the first byte to the last query: another run's
  // trim (a zoom, then another) never drops what this one reads, and this one's own are the most recently used.
  const names = present.map((x) => fileName(x.url));
  const release = cache.acquire(names);
  let d: ReturnType<typeof domainsOf>;
  let bytes: Uint8Array;
  let rowsOf: (refs: string[]) => string;
  let opts: {
    aphiaid: number;
    res: number;
    tableRes: number;
    ranges: [bigint, bigint][] | null;
    esn: number;
  };
  try {
    for (const [i, x] of present.entries()) {
      const had = e.store?.has(names[i]) ?? false;
      await e.load(names[i], x.url, x.url);
      if (!had) {
        read.requests++;
        read.bytes += e.store?.get(names[i])?.bytes ?? 0;
      }
    }
    // past the cap the oldest files nothing holds are dropped, before the query allocates
    const trimmed = await cache.trim();
    read.droppedFiles = trimmed.dropped.length;
    read.droppedBytes = trimmed.droppedBytes;
    rowsOf = (refs) =>
      `(${refs.map((r) => `SELECT cell_id, aphiaid, n FROM read_parquet(${r})`).join(" UNION ALL ")})`;
    opts = {
      aphiaid: req.aphiaid,
      res: req.res,
      tableRes: req.tableRes,
      ranges: req.ranges,
      esn: req.esn,
    };
    const sql = subtreeSql({ rows: rowsOf(names.map(sq)), lookup: lineageRef, ...opts });
    // a table of its own per run: two runs in flight (a zoom, then another) interleave on the engine's one chain
    const tbl = `subtree_cells_${++st.runs}`;
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
  } finally {
    release();
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
      lookup: `read_parquet(${sq(lineageUrl)})`,
      ...opts,
    }),
  };
}
