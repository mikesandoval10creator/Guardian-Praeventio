// Praeventio Guard — [P0][CI][seguridad] regex frágil (js/polynomial-redos).
// Ticket: "Sanitizar y reemplazar regex frágil en flujo de claim de recursos".
//
// Dos responsabilidades:
//  1. Equivalencia: isValidEmail reproduce la semántica del regex legacy
//     /^[^\s@]+@[^\s@]+\.[^\s@]+$/ salvo el límite de longitud RFC 5321 (254),
//     intencional (sanitización de entrada).
//  2. Regresión ReDoS: entradas hostiles de gran tamaño se rechazan en tiempo
//     lineal (el regex legacy era cuadrático en 'a@' + 'b'*N sin '.').

import { describe, it, expect } from 'vitest';
import { isValidEmail } from './claims.js';

describe('isValidEmail — equivalencia con el regex legacy', () => {
  const valid: Array<[string, string]> = [
    ['simple', 'a@b.cl'],
    ['local con puntos y tags', 'user.name+tag@sub.domain.co'],
    ['local con punto inicial (legacy lo permitía)', '.leading.dot@x.yz'],
    ['dominio X=".", Y="b" (legacy: a@..b)', 'a@..b'],
    ['dominio con puntos consecutivos', 'a@b..c'],
    ['dominio con varios puntos', 'dots.every.where@x.y.z.w'],
    ['underscore permitido en ambos lados', 'a_b@c_d.e'],
  ];
  const invalid: Array<[string, string]> = [
    ['vacío', ''],
    ['sin @', 'plain'],
    ['local vacío', '@b.cl'],
    ['sin punto en dominio', 'a@b'],
    ['punto al final del dominio', 'a@b.'],
    ['punto al inicio del dominio sin X', 'a@.cl'],
    ['dos @', 'a@@b.cl'],
    ['whitespace en local', 'a b@x.y'],
    ['whitespace en dominio', 'a@b c.d'],
    ['whitespace trailing en dominio', 'a@b.c d'],
    ['tab en local', 'a\tb@x.y'],
    ['newline en local', 'a\nb@x.y'],
    ['solo local y @', 'a@'],
    ['solo @', '@'],
    ['dominio de 2 chars sin punto suficiente', 'a@..'],
  ];

  for (const [label, email] of valid) {
    it(`acepta: ${label} (${JSON.stringify(email)})`, () => {
      expect(isValidEmail(email)).toBe(true);
    });
  }
  for (const [label, email] of invalid) {
    it(`rechaza: ${label} (${JSON.stringify(email)})`, () => {
      expect(isValidEmail(email)).toBe(false);
    });
  }

  it('acepta no-strings como inválidos sin lanzar', () => {
    for (const v of [null, undefined, 42, {}, [], true, Symbol('x')]) {
      expect(isValidEmail(v)).toBe(false);
    }
  });

  describe('sanitización de longitud (RFC 5321, cambio intencional)', () => {
    it('acepta un email válido de hasta 254 chars', () => {
      const email = `${'a'.repeat(249)}@x.y`; // 249 + 1 + 3 = 253 ≤ 254
      expect(email.length).toBe(253);
      expect(isValidEmail(email)).toBe(true);
    });

    it('rechaza un email válido de 255+ chars', () => {
      const email = `${'a'.repeat(251)}@x.yz`; // 251 + 5 = 256 > 254
      expect(email.length).toBeGreaterThan(254);
      expect(isValidEmail(email)).toBe(false);
    });
  });
});

describe('regresión ReDoS — rechazo en tiempo lineal', () => {
  it('entradas hostiles de 1 MB se rechazan rápido (el regex legacy era cuadrático)', () => {
    const big = 1_000_000;
    const cases = [
      'a'.repeat(big), // sin '@': el primer [^\s@]+ retrocedía O(n)
      `a@${'b'.repeat(big)}`, // sin '.': retroceso cuadrático O(n²) en legacy
      `a@${'b.'.repeat(big / 2)}`, // puntos sin Y válido al final
      `${'a '.repeat(big / 2)}@x.y`, // whitespace masivo
    ];
    const t0 = Date.now();
    for (const c of cases) {
      expect(isValidEmail(c)).toBe(false);
    }
    const dt = Date.now() - t0;
    // Generoso a propósito: canario de no-regresión, no benchmark. El regex
    // legacy tardaba minutos/horas en estos casos; el validador lineal, <50ms.
    expect(dt).toBeLessThan(2000);
  });

  it('hostiles ≤ 254 chars ejercitan el parser (no el cap) y son O(1)', () => {
    expect(isValidEmail(`a@${'b'.repeat(245)}`)).toBe(false); // sin '.' (248 chars)
    expect(isValidEmail(`a@${'b'.repeat(244)}.`)).toBe(false); // '.' al final (248)
    expect(isValidEmail(`a@${'.'.repeat(250)}`)).toBe(true); // X='.', Y='.'*248 ✓ legacy (252)
  });
});
