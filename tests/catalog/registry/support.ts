// Shared fixtures for the registry tests: the real AquaMaps native collection.json (as built from MarineSensitivity
// release v8, 2026-10-15) and the MarineSensitivity v8 `am` one, with the loader's `atlas:url` stamped on, and a few
// registry rows.
import { readFileSync } from "node:fs";
import type { StacCollection } from "../../../src/lib/catalog/types";
import { rowFromRecord, type RegistryRow } from "../../../src/lib/catalog/registry/rows";

export const NATIVE_URL =
  "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/atlas/aquamaps_native/collection.json";

function load(name: string, url: string): StacCollection {
  const raw = JSON.parse(
    readFileSync(new URL(`../../fixtures/registry/${name}`, import.meta.url), "utf8"),
  );
  return { ...raw, "atlas:url": url };
}

export const nativeCollection = (): StacCollection =>
  load("aquamaps_native.collection.json", NATIVE_URL);
export const am005Collection = (): StacCollection =>
  load("am.collection.json", "https://file.marinesensitivity.org/stac/v8/am/collection.json");

const COG = "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/native/am/";
const COG005 =
  "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/cog/global05/";

/** Dermochelys coriacea: matched to WoRMS, has both surfaces (each with its own box), a v7 key. */
export const LEATHERBACK_RECORD = {
  sp_key: "Rep-3437",
  mdl_key: "am|Rep-3437",
  aphia_id: 137209n, // hyparquet returns int64 as BigInt; int32 columns arrive as numbers
  botw_id: null,
  scientific_name: "Dermochelys coriacea",
  common_name: "Leatherback Turtle",
  sp_cat: "turtle",
  redlist_code: "VU",
  cog_url: `${COG}aaaa.tif`,
  cog_url_005: `${COG005}3b65e8ff84b8cf75.tif`,
  bbox_native: [-180, -78.5, 180, 70.5],
  bbox_005: [-180, -78.5, 180, 71],
  sp_key_v7: "Rep-3437",
};

/** a model with no taxon match: no ids, no group, no common name, no 0.05 surface (a registry row always has
 * one today; the app still falls back to native), a v7 key that differs from its v8 one. */
export const UNMATCHED_RECORD = {
  sp_key: "Chn-0a1b2c3d-0000-4000-8000-000000000004",
  mdl_key: "am|Chn-0a1b2c3d-0000-4000-8000-000000000004",
  aphia_id: null,
  botw_id: null,
  scientific_name: "Abylopsis eschscholtzi",
  common_name: null,
  sp_cat: null,
  redlist_code: null,
  cog_url: `${COG}bbbb.tif`,
  cog_url_005: null,
  bbox_native: [-90, -30, 100, 40],
  bbox_005: null,
  sp_key_v7: "SLB-64971",
};

export function row(rec: Record<string, unknown>): RegistryRow {
  const r = rowFromRecord(rec);
  if (!r) throw new Error("fixture row is not a row");
  return r;
}
