// The built dist/ of an instance carries the modules its instance.json selects and none it does not
// (the instance module table, scripts/instance-modules.mjs). Three checks, all over the build output:
//   - pages: dist/<page>.html for every page the instance names, and no other table page;
//   - sources: no chunk of `.vite/manifest.json` comes from a source an unselected entry `owns`;
//   - markers: every selected entry's `markers` (string literals that survive minification) appear
//     in some dist text file, and no unselected entry's does. The first half is what makes the second
//     able to fail: a marker that a build including the module would not contain proves nothing.
// Pure over a directory listing plus file reads; scripts/check-instance-dist.mjs is the CLI.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { MODULE_TABLE, splitEntries } from "./instance-modules.mjs";

const TEXT_RE = /\.(js|mjs|css|html|json)$/;

/** every text file under `dir` (js, mjs, css, html, json), as `[relativePath, text]`. */
export function distTexts(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (TEXT_RE.test(e)) out.push([relative(dir, p), readFileSync(p, "utf8")]);
    }
  };
  walk(dir);
  return out;
}

/** the source paths named in the dist's Vite manifest (entries, dynamic entries and their `src`). */
export function manifestSources(dir) {
  const file = join(dir, ".vite", "manifest.json");
  if (!existsSync(file)) return null;
  const m = JSON.parse(readFileSync(file, "utf8"));
  const out = new Set();
  for (const [key, chunk] of Object.entries(m)) {
    out.add(key);
    if (chunk.src) out.add(chunk.src);
  }
  return [...out];
}

/** problems with `dir` as the dist of `instance`; empty when it carries exactly what it should. */
export function instanceDistProblems(dir, instance, table = MODULE_TABLE) {
  const errs = [];
  if (!existsSync(dir)) return [`${dir}: no such directory`];
  for (const p of instance.pages ?? ["index"]) {
    if (!existsSync(join(dir, `${p}.html`))) errs.push(`page ${p}.html is missing`);
  }
  for (const [p, file] of Object.entries(table.pages)) {
    if (!(instance.pages ?? []).includes(p) && existsSync(join(dir, file))) {
      errs.push(`page ${file} is built but the instance does not publish it`);
    }
  }
  const { selected, unselected } = splitEntries(instance, table);
  const sources = manifestSources(dir);
  if (!sources)
    errs.push(".vite/manifest.json is missing (vite.config.ts builds with manifest: true)");
  for (const [group, key, entry] of unselected) {
    for (const own of entry.owns ?? []) {
      for (const src of sources ?? []) {
        if (src.startsWith(own)) errs.push(`${group}.${key}: ${src} is in the build`);
      }
    }
  }
  const texts = distTexts(dir);
  const found = (marker) => texts.find(([, t]) => t.includes(marker))?.[0] ?? null;
  for (const [group, key, entry] of selected) {
    for (const marker of entry.markers ?? []) {
      if (!found(marker)) errs.push(`${group}.${key}: its marker "${marker}" is not in the build`);
    }
  }
  for (const [group, key, entry] of unselected) {
    for (const marker of entry.markers ?? []) {
      const where = found(marker);
      if (where) errs.push(`${group}.${key}: its marker "${marker}" is in ${where}`);
    }
  }
  return errs;
}
