# DEEP — B15 Facturación, Suscripciones & Tier-gating · 2026-06-02

**Archivos revisados:** 90 (ledger `block==="B15-Billing"`) + grep transversal
(billing/subscription/tier/payment/webpay/mercadopago/khipu/stripe/googlePlay/apple/preventionCost/invoice/paywall/pricing/checkout/iap).
Lectura a fondo de los load-bearing: `src/server/routes/billing.ts` (2077 LOC),
`subscription.ts`, `preventionCost.ts`, `billing/pricing.ts`, todos los adapters
(`webpay`, `khipu`, `mercadoPago`, `iap`, validators Google/Apple), `idempotency.ts`,
`invoice.ts`, `appleSsn.ts`, `mercadoPagoIpn.ts`, `subscriptionPlan.ts` y
`SubscriptionContext.tsx`.

---

## 1. Lo que YA HACE (implementado y real)

- **Adapters de pago REALES, no stubs.**
  - **Webpay/Transbank** vía `transbank-sdk` real (`webpayAdapter.ts:30,263-331`):
    `create`/`commit`/`refund`, mapeo de tres estados AUTHORIZED/REJECTED/FAILED
    con distinción card-decline vs infra transitoria (`-96/-97/-98` →
    `webpayAdapter.ts:170-213`). Sandbox por defecto, prod gated por env
    `WEBPAY_COMMERCE_CODE`+`WEBPAY_API_KEY` (`webpayAdapter.ts:148-158,268-273`).
  - **MercadoPago** REST real (`mercadoPagoAdapter.ts:164-237`): `createPreference`,
    `getPayment`; `isConfigured()` gate por `MP_ACCESS_TOKEN`.
  - **Khipu** REST `/v3/payments` real con HMAC + ventana de drift ±300 s
    (`khipuAdapter.ts:1-120`).
  - **Stripe ELIMINADO** (§2.12 Fase C.2, 2026-05-21): no quedan imports ni rama
    de checkout Stripe; `VALID_PAYMENT_METHODS = ['webpay','manual-transfer']`
    (`billing/pricing.ts:47-53`), USD obliga `manual-transfer`
    (`billing.ts:508-510`). Verificado: sin residuos Stripe en el bloque.

- **IAP nativo valida receipt server-to-server (NO solo 202).**
  - **Google Play** `validateGooglePlaySubscription` real contra
    `purchases.subscriptionsv2.get` con 5 checks defense-in-depth (test-purchase,
    estado, product-match, expiry futuro, auto-acknowledge)
    (`googlePlayValidator.ts:154-279`). Ruta `/api/billing/google-play/validate-receipt`
    mapea reasons → 400/502/503 (`billing.ts:1675-1815`).
  - **Apple** `validateAppleTransaction` real contra App Store Server API
    (`/inApps/v1/transactions/`), JWT ES256 por request, prod→sandbox fallback en
    `errorCode 4040010`, verifica JWS + bundle/product/revocation/expiry
    (`appleTransactionValidator.ts:216-365`). Ruta en `billing.ts:1817-1948`.
  - El comentario legacy "return 202 stub" (`billing.ts:1671-1672`) está
    **desactualizado**: el código ya devuelve 200 con validación real. (Deuda de doc.)

- **Webhooks firmados con replay-protection + audit.**
  - **RTDN Google Play** (`billing.ts:323-464`): shared-secret `?token=` constant-time
    (`safeSecretEqual`), idempotencia `processed_pubsub/{messageId}` vía
    `withIdempotency`, re-fetch del estado canónico desde Google.
  - **MP IPN** (`billing.ts:1001-1164`): precedencia OIDC > HMAC > legacy. OIDC
    RS256 con JWKS cacheado, `aud` fail-closed (`mercadoPagoIpn.ts:441-568,475-479`).
    HMAC formato producción `ts=,v1=` con manifest + rechazo replay > 5 min
    (`mercadoPagoIpn.ts:248-273`); idempotencia `processed_mp_ipn/{paymentId}`.
  - **Apple SSN v2** (`billing.ts:1980-2077`): JWS verify, idempotencia
    `processed_apple_ssn/{notificationUUID}`, 401 en firma inválida.
  - **Khipu IPN** (`billing.ts:1503-1649`): raw-body HMAC, idempotencia
    `processed_khipu`.
  - Todos auditan replay vs success (`billing.webhook.replay` / `.success`,
    `billing.ts:438-451,1053-1070,1258-1264,1621-1638`).

