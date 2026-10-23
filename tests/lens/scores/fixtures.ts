// Shared boot.json-shaped fixture for the scores lens' tests — trimmed from the real v7 bundle
// (`.claude/worktrees/contract/workflows/_output/app_bundle/v7/boot.json`, orchestrator-verified
// 2026-09-22), so these tests exercise the SHAPE atlas-1 actually publishes rather than an
// idealized one.
export const BOOT_V7 = {
  schema: 1,
  ver: "v7",
  id_field: "mdl_seq",
  grid: {
    grid_id: "usa05",
    nc: 3103,
    nr: 2006,
    xmin: 141.1,
    ymax: 82.6,
    resx: 0.05,
    resy: 0.05,
    lon360: true,
    tile: { size: 50 },
  },
  study_areas: [{ key: "FULL", label: "All US waters", lon: -101.304, lat: 46.9, zoom: 2.16 }],
  units: [
    {
      zone_type: "programarea",
      fld: "programarea_key",
      zone_tbl: "ply_programareas_2026_v7",
      label: "Program areas",
      pmtiles: "https://s3.example/marine-atlas/zones/programarea_2026-01/zones.pmtiles",
      source_layer: "programarea",
      keys: ["GAA", "GEO"],
    },
  ],
  layers: [
    {
      metric_key: "primprod",
      // M6 (review round 1, corrected in round 2's re-check): v7's REAL LIVE long label -- the
      // round-1 string was v8's `score_cell_metrics.qmd:141` paraphrase, not the actual text the
      // release publishes. Fetched verbatim from the live `v7/app/boot.json` on
      // `oceanmetrics.io-public` (2026-09-24) -- this is the exact text `LayersPanel.svelte`'s
      // `currentLayerDescription` falls back to/compares against when the manifest publishes no
      // short label of its own.
      label:
        "Primary productivity: Oregon State Vertically Generalized Production Model (VGPM) " +
        "from Visible Infrared Imaging Radiometer Suite (VIIRS) satellite data (mg C / m^2 / day) " +
        "from daily averages available as monthly averaged to annual and averaged to overall for " +
        "the most recently available full years of data 2014 to 2023",
      category: "raw",
      order: 1,
      colormap: "spectral_r",
      by_subregion: {
        FULL: {
          cog: "https://s3.example/cog/usa05/primprod-full.tif",
          rescale: [35.1489, 11033.6953],
        },
      },
    },
    {
      metric_key: "extrisk_bird_ecoregion_rescaled",
      label: "Bird: ext. risk, ecoregion",
      category: "component",
      order: 10,
      colormap: "spectral_r",
      by_subregion: {
        FULL: { cog: "https://s3.example/cog/usa05/bird-erc-full.tif", rescale: [0, 100] },
      },
    },
    {
      metric_key: "extrisk_other_ecoregion_rescaled",
      label: "Other: ext. risk, ecoregion",
      category: "component",
      order: 15,
      colormap: "spectral_r",
      by_subregion: {
        FULL: { cog: "https://s3.example/cog/usa05/other-erc-full.tif", rescale: [0, 100] },
      },
    },
    {
      metric_key: "score_extriskspcat_primprod_ecoregionrescaled_equalweights",
      label: "Overall score",
      category: "composite",
      order: 17,
      colormap: "spectral_r",
      by_subregion: {
        FULL: { cog: "https://s3.example/cog/usa05/score-full.tif", rescale: [0, 96] },
      },
    },
  ],
  zones: {
    programarea: [
      {
        key: "GAA",
        name: "Gulf of America, Eastern",
        n_cells: 14256,
        area_km2: 382002.5,
        n_taxa: 5861,
        metrics: {
          extrisk_bird_ecoregion_rescaled: 59.09,
          extrisk_other_ecoregion_rescaled: 25.54,
          score_extriskspcat_primprod_ecoregionrescaled_equalweights: 33.09,
        },
      },
      {
        key: "GEO",
        name: "Georgia",
        n_cells: 8000,
        area_km2: 200000,
        n_taxa: 4000,
        metrics: {
          extrisk_bird_ecoregion_rescaled: 10,
          extrisk_other_ecoregion_rescaled: 5,
          score_extriskspcat_primprod_ecoregionrescaled_equalweights: 12,
        },
      },
    ],
    subregion: [
      { key: "AK", name: "Alaska", n_cells: 1, area_km2: 1, n_taxa: 1, metrics: {} },
      { key: "FULL", name: "All US waters", n_cells: 1, area_km2: 1, n_taxa: 1, metrics: {} },
      { key: "GA", name: "Gulf of America", n_cells: 1, area_km2: 1, n_taxa: 1, metrics: {} },
      { key: "PA", name: "Pacific", n_cells: 1, area_km2: 1, n_taxa: 1, metrics: {} },
      { key: "USA", name: "All US waters", n_cells: 1, area_km2: 1, n_taxa: 1, metrics: {} },
    ],
  },
  // atlas-4 fix round 2 (owner-reported defect, 2026-09-24): the REAL live v7 `flower_default.FULL`
  // shape -- 8 components, "Other" included, full double precision -- read directly off the
  // production screenshot (docs/parity/shots/scores-flower-atlas.jpg) rather than a simplified
  // 3-item stand-in. That stand-in (bird/fish/primprod only) never exercised the bug: with only 3
  // components, none of which happened to be small enough, the hub-occlusion defect (see
  // flowerGeometry.ts's header) never showed up in a test at all. Order matches the real release's
  // own row order (bird, coral, fish, invertebrate, mammal, other, turtle, primprod).
  flower_default: {
    FULL: [
      { component: "bird", score: 45.6671707107685 },
      { component: "coral", score: 10.4494142116047 },
      { component: "fish", score: 15.9570514927416 },
      { component: "invertebrate", score: 14.7345085163167 },
      { component: "mammal", score: 41.668393775248 },
      { component: "other", score: 15.1784428369187 },
      { component: "turtle", score: 38.8176408891894 },
      { component: "primprod", score: 10.3787489146688 },
    ],
  },
  palettes: {
    spectral_r: [
      "#5E4EA1",
      "#3287BD",
      "#66C1A5",
      "#ABDDA4",
      "#E5F498",
      "#FFFFBF",
      "#FEDF8B",
      "#FDAD60",
      "#F36C43",
      "#D43E4E",
      "#9E0041",
    ],
  },
  tables: {
    taxon: { href: "https://s3.example/marine-atlas/v7/app/taxon.parquet", bytes: 1, digest: "d1" },
    zone_taxon: {
      href: "https://s3.example/marine-atlas/v7/app/zone_taxon.parquet",
      bytes: 1,
      digest: "d2",
    },
  },
};

