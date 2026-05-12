# Billing — In-App Purchases (Apple / Google) and Web Rails

Sprint 21 Ola 6 Bucket T — unified IAP adapter (`src/services/billing/iapAdapter.ts`).

## Why a unified adapter

The web app uses three Chilean / LATAM rails:
- Webpay (Transbank) — CL cards
- MercadoPago — PE / AR / CO / MX / BR cards
- Khipu — CL bank transfers (B2B)

Apple App Store and Google Play **forbid digital subscriptions from flowing
through alternate rails inside the app binary.** Routing a tier purchase
through Webpay from the iOS or Android build is a takedown-grade compliance
violation. The `IapAdapter` enforces the platform → provider mapping so a
caller cannot accidentally invoke Webpay on an iOS device.

## Platform ↔ provider mapping

| Platform | Available providers (in priority order) | Notes |
|----------|------------------------------------------|-------|
| `web`    | `webpay`, `mercadopago`, `khipu`         | Caller picks based on country detection. |
| `android`| `google-play`                            | Single provider; store policy. |
| `ios`    | `app-store`                              | Single provider; store policy. |

`IapAdapter.getPlatform()` wraps `Capacitor.getPlatform()` with a defensive
`'web'` fallback for SSR / unit-test contexts where Capacitor is not bootstrapped.

## SKU IDs

| SKU id                          | Type        | CLP base | Period |
|---------------------------------|-------------|----------|--------|
| `praeventio_premium_monthly`    | subscription| 9.990    | 30 d   |
| `praeventio_premium_annual`     | subscription| 95.904   | 365 d  |

The same SKU id must be configured **identically** in:
- Google Play Console → Products → In-app subscriptions
- App Store Connect → Subscriptions → Subscription group
- `WEB_CATALOG` constant inside `iapAdapter.ts`

A drift (e.g. `praeventio_premium_monthly` on Play vs `praeventio.premium.monthly`
on Apple) breaks `listProducts()` matching and leaves users on a blank purchase
sheet.

## Server-side receipt validation flow

Client receipts are NEVER trusted on their own. The server-side flow has
TWO complementary layers:

```
Client (Capacitor IAP plugin)
  │
  │ 1. user taps "Comprar con Google Play / App Store"
  │ 2. native dialog → user authenticates → store returns receipt
  │
  ▼
POST /api/billing/{google-play|app-store}/validate-receipt   ← SYNC LAYER
  │
  │ Sprint 39 P0.3 — calls the store's authoritative API:
  │   • Google Play: androidpublisher.purchases.subscriptionsv2.get
  │   • Apple: App Store Server API /inApps/v1/transactions/{id}
  │ Returns 200 with the verified expiry / state on success,
  │ 400 on rejection (forged / mismatched / expired),
  │ 502 on validator config error, 503 on transient store outage.
  │ Always writes `iap_receipt_attempts/{auto}` with outcome+reason.
  │
  │ ── Async lifecycle events keep going through the webhook ──
  │
  ▼
Google Play RTDN  →  POST /api/billing/webhook                ← ASYNC LAYER
App Store SSN v2  →  POST /api/billing/webhook/apple
                   │
                   │ re-fetches the same authoritative API,
                   │ writes `users/{uid}.subscription.*`,
                   │ handles renewals / refunds / expiry.
                   ▼
                  Tier benefit live in Firestore.
```

The synchronous layer unblocks the client immediately on a real purchase
and rejects forged receipts at the door. The async layer keeps the
Firestore subscription state in sync with the store's truth across
renewals and refunds.

### Why the validator returns 200 not 202

Pre-Sprint-39 the endpoint returned 202 with a "we'll grant when RTDN
fires" message because the validation was a TODO. Now that the validator
makes the real `purchases.subscriptionsv2.get` (or App Store Server API)
call before responding, the receipt is either *cryptographically proven
to be a real, active purchase* or rejected. 200 is the correct semantic
for that proof.

## Validator environment variables

### Google Play
- `ANDROID_PACKAGE_NAME` — e.g. `com.praeventio.guard`. Required.
- `GOOGLE_APPLICATION_CREDENTIALS` — path to the service account JSON
  with `Manage orders and subscriptions` access in Play Console. In Cloud
  Run, omit this and use Workload Identity bound to the same SA.
- `GOOGLE_PLAY_ALLOW_TEST_PURCHASES` — `'true'` in staging to accept
  license-tester purchases; unset in production.

### Apple App Store
- `APPLE_BUNDLE_ID` — e.g. `com.praeventio.guard`. Required.
- `APPLE_API_KEY_PATH` — filesystem path to the `.p8` private key from
  App Store Connect → Users and Access → Keys. Required.