- **Webpay returnUrl** registrado verbatim en router root-mounted
  `/billing/webpay/return` (NO `/api/`, por config Transbank); returnUrl construido
  con `APP_BASE_URL` (`billing.ts:575`), lock-then-complete
  `processed_webpay/{token_ws}` (`billing.ts:1212-1481`), redirect
  success/failed/retry. Tras AUTHORIZED activa `users/{uid}.subscription`
  (`billing.ts:1295-1324`).

- **Activación de suscripción server-side tras pago confirmado** en webpay
  (`billing.ts:1302-1317`), MP IPN (`mercadoPagoIpn.ts:683-704`) y RTDN
  (`billing.ts:285-292`). Todas normalizan tierId→planId.

- **Anti-escalada de privilegios (DT-01).** `/api/subscription/upgrade`
  (`subscription.ts:37-129`) es la ÚNICA vía cliente: exige invoice `status:'paid'`
  propiedad del caller cuyo `lineItems[].tierId`/`tierId` matchee el plan
  (`subscriptionPlanMatchesPaidTier`), si no → 403. Escribe vía Admin SDK + audit.
  `SubscriptionContext.upgradePlan` ya NO escribe directo: llama al endpoint
  (`SubscriptionContext.tsx:175-202`).

- **Normalización planId canonical↔legacy** centralizada en
  `subscriptionPlan.ts`: `TIER_TO_SUBSCRIPTION_PLAN` (tier canónico → plan legacy),
  `LEGACY_ALIASES` (`premium`→departamento, `basic`→comite), `normalizeSubscriptionPlanId`
  usada por TODAS las rutas billing + el contexto.

- **DTE auto-issue REAL (no solo decisión).** `tryAutoIssueDte` invocado en
  webpay (`billing.ts:1376-1411`) y MP IPN (`billing.ts:1111-1143`); gated por
  `DTE_AUTO_ISSUE` env (default off → `skipped:'disabled'`), fail-soft, nunca
  bloquea el ack/redirect (`invoice.ts:221-246`).

- **Invoice read-back seguro** `/api/billing/invoice/:id` (`billing.ts:727-796`):
  whitelist de campos, owner-check con 404 (no 403) anti-enumeración, rate-limit.

- **Prevention Cost Simulator** (`preventionCost.ts`): motor puro
  `preventionCostCalculator.ts`, `assertProjectMember` + tenant resolve antes de
  persistir, audit en save-scenario. Pricing calculator/simulator routes
  (`pricingCalculator.ts`, `pricingSimulator.ts`) todas `verifyAuth`.

- **Cobertura de tests sólida**: `billing.test.ts` (481), `webhookReplay` (308),
  `mercadoPagoIpn` (403), `appleSsn.replay` (284), `appleSsn` (test), `subscription`
  (121), `preventionCost` (590), más unit de cada adapter/validator.

---

## 2. Lo que está PENDIENTE (deuda de este bloque)

- **🟡 `mark-paid` NO activa la suscripción del usuario.** El handler
  `/api/billing/invoice/:id/mark-paid` (`billing.ts:620-712`) flipa invoice→`paid`,
  audita y decide DTE, pero **no escribe `users/{uid}.subscription`** (a diferencia
  de webpay/MP/khipu). Tras un pago por transferencia marcado manualmente, el plan
  del usuario solo se promueve si luego llama a `/api/subscription/upgrade`. Gap
  funcional: cliente B2B pagado por transferencia queda sin tier hasta acción extra.

- **🟡 Khipu: webhook SÍ, checkout NO.** Existe `/api/billing/khipu/webhook`
  (`billing.ts:1503`) y `khipuAdapter.createPayment` real, pero **no hay endpoint
  de checkout Khipu** que cree el pago (grep `khipuAdapter.createPayment` /
  `/khipu/checkout` → 0 resultados). El IPN puede confirmar pagos que ningún
  endpoint del repo inicia. Rail medio-cableado.

- **🟡 Tier-gating server-side NO usa el patrón RANK_ de directiva #11.** Las
  comparaciones `RANK_*` viven SOLO en `SubscriptionContext.tsx:51-72` (cliente,
  UX-only). No existe middleware server-side que lea `users/{uid}.subscription.planId`
  y compare contra rangos para gatear features premium (SSO, multi-tenant, Vertex
  fine-tune, etc.). La directiva #11 dice "la verificación canónica vive server-side";
  hoy la única defensa server-side es la activación-por-invoice-pagada de
  `/api/subscription/upgrade`, no un guard por-feature. Confirmar si hay enforcement
  en otros bloques (gemini/b2d) o si es brecha real.

