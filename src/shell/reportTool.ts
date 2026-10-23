// The Report tool as the shell reaches it: one lazily loaded module (`loadReport` in
// `virtual:instance-modules`), so an instance whose rail has no Report carries none of it. The pane
// (ReportPane.svelte: the Places flow, the subject sentence, Open report and the recent reports) is
// its own chunk; the subject rules are the plain functions the panel header and the Table read.
export { lastClickedInPlaces, reportSubjects, type ReportSubject } from "../lib/state/subjects";

export const components = {
  Pane: () => import("./ReportPane.svelte"),
  // the Report tool's Places flow (MarineSensitivity/atlas 0.10.93's Places panel: the list, pick
  // mode and the Program Area picker, draw, coordinates, upload, the selected place's results)
  Places: () => import("../places/ReportPlaces.svelte"),
};
