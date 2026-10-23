// The About dialog's release lines, for an instance with a release registry (instance.json
// `release`): the resolved version with its status and date, whether it is a pre-release under
// review, and which code and instance built the page. Pure, no DOM (tests/shell/aboutRelease.test.ts).

/** the resolved release as the shell knows it (from `window.__early`'s versions.json row). */
export interface AboutRelease {
  ver: string | null;
  /** a pre-release under review (`access` is not the literal "public": fail closed). */
  restricted: boolean;
  status: string | null;
  released: string | null;
}

/**
 * "v7 · 2026-06-12", "v9 · draft · 2026-10-01": the version, then the status when it is not plain
 * "released", then the release date. One string, so no separator sits at a Svelte block boundary
 * (MarineSensitivity/atlas UI-16: "v7· 2026-06-12" lost its space that way). "—" while unresolved.
 */
export function releaseLine(r: AboutRelease): string {
  const extra = [r.status && r.status !== "released" ? r.status : null, r.released].filter(
    (v): v is string => !!v,
  );
  return [r.ver ?? "—", ...extra].join(" · ");
}

/** "oceanmetrics/atlas 0.5.0 · instance marinesensitivity": the code that built the page (its
 * repository and package version) and the instance it was built for. */
export function appLine(source: string, version: string, instanceId: string): string {
  return `${source} ${version} · instance ${instanceId}`;
}
