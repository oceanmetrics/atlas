#!/usr/bin/env node
// Writes public/mst/nc_models.json and public/mst/gm_models.json, the per-model tables of the two
// MarineSensitivity v8 density collections. STOPGAP until the MST STAC publishes per-model Items
// (it publishes one `model_cell` Item per collection, with no species / season / variable). The app
// reads them lazily when the collection is opened (src/lib/catalog/mst/manifest.ts).
//
// Inputs (MarineSensitivity/workflows):
//   nc  data/nc_models.csv            ds_key,region,sp_code,season,var,cog_url,bidx (one row per band)
//       data/nc_taxon_crosswalk.csv   sp_code -> common / scientific name, GBIF id, BOTW sisid, is_guild
//   gm  <v8 marine-atlas>/dist/model_gm.csv         mdl_key,interval,sp_id,scientific_name,val_cap,...
//       <v8 marine-atlas>/native/gm_cog_registry.csv  mdl_key,sp_id,scientific_name,cog,asset_url
//
// Usage:
//   node scripts/mst/build-manifests.mjs \
//     [--workflows ~/Github/MarineSensitivity/workflows/data] \
//     [--atlas-v8 ~/_big/msens/derived/v8/marine-atlas] [--out public/mst] [--check]
//
// `--check` writes nothing and exits 1 when a committed manifest differs from what the inputs give.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SEASON_ORDER = ["spring", "summer", "fall", "winter"];
export const VARIABLES = {
  n_per_km2: { label: "Density (n per km²)", unit: "n_per_km2" },
  cv_n_per_km2: { label: "Coefficient of variation", unit: "unitless" },
  ci90_n_per_km2: { label: "90% confidence interval (n per km²)", unit: "n_per_km2" },
};
const GM_COG_BASE =
  "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/v8/native/gm/";

// --- csv (RFC 4180: quoted fields, doubled quotes, CRLF) -------------------------------------------

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

const byLabel = (a, b) => a.label.localeCompare(b.label, "en", { sensitivity: "base" });

// --- nc ----------------------------------------------------------------------------------------------

/** @param {Record<string,string>[]} models nc_models.csv rows  @param {Record<string,string>[]} crosswalk */
export function buildNc(models, crosswalk, generated) {
  const xw = new Map(crosswalk.map((r) => [r.sp_code, r]));
  const regions = [...new Set(models.map((m) => m.region))].sort();
  const spCodes = [...new Set(models.map((m) => m.sp_code))];
  const seasons = SEASON_ORDER.filter((s) => models.some((m) => m.season === s));
  const vars = Object.keys(VARIABLES).filter((v) => models.some((m) => m.var === v));
  const labelOf = (code) => {
    const r = xw.get(code);
    const name = r?.sp_common?.replace(/\s+/g, " ").trim() || code;
    return r?.is_guild === "TRUE" ? `${name} (group)` : name;
  };
  const taxa = {};
  for (const code of spCodes) {
    const r = xw.get(code);
    const ids = {};
    if (r?.gbif_id) ids.gbif = r.gbif_id.replace(/^GBIF:/, "");
    if (r?.sisid) ids.botw = r.sisid;
    taxa[code] = {
      ...(r?.nc_scientific ? { scientific_name: r.nc_scientific } : {}),
      ...(r?.sp_common ? { common_name: r.sp_common.replace(/\s+/g, " ").trim() } : {}),
      ...(r?.is_guild === "TRUE" ? { group: true } : {}),
      ids,
    };
  }
  const dims = [
    {
      key: "region",
      title: "Region",
      values: regions.map((v) => ({ value: v.toLowerCase(), label: v })),
    },
    {
      key: "species",
      title: "Species or group",
      description: "A species, or a species group (e.g. all shearwaters) that is its own model.",
      values: spCodes.map((v) => ({ value: v, label: labelOf(v) })).sort(byLabel),
    },
    {
      key: "season",
      title: "Season",
      values: seasons.map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })),
    },
    {
      key: "variable",
      title: "Variable",
      description:
        "Band 1 is density; band 2 its coefficient of variation; band 3 (Atlantic only) its 90% confidence interval.",
      values: vars.map((v) => ({ value: v, label: VARIABLES[v].label })),
    },
  ];
  const order = (arr, v) => arr.indexOf(v);
  const rows = models
    .map((m) => [m.region.toLowerCase(), m.sp_code, m.season, m.var, m.cog_url, Number(m.bidx)])
    .sort(
      (a, b) =>
        order(
          regions.map((r) => r.toLowerCase()),
          a[0],
        ) -
          order(
            regions.map((r) => r.toLowerCase()),
            b[0],
          ) ||
        a[1].localeCompare(b[1]) ||
        order(seasons, a[2]) - order(seasons, b[2]) ||
        order(vars, a[3]) - order(vars, b[3]),
    );
  return {
    schema: 1,
    collection: "msens-v8-nc",
    stopgap:
      "Generated from MarineSensitivity/workflows data/nc_models.csv + nc_taxon_crosswalk.csv by scripts/mst/build-manifests.mjs. A stopgap until the MST STAC publishes per-model Items.",
    generated,
    taxon_dim: "species",
    dims,
    units: Object.fromEntries(vars.map((v) => [v, VARIABLES[v].unit])),
    taxa,
    models: rows,
  };
}

