// The atlas instance a build, a check script or a test runs for (vision doc 2026-10-21, "The atlas,
// one codebase with skins"): `instances/<id>/` holds the brand tokens, the mark and logos, the titles,
// the default catalog and lens, and the tool list. `VITE_INSTANCE=<id>` selects the folder (default
// `oceanmetrics`); vite.config.ts aliases `@instance` to it, and every brand check script reads the
// same id from here so a check never runs against a different instance than the build.
//
// Pure helpers plus two small file readers (`readInstance`, `readMark`); nothing here writes. The
// JSON Schema (`instances/instance.schema.json`) is checked by `validateInstance`, a hand validator
// for the subset of draft 2020-12 the schema uses (no ajv dependency).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  resolveStorageHost,
  rewriteStorageUrls,
  STORAGE_ENV,
  STORAGE_HOSTS,
} from "@oceanmetrics/catalog/storage";

export const DEFAULT_INSTANCE = "oceanmetrics";
export const INSTANCES_DIR = "instances";
export const SCHEMA_FILE = `${INSTANCES_DIR}/instance.schema.json`;

const ID_RE = /^[a-z][a-z0-9-]*$/;

/** the selected instance id: `VITE_INSTANCE` (trimmed), else the default. Throws on a malformed id. */
export function instanceId(env = process.env) {
  const id = (env.VITE_INSTANCE ?? "").trim() || DEFAULT_INSTANCE;
  if (!ID_RE.test(id)) throw new Error(`VITE_INSTANCE: "${id}" is not an instance id (${ID_RE})`);
  return id;
}

/** `instances/<id>` (repo-relative, `/`-separated like every other path these scripts print). */
export const instanceDir = (id = instanceId()) => `${INSTANCES_DIR}/${id}`;
export const instanceTokensCss = (id = instanceId()) => `${instanceDir(id)}/tokens.css`;
export const instanceTokensJson = (id = instanceId()) => `${instanceDir(id)}/tokens.json`;
export const instanceAssetsDir = (id = instanceId()) => `${instanceDir(id)}/assets`;

/** every folder under instances/ that holds an instance.json. */
export function listInstances(root = ".") {
  return readdirSync(join(root, INSTANCES_DIR))
    .filter((d) => {
      try {
        return statSync(join(root, INSTANCES_DIR, d, "instance.json")).isFile();
      } catch {
        return false;
      }
    })
    .sort();
}

/** the parsed instance.json of `id`; throws when the folder or file is missing. */
export function readInstance(id = instanceId(), root = ".") {
  return JSON.parse(readFileSync(join(root, instanceDir(id), "instance.json"), "utf8"));
}

// --- validation (the draft 2020-12 subset instance.schema.json uses) ----------------------------

function typeOk(type, v) {
  if (type === "object") return !!v && typeof v === "object" && !Array.isArray(v);
  if (type === "array") return Array.isArray(v);
  if (type === "string") return typeof v === "string";
  if (type === "integer") return Number.isInteger(v);
  if (type === "number") return typeof v === "number";
  if (type === "boolean") return typeof v === "boolean";
  return false;
}

/**
 * Validate `value` against `schema` (refs resolve against `root`, default `schema`). Supports
 * `$ref` (local `#/$defs/...`), `type`, `enum`, `const`, `pattern`, `minLength`, `minimum`, `required`,
 * `properties`, `additionalProperties: false`, `dependentRequired`, `items` (a schema or `false`),
 * `prefixItems`, `minItems`, `uniqueItems`, `contains`, `oneOf`, `allOf` and `if`/`then` (1.1: the
 * defaults.lens-in-lenses rule); an unknown keyword (`else` among them) throws, so the schema cannot
 * grow a rule this validator silently ignores. Returns a list of `<path>: <problem>` strings, empty
 * when valid.
 */
