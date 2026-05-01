# SII (Servicio de Impuestos Internos) — Boleta / Factura electrónica integration runbook

**Status:** scaffolded; PSE pick pending. No real PSE SDK is installed yet.
The code in `src/services/sii/` is the typed contract every PSE
implementation must satisfy; concrete adapters throw `SiiNotImplementedError`
until Round 2 picks one.

This runbook is the playbook for that next round.

---

## 1. Why DTE (Documento Tributario Electrónico)

Chile mandates electronic tax documents for **every** B2B and B2C taxable
transaction:

- **Resolución Exenta SII 80/2014** — boleta electrónica is mandatory; the
  emisor must transmit the DTE to SII in real time. The customer is
  legally entitled to a tax receipt within 24h of payment.
- **Ley 21.131** (pago a 30 días) — invoices (`factura electrónica`,
  type 33) carry due-date metadata SII enforces.
- **Without** valid DTE emission, Praeventio cannot legally bill enterprise
  clients in Chile and any payment received is technically uncollectable
  income.

Today, when Webpay returns AUTHORIZED, the customer gets a "thanks"
redirect but no boleta. That is the gap this round closes.

---

## 2. Prerequisites (one-time, ~30-day SII process)

| Step | Owner | Notes |
|---|---|---|
| **SII contribuyente electrónico approval** | Finance / legal | Application form + test environment exercises. ~30 calendar days end-to-end. Praeventio's RUT is `78.231.119-0`. |
| **Certificado digital persona natural (firma electrónica)** | Legal rep | Issued by an SII-acreditado provider (E-Sign, E-Cert, Acepta, …). 1-3 yr validity, ~$25.000 CLP. Used to sign every DTE XML. |
| **CAF (Código Autorización Folios)** | Operations | Per DTE type: 33 (factura), 39 (boleta), 41 (boleta exenta), 56 (nota débito), 61 (nota crédito). Request via SII online portal; PSE consumes the CAF XML. |
| **Pruebas de certificación SII** | Engineering | SII issues test sets the PSE must accept (~50 sample DTEs). PSE handles 80% of this; we contribute the data. |

The PSE we pick handles certificado upload + CAF management on our behalf
(except LibreDTE, where we host both).

---

## 3. PSE comparison

| PSE | Pricing | Notes |
|---|---|---|
| **OpenFactura** | ~$20.000–50.000 CLP/mes flat + tier per DTE | LibreDTE-spinoff SaaS. REST API, well-documented, stable. Mid-market default. |
| **SimpleAPI** | per-DTE pricing (~$20–50 CLP/DTE), no monthly minimum | Modern REST + webhooks (HMAC-signed callbacks for SII outcome). Cheap at low volume. |
| **Bsale** | bundled with their ERP plan (~$30.000+ CLP/mes) | Heavier — full ERP (inventory, POS). Worth picking only if Praeventio later wants those modules. |
| **LibreDTE** | self-hosted, no per-DTE fee | Open-source PHP/JS engine. Free at the SaaS layer; requires DevOps to run the upload daemon, manage CAFs locally, monitor SII availability. Worth it once volume justifies eliminating PSE fees. |

**Tentative pick:** OpenFactura (mid-market, lowest engineering risk).
SimpleAPI is the runner-up on cost. Final decision: post-Round-2 review.

---

## 4. Round 2 implementation TODOs

In rough order:

1. **Pick PSE** (this is the gating decision; everything below depends).
2. **Install adapter dependency** (`npm install <pse-sdk>` or use `fetch`
   if the PSE only ships a REST API). Pin major version.
3. **Replace `emitDte` / `getDteStatus` stubs** in
   `src/services/sii/<pse>Adapter.ts` with the real call. Map the PSE
   response shape to our `DteResponse`.