// --- gm ----------------------------------------------------------------------------------------------

/** only the annual surfaces have a COG (the monthly ones are Parquet only, not drawable through titiler). */
export function buildGm(modelGm, registry, generated) {
  const cogOf = new Map(registry.map((r) => [r.sp_id, r.asset_url || `${GM_COG_BASE}${r.cog}`]));
  const annual = modelGm.filter((m) => m.interval === "annual" && cogOf.has(m.sp_id));
  const taxa = {};
  for (const m of annual) {
    const worms = /^WORMS:(\d+)$/.exec(m.sp_id)?.[1];
    const cap = Number(m.val_cap);
    taxa[m.sp_id] = {
      scientific_name: m.scientific_name,
      ids: worms ? { worms } : {},
      ...(Number.isFinite(cap)
        ? {
            note: `Relative annual density, 0-100: the mean over months of density divided by this taxon's 99.5th-percentile cap (${cap} individuals per km²), capped at 100.`,
          }
        : {}),
    };
  }
  const species = annual.map((m) => ({ value: m.sp_id, label: m.scientific_name })).sort(byLabel);
  return {
    schema: 1,
    collection: "msens-v8-gm",
    stopgap:
      "Generated from the MarineSensitivity v8 model_gm.csv + gm_cog_registry.csv by scripts/mst/build-manifests.mjs. Only the annual surfaces are published as COGs. A stopgap until the MST STAC publishes per-model Items.",
    generated,
    taxon_dim: "species",
    dims: [
      { key: "species", title: "Taxon", values: species },
      { key: "time", title: "Time", values: [{ value: "annual", label: "Annual" }] },
    ],
    units: {},
    unit: "relative density (0-100)",
    rescale: [1, 100],
    taxa,
    models: species.map((s) => [s.value, "annual", cogOf.get(s.value), 1]),
  };
}

// --- cli ---------------------------------------------------------------------------------------------

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function main() {
  const workflows = resolve(
    arg("workflows", join(homedir(), "Github/MarineSensitivity/workflows/data")),
  );
  const atlasV8 = resolve(arg("atlas-v8", join(homedir(), "_big/msens/derived/v8/marine-atlas")));
  const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const out = resolve(arg("out", join(root, "public/mst")));
  const check = process.argv.includes("--check");
  const read = (p) => {
    if (!existsSync(p)) throw new Error(`missing input ${p}`);
    return parseCsv(readFileSync(p, "utf8"));
  };
  const generated = arg("generated", new Date().toISOString().slice(0, 10));
  const files = {
    "nc_models.json": buildNc(
      read(join(workflows, "nc_models.csv")),
      read(join(workflows, "nc_taxon_crosswalk.csv")),
      generated,
    ),
    "gm_models.json": buildGm(
      read(join(atlasV8, "dist/model_gm.csv")),
      read(join(atlasV8, "native/gm_cog_registry.csv")),
      generated,
    ),
  };
  if (!check) mkdirSync(out, { recursive: true });
  let drift = false;
  for (const [name, body] of Object.entries(files)) {
    const text = `${JSON.stringify(body)}\n`;
    const path = join(out, name);
    if (check) {
      // the `generated` date is not part of the comparison
      const have = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
      const same =
        have &&
        JSON.stringify({ ...have, generated: "" }) === JSON.stringify({ ...body, generated: "" });
      if (!same) {
        console.error(`${name}: differs from the inputs (re-run without --check)`);
        drift = true;
      }
    } else {
      writeFileSync(path, text);
      console.log(`${path}: ${body.models.length} models, ${(text.length / 1024).toFixed(1)} KB`);
    }
  }
  if (drift) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
