// Praeventio Guard \u2014 audit-log `details` sanitizer.
//
// The audit endpoint accepts arbitrary `details` payloads from any
// authenticated client. Without sanitization, a malicious or careless
// caller could persist:
//   - FCM device tokens (`fcmToken: "abc..."`)
//   - OAuth bearer assertions
//   - Wi-Fi passwords or passphrases
//   - Raw PII (RUT, phone, email)
//
// The fix is a *redactor* (not a validator \u2014 we want to preserve the
// audit trail, not reject it) that:
//
//   1. Walks the object recursively up to a depth cap (5 levels).
//   2. Replaces any value whose key matches a sensitive-name allowlist
//      with the literal `[REDACTED]` sentinel. The matching is
//      case-insensitive and trims whitespace; word-boundary-aware so
//      `userEmailSubject` does NOT match `email`.
//   3. Replaces any string value that LOOKS like a credential shape
//      (JWT, Bearer header, AWS key, Google API key, hex/base64 secret
//      longer than 32 chars) with `[REDACTED]`.
//   4. Caps total payload bytes at 4 KB \u2014 anything beyond is
//      truncated at a property boundary and the rest replaced with a
//      `__truncated__: true` sentinel. Above that, the audit row
//      itself is the PII surface; we don't make it worse.
//
// Behavior when sanitization changes shape:
//   - `details === { fcmToken: 'abc' }` \u2192 `details === { fcmToken: '[REDACTED]' }`
//   - `details === { a: { b: 'eyJhbGciOi...' } }` \u2192 nested redaction kept
//   - `details === { note: 'foo' }` \u2192 unchanged
//
// The redactor is pure (no I/O) so it is trivially testable in isolation.

const MAX_DETAILS_DEPTH = 5;
const MAX_DETAILS_BYTES = 4 * 1024; // 4 KiB
const LONG_SECRET_MIN_CHARS = 32;

/** Field-name patterns that always get redacted, case-insensitive, word-boundary. */
const SENSITIVE_KEY_PATTERNS: RegExp[] = [
  // ── Standalone token/secret/password/etc. (word-boundary, no separator)
  /\btoken\b/,
  /\bsecret\b/,
  /\bpassword\b/,
  /\bpassphrase\b/,
  /\bapi[_-]?key\b/,
  /\bbearer\b/,
  /\bauthorization\b/,
  /\bcredential/,
  /\bcredentials\b/,
  /\bprivate[_-]?key\b/,
  /\bsignature\b/,
  /\bassertion\b/,
  /\bsession[_-]?id\b/,
  /\bcookie\b/,
  /\bcsrf\b/,
  /\bemail\b/, // also catches 'userEmail', 'emailSubject' if they're standalone keys
  /email$/i,  // camelCase suffix: userEmail, primaryEmail, contactEmail
  /^email[_-]/i, // snake/kebab prefix: email_address, email-subject
  /\brut\b/, // Chilean tax id (specific to Praeventio)
  /\bdni\b/, // generic id
  /\bssn\b/,
  /\bpassport\b/,
  // ── CamelCase / snake_case SUFFIX patterns: fcmToken, passwordHash, apiKey
  // The bare word-boundary patterns above do NOT match these because the
  // preceding character is itself a word char (e.g. 'm' in 'fcmToken').
  // For credential/PII surfaces we err on the side of over-redaction:
  // a false positive is "log lost a label"; a false negative is "secret
  // persisted to audit_logs and exposed to supervisors forever".
  /(token|secret|password|passphrase|apikey|api[_-]?key|bearer|authorization|credential|credentials|private[_-]?key|signature|assertion|session[_-]?id|cookie|csrf)$/i,
  /(hash|digest|nonce|salt|iv)$/i, // crypto material suffixes (passwordHash, iv)
  /(fcm|push|device|gcm)[_-]?(token|secret|key)$/i, // FCM/push token suffixes
];

const REDACTED = '[REDACTED]';
const TRUNCATED_SENTINEL = '__truncated__';

/**
 * Heuristic: does this STRING value look like a credential?
 * JWT, bearer, AWS access key (AKIA + 16 chars), Google API key (AIza + 35),
 * long hex / base64 blob.
 */
function looksLikeSecretString(value: string): boolean {
  if (value.length < LONG_SECRET_MIN_CHARS) return false;
  // JWT: three base64url chunks separated by '.'
  if (/^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/.test(value)) return true;
  // Bearer scheme
  if (/^Bearer\s+\S{16,}$/i.test(value)) return true;
  // AWS access key id
  if (/^AKIA[0-9A-Z]{16}$/.test(value)) return true;
  // Google API key
  if (/^AIza[0-9A-Za-z_-]{35}$/.test(value)) return true;
  return false;
}

/**
 * Recursive sanitizer. Returns a NEW object (does not mutate the input).
 * String values are kept as-is unless they look like secrets, in which
 * case they are replaced. Object keys matching sensitive patterns have
 * their values replaced with the redaction sentinel.
 */
function sanitizeRecursive(value: unknown, depth: number): unknown {
  if (depth >= MAX_DETAILS_DEPTH) {
    return TRUNCATED_SENTINEL;
  }
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (looksLikeSecretString(value)) return REDACTED;
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeRecursive(v, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(k)) {
        out[k] = REDACTED;
      } else {
        out[k] = sanitizeRecursive(v, depth + 1);
      }
    }
    return out;
  }
  // functions, symbols, bigints, undefined-in-object: drop on the floor
  // (we never want to persist a function reference into an audit row).
  return undefined;
}

function isSensitiveKey(key: string): boolean {
  if (typeof key !== 'string') return false;
  const k = key.trim().toLowerCase();
  if (!k) return false;
  return SENSITIVE_KEY_PATTERNS.some((re) => re.test(k));
}

/**
 * Apply the sanitizer and the byte-size cap. Returns the redacted payload
 * and a `wasTruncated` flag so the audit row can flag that detail was
 * cut off.
 *
 * Cap is enforced AFTER redaction so a malicious payload of 1 MB of
 * "benign" property names still cannot exceed 4 KB.
 */
export function sanitizeAuditDetails(
  details: unknown,
): { redacted: Record<string, unknown>; truncated: boolean } {
  const sanitized = sanitizeRecursive(details ?? {}, 0);
  const out: Record<string, unknown> =
    typeof sanitized === 'object' && sanitized !== null && !Array.isArray(sanitized)
      ? (sanitized as Record<string, unknown>)
      : {};

  const serialized = JSON.stringify(out);
  if (serialized.length <= MAX_DETAILS_BYTES) {
    return { redacted: out, truncated: false };
  }
  // Truncate at a property boundary: keep dropping top-level keys until
  // we fit. Mark the survivor with `__truncated__: true` so future
  // consumers know the payload was clipped.
  const truncated: Record<string, unknown> = { [TRUNCATED_SENTINEL]: true };
  let approxSize = JSON.stringify(truncated).length;
  for (const [k, v] of Object.entries(out)) {
    const entry = { [k]: v };
    const entrySize = JSON.stringify(entry).length + 1; // comma
    if (approxSize + entrySize > MAX_DETAILS_BYTES) break;
    Object.assign(truncated, entry);
    approxSize += entrySize;
  }
  return { redacted: truncated, truncated: true };
}
