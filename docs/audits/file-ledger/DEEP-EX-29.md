# DEEP-EX-29 — Lote #29 · B15-Billing (FEAT slice [0:52]) · 2026-06-03

**Deriva:** `ledger.json` filtrado `category` empieza con `FEAT` && `block === "B15-Billing"`,
ordenado por `path`, slice `[0:52]` (= los 52 FEAT del bloque).

**Atestación: 52/52 archivos leídos línea por línea.**

No repite los hallazgos ya cubiertos por `DEEP-B15-Billing.md` (tier-gating
por-feature solo client-side, `mark-paid` no activa tier, Khipu sin checkout,
Apple SSN leaf-only, FX `MP_UNIT_PRICE_USD_MULTIPLIER` hardcodeado,
`BILLING_TIER_FALLBACK` duplica `tiers.ts`, comentario "202 stub"
desactualizado, idempotency no-transaccional). Lo de abajo es NUEVO.

---

## 1. Hallazgos NUEVOS

### 🟡 NEW-1 — `runB2dMrrSnapshot` no tiene caller en producción (job huérfano)
`src/server/jobs/runB2dMrrSnapshot.ts:23-25` documenta su caller esperado
("Cloud Scheduler endpoint dedicado o `/api/maintenance/run-b2d-mrr-snapshot`"),
pero el grep de todo el repo encuentra SOLO callers de test
(`runB2dMrrSnapshot.test.ts`). No hay ruta montada ni cron que lo invoque
(`grep "runB2dMrrSnapshot\|run-b2d-mrr"` en `server.ts` + `src/server/` →
únicamente el `.test.ts`). El shim que prometía "llenar
`b2d_mrr_snapshots/{YYYY-MM}` con valores reales mensuales" (para sacar al
chart MRR del "single point" tras el fix Sprint D) está escrito y testeado
pero NUNCA corre. El panel `B2dAdminPanel` sigue dependiendo de que alguien lo
dispare. Cableado a medias (tipo §13 anti-stub, aunque el código no es stub:
es funcional pero desconectado). Sin feature-flag/503 visible al usuario — el
chart simplemente no se llena.

### 🟡 NEW-2 — `billing/pricing.ts` fallback omite `global-titanio` (y 5 premium overage)
`src/server/routes/billing/pricing.ts:24-36` — `BILLING_TIER_FALLBACK` tiene 9
entradas y NO incluye `global-titanio` (que sí existe en `tiers.ts:200-213`).
Un checkout server-side con `tierId:'global-titanio'` cae en
`resolveBillingTier → null → billing.ts:514 res.status(400) 'Unknown tierId'`.
NO es un 5xx (degrada limpio, OK), pero significa que el tier Global Titanio es
INVENDIBLE por el rail Webpay/checkout: solo manual-transfer/ventas. Esto
amplía el 🔵 de DEEP-B15 ("fallback duplica tiers.ts") con un gap concreto de
cobertura de tier. Riesgo: drift silencioso — añadir un tier a `tiers.ts` no
falla ningún test de checkout, simplemente lo deja sin precio.

### 🔵 NEW-3 — Tres ladders de tiers paralelos e incompatibles
Coexisten TRES tablas de tiers distintas en el bloque, con nombres y precios
que no mapean entre sí:
- Canónica: `tiers.ts` (`gratis`/`comite-paritario`/…/`global-titanio`, 11 tiers, CLP).
- Simulador: `pricingSimulator.ts:40-69` `TIER_TABLE` (`free`/`starter`/`pro`/`enterprise`, base 0/29990/89990/290000).
- Upsell: `painBasedUpsellSuggester.ts:15` + `upsell.ts:49` (`free`/`starter`/`pro`/`enterprise`).
- Capacity: `tierEvaluation.ts:25-39` (shape inyectado, desacoplado a propósito).

