# Secrets Runbook

> Sprint 21 / Ola 6 / Bucket U.4. Single source of truth for every
> secret a developer or operator must paste before booting Praeventio
> Guard in production.

For each entry: **Qué es**, **Dónde obtenerlo**, **Formato esperado**,
**Dónde se usa** (file path), **Cómo rotarlo**.

Run `npm run validate:env` to assert the current `.env` is complete and
free of placeholders. The validator (`scripts/validate-env.cjs`) checks
non-emptiness, the `^(YOUR_|MY_|REPLACE_|PLACEHOLDER|<.*>)` placeholder
regex, `minLength`, and `allowedValues` for the variables in this
document.

---

## VITE_GOOGLE_MAPS_API_KEY

- **Qué es**: Google Maps JavaScript API key. Loads `tilt: 45`
  buildings + drawing-manager polygons on Site25DPanel and four
  emergency maps.
- **Dónde obtenerlo**:
  1. https://console.cloud.google.com/apis/credentials
  2. Pick the GCP project that owns the app.
  3. "Create credentials" → "API key".
  4. Restrict it: HTTP referrers → your domain(s). Enabled APIs →
     Maps JavaScript API + Drawing API.
- **Formato esperado**: `AIzaSy[A-Za-z0-9_-]{33}` (39 chars, starts
  with `AIza`).
- **Dónde se usa**: `src/components/digital-twin/Site25DPanel.tsx`,
  `src/components/maps/SiteMap.tsx`, all components in
  `src/components/emergency/*Map.tsx`.
- **Cómo rotarlo**: Cada 6 meses o ante leak. Generate new key in same
  console, deploy, then delete the old key once metrics show zero
  hits on the previous one.

## VITE_FIREBASE_VAPID_KEY

- **Qué es**: Web Push VAPID public key for FCM web tokens.
- **Dónde obtenerlo**:
  1. https://console.firebase.google.com/
  2. Project settings → Cloud Messaging → Web configuration → Web
     Push certificates → "Generate key pair".
  3. Copy the public key (BPxxxxx...).
- **Formato esperado**: ~88 char base64url string (starts with `B`).
- **Dónde se usa**: `src/services/push/usePushNotifications.ts`,
  `src/components/emergency/SOSButton.tsx`.
- **Cómo rotarlo**: Generating a new pair invalidates ALL existing
  tokens; users must re-subscribe. Avoid except after suspected
  compromise.

## GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET

- **Qué es**: OAuth 2.0 Web client credentials for Google Calendar
  and Google Fit access.
- **Dónde obtenerlo**:
  1. https://console.cloud.google.com/apis/credentials
  2. "Create credentials" → "OAuth client ID" → "Web application".
  3. Authorized redirect URIs: `${APP_URL}/auth/google/callback`.
  4. Copy client ID (ends in `.apps.googleusercontent.com`) and
     client secret.
- **Formato esperado**:
  - `GOOGLE_CLIENT_ID`: `[0-9]+-[a-z0-9]{32}.apps.googleusercontent.com`
  - `GOOGLE_CLIENT_SECRET`: ~24 chars (`GOCSPX-...`).
- **Dónde se usa**: `src/server/services/oauthGoogle.ts`.
- **Cómo rotarlo**: Anual o tras leak. Create a second secret on
  the same client, deploy, delete the old. Client ID does not rotate.

## SESSION_SECRET

- **Qué es**: Symmetric secret used by `express-session` to sign
  session cookies. Production refuses to boot without it (server.ts
  throws).
- **Dónde obtenerlo**: Generate locally — never reuse another
  service's secret.
  ```bash
  openssl rand -hex 32
  ```
- **Formato esperado**: ≥32 chars, hex preferred.
- **Dónde se usa**: `server.ts` (search `SESSION_SECRET`).
- **Cómo rotarlo**: Cada 90 días. Rotation logs out every active
  session; schedule during low-traffic window.

## IOT_WEBHOOK_SECRET

- **Qué es**: HMAC-SHA256 secret used by IoT producers to sign
  telemetry payloads (RFC 8785 canonical JSON).
