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
| `script-src` | `'self' 'nonce-<per-request>' 'strict-dynamic' https://www.gstatic.com https://apis.google.com` | `'unsafe-inline'` was REMOVED in Sprint 20 13th wave Bucket C and replaced with a per-request 128-bit base64 nonce + `'strict-dynamic'`. `gstatic`/`apis.google` are kept as a fallback host allowlist for browsers that ignore `strict-dynamic` (see "Nonce strategy" below). The legacy `*.firebaseio.com` token was removed in Sprint 20 12th wave Bucket A — Firebase JS is served from `gstatic`, never from `firebaseio`. |
| `style-src` | `'self' 'unsafe-inline' https://fonts.googleapis.com` | Tailwind injects styles at runtime; Google Fonts CSS imports the Inter family declared in `index.html`. |
| `font-src` | `'self' https://fonts.gstatic.com data:` | Google Fonts files; `data:` allows inlined fallbacks. |
| `img-src` | `'self' data: blob: https:` | Avatars, IPER photos (blob URLs from camera), generic `https:` for thumbnails — broad but read-only. |
| `connect-src` | _Explicit allow-list — see "connect-src allow-list" below._ | Wildcard `https://*.googleapis.com` was retired in Sprint 20 12th wave Bucket A (TM-I05). |
| `frame-src` | `'self' https://accounts.google.com` | Google OAuth consent dialog when applicable. |
| `frame-ancestors` | `'none'` | Clickjacking defense — no site may embed us. |
| `object-src` | `'none'` | Bans `<object>`/`<embed>` (legacy XSS vector). |
| `base-uri` | `'self'` | Prevents `<base href>` redirection of relative URLs. |
| `form-action` | `'self'` | Forms POST only to our own origin. |
| `upgrade-insecure-requests` | enabled | Browser-level upgrade of any stray http:// URL. |
| `report-uri` | `/api/csp-report` | Browsers POST violation reports here; the route hands them to Sentry as a breadcrumb so a regression that clips a legitimate origin shows up in the issue feed. |

### connect-src allow-list

| Origin | Reason |
|---|---|
| `'self'` | Same-origin Express + Vite endpoints. |
| `https://firestore.googleapis.com` | Firestore REST + Listen channels (`src/services/firebase.ts`). |
| `https://identitytoolkit.googleapis.com` | Firebase Auth sign-in / sign-up / email verification. |
| `https://securetoken.googleapis.com` | Firebase Auth ID-token refresh (called every ~50 min). |
| `https://storage.googleapis.com` | Firebase Storage downloads (IPER photos, attachments). |
| `https://firebaseinstallations.googleapis.com` | FCM / Installations registration. |
| `https://firebaseremoteconfig.googleapis.com` | Remote Config fetches (kept defensively; cheap). |
| `https://fcmregistrations.googleapis.com` | FCM token registration on sign-in. |
| `https://generativelanguage.googleapis.com` | Gemini API direct calls. |
| `https://aiplatform.googleapis.com` | Vertex AI Gemini (per `VERTEX_MIGRATION.md`). |
| `https://oauth2.googleapis.com` | OAuth token exchange (`src/services/oauthTokenStore.ts:195`). |
| `https://maps.googleapis.com` | Geocoding for normativa lookup (`src/services/normativa/locationNormativa.ts:250`). |
| `https://*.sentry.io` | Sentry ingest — multi-region wildcard is unavoidable (`o<org>.ingest.<region>.sentry.io`). |
| `wss://*.firebaseio.com` | Realtime DB websockets — kept until full Firestore-only audit. |

## Other security headers

