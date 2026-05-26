// Praeventio Guard — Plan v2 F8 / Audit H16 (P3).
//
// Regression suite para `stampCspNonce`. El bug histórico: el call site
// usaba `template.replace(regex, nonce)` con `nonce` como string literal,
// que interpreta `$&` etc. como tokens especiales. Estos tests fijan el
// behavior correcto (cualquier carácter en el nonce, incluido `$`, queda
// literal en el HTML servido).

import { describe, it, expect } from 'vitest';
import { stampCspNonce } from './stampCspNonce';

describe('stampCspNonce', () => {
  const TEMPLATE = '<html><script nonce="__CSP_NONCE__">init();</script></html>';

  it('reemplaza el placeholder con un nonce base64 estándar', () => {
    const nonce = 'aBc123+/=';
    const out = stampCspNonce(TEMPLATE, nonce);
    expect(out).toBe('<html><script nonce="aBc123+/=">init();</script></html>');
    expect(out).not.toContain('__CSP_NONCE__');
  });

  it('reemplaza TODAS las ocurrencias (global match)', () => {
    const template = '__CSP_NONCE__ x __CSP_NONCE__ y __CSP_NONCE__';
    const out = stampCspNonce(template, 'NX');
    expect(out).toBe('NX x NX y NX');
  });

  it('F8/H16: nonce con `$&` queda LITERAL, no como el match', () => {
    // Si usáramos `replace(regex, string)` con replacement string, `$&`
    // se expandiría al match completo (`__CSP_NONCE__`) → el HTML
    // resultante tendría `__CSP_NONCE__` en lugar del nonce → CSP fail
    // silente. El callback signature lo previene.
    const badNonce = 'abc$&xyz';
    const out = stampCspNonce(TEMPLATE, badNonce);
    expect(out).toContain('nonce="abc$&xyz"');
    expect(out).not.toContain('__CSP_NONCE__');
  });

  it('F8/H16: nonce con `$$` queda LITERAL (sin colapsar a `$`)', () => {
    // En string replacement, `$$` colapsa a `$`. Callback lo evita.
    const badNonce = 'a$$b';
    const out = stampCspNonce(TEMPLATE, badNonce);
    expect(out).toContain('nonce="a$$b"');
  });

  it('F8/H16: nonce con `$1` no se interpreta como backreference', () => {
    // No tenemos grupos en el regex (solo `g` flag), pero la spec dice
    // que `$1` se reemplaza por empty string cuando no hay grupo 1.
    const badNonce = 'pref$1suff';
    const out = stampCspNonce(TEMPLATE, badNonce);
    expect(out).toContain('nonce="pref$1suff"');
  });

  it("F8/H16: nonce con `$\\`` y `$'` queda literal", () => {
    // String replacement interpreta `$\`` y `$'` como pre/post-match.
    // Callback lo previene.
    const badNonce = "x$`y$'z";
    const out = stampCspNonce(TEMPLATE, badNonce);
    expect(out).toContain(`nonce="${badNonce}"`);
  });

  it('nonce vacío produce attribute vacío sin tirar', () => {
    const out = stampCspNonce(TEMPLATE, '');
    expect(out).toBe('<html><script nonce="">init();</script></html>');
  });

  it('template sin placeholder se devuelve sin tocar', () => {
    const template = '<html><body>plain</body></html>';
    const out = stampCspNonce(template, 'whatever');
    expect(out).toBe(template);
  });
});
