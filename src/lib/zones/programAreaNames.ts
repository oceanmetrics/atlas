/**
 * Program Area acronym -> full name -- the app-side fallback `paLabel()` (src/places/zoneStats.ts)
 * reads when a published app bundle carries no `name` on a `zones.programarea` row, true of every
 * release through v9 (verified live against v7's own `boot.json`). Precedence in `paLabel`: the
 * bundle's own `name` first, then this table, then the bare key.
 *
 * GENERATED -- do not hand-edit. Run `node scripts/gen-program-area-names.mjs` to regenerate from
 * the canonical geometry `~/_big/msens/derived/v2/ply_programareas_2026.gpkg` (the
 * `ply_programareas_2026` layer's `programarea_key`/`programarea_name` fields) -- the same file
 * the workflows API reads for Program-Area geometry at every version. 20 rows.
 */

export const PROGRAM_AREA_NAMES: Record<string, string> = {
  ALA: "Aleutian Arc",
  ALB: "Aleutian Basin",
  BFT: "Beaufort Sea",
  BOW: "Bowers Basin",
  CEC: "Central California",
  CHU: "Chukchi Sea",
  COK: "Cook Inlet",
  GAA: "GOA Program Area A",
  GAB: "GOA Program Area B",
  GEO: "St. George Basin",
  GOA: "Gulf of Alaska",
  HAR: "High Arctic",
  HOP: "Hope Basin",
  KOD: "Kodiak",
  MAT: "St. Matthew-Hall",
  NAV: "Navarin Basin",
  NOC: "Northern California",
  NOR: "Norton Basin",
  SHU: "Shumagin",
  SOC: "Southern California",
};
