// The GA4 measurement id, read from the build-time `VITE_GA_ID` variable -- never a literal in the
// repo. Unset or malformed resolves to "" (analytics.ts treats that as "GA leg off": no gtag call is
// ever made), mirroring `logUrl.ts`'s fail-closed shape for the Sheet leg. To re-enable analytics set
// the repository variable `VITE_GA_ID` (and forward it in .github/workflows/pages.yml).
const GA_ID_RE = /^G-[A-Z0-9]{6,}$/;

export function analyticsGaId(): string {
  const env = (import.meta.env.VITE_GA_ID as string | undefined)?.trim();
  return env && GA_ID_RE.test(env) ? env : "";
}
