// Praeventio Guard — Round 18 R6 (R6→R17 MEDIUM #2): RFC 8785 canonical-JSON
// serializer used as the input to HMAC verification on /api/telemetry/ingest
// (per-tenant secret) and /api/billing/webhook/mercadopago (MP IPN).
//
// Why: prior rounds used `JSON.stringify(req.body)` which depends on the JS
// engine's key-insertion order. Two clients sending the same logical JSON
// with different key ordering produce different HMACs → silent 401s for
// non-Node clients. RFC 8785 (JSON Canonicalization Scheme, JCS) defines a
// deterministic byte-exact serialization independent of the producer.
//
// This file is the TDD red-then-green test for `canonicalize`. Source spec:
//   https://datatracker.ietf.org/doc/html/rfc8785

import { describe, it, expect } from 'vitest';
import { canonicalize } from './canonicalBody.js';

describe('canonicalize (RFC 8785)', () => {
  // ───────────── primitives ─────────────

  it('serializes null', () => {
    expect(canonicalize(null)).toBe('null');
  });

  it('serializes booleans', () => {
    expect(canonicalize(true)).toBe('true');
    expect(canonicalize(false)).toBe('false');
  });

  // ───────────── objects ─────────────

  it('serializes the empty object as `{}`', () => {
    expect(canonicalize({})).toBe('{}');
  });

  it('serializes a single-key object', () => {
    expect(canonicalize({ a: 1 })).toBe('{"a":1}');
  });

  it('sorts top-level keys lexicographically (UTF-16 code units)', () => {
    // RFC 8785 §3.2.3 — keys sorted by UTF-16 code units, ascending.
    expect(canonicalize({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(canonicalize({ z: 1, a: 1, m: 1 })).toBe('{"a":1,"m":1,"z":1}');
  });

  it('sorts keys at every nested level', () => {
    const input = { b: { z: 1, a: 2 }, a: { y: 1, x: 2 } };
    // Outer sort: a < b. Inner sort: a < z, x < y.
    expect(canonicalize(input)).toBe('{"a":{"x":2,"y":1},"b":{"a":2,"z":1}}');
  });

  it('skips undefined values in objects (per JSON spec)', () => {
    // JSON has no `undefined` literal — JSON.stringify drops keys with
    // undefined values and so do we, so the canonical bytes match what a
    // sane producer ships.
    const input: Record<string, unknown> = { a: 1, b: undefined, c: 3 };
    expect(canonicalize(input)).toBe('{"a":1,"c":3}');
  });

  // ───────────── arrays ─────────────

  it('preserves array order (NEVER sorts)', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalize(['b', 'a', 'c'])).toBe('["b","a","c"]');
  });

  it('serializes an empty array', () => {
    expect(canonicalize([])).toBe('[]');
  });

  it('canonicalises objects nested in arrays', () => {
    expect(canonicalize([{ b: 2, a: 1 }, { d: 4, c: 3 }])).toBe(
      '[{"a":1,"b":2},{"c":3,"d":4}]',
    );
  });

  // ───────────── strings ─────────────

  it('escapes special characters per JSON spec', () => {
    // Newline, tab, double-quote, backslash, control char, unicode.
    expect(canonicalize('a\nb')).toBe('"a\\nb"');
    expect(canonicalize('a"b')).toBe('"a\\"b"');
    expect(canonicalize('a\\b')).toBe('"a\\\\b"');
    // U+00E9 LATIN SMALL LETTER E WITH ACUTE — JSON.stringify keeps as raw.
    // RFC 8785 says non-ASCII passes through as UTF-8 bytes; JSON.stringify
    // matches that on the JS string side.
    expect(canonicalize('café')).toBe('"café"');
  });

  // ───────────── numbers ─────────────

  it('serializes integers and negatives', () => {
    expect(canonicalize(0)).toBe('0');
    expect(canonicalize(1)).toBe('1');
    expect(canonicalize(-1)).toBe('-1');
    expect(canonicalize(42)).toBe('42');
  });

  it('serializes exponents in shortest unambiguous form', () => {
    // 1e10 → '10000000000'. Node's String(1e10) does this for finite
    // integers within safe-integer range.
    expect(canonicalize(1e10)).toBe('10000000000');
    // 1.5 → '1.5' (already shortest)
    expect(canonicalize(1.5)).toBe('1.5');
  });

  it('throws on NaN', () => {
    expect(() => canonicalize(Number.NaN)).toThrow(/non-finite/);
  });

  it('throws on +Infinity', () => {
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow(/non-finite/);
  });

  it('throws on -Infinity', () => {
    expect(() => canonicalize(Number.NEGATIVE_INFINITY)).toThrow(/non-finite/);
  });

  // ───────────── determinism contract ─────────────

  it('produces byte-identical output for two objects with different key insertion order', () => {
    // The whole point of the canonicalisation: a Node client and a Python
    // client serializing {a:1,b:2} get the SAME bytes regardless of dict
    // ordering or insertion order.
    const a = { a: 1, b: 2, c: 3 };
    const b = { c: 3, a: 1, b: 2 };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });
});
