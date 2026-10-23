// The per-model tables of the two MST v8 density collections (nc, gm), as STAC Items.
//
// STOPGAP: the MST STAC publishes ONE `model_cell` Item per collection and no per-model Items, so the
// dimensions of nc (region x species x season x variable) and gm (species x time) cannot be read from
// it. `scripts/mst/build-manifests.mjs` writes them out of the MST workflows' own tables
// (`nc_models.csv`, `nc_taxon_crosswalk.csv`, `model_gm.csv`, `gm_cog_registry.csv`) as
// `public/mst/{nc,gm}_models.json`; this module reads that file (lazily, when the collection is
// opened) and turns each row into an Item whose `atlas:dims` the Collections lens' selectors already
// understand. When the MST STAC publishes per-model Items this module and the manifests go away.
//
// A manifest is columnar to stay small: `dims` names the selectors in order, and each `models` row is
// `[...one value per dim, cogUrl, bidx]`.
import type { CubeDimension, StacAsset, StacItem } from "../types";
import { onStorage } from "../storage";
import { COG_MEDIA_TYPE } from "./taxon";

export interface ManifestDim {
  key: string;
  title: string;
  description?: string;
  values: { value: string; label: string }[];
}

export interface ManifestTaxon {
  scientific_name?: string;
  common_name?: string;
  /** `true` for a species group (a guild: "Cormorant spp."), which is its own row. */
  group?: boolean;
  /** a sentence for the Item's description (what the value means for this taxon). */
  note?: string;
  ids?: Record<string, string>;
}

