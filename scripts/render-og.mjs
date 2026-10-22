#!/usr/bin/env node
// Renders the instance's og card (instances/<VITE_INSTANCE>/assets/og.svg) to the PNG its
// instance.json names as `og.image` (1200 x 630), with the Playwright chromium this repo already
// depends on. Run after editing og.svg: `node scripts/render-og.mjs` (or
// `VITE_INSTANCE=<id> node scripts/render-og.mjs`). The PNG is committed (the social-card crawlers
// that read og:image do not render SVG). An instance without `og.image` has no card to render.
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { instanceAssetsDir, instanceId, loadInstance } from "./instance.mjs";

const id = instanceId();
const instance = loadInstance(id);
if (!instance.og.image) {
  process.stdout.write(`render-og: instance "${id}" has no og.image; nothing to render\n`);
  process.exit(0);
}
const dir = instanceAssetsDir(id);
const out = `${dir}/${instance.og.image}`;
const svg = readFileSync(`${dir}/og.svg`, "utf8");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(`<body style="margin:0">${svg}</body>`);
await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1200, height: 630 } });
await browser.close();
process.stdout.write(`render-og: wrote ${out}\n`);