- `APPLE_KEY_ID` — 10-char Key ID alongside the `.p8`. Required.
- `APPLE_ISSUER_ID` — UUID Issuer ID from App Store Connect (NOT the
  Team ID — common confusion). Required.

The `.p8` file is read on every validate call (~milliseconds), so
rotation is just an atomic file replace; no service restart needed.

## Restore Purchases (iOS requirement)

App Store Review Guideline 3.1.1 mandates that any app with subscriptions
expose a "Restore Purchases" affordance. `IapAdapter.restorePurchases()`
delegates to the Capacitor plugin's `restorePurchases()` which iterates the
on-device entitlement cache.

On Android the BillingClient handles this transparently (Play caches active
subscriptions per Google account), but we expose the same method so the UI
can render a single unified button. On web we return `[]` — there is
nothing to restore, the subscription state lives in Firestore keyed by uid.

## Subscription lifecycle

Each store fires a series of webhook events; we map these to the
canonical Firestore `users/{uid}.subscription.status` enum:

| Event                          | Google Play (RTDN type)             | App Store (SSN notificationType) | Mapped to |
|--------------------------------|-------------------------------------|----------------------------------|-----------|
| Initial purchase               | `SUBSCRIPTION_PURCHASED`            | `SUBSCRIBED`                     | `active`  |
| Renewal                        | `SUBSCRIPTION_RENEWED`              | `DID_RENEW`                      | `active`  |
| User cancelled (still in term) | `SUBSCRIPTION_CANCELED`             | `DID_CHANGE_RENEWAL_STATUS` (auto-renew off) | `cancel-pending` |
| Expired (no renewal)           | `SUBSCRIPTION_EXPIRED`              | `EXPIRED`                        | `expired` |
| Refunded                       | `SUBSCRIPTION_REVOKED` / `ON_HOLD`  | `REFUND` / `REVOKE`              | `refunded`|
| Grace period (billing retry)   | `SUBSCRIPTION_IN_GRACE_PERIOD`      | `GRACE_PERIOD_EXPIRED`           | `active`  |

Status transitions are idempotent — RTDN can redeliver, so the handler
uses the same `processed_pubsub` lock pattern as the Webpay return.

## Testing in sandbox

### Google Play

1. Create a license-tester account in Play Console → Setup → License testing.
2. Sign the test device into the tester's Google account.
3. Internal-track release with the tester whitelisted.
4. Purchases are real flows but no real money charged.

### App Store

1. App Store Connect → Users and Access → Sandbox → Tester.
2. On the device: Settings → App Store → Sandbox Account.
3. The sandbox renews subscriptions on accelerated timers (1 month
   = 5 minutes, 1 year = 1 hour) so renewal flows can be verified.

## Operational checklist before going live

- [ ] SKU ids match exactly across Play Console / App Store Connect / `WEB_CATALOG`.
- [ ] `ANDROID_PACKAGE_NAME` env set and matches the Play listing.
- [ ] `GOOGLE_APPLICATION_CREDENTIALS` set (or Workload Identity in Cloud
  Run) with `Manage orders and subscriptions` access on the SA.
- [ ] `APPLE_BUNDLE_ID`, `APPLE_API_KEY_PATH`, `APPLE_KEY_ID`,
  `APPLE_ISSUER_ID` env set; `.p8` file mounted via Secret Manager.
- [ ] RTDN Pub/Sub topic configured + push subscription wired to
  `POST /api/billing/webhook` with shared-secret header.
- [ ] App Store Connect → App Information → App Store Server Notifications
  v2 URL points at `POST /api/billing/webhook/apple` — JWS verification
  is already implemented (`appleSsn.ts`, leaf-only; full Apple Root G3
  chain is a documented follow-up).
- [ ] "Restore Purchases" button visible somewhere in the app UI (App
  Store Review Guideline 3.1.1).
- [ ] Receipt logs (`iap_receipt_attempts`) reviewed in dashboard for
  fraud signals after the first week of production traffic — every row
  carries `outcome` (granted|rejected|error) + `reason`.

## Related files

- `src/services/billing/iapAdapter.ts` — adapter
- `src/services/billing/iapAdapter.test.ts` — unit tests
- `src/services/billing/googlePlayValidator.ts` + `.test.ts` — Sprint 39 synchronous Play validator
- `src/services/billing/appleTransactionValidator.ts` + `.test.ts` — Sprint 39 synchronous Apple validator
- `src/services/billing/appleSsn.ts` — Apple SSN v2 webhook verifier (shared JWS helper)
- `src/pages/Pricing.tsx` — call site
- `src/server/routes/billing.ts` — `/api/billing/{google-play,app-store}/validate-receipt`
- `src/services/billing/webpayAdapter.ts` / `mercadoPagoAdapter.ts` / `khipuAdapter.ts` — web rails