export interface MstManifest {
  schema: 1;
  /** the STAC collection id (`msens-v8-nc`). */
  collection: string;
  /** one line saying this is the stopgap and where it came from. */
  stopgap: string;
  generated: string;
  /** the dimension whose values name a taxon (`species`): its metadata is in `taxa`. */
  taxon_dim: string;
  dims: ManifestDim[];
  /** per value of the `variable` dimension (when there is one): the unit shown on the legend. */
  units: Record<string, string>;
  /** the unit of every model's values when there is no `variable` dimension (gm: the relative index). */
  unit?: string;
  /** a fixed display rescale for every model (gm: the relative 1-100 index); absent = titiler's
   * own band statistics per model (`raster/rescale.ts`). */
  rescale?: [number, number];
  /** per value of `taxon_dim`. */
  taxa: Record<string, ManifestTaxon>;
  /** `[...dim values in `dims` order, cogUrl, bidx]`. */
  models: (string | number)[][];
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** a validated manifest, or a string naming the first violation. */
export function parseManifest(raw: unknown): MstManifest | string {
  if (!isObj(raw)) return "not an object";
  if (raw.schema !== 1) return "unsupported schema";
  if (typeof raw.collection !== "string") return "no collection id";
  if (!Array.isArray(raw.dims) || raw.dims.length === 0) return "no dims";
  for (const d of raw.dims) {
    if (!isObj(d) || typeof d.key !== "string" || !Array.isArray(d.values)) return "malformed dim";
  }
  if (!Array.isArray(raw.models)) return "no models";
  const n = raw.dims.length;
  for (const row of raw.models) {
    if (!Array.isArray(row) || row.length !== n + 2) return "a model row has the wrong length";
    if (typeof row[n] !== "string" || typeof row[n + 1] !== "number") return "malformed model row";
  }
  return {
    schema: 1,
    collection: raw.collection,
    stopgap: typeof raw.stopgap === "string" ? raw.stopgap : "",
    generated: typeof raw.generated === "string" ? raw.generated : "",
    taxon_dim: typeof raw.taxon_dim === "string" ? raw.taxon_dim : "species",
    dims: raw.dims as ManifestDim[],
    units: isObj(raw.units) ? (raw.units as Record<string, string>) : {},
    ...(typeof raw.unit === "string" ? { unit: raw.unit } : {}),
    ...(Array.isArray(raw.rescale) &&
    raw.rescale.length === 2 &&
    raw.rescale.every((v) => typeof v === "number" && Number.isFinite(v))
      ? { rescale: raw.rescale as [number, number] }
      : {}),
    taxa: isObj(raw.taxa) ? (raw.taxa as Record<string, ManifestTaxon>) : {},
    models: raw.models as (string | number)[][],
  };
}

/** the stable id of a model's Item (and so its `?i=`): the dim values joined by `.`. */
export function manifestItemId(dimValues: readonly string[]): string {
  return dimValues.join(".");
}

/** `cube:dimensions` for the manifest's dims, in order (labels via `atlas:labels`). */
export function manifestCube(m: MstManifest): Record<string, CubeDimension> {
  const out: Record<string, CubeDimension> = {};
  for (const d of m.dims) {
    out[d.key] = {
      type: "other",
      title: d.title,
      ...(d.description ? { description: d.description } : {}),
      values: d.values.map((v) => v.value),
      "atlas:labels": Object.fromEntries(d.values.map((v) => [v.value, v.label])),
      ...(d.key === m.taxon_dim ? { "atlas:taxon_dim": true } : {}),
    };
  }
  return out;
}

/** one STAC Item per model row. Unless the manifest fixes a rescale, the COG asset asks for
 * `rescale: "auto"` (titiler's own band statistics, `raster/rescale.ts`): nc surfaces are densities
 * in their own units and every band has its own range. */
export function manifestItems(m: MstManifest): StacItem[] {
  const n = m.dims.length;
  const labelOf = (dimIdx: number, value: string): string =>
    m.dims[dimIdx].values.find((v) => v.value === value)?.label ?? value;
  const taxonIdx = Math.max(
    0,
    m.dims.findIndex((d) => d.key === m.taxon_dim),
  );
  const varIdx = m.dims.findIndex((d) => d.key === "variable");
  return m.models.map((row) => {
    const values = row.slice(0, n).map(String);
    // a url on a storage host (gm's S3 cogs) is read from the build's storage host; titiler-era and
    // file.marinesensitivity.org urls pass through
    const url = onStorage(String(row[n]));
    const bidx = Number(row[n + 1]);
    const dims = Object.fromEntries(m.dims.map((d, i) => [d.key, values[i]]));
    const taxonKey = values[taxonIdx];
    const taxon = m.taxa[taxonKey];
    const unit = varIdx >= 0 ? m.units[values[varIdx]] : m.unit;
    // the taxon first, then the other dimensions in selector order
    const title = [taxonIdx, ...values.map((_, i) => i).filter((i) => i !== taxonIdx)]
      .map((i) => labelOf(i, values[i]))
      .join(" · ");
    const asset: StacAsset = {
      href: url,
      type: COG_MEDIA_TYPE,
      roles: ["data"],
      "atlas:bidx": bidx,
      "atlas:rescale": m.rescale ?? "auto",
    };
    return {
      type: "Feature",
      id: manifestItemId(values),
      collection: m.collection,
      properties: {
        title,
        ...(taxon?.note ? { description: taxon.note } : {}),
        datetime: null,
        "atlas:dims": dims,
        ...(m.rescale ? { "atlas:value_range": m.rescale } : {}),
        ...(unit ? { "sdm:value_unit": unit } : {}),
        ...(taxon
          ? {
              "sdm:taxon": {
                scientific_name: taxon.scientific_name ?? labelOf(taxonIdx, taxonKey),
                ...(taxon.common_name ? { common_name: taxon.common_name } : {}),
                ...(taxon.group ? { group: true } : {}),
                ids: taxon.ids ?? {},
              },
            }
          : {}),
      },
      assets: { data: asset },
      links: [],
    } satisfies StacItem;
  });
}

// --- loading --------------------------------------------------------------------------------------

export type ManifestKind = "nc" | "gm";

/** where the manifest lives: `mst/{kind}_models.json` next to the app (same origin, relative to the
 * page, so it works under any mount path like every other static asset). */
export function manifestUrl(kind: ManifestKind, base?: string): string {
  const root =
    base ??
    (typeof document !== "undefined"
      ? new URL(import.meta.env.BASE_URL, document.baseURI).href
      : "http://localhost/");
  return new URL(`mst/${kind}_models.json`, root).href;
}

export type ManifestResult =
  { ok: true; manifest: MstManifest } | { ok: false; url: string; message: string };

export async function loadManifest(
  kind: ManifestKind,
  opts: { fetchImpl?: typeof fetch; base?: string } = {},
): Promise<ManifestResult> {
  const url = manifestUrl(kind, opts.base);
  const f = opts.fetchImpl ?? (typeof fetch === "function" ? fetch : undefined);
  if (!f) return { ok: false, url, message: "fetch is not available" };
  let raw: unknown;
  try {
    const res = await f(url);
    if (!res.ok) return { ok: false, url, message: `HTTP ${res.status}` };
    raw = await res.json();
  } catch (e) {
    return { ok: false, url, message: e instanceof Error ? e.message : String(e) };
  }
  const parsed = parseManifest(raw);
  if (typeof parsed === "string") return { ok: false, url, message: parsed };
  return { ok: true, manifest: parsed };
}
