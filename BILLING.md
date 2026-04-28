# Praeventio Guard — Billing scaffolding (Chile + International)

## Status

**ESTE ARCHIVO ES UN ESQUELETO. La integración real con Transbank/Stripe está pendiente — ver TODOs.**

This commit lands:

- Pure invoice math (`src/services/billing/invoice.ts`) with TDD coverage.
- Typed contracts for the Webpay (Transbank) and Stripe adapters
  (`webpayAdapter.ts`, `stripeAdapter.ts`) — every method throws
  `*NotImplementedError` until the real SDK is wired.
- Two new HTTP endpoints (`POST /api/billing/checkout`,
  `POST /api/billing/invoice/:id/mark-paid`) that persist invoices to a
  server-only Firestore collection (`invoices/{id}`) via the Admin SDK.

What is **not** here yet:

- No `transbank-sdk` npm install.
- No `stripe` npm install.
- No SII boleta electrónica integration.
- No `firestore.rules` change for `invoices/{id}` (intentional — the
  collection is admin-only and the default-deny rule keeps it that way).

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
                         + audit_logs entry
```

The redirect/return URL flow (browser ↔ Transbank ↔ our `/billing/return`)
is **not** implemented yet — see the Webpay TODOs.

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

### Environments

| Environment   | Use                              | Credentials                                         |
| ------------- | -------------------------------- | --------------------------------------------------- |
| `integration` | dev / staging / E2E tests        | Transbank "Tienda de Integración" demo credentials  |
| `production`  | real charges                     | Real commerce code + API key from Transbank Onepay  |

### Setup checklist

1. Apply for a Webpay Plus commerce code at <https://www.transbank.cl/>.
2. Receive `commerceCode` + `apiKey` (production) by email after KYC.
3. Set env vars on the server:

   ```bash
   WEBPAY_COMMERCE_CODE=...
   WEBPAY_API_KEY=...
   WEBPAY_ENVIRONMENT=integration  # or 'production'
   APP_BASE_URL=https://app.praeventio.net
   ```

4. `npm install transbank-sdk` (NOT yet installed — deliberate).
5. Create `src/services/billing/webpayAdapter.transbank.ts` implementing
   the `WebpayAdapter` interface. Replace the stub export in
   `webpayAdapter.ts` once green.
6. Implement the return URL handler at `/billing/return` that calls
   `commitTransaction(token)` and updates `invoices/{id}` to `paid` or
   `cancelled`.
7. **Idempotency**: Webpay can re-deliver the commit if the user reloads
   — guard with the same pattern used for Google Play RTDN (lock-then-
   complete via a `processed_webpay/{token}` doc).

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

- [ ] `npm install transbank-sdk`.
- [ ] Provision Tienda de Integración credentials, store as env vars.
- [ ] Implement `WebpayAdapter` against the SDK
      (`createTransaction` → `Transaction.create()`,
      `commitTransaction` → `Transaction.commit()`,
      `refundTransaction` → `Transaction.refund()`).
- [ ] Replace the stub export in `webpayAdapter.ts` with the real
      implementation — keep the type contract identical.
- [ ] Add `GET /billing/return` route that pulls the `token_ws` form
      field, calls `commitTransaction`, and updates `invoices/{id}`.
- [ ] Add idempotency via `processed_webpay/{token}` doc using the same
      lock-then-complete pattern as the Google Play RTDN handler.
- [ ] Apply for production commerce code after smoke-testing in
      integration.
- [ ] Add unit tests with a mock SDK (DI the adapter into a small
      `webpayService` so tests don't hit the real network).

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
