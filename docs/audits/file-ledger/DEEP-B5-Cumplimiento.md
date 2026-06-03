# DEEP — B5 Cumplimiento & SUSESO · 2026-06-02

**Archivos revisados:** 176 (ledger `block === "B5-Cumplimiento"`). Lectura a fondo de los
núcleos load-bearing (DTE/SII, SUSESO, marco regulatorio, ley19628, calendario legal,
no-conformidades, privacidad/retención, industry rules); resto verificado por header +
grep de wiring/guards/stubs.

> Nota de alcance: el brief estimaba ~106 archivos; el ledger real lista **176** en este
> bloque. Se auditaron todos (los `.test.ts` por pareja con su fuente).

---

## 1. Lo que YA HACE (implementado y real)

**DTE / facturación (modelo "NO push a SII"):**
- `decideDteIssue()` — motor PURO de decisión post-pago: clasifica RUT chileno con DV
  mod-11 + heurística empresa≥50M (factura 33) vs persona (boleta 39), gateways soportados,
  idempotencyKey sha256(paymentId|tenantId). `dteAutoIssueOrchestrator.ts:198`.
- **Auto-emisión REAL cableada tras pago** en 2 de 3 rutas: Webpay return
  (`billing.ts:1353-1391`) y MercadoPago IPN (`billing.ts:1092-1143`) llaman
  `tryAutoIssueDte()` cuando `decision.shouldIssue`. Gated por env `DTE_AUTO_ISSUE`
  (default `false`) → activación controlada (`invoice.ts:225-247`).
- `tryAutoIssueDte()` despacha vía **PSE intermedio** (default `BsaleAdapter.fromEnv()`),
  nunca push directo a SII — respeta la directiva de producto (`invoice.ts:242-277`).
- **BsaleAdapter es REAL** (572 LOC): `fetch` real a `api.bsale.io/v1`, headers, error
  mapping, `buildBsalePayload`/`mapBsaleResponse`, `emitDte`+`createDte`
  (`bsaleAdapter.ts:297-410`).
- DTE local sin push: `dteGenerator.ts` serializa XML SII-canónico (`xmlns
  http://www.sii.cl/SiiDte`, sin fetch — `dteGenerator.ts:17-18,131`), `dteSigner.ts`
  firma WebAuthn embebida en envelope XMLDSIG-shaped, `dtePdfRenderer.ts` imprime con QR.
  `siiPreflightCheck.ts` valida ambiente/RUT/monto antes de tocar PSE (325 LOC, puro).
- Ruta `/api/dte` montada (`server.ts:1239`): `/create`, `/:folio`, `/:folio/cancel`,
  `/generate` — todas `verifyAuth` + `idempotencyKey()` (`dte.ts:150,188,226,315`).
- `dteIssueQueue.ts` — backoff exponencial 1m→24h, 5 intentos, estados terminales (puro).

**SUSESO (DIAT/DIEP) — chain end-to-end real:**
- Folio **atómico** vía `runTransaction` per (tenant, year, kind), monotónico sin gaps
  (`folioGenerator.ts:99-116`).
- `createSusesoForm` → folio + PDF (jsPDF real, `susesoCertificate.ts`/`diatPdfRenderer.ts`)
  + SHA-256 del PDF + QR de verificación + persistencia inmutable
  (`susesoService.ts:136-196`).
- **Firma WebAuthn end-to-end real** en `/api/suseso/form/:id/sign`: consume challenge,
  verifica crypto + counter + origin/rpId, exige `signerUid===callerUid`
  (`suseso.ts:209-259`); endpoint dedicado `/sign-challenge` (`suseso.ts:292`).
  Componente UI cableado: `SusesoFormBuilder.tsx:147-191` → `webauthnComplianceSign`.
- **Verify público real** `/api/suseso/verify/:folio` (sin auth, con `susesoVerifyLimiter`
  30 req/min anti-enumeración) — expone solo metadata, nunca RUT víctima ni dato clínico
  (`suseso.ts:390`, `susesoService.ts:235-257`).
- Dashboard cumplimiento calculado **internamente** (no scraping): tasas de
  accidentabilidad/siniestralidad desde datos propios del tenant
  (`cumplimientoCalculator.ts`), reportes mensuales (`monthlyReport.ts`).
- Recordatorios SUSESO + calendario legal cableados a cron vía
  `maintenance.ts:109,592` (`sendSusesoReminders`, `runLegalCalendarReminders`).

**Marco regulatorio multi-jurisdicción (ADR 0014) — citaciones DINÁMICAS:**
- `cite()`/`getReferencesForControl()` resuelven `RegulationRef[]` desde tablas por
  jurisdicción keyed por controlId ISO 45001 — **no son strings hardcoded**
  (`registry.ts:224-308`). 14 jurisdicciones con datos de cita poblados
  (`jurisdictions/*.ts`, 1076 LOC).