| Header | Value | Scope |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | Always. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Always. |
| `X-Frame-Options` | `DENY` | Belt-and-braces with `frame-ancestors`. |
| `Permissions-Policy` | `camera=(self), microphone=(self), geolocation=(self), accelerometer=(self), gyroscope=(self)` | Self-only. The app legitimately uses each: SOSButton (mic+geo), fall detection (accelerometer/gyroscope), IPER photos (camera), commute tracking (geo). |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` | HTTPS only — gated on `req.secure` OR `X-Forwarded-Proto: https` (Cloud Run). Skipped on plain HTTP so local dev does not pin browsers to HTTPS. |

## Nonce strategy (Sprint 20 13th wave Bucket C)

`'unsafe-inline'` is **gone** from `script-src`. Inline scripts now require
a per-request base64 nonce that matches the `'nonce-<value>'` token in the
CSP header. The flow:

1. `securityHeaders` middleware (`src/server/middleware/securityHeaders.ts`)
   calls `randomBytes(16).toString('base64')` and assigns the value to
   `res.locals.cspNonce` on every request.
2. The same value is embedded into `script-src` as `'nonce-<value>'`.
3. The production SPA fallback in `server.ts` reads the cached
   `dist/index.html` template and replaces every `__CSP_NONCE__` placeholder
   with `res.locals.cspNonce` before sending the response.
4. `index.html` template carries `nonce="__CSP_NONCE__"` on its inline
   `<script>` tags. The browser sees `nonce="<base64>"` and matches it
   against the CSP `script-src 'nonce-<base64>'` token.

### Why `'strict-dynamic'`

The Vite production build emits one external entry script
(`<script type="module" src="/assets/index-XXX.js">`) which lazily
imports child chunks at runtime. With `'strict-dynamic'`, a script that
the browser already trusts (because it bears a valid nonce or is
same-origin via `'self'`) is allowed to load further scripts WITHOUT
each child needing its own nonce. Without `'strict-dynamic'` the lazy
chunks would all need explicit allowlisting.

`'strict-dynamic'` is honoured by Chrome 52+, Firefox 52+, and Safari
15.4+. Older browsers ignore it and fall back to the explicit host
allowlist (`gstatic`, `apis.google`) plus `'self'` — that's why we keep
those entries even though modern browsers no longer consult them.

### How to add a new inline script

1. Add the script to a server-rendered HTML template (today: `index.html`).
2. Include `nonce="__CSP_NONCE__"` as an attribute. The middleware will
   substitute the per-request nonce at serve time.
3. Verify by running `curl -I http://localhost:3000/` and confirming the
   `Content-Security-Policy` header contains `'nonce-<value>'` matching
   the `nonce` attribute on the served HTML.

### Dev-mode caveat

In development (`npm run dev`), Vite's middleware-mode server serves
`index.html` directly (HMR injection, no string-replace pass). The literal
`__CSP_NONCE__` string therefore appears in the dev HTML's nonce attribute,
which would not match any nonce in the CSP header. Inline scripts in dev
rely on the same strict-dynamic / 'self' rules production uses, and the
literal placeholder will simply be treated as an invalid nonce. Dev does
not depend on inline scripts to function (the only inline-attributed tag
is the entry module which loads from `/src/main.tsx`, satisfied by
`'self'`), so this mismatch is invisible to the developer.

### `https:` blanket on `img-src`

Loosened deliberately for user-uploaded thumbnails and Wikipedia/news
illustrations referenced from internal links. Tightening this would require a
proxy or an allowlist of cdn hostnames; deferred until we have real CSP
violation reports against it.

### `*.googleapis.com` wildcard removed (Sprint 20 12th wave Bucket A)

Done. The wildcard token is gone from `connect-src`; explicit subdomains are
listed in the allow-list table above. Tracked as **TM-I05** in
[`STRIDE_findings.md`](./STRIDE_findings.md). If a Firebase / Google Cloud
product is added later that needs a new origin, follow "How to add a new
origin" below — it's now a one-line edit instead of a wildcard relaxation.

### Two retained wildcards

`https://*.sentry.io` and `wss://*.firebaseio.com` remain because:

- Sentry ingest hostnames embed the org-id and ingest region
  (`o<org-id>.ingest.<region>.sentry.io`). Hard-coding our specific
  region would break a future failover.
- Firebase Realtime DB opens a websocket against the project-derived
  `<project>-<region>.firebaseio.com` — no fixed subdomain. This is on
  the audit list to drop entirely if the project goes Firestore-only
  (see `progress.md` in the bucket output).

## CSP violation reporting

`report-uri /api/csp-report` is part of the directive map. The route is
defined in [`src/server/routes/cspReport.ts`](../../src/server/routes/cspReport.ts):

- Mounted before the global rate limiter and `verifyAuth` (browsers fire
  reports without auth context). Per-IP throttle of 50 req/min via a
  dedicated `cspReportLimiter` defends the endpoint from being used to
  burn Sentry quota.
- Body size capped at 16 KB, parsed for both `application/csp-report`
  (the spec MIME) and `application/json` (so curl-based smoke tests work).
- Always responds with `204 No Content`. Never returns a body so an
  attacker cannot use the response shape as an oracle.
- For each report we strip query string + fragment from `blocked-uri`,
  `document-uri`, and `source-file` before logging — a third-party form
  may have included PII in the URL we just blocked.
- Sentry receives both an `addBreadcrumb` (so any error that follows in
  the same session shows the violation on its timeline) and a
  `captureMessage('csp.violation')` for dashboard counting.

To find recent violations in Sentry, search for the message `csp.violation`
or filter on the `security.csp` breadcrumb category. The breadcrumb
payload lists `violated`, `blocked`, `document`, `source`, `line`,
`column`, and `disposition` — enough to reproduce without needing to
re-derive the user's session.

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
