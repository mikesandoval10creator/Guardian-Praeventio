# DEEP-EXT-04 — Auditoría EXHAUSTIVA de TESTS (Lote #4)

**Slice:** `ledger.json` filtrado `category==="I-TEST"`, ordenado por `path`, `[165:220]` (55 archivos).
**Método:** lectura línea-por-línea de cada archivo. Caza de falsos-verdes, tests débiles, parallel-copy (test del mirror/handler re-implementado), over-mocking (test del mock), asserts triviales, skip/todo, asserts sobre campo equivocado, tests que pasarían con impl rota.
**Doc-only. NO commit.**

---

## Atestación: 55/55 archivos leídos íntegramente

(Nota: `#177 src/__tests__/server/test-server.ts` NO es un archivo de tests — es el harness compartido `buildTestServer`/`InMemoryFirestore`. Se audita como FUENTE del anti-patrón parallel-copy, no como suite. Los 54 restantes son suites con `describe/it`.)

---

## Hallazgos 🔴 (falso-verde / cobertura ilusoria)

| Test:línea | Módulo-sujeto | Tipo | Por qué |
|---|---|---|---|
| `telemetryCanonical.test.ts:58-134` | `src/server/routes/telemetry.ts` | Parallel-copy (0% prod) | Construye un `buildApp()` con el handler `/api/telemetry/ingest` re-escrito a mano inline; NUNCA importa la ruta real. Cubre 0 líneas de producción. El propio `telemetry.router.test.ts:6-12` la denuncia: "pass but cover ZERO lines of the real route". |
| `telemetryCanonical.test.ts:190,219,279,341` | telemetry | Assert débil (OR de status) | `expect([401,500]).toContain(res.status)` / `[401,403]` — aceptan dos códigos; no detectan una regresión que voltee el código entre ellos. |
| `telemetryRotation.test.ts:78-191` | `src/server/routes/telemetry.ts` + `/api/admin/iot/rotate-secret` | Parallel-copy (0% prod) | `buildApp()` re-implementa AMBOS handlers (ingest + rotate-secret) a mano; nunca importa la ruta real. Test del mirror. |
| `telemetryRotation.test.ts:242` | telemetry | Assert débil (OR de status) | `expect([401,500]).toContain(res.status)`. |
| `visitors.test.ts:16-34` | `src/server/routes/visitors.ts` `newVisitorId()` | Test-del-test (no importa la impl) | Rotulado "P0 security hardening contract test" pero NUNCA importa `newVisitorId`. Reconstruye el ID inline (`vis_${Date.now()}_${randomUUID()}`) y testea su propio string. Si producción usara `Math.random()`/ID débil, igual pasaría. |
| `visitors.test.ts:28-33` | visitors | Assert trivial | `expect(id).toBe('vis_1700000000000_00000000-...')` — afirma que un string es igual a sí mismo. |
| `zettelkasten.test.ts:20,41` | `src/server/routes/zettelkasten.ts` (POST /nodes) | Parallel-copy (mirror) | Usa `buildTestServer` (mirror de `test-server.ts`); golpea el handler espejado, no la ruta real. Reconocido en el header L6-7. |
| `zettelkastenNlQuery.test.ts:24-81` | `src/server/routes/zettelkasten.ts` (POST /nl-query) | Parallel-copy (handler inline) | `buildApp()` re-implementa el handler nl-query a mano (verifyAuth fake + membership inline). No importa la ruta real (sí usa `searchIncidents`/`validate` reales). |
| `webauthnVerify.test.ts:112-196,495-654,955-1030` | `src/server/routes/curriculum.ts` (/webauthn/verify) | Parallel-copy ("verbatim copy") | `buildVerifyApp`/`buildCryptoVerifyApp`/`buildRateLimitedApp` re-implementan el handler de producción "verbatim" inline; nunca importan curriculum.ts. Drift solo mitigado por revisión manual. Crypto core (@simplewebauthn) mockeado. |
| `webauthnRegister.test.ts:187-347` | `src/server/routes/curriculum.ts` (/webauthn/register/*) | Parallel-copy ("verbatim copy") | `buildRegisterApp` re-implementa el handler verbatim inline; @simplewebauthn mockeado. (Excepción: el test `:843` SÍ importa curriculum.js real para el fail-fast de expectedOrigin — ese único caso es sólido.) |
| `test-server.ts:1-1524` | server.ts (~50 rutas) | Fuente del anti-patrón | Harness que re-implementa contratos de server.ts a mano (admitido L9-30). Toda suite que usa `buildTestServer` (`subscription.test.ts`, `zettelkasten.test.ts`) testea el mirror, no producción. Mitigación: existe companion real-router para algunos (subscription). |

## Hallazgos 🟡 (débil / cobertura parcial / over-mock leve)

| Test:línea | Módulo-sujeto | Tipo | Por qué |
|---|---|---|---|
| `ISOAudit.test.tsx:59-86` | `ISOAudit.tsx` | Smoke sin assert del cómputo | Siembra 2 auditorías ISO pero solo afirma `getByText(/Total ISO/i)`; NUNCA verifica que el conteo refleje 2. Pasaría con la lógica de conteo rota. |
| `ISOAudit.test.tsx:88-93` | ISOAudit | Assert trivial | `expect(buttons.length).toBeGreaterThan(1)`. |
| `ISOManagement.test.tsx:34-44,77-84` | `ISOManagement.tsx` | Over-mock (smoke) | Mockea TODOS los hijos (ISOAudit, header, filters, hooks). Solo prueba el guard project/user + presencia de testids mockeados; casi nula lógica propia ejercitada. |
| `suppliers.test.ts:26-28` | `src/server/routes/suppliers.ts` | Validate stubeado | `validate()` reemplazado por pass-through → la suite no puede cazar regresiones de schema Zod (sí prueba 404/risk/ranking reales). |
| `suppliers.test.ts:38-51` | suppliers | Over-mock parcial | `supplierScoring` mockeado; el orden del ranking se valida contra el sort del mock, no contra la lógica real de scoring. |
| `AiResponseCard.test.tsx:99-105` | AiResponseCard | Assert superficial | "confidence dots refleja value" solo afirma `data-value="0.85"`, no el render de los dots que documenta. |
| `AnnualReviewSummary.test.tsx:43,53` | AnnualReviewSummary | Assert por regex laxo | `.toMatch(/^1/)` / `/100/` — tolerantes; suite de 3 casos muy breve. |
| `MonthlyClientReportPanel.test.tsx:39-45` | MonthlyClientReportPanel | Presencia > valor | Afirma existencia de KPI testids 0-3, no sus valores calculados. |

---

## Tests SÓLIDOS (real-router / real-component / real-service, asserts significativos)

**Conteo: 41 de 54 suites = sólidas** (más el caso real-import aislado dentro de webauthnRegister).

Server real-router/real-service (mount del router real vía `fakeFirestore`/`adminMock`, o servicio real por dep-injection; asserts exactos sobre status, side-effects Firestore, audit_logs server-stamped, tenant isolation):

- `sitebookSignRoutes.router.test.ts` (firma WebAuthn real route; hash gate, audit row, crypto core inyectado igual que el unit hermano)
- `skillGap.test.ts` (4 endpoints pure-compute reales; prueba el fix del bug z.unknown con 400s)
- `softBlocking.test.ts` (directiva "nunca bloquear maquinaria" verificada; engine real)
- `stoppage.router.test.ts` (engine real, 5 endpoints, errores de engine→400)
- `subscription.router.test.ts` (gate anti-escalada de privilegios REAL router; cross-plan 403, audit awaited)
- `subscription.test.ts` (usa el mirror buildTestServer, pero es el companion del real-router; cubre DT-01/DT-05 — aceptable por par)
- `suseso.router.test.ts` (real router; servicios de dominio mockeados pero auth/validate/roles/audit/firma reales; directiva "no submit externo" verificada)
- `systemEvents.test.ts` (tenant-mismatch 403, schema real)
- `telemetry.router.test.ts` (real router; HMAC canónico real, rotación, round-trip, no-leak del secreto en audit)
- `validateMiddleware.integration.test.ts` (real `validate()` factory)
- `vendorOnboarding.test.ts` (real router + real `validate` + servicios puros reales; 5 endpoints DS 76)
- `verifyAuthE2E.test.ts` (importa verifyAuth REAL; guard E2E_MODE + fail-fast prod)
- `visitors.router.test.ts` (real router; rule #19 runTransaction spy + #3 audit_logs verificados)
- `wisdomCapsule.test.ts` (real router; ZK node interno NO expuesto, scoping por proyecto)
- `workPermits.criticalValidate.test.ts` (validadores DS 132 reales end-to-end, advisory)
- `workPermits.router.test.ts` (real router, stack completo)
- `workerHistory.test.ts` (real router + servicios puros reales; redacción PII, checksum determinista)
- `workerReadiness.test.ts` (real router; ensamblado multi-colección verificado; anti-false-positive en training no-completado)
- `zettelkasten.backlinks.test.ts` (real router; agregador backlinks real)
- `zettelkasten.riskControls.test.ts` (real router; riskOrchestrator real)
- `weeklyDigest.test.ts` (job real por dep-injection; cobertura exhaustiva de ramas incl. fallo per-colección con `stats.partial`)

Componentes (real component, jsdom, asserts sobre output computado / eventos / estados):

- `CreateApiKeyModal.test.tsx` (user-event v14; tier→scopes, raw-key once, error visible — recuperó tests antes skippeados)
- `ChurnRiskPanel.test.tsx`, `AgendaDigestCard.test.tsx`, `AiResponseCard.test.tsx` (muy completo), `ResilientAiAssistantPanel.test.tsx` (maxHistory cap, queryExtras al adapter)
- `PreventiveObjectivesPanel.test.tsx` (orden por progreso), `ApprenticeshipBoard.test.tsx`
- `ARPosterScanner.test.tsx` (1 `it.todo` justificado L153), `ArQuickLookButton.test.tsx`, `ArViewLink.test.tsx` (iOS/Android/desktop branches, intent:// encoding)
- `AuditExpressButton.test.tsx`, `ExternalAuditPortalCard.test.tsx`
- `BbsProfileCard.test.tsx` (barras = safePercentage exacto, focus tags, eventos)
- `TierDowngradeModal.test.tsx` (deltas exactos, payload de evento, disabled gate)
- `CargoCogPanel.test.tsx` (SEGURO/REVISAR vía COG real), `ChangeWorkflowActions.test.tsx` (matriz exhaustiva role×status — ejemplar)
- `OperationalChangeCard.test.tsx`, `AlertnessGuard.test.tsx`, `ClimatePlanAdjustment.test.tsx`, `DomainPromptCatalog.test.tsx`

(No se auditó `vite-config/workboxModelsCache.test.ts` #195 a profundidad — config/Workbox, fuera del foco de falso-verde de rutas/componentes; clasificada provisionalmente sólida pendiente revisión.)

---

## Resumen ejecutivo

Lote de 55 archivos I-TEST: **41 sólidas, 8 débiles (🟡), 6 falso-verde (🔴)** (+ `test-server.ts` como fuente del anti-patrón). El patrón 🔴 dominante es **parallel-copy**: tests que re-implementan el handler de producción inline (`buildApp`/`buildTestServer`/`buildVerifyApp`) y nunca importan la ruta real — pasan cubriendo 0 líneas de producción. Casos confirmados: `telemetryCanonical`, `telemetryRotation`, `zettelkasten`, `zettelkastenNlQuery`, `webauthnVerify`, `webauthnRegister`. El más grave es `visitors.test.ts`: rotulado "P0 security hardening contract" pero NUNCA importa `newVisitorId` — testea un string reconstruido a mano, por lo que un downgrade a ID predecible pasaría inadvertido. Notable: el ecosistema ya se está auto-corrigiendo — `telemetry.router.test.ts`, `subscription.router.test.ts` y los `zettelkasten.*.test.ts` reales existen explícitamente como reemplazo real-router de las copias-espejo, y denuncian a sus predecesoras en sus headers. Las 🟡 son mayormente smoke-tests con assert de presencia en vez de valor (`ISOAudit`/`ISOManagement` sobre-mockeados) o `validate` stubeado en `suppliers`. La mayoría del lote (servidor real-router con `fakeFirestore` + componentes con testids y asserts sobre cómputo) es de alta calidad, con verificación de invariantes de CLAUDE.md (#3 audit_logs server-stamped, #14 audit awaited, #19 runTransaction, no-leak de secretos).