export function validateInstance(value, schema, root = schema, path = "$") {
  const KNOWN = new Set([
    "$schema",
    "$id",
    "$defs",
    "$ref",
    "title",
    "description",
    "type",
    "enum",
    "pattern",
    "minLength",
    "required",
    "properties",
    "additionalProperties",
    "dependentRequired",
    "items",
    "prefixItems",
    "minItems",
    "uniqueItems",
    "oneOf",
    "allOf",
    "if",
    "then",
    "const",
    "contains",
    "minimum",
  ]);
  for (const k of Object.keys(schema)) {
    if (!KNOWN.has(k)) throw new Error(`validateInstance: unsupported schema keyword "${k}"`);
  }
  if (schema.$ref) {
    const target = schema.$ref
      .replace(/^#\//, "")
      .split("/")
      .reduce((o, k) => o?.[k], root);
    if (!target) throw new Error(`validateInstance: unresolved $ref ${schema.$ref}`);
    return validateInstance(value, target, root, path);
  }
  const errs = [];
  if (schema.oneOf) {
    const passing = schema.oneOf.filter((s) => validateInstance(value, s, root, path).length === 0);
    if (passing.length !== 1)
      errs.push(`${path}: matches ${passing.length} of oneOf, not exactly 1`);
    return errs;
  }
  for (const sub of schema.allOf ?? []) errs.push(...validateInstance(value, sub, root, path));
  if (schema.if && validateInstance(value, schema.if, root, path).length === 0 && schema.then) {
    errs.push(...validateInstance(value, schema.then, root, path));
  }
  if (schema.type && !typeOk(schema.type, value)) return [...errs, `${path}: not a ${schema.type}`];
  if ("const" in schema && JSON.stringify(value) !== JSON.stringify(schema.const)) {
    errs.push(`${path}: ${JSON.stringify(value)} is not ${JSON.stringify(schema.const)}`);
  }
  if (schema.minimum !== undefined && typeof value === "number" && value < schema.minimum) {
    errs.push(`${path}: less than ${schema.minimum}`);
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errs.push(`${path}: ${JSON.stringify(value)} not one of ${JSON.stringify(schema.enum)}`);
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errs.push(`${path}: shorter than ${schema.minLength}`);
    }
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) {
      errs.push(`${path}: ${JSON.stringify(value)} does not match ${schema.pattern}`);
    }
  }
  if (typeOk("object", value)) {
    for (const k of schema.required ?? []) {
      if (!(k in value)) errs.push(`${path}: missing "${k}"`);
    }
    for (const [k, deps] of Object.entries(schema.dependentRequired ?? {})) {
      if (k in value)
        for (const d of deps) if (!(d in value)) errs.push(`${path}: "${k}" needs "${d}"`);
    }
    for (const [k, v] of Object.entries(value)) {
      const sub = schema.properties?.[k];
      if (sub) errs.push(...validateInstance(v, sub, root, `${path}.${k}`));
      else if (schema.additionalProperties === false) errs.push(`${path}: unknown key "${k}"`);
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errs.push(`${path}: fewer than ${schema.minItems} items`);
    }
    if (schema.uniqueItems && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) {
      errs.push(`${path}: items are not unique`);
    }
    if (
      schema.contains &&
      !value.some(
        (v, i) => validateInstance(v, schema.contains, root, `${path}[${i}]`).length === 0,
      )
    ) {
      const want =
        "const" in schema.contains
          ? JSON.stringify(schema.contains.const)
          : "an item matching contains";
      errs.push(`${path}: has no ${want}`);
    }
    const prefix = schema.prefixItems ?? [];
    value.forEach((v, i) => {
      const p = `${path}[${i}]`;
      if (i < prefix.length) errs.push(...validateInstance(v, prefix[i], root, p));
      else if (schema.items === false) errs.push(`${p}: no item allowed here`);
      else if (schema.items) errs.push(...validateInstance(v, schema.items, root, p));
    });
  }
  return errs;
}

/** read and validate the instance `id`; throws with every problem listed when it does not validate. */
export function loadInstance(id = instanceId(), root = ".") {
  const instance = readInstance(id, root);
  const schema = JSON.parse(readFileSync(join(root, SCHEMA_FILE), "utf8"));
  const errs = validateInstance(instance, schema);
  if (instance.id !== id) errs.push(`$.id: "${instance.id}" is not the folder name "${id}"`);
  if (errs.length) {
    throw new Error(
      `${instanceDir(id)}/instance.json is not a valid instance:\n  ${errs.join("\n  ")}`,
    );
  }
  return instance;
}

// --- the mark -------------------------------------------------------------------------------------

/**
 * The instance's mark SVG split into what src/lib/brand/Mark.svelte renders: its `viewBox` and the
 * markup inside the root `<svg>` (comments dropped). Pure over the file text.
 */
export function parseMark(svgText) {
  const text = svgText.replace(/<!--[\s\S]*?-->/g, "").trim();
  const m = text.match(/^<svg\b([^>]*)>([\s\S]*)<\/svg>$/);
  if (!m) throw new Error("mark: not a single root <svg> element");
  const viewBox = m[1].match(/\bviewBox="([^"]+)"/)?.[1];
  if (!viewBox) throw new Error("mark: the root <svg> has no viewBox");
  return { viewBox, body: m[2].trim().replace(/\n\s*/g, " ") };
}

