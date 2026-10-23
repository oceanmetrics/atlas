// analysis/sources.ts -- the browser plumbing under `queries.ts` (atlas-2 Step 3b).
//
// Turns "this release, these tiles" into DuckDB views the `sql/*.sql` twins can name. It is the
// ONLY module that knows a release's objects are fetched over HTTP and registered as virtual files;
// every twin sees plain view names (`cell`, `cell_model`, `cell_model_key`, `taxon`, `zone_taxon`,
// `taxonomy`, `model`), exactly as the R twins see plain table names.
//
// Materialize, then query (plan D3/atlas-2 `engine/`): whole objects through `Engine#load`, no
// httpfs range reads. A `cell` tile is ~110-250 KB and a `cell_model` tile p50 2.1 MB / max 23.7 MB,
// all under the 25 MB materialize guard.
import { MAX_CELL_MODEL_TILES, batchTiles } from "./place";
import { cellModelKeySql, componentMetricKeys, type SqlRunner, type Templates } from "./queries";
import { ident } from "../engine/sql";
import { noDigestKey } from "../engine/store/policy";
import type { Engine } from "../engine/engine";

// P8 item 1: `placeCells`/`tilesForCells` (`analysis/place.ts`) compute tile indices GEOMETRICALLY,
// from the grid -- not from the release's actual object list -- so a place that touches land or
// runs past a release's published footprint asks for a tile the release never generated. S3
// answers a GetObject on a missing key with 403 (no ListBucket permission to disclose 404 vs
// "forbidden"); a plain 404 means the same thing. Reproduced live (v7, `-170,50,-130,60`):
// `.../v7/app/cell/tile=593/data_0.parquet` 403s while neighbours 588-592 answer 200. That is a
// release-side gap, not a failure -- the tile has no scored cells, so the two per-tile loops below
// skip it and keep going. Anything else (5xx, a network error, a malformed response) is a REAL
// failure and must still reject (`describeAnalysisError`, `places/results.ts`), so this checks the
// status, not just "did the fetch throw". `engine/materialize.ts#fetchWithSizeGuard` throws
// `Error("fetch <url>: HTTP <code>")`, and `engine.ts` wraps every failure as
// `EngineUnavailableError("data engine unavailable: <cause>")` -- both shapes end in "HTTP <code>",
// so a suffix match survives either layer of wrapping.
export function isMissingTileStatus(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const m = /HTTP (\d+)\s*$/.exec(msg);
  return m !== null && (m[1] === "403" || m[1] === "404");
}

/** the `boot.tables` entry shape atlas-1 publishes. */
interface BootTable {
  href?: unknown;
  digest?: unknown;
}

export interface SourcesOptions {
  /** builds an absolute URL for a path under this release, e.g. `app/taxon.parquet`. The ONE place
   * a data origin is formed stays `release/dataBase.ts`; this is its caller, never a second copy. */
  url: (path: string) => string;
  /** `boot.json`, parsed. */
  boot: Record<string, unknown>;
  templates: Templates;
}

/**
 * `boot.tables[name].digest` when the release publishes one, else {@link noDigestKey} — `boot.
 * built_at` + the object's path (atlas-2 phase review, ruling 4).
 *
 * The fallback used to be the release-relative PATH alone, which is constant for the life of a
 * release: `tables/model.parquet` on v1-v7, every `serve/cell_model` tile, and `taxonomy` wherever
 * `boot.tables` omits it were therefore cached in OPFS forever, and a corrected re-publish was
 * served stale indefinitely. `noDigestKey` is the ONE place that rule lives; `policy.ts`'s
 * `expectedDigestFromBoot` (the session-start reconcile) computes the identical key from the same
 * function, so the two cannot drift. A `boot` with no `built_at` fails closed — the key then
 * carries a per-session token and nothing persisted is ever reused.
 */
function digestOf(boot: Record<string, unknown>, name: string, path: string): string {
  const tables = boot.tables as Record<string, BootTable> | undefined;
  const d = tables?.[name]?.digest;
  return typeof d === "string" && d.length ? d : noDigestKey(boot, path);
}

export class AnalysisSources {
  readonly engine: Engine;
  readonly boot: Record<string, unknown>;
  readonly templates: Templates;
  #url: (path: string) => string;
  #mountedCellModel: number[] = [];

  constructor(engine: Engine, opts: SourcesOptions) {
    this.engine = engine;
    this.boot = opts.boot;
    this.templates = opts.templates;
    this.#url = opts.url;
  }

