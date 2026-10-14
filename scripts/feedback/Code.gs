// Code.gs — Atlas "Send feedback" (bound to a Google Sheet; see docs/feedback.md's runbook).
// Ported from CalCOFI's generator (../../CalCOFI/calcofi4r/R/feedback.R#cc_feedback_script()) and
// adapted to the atlas payload (src/lib/feedback/payload.ts#FeedbackPayload) and its two rules:
//   - the kind (bug/idea/question/data) IS the GitHub issue label -- no separate "feedback" label.
//   - a RESTRICTED release (a pre-release under review, Cloudflare-gated) never gets a public
//     GitHub issue -- only the Sheet + mail. The payload's own `restricted` flag decides this
//     SERVER-SIDE (never trust the client alone for a privacy rule -- this is the second, load-
//     bearing check; FeedbackDialog.svelte already hides its own "Open as GitHub issue" link when
//     restricted, but a modified/replayed request must not bypass the rule by omitting `restricted`).
//
// Deploy: Extensions > Apps Script in the Sheet, paste this file's contents as Code.gs, Deploy >
// New deployment > type "Web app", execute as "Me", who has access "Anyone". Copy the /exec URL
// into the atlas build as VITE_FEEDBACK_URL (see docs/feedback.md).
//
// Tabs: `feedback` (header = FEEDBACK_HEADER below) and `recipients` (A1 = "email", one address
// per row -- edit a cell to add or remove someone, no redeploy).
//
// Script properties: GITHUB_TOKEN (optional; fine-grained, contents + issues on
// oceanmetrics/atlas) enables the public issue; DRIVE_FOLDER_ID (optional; default: a folder
// made beside the Sheet, "atlas feedback").
//
// CORS: the app POSTs `text/plain` JSON so the request stays a simple request (this endpoint
// answers no OPTIONS, so a JSON preflight would be dropped -- see
// src/lib/feedback/postFeedback.ts's own header). Spam: a honeypot field (`website`, must be
// empty) and a per-hour cache cap (MAX_PER_HOUR).

var FEEDBACK_HEADER = [
  "ts",
  "id",
  "app",
  "kind",
  "title",
  "text",
  "email",
  "url",
  "release",
  "version",
  "sha",
  "lens",
  "viewport",
  "theme",
  "user_agent",
  "website",
  "restricted",
  "image_url",
  "issue_url",
  "status",
];
var REPO = "oceanmetrics/atlas";
var BRANCH = "main";
var MAX_PER_HOUR = 20;
var MAX_TEXT = 4000;
var MAX_TITLE = 200;
var MAX_IMAGE_BYTES = 6 * 1024 * 1024;

