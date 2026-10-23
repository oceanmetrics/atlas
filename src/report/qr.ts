// report/qr.ts -- atlas-7 step 2, header band: a QR of the permalink ("printed reports must lead
// back to the live one"). `qrcode-generator`'s only reached through this dynamic `import()` --
// never a static one (package.json's pinReasons) -- so it never sits on report.html's own critical
// path; the header shows plain text until it resolves.
let cached: { text: string; dataUrl: string } | null = null;

/**
 * A PNG data: URL for the permalink QR, memoised per URL so re-rendering the header (progressive
 * rendering) never re-runs the encoder. A data URL rendered through a plain `<img src>` -- never
 * `qrcode-generator`'s own `createSvgTag()` piped through Svelte's `{@html}` -- because this
 * document also prints a PLACE NAME the reporter typed (the header title, `#t=`) elsewhere on the
 * page, and this repo's rule is "no `{@html}` anywhere in the report" full stop, not "only where
 * the string happens to be trusted this time" (the seeded-fault list names exactly this mistake:
 * "a place name inserted as HTML in the document"). An `<img>` has no code-execution surface at
 * all, so this stays true regardless of what else this module is ever asked to render.
 */
export async function permalinkQrDataUrl(text: string): Promise<string> {
  if (cached?.text === text) return cached.dataUrl;
  const mod = await import("qrcode-generator");
  const qrcode = mod.default ?? (mod as unknown as typeof mod.default);
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const dataUrl = qr.createDataURL(4, 4);
  cached = { text, dataUrl };
  return dataUrl;
}