- Tier-gating server-side de jurisdicciones (`assertTenantHasJurisdiction`,
  `getActiveJurisdictions` con `getMaxJurisdictionsForTier`, `registry.ts:139-199`).
- `RegulatoryCitation.tsx:54-55` consume `getActiveJurisdictions()` + `cite()` dinámicos.
- `jurisdictionRegistry.ts` (perfiles), `privacyRegimeRegistry.ts` (regímenes privacidad)
  — capas ortogonales reales.
- Adapter de emisión **CL real** (`compliance/adapters/cl/index.ts` delega a
  generateDte/signer); resto de países throw `AdapterNotImplementedError` documentado
  (ADR-0017), `compliance/registry.ts` central.

**Otros engines reales:**
- `ley19628.ts` (575 LOC) — derechos del titular GDPR-shaped + Ley 21.719/2024.
- `trafficLightEngine.ts` — semáforo verde/amarillo/rojo por 8 categorías (puro).
- `ds67Service.ts` / `ds76Service.ts` — Reglamento Interno + Subcontratación minera,
  mismo patrón folio+PDF+WebAuthn que SUSESO.
- `dataRetentionPolicy.ts` (390 LOC), `nonConformityEngine.ts`, `industryRuleEngine.ts`,
  `legalObligationsCalendar.ts`, `environmentalCompliance.ts`, `normativeAuditLog.ts`.
- Rutas `legalObligations`/`nonConformity`/`privacyRetention`/`regulatoryFramework`/
  `industryRules` montadas en `/api/sprint-k`, todas con `verifyAuth` (4-6 usos c/u) +
  member/txn guards.
- `ComplianceAuditor.tsx` usa `auditProjectComplianceWithAI` (compliance, NO diagnosis).

---

## 2. Lo que está PENDIENTE (deuda de este bloque)

- 🟡 **Ruta `mark-paid` (manual) NO auto-emite DTE** — solo loggea `decideDteIssue` sin
  llamar `tryAutoIssueDte`. TODO explícito "Sprint 50 — connect to dteIssueQueue persister
  + PSE dispatch" (`billing.ts:671-697`). Las 3 rutas no están a paridad: webpay+MP sí
  emiten, manual no.
- 🟡 **`dteIssueQueue.ts` sin persistencia** — helpers puros (backoff, estados) listos pero
  ningún worker Firestore los lee/escribe; el path real de auto-issue **bypassa la queue**
  y llama el adapter directo (sin retry persistente). El backoff 1m→24h queda inerte hasta
  el persister del Sprint 50.
- 🟡 **3 de 4 adapters SII son stubs**: `openfacturaAdapter`/`libredteAdapter`/
  `simpleApiAdapter` throw `SiiNotImplementedError` (`openfacturaAdapter.ts:33`,
  `libredteAdapter.ts:19`, `simpleApiAdapter.ts:30`). Solo Bsale es real. `noop` es el
  fallback success-shaped. Aceptable como scaffolding, pero `getSiiAdapter()` con
  `SII_PSE=openfactura` reventaría en runtime.
- 🟡 **`SusesoApiClient` (sii/susesoApiClient.ts) tiene CERO callers de producción** — es
  un cliente fetch real (submit DIAT/DIEP/ROI + `getStatus` con receipt) pero forward-
  looking, guardado server-only por comentario + contract test
  (`noBrowserSusesoApiClient.test.ts`). Coherente con directiva "no push"; queda en
  espera de mutualidades con API push + opt-in.
- 🟡 **`submitToMutualidad()` es stub consciente** — NO hace network call (no hay API
  pública de mutualidades 2026-05); solo estampa `submittedAt` para audit
  (`susesoService.ts:273-292`). `submitDiat/Diep/Roi` del ApiClient nunca se invocan.
- 🔵 **`dteSigner.ts` caveat productivo**: NO usa cert X.509 tradicional ni C14N W3C real;
  firma WebAuthn en envelope XMLDSIG-shaped. SII puede no aceptarlo — requiere escalamiento
  al usuario/contador/PSE antes de cualquier wire productivo (`dteSigner.ts:7-40`).
- 🔵 **Doble PDF renderer SUSESO**: `utils/susesoCertificate.ts` (346 LOC) y
  `services/suseso/diatPdfRenderer.ts` (227 LOC) coexisten; `susesoService` usa el de
  `utils`. Posible duplicación/dead-code a consolidar.
- 🔵 **Comentario stale** en `sii/index.ts:12-14`: dice "every PSE except noop throws
  SiiNotImplementedError" — falso desde que Bsale se volvió real. Doc-drift menor.

---

## 3. Tabla por archivo (selección load-bearing; resto verificado)

