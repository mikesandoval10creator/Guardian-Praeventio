// Praeventio Guard — Round 18 R6 (R6→R17 MEDIUM #2): RFC 8785 canonical
// JSON serializer. Replaces `JSON.stringify(req.body)` as the input to
// HMAC verification on /api/telemetry/ingest (per-tenant secret) and the
// MercadoPago IPN webhook.
//
// ─── Why we needed this ──────────────────────────────────────────────
//
// Prior rounds (R1 R17 telemetry, R18 R2 MP IPN) computed the HMAC over
// `JSON.stringify(req.body)`. JSON.stringify preserves the JS engine's
// key-insertion order — which is the order the body parser observed in
// the wire bytes. For Node-to-Node traffic that is harmless because both
// sides walk the same parser, but a non-Node client (Python `requests`
// with a `dict`, Go `encoding/json` with a `map`, browser `fetch` with
// a constructed object literal) may serialize keys in a *different*
// order than the server reconstructs after parsing. Result: the client's
// signature is computed over `{"b":2,"a":1}`, the server signs
// `{"a":1,"b":2}`, the HMACs diverge, the request silently 401s.
//
// Worse: the failure was undebuggable for tenants in the field — it
// looked exactly like a wrong shared secret.
//
// ─── The fix ────────────────────────────────────────────────────────
//
// RFC 8785 (JSON Canonicalization Scheme, JCS) defines a byte-exact JSON
// serialization that is a function of the JSON value alone, independent
// of producer language or insertion order:
//
//   • Object members emitted in ascending order of UTF-16 code units of
//     the member name.
//   • No whitespace.
//   • Numbers in shortest unambiguous IEEE-754 form (Node's `String(n)`
//     produces this for finite values within safe-integer range).
//   • Strings escaped per JSON spec; non-ASCII passes through verbatim
//     (UTF-8 on the wire).
//   • Arrays preserve order — they are sequences, not sets.
//
// Both producer and verifier MUST canonicalise before signing. Once both
// sides do, byte-identical HMAC inputs are guaranteed regardless of the
// shape of the producer's source data structure.
//
// ─── Backwards-compat / breaking change ─────────────────────────────
//
// This IS a breaking change for any client that signed the legacy
// `JSON.stringify(req.body)` shape. In practice there are two cases:
//
//   1. Node clients that sign `JSON.stringify(body)` and post the same
//      `body` in the same insertion order: still work IF and ONLY IF the
//      Node client's keys happen to be in lexicographic order. (For
//      single-key bodies and bodies with naturally-ordered keys this is
//      true; for arbitrary bodies it is not.)
//
//   2. Non-Node clients that sign over their language's default JSON
//      serialization: previously broken silently; now correctly broken
//      (the contract is documented and the client can adopt JCS).
//
// For an emergency rollback there is a `LEGACY_HMAC_FALLBACK` env flag
// that the verify helpers below honor — see signing-call sites.
//
// ─── Implementation notes ────────────────────────────────────────────
//
// We keep this pure (no Express middleware exported here yet — the helper
// is invoked at the HMAC verify call site). A future R19/R20 phase will
// likely also expose a body-parser `verify` hook that captures the raw
// HTTP bytes; for now the canonical-JSON approach gives the same
// guarantee with no body-parser plumbing changes.

/**
 * RFC 8785 canonical-JSON serialization. Returns a deterministic UTF-16
 * string whose JSON value equals `value`. The string is suitable for use
 * as the input to HMAC-SHA256 in webhook signature verification.
 *
 * Throws on:
 *   • Non-finite numbers (NaN, +Infinity, -Infinity) — JSON has no rep.
 *   • Non-serializable values (functions, symbols, bigint).
 *
 * Object keys with `undefined` values are omitted, matching JSON.stringify.
 * Arrays preserve element order (RFC 8785 §3.2.2.4).
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('canonicalize: cannot serialize non-finite number');
    }
    return canonicalNumber(value);
  }
  if (typeof value === 'string') {
    // JSON.stringify on a string produces the JSON escape sequence per
    // ECMA-404 §9 — same escapes RFC 8785 §3.2.2.2 mandates. Reusing it
    // sidesteps a fragile hand-rolled escape table.
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    // Drop undefined values (no JSON literal); collect remaining keys and
    // sort by UTF-16 code units (which is what `Array.prototype.sort()`
    // does for strings by default).
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    const parts: string[] = [];
    for (const k of keys) {
      parts.push(JSON.stringify(k) + ':' + canonicalize(obj[k]));
    }
    return '{' + parts.join(',') + '}';
  }
  throw new Error(`canonicalize: cannot serialize ${typeof value}`);
}

/**
 * RFC 8785 §3.2.2.3 — shortest IEEE-754 representation. Node's `String(n)`
 * already produces the canonical form for finite numbers (no trailing
 * zeros, no '+e' on exponents, lowercase 'e', shortest mantissa).
 *
 * Examples:
 *   String(1e10)   === '10000000000'
 *   String(1.5)    === '1.5'
 *   String(-0)     === '0'
 *   String(1e21)   === '1e+21'   ← scientific kicks in past 1e20; both sides
 *                                  agree on this representation, so HMAC
 *                                  inputs match.
 */
function canonicalNumber(n: number): string {
  return String(n);
}
