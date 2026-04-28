# Praeventio Guard — Billing scaffolding (Chile + International)

## Status

**ESTE ARCHIVO ES UN ESQUELETO. La integración real con Transbank/Stripe está pendiente — ver TODOs.**

What is now landed:

- Pure invoice math (`src/services/billing/invoice.ts`) with TDD coverage.
- **Webpay (Transbank) — IMPLEMENTED (sandbox)**. Real adapter wired
  against `transbank-sdk` (`WebpayPlus.Transaction`); see "Webpay setup"
  below for the implementation status matrix.
- Stripe adapter still a typed stub (every method throws
  `StripeNotImplementedError`) — separate scope.
- HTTP endpoints (`POST /api/billing/checkout`,
  `POST /api/billing/invoice/:id/mark-paid`,
  `GET /billing/webpay/return`) that persist invoices to a server-only
  Firestore collection (`invoices/{id}`) via the Admin SDK.

What is **not** here yet:

- No `stripe` npm install.
- No SII boleta electrónica integration.
- No `firestore.rules` change for `invoices/{id}` (intentional — the
  collection is admin-only and the default-deny rule keeps it that way).
- Production Webpay commerce code not provisioned (sandbox only).

---

## Architecture

```
                        ┌────────────────────────┐
   browser /            │  POST /api/billing/    │
   capacitor app  ────► │  checkout              │
                        │  (verifyAuth + limiter)│
                        └──────────┬─────────────┘
                                   │ buildInvoice()
                                   ▼
                        ┌────────────────────────┐
                        │ Firestore              │
                        │ invoices/{id}          │  ← admin SDK only,
                        │ status: pending-payment│    default-deny rule
                        └──────────┬─────────────┘
                                   │
                  ┌────────────────┼────────────────┐
                  ▼                ▼                ▼
         ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
         │ webpayAdapter│  │ stripeAdapter│  │ manual-      │
         │ (CLP)        │  │ (USD)        │  │ transfer     │
         └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
                │                 │                 │
        Webpay redirect    Stripe Checkout    admin POST /mark-paid
        + commitTransaction  + webhook            (admin role gate)
                │                 │                 │
                └─────────────────┴─────────────────┘
                                   │
                                   ▼
                         status: 'paid' / 'rejected'
                                / pending-payment (transient)
                         + audit_logs entry
```

The Webpay redirect/return URL flow
(`/billing/webpay/return` ← Transbank ← cardholder browser) is implemented,
including `processed_webpay/{token_ws}` lock-then-complete idempotency.
The Stripe redirect/webhook flow is still pending.

---

## IVA reglas (Chile)

- **CLP siempre con IVA 19%.** Calculated on the aggregate subtotal of
  every line item (base + overage), not per-line.
- **Rounding rule** (matches `withIVA` in `src/services/pricing/tiers.ts`):
  - `total = Math.ceil(subtotal × 1.19)`
  - `iva   = total - subtotal`
  - Invariant: `subtotal + iva === total` exactly.
  - Why `ceil` (not `round`): Chilean B2B display prices end in `$X.990`.
    Reverse-engineering from those targets requires consistent ceiling.
- **USD never carries Chilean IVA.** International invoices are exempt
  (export of services); local taxes (US sales tax, EU VAT, etc.) are the
  customer's jurisdiction and Stripe handles them via Stripe Tax once
  enabled.
- **Mixed-currency invoices are forbidden** — `calculateInvoiceTotals`
  throws if line items disagree on currency.

## RUT emisor

- **`78231119-0`** — Praeventio Guard SpA.
- Hardcoded in `src/services/billing/types.ts` as a literal type so a
  wrong value fails to compile.
- Razón social defaults to `"Praeventio Guard SpA"`; override via
  `BILLING_EMISOR_RAZON_SOCIAL` env var if the legal entity changes.

---

## Webpay setup (Transbank)

### Implementation status

- ✅ `transbank-sdk@^6.1.1` installed (latest published; spec asked for
  `^7` but no v7.x exists on npm — see `npm view transbank-sdk versions`).