  /** `queries.ts` only ever needs `exec`, so the Engine is handed over as exactly that. */
  get db(): SqlRunner {
    return this.engine;
  }

  get ver(): string {
    return String(this.boot.ver ?? "");
  }

  /** `boot.id_field`: the ONE generation fact the contract lets the browser know (atlas-1). */
  get idField(): string {
    return String(this.boot.id_field ?? "");
  }

  /** load one whole-object table and expose it under `view`. */
  async table(view: string, path: string, bootName = view): Promise<void> {
    const file = `${this.ver}/${path}`;
    await this.engine.load(file, this.#url(path), digestOf(this.boot, bootName, file));
    await this.#view(view, [file]);
  }

  /** the digest one object is keyed on — exposed so a test can assert the rule without a DuckDB. */
  digestFor(path: string, bootName?: string): string {
    const file = `${this.ver}/${path}`;
    return digestOf(this.boot, bootName ?? file, file);
  }

  /**
   * The small tables every lens needs. `taxonomy` and `model` are OPTIONAL by presence: a release
   * whose bundle has neither still answers scores and the zone species table.
   *
   * `model` is NOT under `app/`: atlas-1's `boot.tables` publishes only `cell`, `taxon` and
   * `zone_taxon`, yet `sql/cell_model_key.sql` (every v8+ release) must map `mdl_id` -> `mdl_key`.
   * The only published object carrying that map is `{ver}/tables/model.parquet` (1.1 MB, anonymously
   * readable, verified on v7 and v9). REPORTED TO THE R SIDE: it belongs in `app/` with a digest,
   * like `taxonomy.parquet` (the reviewer's finding B), or OPFS can never invalidate either one.
   */
  async coreTables(opts: { taxonomy?: boolean } = {}): Promise<void> {
    await this.table("taxon", "app/taxon.parquet");
    await this.table("zone_taxon", "app/zone_taxon.parquet");
    if (opts.taxonomy !== false) await this.table("taxonomy", "app/taxonomy.parquet");
    if (this.idField === "mdl_key") await this.table("model", "tables/model.parquet");
  }

  /** the wide cell tiles covering a place, as the `cell` view. P8 item 1: a tile that 403/404s is
   * skipped (no scored cells there), not a failure -- see the module header. If EVERY tile of the
   * place's footprint is missing, `#emptyCellView` builds a typed, permanently-empty `cell` so the
   * caller still gets a real (zero-coverage) answer instead of `#view`'s "not registered" error. */
  async cellTiles(tiles: readonly number[]): Promise<void> {
    const names: string[] = [];
    const cell = (this.boot.tables as Record<string, BootTable> | undefined)?.cell?.digest;
    const published = typeof cell === "string" && cell.length ? cell : null;
    for (const t of tiles) {
      const path = `app/cell/tile=${t}/data_0.parquet`;
      const file = `${this.ver}/${path}`;
      // the composite `policy.ts`'s `expectedDigestFromBoot` reconstructs: one published `cell`
      // digest invalidates every cell tile of the release. With no published digest it falls to
      // `noDigestKey`, which already carries the path (tile included), so no `:${t}` suffix.
      const digest = published ? `${published}:${t}` : noDigestKey(this.boot, file);
      try {
        await this.engine.load(file, this.#url(path), digest);
        names.push(file);
      } catch (err) {
        if (isMissingTileStatus(err)) continue;
        throw err;
      }
    }
    if (names.length) await this.#view("cell", names);
    else await this.#emptyCellView();
  }

  /**
   * Mount ONE batch of `cell_model` tiles as `cell_model` + `cell_model_key`.
   *
   * `cell_model` has no `boot.tables` entry either (it lives under `{ver}/serve/`, unchanged from
   * what the server already publishes), so it is keyed on `boot.built_at` + the path
   * ({@link noDigestKey}, atlas-2 phase review ruling 4). It used to be `{ver}:cell_model:{tile}` —
   * constant for the life of the release, i.e. cached in OPFS forever.
   */
  async mountCellModel(tiles: readonly number[]): Promise<void> {
    const names: string[] = [];
    for (const t of tiles) {
      const path = `serve/cell_model/tile=${t}/data_0.parquet`;
      const file = `${this.ver}/${path}`;
      try {
        await this.engine.load(file, this.#url(path), noDigestKey(this.boot, file));
        names.push(file);
      } catch (err) {
        // P8 item 1: the same release-side gap `cellTiles` sees -- `cell_model`'s own tile is the
        // "twin" P7 found missing alongside `cell`'s (module header). No species live in a tile
        // that was never published.
        if (isMissingTileStatus(err)) continue;
        throw err;
      }
    }
    if (names.length) await this.#view("cell_model", names);
    else await this.#emptyCellModelView();
    await this.engine.exec(
      `CREATE OR REPLACE VIEW cell_model_key AS ${cellModelKeySql(this.templates, this.idField).replace(/;\s*$/, "").trimEnd()};`,
    );
    this.#mountedCellModel = [...tiles];
  }

  /** drop a batch's buffers -- the entire point of batching (plan atlas-2 `engine/`). */
  async unmountCellModel(): Promise<void> {
    const store = this.engine.store;
    for (const t of this.#mountedCellModel) {
      await store?.drop(`${this.ver}/serve/cell_model/tile=${t}/data_0.parquet`);
    }
    this.#mountedCellModel = [];
  }

  /** the batches `speciesForCells()` should walk (<= {@link MAX_CELL_MODEL_TILES} tiles each). */
  batches(tiles: readonly number[], size = MAX_CELL_MODEL_TILES): number[][] {
    return batchTiles(tiles, size);
  }

  /**
   * One view over one or more registered files.
   *
   * `UNION ALL BY NAME`, not positional: two tiles of the same release always carry the same
   * columns today, but a by-name union is the version of this that cannot silently transpose a
   * metric column into another metric's place if that ever stops being true.
   *
   * The FROM fragments come from the store's own `ref()` (`read_parquet('name')` on MEMORY, a bare
   * identifier on OPFS in Step 4), so this module never assumes which tier is live.
   */
  async #view(name: string, files: readonly string[]): Promise<void> {
    if (!files.length) throw new Error(`no files registered for view ${name}`);
    const store = this.engine.store;
    const parts = files.map((f) => {
      const ref = store?.ref(f);
      if (!ref) throw new Error(`table "${f}" is not registered`);
      return `SELECT * FROM ${ref.from}`;
    });
    await this.engine.exec(
      `CREATE OR REPLACE VIEW ${ident(name)} AS ${parts.join(" UNION ALL BY NAME ")};`,
    );
  }

  /**
   * P8 item 1: every tile the place's footprint touches was missing (403/404) -- a real, if
   * empty, result (an off-grid or unpublished-footprint place genuinely has zero cell data), not a
   * `#view`-throws-"not registered" crash. A typed, permanently-empty `SELECT ... WHERE FALSE`
   * carries exactly the columns every `sql/*.sql` twin that reads `cell` needs: the four fixed
   * ones (`cells_in_study_area.sql`'s `in_usa`, `species_for_cells.sql`'s `area_km2`,
   * `cell_components.sql`'s `in_pra`) plus this release's own component metric keys
   * (`queries.ts#componentMetricKeys` -- the same list `scores_for_cells.sql`'s `{{cols}}`
   * substitutes), so a downstream JOIN/UNPIVOT sees the columns it expects and just matches zero
   * rows.
   */
  async #emptyCellView(): Promise<void> {
    const cols = [
      "NULL::INTEGER AS cell_id",
      "NULL::DOUBLE AS area_km2",
      "NULL::BOOLEAN AS in_usa",
      "NULL::BOOLEAN AS in_pra",
      ...componentMetricKeys(this.boot).map((k) => `NULL::DOUBLE AS ${ident(k)}`),
    ];
    await this.engine.exec(`CREATE OR REPLACE VIEW cell AS SELECT ${cols.join(", ")} WHERE FALSE;`);
  }

  /** the `cell_model` twin of {@link #emptyCellView}, for `mountCellModel` when every tile of a
   * batch was missing. Columns match `sql/cell_model_key.sql` (v8+, `mdl_id`) /
   * `cell_model_seq.sql` (v1-v7, `mdl_seq`), chosen the same way `mountCellModel` chooses which
   * twin to run: `this.idField`. */
  async #emptyCellModelView(): Promise<void> {
    const idCol = this.idField === "mdl_key" ? "mdl_id" : "mdl_seq";
    const cols = ["NULL::INTEGER AS cell_id", "NULL::DOUBLE AS val", `NULL::INTEGER AS ${idCol}`];
    await this.engine.exec(
      `CREATE OR REPLACE VIEW cell_model AS SELECT ${cols.join(", ")} WHERE FALSE;`,
    );
  }
}
