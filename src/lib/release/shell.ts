// The release registry as the shell reaches it: one lazily loaded module (`loadRelease` in
// `virtual:instance-modules`), so an instance without `release` carries none of it. The release itself
// is resolved before any bundle parses, by the inline early-fetch script the build writes into
// index.html and report.html for such an instance (scripts/instance.mjs `<!--instance:early-fetch-->`);
// the shell reads its results off `window.__early`. What it needs on top: the release's zone units
// (drawn in either lens), the docs links, and the release picker.
export { composeZoneStyle, zoneUnitsFromBoot, zoneUnitsWithOutline } from "../map/layers/zones";
export { atlasDocsUrl, releaseNotesUrl } from "./docsUrl";
// "Selected places · GeoJSON" with a release's zone places named in full and drawn with their polygons
export { zonePlacesToGeoJson, zonePolygonSourceFromMap } from "../../places/zoneDownload";

export const components = {
  VersionBadge: () => import("../ui/VersionBadge.svelte"),
  VersionPicker: () => import("../../lens/scores/VersionPickerModal.svelte"),
};
