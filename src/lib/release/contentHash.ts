// The store key of a MarineSensitivity COG: its file stem. Its own module so a lens on the static path can name a
// COG's key without loading the side-table reader (`cog3857.ts`, whose Parquet reader is a lazy chunk).

/** the store key of an original COG URL (its file stem: MST names every stored object `<content_hash>.tif`), or
 * null when the URL is not a `.tif` with a hex stem. */
export function contentHashOf(url: string): string | null {
  const m = /\/([0-9a-f]{8,64})\.tif(?:[?#].*)?$/.exec(url);
  return m ? m[1] : null;
}
