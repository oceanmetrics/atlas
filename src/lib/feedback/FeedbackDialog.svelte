<script lang="ts">
  // U3 "Send feedback" (round 2, replaces atlas-8 Deliverable 4's "Report a problem" action --
  // docs/feedback.md, the round-2 plan §5 U3/§10). Reached ONLY through Shell.svelte's own
  // `openFeedback()` dynamic import() (never a static import: this pulls in html-to-image, a
  // scripts/size-budget-core.mjs FORBIDDEN_LAZY_MARKERS entry, plus the annotator -- both lazy
  // themselves, loaded a second time only once the user actually asks for them).
  //
  // Every field this dialog composes is documented in tests/feedback/payload.test.ts's own
  // `buildFeedbackPayload()` (src/lib/feedback/payload.ts) -- this component is UI + wiring only;
  // the shape and the privacy rule (the URL fragment never leaves the device unless the "include my
  // current view link" checkbox is ticked, OFF by default) live there and are asserted without
  // mounting anything. `ver`/`access`/`lens`/`pageUrl`/`hash`/the build identifiers are all passed
  // in by Shell.svelte (which reads the live location global itself, same as issueUrl.ts's own
  // contract) -- this file never reads that global, by any spelling (tests/feedback/noHash.test.ts's
  // source scan covers this whole directory, including comments).
  import Modal from "../ui/Modal.svelte";
  import Segmented from "../ui/Segmented.svelte";
  import { announce } from "../ui/announcer";
  import {
    buildFeedbackPayload,
    FEEDBACK_KINDS,
    FEEDBACK_KIND_LABEL,
    type FeedbackKind,
  } from "./payload";
  import { feedbackEndpoint } from "./endpoint";
  import { sendFeedback } from "./postFeedback";
  import { githubIssueUrl } from "./githubIssue";
  import type { AnnotateShape, AnnotateTool } from "./annotate";
  import { ANNOTATE_COLORS, DEFAULT_ANNOTATE_COLOR } from "./colors";

  interface Props {
    open: boolean;
    onclose: () => void;
    /** the resolved release, or `null` before it settles. */
    ver: string | null;
    /** the resolved release's `versions.json` `access` field -- only `"restricted"` matters here. */
    access?: string;
    lens: string;
    appVersion: string;
    appSha: string;
    viewport: string;
    theme: string;
    userAgent: string;
    /** origin + pathname + search, fragment ALWAYS stripped -- Shell.svelte's own `feedbackCtx.pageUrl`. */
    pageUrl: string;
    /** the raw `#...` fragment, snapshotted by Shell.svelte at the moment the control was clicked
     * (never read live from here) -- placed on the payload's `url` only when the checkbox is ticked. */
    hash: string;
    track?: (name: string, params: Record<string, unknown>) => void;
  }

  let {
    open,
    onclose,
    ver,
    access,
    lens,
    appVersion,
    appSha,
    viewport,
    theme,
    userAgent,
    pageUrl,
    hash,
    track,
  }: Props = $props();

  const restricted = $derived(access === "restricted");

  // --- form state --------------------------------------------------------------------------------
  let kind = $state<FeedbackKind>("bug");
  let title = $state("");
  let text = $state("");
  let email = $state("");
  let website = $state(""); // honeypot -- must stay "" from a real person
  // ON by default (Ben, 2026-10-15): the view link is a permalink of release, lens and any drawn place,
  // never personal data, and a report without it is hard to act on. It stays a visible checkbox.
  let includeUrl = $state(true);

  // --- screenshot ----------------------------------------------------------------------------------
  let capturing = $state(false);
  let captureError = $state<string | null>(null);
  let shotCanvas = $state<HTMLCanvasElement | null>(null);
  let thumbDataUrl = $state<string | null>(null);
  let includeShot = $state(true);

  // --- annotator (lazy) ----------------------------------------------------------------------------
  let annotating = $state(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let annotateMod = $state<any>(null);
  let annotateStageEl = $state<HTMLCanvasElement | undefined>(undefined);
  let annotateTool = $state<AnnotateTool>("arrow");
  let annotateColor = $state(DEFAULT_ANNOTATE_COLOR);
  let shapes = $state<AnnotateShape[]>([]);
  let liveShape = $state<AnnotateShape | null>(null);
  let textAt = $state<{ x: number; y: number } | null>(null);
  let textValue = $state("");

  // --- send ------------------------------------------------------------------------------------
  let endpoint = $state<string | null>(null);
  let sending = $state(false);
  let result = $state<{ ok: boolean; error?: string; issueUrl?: string } | null>(null);

  const kindOptions = FEEDBACK_KINDS.map((k) => ({ value: k, label: FEEDBACK_KIND_LABEL[k] }));

  async function loadCapture() {
    return import("./capture");
  }
  async function loadAnnotate() {
    if (!annotateMod) annotateMod = await import("./annotate");
    return annotateMod;
  }

  async function takeShot() {
    capturing = true;
    captureError = null;
    try {
      const capture = await loadCapture();
      const canvas = await capture.captureView();
      shotCanvas = canvas;
      thumbDataUrl = canvas.toDataURL("image/jpeg", 0.7);
      includeShot = true;
    } catch (e) {
      shotCanvas = null;
      thumbDataUrl = null;
      captureError = e instanceof Error ? e.message : "screenshot failed";
    }
    capturing = false;
  }

  function resetForm() {
    kind = "bug";
    title = "";
    text = "";
    email = "";
    website = "";
    includeUrl = true;
    includeShot = true;
    annotating = false;
    shapes = [];
    liveShape = null;
    textAt = null;
    textValue = "";
    sending = false;
    result = null;
    endpoint = feedbackEndpoint();
  }

  // fires exactly once per open -> closed -> open cycle (this component's instance persists across
  // opens, the same pattern every other Shell.svelte modal already uses -- see its own "lazy
  // lens/panel chunks" header) -- never on every re-render.
  // plain (non-reactive) closure state on purpose -- $state here would make this effect depend on
  // its OWN write of `wasOpen` at the end of its body (a classic Svelte 5 effect self-trigger),
  // since nothing else in the template ever needs to read it.
  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen) {
      resetForm();
      track?.("feedback_open", { kind, restricted });
      void takeShot();
    }
    wasOpen = open;
  });

  const dialogTitle = $derived(
    annotating ? "Mark up the screenshot" : result?.ok ? "Thanks" : "Feedback",
  );

  function handleClose() {
    annotating = false;
    onclose();
  }

  // --- annotator wiring ------------------------------------------------------------------------
  async function openAnnotate() {
    if (!shotCanvas) return;
    await loadAnnotate();
    shapes = [];
    liveShape = null;
    textAt = null;
    textValue = "";
    annotating = true;
  }

  function repaintStage() {
    if (!annotateStageEl || !shotCanvas || !annotateMod) return;
    const ctx = annotateStageEl.getContext("2d");
    if (!ctx) return;
    annotateMod.paintAll(ctx, shotCanvas, shapes, liveShape, shotCanvas.width, shotCanvas.height);
  }
  $effect(() => {
    // reactive deps: shapes, liveShape, annotating (canvas only exists while annotating)
    void shapes;
    void liveShape;
    if (annotating) repaintStage();
  });

  function coords(e: PointerEvent): { x: number; y: number } {
    if (!annotateStageEl || !shotCanvas || !annotateMod) return { x: 0, y: 0 };
    const rect = annotateStageEl.getBoundingClientRect();
    return annotateMod.pointerToImageCoords(
      e.clientX,
      e.clientY,
      rect,
      shotCanvas.width,
      shotCanvas.height,
    );
  }

  // programmatic focus, not the `autofocus` ATTRIBUTE (svelte-check's a11y_autofocus warning) --
  // functionally load-bearing here (unlike the main textarea, which just takes the platform's
  // default first-focusable): without it, placing a text mark takes two clicks (one on the canvas,
  // a second into the input that just appeared) instead of one.
  function focusOnMount(node: HTMLElement): void {
    node.focus();
  }

  function commitText() {
    if (textAt && textValue.trim()) {
      shapes = [
        ...shapes,
        {
          tool: "text",
          color: annotateColor,
          x0: textAt.x,
          y0: textAt.y,
          x1: textAt.x,
          y1: textAt.y,
          text: textValue.trim(),
        },
      ];
    }
    textAt = null;
    textValue = "";
  }

  function onStageDown(e: PointerEvent) {
    const { x, y } = coords(e);
    if (annotateTool === "text") {
      e.preventDefault();
      commitText();
      textAt = { x, y };
      return;
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    liveShape = {
      tool: annotateTool,
      color: annotateColor,
      x0: x,
      y0: y,
      x1: x,
      y1: y,
      path: annotateTool === "pen" ? [[x, y]] : undefined,
    };
  }
  function onStageMove(e: PointerEvent) {
    if (!liveShape) return;
    const { x, y } = coords(e);
    liveShape = {
      ...liveShape,
      x1: x,
      y1: y,
      path: liveShape.path ? [...liveShape.path, [x, y]] : undefined,
    };
  }
  function onStageUp() {
    if (!liveShape) return;
    if (
      Math.abs(liveShape.x1 - liveShape.x0) + Math.abs(liveShape.y1 - liveShape.y0) > 3 ||
      liveShape.path
    ) {
      shapes = [...shapes, liveShape];
    }
    liveShape = null;
  }

  function annotateDone() {
    if (!shotCanvas || !annotateMod) {
      annotating = false;
      return;
    }
    commitText();
    const out = document.createElement("canvas");
    out.width = shotCanvas.width;
    out.height = shotCanvas.height;
    const ctx = out.getContext("2d")!;
    annotateMod.paintAll(ctx, shotCanvas, shapes, null, out.width, out.height);
    shotCanvas = out;
    thumbDataUrl = out.toDataURL("image/jpeg", 0.7);
    shapes = [];
    annotating = false;
  }
  function annotateCancel() {
    shapes = [];
    liveShape = null;
    textAt = null;
    textValue = "";
    annotating = false;
  }

  // --- payload / send ----------------------------------------------------------------------------
  function currentPayload(imageDataUrl: string | undefined) {
    return buildFeedbackPayload({
      kind,
      title,
      text,
      email,
      includeUrl,
      pageUrl,
      hash,
      ver,
      access,
      appVersion,
      appSha,
      lens,
      viewport,
      theme,
      userAgent,
      image: imageDataUrl,
      website,
    });
  }

  const ready = $derived(text.trim().length > 0);

  async function send() {
    if (!endpoint || !ready || sending || capturing) return;
    sending = true;
    result = null;
    let imageDataUrl: string | undefined;
    if (includeShot && shotCanvas) {
      try {
        const capture = await loadCapture();
        const { blob } = await capture.fitBytes(shotCanvas);
        imageDataUrl = await capture.blobToDataUrl(blob);
      } catch {
        imageDataUrl = undefined; // never blocks sending on a screenshot-encode failure
      }
    }
    const payload = currentPayload(imageDataUrl);
    const verdict = await sendFeedback(endpoint, payload, fetch);
    if (verdict.ok) {
      result = { ok: true, issueUrl: verdict.issueUrl };
      track?.("feedback_sent", { kind, restricted });
      announce("Thanks — your feedback was sent.");
    } else {
      result = { ok: false, error: "Could not reach the feedback endpoint. Try again shortly." };
      announce("Feedback was not sent.");
    }
    sending = false;
  }

  const githubHref = $derived(githubIssueUrl(currentPayload(undefined)));

  async function copyScreenshotAndTrack() {
    if (shotCanvas && includeShot) {
      try {
        const blob = await new Promise<Blob | null>((resolve) =>
          shotCanvas!.toBlob(resolve, "image/png"),
        );
        if (blob) await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      } catch {
        /* clipboard blocked (permissions, insecure context) -- the issue link still works */
      }
    }
    track?.("feedback_sent", { kind, restricted });
  }
</script>

<Modal {open} title={dialogTitle} onclose={handleClose}>
  {#if annotating}
    <div class="annotator" data-tour="annotator">
      <p id="annot-desc" class="hint">
        Draw on the picture: pick a tool and colour, then drag on the image below. Undo removes the
        last mark; Clear removes them all. {shapes.length} mark{shapes.length === 1 ? "" : "s"} so far.
      </p>
      <div class="annot-tools">
        <!-- the tool ids below are literal, deliberately NOT imported from ./annotate (a value
             import would make this .svelte file's own static graph pull the annotator module in --
             tests/feedback/lazy.test.ts's whole point). ./annotate's own ANNOTATE_TOOLS is the
             same five ids; keep them in sync by hand if the list changes. (The colour swatches
             just below DO import ANNOTATE_COLORS -- from ./colors, a plain data file with no
             heavy deps, never ./annotate itself.) -->
        <span class="seg-group" role="group" aria-label="Tool">
          {#each ["arrow", "circle", "rect", "pen", "text"] as t (t)}
            <button
              type="button"
              class="tool-btn"
              class:on={annotateTool === t}
              aria-pressed={annotateTool === t}
              onclick={() => (annotateTool = t as AnnotateTool)}
            >
              {t}
            </button>
          {/each}
        </span>
        <span class="seg-group" role="group" aria-label="Colour">
          {#each ANNOTATE_COLORS as c (c.id)}
            <button
              type="button"
              class="color-btn"
              class:on={annotateColor === c.hex}
              aria-pressed={annotateColor === c.hex}
              aria-label={c.label}
              onclick={() => (annotateColor = c.hex)}
            >
              <i class="dot" style:background={c.hex}></i>
            </button>
          {/each}
        </span>
        <button
          type="button"
          class="tool-btn"
          disabled={!shapes.length}
          onclick={() => (shapes = shapes.slice(0, -1))}
        >
          Undo
        </button>
        <button
          type="button"
          class="tool-btn"
          disabled={!shapes.length}
          onclick={() => (shapes = [])}
        >
          Clear
        </button>
      </div>
      <div class="annot-stage">
        {#if shotCanvas}
          <canvas
            bind:this={annotateStageEl}
            width={shotCanvas.width}
            height={shotCanvas.height}
            aria-describedby="annot-desc"
            onpointerdown={onStageDown}
            onpointermove={onStageMove}
            onpointerup={onStageUp}
            onpointercancel={onStageUp}
            style:cursor={annotateTool === "text" ? "text" : "crosshair"}
            style:touch-action="none"
          ></canvas>
          {#if textAt}
            <input
              class="annot-text-input"
              use:focusOnMount
              value={textValue}
              oninput={(e) => (textValue = (e.target as HTMLInputElement).value)}
              placeholder="type, then Enter"
              onkeydown={(e) => {
                if (e.key === "Enter") commitText();
                if (e.key === "Escape") {
                  e.stopPropagation();
                  textAt = null;
                  textValue = "";
                }
              }}
              onblur={commitText}
              style:left="{(textAt.x / shotCanvas.width) * 100}%"
              style:top="{(textAt.y / shotCanvas.height) * 100}%"
              style:color={annotateColor}
              style:border-color={annotateColor}
            />
          {/if}
        {/if}
      </div>
      <div class="annot-actions">
        <button type="button" class="btn" onclick={annotateCancel}>Cancel</button>
        <button type="button" class="btn primary" onclick={annotateDone}>Done</button>
      </div>
    </div>
  {:else if result?.ok}
    <p>Thanks — your feedback was sent to the team.</p>
    {#if result.issueUrl}
      <p class="hint" data-testid="feedback-issue-link">
        Follow it on GitHub:
        <a href={result.issueUrl} target="_blank" rel="noopener noreferrer">{result.issueUrl}</a>
      </p>
    {/if}
    {#if restricted}
      <p class="hint">This release is under review, so no public GitHub issue was filed.</p>
    {/if}
  {:else}
    <fieldset class="f">
      <legend>What kind of feedback is this?</legend>
      <Segmented
        options={kindOptions}
        value={kind}
        ariaLabel="Feedback kind"
        onchange={(v) => (kind = v as FeedbackKind)}
      />
    </fieldset>

    <label class="f">
      Title <span class="hint">(optional)</span>
      <input type="text" bind:value={title} placeholder="A short summary" />
    </label>

    <label class="f">
      What happened / what did you expect?
      <textarea rows="4" bind:value={text} placeholder="that score looks wrong near the Aleutians…"
      ></textarea>
    </label>

    <label class="f">
      Email <span class="hint">(optional — only if you want a reply; never made public)</span>
      <input type="email" bind:value={email} placeholder="you@example.org" />
    </label>

    <label class="f checkbox-row">
      <input type="checkbox" bind:checked={includeUrl} />
      Include my current view link (release, lens and any drawn place)
    </label>

    <!-- honeypot: real form controls skip this; a scripted filler does not. -->
    <input
      type="text"
      name="website"
      tabindex="-1"
      autocomplete="off"
      aria-hidden="true"
      class="hp"
      bind:value={website}
    />

    <div class="shot-row" data-tour="feedback-shot">
      {#if capturing}
        <p class="hint pad">Capturing the view…</p>
      {:else if thumbDataUrl}
        <img
          src={thumbDataUrl}
          alt="the captured view"
          class="shot-thumb"
          class:off={!includeShot}
        />
      {:else}
        <p class="hint pad">
          {captureError ? `No screenshot (${captureError}).` : "No screenshot."}
        </p>
      {/if}
      <div class="shot-actions">
        <label class="checkbox-row">
          <input type="checkbox" bind:checked={includeShot} disabled={!thumbDataUrl} />
          Include screenshot
        </label>
        <button
          type="button"
          class="btn"
          disabled={!thumbDataUrl || capturing}
          onclick={openAnnotate}
        >
          Mark up
        </button>
        <button type="button" class="btn" disabled={capturing} onclick={() => void takeShot()}
          >Retake</button
        >
      </div>
    </div>

    <p class="hint">
      What is sent: your text, this view's release ({ver ?? "unresolved"}) and lens ({lens}), the
      viewport and theme, and the screenshot{includeShot ? "" : " (off)"} — the page link only if you
      tick the box above. It goes to the team by mail
      {#if !restricted}
        and, on a public release, as a public GitHub issue in <code>oceanmetrics/atlas</code>
        labelled <code>{kind}</code> — filed either way, whether or not you give an email. Your email,
        if you give one, never appears in the issue; it stays in the team's own mail and sheet, with a
        copy sent back to you.
      {:else}
        . This release is under review, so no public GitHub issue is filed.
      {/if}
    </p>

    {#if !endpoint}
      <p class="hint warn">
        This build has no feedback endpoint configured yet
        {#if !restricted}
          — use "Open as GitHub issue" below.
        {:else}
          , and this release is under review, so feedback cannot be sent from here right now.
        {/if}
      </p>
    {/if}
    {#if result && !result.ok}
      <p class="hint warn">
        Not sent: {result.error}{!restricted ? " Try again, or open the issue yourself." : ""}
      </p>
    {/if}

    <div class="actions">
      {#if !restricted}
        <a
          class="btn"
          href={githubHref}
          target="_blank"
          rel="noopener"
          onclick={() => void copyScreenshotAndTrack()}
          title="For developers: a prefilled public issue. The screenshot (if included) is copied to your clipboard to paste."
        >
          Open as GitHub issue
        </a>
      {/if}
      <button
        type="button"
        class="btn primary"
        disabled={!endpoint || !ready || sending || capturing}
        onclick={() => void send()}
      >
        {sending ? "Sending…" : "Send"}
      </button>
    </div>
  {/if}
</Modal>

<style>
  .f {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0 0 var(--space-4);
    border: 0;
    padding: 0;
  }

  .f legend {
    padding: 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .f input[type="text"],
  .f input[type="email"],
  .f textarea {
    min-height: var(--size-touch);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-raised);
    color: var(--text-primary);
    font: inherit;
  }

  .hint {
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }

  .hint.warn {
    color: var(--text-danger);
  }

  .hint.pad {
    padding: var(--space-4);
    text-align: center;
  }

  .checkbox-row {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--size-touch);
  }

  .checkbox-row input[type="checkbox"] {
    width: 20px;
    height: 20px;
  }

  .hp {
    position: absolute;
    left: -9999px;
    width: 1px;
    height: 1px;
    overflow: hidden;
  }

  .shot-row {
    margin: 0 0 var(--space-4);
    border: 1px solid var(--divider);
    border-radius: var(--radius-control);
    padding: var(--space-3);
  }

  .shot-thumb {
    display: block;
    max-width: 100%;
    max-height: 240px;
    margin: 0 auto var(--space-2);
    border-radius: var(--radius-control);
  }

  .shot-thumb.off {
    opacity: 0.35;
  }

  .shot-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }

  .btn,
  .tool-btn,
  .color-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    min-width: var(--size-touch);
    min-height: var(--size-touch);
    padding: 0 var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-raised);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    text-decoration: none;
    cursor: pointer;
  }

  .btn:disabled,
  .tool-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn.primary {
    background: var(--fill-accent);
    border-color: var(--fill-accent);
    color: var(--text-on-accent);
    font-weight: 700;
  }

  .btn:focus-visible,
  .tool-btn:focus-visible,
  .color-btn:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .tool-btn.on,
  .color-btn.on {
    background: var(--fill-accent);
    color: var(--text-on-accent);
    border-color: var(--fill-accent);
  }

  .tool-btn {
    text-transform: capitalize;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-3);
  }

  .annotator {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .annot-tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }

  .seg-group {
    display: inline-flex;
    gap: var(--space-1);
  }

  .color-btn .dot {
    display: inline-block;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 1px solid var(--border-control);
  }

  .annot-stage {
    position: relative;
    max-height: 55vh;
    overflow: auto;
    border: 1px solid var(--divider);
    border-radius: var(--radius-control);
  }

  .annot-stage canvas {
    display: block;
    width: 100%;
    height: auto;
  }

  .annot-text-input {
    position: absolute;
    transform: translate(-2px, -2px);
    min-width: 80px;
    padding: 2px 6px;
    border: 2px solid;
    border-radius: var(--radius-control);
    background: rgba(0, 0, 0, 0.6);
    font: inherit;
  }

  .annot-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-3);
  }
</style>
