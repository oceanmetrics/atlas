// atlas-7 steps 2-4: hydrates report.html's static `#report-root` with the real document.
// Mirrors main.ts's own pattern (replaceChildren() before mount(), so there is never a moment
// with both the placeholder and the real content present) — but report.html has no critical CSS
// skeleton to swap (it is a document, not an app shell with layout-sensitive chrome), so there is
// no CLS gate riding on this being synchronous the way index.html's is.
import { mount } from "svelte";
import Report from "./report/Report.svelte";

const target = document.getElementById("report-root");
if (target) {
  target.replaceChildren();
  mount(Report, { target });
}