- **🔵 Apple SSN chain verification es leaf-only (intencional, documentado).**
  `verifyJwsLeafOnly` (`appleSsn.ts:147-160`) valida el leaf x5c pero NO el chain
  hasta Apple Root G3; audita `verified_chain:false`. Hay FOLLOW-UP TICKET inline
  (`appleSsn.ts:34-46`). Un JWS con cert Apple-issued válido pasa, pero no se prueba
  el root. Riesgo bajo (Apple firma con su cadena) pero pendiente de hardening.

- **🔵 MP unit_price por multiplicador USD aproximado.** `MP_UNIT_PRICE_USD_MULTIPLIER`
  (`billing.ts:195-201`) usa ratios fijos (ARS 870 "review monthly"); no hay pricing
  por-país real. Marcado para Round 16 (`billing.ts:189-201`). Riesgo: precio LATAM
  drifteado vs FX real.

- **🔵 `LEGACY_HMAC_FALLBACK=1`** (`mercadoPagoIpn.ts:157-166`) acepta firma legacy
  `JSON.stringify`; off por defecto y emite warn, pero es superficie de rollback que
  debe permanecer off en prod.

- **🔵 `BILLING_TIER_FALLBACK`** (`billing/pricing.ts:24-36`) sigue siendo tabla
  inline "hasta que tiers.ts lande" — duplica precios con `tiers.ts`. Overage
  hardcodeado a umbrales 25 workers / 3 projects (`billing.ts:534-535`).

---

## 3. Tabla por archivo (TODOS)

| Archivo | LOC | Estado | Cableado | Propósito + hallazgo file:line |
|---|---|---|---|---|
| src/server/routes/billing.ts | 2077 | ✅ | sí (app.use) | Monolito billing: verify/webhook/checkout/MP/khipu/apple/webpay. `mark-paid` no activa sub `billing.ts:620-712` |
| src/server/routes/subscription.ts | 131 | ✅ | sí | `/upgrade` exige invoice paid (DT-01) `subscription.ts:57-88` |
| src/server/routes/preventionCost.ts | 371 | ✅ | sí | Simulador costos; guard tenant `preventionCost.ts:105-129` |
| src/server/routes/billing/pricing.ts | 53 | 🟡 | sí | Constantes tier fallback inline, duplica tiers.ts `pricing.ts:24-36` |
| src/server/routes/pricingCalculator.ts | 202 | ✅ | sí | 3 POST verifyAuth (estimate/compare/roi) `pricingCalculator.ts:78-155` |
| src/server/routes/pricingSimulator.ts | 209 | ✅ | sí | 3 POST verifyAuth simulator |
| src/services/billing/webpayAdapter.ts | 490 | ✅ | sí | transbank-sdk real + idempotency lock helpers |
| src/services/billing/khipuAdapter.ts | 411 | 🟡 | parcial | Adapter real pero sin endpoint checkout que lo invoque |
| src/services/billing/mercadoPagoAdapter.ts | 246 | ✅ | sí | REST real createPreference/getPayment |
| src/services/billing/mercadoPagoIpn.ts | 758 | ✅ | sí | OIDC+HMAC+replay `mercadoPagoIpn.ts:248-273,441-568` |
| src/services/billing/mpJwksCache.ts | 172 | ✅ | sí | JWKS cache 6h con test seams |
| src/services/billing/idempotency.ts | 209 | ✅ | sí | withIdempotency lock-then-complete; NO transaccional `idempotency.ts:34-40` |
| src/services/billing/invoice.ts | 285 | ✅ | sí | buildInvoice + tryAutoIssueDte gated DTE_AUTO_ISSUE `invoice.ts:221-246` |
| src/services/billing/googlePlayValidator.ts | 348 | ✅ | sí | subscriptionsv2.get real, 5 checks |
| src/services/billing/appleTransactionValidator.ts | 365 | ✅ | sí | App Store Server API real, prod→sandbox |
| src/services/billing/appleSsn.ts | 494 | 🔵 | sí | SSN v2; chain leaf-only `verified_chain:false` `appleSsn.ts:34-46,147-160` |
| src/services/billing/iapAdapter.ts | 426 | ✅ | sí | Capacitor IAP plugin real, test seam |
| src/services/billing/currency.ts | 116 | ✅ | sí | MP_CURRENCY_BY_COUNTRY tuples |
| src/services/billing/types.ts | 163 | ✅ | sí | CheckoutRequest/Response, PaymentMethod (sin stripe) |
| src/services/billing/webpayMetrics.ts | 72 | ✅ | sí | Histogram return_latency |
| src/services/billingService.ts | 48 | ✅ | sí | Cliente fetch /api/billing/verify |
| src/services/pricing/subscriptionPlan.ts | 60 | ✅ | sí | Normalización canonical↔legacy (núcleo) |
| src/services/pricing/tiers.ts | 378 | ✅ | sí | Fuente de tiers/precios (TIERS, withIVA) |
| src/services/pricing/aiTier.ts | 252 | ✅ | sí | B2D API tiers (concepto distinto a sub-plans) |
| src/services/pricing/iapSkus.ts | 159 | ✅ | sí | SKU↔tier mapping IAP |
| src/services/pricing/jurisdictionLimits.ts | 73 | ✅ | sí | Límites por jurisdicción |
| src/services/pricing/eppIndustryCatalog.ts | 317 | ✅ | sí | Catálogo EPP por industria (calculadora) |
| src/services/costCalculator/preventionCostCalculator.ts | 174 | ✅ | sí | Motor puro non-compliance/ROI |
| src/services/pricingCalculator/pricingCalculator.ts | ~200 | ✅ | sí | estimate/compare/ROI/OC puro |
| src/services/pricingSimulator/pricingSimulator.ts | ~200 | ✅ | sí | Simulador escenarios |
| src/contexts/SubscriptionContext.tsx | 256 | ✅ | sí | RANK_ feature-flags (UX-only) `SubscriptionContext.tsx:51-72` |
| src/components/billing/TierDowngradeModal.tsx | 292 | ✅ | sí | UI downgrade |
| src/components/pricing/PricingCalculator.tsx | — | ✅ | sí | UI calculadora |
| src/components/pricing/CurrencyToggle.tsx | — | ✅ | sí | Toggle moneda |
| src/components/pricingCalculator/ROICalculatorWidget.tsx | — | ✅ | sí | Widget ROI |
| src/components/pricingCalculator/TierComparatorWidget.tsx | — | ✅ | sí | Widget comparador |
| src/hooks/useInvoicePolling.ts | 334 | ✅ | sí | Polling estado invoice post-checkout |
| src/hooks/usePreventionCost.ts | — | ✅ | sí | Hook simulador costos |
| src/hooks/usePricingCalculator.ts | — | ✅ | sí | Hook calculadora |
| src/hooks/usePricingSimulator.ts | — | ✅ | sí | Hook simulador |
| src/pages/Pricing.tsx | 1289 | ✅ | sí | Checkout + IAP nativo `Pricing.tsx:959-1045` |
| src/pages/PricingCalculator.tsx | — | ✅ | sí | Página calculadora |
| src/utils/pricingOcPdf.ts | — | ✅ | sí | PDF orden de compra |
| src/services/systemEngine/adapters/subscriptionContextAdapter.ts | — | ✅ | sí | Adapter system-engine |
| docs/ (BILLING.md, PRICING.md, docs/billing-iap.md, MERCADOPAGO_RUNBOOK.md) | — | 🔵 | n/a | Doc; comentario "202 stub" billing.ts:1671 desactualizado |
| Tests (billing*, mercadoPagoIpn, subscription, preventionCost, *.test) | — | ✅ | n/a | Cobertura 401/200/4xx + replay + IPN producción |

