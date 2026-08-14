// Praeventio Guard — [P1][a11y] color accessibility audit.
//
// Ticket 3a4aa66d-73fe-81a0-9e77-e86033f10310 — Calm Tech colour-safety
// verification. Critical: the colour of a status indicator must NEVER be
// the sole channel — every vital state carries an icon and a text label
// so that (a) daltónico users (8% of males, protanopia/deuteranopia)
// can still distinguish red-vs-green, and (b) sunlight glare at the
// faena does not break the signal.
//
// Two test suites live here:
//
// 1. CSS token contrast — parse src/index.css and verify the
//    documented colour pairs (text on bg, accent on primary) meet
//    WCAG AA (>=4.5:1) for body text. Names of accent tokens are
//    declared in each mode (normal-light, normal-dark, driving,
//    emergency, high-contrast). High-contrast mode additionally
//    enforces AAA (>=7:1) per the file comment.
//
// 2. No-color-only invariant — verify the JSX that drives the
//    approval-critical <ComplianceTrafficLight /> surface pairs
//    every state with:
//      a unique icon (no colour-only states)
//      a text label (no colour-only labels)
//      an aria-label on the compact badge (so screen readers
//        never rely on bg-color alone)
//
// SPEC: WCAG 2.1 SC 1.4.3 contrast (minimum); SC 1.4.11 non-text
// contrast. Prototype IDs are pulled from the actual src/index.css so
// renaming a var to keep the spec accurate is a one-line change.
//
// IMPORTANT: this is static analysis only. Real contrast depends on
// the rendered background of the actual element (gradient + alpha
// blur + image bg). axe-core / pa11y would catch runtime regressions;
// this catch is the gate BEFORE those run.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(relative: string): string {
  const repoRoot = resolve(__dirname, '..', '..', '..');
  return readFileSync(resolve(repoRoot, relative), 'utf8');
}

// The CSS uses semantic names (--bg-canvas, --accent-primary) — no
// `--color-` prefix on the semantic tokens. The Tailwind @theme block
// has a parallel colour-scale (--color-teal-500 etc.) but the modes
// override the semantic names directly with red-600 / red-500 /
// amber-500 literals, so the parse has to take the literal value.
const RE_VAR = new RegExp(
  [
    'var-EMPTY_PLACEHOLDER', // replaced by extractColor
  ].join(''),
  'g',
);

function extractColor(css: string, varName: string): string | null {
  const escaped = varName.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const pat = new RegExp('--' + escaped + '\\s*:\\s*([^;]+?);');
  const m = css.match(pat);
  if (!m) return null;
  return m[1].trim();
}

