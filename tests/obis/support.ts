// Shared fixtures of the OBIS layer's tests: the trimmed published collection, its Items, and a fetch that serves
// tests/fixtures/obis_h3/ as the release (Range and suffix ranges, 404 for a missing file), counting requests.
import { readFileSync, existsSync } from "node:fs";
import { parseH3, type H3Spec } from "../../src/lib/catalog/h3";
import type { StacCollection, StacItem } from "../../src/lib/catalog/types";

export const FIX = "tests/fixtures/obis_h3/";
export const REL = "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/obis-h3/v20261012/";
export const COLLECTION_URL =
  "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/obis-h3/collection.json";

export const collection = (): StacCollection =>
  ({
    ...JSON.parse(readFileSync(`${FIX}collection.json`, "utf8")),
    "atlas:url": COLLECTION_URL,
  }) as StacCollection;
export const spec = (): H3Spec => parseH3(collection())!;

/** the Item of `all` or an EOV (an EOV other than fish is the fish Item with its key replaced) */
export function item(id: string): StacItem {
  const src = id === "all" ? "all" : "fish";
  const raw = readFileSync(`${FIX}items/${src}.json`, "utf8");
  const json = JSON.parse(src === "fish" ? raw.replaceAll("fish", id) : raw);
  return { ...json, "atlas:url": `${REL}items/${id}.json` } as StacItem;
}

/** a local file of the fixture release as an ArrayBuffer */
export function buffer(path: string): ArrayBuffer {
  const b = readFileSync(`${FIX}${path}`);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

/** a fetch over the fixture release (urls under REL), honouring Range */
export function localFetch(stats: { requests: number; bytes: number } = { requests: 0, bytes: 0 }) {
  const f = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    stats.requests++;
    const path = decodeURIComponent(url.replace(REL, ""));
    const file = `${FIX}${path}`;
    if (!url.startsWith(REL) || !existsSync(file)) return new Response("", { status: 404 });
    const body = readFileSync(file);
    const range =
      new Headers(init?.headers).get("range") ??
      (input instanceof Request ? input.headers.get("range") : null);
    const m = /bytes=(\d*)-(\d*)/.exec(range ?? "");
    if (!m) {
      stats.bytes += body.byteLength;
      return new Response(body, {
        status: 200,
        headers: { "content-length": String(body.byteLength) },
      });
    }
    let a: number;
    let b: number;
    if (m[1] === "") {
      a = Math.max(0, body.byteLength - Number(m[2]));
      b = body.byteLength - 1;
    } else {
      a = Number(m[1]);
      b = m[2] ? Math.min(Number(m[2]), body.byteLength - 1) : body.byteLength - 1;
    }
    const part = body.subarray(a, b + 1);
    stats.bytes += part.byteLength;
    return new Response(part, {
      status: 206,
      headers: {
        "content-range": `bytes ${a}-${b}/${body.byteLength}`,
        "content-length": String(part.byteLength),
      },
    });
  };
  return Object.assign(f, { stats });
}