(Estados: ✅ real y cableado · 🟡 parcial/gap funcional · 🏚️ obsoleto · 🔵 deuda menor/doc · 🔑 secreto/seguridad · 🔴 roto/crítico)

---

## 4. Para decisión del usuario (❓/⚠️)

- **⚠️ `mark-paid` no promueve el plan del usuario** (`billing.ts:620-712`). ¿Debe
  `mark-paid` activar `users/{uid}.subscription` igual que webpay/MP, o es
  intencional que el admin/SPA dispare `/api/subscription/upgrade` aparte? Afecta a
  clientes B2B por transferencia bancaria.

- **⚠️ Tier-gating server-side por-feature ausente** (directiva #11). `RANK_*` solo
  vive en el cliente (`SubscriptionContext.tsx`). ¿Existe enforcement server-side de
  features premium (SSO/multi-tenant/Vertex) en otro bloque, o es brecha de
  autorización a cerrar con un middleware `requirePlan(rank)` que lea
  `subscription.planId`?

- **❓ Khipu sin endpoint de checkout** (`billing.ts` solo tiene webhook). ¿Se
  inicia el pago Khipu desde otro flujo/cliente, o el rail quedó a medio cablear?

- **❓ Apple SSN chain leaf-only** (`appleSsn.ts:34-46`). ¿Priorizar el FOLLOW-UP de
  verificación de cadena completa Apple Root G3 antes de GA iOS, o aceptar
  `verified_chain:false` auditado como riesgo conocido?

- **🔵 `MP_UNIT_PRICE_USD_MULTIPLIER` FX hardcodeado** (`billing.ts:195-201`,
  ARS 870 "review monthly"). ¿Migrar a pricing por-país en `tiers.ts` (Round 16) o
  conectar FX dinámico?