// owner review item 9 (live 0.10.62): "flower plot with component 'No data'" -- the real cause,
// trimmed VERBATIM from the live `v1/app/boot.json` (curl --compressed
// https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/v1/app/boot.json,
// `zones.ecoregion[0].metrics`, orchestrator-verified 2026-09-25): v1 (and every pre-v8 release)
// publishes `extrisk_reptile_ecoregion_rescaled` -- a real, SCORED category that predates the
// current eight-slot `hue_pal()` palette (reptiles were later excluded from scoring entirely,
// CLAUDE.md's own "reptile/amphibian EXCLUDED"). `flower_default` stays `{}` (also verbatim -- no
// live release publishes one for v1, confirmed against the same fetch); this bug is reached
// through the ZONE/CELL click path (`zoneFlowerComponents`/`cellFlowerComponents`), never
// `defaultFlowerComponents` -- see the `USA` row below, still empty for that reason.
export const BOOT_V1_PLANAREA = {
  ...BOOT_V7,
  ver: "v1",
  units: [
    {
      zone_type: "planarea",
      fld: "planarea_key",
      label: "Planning areas",
      pmtiles: "https://s3.example/marine-atlas/zones/planarea_2025-06/zones.pmtiles",
      source_layer: "planarea",
      keys: ["GAA"],
    },
  ],
  zones: {
    subregion: [
      { key: "USA", name: "All US waters", n_cells: 1, area_km2: 1, n_taxa: 1, metrics: {} },
    ],
    // ecoregion "CAC" -- REAL v1 metrics (see this const's own header); the zone a click on the
    // map would actually resolve to.
    ecoregion: [
      {
        key: "CAC",
        name: "California Current",
        n_cells: 24420,
        area_km2: 592478.298484974,
        n_taxa: 3848,
        metrics: {
          extrisk_all_ecoregion_rescaled: 17.8723702282074,
          extrisk_bird_ecoregion_rescaled: 30.7055742952418,
          extrisk_coral_ecoregion_rescaled: 11.5078809415848,
          extrisk_fish_ecoregion_rescaled: 34.6673959734962,
          extrisk_invertebrate_ecoregion_rescaled: 11.5208243281511,
          extrisk_mammal_ecoregion_rescaled: 68.481812426732,
          extrisk_other_ecoregion_rescaled: 10.474400150756,
          extrisk_reptile_ecoregion_rescaled: 15.8720487921304,
          primprod_ecoregion_rescaled: 9.48391732940771,
        },
      },
    ],
  },
  flower_default: {},
};

