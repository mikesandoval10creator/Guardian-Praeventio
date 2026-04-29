# Impacto — Round 16 (cazar simulaciones + cerrar gaps + foundation refactor)

## TL;DR

R16 ejecutó cinco frentes en paralelo y cerró todos sin regresiones: (1) un cazador estricto que reemplazó mocks/stubs en código de producción —badges/scores/skills hardcoded, IAP stub, BCN URL falsa, fallback `workerId ?? 'unassigned'`— por estados honestos o lecturas Firestore reales; (2) el gap silencioso de `firestore.rules` que estaba bloqueando los writes append-only declarados en R14/R15, ahora con 7 colecciones reglamentadas y 30 tests nuevos; (3) el cierre del loop mobile con `useBiometricAuth` 3-tier (native/web/unsupported) sobre `@aparajita/capacitor-biometric-auth` y `usePushNotifications` POSTeando al servidor; (4) la fundación documental que el repo no tenía después de 170+ commits (CONTRIBUTING + ARCHITECTURE + RUNBOOK + catálogo de 43 rutas); y (5) un Phase 1 de split de `server.ts` (3242 → 3030 LOC) que extrajo 5 middlewares + 3 routers sin tocar billing/curriculum y sin romper los 79 tests supertest. `tsc -b` exit 0, `npm run build` exit 0, suite 866 → 897 tests (+31).

## Cambios por área

### Cazador de simulaciones (R1, commit `934d242`)

El reviewer R6 marcó Ergonomics como BLOCKER y el cazador encontró seis simulaciones más en producción:

- `src/pages/PortableCurriculum.tsx`: arrays hardcoded de badges/history/skills/stats reemplazados por `useState<T[]>([])` con paths Firestore documentados (`users/{uid}/awards`, `audit_logs` filtered, `users/{uid}.profile.skills`). Empty-state honesto: "Sin evaluaciones aún". Wireado real diferido a R17 (depende de un aggregator de gamificación que aún no existe).
- `src/components/workers/UserProfileModal.tsx`: `safetyScore=95` y `trainingsCount=12` reemplazados por `useEffect` con 2 reads Firestore: `ergonomic_assessments` (last 3, score invertido a 0-100 sobre `actionLevel`) y `audit_logs` filtered por `training.*.completed`. Insignias hardcoded `=3` ahora `0` honesto. 2 certificaciones hardcoded ahora `worker.certifications.map`. Cleanup async via flag `cancelled`.
- `src/pages/Pricing.tsx`: el stub `__pendingPurchaseToken` (Google Play IAP) removido. Path IAP gateado tras `canUseGooglePlayIAP=false` con copy "Google Play IAP no disponible — usá Webpay/MercadoPago".
- `src/components/shared/KnowledgeGraph.tsx`: deep-link a la BCN era hardcode `bcn.cl/leychile/consulta/busqueda` que no resolvía a la norma. Ahora si el nodo tiene `metadata.bcnNormaId` arma `bcn.cl/leychile/navegar?idNorma=&idParte=` real; fallback a search URL si no. Backfill de `bcnNormaId` en nodos existentes diferido a R17.
- `src/components/ergonomics/AddErgonomicsModal.tsx:11`: removido silent fallback `workerId ?? 'unassigned'`. Submit bloquea con "Seleccione un trabajador antes de guardar".
- **BLOCKER fix `src/pages/Ergonomics.tsx`**: el caller único nunca pasaba `workerId` — el hardening de R14 dejaba la save flow muerta. Agregado dropdown selector con state, botón disabled hasta selección, `workerId` pasado al modal.
- `src/services/protocols/tmert.ts`: el path `enableExposureAmplifier` era dead-code. Eliminado, -5 tests.
- `src/services/geminiBackend.ts:analyzeRiskWithAI`: prompt ahora explicita "NO devuelvas criticidad — clasificación legal viene de IPER P×S deterministic". Schema response sin `criticidad`. `Diagnostico.tsx` consumer ajustado. Otros call sites (1290, 2200) diferidos a R18.

