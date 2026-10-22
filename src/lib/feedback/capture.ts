// U3 "Send feedback": the screenshot the dialog previews, lets the user annotate or remove, and
// (only if kept) attaches to the payload. Ported from
// ../../CalCOFI/explore/src/capture.ts: html-to-image's `toCanvas` over the shell root, never
// html2canvas (it rejects on `color-mix()`, which instances/<id>/tokens.css's light-theme palette
// uses -- the identical reason CalCOFI's explorer picked html-to-image,
// atlas-refs/"calcofi explore review.md"). MapLibre's canvas needs `preserveDrawingBuffer` for its
// pixels to survive `toCanvas`'s readback -- src/lib/map/map.ts already sets it
// (canvasContextAttributes, the same flag e2e/map.spec.ts's pixel-proof gate depends on).
//
// Lazy by construction: nothing on index.html's STATIC import graph reaches this file. It is
// reached only through FeedbackDialog.svelte's own dynamic `import()`
// (tests/feedback/lazy.test.ts), and "html-to-image" is now one of
// scripts/size-budget-core.mjs's FORBIDDEN_LAZY_MARKERS, so an accidental static import fails a
// real build, not just a source scan.
import { toCanvas } from "html-to-image";
import { CAPTURE_BG_FALLBACK } from "./colors";

/** chrome this repo never wants baked into a feedback screenshot: any OPEN native `<dialog>` --
 * this IS the feedback dialog's own Modal.svelte element while it is being captured, and would
 * otherwise draw itself (its "capturing the view…" placeholder) inside its own screenshot -- plus
 * the shared live region (Announcer.svelte) and an open driver.js tour popover, neither of which
 * is part of "the view" a bug report is about. */
const HIDDEN_SELECTORS = ["dialog[open]", ".announcer", ".driver-popover", ".driver-overlay"];

function isHidden(node: Element): boolean {
  const el = node as HTMLElement;
  return HIDDEN_SELECTORS.some((s) => el.matches?.(s));
}

export interface CaptureOptions {
  /** defaults to `#shell` (index.html's mount point, `class="app"`) -- the whole visible app,
   * matching "the current view" the dialog promises in its own copy. */
  root?: HTMLElement;
  /** devicePixelRatio, capped at 2 (a 3x/4x phone would make an enormous PNG for no visual gain);
   * overridable for a deterministic canvas size in a test. */
  scale?: number;
}

function defaultRoot(): HTMLElement {
  return (document.getElementById("shell") ?? document.body) as HTMLElement;
}

/** the current view as a canvas, ready for a thumbnail preview / the annotator / `fitBytes()`. */
export async function captureView(opts: CaptureOptions = {}): Promise<HTMLCanvasElement> {
  const root = opts.root ?? defaultRoot();
  const scale = opts.scale ?? Math.min(2, window.devicePixelRatio || 1);
  // let the current frame settle (a style/layout change a moment before the dialog opened) before
  // reading pixels back -- one frame is enough; two guards against a browser that coalesces the
  // first rAF with the paint that triggered it.
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const bg =
    getComputedStyle(document.documentElement).getPropertyValue("--surface-map").trim() ||
    CAPTURE_BG_FALLBACK;
  return toCanvas(root, {
    pixelRatio: scale,
    backgroundColor: bg,
    filter: (node) => !isHidden(node as Element),
    cacheBust: false,
  });
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type = "image/png",
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("canvas.toBlob produced no blob"))),
      type,
      quality,
    );
  });
}

/** downscales (75% steps, matching CalCOFI's own capture.ts) until the PNG fits under `maxBytes`
 * (~3 MB, this deliverable's own cap) -- returns the SAME canvas untouched when it already fits,
 * and gives up after 4 steps (a ~32% linear scale) rather than looping forever on a pathological
 * image. */
export async function fitBytes(
  canvas: HTMLCanvasElement,
  maxBytes = 3_000_000,
): Promise<{ canvas: HTMLCanvasElement; blob: Blob }> {
  let current = canvas;
  for (let i = 0; i < 4; i++) {
    const blob = await canvasToBlob(current);
    if (blob.size <= maxBytes) return { canvas: current, blob };
    const next = document.createElement("canvas");
    next.width = Math.max(1, Math.round(current.width * 0.75));
    next.height = Math.max(1, Math.round(current.height * 0.75));
    next.getContext("2d")!.drawImage(current, 0, 0, next.width, next.height);
    current = next;
  }
  return { canvas: current, blob: await canvasToBlob(current) };
}

/** a `Blob` as a `data:` URL string, for the JSON payload's `image` field. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}
