#!/usr/bin/env node
// The OBIS -> H3 -> EOV paper's app figures, from the atlas (obis-hex parity rows 124 to 127, D7): the three states of
// the paper as the obis-hex URLs the paper's figures were made from, converted to atlas URLs by the atlas's own codec
// (`obisHexRedirect`, src/lib/state/obisHex.ts: the URL a link to the old figure lands on), opened in headless
// Chromium at 1512x798, shot when the layer is ready, saved to docs/shots/figA_atlas_*.png.
//
//   node scripts/figures.mjs                    # builds the oceanmetrics instance into a temp dir, previews it
//   node scripts/figures.mjs --dist dist        # previews a built dist/ (it must be the oceanmetrics instance)
//   node scripts/figures.mjs --url https://oceanmetrics.io/atlas/   # the live site
//   node scripts/figures.mjs --only caribbean_cell_res4             # one figure (a substring of its name)
//   node scripts/figures.mjs --out /some/dir                        # elsewhere than docs/shots
//
// Either way the data is the live obis-h3 release (the collection the catalog links), so a later release changes a
// figure: the log line of each figure prints the footer (OBIS snapshot, release) and the caption cites it.
//
// What the redirect cannot carry is written by hand, in `extra` (and `cell`): the obis-hex hash `t` (the theme) is
// dropped by the atlas grammar (the atlas's `theme` is a query switch), and a selected hexagon `x` is not carried
// either (the atlas's own key is `cell=<h3>`, which opens the Cell pane).
//
// Chromium runs WebGL on SwiftShader (no GPU), so this works over ssh and in CI, like obis-hex's own figures script.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** the atlas the obis-hex redirect lands on: `obisHexRedirect` writes `<origin>/atlas/?...` */
export const ATLAS_ORIGIN = "https://oceanmetrics.io/atlas/";
export const VIEWPORT = { width: 1512, height: 798 };
/** the obis-h3 release's collection (the stable one), as e2e/obis.spec.ts links it */
export const OBIS_COLLECTION_URL =
  "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/obis-h3/collection.json";

/** the live catalog with the OBIS collection linked in the group `obis`, when it does not link it yet (the layer is
 * built but not activated in the published catalog.json: e2e/obis.spec.ts links it the same way). Pure. */
export function withObisLinked(catalog) {
  const links = catalog.links ?? [];
  if (links.some((l) => l.rel === "child" && /obis[-_]h3/.test(String(l.href)))) return catalog;
  return {
    ...catalog,
    links: [
      ...links,
      { rel: "child", href: OBIS_COLLECTION_URL, type: "application/json", "atlas:group": "obis" },
    ],
  };
}

/** the three figures. `obisHex` is the obis-hex link of the paper's state (the hash `i l p r o t d g c`, and the query
 * switch `tour=off`, as obis-hex's own figures script opens it); `extra` is what the redirect drops and the figure
 * needs; `cell` is the selected hexagon (obis-hex `x`, dropped by the redirect, atlas `cell=`). */
export const FIGURES = [
  {
    file: "figA_atlas_global_es_2020s.png",
    what: "all taxa, ES(50), the 2020s, res 1, dark basemap, globe",
    obisHex:
      "https://oceanmetrics.io/obis-hex/?tour=off#i=es&l=all&p=2020&r=1&o=0.85&t=dark&d=release&g=globe&c=-30,15,1.5",
    extra: { theme: "dark" },
  },
  {
    file: "figA_atlas_seagrasses_globe.png",
    what: "seagrasses EOV, ES(50), all years, res 1, light, globe",
    obisHex:
      "https://oceanmetrics.io/obis-hex/?tour=off#i=es&l=eov:seagrasses&p=all&r=1&o=0.85&t=light&d=release&g=globe&c=-30,15,1.5",
    extra: { theme: "light" },
  },
  {
    // a real res-4 seagrasses cell (north coast of Jamaica: 411 records, 4 species, ES(50) 3.12), read from the release's
    // eov/eov=seagrasses/res=4 file 2026-10-23; the atlas shows its own Cell pane (obis-hex's `k=place` has no counterpart)
    file: "figA_atlas_caribbean_cell_res4.png",
    what: "seagrasses EOV, ES(50), all years, res 4, flat, the Caribbean, one hexagon open in the Cell pane",
    obisHex:
      "https://oceanmetrics.io/obis-hex/?tour=off#i=es&l=eov:seagrasses&p=all&r=4&o=0.85&t=light&d=release&g=flat&c=-77.5,19,5.2&x=8467365ffffffff",
    extra: { theme: "light" },
    cell: "8467365ffffffff",
  },
];

/** the atlas URL of a figure: the redirect's URL (`redirect` is `obisHexRedirect`, injected so this file needs no
 * TypeScript loader to be imported), then `extra` and `cell` by hand, then the origin swapped for `base` (a preview or
 * the live site, with a trailing slash). Pure. */