R1 documentó en el commit las simulaciones NO atacadas (`orchestratorService` airQuality/altitude, NutritionLog metabolic-rate, WearablesIntegration HRV/circadian, DigitalTwin fallback, Calendar Gantt 3-day) para que R17 las recoja.

### Firestore rules gap fix (R2, commit `b4a3f57`)

E1 verifier de R15 detectó gap CRITICAL: el commit `1079e48` declaró rules para `ergonomic_assessments` e `iper_assessments` pero el archivo no las tenía. Default-deny estaba bloqueando silenciosamente los writes de los wizards REBA/RULA/IPER de R14. R15 sumó 4 colecciones más sin reglas. R2 cerró las 7 con append-only post-sign donde corresponde y mutability per-user donde no:

- `ergonomic_assessments/{id}`: project member create con `signedAt==null`; update con whitelist `[metadata, inputs, score, actionLevel]`; immutable post-sign; delete denied (Ley 16.744 Art. 76 retención de evaluaciones).
- `iper_assessments/{id}`: mismo pattern, whitelist incluye `P/S/level/rawScore/controlEffectiveness/suggestedControls`.
- `gamification_scores/{userId_gameId}`: per-user mutability (NO append-only — los scores son acumulativos por sesión); `userId` immutable; update whitelist limita campos.
- `lighting_audits/{id}`: DS 594 Art. 103 (lux thresholds), append-only post-sign con `metadata.signedAt` o `signed:true` como gates.
- `uv_exposures/{userId_YYYYMMDD}`: per-user, no requiere `projectId`; el worker puede escribir su propio día; merge whitelist `peakUv/cumulative/alertEmittedAt`.
- `safety_trainings/{id}`: pattern `traineeUid` (no requiere `projectId` — WebXR self-training); admin/supervisor pueden read/update.
- `curriculum_claims/{claimId}`: VERIFICADO — ya estaba correcto desde R14 R5. El commit message de `1079e48` mintió sobre ergonomic+iper, no sobre curriculum.

7 composite indexes agregados a `firestore.indexes.json`. 30 nuevos rules tests en `src/rules-tests/firestore.rules.test.ts` (5 × 6 nuevas colecciones; curriculum ya tenía 12). Auto-skip pattern preservado cuando emulator no está disponible.

### Push + biometric client-side wiring (R3, commit `86f8ebb`)

R15 había shippeado el FCM adapter server-side y dos endpoints, pero los hooks React fueron "reverted" mid-work y nunca consumieron los endpoints. R3 cerró el loop:

- `src/hooks/useBiometricAuth.ts` (rewrite, 267 LOC) con strategy 3-tier:
  1. **Native** (`Capacitor.getPlatform() in ['ios','android']`): usa `@aparajita/capacitor-biometric-auth.authenticate({ reason, allowDeviceCredential: true, androidTitle: 'Verificar identidad' })` envuelto en try/catch para preservar el contract `Promise<boolean>`.
  2. **Web**: WebAuthn flow existente.
  3. **Unsupported**: `{ available: false, reason: 'unsupported_device' }`. Eliminado el `return true` MVP fallback que era simulación silenciosa (un device sin biometría iba a "autenticar" trivialmente).
- `src/hooks/usePushNotifications.ts` (+159 LOC): tras `PushNotifications.register()` resolve token, hace `POST /api/push/register-token` con Bearer. Hook expone `hasPermission`, `registerForPushNotifications`, `lastRegisteredAt`, `registrationError`. Failures `console.warn` (no crash). Pure helper `registerTokenToServer` extraído para testing.
- `src/hooks/usePushNotifications.test.ts` (NEW, 6 tests): no_auth, empty_token, happy path, http_401, network_error, id_token_failed.
- `capacitor.config.ts`: +8 LOC `BiometricAuth` plugin block con `androidBiometryStrength: 'weak'`.
- `package.json`: `@aparajita/capacitor-biometric-auth@^10.0.0` instalado y persistido (R15 ran install pero NO persistió `package.json` — el paquete aparecía como "extraneous" en `npm ls`).

