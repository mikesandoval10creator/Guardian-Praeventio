// Praeventio Guard — [P0] URL secret redaction for logs/observability.
//
// The health-vault share URL used to carry its secret in the PATH
// (`/vault/share/{tokenId}/{secret}`): any unhandled error on that route
// logged the full secret via req.url (browser history, proxy/server logs,
// Referer headers, Sentry, exception logs). The share now uses a URL
// fragment (never sent to the server), but legacy URLs and other
// token-in-path routes must not leak either. This pure function is applied
// to every req.url that reaches the error tracker or the logger.

/**
 * Mask secret-bearing segments in a request URL.
 *
 * - `/vault/share/{tokenId}/{secret}` (legacy path form) → masks the secret
 *   segment, including file-proxy URLs with a trailing file name.
 * - Any remaining path segment that looks like a 32+ char URL-safe secret
 *   (heuristic shared with the token format) → masked.
 */
export function redactSensitiveUrl(rawUrl: string): string {
  // /vault/share/{tokenId}/{secret} (and optional trailing file name) →
  // mask the secret AND everything after it.
  let url = rawUrl.replace(
    /^(\/vault\/share\/[^/?#]+)\/[^/?#]+(\/.*)?$/,
    '$1/[REDACTED]',
  );
  // Any remaining path segment that looks like a 32+ char URL-safe secret.
  url = url.replace(/\/[A-Za-z0-9_-]{32,}(\/.*)?$/g, '/[REDACTED]');
  return url;
}
