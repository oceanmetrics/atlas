// atlas-4 — the `sel=` URL token (`cell:<id>` | `zone:<unit>:<key>`, state/types.ts), read and
// written from ONE place so the map ring, the flower and the species/zones tables can never
// disagree about what is selected. Pure: no DOM, no engine.
import { cellLonLat, type GridSpec } from "../../lib/grid/grid";

export type ScoresSelection =
  { kind: "cell"; cellId: number } | { kind: "zone"; unit: string; key: string } | null;

/** `sel.sel` (already syntax-validated by `state/codec.ts`'s `SEL_TOKEN_RE`) -> a typed selection.
 * `undefined`/an unrecognized shape/a non-finite cell id all resolve to `null` — the "nothing
 * selected" state, never a throw. */
export function parseScoresSelection(token: string | undefined): ScoresSelection {
  if (!token) return null;
  if (token.startsWith("cell:")) {
    const id = Number(token.slice("cell:".length));
    return Number.isFinite(id) ? { kind: "cell", cellId: id } : null;
  }
  if (token.startsWith("zone:")) {
    const rest = token.slice("zone:".length);
    const i = rest.indexOf(":");
    if (i < 0) return null;
    return { kind: "zone", unit: rest.slice(0, i), key: rest.slice(i + 1) };
  }
  return null;
}

export function formatCellToken(cellId: number): string {
  return `cell:${cellId}`;
}

export function formatZoneToken(unit: string, key: string): string {
  return `zone:${unit}:${key}`;
}

export interface CellRing {
  lon: number;
  lat: number;
  halfW: number;
  halfH: number;
}

/** the clicked cell's centre + half-extents, for the map ring and the "x: …, y: …" display —
 * `cellLonLat(..., wrap = true)`, so the ring is drawn in the -180..180 frame every basemap uses. */
export function cellRing(cellId: number, grid: GridSpec): CellRing {
  const { lon, lat } = cellLonLat(cellId, grid, true);
  return { lon, lat, halfW: grid.resx / 2, halfH: grid.resy / 2 };
}