- ✅ `WebpayAdapter` real implementation in `src/services/billing/webpayAdapter.ts`:
  - `createTransaction` → `WebpayPlus.Transaction.create()`
  - `commitTransaction` → `WebpayPlus.Transaction.commit()` with three-state
    response mapping (see "Response-code mapping" below).
  - `refundTransaction` → `WebpayPlus.Transaction.refund()` returning `{ type, balance }`.
  - SDK errors wrapped in `WebpayAdapterError` (no silent failures).
- ✅ Sandbox credentials (`IntegrationCommerceCodes.WEBPAY_PLUS` +
  `IntegrationApiKeys.WEBPAY`) are the default — dev / CI / E2E never
  touch a real merchant.
- ✅ `GET /billing/webpay/return` route shipped in `server.ts`. Reads
  `token_ws` query param, runs the lock-then-complete dedupe via
  `processed_webpay/{token_ws}`, calls `commitTransaction`, updates
  `invoices/{buyOrder}.status` to `paid` / `rejected` / stays
  `pending-payment`, writes an `audit_logs` entry on success, redirects to
  `/pricing/success` (paid), `/pricing/failed` (rejected), or
  `/pricing/retry` (transient).
- ✅ Robust idempotency via `processed_webpay/{token}` doc (lock-then-
  complete, mirroring the Google Play RTDN handler). Helpers
  `acquireWebpayIdempotencyLock` + `finalizeWebpayIdempotencyLock` in
  `webpayAdapter.ts`. Doc states: `in_progress` (with 5-min staleness
  window) → `done` (with `outcome` + `invoiceId` for replay-redirects).
- ✅ Unit tests with mocked SDK (`webpayAdapter.test.ts`, 30 cases).
- ⚠️ Production credentials require Transbank commerce-code application
  (KYC + onboarding). Not blocking sandbox dev.
- ⚠️ Boleta electrónica emission post-AUTHORIZED is still TODO.

### Response-code mapping (`commitTransaction`)

Transbank's `response_code` is overloaded — it conflates card-side
declines with infrastructure failures. We split them into three states so
the UI can offer the right next step:

| `response_code`       | `WebpayCommitStatus` | Invoice status      | UX route             |
| --------------------- | -------------------- | ------------------- | -------------------- |
| `0` + `'AUTHORIZED'`  | `AUTHORIZED`         | `paid`              | `/pricing/success`   |
| `-1` … `-8`           | `REJECTED`           | `rejected`          | `/pricing/failed`    |
| `-96`, `-97`, `-98`   | `FAILED` (transient) | `pending-payment`   | `/pricing/retry`     |
| anything else / no `response_code` | `FAILED` (defensive) | `pending-payment` | `/pricing/retry`     |

Why three states, not two:

