# The release COGs' side table: what a first lookup costs (build week 6, step 5)

`marine-atlas/tables/cog_3857.parquet` (the shared table: 57,279 rows, one per original COG, keyed by `content_hash`) and
`marine-atlas/v7/tables/cog_3857.parquet` (37,337 rows) say where a COG's EPSG:3857 copy is and carry its band
statistics and 32-bucket histogram (`src/lib/release/cog3857.ts`, `resolveCog3857`; the pipeline writer is
`pipeline/atlas_pipeline/cog3857.py` `write_table`). Every drawn COG asks the shared table for its row once.
The bar: **a first lookup under 100 KB** (titiler's `/cog/statistics` and `/cog/info` for the same COG answered in a few KB).

## Before: 620 KB per first lookup

Measured 2026-10-23 on the live shared table (Node, hyparquet 1.31.3, `Range` reads over the S3 path-style URL):

| layout / open                                                      | open                           | one lookup (1 row group) | first lookup  |
| ------------------------------------------------------------------ | ------------------------------ | ------------------------ | ------------- |
| 512-row groups, hyparquet's default open (512 KiB initial tail)    | 524,288 B, 1 request           | 89,136 B                 | **613,424 B** |
| the same, `initialFetchSize` 256 KiB                               | 262,144 B, 1 request           | 89,136 B                 | 351,280 B     |
| the same, `initialFetchSize` 64 KiB (the footer needs a second)    | 65,536 + 161,281 B, 2 requests | 89,136 B                 | 315,953 B     |
| the same, trailer then exactly the footer, the reader's 10 columns | 8 + 226,809 B, 2 requests      | 68,569 B (mean of 30)    | 295,386 B     |

The footer is 226,809 B: 24 leaf columns of chunk metadata (their paths, encodings, sizes and offsets) in each of the 112
row groups, about 2 KB a group, whatever the statistics (statistics on `content_hash` only was already done). A row group
of 512 rows is 89 KB because the 32 histogram buckets are 40 KB of it.

Row-group size alone cannot reach the bar: the footer falls and the group grows in proportion. Footer + one group
(only the columns the reader uses, no dictionaries, no stored Arrow schema; mean over the groups): 512 rows 190 + 54 = 244 KB, 1,024 rows
97 + 105 = 202 KB, 2,048 rows 49 + 209 = 258 KB, 4,096 rows 25 + 414 = 438 KB; with pyarrow's default dictionaries 1,024 rows is
247 KB and 2,048 rows 308 KB (59 KB footer, 249 KB group; 345 KB for all 24 columns). Dropping the per-column chunk metadata
the reader never uses is not an option the writer has: the Parquet footer must describe every column of every group.

## After: 47 KB per first lookup

`write_table` now writes **row groups of 8,192 rows (7 groups), 128-row data pages, the page index, no dictionary pages**,
zstd, statistics on `content_hash` only: the same rows in the same order (asserted on both live tables before upload) in a
9.46 MB file (was 10.58 MB). The footer is **16,867 B**. The reader (`open`, `readCog3857Row`):

1. the 8-byte trailer, one request (`Range: bytes=-8`; its `Content-Range` is the file's length, so no HEAD);
2. exactly the footer, one request, parsed with `parquetMetadata`: **two requests, footer + 8 bytes**, once per page per table;
3. a lookup: hyparquet's `usePageIndex` reads the column index and offset index of `content_hash` and the offset indexes of
   the other nine columns the row needs (three ranges), skips the row groups whose
   `content_hash` min/max exclude the hash and the pages whose column-index min/max do, and reads one 128-row page of each of
   the 17 leaf columns of the ten columns `rowFromRecord` uses (the md5s, byte counts, projection codes and `created` are not
   read).

Live, through the reader itself (`readCog3857Row(sharedTableUrl(), hash)`, a fetch wrapper counting response bytes):

| lookup                                                    | requests | bytes                              | time                                     |
| --------------------------------------------------------- | -------- | ---------------------------------- | ---------------------------------------- |
| first of the page (`005d8477…`)                           | 22       | **46,352 B** (8 + 16,867 + 29,477) | 0.60 s warm, 1.64 s cold connection      |
| next hash of the same page                                | 20       | 29,477 to 31,094 B                 | 0.29 to 0.44 s                           |
| 30 hashes sampled from the table (local file, same reads) | 20       | mean 30,483 B, max 31,204 B        | first lookup mean 47,366 B, max 48,087 B |

The bar is met with room: 47 KB against 100 KB, and against 620 KB before (13 times fewer bytes).

What it costs instead:

- **Requests.** 22 for the first lookup, 20 for each next one (17 small page reads and 3 for the indexes), against 2 and 1.
  They go out in parallel, but a lookup is now four sequential round trips (trailer, footer, indexes, pages) where it was two.
  A browser opens 6 connections per host to S3 (HTTP/1.1), so 17 page reads take about three waves. Not yet measured in a
  browser against the old layout; the times above are from Node on the laptop.
- **One CORS preflight.** `Range: bytes=-8` (a suffix range) is not a CORS-safelisted request header value, so the browser
  sends one `OPTIONS` first; the bucket's rule allows it and caches it for an hour (`MaxAgeSeconds` 3600).
- **Each lookup re-reads the page indexes** (about 14 KB of its 30 KB); only the footer is kept per page.
- **The footer grows with the table**, about 2.4 KB per 8,192 rows: the first lookup stays under 100 KB up to about 230,000
  rows (28 groups). Past that, raise `ROW_GROUP_ROWS` (the page size stays) or cache the page indexes.

The published objects (both rewritten with `aws s3 cp --content-type application/vnd.apache.parquet`, additive; the bucket is
versioned and the previous versions are kept):

| key                                       | rows   | layout                                       | footer   | size      | previous version id (512-row groups) |
| ----------------------------------------- | ------ | -------------------------------------------- | -------- | --------- | ------------------------------------ |
| `marine-atlas/tables/cog_3857.parquet`    | 57,279 | 7 groups of 8,192, 128-row pages, page index | 16,867 B | 9,462,641 | `hpV8qScFOSV5TdvAENWJXBhqzBrksZ5I`   |
| `marine-atlas/v7/tables/cog_3857.parquet` | 37,337 | 5 groups of 8,192, 128-row pages, page index | 12,824 B | 5,660,464 | `tH43b_uYhhj4388U.X1AogxKPFGVarDK`   |

A reader of the old kind (hyparquet's default open and `filter`, no page index) still reads the new files: it finds the
footer in its 512 KiB tail and reads one 8,192-row group (about 1.2 MB). Atlas builds before this change are the only such
readers.

## Tests

`tests/release/cog3857.test.ts`: the open is two reads totalling footer + 8 bytes; the footer is read once per URL; the lookup
reads under half of a group's bytes (and a quarter of the file); a server that ignores `Range`, one that hides
`Content-Range`, a 403. Fixtures in `tests/fixtures/release/` are in the new layout (the v7 one at 512-row groups and 64-row pages
to have two groups and eight pages each). `pipeline/tests/test_cog3857.py`: the group size and min/max, the page index and
128-row pages, no dictionary, the footer under 64 KB at 8 groups. Seeded faults `side-table-no-page-index` and
`side-table-wide-footer-read`.