- **Dónde obtenerlo**:
  ```bash
  openssl rand -hex 32
  ```
- **Formato esperado**: ≥32 chars.
- **Dónde se usa**: `src/server/routes/telemetry.ts` and matching
  client signers in producer firmware.
- **Cómo rotarlo**: Distribute new secret to all producers via secure
  channel, deploy server with both old and new accepted (overlap
  window), then drop the old. The `LEGACY_HMAC_FALLBACK` flag is for
  the canonical-JSON migration only — not for general rotation.

## MP_IPN_SECRET

- **Qué es**: HMAC secret for MercadoPago IPN webhook
  (`/api/billing/webhook/mercadopago`).
- **Dónde obtenerlo**:
  1. https://www.mercadopago.com.ar/developers/panel/app
  2. Open your app → "Webhooks" → copy the signing secret.
- **Formato esperado**: ≥16 chars, MercadoPago issues 32+ char
  alphanumeric tokens.
- **Dónde se usa**: `src/services/billing/mercadoPagoIpn.ts`,
  `src/server/routes/billing.ts`.
- **Cómo rotarlo**: Anual. Use MercadoPago's UI to generate a new
  token; deploy with the new value. There is NO overlap window —
  schedule a brief webhook downtime.

## GOOGLE_PLAY_PACKAGE_NAME + GOOGLE_PLAY_SERVICE_ACCOUNT_JSON + GOOGLE_PLAY_RTDN_TOPIC

- **Qué es**: Android in-app billing trio. `PACKAGE_NAME` identifies
  the app; `SERVICE_ACCOUNT_JSON` is a JWT-signing service account
  JSON file inlined as a string; `RTDN_TOPIC` is the Pub/Sub topic
  Google Play posts realtime notifications to.
- **Dónde obtenerlo**:
  1. `PACKAGE_NAME`: from `capacitor.config.ts` → `appId`. Example:
     `com.praeventio.guard`.
  2. `SERVICE_ACCOUNT_JSON`:
     a. Cloud Console → IAM → Service Accounts → Create.
     b. Grant role: "Service Account User" + Play Console role
        "View financial data, orders and cancellation survey
        responses".
     c. Add it in Play Console → Setup → API access → grant access.
     d. Create JSON key, paste full file contents on a single line
        (escape internal newlines).
  3. `RTDN_TOPIC`:
     a. Cloud Console → Pub/Sub → Create topic.
     b. In Play Console → Monetisation setup → Real-time developer
        notifications → paste topic name `projects/<gcp>/topics/<name>`.
- **Formato esperado**:
  - `PACKAGE_NAME`: reverse-DNS, ASCII.
  - `SERVICE_ACCOUNT_JSON`: valid JSON with `private_key`,
    `client_email`, `token_uri`.
  - `RTDN_TOPIC`: `projects/{gcp-project}/topics/{name}`.
- **Dónde se usa**: `src/services/billing/googlePlayAdapter.ts`,
  `src/server/routes/billing.ts`.
- **Cómo rotarlo**: Service account key — every 90 days. Delete old
  key in Cloud Console after deploy.

## SENTRY_DSN + VITE_SENTRY_DSN

- **Qué es**: Sentry Data Source Name (project-specific URL). Backend
  uses Node SDK; frontend uses React SDK.
- **Dónde obtenerlo**:
  1. https://praeventio.sentry.io/settings/projects/guardian-praeventio/keys/
  2. Click the project DSN to copy.
- **Formato esperado**:
  `https://<32-hex>@o<orgId>.ingest.us.sentry.io/<projectId>`.
- **Dónde se usa**: `server.ts` (Sentry.init), `src/lib/sentry.ts`.
- **Cómo rotarlo**: ROTATE NOW si se sospecha leak (la memoria del
  usuario menciona commits `b13cfe8` y `d5e7a8e` con DSN expuesto).
  Sentry → Project Settings → Client Keys → "Disable" the old key
  and "Create" a new one. The disable+create is atomic; deploy with
  the new DSN immediately after.

## KMS_ADAPTER

