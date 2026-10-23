// the storage host of this build, chosen ONCE (@oceanmetrics/catalog/storage): `data-om-storage` on <html> >
// `VITE_OM_STORAGE` > the package's DEFAULT_STORAGE_HOST (path-style S3 until the DNS cutover of
// storage.oceanmetrics.io flips it). Tiny and static-safe (the package module is pure, no dependency): catalog/base.ts
// and gazetteer/config.ts form their bases from it.

import {
  resolveStorageHost,
  rewriteStorageUrls,
  STORAGE_HOSTS,
  storageUrl,
} from "@oceanmetrics/catalog/storage";

/** the storage host of this build. */
export const STORAGE = resolveStorageHost(
  typeof document !== "undefined" ? document.documentElement.dataset.omStorage : undefined,
  import.meta.env?.VITE_OM_STORAGE as string | undefined,
);

/** the url of a bucket key (or prefix) on {@link STORAGE}. */
export const store = (key: string): string => storageUrl(key, { host: STORAGE });

/** `url` moved onto {@link STORAGE} when it names any storage host (S3 path-style or virtual-hosted,
 * storage.oceanmetrics.io, the workers.dev preview); any other url unchanged (decision D7: MST release
 * tables are rebased at read, never rewritten). */
export const onStorage = (url: string): string =>
  rewriteStorageUrls(url, { from: Object.values(STORAGE_HOSTS), to: STORAGE });