- `-96` / `-97` / `-98` mean **timeout / network / Transbank unavailable**.
  Mapping them to `REJECTED` would lie to the customer ("your card was
  declined") and steer them to a "try a different card" page when the
  same card would work fine on retry.
- `cancelled` (the previous mapping for non-AUTHORIZED) implies the user
  or an admin chose to cancel. A card decline is not a cancellation.
  `cancelled` is now reserved for explicit user/admin cancellation.

### Environments

| Environment   | Use                              | Credentials                                         |
| ------------- | -------------------------------- | --------------------------------------------------- |
| `integration` | dev / staging / E2E tests        | Transbank "Tienda de Integración" demo credentials  |
| `production`  | real charges                     | Real commerce code + API key from Transbank Onepay  |

### Setup checklist (production)

1. Apply for a Webpay Plus commerce code at <https://www.transbank.cl/>.
2. Receive `commerceCode` + `apiKey` (production) by email after KYC.
3. Set env vars on the server:

   ```bash
   WEBPAY_COMMERCE_CODE=...
   WEBPAY_API_KEY=...
   WEBPAY_ENV=production            # or omit for sandbox (the default)
   APP_BASE_URL=https://app.praeventio.net
   ```

4. Restart the server. `webpayAdapter.isConfigured()` will flip to `true`
   and `/api/billing/checkout` will start producing real Transbank URLs.
5. Idempotency is already in place via `processed_webpay/{token_ws}`
   (server-only Firestore collection, default-deny rules) — no extra
   step needed before going live.

### Test cards (integration env)

- VISA approved: `4051 8856 0044 6623` / CVV `123` / exp `any future`
- VISA rejected: `4051 8842 3993 7763`
- See <https://www.transbank.cl/desarrolladores> for the full list.

---

## Stripe setup (international USD path)

### Setup checklist

1. Create Stripe account; enable Stripe Tax for compliance.
2. Create a Product per tier in the Stripe Dashboard (or via API).
3. Create monthly + annual Prices for each Product. Note the `price_*`
   IDs — these go in env vars, not the codebase, because Stripe is the
   source of truth for the actual charge.
4. Set env vars:

   ```bash
   STRIPE_SECRET_KEY=sk_live_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   STRIPE_API_VERSION=2024-12-18.acacia    # pin deliberately
   STRIPE_PRICE_COMITE_PARITARIO=price_...
   STRIPE_PRICE_DEPARTAMENTO_PREVENCION=price_...
   STRIPE_PRICE_PLATA=price_...
   # ...one per tier id, uppercased with - → _
   ```

5. `npm install stripe` (NOT yet installed).
6. Implement `src/services/billing/stripeAdapter.stripe.ts` against the
   `StripeAdapter` interface.
7. Wire a webhook endpoint. Reuse the existing webhook hardening pattern
   in `server.ts` (`/api/billing/webhook` for Google Play RTDN — see the
   "lock-then-complete" idempotency block at the top of that handler).
8. Stripe webhook signature validation **must** use the raw request body
   — install `express.raw({ type: 'application/json' })` on the route
   *only* (not globally) so the rest of the API still gets JSON parsing.

### Webhook events to handle

| Event                              | Action                                              |
| ---------------------------------- | --------------------------------------------------- |
| `checkout.session.completed`       | Mark invoice `paid`, update user subscription       |
| `invoice.payment_succeeded`        | (renewal) Extend subscription expiry                |
| `invoice.payment_failed`           | Mark invoice `pending-payment`, notify customer     |
| `customer.subscription.deleted`    | Downgrade user to `gratis` tier                     |
| `charge.dispute.created`           | Audit log + alert finance via Resend                |

---

## Boleta electrónica SII

Chilean B2B requires emitting a **boleta** or **factura electrónica**
through the SII (Servicio de Impuestos Internos). We have not picked a
provider yet — candidates:

| Provider     | Notes                                                              |
| ------------ | ------------------------------------------------------------------ |
| OpenFactura  | Pricing per DTE; good REST API; widely used by SaaS.               |
| SimpleAPI    | Lightweight; cheaper at low volume.                                |
| Bsale        | Bigger ecosystem; if we need ERP/inventory later.                  |
| LibreDTE     | Open-source self-hosted option; more ops work.                     |

Once a provider is selected, add a `siiAdapter.ts` mirroring the
Webpay/Stripe pattern (typed interface + stub). The `Invoice` document
already carries `emisorRut`, `emisorRazonSocial`, and itemized lines —
those map cleanly to the SII DTE schema.

---

## Firestore

- Collection: `invoices/{id}`.
- Access: **server-only** via Firebase Admin SDK.
- `firestore.rules` is intentionally not modified — default-deny applies
  and that is what we want. Do **not** add a client-readable rule
  without a threat-model review (PII + tax data + payment state).
- For client UIs that need to show "your invoices", expose a server
  endpoint (`GET /api/billing/invoices/me`) that filters by
  `createdBy === uid` and projects only the safe fields.

Suggested document shape (matches `Invoice` type plus server stamps):

```ts
{
  id, emisorRut, emisorRazonSocial,
  cliente: { nombre, rut?, email },
  lineItems: [...],
  totals: { subtotal, iva, total, currency },
  paymentMethod, issuedAt, status,
  createdBy, createdByEmail, createdAt,
  // After payment:
  paidAt?, paidBy?, paidByEmail?, paymentSource?,
  // After Webpay/Stripe:
  webpayToken?, webpayAuthCode?,
  stripeSessionId?, stripePaymentIntentId?,
}
```

---

## Real integration backlog (TODOs)

The following must happen before this scaffolding is production-ready:

### Webpay (Transbank)

- [x] `npm install transbank-sdk` (`^6.1.1`).
- [x] Tienda de Integración credentials are the built-in default
      (no env vars needed for sandbox).
- [x] Implement `WebpayAdapter` against the SDK (`create` / `commit` /
      `refund`). Stub export replaced in-place; type contract preserved.
- [x] `GET /billing/webpay/return` route — runs lock-then-complete
      dedupe via `processed_webpay/{token_ws}`, calls `commitTransaction`,
      updates `invoices/{id}` status (`paid` / `rejected` / stays
      `pending-payment`), writes audit log on success, redirects to
      `/pricing/success` / `/pricing/failed` / `/pricing/retry`.
- [x] Unit tests with a mock SDK (`webpayAdapter.test.ts`, vitest +
      `vi.mock('transbank-sdk', ...)`, 30 cases including timeout-code
      mapping + idempotency-helper tests).
- [x] Three-state response-code mapping
      (`AUTHORIZED` / `REJECTED` / `FAILED`) so timeout codes
      (`-96`/`-97`/`-98`) keep the invoice retryable instead of
      mislabelling them as card declines.
- [x] Stronger idempotency via `processed_webpay/{token}` doc
      (lock-then-complete pattern, mirroring the Google Play RTDN
      handler) so duplicate redeliveries cannot double-process.
- [ ] Provision **production** commerce code (Transbank KYC) — requires
      legal entity verification + email back from Transbank.
- [ ] PDF receipt generation post-AUTHORIZED (boleta or temp receipt
      until SII integration lands).

### Stripe

- [ ] `npm install stripe`.
- [ ] Create Stripe products + prices for all 9 paid tiers (monthly +
      annual = 18 prices).
- [ ] Implement `StripeAdapter` against the SDK; pin `apiVersion`.
- [ ] Add `POST /api/billing/stripe/webhook` with raw-body parsing
      *only on that route* so signature verification works.
- [ ] Implement the 5 webhook event handlers in the table above.
- [ ] Enable Stripe Tax + Stripe Radar.
- [ ] Add a "Manage subscription" customer portal link
      (`stripe.billingPortal.sessions.create`).

### SII boleta electrónica

- [ ] Pick a provider (OpenFactura / SimpleAPI / Bsale / LibreDTE).
- [ ] Apply for SII certificate + folios (CAF) for the chosen provider.
- [ ] Add `siiAdapter.ts` with `emitirBoleta(invoice)` /
      `emitirFactura(invoice)` methods.
- [ ] Trigger emission in the `mark-paid` flow and after Webpay
      `commitTransaction` returns AUTHORIZED.
- [ ] Store the resulting DTE folio + PDF URL on `invoices/{id}`.

### Hardening

- [ ] Add `GET /api/billing/invoices/me` — paginated, owner-filtered,
      server-side projection of safe fields only.
- [ ] Add `firestore.rules` *test* asserting `invoices/{id}` is
      default-deny for clients (use `@firebase/rules-unit-testing`).
- [ ] Replace `BILLING_TIER_FALLBACK` in `server.ts` with the real
      import from `src/services/pricing/tiers.ts` once that lands
      (IMP1's territory).
- [ ] Add a refund flow (`POST /api/billing/invoice/:id/refund`,
      admin-only, dispatches to the right adapter).
- [ ] Soft-delete + retention policy: invoices older than the SII
      retention window (6 years for tax docs in Chile) need an archival
      strategy — they should not just rot in Firestore.
- [ ] PCI scope: keep all card data inside Webpay/Stripe hosted pages.
      We must never receive a PAN. Add a CSP test asserting no
      `card.stripe.com` iframes are loaded outside hosted checkout.
- [ ] Email receipts via Resend (we already have it wired) — template
      the boleta PDF link + line items en español for CL, English for
      international.
