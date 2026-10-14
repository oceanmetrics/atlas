#!/usr/bin/env node
// Renders public/og.svg to public/og.png (1200 x 630) with the Playwright chromium this repo already
// depends on. Run after editing og.svg: `node scripts/render-og.mjs`. The PNG is committed (the
// social-card crawlers that read og:image do not render SVG).
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const svg = readFileSync("public/og.svg", "utf8");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(`<body style="margin:0">${svg}</body>`);
await page.screenshot({ path: "public/og.png", clip: { x: 0, y: 0, width: 1200, height: 630 } });
await browser.close();
process.stdout.write("render-og: wrote public/og.png\n");