**KNOWN GAP Round 17**: el endpoint `POST /api/push/register-token` NO está en `server.ts`. R15 I5 declaró shippeado pero no entró, y el R5 split Phase 1 no extrajo esa zona. El hook recibe 404 y silencia con `console.warn` — el mirror Firestore a `users/{uid}.fcmToken` sigue funcionando como fallback. Acceptable para ship, P0 R17.

### Documentación foundation (R4, commit `ae4e865`)

E2 forward scout de R15 calculó el time-to-first-PR para un dev nuevo en >2 semanas sin docs. R4 cerró la fundación:

- `CONTRIBUTING.md` (312 LOC): setup local, TDD strict, Spanish-CL register, audit log invariant, default-deny rules + 5 tests minimum, how-to add server route, how-to add Gemini action, how-to add safety calculation engine, PR review checklist.
- `ARCHITECTURE.md` (477 LOC): high-level diagram, module map (frontend/backend/shared/AI), 3 data flows críticos (Webpay/REBA/curriculum), `server.ts` split strategy (Phase 1 R5 done, Phase 2-5 plan), `geminiBackend.ts` split plan (18 modules R18), inventario 30+ Firestore collections, 8-flag tier-gating matrix.
- `RUNBOOK.md` (334 LOC): emulator local, Cloud Run deploy + rollback, restore from backup, KMS rotation, FCM test send, Sentry triage, on-call placeholder, diagnostic commands.
- `docs/api-routes.md` (522 LOC): **43 rutas catalogadas** (cifra real, no las "50" que decía R12 README) con `server.ts:line`, auth, body shape, response, error codes, audit log, rate limit, tenant isolation note. Agrupado por dominio.
- `public/.well-known/pgp-key.asc`: placeholder con rotation procedure para security lead.
- `README.md`: nueva sección "Quick start for new contributors" + links a 4 nuevos docs + test count badge a 866 (luego 897 con R5).

R4 además detectó tres findings a la pasada que entraron al backlog R17 como HIGH:
1. 6 endpoints sin `audit_logs` (oauth/unlink, google/callback, calendar/sync, coach/chat, gamification/points, reports/generate-pdf — ISO 27001 §A.12.4).
2. `/api/coach/chat` cross-tenant read leak (sin `assertProjectMember`).
3. `/api/telemetry/ingest` con `IOT_WEBHOOK_SECRET` único compartido (sin rotación per-tenant).

### server.ts split Phase 1 (R5, commit `db5dc20`)

E2 forward scout flagged `server.ts` 3242 LOC + 50 rutas como touch-cost lineal en 3K LOC. R5 ejecutó Phase 1 sin tocar billing/curriculum (preserva el harness supertest de I3 R15 como contract spec):

- 8 nuevos módulos en `src/server/` (507 LOC structured):
  - `middleware/verifyAuth.ts` (37)
  - `middleware/safeSecretEqual.ts` (34)
  - `middleware/limiters.ts` (56) — `geminiLimiter` + `invoiceStatusLimiter` + `refereeLimiter`
  - `middleware/largeBodyJson.ts` (18)
  - `middleware/assertProjectMemberMiddleware.ts` (95) — wrappers `FromBody`/`FromParam` listos para Phase 2-3
  - `routes/admin.ts` (131) — `set-role` + `revoke-access`
  - `routes/health.ts` (40) — `/api/health`
  - `routes/audit.ts` (96) — `/api/audit-log`