- **Qué es**: Selector for the Key Encryption Key source.
- **Dónde obtenerlo**: It is not a secret, it is an enum.
  - `cloud-kms` — production. Reads KEK from Google Cloud KMS.
    Requires GCP credentials available to the Cloud Run runtime.
  - `in-memory-dev` — local development only. Generates an ephemeral
    KEK in memory and warns at boot.
- **Formato esperado**: literal `cloud-kms` or `in-memory-dev`.
- **Dónde se usa**: `server.ts` boot, all callers of
  `kmsEnvelope.encrypt/decrypt`.
- **Cómo rotarlo**: KMS_ADAPTER itself never rotates. The KEK *does*
  — see `KMS_ROTATION.md` for the 90-day schedule.

## KHIPU_RECEIVER_ID + KHIPU_SECRET (optional)

- **Qué es**: Khipu (CL bank-transfer gateway) merchant credentials.
  Optional — the adapter falls back to documented sandbox defaults
  when blank.
- **Dónde obtenerlo**: https://khipu.com/ → register as cobrador →
  Cuenta → API → "ID de cobrador" + "Secret".
- **Formato esperado**:
  - `RECEIVER_ID`: numeric.
  - `SECRET`: ~30 char alphanumeric.
- **Dónde se usa**: `src/services/billing/khipuAdapter.ts`.
- **Cómo rotarlo**: Bajo demanda en Khipu portal.

## WEBPAY_COMMERCE_CODE + WEBPAY_API_KEY

- **Qué es**: Transbank Webpay Plus credentials. Empty values fall
  back to the SDK's "Tienda de Integración" defaults — fine for
  dev/CI/E2E but production MUST set both.
- **Dónde obtenerlo**:
  1. https://www.transbank.cl/ → contractar Webpay Plus.
  2. After approval, the portal hands over commerce code (numeric)
     and API key.
  3. Cross-reference against `docs/runbooks/TRANSBANK_RUNBOOK.md`
     for sandbox vs prod tarjetas de prueba.
- **Formato esperado**:
  - `COMMERCE_CODE`: 12-digit numeric.
  - `API_KEY`: 16 char alphanumeric.
- **Dónde se usa**: `src/services/billing/webpayAdapter.ts`.
- **Cómo rotarlo**: Solicitar regeneración a Transbank.

## GEMINI_API_KEY

- **Qué es**: Google Generative Language API key for Gemini models.
  Powers Vision Analyzer, El Guardián chat, posture analysis,
  hazmat designer.
- **Dónde obtenerlo**: https://aistudio.google.com/app/apikey
  → "Create API key". For prod, restrict it to your GCP project.
- **Formato esperado**: `AIzaSy[A-Za-z0-9_-]{33}` (same shape as
  Maps key but distinct value).
- **Dónde se usa**: many — search `process.env.GEMINI_API_KEY` and
  the `@google/genai` import. Centralised facade:
  `src/services/gemini/geminiBackend.ts`.
- **Cómo rotarlo**: Cada 90 días o tras leak. Same console,
  generate then delete the old key after deploy.

## PHOTOGRAMMETRY_WORKER_URL + PHOTOGRAMMETRY_WORKER_TOKEN (optional)

- **Qué es**: Cloud Run COLMAP CPU pipeline endpoint and bearer
  token. Server-side only — never prefix with `VITE_` (the token
  must not leak into the browser bundle).
- **Dónde obtenerlo**: deploy worker via `docs/photogrammetry-deploy.md`,
  then take the Cloud Run URL printed by `gcloud run deploy` and a
  bearer token you generate (`openssl rand -hex 24`).
- **Formato esperado**:
  - `WORKER_URL`: `https://...a.run.app`.
  - `WORKER_TOKEN`: ≥24 chars random.
- **Dónde se usa**: `src/services/digitalTwin/colmapAdapter.ts`.
- **Cómo rotarlo**: Cada 6 meses. Set Cloud Run env var with the
  new token, redeploy, then update the API backend env.

## DWG_CONVERTER_URL + DWG_CONVERTER_TOKEN (optional)

