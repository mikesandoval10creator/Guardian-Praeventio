# CSP Policy — Praeventio Guard

Source of truth for the Content Security Policy and supporting hardening
headers shipped by the application.

- Express middleware: [`src/server/middleware/securityHeaders.ts`](../../src/server/middleware/securityHeaders.ts)
- Tests: [`src/server/middleware/securityHeaders.test.ts`](../../src/server/middleware/securityHeaders.test.ts)
- Edge layer (nginx): [`nginx.conf`](../../nginx.conf)
- Threat model entries: TM-I05 (CSP scope), TM-I03 (Vertex AI), see [`STRIDE_findings.md`](./STRIDE_findings.md)

## Overview

CSP is defense-in-depth. The realistic XSS surface in this app is small (React
auto-escapes interpolations, no `dangerouslySetInnerHTML` sinks land
unreviewed), but a single dependency advisory or a Vite plugin chain compromise
could change that overnight. CSP turns the breach radius from "any
exfiltration" into "exfiltration restricted to the allowlisted origins" —
worth the maintenance cost.

The policy ships in two places:

1. **nginx** (`nginx.conf`) — the production frontend container. Conservative
   CSP today: only `frame-ancestors 'none'`. Wider directives (script-src,
   connect-src) are enforced one layer down because the container that serves
   the SPA does not have visibility into all the API/Firebase origins.
2. **Express middleware** (`securityHeaders.ts`) — every response from the
   Node app, including SSR fallbacks, the dev server, error pages, and the
   404 path. This is the canonical CSP. It LAYERS additively on top of
   nginx without contradicting (`frame-ancestors 'none'` is identical in
   both).

## Current directives

| Directive | Value | Rationale |
|---|---|---|
| `default-src` | `'self'` | Deny by default; everything else opts in. |
| `script-src` | `'self' 'unsafe-inline' https://www.gstatic.com https://apis.google.com https://*.firebaseio.com` | `'unsafe-inline'` required for Vite + React inline bootstrap (see Caveats). gstatic/apis hosts Firebase JS SDK. |
| `style-src` | `'self' 'unsafe-inline' https://fonts.googleapis.com` | Tailwind injects styles at runtime; Google Fonts CSS imports the Inter family declared in `index.html`. |
| `font-src` | `'self' https://fonts.gstatic.com data:` | Google Fonts files; `data:` allows inlined fallbacks. |
| `img-src` | `'self' data: blob: https:` | Avatars, IPER photos (blob URLs from camera), generic `https:` for thumbnails — broad but read-only. |
| `connect-src` | `'self' https://*.googleapis.com https://*.firebaseio.com https://firestore.googleapis.com https://*.sentry.io wss://*.firebaseio.com https://generativelanguage.googleapis.com` | Firestore, Identity Toolkit, Vertex AI Gemini, Sentry ingest, Realtime DB websockets. |
| `frame-src` | `'self' https://accounts.google.com` | Google OAuth consent dialog when applicable. |
| `frame-ancestors` | `'none'` | Clickjacking defense — no site may embed us. |
| `object-src` | `'none'` | Bans `<object>`/`<embed>` (legacy XSS vector). |
| `base-uri` | `'self'` | Prevents `<base href>` redirection of relative URLs. |
| `form-action` | `'self'` | Forms POST only to our own origin. |
| `upgrade-insecure-requests` | enabled | Browser-level upgrade of any stray http:// URL. |

## Other security headers

| Header | Value | Scope |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | Always. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Always. |
| `X-Frame-Options` | `DENY` | Belt-and-braces with `frame-ancestors`. |
| `Permissions-Policy` | `camera=(self), microphone=(self), geolocation=(self), accelerometer=(self), gyroscope=(self)` | Self-only. The app legitimately uses each: SOSButton (mic+geo), fall detection (accelerometer/gyroscope), IPER photos (camera), commute tracking (geo). |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` | HTTPS only — gated on `req.secure` OR `X-Forwarded-Proto: https` (Cloud Run). Skipped on plain HTTP so local dev does not pin browsers to HTTPS. |

## Known caveats

### `'unsafe-inline'` in `script-src`

Vite + React's runtime bootstrap injects an inline script tag for module
preload polyfilling. Removing `'unsafe-inline'` requires emitting a per-
response nonce and threading it through to `index.html`. Tracker: **Sprint 22+**
(see TODO.md). Until that lands, `'unsafe-inline'` stays.

The mitigation today: every other directive is tight, the SPA does not accept
unsanitized user HTML, and React auto-escapes JSX interpolations.

### `https:` blanket on `img-src`

Loosened deliberately for user-uploaded thumbnails and Wikipedia/news
illustrations referenced from internal links. Tightening this would require a
proxy or an allowlist of cdn hostnames; deferred until we have real CSP
violation reports against it.

### Wildcard on `*.googleapis.com` in `connect-src`

Tracked as **TM-I05** in [`STRIDE_findings.md`](./STRIDE_findings.md).
Replacing the wildcard with an explicit list (`firestore.googleapis.com`,
`identitytoolkit.googleapis.com`, `aiplatform.googleapis.com`,
`maps.googleapis.com`, `firebase-installations.googleapis.com`) requires a
smoke test pass against every Firebase product the app uses. Bucket D in the
11th wave installs the middleware; a follow-up bucket runs the tightening.

## How to add a new origin

1. Edit `CSP_DIRECTIVES` in `src/server/middleware/securityHeaders.ts`.
2. Update the directive table in this doc.
3. Add a test asserting the new origin appears in the directive in
   `securityHeaders.test.ts` (the file has a section for "required origins"
   you can extend).
4. If the origin is third-party, link the upstream documentation page that
   declares the host (so the next reviewer can verify it's still authoritative).
5. Open a PR. Mention TM-I05 in the description so it's clear this is a
   considered relaxation and not drift.
6. Deploy. Watch Sentry for CSP violations on the new path.

## Testing in dev

```bash
npm run dev               # boots Express on http://localhost:3000
curl -I http://localhost:3000/                      # no HSTS expected (HTTP)
curl -I -H "X-Forwarded-Proto: https" http://localhost:3000/   # HSTS appears
```

You should see all six headers (CSP, X-Content-Type-Options, Referrer-Policy,
X-Frame-Options, Permissions-Policy, plus HSTS on the second call).

## Cross-references

- [`nginx.conf`](../../nginx.conf) — edge headers. Keep `frame-ancestors 'none'` in sync if changed.
- [`THREAT_MODEL.md`](./THREAT_MODEL.md) — the threat scenarios CSP defends against.
- [`STRIDE_findings.md`](./STRIDE_findings.md) — TM-I05 tracker for connect-src wildcard tightening.
- [`SECURITY.md`](../../SECURITY.md) — top-level security policy and disclosure.
