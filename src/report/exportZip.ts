// report/exportZip.ts -- atlas-7 step 3, Export 3 (the data package ZIP). A thin wrapper: every
// FILE comes from exportFiles.ts's pure builder (unit-tested there); this module only encodes them
// with `fflate`, which is why it is never a static import (package.json's pinReasons) -- reached
// only from `Report.svelte`'s export button, so `fflate`'s few KB never sit on report.html's own
// critical path.
import type { ReportModel, ReportPlaceInput } from "../lib/report/model";
import { buildDataPackageFiles } from "./exportFiles";

export async function downloadDataPackage(
  model: ReportModel,
  places: readonly ReportPlaceInput[],
): Promise<void> {
  const { zipSync, strToU8 } = await import("fflate");
  const files = buildDataPackageFiles(model, places);
  const zipInput: Record<string, Uint8Array> = {};
  for (const f of files) zipInput[f.path] = strToU8(f.content);
  const zipped = zipSync(zipInput, { level: 6 });
  const blob = new Blob([zipped], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = `${model.header.fileStem}.zip`;
    a.click();
  } finally {
    // revoke on a tick: Firefox/WebKit have been observed to drop a same-tick revoke before the
    // click's own download actually starts (the same defensive pattern TablePanel.svelte's CSV
    // export does NOT need, because that Blob is tiny and its URL is revoked synchronously there
    // without ever having shown a problem -- this one is a multi-file archive, so the extra
    // caution costs nothing).
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