/** the parsed mark of instance `id` (its `mark` file, relative to the instance folder). */
export function readMark(instance, root = ".") {
  return parseMark(readFileSync(join(root, instanceDir(instance.id), instance.mark), "utf8"));
}

// --- index.html / catalog.html ------------------------------------------------------------------

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
export const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ESC[c]);

/** the wordmark's parts: three strings, or one string as a single part. */
export const wordmarkParts = (wordmark) => (Array.isArray(wordmark) ? wordmark : [wordmark]);

/**
 * The wordmark's spans, the markup Wordmark.svelte renders and the static skeleton copies: three
 * parts are `<wm-0><wm-1> <wm-2>` (the first two run together, a space, then the third), one part
 * is `<wm-0>` alone.
 */
export function wordmarkHtml(wordmark) {
  const parts = wordmarkParts(wordmark).map(
    (p, i) => `<span class="wm-${i}">${escapeHtml(p)}</span>`,
  );
  return parts.length === 3 ? `${parts[0]}${parts[1]} ${parts[2]}` : parts.join("");
}

/** the og:image tags (absolute URL against `og.siteUrl`), or nothing when the instance has no card. */
function ogImageHtml(og) {
  if (!og.image) return "";
  const url = new URL(og.image, og.siteUrl).href;
  return [
    `<meta property="og:image" content="${escapeHtml(url)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${escapeHtml(og.imageAlt)}" />`,
  ].join("\n    ");
}

/** the lens switch's labels; `src/shell/lenses.ts` `LENS_LABEL` is the same table (a test keeps them
 * equal), duplicated because the skeleton is written before any bundle exists. */
export const LENS_LABEL = { collection: "Collections", scores: "Scores", species: "Species" };

/** the inline early-fetch script's source (one file for every page, src/lib/release/). */
export const EARLY_FETCH_FILE = "src/lib/release/earlyFetch.inline.js";

/**
 * `url` moved onto the build's storage host when it names any storage host; any other url unchanged. The
 * node twin of src/lib/catalog/storage.ts#onStorage, one rule (`@oceanmetrics/catalog/storage`): the host is
 * `VITE_OM_STORAGE` (the build-time half of the app's own setting; `data-om-storage` on <html> is a run-time
 * setting this build-time text cannot see), else the package's default.
 */
export function onBuildStorage(url, env = process.env) {
  const to = resolveStorageHost(env[STORAGE_ENV.vite]);
  return rewriteStorageUrls(url, { from: Object.values(STORAGE_HOSTS), to });
}

/**
 * The inline early-fetch `<script>` for an instance with a release registry (`release`), or `""`:
 * the source file without its leading comment block, `%release.registry%` filled from the instance
 * (through the storage rule: a registry on a storage host is written on the build's storage host, so
 * the script reads the same origin as `RELEASE_REGISTRY_BASE`). Pure over the file text and `env`
 * (`readEarlyFetch` reads the file).
 */
export function earlyFetchScript(instance, sourceText, env = process.env) {
  if (!instance.release) return "";
  const body = sourceText.replace(/^(?:\/\/[^\n]*\n)+/, "").trim();
  if (!body.includes("%release.registry%")) {
    throw new Error("earlyFetchScript: the script has no %release.registry% placeholder");
  }
  const filled = body.replace(
    /%release\.registry%/g,
    onBuildStorage(instance.release.registry, env),
  );
  return `<script>\n${filled}\n    </script>`;
}

/** the early-fetch source file's text (read once per build or test). */
export function readEarlyFetch(root = ".") {
  return readFileSync(join(root, EARLY_FETCH_FILE), "utf8");
}

/** the instance's web fonts to preload (`instances/<id>/fonts/*.woff2`, sorted), repo-relative; none
 * for an instance without a `fonts/` folder. */
export function instanceFontFiles(id = instanceId(), root = ".") {
  const dir = join(root, instanceDir(id), "fonts");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".woff2"))
    .sort()
    .map((f) => `${instanceDir(id)}/fonts/${f}`);
}

/** what `renderInstanceHtml` writes beyond the instance.json strings: the early-fetch script and the
 * font preloads, read from files (`instanceHtmlExtras` reads them for vite.config.ts and the tests). */
export function instanceHtmlExtras(instance, root = ".", env = process.env) {
  return {
    earlyFetch: earlyFetchScript(instance, readEarlyFetch(root), env),
    fonts: instanceFontFiles(instance.id, root),
  };
}

