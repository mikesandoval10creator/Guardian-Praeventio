# DEEP — needs-human: server (middleware/triggers/jobs/routes sin bloque) · 2026-06-02

**Archivos revisados:** 97 (filtro `block==="" && category==="FEAT-server"` del ledger.json)

Tanda "server sin-bloque": el monolito `server.ts` + todo `src/server/` que no
matcheó la heurística de bloque. Se compone de **4 subsistemas cross-cutting**
(middleware, jobs, triggers, rateLimit/sync/services/utils) más **60 routers de
dominio** que no cayeron en ningún bloque temático. Verificación code-first de
montaje (router mount coverage), auth (verifyAuth/assertProjectMember/b2dAuth/
schedulerToken), audit-log invariant y deuda (`console.*`).

---

## 1. Lo que YA HACE (por subsistema)

### Entrypoint
- `server.ts` (1501 LOC) — Express entry. Monta **todos** los routers de esta
  tanda. `verifyAuth` se importa global (`server.ts:46`); los routers públicos
  por diseño (health, BCN, B2D, reports/CSP) se montan ABOVE `verifyAuth` con
  comentario inline justificándolo (`server.ts:581,633,664,735`). KMS preflight
  cableado en boot (`server.ts:448`, falla cierre si `!ok` en `server.ts:452`).
  Triggers cableados en `server.ts:1406` (background) y `:1416` (systemEngine),
  con handles desmontados en SIGTERM.

