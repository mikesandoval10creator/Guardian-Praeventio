# Praeventio Guard — Billing scaffolding (Chile + International)

## Status

**ESTE ARCHIVO ES UN ESQUELETO. La integración real con Transbank/Khipu/Google Play está pendiente — ver TODOs. Stripe fue descartado por decisión D3 (2026-05-03); no se reintroduce.**

What is now landed:

- Pure invoice math (`src/services/billing/invoice.ts`) with TDD coverage.
- **Webpay (Transbank) — IMPLEMENTED (sandbox)**. Real adapter wired
  against `transbank-sdk` (`WebpayPlus.Transaction`); see "Webpay setup"
  below for the implementation status matrix.
- ~~Stripe adapter~~ **REMOVED — decisión D3 (2026-05-03).** Stripe queda
  fuera del producto de forma definitiva. Las pasarelas oficiales son
  Transbank/Webpay (CL web), Khipu (CL web alt) y Google Play Billing
  (Android). iOS deferido. Cualquier referencia residual a Stripe en
  esta página se mantiene como contexto histórico/migración pero no como
  trabajo pendiente.
- HTTP endpoints (`POST /api/billing/checkout`,
  `POST /api/billing/invoice/:id/mark-paid`,
  `GET /billing/webpay/return`) that persist invoices to a server-only
  Firestore collection (`invoices/{id}`) via the Admin SDK.

What is **not** here yet:

- No `stripe` npm install (y nunca lo habrá — D3).
- No Khipu adapter aún (pendiente — pasarela CL alternativa a Webpay).
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
                  ┌────────────┬────┴───┬────────────┐
                  ▼            ▼        ▼            ▼
         ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
         │ webpayAdapter│  │ khipuAdapter │  │ googlePlay   │  │ manual-      │
         │ (CLP web)    │  │ (CLP web alt)│  │ Billing(AND) │  │ transfer     │
         └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
                │                 │                 │                 │
        Webpay redirect      Khipu redirect     Play Billing     admin POST /mark-paid
        + commitTransaction  + webhook          + RTDN webhook   (admin role gate)
                │                 │                 │
                └────────────┴────────┴────────────┘
                                   │
                                   ▼
                         status: 'paid' / 'rejected'
                                / pending-payment (transient)
                         + audit_logs entry
