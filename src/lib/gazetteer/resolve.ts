// gazetteer/resolve.ts -- turn a `p.` place_id token into geometry, and read the layer manifest and
// credits, through the vendored @oceanmetrics/places client. LAZY: this file (and with it hyparquet)
// is reached only by dynamic import() -- Places.svelte, the placesMap store and Report.svelte do it
// on first need; nothing in index.html's static graph imports it (size-budget forbids "hyparquet").
//
// The injectable `GazetteerClient` seam keeps the rules testable without a network: tests/gazetteer
// drives the REAL vendored client against committed parquet fixtures served from a local HTTP
// server, and the store-level tests inject a stub.
import { analysisGeometry } from "../geo/analysisGeometry";
import { isAreaGeometry, type AreaGeometry } from "../geo/types";
import { createClient } from "./vendor/client";
import type { Layer, PlaceFeature } from "./vendor/types";
import {
  PLACES_SLUG,
  authorityOf,
  fallbackAttribution,
  gazetteerDataBase,
  isPlacesAuthority,
  joinCredits,
  toDataUrl,
} from "./config";

export type GazetteerErrorCode = "unreachable" | "not-found" | "not-area";

/** a failure with a sentence fit for a toast; the `p.` token is kept in the link regardless. */
export class GazetteerError extends Error {
  code: GazetteerErrorCode;
  constructor(code: GazetteerErrorCode, message: string) {
    super(message);
    this.name = "GazetteerError";
    this.code = code;
  }
}

/** the slice of the vendored client this module uses (injectable). */
export interface GazetteerClient {
  getPlace(id: string, opts?: { unwrap?: boolean; slug?: string }): Promise<PlaceFeature | null>;
  listLayers(opts?: { refresh?: boolean }): Promise<Layer[]>;
  creditsFor(refs: string | string[], opts?: { html?: boolean }): Promise<string>;
}

let shared: GazetteerClient | null = null;

/** the process-wide client on the configured base (one footer read per parquet, cached). */
export function gazetteerClient(): GazetteerClient {
  return (shared ??= createClient({ base: gazetteerDataBase() }));
}

/** test seam: swap (or, with `null`, reset) the process-wide client. */
export function setGazetteerClient(client: GazetteerClient | null): void {
  shared = client;
}

export interface GazResolved {
  id: string;
  /** the place's own name from the collection, `id` when it carries none */
  name: string;
  /** `analysisGeometry()` of the unwrapped place: the geometry every analysis runs on */
  geometry: AreaGeometry;
}

/**
 * Fetch one gazetteer place and make it analysable.
 *
 * `unwrap: true` (the client's own rule) shifts the western parts of an antimeridian-split place by
 * +360 so longitudes run contiguously past 180 -- the atlas's unwrapped convention (g1 stores no
 * wrapped ring) -- and `analysisGeometry()` then normalises + quantises it exactly as it does for a
 * drawn or uploaded place, so the numbers a link reproduces are the numbers the sender saw.
 */
export async function resolveGazPlace(
  id: string,
  client: GazetteerClient = gazetteerClient(),
): Promise<GazResolved> {
  let feature: PlaceFeature | null;
  try {
    // the built-in `places` authorities (NMS/MRGID/PSGID) are read from that collection directly:
    // the client otherwise finds a place's collection through layers.json, which answers 403 until
    // it is published, and a sanctuary link must not depend on that. If the hinted collection does
    // not hold the id after all (the tree was reorganised), fall back to the manifest lookup.
    feature = isPlacesAuthority(authorityOf(id))
      ? ((await client.getPlace(id, { unwrap: true, slug: PLACES_SLUG })) ??
        (await client.getPlace(id, { unwrap: true })))
      : await client.getPlace(id, { unwrap: true });
  } catch (err) {
    throw new GazetteerError(
      "unreachable",
      `Couldn't reach the places gazetteer to load "${id}" (${(err as Error)?.message ?? err}).`,
    );
  }
  if (!feature) {
    throw new GazetteerError("not-found", `"${id}" isn't in the places gazetteer.`);
  }
  if (!isAreaGeometry(feature.geometry)) {
    throw new GazetteerError(
      "not-area",
      `"${id}" isn't an area (${feature.geometry?.type ?? "no geometry"}), so it can't be a place.`,
    );
  }
  const props = feature.properties ?? {};
  const name = typeof props.name === "string" && props.name ? props.name : id;
  return { id, name, geometry: analysisGeometry(feature.geometry) };
}

/** one polygon layer the picker can offer (layers.json row, trimmed). */
export interface GazPickLayer {
  slug: string;
  title: string;
  pmtiles: string;
  sourceLayer: string;
  attribution: string;
}

/**
 * The polygon layers layers.json offers, or `null` when the manifest is not reachable (403 until it
 * is published): the picker then offers only the built-in `places` collection.
 */
export async function loadPickLayers(
  client: GazetteerClient = gazetteerClient(),
): Promise<GazPickLayer[] | null> {
  let layers: Layer[];
  try {
    layers = await client.listLayers();
  } catch {
    return null;
  }
  return layers
    .filter((l) => /polygon/i.test(l.geom_type ?? "") && l.pmtiles && l.source_layer)
    .map((l) => ({
      slug: l.slug,
      title: l.title || l.slug,
      pmtiles: toDataUrl(l.pmtiles),
      sourceLayer: l.source_layer,
      attribution: l.attribution || "",
    }));
}

/**
 * The credit line for gazetteer places in the list: each id's own credit from the index
 * (`places_index.parquet`, per-place `attribution`) where it can be read, the built-in credit for
 * its authority otherwise, joined into one deduplicated line. Never throws.
 */
export async function creditsForPlaces(
  ids: readonly string[],
  client: GazetteerClient = gazetteerClient(),
): Promise<string> {
  if (!ids.length) return "";
  const parts: string[] = [];
  let indexDown = false; // one failed index read is enough: do not retry it per id
  for (const id of ids) {
    let credit = "";
    if (!indexDown) {
      try {
        credit = await client.creditsFor(id);
      } catch {
        indexDown = true; // index not published / unreachable: built-in credits below
      }
    }
    parts.push(credit || fallbackAttribution(id));
  }
  return joinCredits(parts);
}
