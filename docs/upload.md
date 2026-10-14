# Uploads: from an untrusted file to a place

> **Status in OceanMetrics Atlas (WP11, 2026-10-14).** The upload parsers (`src/lib/geo/upload/`) and their refusal rules are current. Mentions of the scores boot, the release's cell table and `in_usa` cells (the "must touch the study area" rule) describe the upstream scores analysis; an uploaded place here is only held and summarised against the current layer (`docs/gazetteer-places.md`).

atlas-6 Deliverable 4, parsing half. Everything here lives under `src/lib/geo/upload/`, has no DOM
and no map, and is callable from a test. The panel (atlas-6 step 3's UI half) _calls_ it; this
document is that call's contract.

Decided by spike **S4** (`docs/spikes/S4.md`) and master plan **D8** + its addendum and ruling 2
(`2026-09-20 atlas app plan.md`). Fixtures: `tests/fixtures/upload/` (moved there from
`spikes/4/fixtures/` by `git mv`, per S4 rule 7 — the ground truth exists once).

## The pipeline

```
bytes + name
  │
  ├─ checkSize()        rule 1 ─ 10 MB; a zip: 200 entries and 50 MB UNCOMPRESSED, read from the
  │                              central directory, BEFORE extraction and before any import()
  ├─ detectFormat()              magic bytes decide; the file name is only a tie-break
  ├─ parseByFormat()    rule 2 ─ one dynamic import() per format, and one more for its library
  │                              → ParsedSource {format, fileName, features[], crs | null}
  └─ normalizeParsed()  rules 3-9
                                 → {ok: true, places[]} | {ok: false, refusal}
```

`normalizeUpload(input, options, deps)` is the whole thing in one call and is what the panel uses.

### The intermediate shape

Every parser returns the same `ParsedSource` (`types.ts`): raw features with raw ring coordinates,
their properties, and **the CRS the file itself declares**, or `null` when it declares none. The
parsers make no judgements at all — a point reaches the normalizer so that it can be refused with a
sentence rather than dropped inside a parser.

`DeclaredCrs.reprojected` is the one subtlety: `shpjs` has already converted the coordinates when
the zip carried a `.prj` (measured at 0.000000 m from GDAL/PROJ, S4), so its output is geographic
even though the declared CRS is projected. Nothing else here reprojects, because the app carries no
projection library.

## The rules, in order

| #   | rule                                                                              | refusal ids                                                                             |
| --- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1   | size ≤ 10 MB; zip ≤ 50 MB uncompressed, ≤ 200 entries, from the central directory | `fileTooLarge`, `zipUncompressedTooLarge`, `zipTooManyEntries`, `zipUnreadable`         |
| 2   | parse                                                                             | `unknownFormat`, `parseFailed`, `noFeatures`, `geopackage*`                             |
| 3   | polygons only — points and lines are refused, never buffered                      | `notPolygon`, `noGeometry`, `gpxTrackNotClosed`                                         |
| 4   | coordinates finite, in range, **not projected**                                   | `coordinatesNotFinite`, `coordinatesOutOfRange`, `projectedCoordinates`, `projectedCrs` |
| 5   | ≤ 50 000 vertices                                                                 | `tooManyVertices`                                                                       |
| 6   | rings closed, RFC 7946 winding, holes kept                                        | `ringTooShort`                                                                          |
| 7   | self-intersection, with the crossing's vertex indices                             | `selfIntersection`                                                                      |
| 8   | 180° through `unwrapRing()` and the seam join                                     | `spanTooWide`                                                                           |
| 9   | one place per feature (cap 20) or one union, as the CALLER asks                   | `tooManyFeatures`                                                                       |
| 10  | must touch the study area                                                         | **the caller's**, see below                                                             |

The first refusal in this order is returned — never a list. A person fixing a file fixes one thing
at a time, and a rule further down may only have fired because of the one above it.

### Rule 4, and why a declared CRS always wins

S4's measured facts: `shpjs` returns **raw metres silently** when the zip has no `.prj` (console
output literally `[]`); FlatGeobuf reports `EPSG:32610` correctly in its header and never
reprojects; `ST_Read` behaves the same; pasted WKT has no CRS concept at all. So:

- a **declared projected CRS** → `projectedCrs`, whatever the numbers look like;
- **no declared CRS** and |lat| > 90 or |lon| > 360 → `projectedCoordinates`, naming the value;
- a **declared geographic CRS** with an out-of-range value → `coordinatesOutOfRange`.

The longitude threshold is a whole turn, not half of one, on purpose: `usa05` _is_ a 0–360 grid,
`unwrapRing()` deliberately carries a Bering place out to 183, and a place round-tripped out of this
app's own link comes back unwrapped. The residual gap is stated in the source: a projected file
whose values happen to fall inside ±360 and ±90 still passes the magnitude test, which is why the
declared CRS is checked first and is authoritative.

### Rules 6–8, and the one deviation

They are _computed_ as close → unwrap → join-seam → rewind → self-intersection, because the other
order is meaningless: a shoelace sign taken across a 359.8° edge is not the ring's winding
(`unwrap.ts`: "the shoelace sign is only computed AFTER normalization"), and a ring written
`179.9 → -179.9` crosses itself in naive coordinates when it does nothing of the kind on the ground.
The order refusals are _reported_ in is still the table's, because steps 6 and 8 can only raise
`ringTooShort` and `spanTooWide`. The vertex indices in a `selfIntersection` message are on the
**normalized** ring (closed, unwrapped, RFC 7946 wound); the coordinates in the same message are the
locator that does not depend on that.

### Rule 8: the two spellings of the antimeridian

A file can write a place across 180° in exactly two ways, and they need two explicit rules —
never a heuristic invented here:

1. **Wrapped**, one ring jumping `178 → -177`. `unwrapRing()` (`src/lib/geo/unwrap.ts`), the rule
   shared with `msens::unwrap_ring()`, carries ∓360 onward. Read literally, that ring is the
   355°-wide complement: 284 000 cells on `global05` instead of 4 000.
2. **Split**, RFC 7946's own cut: two parts, one ending at exactly +180 and one starting at exactly
   −180. `unwrapRing()` cannot repair that — every edge in both halves is already short, and
   `unwrap.ts` documents why a carry must never run across rings. `seam.ts` does, in two steps
   that fire **only** when a vertex sits at +180 _and_ a vertex sits at −180: frame (carry western
   vertices a whole turn east), then stitch (rejoin the reversed shared edge the cut created and
   drop the now-collinear seam vertices). That is the cut run backwards, nothing more.

Both spellings normalize to the **same ring, vertex for vertex**, and to the same cells on both
grids (`tests/geo/upload/dateline.test.ts`).

### Rule 10 is the caller's

"Must touch the release's study area (`in_usa` cells)" needs the release's cell table, the boot
manifest and a version — none of which belongs in a pure geometry module. It is exposed as
`NormalizeOptions.studyArea`, a `(places) => Refusal | null` the panel supplies. When it is absent
the check simply does not run.

## Formats

| format           | parser                        | lazy cost (S4)        | what the normalizer has to add                                         |
| ---------------- | ----------------------------- | --------------------- | ---------------------------------------------------------------------- |
| GeoJSON          | none                          | —                     | everything                                                             |
| zipped shapefile | `shpjs@6.2.0`                 | 46.7 KB gzip          | the `.prj` gate: no `.prj` → refuse                                    |
| KML              | `@tmcw/togeojson@7.1.2`       | 3.8 KB                | — (KML is WGS84 by definition)                                         |
| GPX              | `@tmcw/togeojson@7.1.2`       | same package          | see below                                                              |
| FlatGeobuf       | `flatgeobuf@4.4.0`            | 11.4 KB               | reprojection refusal: the header is right, the reader does not convert |
| WKT              | hand-rolled, `parsers/wkt.ts` | 1.2 KB, no dependency | everything; WKT declares no CRS                                        |
| GeoPackage       | DuckDB `spatial`              | ~22.4 MB, third-party | consent, and the fallback                                              |

Every one is a dynamic `import()` — the parser module _and_ its library.
`tests/geo/upload/lazyImports.test.ts` reads the source and fails on a static import;
`npm run size-budget` fails the build if one ever reaches the entry's static graph.