Los simuladores/upsell son advisory (no autoritativos para facturación), así
que no es un bug de dinero, pero ES doc-drift / deuda de consistencia: un
usuario en tier `oro` (canónico) pide `/upsell/suggest` con `currentTier` que
debe traducir a `pro`/`enterprise` en su cabeza. `upsell.ts` confía en el
`currentTier` del body (UX-only, no autorización — correcto), pero el set de
enums no se valida contra el plan real del usuario.

### 🔵 NEW-4 — `CostSimulator` usa `Math.random()` como fallback de idempotency-key
`src/components/cost/CostSimulator.tsx:222-224`: el id del escenario (que se usa
TAMBIÉN como `Idempotency-Key` del POST `save-scenario`, línea 233) se genera con
`crypto.randomUUID()` y fallback `scenario-${Date.now()}-${Math.random()...}`.
Directiva #15 prohíbe `Math.random()` en `src/server/` + ID-generation; esto es
CLIENTE (fuera del scope estricto de #15) y el path primario es `randomUUID`,
pero como el valor viaja como idempotency-key de una escritura Firestore, un
fallback débil (navegador antiguo sin `crypto.randomUUID`) podría colisionar.
Riesgo bajo (Date.now+random, browsers modernos usan UUID). Considerar
`src/utils/randomId.ts` para paridad con la convención del repo.

### 🔵 NEW-5 — Doc-comment obsoleto en `billing/types.ts`
`src/services/billing/types.ts:3-5` aún dice *"Scaffolding only. No real
Transbank/Stripe SDK is wired up yet"* y líneas 13/147 referencian Stripe como
rail futuro. DEEP-B15 confirma que Transbank es REAL (`webpayAdapter.ts`) y
Stripe fue ELIMINADO (§2.12). El TIPO está bien (literal `'stripe'` es un
tombstone tipo-only, documentado correctamente en 36-56); solo el header
miente. Deuda de doc-sync (directiva #20-spirit).

### 🔵 NEW-6 — `subscriptionContextAdapter` emite `source:'webhook'` hardcodeado
`src/services/systemEngine/adapters/subscriptionContextAdapter.ts:51` emite el
evento `tier_changed` con `source:'webhook'` SIEMPRE, aunque la transición la
observe el CLIENTE vía `SubscriptionContext` (no necesariamente vía webhook).
Es telemetría de event-bus (no facturación ni autorización), `emit().catch()`
fail-soft. Etiqueta de procedencia engañosa para análisis posteriores. Trivial.

---

## 2. Verificaciones limpias (sin hallazgo)

- **Auth/audit (#3/#6/#14):** `upsell.ts`, `pricingCalculator.ts`,
  `pricingSimulator.ts` → TODAS las rutas `verifyAuth` + `assertProjectMember(uid,
  projectId)` antes de computar; `preventionCost.ts` igual (ya en DEEP-B15). Sin
  `void auditServerEvent`. Sin tenantId/projectId leído de body como identidad.
- **#15 Math.random en server:** 0 ocurrencias en los 5 archivos server del lote.
- **#8 (5xx no filtra internals):** `upsell.ts:74` devuelve `{error:'internal_error'}`
  genérico; demás rutas idem.
- **Engines puros (#9-spirit):** `painBasedUpsellSuggester`, `tierEvaluation`,
  `pricingCalculator`, `pricingSimulator`, `preventionCostCalculator`, `aiTier`,
  `jurisdictionLimits`, `eppIndustryCatalog`, `subscriptionPlan`, `currency` —
  determinísticos, sin I/O, sin Firestore, validación de entrada fail-closed
  (`estimateBill` rechaza NaN/negativos; `formatCurrency` throw en currency
  desconocida; `suggestUpsell` valida `dataConfidenceScore ∈ [0,1]`).
- **Anti-tamper IAP:** `iapSkus.ts:143-159` `assertSkuMatchesTier` rechaza
  receipts donde el `productId` no matchea el tier pedido (defensa server-side).
- **IVA:** `tiers.ts:withIVA` trata input como NETO; `Pricing.tsx:204-206`
  reverse-deriva el neto (`clpRegular/1.19`) antes de llamarlo → sin doble-IVA.
  `billing/pricing.ts` fallback son montos NETOS (pre-IVA) consistentes con
  `tiers.test.ts`. Math de overage correcto.
- **`runB2dMrrSnapshot`:** semántica closed-month correcta (UTC explícito, fix
  Codex #284), merge idempotente preserva `capturedAt`. Bien escrito (solo le
  falta el caller, NEW-1).
- **`useInvoicePolling`:** motor puro inyectable, backoff exp con cap, 401→stop,
  404/5xx→retry, grace de hidratación de token, abort limpio. Sólido.
- **Hooks cliente** (`useCostCalculator`, `usePreventionCost`, `useUpsell`,
  `useRoiScenario`, `usePricingCalculator`, `usePricingSimulator`): todos
  `apiAuthHeaders()`, error-handling `res.json().catch(()=>({}))`. Sin secretos.
- **Componentes UI** (`CostSimulator`, `CostScenarioCard`, `PreventionROIWidget`,
  `PricingCalculator`×2, `CurrencyToggle`, `ROICalculatorWidget`,
  `TierComparatorWidget`, `TierDowngradeModal`): presentacionales, CLP es-CL,
  delegan a engines puros, sin escritura directa de tier.

---

## 3. Tabla por archivo (52/52)

| # | Archivo | Estado | Hallazgo |
|---|---|---|---|
| 0 | components/billing/TierDowngradeModal.tsx | ✅ | UI downgrade (cubierto DEEP-B15) |
| 1 | components/cost/CostScenarioCard.tsx | ✅ | Tarjeta presentacional |
| 2 | components/cost/CostSimulator.tsx | 🔵 | NEW-4: Math.random fallback idempotency-key (224) |
| 3 | components/costCalculator/PreventionROIWidget.tsx | ✅ | Widget presentacional |
| 4 | components/pricing/CurrencyToggle.tsx | ✅ | Geo-default CLP/USD, localStorage |
| 5 | components/pricing/PricingCalculator.tsx | ✅ | Slider→tier recomendado |
| 6 | components/pricingCalculator/ROICalculatorWidget.tsx | ✅ | computeROI puro |
| 7 | components/pricingCalculator/TierComparatorWidget.tsx | ✅ | compareTiers puro |
| 8 | hooks/useCostCalculator.ts | ✅ | 2 mutators authed |
| 9 | hooks/useInvoicePolling.ts | ✅ | Motor puro inyectable |
| 10 | hooks/usePreventionCost.ts | ✅ | simulate/save/list authed |
| 11 | hooks/usePricingCalculator.ts | ✅ | 4 mutators authed |
| 12 | hooks/usePricingSimulator.ts | ✅ | 3 mutators authed |
| 13 | hooks/useRoiScenario.ts | ✅ | 1 mutator authed |
| 14 | hooks/useUpsell.ts | ✅ | 1 mutator authed |
| 15 | pages/Pricing.tsx | ✅ | Checkout+IAP (DEEP-B15); IVA reverse OK (204-206) |
| 16 | pages/PricingCalculator.tsx | ✅ | Presentacional, delega engines |
| 17 | server/jobs/runB2dMrrSnapshot.ts | 🟡 | NEW-1: sin caller en prod (job huérfano) |
| 18 | server/routes/billing.ts | ✅ | Monolito (DEEP-B15); 400 limpio en tier desconocido |
| 19 | server/routes/billing/pricing.ts | 🟡 | NEW-2: fallback omite global-titanio |
| 20 | server/routes/preventionCost.ts | ✅ | verifyAuth+assertProjectMember (DEEP-B15) |
| 21 | server/routes/pricingCalculator.ts | ✅ | 4 POST verifyAuth+member |
| 22 | server/routes/pricingSimulator.ts | ✅ | 3 POST verifyAuth+member |
| 23 | server/routes/subscription.ts | ✅ | /upgrade DT-01 (DEEP-B15) |
| 24 | server/routes/upsell.ts | ✅ | 1 POST verifyAuth+member, engine puro |
| 25 | services/billing/appleSsn.ts | 🔵 | leaf-only (DEEP-B15) |
| 26 | services/billing/appleTransactionValidator.ts | ✅ | App Store API real (DEEP-B15) |
| 27 | services/billing/currency.ts | ✅ | 7 monedas LATAM, fail-closed |
| 28 | services/billing/googlePlayValidator.ts | ✅ | subscriptionsv2.get (DEEP-B15) |
| 29 | services/billing/iapAdapter.ts | ✅ | Capacitor IAP real (DEEP-B15) |
| 30 | services/billing/idempotency.ts | ✅ | withIdempotency (DEEP-B15) |
| 31 | services/billing/invoice.ts | ✅ | buildInvoice+DTE (DEEP-B15) |
| 32 | services/billing/khipuAdapter.ts | 🟡 | sin checkout endpoint (DEEP-B15) |
| 33 | services/billing/mercadoPagoAdapter.ts | ✅ | REST real (DEEP-B15) |
| 34 | services/billing/mercadoPagoIpn.ts | ✅ | OIDC+HMAC+replay (DEEP-B15) |
| 35 | services/billing/mpJwksCache.ts | ✅ | JWKS cache (DEEP-B15) |
| 36 | services/billing/types.ts | 🔵 | NEW-5: header "scaffolding/Stripe" obsoleto |
| 37 | services/billing/webpayAdapter.ts | ✅ | transbank-sdk real (DEEP-B15) |
| 38 | services/billing/webpayMetrics.ts | ✅ | Histogram (DEEP-B15) |
| 39 | services/billingService.ts | ✅ | Cliente /api/billing/verify |
| 40 | services/capacity/tierEvaluation.ts | ✅ | Engine puro, tier inyectado |
| 41 | services/costCalculator/preventionCostCalculator.ts | ✅ | Motor puro (Ley 16.744) |
| 42 | services/pricing/aiTier.ts | ✅ | B2D tiers; calculateApiCost puro |
| 43 | services/pricing/eppIndustryCatalog.ts | ✅ | Tabla EPP determinística |
| 44 | services/pricing/iapSkus.ts | ✅ | SKU↔tier + assertSkuMatchesTier |
| 45 | services/pricing/jurisdictionLimits.ts | ✅ | Límite jurisdicción por tier |
| 46 | services/pricing/subscriptionPlan.ts | ✅ | Normalización canonical↔legacy (núcleo) |
| 47 | services/pricing/tiers.ts | ✅ | Fuente verdad tiers; withIVA correcto |
| 48 | services/pricingCalculator/pricingCalculator.ts | ✅ | estimate/compare/ROI/OC puro |
| 49 | services/pricingSimulator/pricingSimulator.ts | 🔵 | NEW-3: ladder free/starter/pro/enterprise paralelo |
| 50 | services/systemEngine/adapters/subscriptionContextAdapter.ts | 🔵 | NEW-6: source:'webhook' hardcodeado |
| 51 | services/upsell/painBasedUpsellSuggester.ts | 🔵 | NEW-3: ladder paralelo; engine puro OK |

Estados: ✅ real y cableado · 🟡 parcial/gap funcional · 🔵 deuda menor/doc.

---

## 4. Para decisión del usuario

- **🟡 NEW-1** ¿Cablear `runB2dMrrSnapshot` a un endpoint
  `/api/maintenance/run-b2d-mrr-snapshot` + Cloud Scheduler, o dejarlo como
  utilidad manual? Hoy el chart MRR del panel B2D no se llena solo.
- **🟡 NEW-2** ¿Añadir `global-titanio` (y overage premium) a
  `BILLING_TIER_FALLBACK`, o es intencional que Global Titanio sea solo-ventas
  (manual-transfer)? Un test de checkout por-tier evitaría el drift futuro.
- **🔵 NEW-3** ¿Unificar el ladder advisory (`free/starter/pro/enterprise`) con
  el canónico de `tiers.ts`, o mantenerlos separados a propósito? Riesgo de
  confusión usuario en sugerencias de upsell.
</content>
</invoke>
