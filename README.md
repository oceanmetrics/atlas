# OceanMetrics Atlas

A static web app (Svelte 5 + Vite + TypeScript, no server) that maps species distribution model
products described by a STAC catalog, with places from the Ocean Metrics gazetteer. Live at
<https://oceanmetrics.io/atlas/>. Forked from
[MarineSensitivity/atlas](https://github.com/MarineSensitivity/atlas) 0.10.88 (remote `upstream`) and
stripped to a catalog-driven core; the plan and the rules that do not change are in
[`CLAUDE.md`](./CLAUDE.md).

## Commands

```sh
npm ci
npm run dev                # http://localhost:5173
npm run check              # svelte-check (types inside .svelte files too)
npm test                   # vitest
npm run build              # dist/
npm run size-budget        # critical-path gzip budget + lazy-chunk check against a real build
npm run lint && npm run format:check
npm run test:faults        # seeded-fault suite (tests/GATES.md)
```

## Where data lives

- **Catalog and collections**: `https://storage.oceanmetrics.io/atlas/` = `s3://oceanmetrics.io-public/atlas/`
  (read path-style at `https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/atlas/` until the
  storage host answers CORS). Built by the Python pipeline in `pipeline/`. The one place the origin
  is formed is `src/lib/catalog/base.ts`; override it with `?catalog=<https url>` or `VITE_CATALOG_BASE`. `?collection=<https url of a
collection.json>` adds one unlisted collection to the picker (a private preview link).
- **MarineSensitivity collections** are read by reference from `https://file.marinesensitivity.org/stac/`;
  the Species lens still reads one pinned MST release (`src/lib/release/mst.ts`).
- **Gazetteer places**: `https://storage.oceanmetrics.io/gazetteer/` (`docs/gazetteer-places.md`).
- **Rasters** render through the MarineSensitivity titiler (`src/lib/raster/tiles.ts`); numbers never
  come from the tile server.

## Build-time configuration (all optional)

`VITE_CATALOG_BASE`, `VITE_FEEDBACK_URL`, `VITE_LOG_URL`, `VITE_GA_ID` (see `.github/workflows/pages.yml`).
Analytics are off unless `VITE_GA_ID` / `VITE_LOG_URL` are set.

## Docs

`docs/` is inherited from upstream: `map.md`, `engine.md`, `species-data.md`, `gazetteer-places.md`,
`upload.md`, `feedback.md`, `analytics.md` still describe the code that remains; pages that mention
scores, Program Areas, releases or reports describe the retired MarineSensitivity app.
