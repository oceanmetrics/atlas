import { fileURLToPath, URL } from "node:url";
import { defineConfig, devices } from "@playwright/test";

// the analytics privacy gate of the oceanmetrics instance, where the Ocean Metrics bar loads GA4 (`<om-nav data-ga>`,
// @oceanmetrics/nav >= 0.2.0; docs/analytics.md "The Ocean Metrics instance"). Two REAL builds of the instance, each
// served by `vite preview`: `off/dist` without VITE_GA_ID (port 4384) and `on/dist` with the dummy G-TEST000000 (port
// 4385), inside this worktree range like e2e/fixtures/analytics-privacy (4382). @playwright/test resolves from the
// root node_modules; this file only scopes testDir and the servers.
const fixtureDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const OUT = "e2e/fixtures/nav-analytics";

const serve = (leg: "off" | "on", port: number, ga: string) => ({
  command:
    `VITE_INSTANCE=oceanmetrics VITE_GA_ID=${ga} npx vite build --outDir ${OUT}/${leg}/dist --emptyOutDir && ` +
    `VITE_INSTANCE=oceanmetrics npx vite preview --outDir ${OUT}/${leg}/dist --port ${port} --strictPort`,
  cwd: repoRoot,
  url: `http://localhost:${port}/`,
  reuseExistingServer: false,
  timeout: 180_000,
});

export default defineConfig({
  testDir: fixtureDir,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  use: { trace: "retain-on-failure" },
  webServer: [serve("off", 4384, ""), serve("on", 4385, "G-TEST000000")],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