export function figureUrl(fig, redirect, base = ATLAS_ORIGIN) {
  const r = redirect(fig.obisHex);
  const u = new URL(r.url);
  for (const [k, v] of Object.entries(fig.extra ?? {})) u.searchParams.set(k, v);
  if (fig.cell) u.searchParams.set("cell", fig.cell);
  const root = new URL(ATLAS_ORIGIN);
  if (u.origin + u.pathname.replace(/[^/]*$/, "") !== root.origin + root.pathname)
    throw new Error(`figureUrl: ${r.url} is not under ${ATLAS_ORIGIN}`);
  // URLSearchParams would write `%2C` for the commas of `map=`; the atlas writes them bare (prettyEncode)
  const query = u.searchParams.toString().replace(/%2C/gi, ",").replace(/%3A/gi, ":");
  return `${new URL(base).href}?${query}${u.hash}`;
}

function args(argv) {
  const out = { url: null, dist: null, only: null, out: join(ROOT, "docs", "shots") };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--url") out.url = argv[++i];
    else if (argv[i] === "--dist") out.dist = resolve(argv[++i]);
    else if (argv[i] === "--only") out.only = argv[++i];
    else if (argv[i] === "--out") out.out = resolve(argv[++i]);
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return out;
}

/** the atlas codec, loaded through vite's SSR loader (the codec is TypeScript) */
async function loadRedirect() {
  const { createServer } = await import("vite");
  const server = await createServer({
    root: ROOT,
    logLevel: "silent",
    appType: "custom",
    server: { middlewareMode: true },
  });
  try {
    const mod = await server.ssrLoadModule("/src/lib/state/obisHex.ts");
    return mod.obisHexRedirect;
  } finally {
    await server.close();
  }
}

async function main() {
  const a = args(process.argv.slice(2));
  const redirect = await loadRedirect();
  let preview = null;
  let builtDir = null;
  let base = a.url;
  if (!base) {
    let dist = a.dist;
    if (!dist) {
      // the built dist/ of a checkout is whichever instance was built last: build the Ocean Metrics one
      dist = builtDir = mkdtempSync(join(tmpdir(), "atlas-figures-dist-"));
      const r = spawnSync("npx", ["vite", "build", "--outDir", dist, "--emptyOutDir"], {
        cwd: ROOT,
        env: { ...process.env, VITE_INSTANCE: "oceanmetrics" },
        stdio: "inherit",
      });
      if (r.status !== 0) throw new Error("vite build failed");
    }
    const { preview: startPreview } = await import("vite");
    preview = await startPreview({
      root: ROOT,
      logLevel: "silent",
      build: { outDir: dist },
      preview: { port: 4399, strictPort: false, open: false },
    });
    base = preview.resolvedUrls.local[0];
  }
  if (!base.endsWith("/")) base += "/";
  const { chromium } = await import("playwright");
  mkdirSync(a.out, { recursive: true });
  const browser = await chromium.launch({
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  try {
    for (const fig of FIGURES.filter((f) => !a.only || f.file.includes(a.only))) {
      const url = figureUrl(fig, redirect, base);
      const page = await browser.newPage({ viewport: VIEWPORT });
      await page.route(/\/atlas\/catalog\.json(\?.*)?$/, async (route) => {
        const res = await route.fetch();
        const json = withObisLinked(await res.json());
        await route.fulfill({ response: res, json });
      });
      await page.goto(url);
      // ready, as e2e/obis.spec.ts boot() and its coverage line: the shell is hydrated, the map handle is set, the
      // layer's controls are up, then the layer has drawn (no status line, the ES(50) coverage line is written)
      await page.waitForSelector("#rail-region .rail", { state: "attached", timeout: 120_000 });
      await page.waitForFunction(() => !!window.__atlasMap, null, { timeout: 60_000 });
      if (fig.cell) {
        // a selected cell opens the Details pane (the Layers controls are unmounted): the cell's indicators are the
        // ready state, and its sentence and footer are read from the pane's own words
        await page.getByTestId("h3-cell-indicators").waitFor({ timeout: 180_000 });
        await page
          .getByTestId("h3-cell-species-total")
          .waitFor({ timeout: 180_000 })
          .catch(() => {});
      } else {
        await page.getByTestId("h3-controls").waitFor({ state: "visible", timeout: 120_000 });
        await page.getByTestId("h3-coverage").waitFor({ state: "visible", timeout: 180_000 });
        await page.getByTestId("h3-status").waitFor({ state: "detached", timeout: 180_000 });
      }
      await page.waitForLoadState("networkidle"); // basemap tiles and glyphs
      await page.waitForTimeout(1500); // the globe settles and deck redraws
      const text = async (id) =>
        (
          (await page
            .getByTestId(id)
            .first()
            .textContent({ timeout: 1000 })
            .catch(() => "")) || ""
        )
          .replace(/\s+/g, " ")
          .trim();
      const sentence = await text(fig.cell ? "h3-cell-indicators" : "h3-sentence");
      const coverage = await text(fig.cell ? "h3-cell-species-total" : "h3-coverage");
      const footer = await text(fig.cell ? "h3-cell-read" : "h3-footer");
      await page.screenshot({ path: join(a.out, fig.file) });
      console.log(
        `${fig.file}: ${fig.what}\n  ${sentence}\n  ${coverage}\n  ${footer}\n  ${url}\n  from ${fig.obisHex}`,
      );
      await page.close();
    }
  } finally {
    await browser.close();
    await preview?.close();
    if (builtDir) rmSync(builtDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