// atlas-4 fix round 2: v8/v9's REAL shape, trimmed from the live release
// (`curl --compressed https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/v9/app/boot.json`,
// orchestrator-verified 2026-09-22) -- the exact 17-key `layers` list (8 raw + 7 ecoregion-rescaled
// components + primprod's own rescaled component + the composite, in the release's own `order`) and
// the exact `flower_default.AK` (8 entries: 6 unambiguous species categories, PLUS both
// "primary producer" and the bare "primprod" -- the collision this fixture exists to exercise). No
// live release ever publishes a `flower_default.FULL` key (unlike the synthetic v7 fixture above);
// `zoneAllKey()` falls through FULL -> USA -> first available, so this fixture's one `subregion`
// zone is keyed "AK" on purpose, matching `flower_default.AK` above it.
export const BOOT_V9 = {
  schema: 1,
  ver: "v9",
  id_field: "mdl_key",
  grid: {
    grid_id: "global05",
    nc: 7200,
    nr: 3600,
    xmin: -180,
    ymax: 90,
    resx: 0.05,
    resy: 0.05,
    lon360: false,
    tile: { size: 50 },
  },
  study_areas: [{ key: "FULL", label: "All US waters", lon: -101.304, lat: 46.9, zoom: 2.16 }],
  units: [
    {
      zone_type: "programarea",
      zone_set_key: "programarea_2026-01",
      fld: "programarea_key",
      zone_tbl: "ply_programareas_2026_v9",
      label: "Program areas",
      pmtiles:
        "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/zones/programarea_2026-01/zones.pmtiles",
      source_layer: "programarea",
      keys: [
        "ALA", "ALB", "BFT", "BOW", "CEC", "CHU", "COK", "GAA", "GAB", "GEO",
        "GOA", "HAR", "HOP", "KOD", "MAT", "NAV", "NOC", "NOR", "SHU", "SOC",
      ], // prettier-ignore
    },
  ],
  layers: [
    {
      metric_key: "extrisk_bird",
      label: "Extinction-risk-weighted suitability, bird",
      category: "raw",
      order: 1,
      colormap: "spectral_r",
    },
    {
      metric_key: "extrisk_coral",
      label: "Extinction-risk-weighted suitability, coral",
      category: "raw",
      order: 2,
      colormap: "spectral_r",
    },
    {
      metric_key: "extrisk_fish",
      label: "Extinction-risk-weighted suitability, fish",
      category: "raw",
      order: 3,
      colormap: "spectral_r",
    },
    {
      metric_key: "extrisk_invertebrate",
      label: "Extinction-risk-weighted suitability, invertebrate",
      category: "raw",
      order: 4,
      colormap: "spectral_r",
    },
    {
      metric_key: "extrisk_mammal",
      label: "Extinction-risk-weighted suitability, mammal",
      category: "raw",
      order: 5,
      colormap: "spectral_r",
    },
    {
      metric_key: "extrisk_primary_producer",
      label: "Extinction-risk-weighted suitability, primary_producer",
      category: "raw",
      order: 6,
      colormap: "spectral_r",
    },
    {
      metric_key: "extrisk_turtle",
      label: "Extinction-risk-weighted suitability, turtle",
      category: "raw",
      order: 7,
      colormap: "spectral_r",
    },
    {
      metric_key: "extrisk_bird_ecoregion_rescaled",
      label: "extrisk_bird_ecoregion_rescaled",
      category: "component",
      order: 8,
      colormap: "spectral_r",
    },
    {
      metric_key: "extrisk_coral_ecoregion_rescaled",
      label: "extrisk_coral_ecoregion_rescaled",
      category: "component",
      order: 9,
      colormap: "spectral_r",
    },
    {
      metric_key: "extrisk_fish_ecoregion_rescaled",
      label: "extrisk_fish_ecoregion_rescaled",
      category: "component",
      order: 10,
      colormap: "spectral_r",
    },
    {
      metric_key: "extrisk_invertebrate_ecoregion_rescaled",
      label: "extrisk_invertebrate_ecoregion_rescaled",
      category: "component",
      order: 11,
      colormap: "spectral_r",
    },
    {
      metric_key: "extrisk_mammal_ecoregion_rescaled",
      label: "extrisk_mammal_ecoregion_rescaled",
      category: "component",
      order: 12,
      colormap: "spectral_r",
    },
    {
      metric_key: "extrisk_primary_producer_ecoregion_rescaled",
      label: "extrisk_primary_producer_ecoregion_rescaled",
      category: "component",
      order: 13,
      colormap: "spectral_r",
    },
    {
      metric_key: "extrisk_turtle_ecoregion_rescaled",
      label: "extrisk_turtle_ecoregion_rescaled",
      category: "component",
      order: 14,
      colormap: "spectral_r",
    },
    {
      metric_key: "primprod",
      // M6 re-check (round 2): v7's REAL LIVE long label, same string as BOOT_V7's own primprod
      // row above -- fetched verbatim from the live `v7/app/boot.json`, not a shortened stand-in.
      label:
        "Primary productivity: Oregon State Vertically Generalized Production Model (VGPM) " +
        "from Visible Infrared Imaging Radiometer Suite (VIIRS) satellite data (mg C / m^2 / day) " +
        "from daily averages available as monthly averaged to annual and averaged to overall for " +
        "the most recently available full years of data 2014 to 2023",
      category: "raw",
      order: 15,
      colormap: "spectral_r",
    },
    {
      metric_key: "primprod_ecoregion_rescaled",
      label: "primprod_ecoregion_rescaled",
      category: "component",
      order: 16,
      colormap: "spectral_r",
    },
    {
      metric_key: "score_extriskspcat_primprod_ecoregionrescaled_equalweights",
      label: "Equal-weight composite",
      category: "composite",
      order: 17,
      colormap: "spectral_r",
      by_subregion: {
        FULL: {
          cog: "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/cog/global05/9b06b2c2fd2d3672.tif",
          rescale: [0, 90],
        },
      },
    },
  ],
  zones: {
    programarea: [
      {
        key: "GAA",
        name: "Gulf of America, Eastern",
        n_cells: 14238,
        area_km2: 380954.194756411,
        n_taxa: 6346,
        metrics: {
          extrisk_bird_ecoregion_rescaled: 52.7525380825174,
          extrisk_coral_ecoregion_rescaled: 10.6506959949505,
          extrisk_fish_ecoregion_rescaled: 52.6838523369752,
          extrisk_invertebrate_ecoregion_rescaled: 44.2749788356391,
          extrisk_mammal_ecoregion_rescaled: 56.44791952156,
          extrisk_primary_producer_ecoregion_rescaled: 17.4828425546332,
          extrisk_turtle_ecoregion_rescaled: 78.5246656275609,
          primprod_ecoregion_rescaled: 10.7696635962531,
          score_extriskspcat_primprod_ecoregionrescaled_equalweights: 40.4483945687612,
        },
      },
    ],
    subregion: [
      {
        key: "AK",
        name: "Alaska",
        n_cells: 314935,
        area_km2: 4239345.37113726,
        n_taxa: 2935,
        metrics: {},
      },
    ],
  },
  flower_default: {
    AK: [
      { component: "bird", score: 31.5829481713802 },
      { component: "coral", score: 16.7307766374964 },
      { component: "fish", score: 18.9728978214797 },
      { component: "invertebrate", score: 22.8381493804011 },
      { component: "mammal", score: 27.9090045093681 },
      { component: "primary producer", score: 15.5113319426193 },
      { component: "turtle", score: 18.3932458216487 },
      { component: "primprod", score: 5.63669830203109 },
    ],
  },
  palettes: {
    spectral_r: [
      "#5E4EA1",
      "#3287BD",
      "#66C1A5",
      "#ABDDA4",
      "#E5F498",
      "#FFFFBF",
      "#FEDF8B",
      "#FDAD60",
      "#F36C43",
      "#D43E4E",
      "#9E0041",
    ],
  },
  tables: {
    taxon: { href: "https://s3.example/marine-atlas/v9/app/taxon.parquet", bytes: 1, digest: "d1" },
    zone_taxon: {
      href: "https://s3.example/marine-atlas/v9/app/zone_taxon.parquet",
      bytes: 1,
      digest: "d2",
    },
  },
};

export const MANIFEST_OVERLAYS_V7 = [
  {
    overlay_key: "_outside_pra",
    subregion_key: "FULL",
    cog: "https://s3.example/cog/usa05/outside-pra.tif",
    colormap: "spectral_r",
  },
];