- **Qué es**: Cloud function exposing LibreDWG (or ODA File
  Converter) for the `/api/cad/convert-dwg` endpoint. Without these
  set, the endpoint returns 501 and `AutoCADViewer.tsx` stays in
  DXF-only mode.
- **Dónde obtenerlo**: deploy a converter (LibreDWG container or
  ODA-licensed binary) to Cloud Run, then take the URL and a bearer
  token.
- **Formato esperado**: HTTPS URL + ≥24 char bearer.
- **Dónde se usa**: `src/server/routes/cad.ts`.
- **Cómo rotarlo**: Cada 6 meses, igual que photogrammetry.

## ANDROID_KEYSTORE_BASE64 + ANDROID_KEYSTORE_PASSWORD + KEY_ALIAS + KEY_PASSWORD

- **Qué es**: Android signing keystore + credentials. Required only
  by the mobile-release CI job (Bucket S, fastlane). The web app
  does not need them.
- **Dónde obtenerlo**: Generate once and store FOREVER:
  ```bash
  keytool -genkey -v -keystore praeventio.keystore \
    -alias praeventio -keyalg RSA -keysize 2048 -validity 36500
  base64 -i praeventio.keystore | tr -d '\n' > keystore.b64
  ```
  Paste the `.b64` content into the GitHub secret. Aliases /
  passwords go in their own secrets.
- **Formato esperado**:
  - `KEYSTORE_BASE64`: long base64 blob, no newlines.
  - `KEY_ALIAS`: alphanumeric (e.g. `praeventio`).
  - passwords: ≥12 chars.
- **Dónde se usa**: `.github/workflows/mobile-release.yml`,
  `fastlane/Fastfile`.
- **Cómo rotarlo**: NEVER. Losing this keystore means you can never
  publish an update to the existing Play Store listing — store a
  copy in two separate password managers.

## MODAL_SUBMIT_URL + MODAL_STATUS_URL + MODAL_TOKEN (optional)

- **Qué es**: Modal.run + Meshroom GPU photogrammetry alternative.
  Server-side only.
- **Dónde obtenerlo**: `cd infra/modal-photogrammetry && modal deploy app.py`.
  Modal prints the submit/status/cancel URLs at the end of the
  deploy. Token: generated by you (`openssl rand -hex 24`) and
  configured in `app.py`.
- **Formato esperado**: HTTPS modal.run URLs + ≥24 char bearer.
- **Dónde se usa**: `src/services/digitalTwin/modalAdapter.ts`.
- **Cómo rotarlo**: Bajo demanda — Modal does not enforce expiry.

---

## Acciones de seguridad inmediatas

These are NOT optional. Treat them as Sprint 21 exit criteria:

1. **Rotar SENTRY_DSN ahora**. La memoria del usuario indica que el
   DSN actual quedó leaked en commits `b13cfe8` y `d5e7a8e`. Pasos:
   - Sentry UI → guardian-praeventio → Settings → Client Keys
     → "New Key" → name it `post-2026-05-04-rotation`.
   - Disable the old key.
   - Deploy server + frontend with new DSN.
   - Verify Sentry "Issues" continues receiving traffic.
2. **Confirmar que `GEMINI_API_KEY` de la sesión NO quedó en repo**:
   ```bash
   git log --all -p -S 'GEMINI_API_KEY' -- '*.env*' '*.md' '*.ts' '*.tsx' '*.cjs'
   git log --all -p -S 'AIzaSy' -- ':!docs/runbooks/SECRETS_RUNBOOK.md'
   ```
   If anything matches outside this runbook (which only documents
   the *prefix*, not a real key), rotate the Gemini key in
   AI Studio and force-rewrite history.
3. **Auditar `git log --all -p` por leaks pasados**:
   ```bash
   git log --all -p | grep -E 'YOUR_|MY_|sk-|AIza|secret_|client_secret' | head -50
   ```
   Anything that looks like a real secret in history must be
   rotated regardless of when it was committed — git history is
   forever.

---

Last updated: 2026-05-04 (Sprint 21 / Ola 6 / Bucket U).