**GPX has no polygon.** The format records waypoints, routes and tracks — S4 never exercised it, and
adding the fixture is what turned this up. A track whose last point repeats its first is read as a
ring (that invents no coordinate); one that does not close is refused by name, because closing it
would draw the edge that was never travelled and buffering it is forbidden outright.

**GeoPackage is prompted, lazy and best-effort** (S4 rule 2, plan D14). Dropping a `.gpkg` asks once,
naming the size (22.4 MB) and the third-party host (`extensions.duckdb.org`, which nothing else in
this app contacts). A decline is `geopackageDeclined`; a blocked host is `geopackageUnavailable`
carrying the real SQL error; a GeoPackage with no vector layer at all (raster tiles, or a plain
attribute table) is meant to be `geopackageNoFeatureTable`, but see the paragraph below — today it
falls through to the generic `parseFailed`. Every one of these offers "convert to GeoJSON or
FlatGeobuf". The DuckDB connection is **injected** (`GeoPackageRuntime`), so this module never
imports `@duckdb/duckdb-wasm` — the real one, `lib/geo/upload/engineRuntime.ts`, adapts the app's
own `Engine` (`lib/engine/engine.ts`'s `registerFile`/`dropFile` + its existing `exec`), so a `.gpkg`
is read through the SAME DuckDB connection the scores boot, not a second one (Q2, 0.10.52 — before
that, `UploadPanel.svelte` hardcoded `runtime: null` and every `.gpkg` was refused unconditionally
since 0.10.47).

**Two things this parser asks DuckDB, and why they needed a real fix, not just a wired-up mock**
(both measured against the real app in `e2e/places.upload-geopackage.spec.ts`, Q2 — the existing
mocked unit tests could not have caught either, because a mock never has a real
`custom_extension_repository` or a real SQLite file-I/O layer to disagree with):

1. **`INSTALL spatial` 404s against the app's own mirror unless the mirror setting is reset first.**
   `Engine.boot()` always points `custom_extension_repository` at the app's same-origin
   `duckdb-ext/` mirror, to protect the CORE parquet path from an unreachable
   `extensions.duckdb.org` turning into an uncatchable WASM crash (S3's rule). `spatial` is
   deliberately NOT on that mirror (S3/S4's shared-hosting rule) — so that SAME session-wide
   setting, left in place, makes `INSTALL spatial` look for it at the mirror too, where it 404s,
   instead of ever reaching the real host. Fixed by capturing the mirror value
   (`current_setting('custom_extension_repository')`), `RESET`-ing it for exactly the
   `INSTALL`/`LOAD spatial` pair, then restoring it — even on failure — so a later
   `read_parquet()`/`LOAD` in the SAME session stays exactly as protected as before.
2. **The declared-CRS and no-feature-table checks (`sqlite_scan()`) cannot open an uploaded file at
   all, even with `sqlite_scanner` installed.** `sqlite_scan()`'s own SQLite engine does its own
   file I/O rather than going through DuckDB's virtual filesystem the way `ST_Read` does, so it
   reports `Unable to open database` against a file registered only via duckdb-wasm's
   `registerFileBuffer` — measured, not hypothetical (an earlier attempt to also `INSTALL
sqlite_scanner FROM` the real host, mirroring fix 1, made no difference: the extension loads
   fine, the open still fails). Both checks were ALREADY written to tolerate this ("an older
   GeoPackage, or a build without sqlite_scan" — their own pre-Q2 comment), so nothing crashes: a
   projected `.gpkg` is still refused, just by `normalizeParsed`'s magnitude test
   (`projectedCoordinates`) rather than the declared-CRS rule (`projectedCrs`); a
   no-feature-layer `.gpkg` still refuses, just via `ST_Read`'s own failure turning into the
   generic `parseFailed` rather than `geopackageNoFeatureTable`. Both specific rules remain real,
   tested code — against a mocked runtime — for the day a future duckdb-wasm closes this gap, or
   this app moves an upload's bytes through OPFS instead of a bare `registerFileBuffer`.

## Refusal copy

Every message lives in `messages.ts` and states three things: what happened (with the number or
name that decided it), why, and the fix. None says "invalid file" —
`tests/geo/upload/messages.test.ts` drives `allRefusalSamples()` and fails on that word and six
others. Add a message by adding it to `allRefusalSamples()` in the same edit; that is what keeps the
gate over _all_ of them rather than over a remembered list.

## Names

Three naming options, and `normalizeParsed()` honours all three (Q2 fix — before it, `nameProperty`
was a real, tested capability that the ONE caller, `UploadPanel.svelte`, never actually used, so
every upload was named from the file regardless of what the file itself said about its own
features):

1. **feature name attribute** — an explicit `nameProperty: "NAME"` forces that ONE property; leaving
   the option out altogether (the default) instead **auto-detects** it via `detectNameProperty()`:
   the first of `name`/`title`/`label` (matched case-insensitively, so KML's own `<name>` and a
   `NAME` DBF field both count) the file's first feature carries a non-empty value for, applied to
   every feature. An explicit `nameProperty: null` opts back out and forces the file name.
2. **file-derived name** — `fallbackName`, or `baseName(file)` when it is absent (the default): used
   whenever no name property is chosen/detected, is empty, or the source is a union of features.
3. **numbering** — a multi-feature file (`multiFeature: "perFeature"`) appends ` 1`, ` 2`, … to the
   fallback for any feature without its own name; a single feature or a union gets no suffix.

Only the chosen property survives, and it is **plain text, not escaped**: control characters are
removed, whitespace runs collapse, 60 characters max, and nothing else changes. A feature named
`<img src=x onerror=alert(1)>` comes back as exactly those 28 characters, asserted byte for byte in
`tests/geo/upload/names.test.ts`. The defence is that the panel binds it as text (Svelte `{name}`);
escaping here would be a second encoding that renders visibly as `&lt;img …&gt;`.

## What the panel calls

```ts
import { normalizeUpload } from "$lib/geo/upload/normalize";

const result = await normalizeUpload(
  { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) },
  {
    multiFeature: "perFeature", // or "union" — the panel ASKS once; this module never decides
    // nameProperty left out -> auto-detects name/title/label (the default, Q2); pass an explicit
    // string to force ONE property, or `null` to force the file name and skip detection.
    fallbackName: "Uploaded place",
    studyArea: (places) => (touchesInUsa(places) ? null : outsideUsWaters()),
  },
  {
    // browsers have DOMParser; only node needs this
    // the real runtime: geoPackageRuntime(() => dataEngine().then((ctx) => ctx.engine)), Q2
    geoPackage: { consent: askOnce, runtime: engineRuntime },
  },
);
if (!result.ok)
  showRefusal(result.refusal); // {rule, what, why, fix}
else addPlaces(result.places); // {name, geometry, bbox, vertices, sourceIndex}
```

`place.geometry` is already what `placeCodec.encodeGeometry()` accepts and what
`coverage.cellsInPolygon()` consumes — unwrapped, closed, RFC 7946 wound — with no further
conditioning by either. `place.bbox` is dateline-aware.

The panel does not need to do anything for the common case — leaving `nameProperty` out gets
auto-detection for free, as above. To let the person CHOOSE among the file's own properties (a
picker UI, not built as of Q2), read `ParsedSource.features[i].properties` from a `parseByFormat()`
call, or simply normalize twice; parsing is cheap once the chunk is loaded.

## Fixtures

Moved from `spikes/4/fixtures/` (never copied), plus the three atlas-6 adds:

| fixture              | formats                                        | what it is for                                                                                                       |
| -------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `gulf_rectangle`     | zip, kml, fgb, gpkg, wkt, **geojson**, **gpx** | the control: 6 000 cells on both grids, identical from every format                                                  |
| `aleutian_dateline`  | zip, kml, fgb, gpkg, wkt                       | 180°: 4 000 cells on both grids, one 5°-wide bbox                                                                    |
| `multipolygon`       | zip, kml, fgb, gpkg, wkt                       | two parts stay two: 800 cells                                                                                        |
| `utm_zone`           | zip, fgb, gpkg, wkt                            | reprojection: the zip passes and lands off Point Arena; the fgb is `projectedCrs`; the wkt is `projectedCoordinates` |
| `utm_zone_noprj`     | zip                                            | the silence: `projectedCoordinates`, the regression this gate is named after                                         |
| `coastline_40k`      | zip, kml, fgb, gpkg, wkt                       | 40 000 vertices, refused for its _shape_ (under the 50 k cap)                                                        |
| **`open_track.gpx`** | gpx                                            | the other half of GPX: refused by name                                                                               |

`fixtures_manifest.json` is the R-computed ground truth that travelled with them, and
`generate_fixtures.R` regenerates the five.

The `gpkg` column above is real, but only reachable through a REAL DuckDB connection (no
`sqlite_scanner`/`spatial` in Node), so `fixtures.test.ts`'s vitest-level assertions skip it —
`geoPackage` deps are omitted there on purpose, which makes `parseGeoPackage` throw
`geopackageNoRuntime` immediately for any `.gpkg` name passed through it. The real read is proved by
`e2e/places.upload-geopackage.spec.ts` instead, against five small, hand-built (`ogr2ogr`, no
`SPATIAL_INDEX`) fixtures purpose-made for it — `gpkg_polygon`, `gpkg_multipolygon`, `gpkg_point`
(refused, `notPolygon`), `gpkg_projected` (EPSG:32610, refused `projectedCrs`) and
`gpkg_no_features` (refused `geopackageNoFeatureTable`) — committed at ~74-90 KB each (GDAL's
GeoPackage schema floor: ~19 required tables/indexes at one 4 KB SQLite page each before a single
feature is written, the same floor the five fixtures above already sit at).

Hostile inputs are **generated in `tests/geo/upload/hostile.ts`**, never committed: a zip whose
central directory declares 60 MB (a real bomb in 300 bytes — what makes it one is the declared size,
not a payload), a 300-entry zip, a bow-tie, a point-only and a line-only GeoJSON, the `<img …>`
name, and the Aleutian pair written both ways.

## Seeded faults

Every gate here ships with a fault that turns it red — a check that cannot fail is not a check.
Each was applied, run and reverted on 2026-09-22; the counts are what `npx vitest run tests/geo/upload`
reported (244 tests green unseeded).

| fault                                                               | red                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checkSize()` moved to after `parseByFormat()` in `normalizeUpload` | **2 failed** — `rules.test.ts` "refuses a zip whose OWN INDEX declares 60 MB — before a byte is unpacked", "refuses a 300-entry zip"                                                                                                                    |
| `rewind()` returns its rings untouched                              | **4 failed** — `rules.test.ts` "turns a CLOCKWISE exterior ring counterclockwise", "keeps a hole, and gives it the OPPOSITE winding"; `fixtures.test.ts` "all four formats produce the identical ring"; `dateline.test.ts` "normalize to the SAME ring" |
| the `findSelfIntersection` call removed                             | **2 failed** — `rules.test.ts` "refuses a bow-tie and reports the crossing's coordinates and vertex indices", "catches a hole that cuts through its own outer ring"                                                                                     |
| `unwrapRing()` replaced by a naive `lon < 0 ? lon + 360 : lon`      | **4 failed** — `dateline.test.ts` "normalize to the SAME ring", "RFC 7946 halves touching ±180 are joined into one ring", "leaves an ordinary mid-Pacific place alone"; `rules.test.ts` the bow-tie                                                     |
| `plainText()` escaping `&`, `<` and `>`                             | **3 failed** — `names.test.ts` "comes back byte-identical, NOT escaped", "survives a round trip through JSON unchanged", "leaves every other character alone"                                                                                           |
| a static `import shp from "shpjs"` in `parsers/shapefile.ts`        | **3 failed** — `lazyImports.test.ts` "shapefile.ts imports no pinned parser statically", "each pinned parser IS reached, dynamically…", "nothing anywhere under upload/ statically imports a pinned parser"                                             |

Worth recording about the fourth: the naive ±360 shift happens to give the _right answer_ for the
committed Aleutian fixtures (`-177 + 360 = 183`), so the fixture assertions alone would not have
caught it. What catches it is the RFC 7946-split half of the pair and an ordinary mid-Pacific place
(`-170 … -160`), which the naive rule silently moves to `190 … 200`. That is why the dateline pair
is a test of its own and not a line inside the fixture sweep.