4. **Wire to Webpay AUTHORIZED hook** in `server.ts`:
   - In `GET /billing/webpay/return` after `commitTransaction` returns
     `AUTHORIZED`, call `getSiiAdapter().emitDte(...)` with a
     `DteRequest` built from the `Invoice` doc.
   - Persist the resulting `folio`, `trackId`, `pdfUrl` to
     `dte_emissions/{folio}` (server-only collection — do NOT add a
     client-readable rule).
   - Cross-link onto `invoices/{id}.dte = { folio, trackId, pdfUrl }`.
5. **Wire to the manual mark-paid flow** —
   `POST /api/billing/invoice/:id/mark-paid` should also emit a DTE on
   success.
6. **Webhook callback** (only for SimpleAPI / OpenFactura): register
   `POST /api/billing/sii/webhook`, validate HMAC, update
   `dte_emissions/{folio}.status` from `pending` → `accepted` /
   `rejected`.
7. **Email receipt** via Resend — attach `pdfUrl`. We already have Resend
   wired in `src/services/billing/`, so this is a one-liner once `pdfUrl`
   is in Firestore.

---

## 5. Operational concerns

- **Conciliación SII mensual** — every month, finance reconciles emitted
  folios vs. received payments. The `dte_emissions/{folio}` doc carries
  `paymentInfo.reference` (= Webpay buyOrder = invoice id) so the join is
  straightforward.
- **Retention** — Chilean tax law requires DTE retention for 6 years.
  We MUST archive both the signed XML and the PDF in
  `dte_emissions/{folio}.xml` and a Cloud Storage bucket
  (`sii-dte-archive/{rut}/{year}/{month}/{folio}.pdf`). PSE-hosted PDFs
  expire; do not rely on `pdfUrl` long-term.
- **Voiding (anulación)** — issue a nota de crédito (DTE type 61)
  referencing the original folio. NEVER edit / delete an emitted DTE —
  SII rejects edits and they're a tax-fraud signal.
- **CAF exhaustion** — folios are issued in ranges (e.g. 1–500). Monitor
  remaining folios per DTE type; if a range runs out, emission fails
  until a new CAF is uploaded.
- **SII downtime** — SII is occasionally unreachable (a few hours per
  year). PSEs queue DTEs and retry; our `dte_emissions/{folio}.status`
  reflects the queue state (`pending` until SII accepts).

---

## 6. Testing

- All 4 PSE candidates ship a sandbox / "ambiente de certificación"
  environment with free sample CAFs. The integration test should:
  1. Build a `DteRequest` from a fake `Invoice`.
  2. Call `emitDte` against the sandbox.
  3. Poll `getDteStatus` until `accepted` (timeout 30s).
  4. Assert the folio is in the expected CAF range.
- Unit tests live in `src/services/sii/siiAdapter.test.ts` today; only
  the pure helpers (`calculateDteTotals`) are covered. The PSE-call paths
  will need mocked-fetch tests once a real PSE is wired.
- DO NOT add the PSE production credentials to CI. Sandbox-only.

---

## 7. Files

```
src/services/sii/
  index.ts                  ← public facade; getSiiAdapter()
  siiAdapter.ts             ← shared helpers (calculateDteTotals, errors, noopAdapter)
  siiAdapter.test.ts        ← TDD coverage of totals math + facade selection
  types.ts                  ← DteRequest / DteResponse / SiiAdapter contract
  openfacturaAdapter.ts     ← STUB (throws SiiNotImplementedError)
  simpleApiAdapter.ts       ← STUB
  bsaleAdapter.ts           ← STUB
  libredteAdapter.ts        ← STUB
```

Env vars (none set today; document for Round 2):

```
SII_PSE=openfactura          # which adapter getSiiAdapter() returns
OPENFACTURA_API_KEY=...
OPENFACTURA_API_BASE_URL=... # optional; defaults to PSE production
SIMPLEAPI_API_KEY=...
BSALE_ACCESS_TOKEN=...
LIBREDTE_BASE_URL=...
LIBREDTE_TOKEN=...
SII_EMISOR_GIRO=Servicios de prevención de riesgos laborales
```

When `SII_PSE` is unset, `getSiiAdapter()` returns the `noop` adapter,
which produces success-shaped responses for dev/CI.
