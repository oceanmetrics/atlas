// the analytics check of a build (@oceanmetrics/nav README "Analytics", docs/analytics.md): no page ships a gtag.js
// script tag (only the bar's data-ga adds one, at run time), and a measurement id is in the build exactly when one was
// given. `loader`: the instance has the Ocean Metrics bar, so the bundle must carry its loader (nav >= 0.2.0); an
// instance without the bar (marinesensitivity) keeps its own module and is not asked for it.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const ID_RE = /\bG-[A-Z0-9]{6,16}\b/g;
const TAG_RE = /<script[^>]*googletagmanager\.com/i;
const LOADER = "googletagmanager.com/gtag/js?id=";

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );

/** the problems of the build in `dist` for the id `id` ("" = analytics off); an empty list is a pass */
export function checkGa(dist, id = "", { loader = true } = {}) {
  const problems = [];
  const ids = new Set();
  let hasLoader = false;
  for (const f of walk(dist).filter((f) => /\.(html?|m?js)$/.test(f))) {
    const s = readFileSync(f, "utf8");
    if (/\.html?$/.test(f) && TAG_RE.test(s))
      problems.push(`${relative(dist, f)}: a gtag.js script tag in the page`);
    for (const m of s.matchAll(ID_RE)) ids.add(m[0]);
    hasLoader ||= s.includes(LOADER);
  }
  const stray = [...ids].filter((x) => x !== id).sort();
  if (stray.length) problems.push(`a measurement id that was not given: ${stray.join(", ")}`);
  if (id && !ids.has(id)) problems.push(`the given id ${id} is not in the build`);
  if (id && loader && !hasLoader)
    problems.push("the bar in the build has no analytics loader (@oceanmetrics/nav >= 0.2.0)");
  return problems;
}