```

The Webpay redirect/return URL flow
(`/billing/webpay/return` ← Transbank ← cardholder browser) is implemented,
including `processed_webpay/{token_ws}` lock-then-complete idempotency.
The Khipu and Google Play Billing redirect/webhook flows are still pending.

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
  customer's jurisdiction. Sin Stripe (D3): los impuestos por
  jurisdicción internacional se manejarán contra factura manual o vía
  Google Play Billing (que aplica tax automatically en Android consumer)
  hasta que se evalúe una pasarela cross-border alternativa.
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

## MercadoPago IPN — OIDC verification (R20 A5)

R19 A9 shipped MP IPN OIDC support with a ~120 LOC in-house RS256
verifier (split JWS → `crypto.createPublicKey({format:'jwk'})` →
`crypto.verify`) explicitly to avoid coupling to an undeclared transitive
`jose` package. R20 A5 declares `jose@^5` as a direct dependency in
`package.json` and swaps the in-house verifier for `jose.jwtVerify` +
`jose.importJWK` (Pattern A — JWKS still resolved via `mpJwksCache` to
preserve the `_setJwksFetcherForTests` test seam). Rationale:
library-grade timing-safe verification, ~120 LOC of crypto plumbing
removed, smaller attack surface (no in-house base64url padding or
JWK→PEM coercion), and a new `MP_OIDC_CLOCK_TOLERANCE_SEC` env knob
plumbed straight through to jose's `clockTolerance`.

---

## Khipu setup (CL web alternativa a Webpay)

### Pendiente — pasarela CL alternativa

Khipu permite pagos por transferencia bancaria CL sin pasar por la red
de tarjetas (menores comisiones, ideal para B2B Titanio+ que ya usan
transferencia manual). Cuando se implemente:

1. Crear cuenta Khipu Cobros (<https://khipu.com/>).
2. Generar `receiver_id` + `secret` (sandbox primero).
3. Implementar `src/services/billing/khipuAdapter.ts` con
   `createPayment()` (devuelve URL de pago) y `verifyNotification()`
   (HMAC sobre payload del webhook Khipu).
4. Variables de entorno:

   ```bash
   KHIPU_RECEIVER_ID=...
   KHIPU_SECRET=...
   KHIPU_ENV=integration            # o `production`
   ```

5. Webhook: `POST /api/billing/khipu/webhook` con verificación HMAC
   antes de tocar Firestore. Reusar el patrón
   `processed_khipu/{notification_id}` (lock-then-complete) ya
   establecido para Webpay/RTDN.

### Google Play Billing (Android consumer / B2B Android)

Ya existe el handler RTDN (`/api/billing/webhook` en `server.ts`).
Pendiente:

1. Crear productos `subs` en Play Console por tier (gratis NO se crea —
   Play exige producto pago).
2. Linkear `purchaseToken` ↔ `invoices/{id}` durante el server-side
   acknowledge.
3. Manejar los 5 RTDN notification types (SUBSCRIPTION_PURCHASED,
   RENEWED, IN_GRACE_PERIOD, CANCELED, EXPIRED) → status invoice.

---

## Boleta electrónica SII

**Status: scaffolded; PSE pick pending.** See
[`SII_INTEGRATION.md`](./SII_INTEGRATION.md) for the full runbook.

Chilean B2B requires emitting a **boleta** or **factura electrónica**
through the SII (Servicio de Impuestos Internos) per Resolución Exenta
SII 80/2014 — the customer is legally entitled to a tax receipt within
24h of payment.

The scaffolding lives in `src/services/sii/`:

- `types.ts` — typed `DteRequest` / `DteResponse` / `SiiAdapter`
  contract per SII DTE schema (types 33, 39, 41, 56, 61).
- `siiAdapter.ts` — shared helpers including `calculateDteTotals` (uses
  the same `Math.ceil(net * 0.19)` rule as `pricing/tiers.ts:withIVA`)
  plus a `noopSiiAdapter` for dev/CI.
- `openfacturaAdapter.ts`, `simpleApiAdapter.ts`, `bsaleAdapter.ts`,
  `libredteAdapter.ts` — stubs that throw `SiiNotImplementedError` with
  the PSE's docs URL until Round 2 picks one.
- `index.ts` — `getSiiAdapter()` resolves the active adapter from
  `SII_PSE`; falls back to `noop` when unset so dev never crashes.

PSE candidates (full comparison in the runbook):

| Provider     | Notes                                                              |
| ------------ | ------------------------------------------------------------------ |
| OpenFactura  | Pricing per DTE; good REST API; widely used by SaaS.               |
| SimpleAPI    | Lightweight; cheaper at low volume.                                |
| Bsale        | Bigger ecosystem; if we need ERP/inventory later.                  |
| LibreDTE     | Open-source self-hosted option; more ops work.                     |

The `Invoice` document already carries `emisorRut`, `emisorRazonSocial`,
and itemized lines — those map cleanly to the SII DTE schema.

**Round 2 wiring** (deferred): replace one PSE stub with a real call,
then trigger emission from `GET /billing/webpay/return` (after AUTHORIZED)
and `POST /api/billing/invoice/:id/mark-paid`, persisting the result to
`dte_emissions/{folio}`.

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
  // After Webpay/Khipu/GooglePlay:
  webpayToken?, webpayAuthCode?,
  khipuPaymentId?, khipuTransactionId?,
  playPurchaseToken?, playOrderId?,
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

### ~~Stripe~~ — DESCARTADO (D3, 2026-05-03)

Decisión definitiva: Praeventio no usará Stripe. Las alternativas son:
- **Khipu** (CL web alt — transferencia bancaria, sin red de tarjetas).
- **Google Play Billing** (Android consumer).
- iOS: diferido hasta primer cliente iOS confirmado.

### Khipu (CL web alternativa)

- [ ] Crear cuenta Khipu Cobros + sandbox.
- [ ] Implementar `KhipuAdapter` (`createPayment` + `verifyNotification`).
- [ ] `POST /api/billing/khipu/webhook` con verificación HMAC.
- [ ] Idempotencia `processed_khipu/{notification_id}`.
- [ ] Tests unitarios mockeados (siguiendo patrón `webpayAdapter.test.ts`).

### Google Play Billing

- [x] Handler RTDN (`/api/billing/webhook`) — ya en server.ts.
- [ ] Crear productos `subs` por tier en Play Console.
- [ ] Acknowledge server-side de `purchaseToken` → `invoices/{id}`.
- [ ] Manejo completo de los 5 RTDN notification types.

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
- [ ] PCI scope: keep all card data inside Webpay hosted pages
      (Khipu no maneja PAN — solo redirige a banca online del usuario).
      We must never receive a PAN.
- [ ] Email receipts via Resend (we already have it wired) — template
      the boleta PDF link + line items en español for CL, English for
      international.