### Middleware (13 archivos) — todos cableados ✅
- `verifyAuth` (importado global), `validate` (Zod factory, cierra H17),
  `limiters` (305 LOC, gemini/invoice/erp/b2dFree buckets),
  `securityHeaders`+`stampCspNonce` (CSP nonce, H16), `idempotencyKey`
  (Stripe-pattern, 370 LOC, Sprint 35 P1), `canonicalBody` (RFC 8785 para HMAC
  telemetry/MP IPN), `safeSecretEqual` (timingSafeEqual webhooks),
  `b2dAuth` (Bearer `pk_*` + scope, usado por b2d/* subroutes),
  `verifySchedulerToken` (Cloud Scheduler OIDC gate, H14),
  `verifyTwinStepUp` (ADR 0011 triple-gate server-side, Sprint 26),
  `assertProjectMemberMiddleware` (wrapper del helper puro),
  `captureRouteError` (bridge a Sentry ErrorContext),
  `largeBodyJson` (2MB opt-in para PDFs).

### Routes (60 routers) — **mount coverage 60/60** ✅
- Verificado uno-a-uno: cada `export default router` matchea un
  `app.use(...Router)` en `server.ts`. La gran mayoría bajo `/api/sprint-k`
  (≈90 mounts en bloque `server.ts:995-1159`). Auth: muestreo confirma
  `verifyAuth` + `assertProjectMember(uid, projectId)` en rutas con `:projectId`
  (`insights.ts:67,52`, `systemEvents.ts:30`, `import.ts:176`, `audit.ts:30+`).
  B2D subroutes usan su propio `b2dAuth('suite.all')` (`b2d/suite.ts:249`),
  montados ABOVE `verifyAuth` por diseño (`b2d/index.ts` doc).
- **75 de los routers escriben a `audit_logs`** (`auditServerEvent`/`writeAuditLog`).
  **0 usos de `void auditServerEvent`** (regla #14) en código de producción —
  el único hit es un comentario documentando un P0 ya corregido
  (`ds67ds76.ts:193`).

### Jobs (7 archivos) — 5 cableados, 2 huérfanos
- Cableados vía routes admin/maintenance: `checkExpiredPpe`
  (`maintenance.ts:27`), `runB2dMrrSnapshot` (`maintenance.ts:44` +
  `b2dAdmin.ts:31`), `firestoreCriticalReplicate.replicateCriticalData`
  (`admin.ts:45`), `weeklyDigest.runWeeklyDigest` (`admin.ts:49`),
  `dailyClimateRiskScan` (`admin.ts:56`).

### Triggers (2 cableados, 1 behind-flag) + sync/services/utils/rateLimit
- `backgroundTriggers` (476 LOC, FCM+RAG onSnapshot) y `systemEngineTrigger`
  (system_events listener) cableados con cleanup en SIGTERM.
- `firestoreRateLimitStore` (257 LOC) — store multi-replica Firestore para
  express-rate-limit (corrige MemoryStore en Cloud Run).
- `distributedLock` (350 LOC, ADR 0019), `projectTokens`+`fcmMulticast`
  (resolución/chunking FCM, PR #482), `serverZkNodeWriter` (writer ZK
  in-Express), `userLifecycle.deactivateUser` (revoca refresh tokens),
  `kmsPreflight` (boot gate), `types/express.d.ts` (Request augmentation).

---

## 2. Lo que está PENDIENTE (huérfanos/stubs/deuda)

- 🔵 **`jobs/consolidateZettelkasten.ts`** (194 LOC) — one-shot migration
  job. **Sin caller en producción** (solo su test). Por diseño: el operador
  pasa `mode:'commit'` en código; default dry-run; warning "DO NOT RUN against
  production without a backup" en header (`consolidateZettelkasten.ts:3`). No es
  bug — es un job de migración manual. Decisión usuario: ¿ejecutar la
  consolidación de fragmentación ZK descrita en el header (`:8-19`)?
- 🟡 **`jobs/runConsistencyAudit.ts`** (196 LOC,
  `runConsistencyAuditCron`) — **huérfano**. Header dice que el caller
  esperado es "`/api/maintenance/check-overdue` o un Cloud Scheduler dedicado"
  (`runConsistencyAudit.ts:16`) pero **no existe import en ningún route ni en
  server.ts**. Función + tests completos; falta solo cablearlo a un endpoint
  scheduler. Patrón gemelo a `checkExpiredPpe` (que sí está cableado).
- 🔵 **`triggers/zettelkastenMaterializer.ts`** (223 LOC) — **behind-flag,
  no importado**. Header explícito: "no se importa en server.ts hasta que el
  usuario active `MATERIALIZER_ENABLED=true`" (`zettelkastenMaterializer.ts:16`).
  Pure-core testeado; shim listo. Decisión usuario: ¿activar materializer?
- 🟡 **Deuda `console.*` (4 archivos en/cerca de scope, regla logger).**
  `rateLimit/firestoreRateLimitStore.ts:174,203,215,230` (4× `console.warn`
  en paths de fallo del store) y los observability-capture `console.warn` en
  `routes/projects.ts:63` y `routes/misc.ts:58`. Total server no-test: 20
  `console.*` (incluye sessionStore/triggers/healthCheck fuera de este filtro).
  Deberían migrar a `logger`.

---

## 3. Tabla por archivo

| Archivo | LOC | Estado | Montado/Cableado | Propósito + hallazgo file:line |
|---|---|---|---|---|
| server.ts | 1501 | ✅ | entrypoint | Monta 60/60 routers + triggers + KMS preflight `server.ts:448` |
| jobs/checkExpiredPpe.ts | 213 | ✅ | maintenance.ts:27 | EPP expiry sweep idempotente |
| jobs/consolidateZettelkasten.ts | 194 | 🔵 | sin caller (one-shot) | Migración ZK manual, dry-run default `:36` |
| jobs/dailyClimateRiskScan.ts | 296 | ✅ | admin.ts:56 | Scan climático diario |
| jobs/firestoreCriticalReplicate.ts | 185 | ✅ | admin.ts:45 | Replica audit_logs/invoices `:44` |
| jobs/runB2dMrrSnapshot.ts | 191 | ✅ | maintenance.ts:44, b2dAdmin.ts:31 | MRR snapshot B2D |
| jobs/runConsistencyAudit.ts | 196 | 🟡 | **HUÉRFANO** | Cron consistencia; caller esperado no existe `:16` |
| jobs/weeklyDigest.ts | 364 | ✅ | admin.ts:49 | Digest semanal |
| kmsPreflight.ts | 47 | ✅ | server.ts:448 | Boot gate KMS; cierra si !ok `:452` |
| middleware/assertProjectMemberMiddleware.ts | 96 | ✅ | usado por routes | Wrapper Express del helper puro |
| middleware/b2dAuth.ts | 109 | ✅ | b2d/*.ts | Bearer pk_* + scope check |
| middleware/canonicalBody.ts | 128 | ✅ | telemetry/MP IPN | RFC 8785 para HMAC |
| middleware/captureRouteError.ts | 55 | ✅ | routes | Bridge a Sentry ErrorContext |
| middleware/idempotencyKey.ts | 370 | ✅ | routes opt-in | Stripe-pattern Idempotency-Key |
| middleware/largeBodyJson.ts | 19 | ✅ | PDF routes | 2MB JSON opt-in |
| middleware/limiters.ts | 305 | ✅ | routes + server.ts | gemini/invoice/erp/b2dFree buckets |
| middleware/safeSecretEqual.ts | 35 | ✅ | webhooks | timingSafeEqual |
| middleware/securityHeaders.ts | 231 | ✅ | server.ts | CSP/HSTS defense-in-depth |
| middleware/stampCspNonce.ts | 35 | ✅ | server.ts | Reemplaza __CSP_NONCE__ (H16) |
| middleware/validate.ts | 81 | ✅ | routes | Zod factory (cierra H17) |
| middleware/verifySchedulerToken.ts | 48 | ✅ | adminJobs/maintenance | Cloud Scheduler gate (H14) |
| middleware/verifyTwinStepUp.ts | 194 | ✅ | twin routes | ADR 0011 triple-gate server |
| rateLimit/firestoreRateLimitStore.ts | 257 | 🟡 | server.ts | Store multi-replica; 4× console.warn `:174,203,215,230` |
| routes/adminBurden.ts | 145 | ✅ | sprint-k:1082 | — |
| routes/adminJobs.ts | 56 | ✅ | /api/admin/jobs:660 | verifySchedulerToken `:26` |
| routes/adoption.ts | 209 | ✅ | sprint-k:1117 | — |
| routes/annualReview.ts | 462 | ✅ | sprint-k | — |
| routes/audit.ts | 187 | ✅ | /api:868 | verifyAuth+assertProjectMember `:30` |
| routes/b2d/climate.ts | 220 | ✅ | b2d/v1:740 | b2dAuth |
| routes/b2d/index.ts | 36 | ✅ | server.ts:740 | Parent router, ABOVE verifyAuth (doc) |
| routes/b2d/normativa.ts | 144 | ✅ | b2d/v1 | b2dAuth |
| routes/b2d/suite.ts | 300 | ✅ | b2d/v1 | b2dAuth('suite.all') `:249` |
| routes/b2dAdmin.ts | 320 | ✅ | /api/admin/b2d:831 | assertAdmin inline |
| routes/bcn.ts | 140 | ✅ | /api/bcn:656 | **Público por diseño** (leyes BCN) `server.ts:654` |
| routes/cad.ts | 116 | ✅ | /api/cad:950 | — |
| routes/climateAwareScheduling.ts | 144 | ✅ | sprint-k:1139 | — |
| routes/consistency.ts | 169 | ✅ | sprint-k:1122 | — |
| routes/controlComparator.ts | 198 | ✅ | sprint-k:1051 | — |
| routes/costCalculator.ts | 134 | ✅ | sprint-k:1123 | — |
| routes/cphsMinute.ts | 645 | ✅ | sprint-k:1015 | RMW flag (regla #19) |
| routes/dataQuality.ts | 197 | ✅ | sprint-k:1041 | — |
| routes/deduplication.ts | 152 | ✅ | sprint-k:1079 | — |
| routes/documentVersioning.ts | 293 | ✅ | sprint-k:1068 | — |
| routes/driving.ts | 161 | ✅ | sprint-k:1137 | — |
| routes/drivingSafety.ts | 643 | ✅ | sprint-k:1030 | — |
| routes/ds67ds76.ts | 518 | ✅ | /api/compliance:974 | verifyAuth `:186`; P0 audit-await fix `:193` |
| routes/efficacyVerification.ts | 139 | ✅ | sprint-k:1063 | — |
| routes/eppFlow.ts | 581 | ✅ | sprint-k:1038 | usa serverZkNodeWriter |
| routes/escalation.ts | 305 | ✅ | sprint-k:1128 | — |
| routes/eventReplay.ts | 227 | ✅ | sprint-k:1083 | — |
| routes/expirations.ts | 156 | ✅ | sprint-k:1126 | — |
| routes/expressBundle.ts | 201 | ✅ | sprint-k:1087 | — |
| routes/fiveS.ts | 158 | ✅ | sprint-k:1101 | — |
| routes/import.ts | 399 | ✅ | /api:1165 | verifyAuth+idempotencyKey `:176,318` |
| routes/inbox.ts | 177 | ✅ | sprint-k:1046 | — |
| routes/insights.ts | 259 | ✅ | /api/insights:991 | verifyAuth+assertProjectMember `:52,67` |
| routes/iot.ts | 155 | ✅ | /api/iot:955 | export const IOT_* |
| routes/knowledgeBase.ts | 395 | ✅ | sprint-k:1021 | RMW flag (regla #19) |
| routes/leadership.ts | 321 | ✅ | sprint-k:1028 | — |
| routes/misc.ts | 346 | ✅ | /api:897 | environment/forecast gated `:99`; console.warn `:58` |
| routes/multiProject.ts | 163 | ✅ | sprint-k:1064 | — |
| routes/multiRoleSummary.ts | 237 | ✅ | sprint-k:1060 | — |
| routes/openapi.ts | 61 | ✅ | /api:745 | OpenAPI spec serve |
| routes/pdca.ts | 468 | ✅ | sprint-k:1022 | — |
| routes/pinSign.ts | 326 | ✅ | sprint-k:1108 | — |
| routes/privacyShield.ts | 177 | ✅ | sprint-k:1077 | — |
| routes/projectClosure.ts | 675 | ✅ | sprint-k:1029 | — |
| routes/projects.ts | 645 | ✅ | /api/projects:910 | invitations público+verifyAuth `:16`; console.warn `:63` |
| routes/protocols.ts | 170 | ✅ | sprint-k:1142 | — |
| routes/push.ts | 92 | ✅ | /api/push:876 | verifyAuth `:38` |
| routes/readReceipts.ts | 279 | ✅ | sprint-k:1146 | — |
| routes/reputationalAlerts.ts | 149 | ✅ | sprint-k:1073 | — |
| routes/retaliationProtection.ts | 151 | ✅ | sprint-k:1071 | — |
| routes/returnToWork.ts | 244 | ✅ | sprint-k:1080 | — |
| routes/roiScenario.ts | 108 | ✅ | sprint-k:1081 | — |
| routes/roleViews.ts | 104 | ✅ | sprint-k:1151 | — |
| routes/routeScoring.ts | 162 | ✅ | sprint-k:1056 | — |
| routes/routing.ts | 143 | ✅ | sprint-k:1141 | — |
| routes/sif.ts | 122 | ✅ | sprint-k:1032 | — |
| routes/suppliers.ts | 568 | ✅ | sprint-k:1023 | — |
| routes/systemEvents.ts | 72 | ✅ | /api/system-events:928 | verifyAuth `:30` |
| routes/upsell.ts | 80 | ✅ | sprint-k:1078 | — |
| routes/vulnerability.ts | 77 | ✅ | sprint-k:1031 | — |
| routes/waste.ts | 81 | ✅ | sprint-k:1033 | — |
| routes/wisdomCapsule.ts | 485 | ✅ | /api:901 | usa serverZkNodeWriter |
| routes/workerHistory.ts | 243 | ✅ | sprint-k:1143 | — |
| routes/workerReadiness.ts | 907 | ✅ | sprint-k:1012 | router más grande de la tanda |
| routes/zettelkasten.ts | 523 | ✅ | /api/zettelkasten:922 | verifyAuth+assertProjectMember+writeLimiter `server.ts:921` |
| services/projectTokens.ts | 261 | ✅ | jobs/emergency | Resuelve FCM tokens por rol |
| services/serverZkNodeWriter.ts | 169 | ✅ | eppFlow/incidentFlow/wisdom | Writer ZK in-Express |
| services/userLifecycle.ts | 87 | ✅ | admin/lifecycle | deactivateUser revoca tokens |
| sync/distributedLock.ts | 350 | ✅ | SyncManager | Lock Firestore multi-replica (ADR 0019) |
| triggers/backgroundTriggers.ts | 476 | ✅ | server.ts:1406 | FCM+RAG onSnapshot; 1× console |
| triggers/systemEngineTrigger.ts | 104 | ✅ | server.ts:1416 | system_events listener + SIGTERM cleanup |
| triggers/zettelkastenMaterializer.ts | 223 | 🔵 | **behind-flag, no importado** | MATERIALIZER_ENABLED gate `:16` |
| types/express.d.ts | 49 | ✅ | global d.ts | Request augmentation (H19) |
| utils/fcmMulticast.ts | 72 | ✅ | jobs/emergency | Chunked multicast 500-token (PR #482) |

---

## 4. Para decisión del usuario (❓/⚠️)

- ⚠️ **`runConsistencyAuditCron` huérfano** (`runConsistencyAudit.ts:131`) — la
  función + tests están completos pero **nada la invoca**. El header promete un
  caller en `/api/maintenance/check-overdue` o Cloud Scheduler dedicado
  (`:16`) que no existe. Acción: cablear a un endpoint `verifySchedulerToken`
  como su gemelo `checkExpiredPpe` (`maintenance.ts:27`), o documentarlo
  explícitamente como pendiente en `docs/stubs-inventory.md`.
- ❓ **`zettelkastenMaterializer` behind-flag** (`:16`) — ¿activar
  `MATERIALIZER_ENABLED=true` y cablear en `server.ts`? Está listo y testeado;
  hoy no corre.
- ❓ **`consolidateZettelkasten` one-shot** (`:8-19`) — el header describe
  fragmentación silenciosa real entre `nodes`, top-level `zettelkasten_nodes` y
  `tenants/{tid}/zettelkasten_nodes`: knowledge escrito por el endpoint
  canónico **nunca llega al RAG embedder**. ¿Ejecutar la migración (dry-run →
  commit con backup)?
- ⚠️ **Deuda `console.*`** — migrar a `logger`:
  `firestoreRateLimitStore.ts:174,203,215,230`, `projects.ts:63`,
  `misc.ts:58`.