/**
 * Fill an HTML entry from the instance (the `transformIndexHtml` hook in vite.config.ts; tests run
 * the same function over the raw files). Two placeholder forms:
 *   `%instance.<key>%`        a text value, HTML-escaped: name, title, reportTitle, description,
 *                             siteName, siteUrl, favicon
 *   `<!--instance:<block>-->` markup: `og-image` (the og:image tags, or nothing), `mark-box` (the
 *                             mark's empty, sized <svg> box), `wordmark` (the wordmark spans),
 *                             `nav` (an instance with the Ocean Metrics bar: its placeholder element), `early-fetch` and `version-chip` (an instance with a release: its
 *                             inline early-fetch script and the version chip's skeleton; nothing
 *                             otherwise), `font-preload` (the instance's web fonts)
 * An unknown placeholder throws, so a typo can never ship as literal text.
 *
 * @param {string} html
 * @param {any} instance
 * @param {{ viewBox: string, body: string }} mark
 * @param {{ earlyFetch?: string, fonts?: string[] }} [extras] `instanceHtmlExtras(instance)`
 */
export function renderInstanceHtml(html, instance, mark, extras = {}) {
  const text = {
    name: instance.name,
    title: instance.title,
    reportTitle: instance.report?.title ?? instance.name,
    description: instance.description,
    siteName: instance.og.siteName,
    siteUrl: instance.og.siteUrl,
    favicon: `./${instance.favicon}`,
  };
  const blocks = {
    "og-image": ogImageHtml(instance.og),
    "mark-box":
      `<svg class="mark" viewBox="${escapeHtml(mark.viewBox)}" width="1.05em" height="1.05em" ` +
      `aria-hidden="true" focusable="false" ` +
      `style="display: inline-block; vertical-align: -0.15em; flex: none"></svg>`,
    wordmark: wordmarkHtml(instance.wordmark),
    // an instance with a release: its inline early-fetch script, and the version chip's skeleton twin
    "early-fetch": extras.earlyFetch ?? "",
    "version-chip": instance.release
      ? `<button type="button" class="chip" id="sk-version-chip" data-tour="version-chip" ` +
        `data-control="version-chip" aria-hidden="true" tabindex="-1"></button>`
      : "",
    // an instance with the Ocean Metrics bar: its undefined element, which shell.css gives the bar's
    // 48 px row (the shell's own `<om-nav>` replaces it when the app mounts)
    nav: instance.nav
      ? `<om-nav class="sk-nav" aria-hidden="true" current="${escapeHtml(instance.nav.current)}"></om-nav>`
      : "",
    // the skeleton lens switch: the instance's lenses, the default pressed (src/shell/lenses.ts labels)
    "lens-switch": (instance.lenses ?? [])
      .map(
        (l) =>
          `<span${l === instance.defaults?.lens ? ' class="is-pressed"' : ""}>${escapeHtml(LENS_LABEL[l] ?? l)}</span>`,
      )
      .join(""),
    // the instance's web fonts, preloaded so the first frame paints in them (MarineSensitivity/atlas
    // measured CLS = 0 with the preloads, nonzero without)
    "font-preload": (extras.fonts ?? [])
      .map(
        (f) =>
          `<link rel="preload" as="font" type="font/woff2" href="./${escapeHtml(f)}" crossorigin />`,
      )
      .join("\n    "),
  };
  return html
    .replace(/%instance\.([A-Za-z]+)%/g, (_, k) => {
      if (!(k in text)) throw new Error(`renderInstanceHtml: unknown placeholder %instance.${k}%`);
      return escapeHtml(text[k]);
    })
    .replace(/<!--instance:([a-z-]+)-->/g, (_, k) => {
      if (!(k in blocks)) throw new Error(`renderInstanceHtml: unknown block <!--instance:${k}-->`);
      return blocks[k];
    });
}

// --- assets ---------------------------------------------------------------------------------------

/**
 * Every file under `instances/<id>/assets/` that is served next to the page, as `/`-separated paths
 * relative to that folder (`favicon.svg`, `logos/mbon-logo.png`). `motifs/` is left out: the motifs
 * are CSS masks the bundler inlines from `@instance/assets/motifs/`, never fetched by URL.
 */
export function listInstanceAssets(id = instanceId(), root = ".") {
  const base = join(root, instanceAssetsDir(id));
  const out = [];
  const walk = (rel) => {
    for (const e of readdirSync(join(base, rel))) {
      const r = rel ? `${rel}/${e}` : e;
      if (statSync(join(base, r)).isDirectory()) {
        if (r !== "motifs") walk(r);
      } else out.push(r);
    }
  };
  walk("");
  return out.sort();
}