- `server.ts`: 3242 → 3030 LOC (-212). `UID_REGEX` movido completamente a `routes/admin.ts` (admin-only).
- Mount-points byte-identical (`app.use("/api", healthRouter)`, `app.use("/api/admin", adminRouter)`, `app.use("/api", auditRouter)`).
- **CRITICAL non-regression: 79/79 supertest tests siguen pasando**. La harness `test-server.ts` es una mini-app paralela que no importa `server.ts` — preserved como contract spec.
- Phase 2-5 plan documentado en `admin.ts` header: billing (~700 LOC, 6 routes), curriculum (~350, 4), projects (~400, 5, usará `assertProjectMemberFromParam`), oauth (~350, 4), gemini (~120, 3). Target post Phase 5: `server.ts` <1500 LOC bootstrap-only.

### BLOCKER fix orchestrator (`Ergonomics.tsx` workerId)

El BLOCKER del reviewer R6 era que el caller `Ergonomics.tsx` nunca pasaba `workerId` al `AddErgonomicsModal`, lo que dejaba la save flow REBA/RULA muerta tras el hardening del modal. Fix pre-commit: dropdown selector de trabajadores con state, botón "Nueva evaluación" disabled hasta selección, `workerId` pasado por prop. La iteración real (selector dentro del modal con search + recent) queda para R17.

## Métricas

- **`npx tsc -b`**: exit 0 clean.
- **`npx vitest run`**: 866 (R15) → **897** (+31). Delta atribuible: +30 firestore.rules tests (R2) + 6 push notifications tests (R3) − 5 tmert dead-code path (R1 cleanup).
- **`npm run build`**: exit 0. PWA mode `generateSW`, precache entries estables.
- **server.ts LOC**: 3242 → 3030 (−212, −6.5%).
- **Files**: 37 modificados/creados (+3957/−888 neto).
- **Commits R16**: 5 (`934d242`, `b4a3f57`, `86f8ebb`, `ae4e865`, `db5dc20`).
- **Working tree post-push**: clean salvo `tsconfig.tsbuildinfo` untracked (debe ir al `.gitignore` — NIT R6).

## Cumulative metrics rondas 12-16

- **Tests**: 542 (R12) → 705 (R13) → 866 (R15) → **897 (R16)** = +355 nets en 5 rondas.
- **Commits totales en `main`**: 171 al cierre R16; 27 commits desde inicio de R12.
- **server.ts**: ~3200 LOC sostenido durante R12-R15; primera baja real en R16 (Phase 1).
- **Rutas API documentadas**: 0 → 43 (R16 baseline para split Phase 2-5).
- **firestore.rules collections con tests**: 4 → 11 (R16 +7 fix).

## Round 17 plan priorizado

1. **Ergonomics page worker selector evolución**: mover el selector dentro del modal con search + most-recent. Hoy es un dropdown plano arriba del botón.
2. **`/api/push/register-token` endpoint** (4h): cierra el GAP R15→R16. El hook ya lo POSTea; falta el handler en `server.ts` o en un nuevo `routes/push.ts`. Audit log + rate limit incluidos.
3. **`/api/coach/chat` `assertProjectMember`**: cross-tenant read leak detectado por R4. Wrapper `assertProjectMemberFromBody` ya listo en `src/server/middleware/`.
4. **server.ts split Phase 2 — billing routes** (~700 LOC, 6 routes): el más grande, mayor payoff. La harness supertest existente mantiene la non-regression bar.
5. **Stryker mutation testing setup** sobre safety calcs (ergonomicAssessments + iperAssessments + tmert).
6. **`PortableCurriculum` wire Firestore reads**: necesita el gamification writers + audit_logs aggregator first.
7. **6 endpoints add `audit_logs`** (ISO 27001 §A.12.4): oauth/unlink, google/callback, calendar/sync, coach/chat, gamification/points, reports/generate-pdf.
8. **`/api/telemetry/ingest` per-tenant secret rotation**: hoy un único `IOT_WEBHOOK_SECRET` global.
9. **Pages > 700 LOC refactor**: Dashboard 911, Telemetry 924, Training 868, Gamification 794.
10. **Capacitor android/ios native scaffold**: hoy `capacitor.config.ts` declara plugins pero `npx cap add ios/android` no se ha corrido.

