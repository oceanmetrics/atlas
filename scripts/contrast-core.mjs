// atlas-3 gate: every text/surface token pair >= 4.5:1 and every non-text pair >= 3:1, in BOTH
// themes. The pairs are NOT a list kept in this script — they are read from the `@contrast` block
// inside the instance's tokens.css, so the contract lives next to the tokens it constrains and a
// token cannot be added without being classified (an unclassified color token is a FAIL).
//
// Why a "contrast basis": a glass panel is `color-mix(...)` over the map, and a ratio can only be
// computed between two opaque colors. So every translucent surface has an opaque basis token
// (--surface-panel) that the checker uses and the CSS mixes from. A paired token whose value is not
// an opaque color after var() resolution is a FAIL, never a silent skip.

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const TEXT_MIN = 4.5;
const NONTEXT_MIN = 3;

/** @param {string} hex @returns {[number, number, number]} */
export function parseHex(hex) {
  const h = hex.trim().toLowerCase();
  if (!HEX_RE.test(h)) throw new Error(`not an opaque hex color: "${hex}"`);
  const full = h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h;
  return [
    parseInt(full.slice(1, 3), 16),
    parseInt(full.slice(3, 5), 16),
    parseInt(full.slice(5, 7), 16),
  ];
}

/** WCAG 2.1 relative luminance. @param {string} hex */
export function luminance(hex) {
  const [r, g, b] = parseHex(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio, rounded to 2 decimals (the way a report reads it). */
export function contrastRatio(a, b) {
  const [la, lb] = [luminance(a), luminance(b)];
  const ratio = (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  return Math.round(ratio * 100) / 100;
}

/**
 * Parse the `@contrast` manifest out of the CSS *before* comments are stripped.
 * @param {string} css
 * @returns {{ pairs: {kind: string, token: string, surfaces: string[]}[], exempt: Map<string,string> }}
 */
export function parseManifest(css) {
  const block = css.match(/\/\*\s*@contrast([\s\S]*?)\*\//);
  if (!block) throw new Error("tokens.css has no /* @contrast ... */ manifest block");
  const pairs = [];
  const exempt = new Map();
  for (const raw of block[1].split("\n")) {
    const line = raw.replace(/^\s*\*?\s?/, "").trim();
    const m = line.match(/^(text|nontext|exempt)\s+(--[\w-]+)\s*:\s*(.+)$/);
    if (!m) continue;
    const [, kind, token, rest] = m;
    if (kind === "exempt") exempt.set(token, rest.trim());
    else
      pairs.push({
        kind,
        token,
        surfaces: rest
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });
  }
  return { pairs, exempt };
}

/**
 * Parse custom properties per theme. `:root` is the shared base; a selector naming `navy` or
 * `paper` overrides it for that theme.
 * @param {string} css
 * @returns {{ base: Map<string,string>, navy: Map<string,string>, paper: Map<string,string> }}
 */
export function parseThemes(css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const base = new Map();
  const navy = new Map();
  const paper = new Map();
  // skip at-rule preludes (@media ...) so only real declaration blocks are read
  for (const m of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    if (selector.startsWith("@")) continue;
    const target = selector.includes("paper") ? paper : selector.includes("navy") ? navy : base;
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      target.set(d[1], d[2].trim());
    }
  }
  return { base, navy, paper };
}

/**
 * Resolve one token in one theme, following var() chains.
 * @returns {string} the resolved value (may still be a non-color, e.g. "12px")
 */
export function resolveToken(token, themeMap, baseMap, seen = new Set()) {
  if (seen.has(token)) throw new Error(`var() cycle at ${token}`);
  seen.add(token);
  const value = themeMap.get(token) ?? baseMap.get(token);
  if (value === undefined) throw new Error(`token ${token} is not defined`);
  const ref = value.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  return ref ? resolveToken(ref[1], themeMap, baseMap, seen) : value;
}

function isColorish(value) {
  return (
    HEX_RE.test(value) ||
    /^(rgb|hsl|oklch|lab|color-mix)\(/i.test(value) ||
    /^(white|black|transparent|currentcolor)$/i.test(value)
  );
}

/**
 * Run the whole contract over a tokens.css source.
 * @param {string} css
 * @returns {{ results: {theme:string,kind:string,token:string,surface:string,ratio:number,min:number,ok:boolean}[],
 *            failures: string[] }}
 */
export function checkContrast(css) {
  const { pairs, exempt } = parseManifest(css);
  const { base, navy, paper } = parseThemes(css);
  const results = [];
  const failures = [];

  for (const [themeName, themeMap] of [
    ["navy", navy],
    ["paper", paper],
  ]) {
    const value = (token) => resolveToken(token, themeMap, base);

    for (const { kind, token, surfaces } of pairs) {
      for (const surface of surfaces) {
        const min = kind === "text" ? TEXT_MIN : NONTEXT_MIN;
        let fg, bg;
        try {
          fg = value(token);
          bg = value(surface);
        } catch (e) {
          failures.push(`[${themeName}] ${token} on ${surface}: ${e.message}`);
          continue;
        }
        if (!HEX_RE.test(fg) || !HEX_RE.test(bg)) {
          failures.push(
            `[${themeName}] ${token} on ${surface}: not an opaque hex pair (${fg} / ${bg}) — a ` +
              `paired token must resolve to an opaque color (use a "-basis" token for glass)`,
          );
          continue;
        }
        const ratio = contrastRatio(fg, bg);
        const ok = ratio >= min;
        results.push({ theme: themeName, kind, token, surface, ratio, min, ok });
        if (!ok) {
          failures.push(
            `[${themeName}] ${token} (${fg}) on ${surface} (${bg}): ${ratio.toFixed(2)}:1 < ` +
              `${min}:1 (${kind})`,
          );
        }
      }
    }

    // coverage: no color token may escape the contract
    const subjects = new Set(pairs.map((p) => p.token));
    const surfaces = new Set(pairs.flatMap((p) => p.surfaces));
    for (const token of new Set([...base.keys(), ...themeMap.keys()])) {
      if (subjects.has(token) || surfaces.has(token) || exempt.has(token)) continue;
      let resolved;
      try {
        resolved = resolveToken(token, themeMap, base);
      } catch {
        continue; // a non-color token that references something theme-specific; the pairs cover colors
      }
      if (isColorish(resolved)) {
        failures.push(
          `[${themeName}] ${token} (${resolved}) is a color token with no contrast pair and no ` +
            `exemption — add it to the @contrast block in tokens.css`,
        );
      }
    }
  }

  return { results, failures };
}

export const THRESHOLDS = { TEXT_MIN, NONTEXT_MIN };