// Health check: a GET answers {ok:true,...} so the deployment can be verified at a glance instead
// of reading "Script function not found: doGet".
function doGet(e) {
  try {
    var sh = _tab("feedback");
    return _json({
      ok: true,
      endpoint: "atlas-feedback",
      rows: sh.getLastRow() - 1,
      recipients: _recipients().length,
      github: !!_prop("GITHUB_TOKEN"),
    });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    var b = JSON.parse(e.postData.contents || "{}");
    if (b.website) return _json({ ok: true, skipped: "honeypot" }); // a bot filled the hidden field
    if (!b.text || !String(b.text).trim()) return _json({ ok: false, error: "empty text" });
    if (_rateLimited()) return _json({ ok: false, error: "rate limited: try again in an hour" });

    var id = Utilities.getUuid().replace(/-/g, "").slice(0, 10);
    var ts = new Date();
    var kind = _kind(b.kind);
    var text = String(b.text).slice(0, MAX_TEXT);
    var title = String(b.title || "").slice(0, MAX_TITLE);
    // the SERVER decides `restricted`, not just the client's own claim -- coerced to a real
    // boolean so a stray string/number in a hand-crafted request can't slip past the `=== true`
    // check below and accidentally publish a restricted-release report.
    var restricted = b.restricted === true;
    var image_url = "";
    var issue_url = "";
    var status = [];
    var bytes = null;

    // 1. the screenshot to Drive (the team's copy; the issue embeds its own from the repo)
    if (b.image && /^data:image\/(png|jpeg);base64,/.test(b.image)) {
      bytes = Utilities.base64Decode(b.image.split(",")[1]);
      if (bytes.length <= MAX_IMAGE_BYTES) {
        var ext = /^data:image\/jpeg/.test(b.image) ? "jpg" : "png";
        var mime = ext === "jpg" ? "image/jpeg" : "image/png";
        var f = _folder().createFile(
          Utilities.newBlob(bytes, mime, _stamp(ts) + "_" + id + "." + ext),
        );
        image_url = f.getUrl();
        status.push("image");
      } else {
        bytes = null;
        status.push("image too large");
      }
    }

    // 2. the public issue (before the row, so the row can carry its URL) -- SKIPPED entirely for
    //    a restricted release (R6): a public issue carrying a screenshot of a pre-release under
    //    review would publish exactly what the review gate exists to hide.
    if (restricted) {
      status.push("issue skipped: restricted release");
    } else if (_prop("GITHUB_TOKEN")) {
      try {
        issue_url = _openIssue(id, ts, b, kind, title, text, bytes);
        status.push("issue");
      } catch (err) {
        status.push("issue failed: " + String(err).slice(0, 120));
      }
    } else {
      status.push("issue skipped: no GITHUB_TOKEN");
    }

    // 3. the row -- every FEEDBACK_HEADER column, `email` included (this is the ONE place it is
    //    ever written down; the issue body above never carries it).
    var row = {
      ts: ts,
      id: id,
      app: String(b.app || "atlas"),
      kind: kind,
      title: title,
      text: text,
      email: b.email || "",
      url: b.url || "",
      release: b.release || "",
      version: b.version || "",
      sha: b.sha || "",
      lens: b.lens || "",
      viewport: b.viewport || "",
      theme: b.theme || "",
      user_agent: b.user_agent || "",
      website: b.website || "",
      restricted: restricted,
      image_url: image_url,
      issue_url: issue_url,
      status: "",
    };
    var sh = _tab("feedback");

    // 4. the mail -- the screenshot inline (cid) so the annotated view is in the message itself
    var to = _recipients();
    if (to.length) {
      var subject = "[atlas] " + kind + ": " + (title || text.split("\n")[0]).slice(0, 80);
      var inline = bytes ? { shot: Utilities.newBlob(bytes, "image/png", "view.png") } : null;
      var html =
        "<p><b>" +
        _esc(kind) +
        "</b>" +
        (title ? ": " + _esc(title) : "") +
        "</p>" +
        "<p>" +
        _esc(text).replace(/\n/g, "<br>") +
        "</p>" +
        (inline
          ? '<p><img src="cid:shot" alt="the view" style="max-width:100%;border:1px solid #ccc"></p>'
          : "") +
        (row.url
          ? '<p><b>View:</b> <a href="' + _esc(row.url) + '">' + _esc(row.url) + "</a></p>"
          : "") +
        "<p><b>Release:</b> " +
        _esc(row.release) +
        " · " +
        _esc(row.lens) +
        " · " +
        _esc(row.viewport) +
        " · " +
        _esc(row.theme) +
        (restricted ? " · <b>RESTRICTED</b>" : "") +
        "<br>" +
        (row.email ? "<b>From:</b> " + _esc(row.email) + "<br>" : "") +
        (image_url ? '<b>Screenshot:</b> <a href="' + image_url + '">Drive</a><br>' : "") +
        (issue_url ? '<b>Issue:</b> <a href="' + issue_url + '">' + issue_url + "</a><br>" : "") +
        "<b>Sheet row id:</b> " +
        id +
        "</p>";
      var mail = { to: to.join(","), subject: subject, htmlBody: html, name: "Atlas feedback" };
      if (inline) mail.inlineImages = inline;
      MailApp.sendEmail(mail);
      status.push("mailed " + to.length + (inline ? " (screenshot inline)" : ""));
    }
    // 4b. the sender's own copy (a separate message: the recipients list stays private)
    if (/^[^@\s]+@[^@\s]+$/.test(row.email)) {
      try {
        MailApp.sendEmail({
          to: row.email,
          subject: "Your atlas feedback: " + (title || text.split("\n")[0]).slice(0, 80),
          htmlBody:
            "<p>Thanks — we received this. It went to the team" +
            (issue_url
              ? ' and is public issue <a href="' +
                issue_url +
                '">' +
                issue_url +
                "</a>, where any reply will appear"
              : "") +
            ".</p>" +
            html,
          name: "Atlas feedback",
        });
        status.push("copied to sender");
      } catch (err) {
        status.push("sender copy failed: " + String(err).slice(0, 80));
      }
    }

    row.status = status.join("; ");
    sh.getRange(sh.getLastRow() + 1, 1, 1, FEEDBACK_HEADER.length).setValues([
      FEEDBACK_HEADER.map(function (c) {
        return row[c] === undefined ? "" : row[c];
      }),
    ]);

    return _json({
      ok: true,
      id: id,
      image_url: image_url,
      issue_url: issue_url,
      status: row.status,
    });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

// the four kinds R6 decided (bug/idea/question/data) -- an unrecognized value from a hand-crafted
// request falls back to "bug" rather than filing an issue under an arbitrary label.
function _kind(k) {
  var allowed = { bug: 1, idea: 1, question: 1, data: 1 };
  return allowed[k] ? k : "bug";
}

// the public issue: the view URL (if the reporter opted in), the text, the release/lens/viewport
// line, and the screenshot committed under feedback/<id>.png. The submitter's email is NEVER
// passed in here -- it stays in the Sheet/mail only.
function _openIssue(id, ts, b, kind, title, text, bytes) {
  var api = "https://api.github.com/repos/" + REPO;
  var headers = {
    Authorization: "Bearer " + _prop("GITHUB_TOKEN"),
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  var img = "";
  if (bytes && bytes.length) {
    var path = "feedback/" + id + ".png";
    var put = UrlFetchApp.fetch(api + "/contents/" + path, {
      method: "put",
      headers: headers,
      contentType: "application/json",
      muteHttpExceptions: true,
      payload: JSON.stringify({
        message: "feedback " + id + ": screenshot",
        content: Utilities.base64Encode(bytes),
        branch: BRANCH,
      }),
    });
    if (put.getResponseCode() < 300) {
      img =
        "\n\n![view](https://raw.githubusercontent.com/" + REPO + "/" + BRANCH + "/" + path + ")";
    }
  }
  var issueTitle = (title || text.split("\n")[0]).slice(0, 100);
  var body =
    (b.url ? "**View:** " + b.url + "\n" : "") +
    "**Release:** " +
    (b.release || "unresolved") +
    " · " +
    (b.lens || "") +
    " · " +
    (b.viewport || "") +
    " · " +
    (b.theme || "") +
    "\n\n" +
    text +
    img +
    "\n\n_Sent from the atlas feedback dialog · " +
    ts.toISOString() +
    " · id " +
    id +
    "_";
  var res = UrlFetchApp.fetch(api + "/issues", {
    method: "post",
    headers: headers,
    contentType: "application/json",
    muteHttpExceptions: true,
    payload: JSON.stringify({ title: issueTitle, body: body, labels: [kind] }),
  });
  if (res.getResponseCode() >= 300) {
    throw new Error("GitHub " + res.getResponseCode() + ": " + res.getContentText().slice(0, 200));
  }
  return JSON.parse(res.getContentText()).html_url;
}

function _recipients() {
  var sh = _tab("recipients");
  if (!sh || sh.getLastRow() < 2) return [];
  return sh
    .getRange(2, 1, sh.getLastRow() - 1, 1)
    .getValues()
    .map(function (r) {
      return String(r[0]).trim();
    })
    .filter(function (v) {
      return /^[^@\s]+@[^@\s]+$/.test(v);
    });
}
function _rateLimited() {
  var cache = CacheService.getScriptCache();
  var key = "fb:" + Math.floor(Date.now() / 3600000);
  var n = parseInt(cache.get(key) || "0", 10) + 1;
  cache.put(key, String(n), 3600);
  return n > MAX_PER_HOUR;
}
function _folder() {
  var id = _prop("DRIVE_FOLDER_ID");
  if (id) return DriveApp.getFolderById(id);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var parents = DriveApp.getFileById(ss.getId()).getParents();
  var parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  var it = parent.getFoldersByName("atlas feedback");
  return it.hasNext() ? it.next() : parent.createFolder("atlas feedback");
}
function _tab(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}
function _prop(k) {
  return PropertiesService.getScriptProperties().getProperty(k);
}
function _stamp(d) {
  return Utilities.formatDate(d, "UTC", "yyyyMMdd_HHmmss");
}
function _esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function _json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
