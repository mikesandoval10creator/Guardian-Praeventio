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

Client receipts are NEVER trusted on their own. The server-side flow is:

```
Client (Capacitor IAP plugin)
  │
  │ 1. user taps "Comprar con Google Play / App Store"
  │ 2. native dialog → user authenticates → store returns receipt
  │
  ▼
POST /api/billing/{google-play|app-store}/validate-receipt   (this PR)
  │
  │ logs the attempt to `iap_receipt_attempts/{auto-id}`
  │ returns 202 Accepted
  │
  │ ── Authoritative grant happens out of band ──
  │
  ▼
Google Play RTDN  →  POST /api/billing/webhook
                   │
                   │ re-fetches `purchases.subscriptions.get`
                   │ writes `users/{uid}.subscription.*`
                   ▼
                  Tier benefit live in Firestore.
```

For Apple, the equivalent is **App Store Server Notifications v2**
(SSN). That webhook handler is **deferred to a follow-up bucket** alongside
the App Store Connect entitlement configuration; today the
`/app-store/validate-receipt` endpoint is a TODO stub that records the
attempt without granting benefit.

### Why 202 Accepted, not 200 OK

Returning 200 would imply the subscription is live, which it isn't until
the store confirms server-to-server. 202 (Accepted, processing) is the
correct semantic and stops a future engineer from accidentally wiring
"set `subscription.status='active'` on receipt-validate response" — they
will see the 202 and know the path isn't done.

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
- [ ] `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` env set; account has Finance access.
- [ ] `GOOGLE_PLAY_PACKAGE_NAME` env set and matches the Play listing.
- [ ] RTDN Pub/Sub topic configured + push subscription wired to
  `POST /api/billing/webhook` with shared-secret header.
- [ ] App Store Connect → App Information → App Store Server Notifications
  → URL points at the (forthcoming) SSN handler, with JWS verification
  against Apple's root CA enabled.
- [ ] "Restore Purchases" button visible somewhere in the app UI (App
  Store Review Guideline 3.1.1).
- [ ] Receipt logs (`iap_receipt_attempts`) reviewed in dashboard for
  fraud signals after the first week of production traffic.

## Related files

- `src/services/billing/iapAdapter.ts` — adapter
- `src/services/billing/iapAdapter.test.ts` — unit tests
- `src/pages/Pricing.tsx` — call site
- `src/server/routes/billing.ts` — `/api/billing/{google-play,app-store}/validate-receipt`
- `src/services/billing/webpayAdapter.ts` / `mercadoPagoAdapter.ts` / `khipuAdapter.ts` — web rails
