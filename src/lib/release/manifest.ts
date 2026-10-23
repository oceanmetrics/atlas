// The release contract: `{ver}/manifest.json` (plan D3; msens `atlas_manifest()` /
// `validate_manifest()`, `../msens/R/version.R:285-333`). Real JSON Schema validation ships from
// msens later (atlas-1 copies the schema into this repo and a CI job compares its sha256 with
// msens `main`, per the master plan's original `release/` bullet) — until that schema exists this
// module validates through an INJECTABLE validator (`ManifestValidator`), defaulting to a minimal
// structural check. The sha256 drift check itself is a documented TODO with a skipped test naming
// atlas-1 (see tests/release/manifest.test.ts).
//
// `capabilities` default to FALSE for any name not explicitly `true` — including when the whole
// `capabilities` block is missing. This is deliberately more lenient than msens's own
// `validate_manifest()`, which throws at PUBLISH time if `capabilities` is absent (a missing block
// there means the publishing notebook forgot to derive it). Here, on the READ side, a manifest
// missing (or malformed in) that key must not crash the app — it just can't offer any capability
// (`manifestCapability`, mirroring `manifest_can()`, version.R:466-477).
//
// A manifest capability is not "fetchable from the bucket" (plan Addendum 2026-09-21): v7/v7b hold
// only `tables/` + `manifest.json` on S3, so a `true` `cell_species_list` there describes what the
// SERVER can read, not what this static app can fetch. Reconciling that is atlas-1's job (the `app/`
// contract is written at bundle-build time from what actually exists on S3); this module only reads
// whatever capabilities the manifest declares.
import { isVersionLabel } from "./version";
import { dataUrl } from "./dataBase";
import type { SessionLike } from "./dataBase";

export interface Manifest {
  ver: string;
  status?: string;
  access?: string;
  grid_id?: string;
  id_field?: string;
  capabilities: Record<string, boolean>;
  tables: Record<string, string>;
  /** v7b+ only, optional (plan Addendum 2026-09-21): `{method_key, value, description}` rows. */
  methods?: Array<{ method_key: string; value: unknown; description?: string }>;
  [key: string]: unknown;
}

export type ManifestValidator = (raw: unknown) => Manifest | null;

/**
 * Minimal structural check standing in for the real JSON Schema (TODO atlas-1, see the module
 * header). Requires only that `raw` is an object with a version-shaped `ver`; `capabilities` and
 * `tables` are DEFAULTED to `{}` rather than required — a release whose manifest is missing either
 * key must still be readable (just capability-less), matching `manifestCapability`'s FALSE default.
 */
export function minimalManifestCheck(raw: unknown): Manifest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.ver !== "string" || !isVersionLabel(r.ver)) return null;
  const capabilities =
    r.capabilities && typeof r.capabilities === "object" && !Array.isArray(r.capabilities)
      ? (r.capabilities as Record<string, boolean>)
      : {};
  const tables =
    r.tables && typeof r.tables === "object" && !Array.isArray(r.tables)
      ? (r.tables as Record<string, string>)
      : {};
  return { ...r, ver: r.ver, capabilities, tables };
}

/**
 * Does this manifest support capability `name`? Unknown or missing capabilities are FALSE, never
 * assumed TRUE — an absent capability must never let the app offer a panel the release cannot fill
 * (mirrors msens `manifest_can()`, version.R:466-477, exactly).
 */
export function manifestCapability(m: Manifest | null | undefined, name: string): boolean {
  return !!(m && m.capabilities && m.capabilities[name] === true);
}

/** the shape `window.__early` exposes (index.html's inline early-fetch script). */
export interface EarlyManifestLike {
  manifest?: unknown; // a Promise<unknown> in the real app; loosely typed so a test double can be a plain value
}

/**
 * Resolve `ver`'s manifest. Prefers `early.manifest` (started by index.html's inline script before
 * this module even loads — plan atlas-0 Deliverable 2) when given; falls back to a fresh fetch via
 * `fetchJson` otherwise, which is the only path available to `report.html` (it has no early-fetch
 * script at all — see tests/release/inline-early-fetch.test.ts). Never throws: a fetch failure or a
 * validator rejection both resolve to `null`.
 */
export async function manifest(
  ver: string | null,
  opts: {
    early?: EarlyManifestLike | null;
    session?: SessionLike | null;
    fetchJson?: (url: string) => Promise<unknown>;
    validate?: ManifestValidator;
  } = {},
): Promise<Manifest | null> {
  const validate = opts.validate ?? minimalManifestCheck;
  let raw: unknown;
  if (opts.early && "manifest" in opts.early) {
    raw = await Promise.resolve(opts.early.manifest).catch(() => null);
  } else if (ver && opts.fetchJson) {
    raw = await opts.fetchJson(dataUrl(ver, "manifest.json", opts.session)).catch(() => null);
  } else {
    return null;
  }
  return validate(raw);
}
