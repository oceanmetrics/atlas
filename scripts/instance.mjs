// The atlas instance a build, a check script or a test runs for (vision doc 2026-10-21, "The atlas,
// one codebase with skins"): `instances/<id>/` holds the brand tokens, the mark and logos, the titles,
// the default catalog and lens, and the tool list. `VITE_INSTANCE=<id>` selects the folder (default
// `oceanmetrics`); vite.config.ts aliases `@instance` to it, and every brand check script reads the
// same id from here so a check never runs against a different instance than the build.
//
// Pure helpers plus two small file readers (`readInstance`, `readMark`); nothing here writes. The
// JSON Schema (`instances/instance.schema.json`) is checked by `validateInstance`, a hand validator
// for the subset of draft 2020-12 the schema uses (no ajv dependency).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

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
 * `$ref` (local `#/$defs/...`), `type`, `enum`, `pattern`, `minLength`, `required`, `properties`,
 * `additionalProperties: false`, `dependentRequired`, `items` (a schema or `false`), `prefixItems`,
 * `minItems`, `uniqueItems` and `oneOf`; an unknown keyword throws, so the schema cannot grow a rule
 * this validator silently ignores. Returns a list of `<path>: <problem>` strings, empty when valid.
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
  if (schema.type && !typeOk(schema.type, value)) return [`${path}: not a ${schema.type}`];
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

/**
 * Fill an HTML entry from the instance (the `transformIndexHtml` hook in vite.config.ts; tests run
 * the same function over the raw files). Two placeholder forms:
 *   `%instance.<key>%`        a text value, HTML-escaped: name, title, description, siteName,
 *                             siteUrl, favicon
 *   `<!--instance:<block>-->` markup: `og-image` (the og:image tags, or nothing), `mark-box` (the
 *                             mark's empty, sized <svg> box), `wordmark` (the wordmark spans)
 * An unknown placeholder throws, so a typo can never ship as literal text.
 */
export function renderInstanceHtml(html, instance, mark) {
  const text = {
    name: instance.name,
    title: instance.title,
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
