// R3-W2 Deliverable 2: the download filename builders. Pure and DOM-free (CLAUDE.md: core logic
// lives in an exported function; a component only calls it) -- `clock` is injected so a test never
// depends on the real date.
//
// Map figures: `oceanmetrics-atlas_{lens}_{layer-or-species-key}_{ver}_{yyyymmdd}.{ext}` (the brief's own
// convention, one word per field, `_` between fields -- never a raw title with spaces or slashes).
// The data-layer GeoTIFF keeps its OWN suffix (`..._{metric_or_mdl_key}.tif`) because the brief
// asks for the metric/model id specifically, not the human label `key()` sanitizes for the other
// two -- a `mdl_key` (`am|Fis-29291`) is already opaque/safe and is kept byte-for-byte so a
// downloaded file's name matches the id printed everywhere else in the app (deep links, STAC).

/** `YYYYMMDD`, UTC (matches `dataBase.ts`'s own convention of not depending on the visitor's
 * timezone for anything that becomes a filename or a cache key). */
export function yyyymmdd(clock: () => Date = () => new Date()): string {
  return clock().toISOString().slice(0, 10).replace(/-/g, "");
}

/** a human label -> filesystem-safe key: lowercased, non-alphanumeric runs collapsed to one `-`,
 * no leading/trailing `-`. `""` (never thrown) for a label that sanitizes to nothing, so a caller
 * can still fall back to a fixed word ("layer"/"species") rather than emit a broken name. */
export function slugKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export type DownloadLens = "collection" | "species";

/** `oceanmetrics-atlas_{lens}_{layer-or-species-key}_{ver}_{yyyymmdd}.{ext}` -- `key` is
 * {@link slugKey}'d here (callers pass the raw human label, e.g. a metric's `label` or a species'
 * `sci`); an empty/unresolved key falls back to `"layer"`/`"species"` by lens rather than leaving a
 * double-underscore gap. `ver`/`ext` are taken verbatim (a version is already a safe token,
 * `^v[0-9]+[a-z]?$`; `ext` is a literal the caller controls, never user input). */
export function mapFigureName(
  lens: DownloadLens,
  key: string,
  ver: string,
  ext: "png" | "svg",
  clock?: () => Date,
): string {
  const slug = slugKey(key) || (lens === "species" ? "species" : "layer");
  return `oceanmetrics-atlas_${lens}_${slug}_${ver}_${yyyymmdd(clock)}.${ext}`;
}

/** `oceanmetrics-atlas_{lens}_{metric-or-mdl-key}.tif` -- the GeoTIFF item's own name (brief: "name
 * `…_{metric_or_mdl_key}.tif`"). `metricOrMdlKey` is kept VERBATIM (not slugified): a `mdl_key`
 * (`am|Fis-29291`) and a `metric_key` (`sensitivity_ecoregion_rescaled`) are already safe, opaque
 * ids used elsewhere in the app (deep links, STAC item ids) -- slugifying would make the downloaded
 * file's name stop matching them. `|` survives on every desktop OS's filesystem (not on some
 * strict FAT variants), so it is swapped for `-` here, the one character this app's own `mdl_key`s
 * are guaranteed to contain that filenames should not. */
export function cogFileName(lens: DownloadLens, metricOrMdlKey: string): string {
  const safe = metricOrMdlKey.replace(/\|/g, "-");
  return `oceanmetrics-atlas_${lens}_${safe}.tif`;
}

/** `oceanmetrics-atlas_places_{ver}_{yyyymmdd}.geojson` -- the "Selected places" export's own name,
 * distinct from `places/download.ts#downloadGeoJson`'s existing default `"places.geojson"` (that
 * function's own default is unchanged; this is only what R3-W2's Download menu passes it). */
export function placesFileName(ver: string, clock?: () => Date): string {
  return `oceanmetrics-atlas_places_${ver}_${yyyymmdd(clock)}.geojson`;
}
