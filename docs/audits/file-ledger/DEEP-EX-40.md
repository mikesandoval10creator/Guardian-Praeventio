# DEEP-EX-40 — Pasada exhaustiva línea-por-línea (Lote #40)

**Deriva:** `ledger.json` → `category` empieza con `FEAT` && `block === "CROSS"`,
ordenado por `path`, slice `[55:110]`.
**Universo:** 159 archivos `FEAT`/`CROSS`; este lote cubre el slice `[55:110]`
(55 archivos): el resto de `src/server/middleware/*` (idempotencyKey,
largeBodyJson, limiters, safeSecretEqual, securityHeaders, stampCspNonce,
validate, verifySchedulerToken, verifyTwinStepUp), `firestoreRateLimitStore`,
las routes B2D (`b2d/{climate,index,normativa,suite}`, `b2dAdmin`), `iot`,
`misc`, `openapi`, `privacyShield`, `push`, `systemEvents`, los triggers
(`backgroundTriggers`, `systemEngineTrigger`), `types/express.d.ts`, y la franja
de `src/services/*`: `adService`, `b2d/{apiKeyService,externalClimate,usage}`,
`battery/batteryAdvisor`, `bundlePerf/bundleSizeAnalyzer`, `dataSeedService`,
`email/{index,resendService,templates}`, `erp/erpAdapter`,
`eventBus/{eventBus,integrations}`, `eventStore/{inMemoryEventStore,types}`,
`firestore/{createProjectScopedStore,resilientReader}`,
`foregroundService/guardianForegroundService`, `i18n/culturalConventions`,
`identity/rutValidators`, `immutable/pdfImmutableService`, todo `iot/*`
(edgeFilter, firestoreBridge, ingestRuleEngine, mqttAdapter, mqttClient,
probabilityFailureScoring, types) y `mcp/*` (stdioBoot, zettelkastenServer,
zettelkastenStdioAdapter).
**Foco:** middleware con bypass, rateLimit evadible (multi-replica store),
cripto débil, privacy mal mapeado, colecciones sin regla, tenantId del cliente
sin token, secretos hardcodeados, `Math.random` en server/IDs (#15), auth/audit
faltante (#3/#14), 5xx-leak (#8), gemini-whitelist (#5), stubs (#13), promesas
sin await, doc-drift.
**No repite:** `DEEP-NH-server.md`, `DEEP-NH-services-infra.md` (ya cubrió el
patrón general "`Math.random` para IDs en código cliente, rule 15 solo aplica a
`src/server/`"), `DEEP-NH-services-knowledge.md` (ya marcó `eventBus/{eventBus,
integrations}.ts` como huérfanos ~549 LOC y `mcp/*` zettelkasten como infra
stdio). `DEEP-EX-39.md` se cita como base pero **no existe en el repo** (la serie
EX llega hasta EX-35); se omite sin pérdida — ninguno de los hallazgos abajo
overlapa con EX-30..35.

## Atestación 55/55

Los 55 archivos del slice fueron leídos completos línea-por-línea. Los 9
middleware, `firestoreRateLimitStore`, las 6 routes B2D/admin + `iot`/`misc`/
`privacyShield`/`push`/`systemEvents`/`openapi`, los 2 triggers y `express.d.ts`
se leyeron íntegros; en `src/services/*` los 30 archivos (engines puros,
adapters, templates, validators, MCP) se leyeron completos. Cruces verificados
contra `server.ts:680-728` (wiring del `makeRateLimitStore` → solo el limiter
global `api:` + `csp:` reciben store Firestore; los per-route limiters NO),
`src/server/routes/{gemini,suseso,curriculum,aiFeedback,zettelkasten}.ts`
(confirmar que montan los limiters de `limiters.ts` sin override de store),
`src/server/routes/push.ts` vs `backgroundTriggers.ts:213` (campo FCM
singular/plural), `src/server/routes/emergency.ts:67-111` (contrato canónico
`users/{uid}.fcmTokens[]` + legacy singular), `docs/stubs-inventory.md` (registro
de los stubs cloud/emqx), y `src/server/middleware/auditLog.ts` (contrato
no-throw de `auditServerEvent`).

## Hallazgos

| # | Sev | Archivo:línea | Hallazgo |
|---|-----|---------------|----------|
| 1 | 🟡 | `src/server/middleware/limiters.ts:291-304` (+ todo el archivo; wiring en `server.ts:683-691,706,728`) | **El cap GLOBAL de gasto IA (`geminiGlobalDailyLimiter`) — y TODOS los limiters per-route de este archivo — usan `MemoryStore` por-pod, no el store Firestore multi-réplica. En Cloud Run el cap "global" real es N×.** `server.ts` define `makeRateLimitStore()` (Firestore-backed, multi-instance-safe) y lo cablea **solo** al limiter global `/api/*` (`api:`) y al `csp:`. NINGUNO de los ~12 limiters exportados por `limiters.ts` recibe `store:` — son MemoryStore. Para los caps per-uid (gemini/webauthn/aiFeedback/zettel) la degradación es suave (un atacante con un Bearer obtiene N× su cuota individual). Pero `geminiGlobalDailyLimiter` (`:291`, `keyGenerator: () => 'gemini-global-bucket'`, statusCode 503) existe **precisamente** para tapar el gasto AGREGADO de todos los usuarios — su comentario (`:253-261`) dice "caps aggregate spend regardless of who is calling". Con MemoryStore cada réplica lleva su propio bucket de 1000/día, así que el cap efectivo es `réplicas × GEMINI_DAILY_GLOBAL_CAP` y se reinicia en cada cold-start/deploy. El objetivo de control de costos se diluye en autoscaling. Montado en `gemini.ts:217,381,485`. |
| 2 | 🟡 | `src/server/triggers/backgroundTriggers.ts:213` | **El trigger de alerta de incidente crítico (FCM al CPHS) lee solo el campo FCM LEGACY `users/{uid}.fcmToken` (singular) — los dispositivos registrados por el endpoint canónico `/api/push/register-token` NO reciben la push.** El Trigger 1 (incidentes Crítica/Alta → multicast FCM + email CPHS) resuelve tokens con `tokenDocs.map((d) => d.data()?.fcmToken)` (singular string). Pero `push.ts:57` escribe el token en `users/{uid}.fcmTokens` (plural array, vía `arrayUnion`), y `emergency.ts`/`maintenance.ts` fueron explícitamente migrados (`emergency.ts:67-74,93-111`) a leer el array plural con el singular solo como *fallback legacy*. Este trigger se quedó en la rama vieja → mismo bug H7 que ya se corrigió en SOS/emergency, regresado en la superficie de alerta de incidente crítico. El email sí sale (lee `users/{uid}.email`), pero la notificación push del incidente crítico hace no-op silencioso para todo dispositivo moderno. Severidad de seguridad operacional: la app de prevención promete avisar al Comité Paritario de un incidente Crítico y la push nunca llega. |
| 3 | 🟡 | `src/server/routes/misc.ts:341` | **5xx filtra `error.message` crudo (viola #8).** `GET /api/legal/check-updates` cierra con `res.status(500).json({ error: error.message })` — sin el guard `NODE_ENV === 'production' ? "Internal server error" : err.message` que SÍ usan los dos handlers hermanos del mismo archivo (`seed-glossary :283-284`, `seed-data :308-309`). Filtra internals (stack-adjacent / detalles de import dinámico de `geminiBackend`) a cualquier usuario autenticado. Sub-nota acoplada: el handler hace `Promise.all(bcnKnowledgeBase.map(scanLegalUpdates))` — **un fan-out Gemini de N llamadas por cada request**, sin rate-limiter (a diferencia de `environment/forecast` y `erp/sync` que comparten `erpSyncLimiter`); un atacante con Bearer puede amplificar costo IA llamando este GET en loop (relacionado con #1, que tampoco lo frena con store real). |
| 4 | 🔵 | `src/server/routes/misc.ts:129-262` | **`POST /api/erp/sync` (state-changing) no escribe a `audit_logs` — solo a su colección propia `erp_sync_logs` (roza #3).** Cada intento de sync persiste en `erp_sync_logs` (`logAttempt`, fail-soft) con uid/action/status/mode, pero **no** llama `auditServerEvent` como sí hacen `seed-glossary`/`seed-data` del mismo archivo. La operación toca un ERP externo (push de nómina/training) — es una acción de cambio de estado cuya traza canónica de compliance debería estar en `audit_logs`. Mitigante: `erp_sync_logs` captura el trail funcional completo (incluyendo modos de falla). Documentado como 🔵 (gap de invariante de audit, no fuga ni stub). |
| 5 | 🔵 | `src/services/iot/mqttAdapter.ts:168-189,206-218` | **Stubs `createCloudIotCoreAdapter`/`createEmqxAdapter` no están en `docs/stubs-inventory.md` (#13 parcial).** Ambos factories lanzan `Error("not yet implemented … until Sprint 33 H1")` y NO están en el boot path (`buildMqttAdapter` los invoca solo si el operador pone `IOT_BROKER_ADAPTER=cloud|emqx`, que requiere además la dep `mqtt` no instalada). Por eso **no** son "stub disfrazado": lanzan en vez de devolver datos mock, y son invisibles al usuario final por gate de env. Pero `#13` exige también `// TODO(sprint-N): <owner>` con el formato y registro en `docs/stubs-inventory.md`; el grep de `mqtt|cloudiot|emqx|createCloud|createEmqx` sobre el inventario no devuelve nada. Riesgo nulo (fail-loud, off-boot); documentado para cerrar la letra de la convención. |
| 6 | 🔵 | `src/services/eventBus/eventBus.ts:208` + `src/services/iot/mqttClient.ts:110` | **`Math.random()` en generación de IDs efímeros, fuera del scope del guard (#15, solo texto).** `eventBus.buildEvent` cae a `evt-${ts}-${Math.random().toString(36).slice(2,8)}` para el id del evento in-process; `PraeventioMqttClient.connect` arma `praeventio-${Math.random()...}` como clientId MQTT por defecto. Ambos viven en `src/services/` — `precommit-stub-guard.cjs` (#15) solo escanea `src/server/`, así que no los atrapa, y son ids no-criptográficos (bus efímero / clientId de conexión, no security tokens). Ya cubierto en general por `DEEP-NH-services-infra.md`; se ancla aquí solo para descartar falso positivo en el slice. |

## Limpios (sin hallazgos)

- **Middleware sólidos:** `idempotencyKey.ts` (Stripe-pattern: hash del key para
  doc-id sin PII, fingerprint sha256 con 422 en reuse, captura solo 2xx,
  `runTransaction` first-writer-wins, write best-effort fire-and-forget,
  fail-soft en read), `safeSecretEqual.ts` (timingSafeEqual con padding a longitud
  esperada + lengthOk folded después → no leak de longitud), `verifySchedulerToken.ts`
  (fail-CLOSED 503 si `SCHEDULER_SHARED_SECRET` no seteado, constant-time, Bearer),
  `verifyTwinStepUp.ts` (JWT HS256 con `SESSION_SECRET≥16`, valida
  projectId+uid+iat-age, jose `exp` + re-check `recentMinutes`, secret-too-short
  → throw), `validate.ts` (Zod, envelope 400 único, `req.validated`, warn con uid),
  `securityHeaders.ts` (CSP nonce per-request 128-bit, `strict-dynamic`,
  connect-src allowlist explícita anti-`*.googleapis.com`-exfil, HSTS solo HTTPS,
  `wasm-unsafe-eval` justificado), `stampCspNonce.ts` (callback en `.replace` para
  neutralizar `$`-tokens), `largeBodyJson.ts` (cap 2mb opt-in).
- **`firestoreRateLimitStore.ts`** — `runTransaction` para increment atómico
  cross-pod, `encodeURIComponent` del key (fix IPv6/`tid/uid` con slash), TTL
  Timestamp para Firestore TTL policy, fail-soft documentado (deja pasar 1 hit en
  error de DB — trade-off availability explícito). El gap real es que `limiters.ts`
  **no lo usa** (hallazgo #1), no este store en sí.
- **Routes B2D (datos públicos, `b2dAuth` por scope, sin Zettelkasten/tenant
  data, `trackB2dUsage`):** `b2d/climate.ts` (3 fuentes externas reales con
  fallback determinístico etiquetado en `provenance`, sin tenantId al upstream),
  `b2d/normativa.ts` (catálogo público + Zod), `b2d/suite.ts` (coach: intenta
  Gemini vía `getAiAdapter()` server-side con prompt hardcodeado — **no** pasa por
  `/api/gemini` así que #5 no aplica; fallback determinístico honesto + `source`
  auditable; `privacyNote` reafirma boundary), `b2d/index.ts` (parser local +
  `b2dFreeLimiter` antes de auth). `b2dAdmin.ts` — admin-gated (`assertAdmin` vía
  customClaims), `audit_logs` + `b2d_events` en cada create/revoke, regex
  validation de customerId/tier/scope, rawKey devuelto una sola vez, 5xx genérico.
- **`apiKeyService.ts`** — fail-CLOSED en prod si `B2D_API_KEY_SALT` ausente
  (`projectSalt :74-85`, evita rainbow-table con salt público), SHA-256
  hash-only (plaintext nunca a Firestore), key con 96 bits de entropía
  (`randomBytes(12)`), `verifyApiKey` resuelve por `keyHash ==` (índice DB,
  lazy-expire), `randomBytes` para id/key (no `Math.random`).
- **`iot.ts`** (verifyAuth + idempotencyKey + Zod + role-gate admin/supervisor +
  tenant resuelto desde `projects/{id}.tenantId` con fallback legacy + audit
  try/catch), **`firestoreBridge.ts`** (tenant desde el TOPIC no desde campos del
  device — comentado explícitamente anti-spoof; writes tenant-scoped;
  `audit_logs` con `userId: 'system:iot.bridge'`; cada paso aislado con Sentry),
  **`ingestRuleEngine.ts`** (puro, thresholds DS-594/OSHA, `validateRules` boot),
  **`edgeFilter.ts`** (regla #1 `blockOperation:false` inviolable; error isolation
  total; `Promise.allSettled` para adapters externos), **`probabilityFailureScoring.ts`**
  (puro, pesos ISO 10816), **`mqttClient.ts`** (adapter real con state machine,
  listeners aislados), **`types.ts`** (iot + eventStore, cert SHA-256 nunca PEM).
- **`privacyShield.ts`** — `verifyAuth` + `validate` + `assertProjectMember` (vía
  `guard()`) en las 3 routes; compute puro sin escrituras; arrays capados
  (`.max(2000/10000)`); 5xx `internal_error` sin leak.
- **`systemEvents.ts`** — stampea `tenantId` desde el claim del token e **ignora**
  cualquier `tenantId` del body; rechaza `event.tenantId !== claimTenantId` con
  403; idempotencyKey; 5xx genérico. **`push.ts`** — token FCM excluido de
  `audit_logs` por diseño (solo `{platform}`), validación token/platform, 5xx con
  details solo en dev. **`openapi.ts`** — público por diseño (spec, no filas), CDN
  pinneado.
- **Triggers:** `backgroundTriggers.ts` (mutex `serializeByKey` FIFO self-cleaning,
  re-read idempotente dentro del mutex para FCM + RAG + post-mortem, no-throw,
  unsubscribe robusto) — salvo el campo FCM singular del hallazgo #2.
  `systemEngineTrigger.ts` (dedup set capado, `onEvent` aislado, `collectionGroup`
  con `isInitialLoad` skip).
- **Services puros / infra sin superficie de seguridad:** `adService.ts`
  (Preferences en nativo, no ad-unit-id fallback de test en prod),
  `batteryAdvisor.ts`, `bundleSizeAnalyzer.ts`, `culturalConventions.ts`,
  `rutValidators.ts` (mod-11 CL correcto + CPF/RFC/CUIT/NIT/SSN/NINO),
  `resilientReader.ts` (retry+timeout+fallback genérico), `createProjectScopedStore.ts`
  (path `projects/{pid}/<col>`, clamp limit 500, merge:true), `inMemoryEventStore.ts`
  (append-only con tenant-consistency + optimistic-seq + idempotency),
  `guardianForegroundService.ts` (state machine determinista),
  `pdfImmutableService.ts` (SHA-256 content-addressing, hash externo no
  auto-referencial — comentado honestamente), `externalClimate.ts` (timeouts 8s,
  cache 1h, sin tenantId al upstream), `usage.ts`, `dataSeedService.ts`
  (idempotente vía count, gerente-gated en la route), `resendService.ts` +
  `templates.ts` (`escapeHtml` consistente sobre todo texto controlado por
  usuario; URLs server-originadas sin escape pero no son input de usuario →
  superficie de inyección baja), `erpAdapter.ts` (stub HONESTO: `mode` explícito,
  `NotImplementedError`, sin fake-success — #13 compliant), `mcp/zettelkastenServer.ts`
  + `zettelkastenStdioAdapter.ts` + `stdioBoot.ts` (aislamiento de tenant estricto:
  cada tool valida `ctx.allowedTenantIds.has(tid)`; read-only; citation policy
  anti-hallucination; `allowedTenantIds` poblado desde el adapter — Codex PR #263),
  `eventBus.ts`/`integrations.ts` (in-process, error-isolated; salvo el
  `Math.random` del #6 ya conocido y el estatus de huérfano ya marcado en
  `DEEP-NH-services-knowledge.md`), `express.d.ts` (augmentación de tipos).

---

**Resumen (6 hallazgos: 0 🔴 / 3 🟡 / 3 🔵):** El lote transversal (middleware +
B2D + IoT + MCP + infra de servicios) está sólido — cripto fail-closed
(`apiKeyService`, `verifySchedulerToken`, `safeSecretEqual`), aislamiento de
tenant estricto (`systemEvents`, `firestoreBridge`, MCP zk), CSP con nonce
real, y stubs HONESTOS (`erpAdapter`). Dos 🟡 son del tipo "control que existe
pero no muerde": (#1) el cap GLOBAL de gasto Gemini y todos los limiters
per-route usan `MemoryStore` por-pod en vez del store Firestore que `server.ts`
sí cablea al limiter global — en Cloud Run multi-réplica el cap agregado es
`N×`, derrotando el control de costos por diseño; y (#2) el trigger de alerta de
incidente crítico al CPHS lee el campo FCM LEGACY `fcmToken` (singular) mientras
`/api/push/register-token` escribe `fcmTokens` (array) — regresión del bug H7 ya
corregido en SOS/emergency, así que la push del incidente crítico hace no-op
silencioso en todo dispositivo moderno (el email sí sale). El tercer 🟡 (#3) es
un 5xx que filtra `error.message` en `GET /api/legal/check-updates` (viola #8,
a diferencia de sus handlers hermanos) acoplado a un fan-out Gemini N× sin
rate-limiter. Los 🔵 son menores: `erp/sync` sin `audit_logs` canónico (tiene
`erp_sync_logs` propio), stubs MQTT cloud/emqx ausentes del inventario (pero
fail-loud y off-boot), y `Math.random` para ids efímeros en `services/` (ya
cubierto por base previa). Sin fugas cross-tenant explotables, sin secretos
hardcodeados, sin colecciones sin regla nuevas.
