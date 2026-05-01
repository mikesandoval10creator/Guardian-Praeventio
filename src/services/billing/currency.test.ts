// Praeventio Guard — currency formatting tests.
//
// Hermetic. The implementation must use Intl.NumberFormat with locale-aware
// separators per LATAM convention. We assert visible substrings, not the
// exact whitespace bytes Intl emits, because Node's ICU uses different
// non-breaking-space characters across versions (regular U+0020 vs NBSP
// U+00A0 vs narrow NBSP U+202F). We normalize whitespace before comparing.

import { describe, expect, it } from 'vitest';
import { formatCurrency, type LatamCurrency } from './currency.js';

/**
 * Strip every Unicode whitespace down to a single ASCII space. Lets the
 * tests survive Intl's variable use of NBSP / narrow-NBSP / thin-space
 * around the currency glyph and digit groups.
 */
function normalizeWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

describe('formatCurrency — CLP (no decimals, dot thousands)', () => {
  it('formats whole pesos with dot thousands and CLP suffix', () => {
    expect(normalizeWs(formatCurrency(11990, 'CLP'))).toBe('$11.990 CLP');
  });

  it('rounds to whole pesos (no decimals ever for CLP)', () => {
    expect(normalizeWs(formatCurrency(11990.49, 'CLP'))).toBe('$11.990 CLP');
  });

  it('handles zero', () => {
    expect(normalizeWs(formatCurrency(0, 'CLP'))).toBe('$0 CLP');
  });
});

describe('formatCurrency — USD (comma thousands, no decimals)', () => {
  it('formats USD with comma thousands and USD suffix', () => {
    expect(normalizeWs(formatCurrency(1578, 'USD'))).toBe('$1,578 USD');
  });
});

describe('formatCurrency — PEN (Peruvian sol)', () => {
  it('uses S/ glyph and 2-decimal Peruvian formatting', () => {
    // 49.90 soles for the equivalent of comite-paritario.
    const out = normalizeWs(formatCurrency(49.9, 'PEN'));
    // Allow either "S/" or "S/." prefix — different ICU versions emit
    // slightly different glyphs but both are recognised as PEN.
    expect(out).toMatch(/^S\/\.?\s?49[.,]90 PEN$/);
  });
});

describe('formatCurrency — ARS (Argentine peso)', () => {
  it('formats ARS with dot thousands and ARS suffix', () => {
    // es-AR Intl emits "$ 13.990,00" (with space + 2 decimals) on Node 22.
    // Allow optional space after the glyph and optional decimals so the
    // test survives both ICU variants.
    expect(normalizeWs(formatCurrency(13990, 'ARS'))).toMatch(
      /^\$ ?13\.990(,\d{2})? ARS$/,
    );
  });
});

describe('formatCurrency — COP (Colombian peso)', () => {
  it('formats COP with dot thousands, no decimals, and COP suffix', () => {
    // es-CO Intl puts a space after the glyph; accept either form.
    expect(normalizeWs(formatCurrency(54000, 'COP'))).toMatch(
      /^\$ ?54\.000 COP$/,
    );
  });
});

describe('formatCurrency — MXN (Mexican peso)', () => {
  it('formats MXN with comma thousands and MXN suffix', () => {
    // es-MX uses comma thousands, dot decimals — like en-US for grouping.
    const out = normalizeWs(formatCurrency(259, 'MXN'));
    expect(out).toMatch(/^\$259(\.\d{2})? MXN$/);
  });
});

describe('formatCurrency — BRL (Brazilian real)', () => {
  it('formats BRL with R$ prefix and BRL suffix', () => {
    const out = normalizeWs(formatCurrency(75, 'BRL'));
    // pt-BR: dot thousands, comma decimals; we accept either with or
    // without the cents portion since whole-real prices are common.
    expect(out).toMatch(/^R\$\s?75(,\d{2})? BRL$/);
  });
});

describe('formatCurrency — defensive', () => {
  it('throws on unknown currency code', () => {
    // Prove the function fails closed: an unsupported currency must NOT
    // silently fall back to USD or default Intl behaviour. Catching the
    // error at the call-site is preferable to mis-priced invoices.
    expect(() => formatCurrency(100, 'JPY' as LatamCurrency)).toThrow();
  });

  it('handles negative amounts (refund display)', () => {
    const out = normalizeWs(formatCurrency(-11990, 'CLP'));
    // Either "-$11.990 CLP" or "$-11.990 CLP" depending on Intl version.
    expect(out).toMatch(/[-]?\$[-]?11\.990 CLP$/);
  });
});
