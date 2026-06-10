# Auditoría Ola A — B19 Plataforma + B23 Estado compartido

Fecha: 2026-06-10 · Rama: `claude/buenas-6ahumq` · Auditor: Claude (Phase 5, áreas transversales fuera de B1-B18)

Criterio: la prueba de "real" es que la lógica cumpla su propósito de punta a punta
(quién lo invoca → qué hace → quién consume el resultado). Severidades:
🔴 roto-en-prod · 🟡 integridad · 🔵 limpieza/doc-drift.

---

## B19.1 — `server.ts` (1.519 LOC)

**Qué queda en el monolito.** Solo bootstrap: KMS preflight (fail-fast prod,
`server.ts:456-465`), Sentry/OTel init, Firebase Admin init (fail-fast en prod,
`server.ts:539-546`), security headers + helmet, request-id, limiters globales
(Firestore-backed vía `makeFirestoreRateLimitStore`, `server.ts:691-737`),
session store Firestore (`server.ts:793-822`), ~170 montajes `app.use`, Vite
middleware dev / static+SPA prod, error handler terminal, `app.listen` +
arranque de triggers/jobs in-process. Todos los handlers de dominio ya viven en
`src/server/routes/` — el split está efectivamente completo; lo que queda es la
tabla de montaje.

**Orden de boot** correcto y defendido por contract test (`#506 serverMountOrder`):
health/AASA/B2D/openapi ANTES del limiter global; SPA catch-all al final solo-prod;
error handler 4-args último (`server.ts:1388-1414`, nunca filtra `err.message` — cumple regla #8).

Hallazgos:

- 🔴 **Triggers/jobs in-process sobre Cloud Run con `--min-instances=0` y sin
  `--no-cpu-throttling`** (`.github/workflows/deploy.yml:97-100` +
  `server.ts:1421-1501`). Los listeners `onSnapshot` (FCM de incidentes críticos,
  RAG, systemEngine) y los `setInterval` (envPolling 10 min, healthCheck 6 h)
  solo ejecutan mientras existe una instancia CON CPU asignada — en Cloud Run
  con throttling por defecto la CPU se retira entre requests y con
  min-instances=0 el servicio escala a cero. El "real-time" de alertas críticas
  es, en producción, best-effort-mientras-haya-tráfico. **Cablear:** o (a)
  `--no-cpu-throttling` + `--min-instances=1` en deploy.yml, o (b) migrar los
  listeners a invocación por Cloud Scheduler / Eventarc. Documentar la decisión.
- 🟡 **SIGTERM sin `server.close()`** (`server.ts:1506-1519`). El handle de
  `app.listen` no se captura; el handler limpia listeners/intervals y hace
  `process.exit(0)` inmediato → requests in-flight cortadas a mitad de escritura
  durante cada rolling deploy (riesgo de doc escrito sin audit_log). No hay
  handler SIGINT. **Cablear:** `const srv = app.listen(...)` →
  `srv.close(() => process.exit(0))` con timeout de drenado < 10 s.
- 🔵 `stampCspNonce` se importa (`server.ts:45`) pero nunca se monta — import
  muerto; `securityHeaders.ts:210` ya escribe `res.locals.cspNonce`.
- 🔵 Monkey-patch de `admin.firestore` vía `Object.defineProperty`
  (`server.ts:524-538`) para el databaseId no-default — funciona pero es frágil
  ante upgrades de firebase-admin; preferible un módulo `getDb()` propio.
- 🔵 ~140 montajes bajo el prefijo legado `/api/sprint-k` (`server.ts:1008-1177`)
  — funcional, pero el nombre de sprint en la URL pública es deuda de naming
  congelada por compatibilidad de clientes.

## B19.2 — `src/server/middleware/`

| Middleware | ¿Usado? | ¿Hace lo que dice? |
|---|---|---|
| `verifyAuth.ts` | sí (global en routers) | ✅ Real: `checkRevoked=true`, sesión absoluta 8 h vía `auth_time`, gate E2E que rehúsa boot en prod (`verifyAuth.ts:49-54`) |
| `validate.ts` | sí (~150 routers) | ✅ Zod first-barrier |
| `auditLog.ts` | sí (~70 routers) | ✅ |
| `idempotencyKey.ts` | sí (~20 routers) | ✅ Firestore-backed (`idempotencyKey.ts:204,237`) — multi-réplica safe |
| `verifySchedulerToken.ts` | adminJobs + maintenance | ✅ fail-closed 503 sin secret — pero ver 🔴 B19.3 (el caller real nunca manda el secret) |
| `securityHeaders.ts` / `largeBodyJson` / `safeSecretEqual` / `canonicalBody` / `b2dAuth` / `geminiCircuit` / `captureRouteError` | sí | ✅ |
| `assertProjectMemberMiddleware.ts` | solo organic + gamification | OK (el resto llama `assertProjectMember` función) |

Hallazgos:

- 🟡 **Todos los limiters per-route de `limiters.ts` usan MemoryStore** (ninguno
  recibe `store:`; el wrapper Firestore `makeRateLimitStore` solo se aplica a los
  2 limiters globales de `server.ts:714,736`). Consecuencias multi-réplica:
  `geminiGlobalDailyLimiter` (`limiters.ts:291-304`) — el cap GLOBAL diario de
  gasto IA es en realidad per-réplica (N réplicas = N× presupuesto);
  `b2dFreeLimiter` (`limiters.ts:282-289`) — el cap free-tier "1.000 req/30 días"
  se resetea con cada deploy/restart y por réplica (el propio comentario admite
  "Production needs a Redis store — TODO"). **Cablear:** pasar
  `makeFirestoreRateLimitStore` (ya existe) como `store:` a los limiters de
  cuota/costo; los de UX (polling) pueden quedarse en memoria.
- 🟡 **`requireTier` solo se usa en `oauthGoogle.ts`.** CLAUDE.md #11 lo declara
  el check canónico server-side, pero analytics/branding/multi-tenant y demás
  superficies de gestión no lo montan — el tier-gating efectivo hoy es casi
  todo UX-only en `SubscriptionContext`. Mitigante: `firestore.rules:280-285`
  sí bloquea el spoof de `subscription.*`, así que el dato del plan es íntegro;
  falta APLICARLO en rutas. **Cablear:** inventariar features de gestión por
  plan (PRICING.md) y montar `requireTier(minPlan)` ruta por ruta.
- 🟡 **`verifyTwinStepUp.ts` es huérfano** (0 importadores fuera de su test). El
  protocolo documentado en su header (ADR 0011 triple-gate: endpoint
  `/api/twin/stepup` que emite el JWT + header `X-Twin-Step-Up` exigido en
  endpoints del twin) nunca se cableó — el enforcement del gate biométrico del
  Digital Twin es solo client-side, exactamente lo que el comentario dice que
  no basta. **Cablear:** crear `/api/twin/stepup` y montar el middleware en las
  rutas que sirven geometría/objetos del twin (coordinar con B-DigitalTwin).

## B19.3 — `src/server/jobs/` (quién invoca cada job)

Mapa real de invocación:

| Job | Invocador real | Estado |
|---|---|---|
| `checkOverdueMaintenance`, `checkExpiredPpe`, `sendSusesoReminders`, `runResilienceHealthAlert` | `POST /api/maintenance/check-overdue` (`maintenance.ts:79`) | montado, gated `verifySchedulerToken` |
| `runLoneWorkerEscalation` | `POST /api/maintenance/run-lone-worker-escalation` (`maintenance.ts:326`) | montado, gated `verifySchedulerToken` |
| `runExceptionAutoExpire`, `runWorkPermitAutoExpire`, `runLegalCalendarReminders` | `POST /api/maintenance/run-daily-housekeeping` (`maintenance.ts:513`) | ídem |
| `runB2dMrrSnapshot` | `POST /api/maintenance/run-b2d-mrr-snapshot` (`maintenance.ts:277`) | ídem |
| `aggregateAiFeedback` | `POST /api/admin/jobs/aggregate-ai-feedback` (`adminJobs.ts:26`) | ídem |
| `weeklyDigest` | `POST /api/admin/jobs/weekly-digest` (`admin.ts:448`) | gated **verifyAuth+admin** |
| `dailyClimateRiskScan` | `POST /api/admin/jobs/climate-scan` (`admin.ts:489`) | gated **verifyAuth+admin** |
| `firestoreCriticalReplicate` | `POST /api/admin/replicate-critical` (`admin.ts:411`) | gated **verifyAuth+admin** |
| `runConsistencyAudit` | `POST .../consistency` (stateless, body del cliente) | no es cron real |
| `consolidateZettelkasten` | **NADIE** | huérfano (runbook "pendiente crear") |

- 🔴 **Ningún cron provisionado por `deploy.yml` puede autenticarse.** Los pasos
  "Setup Cloud Scheduler" (`deploy.yml:170-324`) crean los jobs con
  `--oidc-service-account-email` → Cloud Scheduler envía
  `Authorization: Bearer <JWT OIDC>`. Pero: (a) `verifySchedulerToken.ts:40-43`
  compara el bearer contra el literal `SCHEDULER_SHARED_SECRET` → un JWT OIDC
  jamás coincide → **401 en cada tick** de `maintenance-check-overdue`; (b)
  `climate-scan`, `weekly-digest` y `replicate-critical` apuntan a rutas gated
  por `verifyAuth` (token Firebase + rol admin) → un OIDC de Scheduler tampoco
  pasa `verifyIdToken` → **401 siempre**. Resultado: aunque un owner provisione
  los crons tal como están escritos, **cero jobs corren en producción** (DR
  replication horaria incluida — contradice `DR_RUNBOOK.md:131`).
  **Cablear:** elegir UN mecanismo — o el shared secret (`--headers
  "Authorization=Bearer $SCHEDULER_SHARED_SECRET"` en gcloud y mover
  weekly-digest/climate-scan/replicate-critical detrás de
  `verifySchedulerToken` además del path admin manual), o validar OIDC real
  (verificar JWT contra la SA del scheduler). Añadir un smoke post-deploy que
  invoque cada endpoint cron y exija 200.
- 🔴 **`runLoneWorkerEscalation` (cadencia 5 min, "vidas dependen" según
  `SCHEDULER_INVENTORY.md:14`) no está en NINGÚN paso de provisioning de
  deploy.yml**, y el snippet manual del runbook
  (`SCHEDULER_INVENTORY.md:60,73`) usa el header `X-Scheduler-Token=...` que el
  middleware NO lee (lee `Authorization: Bearer`) → quien siguió el runbook
  obtuvo 401 silenciosos. La escalación de trabajador solitario hoy no corre
  sola. Mismo destino: `run-daily-housekeeping`, `run-b2d-mrr-snapshot`,
  `aggregate-ai-feedback` (sin provisioning automatizado).
- 🟡 Los dos pasos de scheduler en deploy.yml llevan `continue-on-error: true`
  (`deploy.yml:182,260`) con la justificación de que la SA de deploy no tiene
  permisos — es decir, se sabe que probablemente no-opean, y no existe alerta
  compensatoria que avise "los crons no existen". **Cablear:** job de
  reconciliación (el `gcloud scheduler jobs list` del runbook) en un workflow
  programado que falle si el conteo < 10.
- 🟡 `SCHEDULER_INVENTORY.md` driftea de la realidad: header equivocado, paths
  inexistentes (`/api/jobs/daily-climate-risk-scan`,
  `/api/jobs/run-consistency-audit`, `/api/jobs/weekly-digest` — los reales
  viven bajo `/api/admin/jobs/*` o no existen), y promete 10 jobs cuando
  deploy.yml intenta 4.
- 🟡 `consolidateZettelkasten.ts` (193 LOC + test): sin invocador; el runbook de
  consolidación ZK sigue "pendiente crear post-Bloque L4". **Cablear:** endpoint
  admin-gated `mode: dry-run|commit` o script CLI documentado.

## B19.4 — `src/server/triggers/`

- `backgroundTriggers` + `systemEngineTrigger` + `healthCheck` SÍ se inicializan
  al boot (`server.ts:1424-1454`), con unsubscribe cableado a SIGTERM. No son
  código muerto — pero:
- 🔴 **El trigger de incidente crítico → FCM lee el campo equivocado.**
  `backgroundTriggers.ts:213` lee `users/{uid}.fcmToken` (singular, legado)
  mientras el registro canónico `POST /api/push/register-token` escribe
  `users/{uid}.fcmTokens` con `arrayUnion` (`push.ts:57`). Existe el helper que
  une ambos (`src/server/services/projectTokens.ts:136-143`, ya usado por
  `emergency.ts` tras el fix H7 del Sprint 32) — el trigger no lo usa. Efecto:
  supervisores cuya app móvil registró token vía Capacitor **no reciben el push
  de incidente crítico/Alto**; solo funciona para el path web legado
  (`NotificationContext.tsx:87`, que aún escribe el singular). **Cablear:**
  reutilizar `projectTokens.ts` en el trigger (mismo patrón que emergency.ts).
- 🟡 Los 3 listeners de `backgroundTriggers` y el de `systemEngineTrigger`
  corren en TODAS las réplicas sin lease (a diferencia de envPolling/
  healthCheck que sí usan `acquireLease`). La idempotencia es check-then-set
  sin transacción (`backgroundTriggers.ts:178-188`) → doble FCM/email
  cross-réplica posible. El comentario lo declara out-of-scope; con >1 réplica
  deja de serlo. **Cablear:** transaction sobre `_criticalAlertSentAt` o lease.
- 🟡 **`systemEngineTrigger` es un no-op en producción.** Su header promete
  "persists a server-side audit log for every system event", pero el código
  solo dedupe en memoria y llama un hook `onEvent` opcional
  (`systemEngineTrigger.ts:51-84`)… y `server.ts:1435-1437` lo invoca **sin
  `onEvent`**. Un collectionGroup listener que consume cuota de snapshots para
  no hacer nada. **Cablear:** pasar un `onEvent` real (audit server-side /
  políticas server-only) o no suscribir hasta tenerlo.
- 🟡 **`zettelkastenMaterializer` es código muerto detrás de un flag que nadie
  chequea.** Su header dice "no se importa en server.ts hasta que el usuario
  active MATERIALIZER_ENABLED=true" (`zettelkastenMaterializer.ts:15-17`), pero
  ese flag no aparece en `server.ts` ni en ningún otro módulo — ni siquiera
  existe el branch condicional. **Cablear:** añadir el bloque
  `if (process.env.MATERIALIZER_ENABLED === 'true')` en el boot, o registrar el
  módulo en `docs/stubs-inventory.md` (regla #13).

## B19.5 — `.github/workflows/`

Gates que SÍ corren en PR (`ci.yml`): roles-sync, typecheck, vitest, validate-env
(modo test), rules-tests contra emulador Firestore+Storage real, firestore-stores
contra emulador, ADR-0012 replay, build. `e2e.yml` con
`continue-on-error: false` (`e2e.yml:90`). `mutation.yml` nightly ya sin
continue-on-error (Sprint 39 B.1). `firestore-backup.yml` cron diario 07:00 UTC;
`dr-dryrun.yml` mensual; `codeql`/`ossar` semanales. Sin jobs desactivados que
enmascaren fallos, salvo:

- 🟡 **No existe job de ESLint en ningún workflow** (único "lint" es el Fastfile
  de mobile-release). CLAUDE.md afirma "CI runs … lint" — falso hoy: `npm run
  lint` solo corre localmente. Un PR con lint roto (incl. la regla custom de
  `Math.random` en server, regla #15) merge-a verde. **Cablear:** job `lint`
  en ci.yml (`npm run lint` ya incluye `firestore.rules`).
- 🟡 Los dos pasos de Cloud Scheduler en deploy.yml con `continue-on-error:
  true` (ver B19.3) — verde engañoso del deploy.
- 🔵 El comentario de `ci.yml:69-74` dice que prod valida env "via the
  package.json start path consuming validate:env" — falso: `start` es
  `NODE_ENV=production tsx server.ts` y los `Dockerfile`/`Dockerfile.api` hacen
  `CMD tsx server.ts` directo. `validate-env.cjs` nunca corre en boot prod.
  **Cablear:** `"start": "node scripts/validate-env.cjs && NODE_ENV=production tsx server.ts"`.

## B19.6 — `scripts/`

- ✅ Guards realmente cableados: `.husky/pre-commit` ejecuta medical-guard,
  convention-guard, validate-i18n, any-ratchet, **stub-guard** y
  **allowbackup-guard** (las reglas #13/#17 ya están wired, como dice CLAUDE.md).
  `check-frozen.cjs` registrado en `.claude/settings.json` (PreToolUse). ✅
  `render-well-known.mjs` + `download-mediapipe-models.mjs` corren en `prebuild`.
  `canary-monitor`/`retro-weekly` referenciados por slash-commands;
  `backup/restore-firestore` por firestore-backup.yml; `dr-*` por dr-dryrun.yml.
- 🔵 **Huérfanos sin referencia en package.json/workflows/runbooks** (19):
  `debug_browser.mjs`, `fix-mojibake.mjs`, `migrate-auth-headers.mjs`,
  `generateZettelkastenMarkdown.ts`, `backfill_bcn_norma_id.cjs`,
  `pinecone-bootstrap.mjs`, `generate-ar-models.mjs`, `generate-ar-usdz.mjs`,
  `generate-medical-icons.mjs`, `convert-to-webp.mjs`, `download-slm-model.mjs`,
  `compute-slm-sha256.mjs`, `firestore-pentest.mjs`, `audit-file-ledger.cjs`,
  `check-coverage-ratchet.cjs`, `analyze-coverage.cjs`,
  `audit-coverage-census.cjs`, `audit-test-coverage-map.cjs`,
  `seed-poster-embeddings.md`. La mayoría son codemods one-shot legítimos —
  **cablear:** mover a `scripts/one-shot/` con README, o referenciar desde el
  runbook que los usa. Caso especial: `firestore-pentest.mjs` merece un
  workflow_dispatch para no oxidarse.
- 🔵 `reconstruct_faena.py` + `ply_to_glb.py`: reliquias del pipeline COLMAP
  server-side **superseded** por la decisión on-device §2.28 — documentar la
  supersesión en el propio archivo (no borrar, según principio rector).

## B23.7 — `src/contexts/`

✅ **No hay providers huérfanos**: `App.tsx:545-562` monta Firebase + Language +
NormativaSwitch, y `src/providers/AppProviders.tsx:110+` monta Accessibility,
AppMode, Theme, Normative, Project, Subscription, UniversalKnowledge,
Notification, Emergency, SystemEngine, SLM, Mesh, Sensor (orden documentado y
testeado).

- 🟡 **Escrituras Firestore directas sin audit_logs (Regla #3)** — ninguno de
  estos paths llama `auditService`/`POST /api/audit-log`:
  `EmergencyContext.tsx:126,214` (crea/cierra `emergency_events` — el fan-out
  FCM sí va por server, pero el evento en sí no deja audit);
  `ProjectContext.tsx:224` (creación de proyecto);
  `UniversalKnowledgeContext.tsx:224,239-240` (nodes + conexiones);
  `FirebaseContext.tsx:139,157` (seed de usuario/nodos);
  `NotificationContext.tsx:87` (fcmToken). **Cablear:** `auditService.log(...)`
  tras cada write, o migrar las escrituras al endpoint server correspondiente
  (proyectos ya tiene `/api/projects`).
- 🟡 **Doble registro divergente de token FCM**: `NotificationContext.tsx:87`
  escribe `users/{uid}.fcmToken` (singular, web) mientras el path móvil usa
  `POST /api/push/register-token` → `fcmTokens[]`. Combinado con el hallazgo
  🔴 de B19.4, decide qué usuarios reciben alertas críticas. **Cablear:**
  NotificationContext debe llamar al endpoint server (que además audita).
- 🔵 `SubscriptionContext.tsx:140` intenta `setDoc` de `subscription.*` desde el
  cliente; `firestore.rules:280-285` (fix Round 22 DT-05) lo deniega para
  update y el create no pasa `isValidUser` → escritura silenciosamente muerta,
  tragada por el catch. Inofensivo para seguridad (las rules SÍ impiden el
  self-upgrade de plan) pero es código que nunca tuvo éxito en prod — retirar
  el branch o moverlo a un endpoint server.

## B23.8 — `src/store/` (estado de la migración Zustand)

- 🔵 **Doc-drift en CLAUDE.md**: `src/store/` no contiene "Zustand stores" —
  Zustand no es dependencia directa del repo (solo mencionado en comentarios).
  El único archivo es `eventBus.ts`. Los stores reales viven en
  `src/services/*/​*Store.ts` sobre la factory
  `src/services/firestore/createProjectScopedStore.ts` (9 stores la usan:
  operationalChange, exceptions, loneWorker, stoppage, shiftHandover,
  readReceipts, siteBook, legalCalendar, safetyTalks — más
  `useProjectFirestoreCollection`). La migración está hecha en services, no en
  store/.
- 🟡 **DOS event buses duplicados y AMBOS huérfanos**: `src/store/eventBus.ts`
  (Sprint 39 C.4, API estilo Zustand + `useSyncExternalStore`) y
  `src/services/eventBus/{eventBus,integrations}.ts` (misma "Fase C.4",
  throttle por tipo). **Cero importadores fuera de sus tests** para los dos. El
  "sistema nervioso central" (sensor.fall → twin/SOS/sync) que ambos prometen
  no está cableado a ningún emisor ni suscriptor. **Cablear:** consolidar en
  UNO (preservando throttle + tipado), conectar los emisores obvios
  (sensorBus, EmergencyContext, sync queue) y borrar… no: marcar el otro como
  superseded e importar desde el canónico.
- 🟡 La factory `createProjectScopedStore` escribe `setDoc`/`updateDoc`
  client-side sin rastro en `audit_logs` — la Regla #3 se viola sistémicamente
  en los 9 stores que la usan (mismo patrón que B23.7). **Cablear:** hook de
  audit en la factory (un solo punto) que postee a `/api/audit-log`.

## B23.9 — `src/utils/` (spot-check de realidad)

- ✅ `randomId.ts` — real: `crypto.randomUUID()` con fallback explícitamente
  marcado `fallback-…` (señal auditable, no polyfill engañoso). Testeado.
- ✅ `sqliteEncryption.ts` — real y MEJOR que la regla: usa el secure store
  nativo del plugin (`isSecretStored`/`setEncryptionSecret`), passphrase 256-bit
  WebCrypto, y deliberadamente NO usa `@capacitor/preferences`.
  🔵 CLAUDE.md #16 dice "passphrase … via @capacitor/preferences" — el código
  hace lo contrario (correctamente, Codex P1 3308579640); actualizar la regla.
- ✅ `offlineStorage.ts` — usa `ensureSqliteEncryptionSecret` + AES-256-GCM real
  (`offlineCrypto.ts`, migración desde el viejo base64). IDB como fallback web.
- ✅ `logger.ts` con `runWithRequestContext` (request-id propagation) usado por
  el middleware de `server.ts:594-606`.

---

## Tabla resumen severidad × área

| Área | 🔴 | 🟡 | 🔵 |
|---|---|---|---|
| B19.1 server.ts | 1 (triggers in-process × scale-to-zero) | 1 (SIGTERM sin drain) | 3 |
| B19.2 middleware | — | 3 (limiters MemoryStore; requireTier sin montar; verifyTwinStepUp huérfano) | — |
| B19.3 jobs/scheduler | 2 (OIDC vs shared-secret → 0 crons corren; lone-worker 5 min sin provisioning) | 3 (continue-on-error sin alerta; inventory drift; consolidateZettelkasten huérfano) | — |
| B19.4 triggers | 1 (FCM lee `fcmToken` singular → móviles sin alerta crítica) | 3 (sin lease multi-réplica; systemEngine no-op; materializer flag fantasma) | — |
| B19.5 workflows | — | 2 (sin job ESLint; scheduler steps verdes engañosos) | 1 (validate:env no corre en boot prod) |
| B19.6 scripts | — | — | 2 (19 huérfanos; reliquias COLMAP sin nota de supersesión) |
| B23.7 contexts | — | 2 (writes sin audit ×5 contexts; doble registro FCM) | 1 (Subscription setDoc muerto) |
| B23.8 store | — | 2 (2 event buses huérfanos duplicados; factory sin audit) | 1 (CLAUDE.md drift) |
| B23.9 utils | — | — | 1 (regla #16 vs código) |
| **Total** | **4** | **16** | **9** |

### Top 5 acciones (vida/seguridad primero)

1. Fix `backgroundTriggers.ts:213` → usar `projectTokens.ts` (alerta crítica a móviles).
2. Unificar auth de Cloud Scheduler (OIDC o shared-secret) + provisionar
   `run-lone-worker-escalation` cada 5 min + smoke post-deploy de crons.
3. Decidir `--no-cpu-throttling`/`min-instances=1` o migrar triggers a invocación externa.
4. Mover los limiters de cuota/costo (`geminiGlobalDailyLimiter`, `b2dFreeLimiter`)
   al store Firestore existente.
5. Audit-log hook en `createProjectScopedStore` + contexts (Regla #3 sistémica).
