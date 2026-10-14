// The two services this release actually depends on at runtime, as `ServiceDef`s (registry.ts's
// banner copy is built entirely from these fields). This is the ONE place `tilerServiceDef`'s host
// and `dataServiceDef`'s per-release URL are formed -- store.svelte.ts and Shell.svelte only ever
// call these factories, never build a `ServiceDef` by hand.
import { DEFAULT_TITILER_HOST } from "../raster/tiles";
import { dataUrl } from "../release/dataBase";
import type { ServiceDef } from "./types";

/** stripped of the scheme for the banner's "X is not responding" clause -- `new URL(url).host`
 * would also work but requires a valid absolute URL; this is a plain string op so a malformed
 * `host` (a test fixture, say) never throws while building copy. */
function bareHost(originOrUrl: string): string {
  return originOrUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

/**
 * The tiler probe: `/healthz`, verified live against `https://titiler-v8.marinesensitivity.org` --
 * 200, ~133 bytes, ~0.4s (curled 2026-09-24). Every score/species raster tile is a `/cog/tiles/...`
 * request to this SAME host (`src/lib/raster/tiles.ts`), so this one probe stands in for "can the
 * map draw a raster at all" without shipping a second, heavier route.
 */
export function tilerServiceDef(host: string = DEFAULT_TITILER_HOST): ServiceDef {
  return {
    id: "tiler",
    url: `${host}/healthz`,
    hostLabel: bareHost(host),
    displayName: "Map tiles",
    whatBreaks: "Raster layers cannot be drawn",
    stillWorks: "places, tables and reports from already-loaded data still work",
  };
}

/**
 * The data-origin probe: the SAME `app/boot.json` URL the release itself is fetched from
 * (`src/lib/release/dataBase.ts#dataUrl`, "the ONE place a data origin is formed") -- reusing it
 * rather than inventing a second route keeps this module honest about what it is actually testing.
 *
 * `base`, when given, is the ALREADY-RESOLVED origin `window.__early.base` carried (the same value
 * index.html's own early-fetch script used for its `app/boot.json` fetch) -- P round 2 fix (was
 * "known gap": a restricted preview session's `session.data` prefix was never threaded through, so
 * this always probed the PUBLIC bucket even when the release itself loaded from a signed-in
 * prefix). Falls back to {@link dataUrl}'s public-bucket URL when no resolved base is available
 * (e.g. a unit test, or `probeData` called before `window.__early.base` settles).
 */
export function dataServiceDef(ver: string, base?: string): ServiceDef {
  const url = base ? `${base}${ver}/app/boot.json` : dataUrl(ver, "app/boot.json");
  return {
    id: "data",
    url,
    hostLabel: bareHost(url),
    displayName: "Release data",
    whatBreaks: "Species data cannot be loaded",
    stillWorks: "the current map view and already-loaded panels still work",
  };
}
