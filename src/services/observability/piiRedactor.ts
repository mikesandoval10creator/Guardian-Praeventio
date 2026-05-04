// Praeventio Guard — PII redactor for Vertex AI prompts.
//
// Sprint 20 ninth wave (Bucket A). Closes STRIDE finding TM-I03.
//
// Vertex AI is a trusted processor (Google Cloud, signed BAA, configurable
// region), but Chile's Ley 21.719 art. 50 still requires us to minimise
// the PII surface area we ship to any external service. Our users —
// supervisores, prevencionistas, médicos del trabajo — routinely paste
// RUTs, emails, phone numbers, and partial medical-record snippets into
// the Asesor textarea ("¿qué hago con la lumbalgia de Juan, RUT
// 12.345.678-9?"). We redact at the prompt-build seam in
// `geminiBackend.ts` so the model still sees the clinical/operational
// substance but never the identifying tokens.
//
// Defense in depth, not a security boundary: the boundary is the BAA
// with Google + region selection. This module reduces blast radius if
// either leg fails (logs leak, region is mis-configured, etc.) and is
// the single line we cite in the Ley 21.719 audit when an inspector
// asks "qué pasa cuando un supervisor pega un RUT".
//
// PATTERNS COVERED
//   - Chilean RUT (XX.XXX.XXX-K, with or without dots)
//   - Email addresses
//   - Chilean mobile phone numbers (+56 9 XXXX XXXX, 569XXXXXXXX,
//     9XXXXXXXX with optional spacing)
//   - Credit-card-like long numeric runs (13–19 digits with spacing)
//   - Common API-key prefixes (sk-, AIza, ya29., ghp_, gho_)
//
// INTENTIONALLY NOT REDACTED — domain expertise required:
//   - Worker names — too many false positives, would break analysis
//   - Industry / activity descriptions — needed by the model
//   - Diagnostic ICD codes — needed for medical reasoning
//
// ORDER MATTERS: API keys → email → RUT → phone → credit card. RUT and
// phone are matched before the generic 13–19-digit credit-card-like
// pattern so they don't get double-redacted.

/** Public result of a redaction pass. */
export interface RedactionResult {
  redacted: string;
  count: number;
  categories: string[];
}

/** Internal pattern triple — regex, replacement, category tag. */
type PiiPattern = readonly [RegExp, string, string];

// Each pattern uses the `g` flag so `String.prototype.replace` applies it
// globally; we count matches via `matchAll` before replacement so the
// counter is accurate even when the replacement string contains the
// match (idempotency check covered in the test suite).
//
// The `K` in RUT can be lowercase or uppercase. Email is the standard
// permissive pattern that covers practical cases without descending
// into RFC 5322 madness. The CL mobile phone pattern only catches the
// 9-prefix mobile format (`+56 9 XXXX XXXX`); fixed-line numbers vary
// too much by region and would overlap with other 8-digit identifiers.
//
// The card-like pattern requires a leading digit then 12–18 more
// digit-or-spacer chars to keep it from eating short numeric IDs.
const PATTERNS: ReadonlyArray<PiiPattern> = [
  // API keys — high-confidence prefixes only. We do NOT use a generic
  // base64-shaped catch-all by default to avoid eating long industrial
  // chemical formulas, normative references like `RES-EX-2023-1234`,
  // and Firestore document IDs.
  [/\b(?:sk-|AIza|ya29\.|ghp_|gho_)[A-Za-z0-9_-]{20,}\b/g, '[APIKEY_REDACTED]', 'apikey'],

  // Email — standard permissive pattern. `[A-Za-z]{2,}` for TLD avoids
  // matching things like `node@v20` accidentally written in chat.
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[EMAIL_REDACTED]', 'email'],

  // Chilean RUT — `\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]`. The optional dots
  // accommodate both `12.345.678-9` and `12345678-9`. Word boundaries
  // prevent matches inside ISBN-style numbers or part numbers.
  [/\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b/g, '[RUT_REDACTED]', 'rut'],

  // CL mobile phone — anchored on the `9` mobile prefix to avoid eating
  // generic 8-digit codes. Word boundary at the start, anything that
  // looks like (+56)?9XXXXXXXX with optional spaces or dashes.
  [/(?:\+?56[\s-]?)?9[\s-]?\d{4}[\s-]?\d{4}\b/g, '[PHONE_REDACTED]', 'phone'],

  // Credit-card-like long numeric runs. Runs AFTER RUT/phone so CL
  // identifiers are not eaten first. The 13–19 range covers all major
  // card networks (Visa 13/16/19, Amex 15, Mastercard 16, Diners 14).
  [/\b(?:\d[\s-]?){12,18}\d\b/g, '[CARD_REDACTED]', 'card'],
];

/**
 * Redact PII from a free-form prompt before sending to an external LLM.
 *
 * The function is idempotent — running it on already-redacted text
 * returns the same string with `count: 0` and an empty `categories`
 * array, because the replacement tokens (`[RUT_REDACTED]` etc.) do not
 * match any of the patterns above.
 *
 * Unicode safe: the patterns only target ASCII tokens (digits, basic
 * Latin), so Spanish accents in the surrounding text are preserved
 * verbatim. See the test suite for the "José Pérez" case.
 */
export function redactPii(input: string): RedactionResult {
  if (!input) {
    return { redacted: input ?? '', count: 0, categories: [] };
  }

  let working = input;
  let total = 0;
  const seen = new Set<string>();

  for (const [regex, replacement, category] of PATTERNS) {
    // We re-create the iterator each pass because `matchAll` on a
    // global regex consumes lastIndex state when reused across strings.
    const matches = working.match(new RegExp(regex.source, regex.flags));
    if (matches && matches.length > 0) {
      total += matches.length;
      seen.add(category);
      working = working.replace(new RegExp(regex.source, regex.flags), replacement);
    }
  }

  return {
    redacted: working,
    count: total,
    categories: Array.from(seen),
  };
}
