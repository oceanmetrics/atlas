# Send feedback on the docs site (Quarto) — an include for `MarineSensitivity/docs`

> **Status in OceanMetrics Atlas (WP11, 2026-10-14).** This is a ready-to-drop-in include for the MarineSensitivity docs book (a separate Quarto repository). It is not used by OceanMetrics Atlas, whose feedback goes to `oceanmetrics/atlas` issues and the endpoint in `VITE_FEEDBACK_URL`. Kept for reference only.

U3 (round 2) asks for the same "Send feedback" entry point on the rendered docs book
(`marinesensitivity.org/docs/{ver}/`), not just the atlas app. `MarineSensitivity/docs` is a
**separate Quarto repo** — nothing here is committed there; this file is the ready-to-drop-in
include plus instructions for whoever lands it in that repo's own session.

It reuses the **same Apps Script endpoint** atlas posts to (`scripts/feedback/Code.gs`, this repo,
`docs/feedback.md`'s runbook) — one Sheet, one set of recipients, one GitHub-issue rule — with
`app: "docs"` instead of `"atlas"` so the two are distinguishable in the Sheet/mail, and it degrades
to the identical zero-backend GitHub-issue fallback when unconfigured. It does **not** carry a
screenshot or an annotator (no `html-to-image`/canvas dependency belongs in a Quarto book's static
JS budget) — just kind, text, optional email, and the current page URL (query kept, no fragment —
Quarto pages don't carry a hash-encoded state the way the atlas app does, but the same "never send
more than the page path+query" discipline still applies).

## The include

Drop this as (for example) `docs/_includes/feedback.html` and reference it from the book's
`_quarto.yml` `format.html.include-after-body` (or per-page front matter), or paste it directly into
a shared footer partial — whatever this repo's own convention for a site-wide include already is.

```html
<!-- Send feedback (docs site) -- U3 twin of atlas's FeedbackDialog.svelte, same Apps Script
     endpoint, no screenshot/annotator (kept small: this is a static Quarto book, not a bundled
     app). Reuses window.MS_FEEDBACK_URL if the page already defines it (e.g. from a site-wide
     config script); otherwise falls back to the literal default below -- replace it once the
     endpoint from docs/feedback.md's runbook is deployed. -->
<div id="ms-feedback-root"></div>
<script>
  (function () {
    var ENDPOINT_KEY = "docs.feedback_url"; // localStorage override, same convention as atlas's
    // "atlas.feedback_url" (src/lib/feedback/endpoint.ts)
    var DEFAULT_ENDPOINT = window.MS_FEEDBACK_URL || ""; // set this once the Apps Script is deployed
    var KINDS = ["bug", "idea", "question", "data"];

    function endpoint() {
      if (DEFAULT_ENDPOINT) return DEFAULT_ENDPOINT;
      try {
        var v = localStorage.getItem(ENDPOINT_KEY);
        if (v && /^https?:\/\//.test(v)) return v;
      } catch (e) {
        /* private mode */
      }
      return null;
    }

    function pageUrl() {
      // fragment stripped, query kept -- the same rule atlas's issueUrl.ts/payload.ts enforce.
      return location.origin + location.pathname + location.search;
    }

    function githubIssueUrl(kind, text) {
      var body =
        text +
        "\n\n---\n- Page: " +
        pageUrl() +
        "\n- User agent: " +
        navigator.userAgent.slice(0, 300);
      var params = new URLSearchParams();
      params.set("title", "Docs feedback (" + kind + ")");
      params.set("body", body);
      params.set("labels", kind);
      return "https://github.com/oceanmetrics/atlas/issues/new?" + params.toString();
    }

    function mount() {
      var root = document.getElementById("ms-feedback-root");
      if (!root) return;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ms-feedback-btn";
      btn.textContent = "Send feedback";
      btn.setAttribute("aria-haspopup", "dialog");
      root.appendChild(btn);

      var dialog = document.createElement("dialog");
      dialog.className = "ms-feedback-dialog";
      dialog.innerHTML =
        '<form method="dialog" class="ms-feedback-form">' +
        "<h2>Send feedback</h2>" +
        "<fieldset><legend>What kind of feedback is this?</legend>" +
        KINDS.map(function (k) {
          return (
            '<label><input type="radio" name="kind" value="' +
            k +
            '"' +
            (k === "bug" ? " checked" : "") +
            "> " +
            k +
            "</label>"
          );
        }).join(" ") +
        "</fieldset>" +
        "<label>What happened / what did you expect?<br>" +
        '<textarea name="text" rows="4" required></textarea></label><br>' +
        '<label>Email (optional)<br><input type="email" name="email"></label><br>' +
        // honeypot -- a real person never sees or fills this
        '<input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" ' +
        'style="position:absolute;left:-9999px;width:1px;height:1px">' +
        '<div class="ms-feedback-actions">' +
        '<a class="ms-feedback-github" target="_blank" rel="noopener">Open as GitHub issue</a> ' +
        '<button type="button" class="ms-feedback-send">Send</button> ' +
        '<button type="button" class="ms-feedback-cancel">Cancel</button>' +
        "</div>" +
        '<p class="ms-feedback-status" role="status"></p>' +
        "</form>";
      document.body.appendChild(dialog);

      var status = dialog.querySelector(".ms-feedback-status");
      var ghLink = dialog.querySelector(".ms-feedback-github");

      function currentKind() {
        var checked = dialog.querySelector('input[name="kind"]:checked');
        return checked ? checked.value : "bug";
      }
      function refreshGithubLink() {
        var text = dialog.querySelector('textarea[name="text"]').value || "";
        ghLink.href = githubIssueUrl(currentKind(), text);
      }
      dialog.addEventListener("input", refreshGithubLink);
      refreshGithubLink();

      btn.addEventListener("click", function () {
        status.textContent = "";
        dialog.showModal();
      });
      dialog.querySelector(".ms-feedback-cancel").addEventListener("click", function () {
        dialog.close();
      });
      dialog.querySelector(".ms-feedback-send").addEventListener("click", function () {
        var website = dialog.querySelector('input[name="website"]').value;
        var text = dialog.querySelector('textarea[name="text"]').value;
        var email = dialog.querySelector('input[name="email"]').value;
        var kind = currentKind();
        var url = endpoint();
        if (!text.trim()) return;
        if (!url) {
          status.textContent = 'No feedback endpoint configured -- use "Open as GitHub issue".';
          return;
        }
        var payload = {
          app: "docs",
          kind: kind,
          title: "",
          text: text,
          email: email,
          url: pageUrl(),
          release: "",
          version: "",
          sha: "",
          lens: "",
          viewport: innerWidth + "x" + innerHeight,
          theme: "",
          user_agent: navigator.userAgent,
          website: website,
          restricted: false,
        };
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=UTF-8" },
          body: JSON.stringify(payload),
        })
          .then(function (res) {
            if (!res.ok) throw new Error("not ok");
            status.textContent = "Thanks -- sent to the team.";
          })
          .catch(function () {
            status.textContent =
              'Could not reach the feedback endpoint -- try "Open as GitHub issue".';
          });
      });
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", mount);
    } else {
      mount();
    }
  })();
</script>
```

## Notes for the docs session

- **`window.MS_FEEDBACK_URL`**: set this once, site-wide (e.g. in the book's own header include or
  a small config script rendered before this one), to the SAME `/exec` URL `VITE_FEEDBACK_URL`
  names for the atlas app (`docs/feedback.md`'s runbook, step 5). One Apps Script deployment serves
  both products; `Code.gs` distinguishes them by the payload's `app` field alone.
- **No screenshot, no annotator, no lazy-loading concerns** — this is plain inline JS with no
  bundler and no size budget to protect (the atlas app's `html-to-image`/canvas machinery has no
  equivalent here and should not be added just for parity).
- **Restricted docs**: `docs/feedback.md`'s privacy rule (skip the public GitHub issue for a
  restricted release) does not have an obvious equivalent here — the docs site does not resolve
  `versions.json`'s `access` field the way the app does, and restricted-release docs are served from
  a _separate_ preview host (`CLAUDE.md`'s "Restricted docs are published by the docs CI to
  `gh-pages-preview`... served from `/share/docs_preview`) that is not reachable from the public
  internet at all. If this include is ever added to THAT preview host's book, hardcode
  `restricted: true` in the payload and drop the GitHub-issue link entirely, mirroring the app's own
  rule — flag this as a decision for whoever wires it in, not something this file resolves on its
  own.
- **Styling**: no CSS is included here on purpose — the docs book's own theme should style
  `.ms-feedback-btn`/`.ms-feedback-dialog`/`.ms-feedback-form` to match its existing chrome (fonts,
  colors, spacing) rather than importing atlas's `tokens.css`.
- **Testing**: the same `localStorage` override convention as the app
  (`atlas.feedback_url` there; `docs.feedback_url` here, deliberately namespaced separately since
  they are different origins/products) lets a maintainer point a local preview at a test
  deployment before setting `window.MS_FEEDBACK_URL` for real.