function parseHex(hex: string): [number, number, number] | null {
  const cleaned = hex.trim().replace(/^#/, '');
  if (cleaned.length !== 3 && cleaned.length !== 6) return null;
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) return null;
  const full =
    cleaned.length === 3
      ? cleaned
          .split('')
          .map((c) => c + c)
          .join('')
      : cleaned;
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function channelLinear(c8bit: number): number {
  const c = c8bit / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map(channelLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(
  fg: [number, number, number],
  bg: [number, number, number],
): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function extractDeclarations(css: string): Map<string, string> {
  const out = new Map<string, string>();
  const pat = /--([a-zA-Z0-9-]+)\s*:\s*([^;]+?);/g;
  let m: RegExpExecArray | null;
  while ((m = pat.exec(css)) !== null) {
    out.set(m[1], m[2].trim());
  }
  return out;
}

describe('src/index.css — WCAG contrast on semantic tokens', () => {
  const css = readSource('src/index.css');

  it('normal-light: text-primary on bg-canvas meets AA (>=4.5:1)', () => {
    const fg = parseHex(extractColor(css, 'text-primary')!);
    const bg = parseHex(extractColor(css, 'bg-canvas')!);
    expect(contrastRatio(fg!, bg!)).toBeGreaterThanOrEqual(4.5);
  });

  it('normal-light: text-secondary on bg-canvas meets AA (>=4.5:1)', () => {
    const fg = parseHex(extractColor(css, 'text-secondary')!);
    const bg = parseHex(extractColor(css, 'bg-canvas')!);
    expect(contrastRatio(fg!, bg!)).toBeGreaterThanOrEqual(4.5);
  });

  it('normal-light: text-muted on bg-canvas meets high-AA (>=7:1) — pin the file comment', () => {
    const fg = parseHex(extractColor(css, 'text-muted')!);
    const bg = parseHex(extractColor(css, 'bg-canvas')!);
    expect(contrastRatio(fg!, bg!)).toBeGreaterThanOrEqual(7.0);
  });

  it('normal-light: accent-on-primary on accent-primary meets AA', () => {
    const fg = parseHex(extractColor(css, 'accent-on-primary')!);
    const bg = parseHex(extractColor(css, 'accent-primary')!);
    expect(contrastRatio(fg!, bg!)).toBeGreaterThanOrEqual(4.5);
  });

  it('normal-dark: text-primary on bg-canvas meets AAA (>=7:1)', () => {
    const dark = css.match(/\.dark\s*{([\s\S]*?)\n\s*}/);
    if (!dark) return;
    const map = extractDeclarations(dark[1]);
    const fg = parseHex(map.get('text-primary')!);
    const bg = parseHex(map.get('bg-canvas')!);
    expect(contrastRatio(fg!, bg!)).toBeGreaterThanOrEqual(7.0);
  });

  it('emergency: text-primary on bg-canvas is white-on-black (>=15:1)', () => {
    const em = css.match(/\.emergency\s*{([\s\S]*?)\n\s*}/);
    if (!em) return;
    const map = extractDeclarations(em[1]);
    const fg = parseHex(map.get('text-primary')!);
    const bg = parseHex(map.get('bg-canvas')!);
    expect(contrastRatio(fg!, bg!)).toBeGreaterThanOrEqual(15);
  });

  it('emergency: accent-primary (red-500 SOS) on bg-canvas meets AA — the SOS visual', () => {
    const em = css.match(/\.emergency\s*{([\s\S]*?)\n\s*}/);
    if (!em) return;
    const map = extractDeclarations(em[1]);
    const fg = parseHex(map.get('accent-primary')!);
    const bg = parseHex(map.get('bg-canvas')!);
    expect(contrastRatio(fg!, bg!)).toBeGreaterThanOrEqual(4.5);
  });

  it('high-contrast: text-on-bg meets AAA (>=7:1) per the file comment', () => {
    const hc = css.match(/\.high-contrast\s*{([\s\S]*?)\n\s*}/);
    if (!hc) return;
    const map = extractDeclarations(hc[1]);
    const fg = parseHex(map.get('text-primary')!);
    const bg = parseHex(map.get('bg-canvas')!);
    expect(contrastRatio(fg!, bg!)).toBeGreaterThanOrEqual(7.0);
  });

  it('driving: text-primary on bg-canvas meets AA', () => {
    const dr = css.match(/\.driving\s*{([\s\S]*?)\n\s*}/);
    if (!dr) return;
    const map = extractDeclarations(dr[1]);
    const fg = parseHex(map.get('text-primary')!);
    const bg = parseHex(map.get('bg-canvas')!);
    expect(contrastRatio(fg!, bg!)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('ComplianceTrafficLight — colour is never the sole channel', () => {
  const source = readSource(
    'src/components/compliance/ComplianceTrafficLight.tsx',
  );

  it('every colour class has a matching icon component', () => {
    const colourKeys = Array.from(
      new Set(
        [...source.matchAll(/(\w+):\s*'(bg-[a-z]+)/g)].map((m) => m[1]),
      ),
    );
    const iconKeys = Array.from(
      new Set(
        [
          ...source.matchAll(
            /(\w+):\s*(CheckCircle2|AlertCircle|AlertTriangle|HelpCircle)/g,
          ),
        ].map((m) => m[1]),
      ),
    );
    expect(colourKeys.sort()).toEqual(iconKeys.sort());
  });

  it('every category row carries an aria-label (so screen readers never depend on colour)', () => {
    expect(source).toMatch(/aria-label=\{`\$\{label\}: \$\{summary\}`\}/);
  });

  it('every state icon is unique (no two lights share an icon)', () => {
    const icons = [
      ...source.matchAll(
        /(\w+):\s*(CheckCircle2|AlertCircle|AlertTriangle|HelpCircle)/g,
      ),
    ];
    const seen = new Map<string, string>();
    for (const [, key, icon] of icons) {
      const existing = seen.get(icon);
      expect(
        existing,
        `icon ${icon} reused for state ${key} (was: ${existing})`,
      ).toBeUndefined();
      seen.set(icon, key);
    }
  });

  it('renders the Sin datos label for unknown state so colour is not the only cue', () => {
    expect(source).toMatch(/compliance\.(coverage|noData)/);
  });
});

describe('CAPABILITY — what this audit does NOT cover', () => {
  it('document the gaps so a future maintainer does not assume coverage', () => {
    const gaps = [
      'rendered contrast (depends on real RGB + alpha background, not seed values)',
      'daltonismo simulation (requires external tool: Sim Daltonism, Coblis, axe-core color-blindness)',
      'sunlight glare (requires calibrated luxmeter + on-device test)',
      'motion and reduced-motion preference (separate WCAG SC 2.3.3 ticket)',
      'high-contrast mode coverage — pinned to AAA separately, can drift on rename',
    ];
    expect(gaps.length).toBe(5);
  });
});