| Archivo | LOC | Estado | Cableado | Propósito real + hallazgo file:line |
|---|---|---|---|---|
| services/dte/dteAutoIssueOrchestrator.ts | 276 | ✅ | sí | Motor puro decisión DTE post-pago; RUT DV + heurística empresa/persona. `:198` |
| services/dte/dteIssueQueue.ts | 185 | 🟡 | parcial | Backoff/estados puros, sin persister wired. `:89` |
| services/billing/invoice.ts (tryAutoIssueDte) | — | ✅ | sí | Despacho real vía PSE, env-gated `DTE_AUTO_ISSUE`. `:221-277` |
| server/routes/billing.ts | — | 🟡 | parcial | webpay+MP emiten; mark-paid solo loggea. `:671,1092,1353` |
| server/routes/dte.ts | 439 | ✅ | sí | /create /:folio /cancel /generate, verifyAuth+idempotency. `:150` |
| services/sii/bsaleAdapter.ts | 572 | ✅ | sí | PSE REAL: fetch api.bsale.io, emitDte/createDte. `:297,363` |
| services/sii/openfacturaAdapter.ts | 38 | 🏚️ | sí (dispatch) | Stub SiiNotImplementedError. `:33` |
| services/sii/libredteAdapter.ts | 24 | 🏚️ | sí (dispatch) | Stub SiiNotImplementedError. `:19` |
| services/sii/simpleApiAdapter.ts | 35 | 🏚️ | sí (dispatch) | Stub SiiNotImplementedError. `:30` |
| services/sii/siiAdapter.ts | 203 | ✅ | sí | noopAdapter + calculateDteTotals + error classes. |
| services/sii/index.ts | 98 | ✅ | sí | getSiiAdapter() dispatch por SII_PSE; comentario stale `:12`. |
| services/sii/dteGenerator.ts | 197 | ✅ | sí | XML SII-canónico, NO push (sin fetch). `:17` |
| services/sii/dteSigner.ts | 271 | 🔵 | sí | Firma WebAuthn-XMLDSIG; caveat cert X.509/C14N. `:7-40` |
| services/sii/dtePdfRenderer.ts | 118 | ✅ | sí | PDF impresión + QR SII-style. |
| services/sii/siiPreflightCheck.ts | 325 | ✅ | sí | Validación ambiente/RUT/monto pre-PSE (puro). |
| services/sii/susesoApiClient.ts | 228 | 🟡 | NO | Cliente fetch real submit+getStatus, sin callers prod, server-only. `:122,210,222` |
| server/routes/suseso.ts | 402 | ✅ | sí | form/sign(WebAuthn)/submit/verify público+limiter. `:157,209,390` |
| services/suseso/folioGenerator.ts | 116 | ✅ | sí | Folio atómico runTransaction monotónico. `:99` |
| services/suseso/susesoService.ts | 293 | 🟡 | sí | create/sign/verify reales; submitToMutualidad stub `:273`. |
| utils/susesoCertificate.ts | 346 | ✅ | sí | PDF DIAT/DIEP jsPDF (usado por service). |
| services/suseso/diatPdfRenderer.ts | 227 | 🔵 | ? | Segundo PDF renderer; posible duplicado. |
| services/suseso/cumplimientoCalculator.ts | 238 | ✅ | sí | Tasas accidentab./siniestral. internas, no scraping. |
| services/suseso/monthlyReport.ts | 239 | ✅ | sí | Reporte mensual estructurado. |
| services/susesoBackend.ts | 87 | ✅ | sí | Gemini ROI preventivo + metadata DIAT/DIEP (no diagnosis). |
| server/jobs/sendSusesoReminders.ts | — | ✅ | sí | Cron vía maintenance.ts:109. |
| server/jobs/runLegalCalendarReminders.ts | — | ✅ | sí | Cron vía maintenance.ts:592. |
| services/regulatory/registry.ts | 314 | ✅ | sí | Citación DINÁMICA cite()/RegulationRef, tier-gated. `:224,304` |
| services/regulatory/jurisdictions/*.ts | 1076 | ✅ | sí | 14 jurisdicciones, datos de cita poblados (CL `:61`). |
| services/regulatory/iso45001.ts | 114 | ✅ | sí | Baseline 10 controles ISO 45001:2018. |
| services/regulatory/jurisdictionRegistry.ts | 133 | ✅ | sí | Perfiles jurisdicción + compare. |
| services/regulatory/privacyRegimes.ts / Registry | — | ✅ | sí | Catálogo regímenes privacidad. |
| services/compliance/adapters/cl/index.ts | 117 | ✅ | sí | Emisor CL real (delega generateDte/signer). |
| services/compliance/adapters/{ca,au,in,jp,kr,uk}/index.ts | ~60 c/u | 🏚️ | sí | throw AdapterNotImplementedError (ADR-0017). |
| services/compliance/registry.ts | 430 | ✅ | sí | Registry per-country (country,type)→adapter. |
| services/compliance/ley19628.ts | 575 | ✅ | sí | Derechos titular Ley 19.628/21.719. |
| services/compliance/trafficLightEngine.ts | 237 | ✅ | sí | Semáforo 8 categorías (puro). |
| services/compliance/ds67/ds67Service.ts | 320 | ✅ | sí | Reglamento Interno: folio+PDF+WebAuthn. |
| services/compliance/ds76/ds76Service.ts | 232 | ✅ | sí | Subcontratación minera: folio+PDF+WebAuthn. |
| services/compliance/normativeAuditLog.ts | 218 | ✅ | sí | Audit inmutable de mutaciones de normativa. |
| services/nonConformity/nonConformityEngine.ts | 184 | ✅ | sí | Ciclo NC↔acción correctiva (append-only). |
| services/industryRules/industryRuleEngine.ts | 178 | ✅ | sí | Auto-activa riesgos/docs por industria. |
| services/privacyRetention/dataRetentionPolicy.ts | 390 | ✅ | sí | Retención/consent/separación PII médica (puro). |
| services/legalCalendar/legalObligationsCalendar.ts | 239 | ✅ | sí | Cadencias DS594/DS54 anuales. |
| services/calendar/legalObligations.ts | 96 | ✅ | sí | Cadencias SST puras (DS54 mensual, etc.). |
| services/environmental/environmentalCompliance.ts | — | ✅ | sí | Cumplimiento ambiental. |
| server/routes/legalObligations.ts | 494 | ✅ | sí | verifyAuth×6 + guards. |
| server/routes/nonConformity.ts | 191 | ✅ | sí | verifyAuth×4 + guards. |
| server/routes/privacyRetention.ts | 285 | ✅ | sí | verifyAuth×5 + guards. |
| server/routes/regulatoryFramework.ts | 256 | ✅ | sí | verifyAuth×6 + guards. |
| server/routes/industryRules.ts | 259 | ✅ | sí | verifyAuth×6 + guards. |
| server/routes/compliance.ts | — | ✅ | sí | Ley 19.628 consent/data-request/RAT público. |
| server/routes/complianceEmit.ts | — | ✅ | sí | POST /:type emite vía registry, verifyAuth. `:74` |
| components/suseso/SusesoFormBuilder.tsx | 445 | ✅ | sí | UI→/api/suseso/form→sign WebAuthn. `:147` |
| components/shared/RegulatoryCitation.tsx | 103 | ✅ | sí | Citación dinámica cite(). `:54` |
| pages/SusesoReports.tsx | 549 | ✅ | sí | Embebe SusesoFormBuilder + reportes. |
| pages/LegalCalendar.tsx | 274 | ✅ | sí | Calendario obligaciones. |
| (demás componentes/hooks/tests B5) | — | ✅/🔵 | sí | ConsentBanner, ComplianceTrafficLight, Ds67/Ds76Builder, hooks use*, contract tests ds40/ds44/noBrowserSuseso. |

Leyenda: ✅ real · 🟡 parcial/deuda · 🏚️ stub · 🔵 nota/revisar · 🔑 secretos · 🔴 roto.

---

## 4. Para decisión del usuario (❓/⚠️)

- ⚠️ **DTE auto-issue solo en 2 de 3 rutas.** `mark-paid` manual (`billing.ts:671`) loggea
  la decisión pero NO emite. ¿Es intencional (pago manual = empresa emite a mano) o falta
  cablear? Si los planes enterprise se marcan paid manualmente, no se auto-emite DTE.
- ⚠️ **Sin persistencia de retry de DTE.** El path real bypassa `dteIssueQueue`; si Bsale
  cae tras un pago exitoso, el DTE se pierde (solo log+Sentry, sin reintento persistente).
  El backoff 1m→24h está construido pero inerte. ¿Priorizar el persister Sprint 50?
- ⚠️ **`getSiiAdapter()` puede romper en prod** si `SII_PSE` se setea a un PSE stub
  (openfactura/libredte/simpleapi). Solo `bsale` y `noop` son seguros hoy. ¿Validar
  `SII_PSE ∈ {bsale,noop}` en `validate-env.cjs`?
- ⚠️ **`dteSigner` modelo WebAuthn no estándar SII.** Antes de cualquier intento de
  presentación oficial requiere validación contador/PSE de que SII acepta el envelope
  (caveat explícito `dteSigner.ts:7`). Decisión de negocio pendiente.
- ❓ **Doble renderer PDF SUSESO** (`utils/susesoCertificate.ts` vs
  `services/suseso/diatPdfRenderer.ts`). ¿Consolidar o cuál es canónico?
- 🔵 Doc-drift menor: `sii/index.ts:12` afirma que todos los PSE menos noop son stubs
  (Bsale ya es real) — corregir comentario.