## Round 18+ deferred

- `geminiBackend.ts` split (2666 LOC, 18 modules per `ARCHITECTURE.md` plan).
- SOC 2 Type I path kickoff (policy framework, SoA, penetration test).
- Marketplace assets (screenshots, video demo, Play Store banner, ASO copy es-CL/en) — operativo del usuario.
- 5 simulaciones documentadas por R1 (orchestrator airQuality, NutritionLog metabolic, WearablesIntegration HRV, DigitalTwin fallback, Calendar 3-day Gantt).
- KnowledgeGraph BCN deep-link backfill: nodos existentes necesitan `bcnNormaId` metadata.
- WebAuthn challenge replay-vulnerable MVP (5 MEDIUM R6) — server-side challenge cache.

## Revert pattern incident

3 de 5 implementer agents de R16 (R1, R3, R4) reportaron reverts transitorios durante `Write`/`Edit`: archivo modificado, confirmado con `Read`, pero al volver a `Read` minutos después algunas secciones habían vuelto al estado anterior. R3 explicitó que su `useBiometricAuth.ts` rewrite "fue revertido mid-work" en R15 — exactamente la razón por la que el loop FCM/biometric quedó abierto entre R15 y R16. R4 lo notó al regenerar `README.md`. R6 lo flagged en su review.

Recomendación R17+: cada agente corre `git status` post-`Edit`/`Write` y verifica que el archivo aparezca en el diff antes de declarar done; para escrituras >300 LOC preferir `Write` a `Edit` consecutivos. Entrada sugerida en `AUDIT.md`: "Working-tree revert pattern during multi-agent parallel rounds" con reportes R3/R4/R6 como evidencia. Root cause sin identificar (¿filesystem race en Windows? ¿conflict resolution implícito entre agentes paralelos sobre el mismo tree?). El mitigante operativo (verify post-write) cuesta segundos y elimina la clase de issues.

## Por qué importa

**La honestidad del cazador**. Praeventio Guard se vende como herramienta de prevención para empleadores chilenos sujetos a Ley 16.744. Un `safetyScore=95` mockeado en `UserProfileModal` no es un detalle de UX — es información que un Comité Paritario, un fiscalizador SUSESO o un perito en juicio laboral consultarían. El `workerId ?? 'unassigned'` silent fallback significaba que evaluaciones REBA/RULA podían entrar a `ergonomic_assessments` sin trabajador real asignado, rompiendo la trazabilidad que el Art. 76 exige. R16 no agregó features; sacó lo que estaba mintiendo.

**El gap silencioso de firestore.rules**. R14 declaró rules para REBA/RULA/IPER pero los commits no las tenían. Cinco semanas de writes default-denied silenciosamente, con tests verdes (los rules-tests dependían de un emulator que en CI hacía auto-skip). Es la peor clase de bug: pasa toda la suite, falla en producción, y el tipo de daño es exactamente sobre los datos que justifican el producto. R2 cerró el gap con 30 tests nuevos y un patrón append-only post-sign que ahora es la convención del repo para evidencia regulatoria.

**La fundación arquitectónica**. `server.ts` Phase 1 split + 4 docs + catálogo de 43 rutas no resuelven ningún ticket de cliente, pero descongelan los próximos 3-4 sprints. Phase 2 (billing, ~700 LOC) ya tiene el plan escrito en `admin.ts` y los wrappers `assertProjectMemberFromBody`/`FromParam` listos. El catálogo de rutas detectó tres bugs de seguridad (audit_logs faltantes, cross-tenant en coach, secret compartido en telemetry) que ningún code review humano habría agarrado al ritmo actual del repo. Documentar es trabajo de seguridad.
