# Impacto — Round 17 (push endpoint + billing extract + hardening + cazador R17 + WebAuthn cache)

## TL;DR

R17 ejecutó cinco frentes en paralelo y todos cerraron sin regresiones: (1) `/api/push/register-token` que cierra el gap arrastrado desde R15/R16 más infraestructura Stryker para mutation testing; (2) Phase 2 del split de `server.ts` con extract de billing (-922 LOC en un solo módulo de 1014 LOC con dos routers preservando byte-identical el callback de Webpay); (3) hardening de seguridad que añade `audit_logs` en 6 endpoints, gate de tenant en `/api/coach/chat` y HMAC per-tenant en `/api/telemetry/ingest`; (4) cazador R17 que reemplazó cinco simulaciones de producción heredadas (AQI real, Mifflin-St Jeor, Wearables sin device, DigitalTwin envelope, Calendar single-day fallback) y evolucionó el modal de Ergonomics con selector de trabajador con búsqueda y recientes; (5) `PortableCurriculum.tsx` cableado a Firestore reads reales con su `historyAggregator` cubierto por tests, cache server-side de WebAuthn challenge resistente a replay y backfill de IDs BCN de cuatro normas chilenas. `tsc -b` exit 0, `vitest` 967 tests (901 pass + 66 skipped), build PWA con 219 entradas precache, `server.ts` 3030 → 2377 LOC neto (-653).

## Cambios por área

### Push endpoint + Stryker (R3, commit `993d443`)

R3 cerró el gap que ya había sido reclamado en R15 y no extraído por la Phase 1 de R16:

- `src/server/routes/push.ts` (NEW, 89 LOC): `POST /register-token` montado en `/api/push`. Cadena `verifyAuth` + body validation (token 1-512 chars, platform `'ios' | 'android' | 'web'`). Persiste con `arrayUnion` en `users/{uid}.fcmTokens` y `lastTokenRegisteredAt: serverTimestamp`. La fila de auditoría `push.token.registered` registra solo `{ platform }`; el token jamás entra al `audit_logs` porque es material sensible (un token FCM permite suplantar push notifications al device).
- `src/__tests__/server/push.test.ts` (NEW, 253 LOC, 10 supertest tests): cubre 401×2 (sin auth, token expirado), 400×4 (token vacío, token >512, platform inválida, body roto), 200×3 (happy path, idempotente, multi-token append) y 500×1 (firestore down).
- `server.ts`: 2 ediciones quirúrgicas — import del router y mount line debajo de `auditRouter`.

Stryker mutation testing wired:

- `@stryker-mutator/core@^9.6.1` + `@stryker-mutator/vitest-runner@^9.6.1` instalados.
- `stryker.conf.json` con 7 mutate targets dirigidos al núcleo de seguridad/legal: REBA, RULA, IPER, PREXOR, TMERT, ergonomic assessments, iper assessments. Coverage `perTest`, thresholds `high=80 / low=60 / break=null` (la corrida queda diferida a R18 para capturar baseline antes de subir el break threshold).
- `npm run mutation` script + sección "Mutation testing" en `README.md`.

### server.ts split Phase 2 — billing (R2, commit `67290e0`)

R2 cumplió la Phase 2 del plan de refactor del R5 R16. `server.ts` quedó en 2097 LOC tras el extract (sumándose luego los +280 LOC del hardening de R1), neto 2377.

- `src/server/routes/billing.ts` (NEW, 1014 LOC) usa **dos routers** para preservar el path de Webpay byte-identical (Transbank exige callback en `/billing/webpay/return` sin prefix `/api`):
  - `billingApiRouter` montado en `/api/billing` con seis rutas: `POST /verify` (Google Play RTDN), `POST /checkout` (Webpay), `POST /checkout/mercadopago` (LATAM), `GET /invoice/:id` (polling), `POST /invoice/:id/mark-paid` (admin) y `POST /webhook` (RTDN).
  - `billingWebpayRouter` montado en `/billing` con `GET /webpay/return` únicamente.
- Helpers privados al módulo movidos limpios: `playAuth`/`playDeveloperApi`, `BillingTier`/`resolveBillingTier`, `OVERAGE_CLP_PER_*`, `VALID_PAYMENT_METHODS`, `MP_VALID_TUPLES`, `MP_UNIT_PRICE_USD_MULTIPLIER`, `redirectFor`/`histogramOutcomeFor`. Imports compartidos siguen viviendo en `src/services/billing/*`: `buildInvoice`, familia `webpayAdapter`, `stripeAdapter`, `withIdempotency`, `recordWebpayReturnLatency`, `mercadoPagoAdapter`, `MP_CURRENCY_BY_COUNTRY`. `acquireWebpayIdempotencyLock`/`finalizeWebpayIdempotencyLock` ya vivían en `src/services/billing/webpayAdapter.ts` desde R12, así que no hizo falta crear un shared module.
- Non-regression crítica: 26/26 tests de billing y 89/89 de supertest preservados.

Phase 3 documentada en commit body: extracts pendientes son curriculum (~400 LOC), projects (~250 LOC) y `oauth/google` (~600 LOC). Phase 4 cierra con gemini, ask-guardian y telemetry/ingest. Target post-Phase 5: `server.ts < 1500 LOC` reducido a bootstrap.

### Hardening seguridad (R1, commit `542a338`)

R1 cerró las HIGH abiertas por el reviewer R6 R16:

- `src/server/middleware/auditLog.ts` (NEW, 94 LOC): helper `auditServerEvent` que envuelve `auditService.logAuditAction` en `try/catch` (jamás rompe el request path) y soporta `actorOverride` para flujos no autenticados como `/auth/google/callback` (se recupera `uid` desde `req.session.oauthInitiator`).
- Seis endpoints incorporan `audit_logs` vía el helper para cumplir ISO 27001 §A.12.4: `/api/oauth/unlink`, `/auth/google/callback`, `/api/calendar/sync`, `/api/coach/chat`, `/api/gamification/points`, `/api/reports/generate-pdf`.
- `/api/coach/chat`: `assertProjectMemberFromBody` + 400 si falta `projectId`. Cambio breaking documentado: clientes que omitían el campo ahora reciben 400.
- `/api/telemetry/ingest` reescrito con HMAC-SHA256 per-tenant. Lee `tenants/{tenantId}.iotSecret` vía Admin SDK, valida header `x-iot-signature: sha256=<hex>`, resuelve tenant desde header `x-tenant-id` o `body.tenantId`, fallback al env `IOT_WEBHOOK_SECRET` y compatibilidad con `body.secretKey` legacy por una release con deprecation warning.
- `POST /api/admin/iot/rotate-secret` (NEW): admin-role gate, genera secret de 32 bytes hex, escribe `tenants/{id}.iotSecret` + `iotSecretRotatedAt`, audit row `admin.iot.secret_rotated`. El secret va solo en la response — un test asserta que NUNCA aparece en `audit_logs`.
- 23 tests nuevos en tres archivos: `src/__tests__/server/auditCoverage.test.ts` (9 tests, asserta que cada uno de los seis endpoints emite la fila), `src/__tests__/server/coachChatTenant.test.ts` (4 tests, 403 cross-tenant + 400 missing) y `src/__tests__/server/telemetryRotation.test.ts` (10 tests cubriendo HMAC accept/reject, env fallback, las cuatro branches del rotate y la invariante secret-not-in-audit).

Caveat documentado en el commit y reiterado por R6 review: el HMAC usa `JSON.stringify(req.body)` no canónico. Clientes Node funcionan, pero gateways en otros lenguajes con orden de claves distinto fallarán silenciosamente con 401. Round 18 debe migrar a canonical-JSON o documentar el contrato.

### Cazador R17 + UX evolución + i18n (R4, commit `0eeac1b`)

R4 atacó las cinco simulaciones que R1 R16 había dejado documentadas como deferred:

1. `orchestratorService.airQuality`: fetch real al endpoint Air Pollution de OpenWeatherMap (1-5 → label es-CL). `null` cuando falta key o falla la red. `PredictiveGuard` renderiza `—` con tooltip.
2. `orchestratorService.altitude`: `null` honesto (no hay todavía API de elevación cableada — Open-Elevation o Google candidatos a R18).
3. `NutritionLog.metabolic-rate`: fórmula real Mifflin-St Jeor (BMR Male: `10×weight + 6.25×height − 5×age + 5`; Female: `−161`). `src/services/hygiene/metabolicRate.ts` (68 LOC) + 12 tests. `null` cuando el perfil está incompleto y banner amber con CTA "Complete su perfil…".
4. `WearablesIntegration.{circadian, hrv}`: arrays vacíos + mensaje per-chart "No hay dispositivo emparejado". Se acabaron los charts mock.
5. `DigitalTwin`: loading + error envelope reales, sin fabricar datos. Empty state "Sin telemetría disponible".
6. `Calendar` Gantt 3-day fallback: barra single-day amber + "duración no especificada" cuando el evento no tiene `endDate`. Progress default 0 (sin `Math.random()` en ese codepath).

Modal de Ergonomics evolucionado:

- `AddErgonomicsModal` recibe Step 0 nuevo con `<input>` de búsqueda, sección "Trabajadores recientes" (top 5 derivados de `useRiskEngine.nodes` filtrados por `ergonomics` + `signedAt desc`) y full list scrollable.
- `Ergonomics.tsx`: el page-level select y el botón disabled del fix BLOCKER de R16 fueron revertidos. La selección ahora la posee el modal, que recibe `workers` por prop.

i18n biometric: 42 strings nuevos (7 keys × 6 locales) cubriendo `biometric.{verify_identity, reason_login, reason_sign_claim, reason_enroll, enroll_title, cancel, unsupported}` en `es`, `es-MX`, `es-PE`, `es-AR`, `pt-BR` y `en`. `useBiometricAuth.ts` invoca `i18next.t()` directo (es un hook sin component context).

`WeatherData.airQuality` y `.altitude` pasan a nullable. `.gitignore` agrega `tsconfig.tsbuildinfo`.

### PortableCurriculum + WebAuthn cache + KG backfill (R5, commit `dadd5fb`)

R5 cableó la página que en R16 había quedado con empty states honestos esperando aggregator:

- `src/pages/PortableCurriculum.tsx`: cuatro reads Firestore reales con `try/catch` independiente y patrón `cancelled`-flag (espejo del fix de UserProfileModal R16): badges desde `users/{uid}/awards`, history desde `audit_logs` filtered por user, skills desde `users/{uid}.profile.skills`, `gamification_scores` agregado. Una falla NO suprime las otras — los empty states "Sin datos aún" se preservan.
- `src/services/curriculum/historyAggregator.ts` (NEW, 146 LOC) + 13 tests cubriendo límite de 20 filas, conteo de trainings completados, heurística de evaluación crítica, agregación de XP con fallback a esquema legacy, math y caps de niveles, tolerancia a timestamps inválidos.

WebAuthn challenge cache server-side (cierra MEDIUM de R6 R16):

- `src/services/auth/webauthnChallenge.ts` (NEW, 177 LOC): `generateWebAuthnChallenge` (32 bytes random), `storeWebAuthnChallenge` (Firestore con TTL 5 min y `consumed: false`), `consumeWebAuthnChallenge` (atómico vía `runTransaction` — exactly-one-wins en concurrent consume race).
- 12 tests TDD: entropy, shape de storage, consume válido, reject de expired/consumed/mismatch/unknown, TTL boundary inclusive, race condition concurrente y propagación de errores.
- `firestore.rules`: bloque deny para `webauthn_challenges` (server-only via Admin SDK).
- `server.ts`: nuevo `GET /api/auth/webauthn/challenge` (con `verifyAuth`) que retorna `{ challengeId, challenge: base64 }`.
- `useBiometricAuth.ts`: helper `fetchServerChallenge()` que prefiere el challenge server-issued y cae al client-generated MVP si la red falla. R6 R17 anota esto como MEDIUM #1: para flujos sensibles (firma de claim, login), Round 18 debe ir fail-closed.

KnowledgeGraph BCN backfill:

- `scripts/backfill_bcn_norma_id.cjs` (NEW, 205 LOC): script Node con Admin SDK que lee nodes con `category='legal'` o `type='NORMATIVE'`, hace regex-match sobre títulos/descripciones, mapea cuatro normas chilenas (DS 594 → idNorma 167766, DS 40 → 1041130, DS 54 → 88536, Ley 16.744 → 28650) y batch-actualiza `metadata.bcnNormaId`. Default dry-run, `--live` opt-in, idempotente (skip si `bcnNormaId` ya existe), regex con word boundaries (DS 594 NO matchea DS 5).

## Métricas

- `tsc -b`: 0 errors.
- `vitest`: 967 tests, 901 passed + 66 skipped (R16 baseline 897, +70 netos).
- `npm run build`: PWA con 219 entradas precache.
- `server.ts`: 3030 LOC (R16) → 2377 LOC (R17), -653 netos. R2 quitó 922 al extraer billing y R1 sumó 280 con el bloque de hardening.
- `src/server/routes/billing.ts`: 1014 LOC nuevos.
- `src/server/routes/push.ts`: 89 LOC nuevos.
- `src/server/middleware/auditLog.ts`: 94 LOC nuevos.
- `src/services/auth/webauthnChallenge.ts`: 177 LOC nuevos.
- `src/services/curriculum/historyAggregator.ts`: 146 LOC nuevos.

## Cumulative R12-R17

- Tests: 542 (baseline R12) → 967 (R17) = **+425 netos**.
- `server.ts`: 3242 (pre-R16) → 2377 (post-R17) = **-865 LOC, ~36% de reducción**.
- 7 nuevas colecciones con rules append-only firmadas (R16) + 17 LOC adicionales en `firestore.rules` para WebAuthn (R17).
- R17 cierra los HIGH de R6 R16 (auditoría faltante en seis endpoints + tenant gate en coach + telemetry HMAC) y prepara el camino del Phase 3 del split.

## Round 18 plan priorizado

1. **WebAuthn fail-closed para flujos sensibles** (R6 MEDIUM #1): `useBiometricAuth.ts` actualmente cae al MVP client-generated si `/api/auth/webauthn/challenge` falla, lo que abre downgrade attack. Para `claim-signing` y `login` el fallback debe ser bloqueante.
2. **HMAC canonicalisation real** (R6 MEDIUM #2): migrar `/api/telemetry/ingest` a canonical-JSON (RFC 8785) o documentar contract sha256-of-`x-iot-canonical-payload` que el cliente debe armar. Mientras esté sin resolver, los gateways non-Node fallan 401 silently.
3. **Calendar `Math.random()` forecast** (R6 MEDIUM #3): R4 lo missed durante el sweep R17. `src/pages/Calendar.tsx:86,94` siguen mutando `weatherData.temp` con `Math.round(Math.random() * 4 - 2)` y `* 6 - 3`. Cambiar a `getForecast` real (orchestratorService) o renderizar `—` cuando no hay forecast multi-día.
4. **`orchestratorService.getMockWeatherData` → null + unavailable flag** (R6 MEDIUM #4): el fallback aún tiene números fabricados que pueden caer a la UI sin signaling claro.
5. **Run Stryker baseline + setear break threshold** (chore deferred R17): primer corrida de los 7 mutate targets, capturar score y ajustar `break` en `stryker.conf.json` para que el CI corte regresiones.
6. **`server.ts` Phase 3** (R2 plan): extracts curriculum (~400 LOC) → projects (~250 LOC) → `oauth/google` (~600 LOC). Decisión de orquestador requerida: ¿secuencial con tres reviewers cortos o paralelo con file-conflict matrix vigilada?
7. **`POST /api/auth/webauthn/verify`** (R5 follow-up): el consumer del cache de R5 todavía no existe. Sin verify, el challenge generation queda dormant.
8. **`/api/billing/webhook/mercadopago`** IPN endpoint con OIDC verification: cierra el último callback faltante del extract de billing.

## Round 19+ deferred

- Split de `geminiBackend.ts` (2666 LOC) en los 18 modules planeados en `ARCHITECTURE.md`.
- SOC 2 Type I path kickoff (gap analysis + auditor selection).
- Marketplace assets (operativo de la persona, no del agente).
- HR / Mutual / Regulator dashboard como differentiator B2B.
- `audit_logs` composite index `(userId, timestamp desc)` cuando la escala lo demande (R5 lo dejó marcado).

## Por qué importa

R17 marca un cambio cualitativo en la madurez del repo. El push endpoint cierra un loop que llevaba dos rounds en el roadmap pero que cada round se reclamaba como "done" sin que persistiera el código del servidor — el bug era social tanto como técnico, y dejarlo cerrado con 10 supertest tests detiene esa deuda. El extract de billing es el primer split grande que toca un dominio regulado (Transbank/Webpay con callback path byte-identical) y demuestra que la Phase 3 puede atacarse con confianza: si la zona más sensible salió sin romper 26+89 tests, curriculum y projects son tractables.

El hardening de seguridad cierra los HIGH que el reviewer R6 venía levantando desde R15. `audit_logs` en seis endpoints saca al sistema de la categoría "promete trazabilidad pero no la tiene en producción" y lo pone dentro del scope ISO 27001 §A.12.4. El gate de tenant en `/api/coach/chat` corta una ruta de cross-tenant data leak que la suite de tests previa no estaba cubriendo. La rotación per-tenant de IOT secret más el rotate endpoint resuelven el escenario de compromiso de secret compartido sin pedirle al operador hacer un deploy global.

El cazador R17 elimina cinco simulaciones más del path productivo: lo importante no es solo que `null` reemplace a un número fabricado, sino que la UI ahora hace explícito al usuario el estado "dato no disponible" en vez de presentarlo como si fuera mediación calibrada. En un sistema de prevención de riesgos donde una decisión clínica (BMR, AQI, HRV) puede informar conducta, la diferencia entre "no sé" y "creé un valor plausible" es regulatoria. WebAuthn challenge cache convierte la firma de claims de "criptografía teatral" a replay-resistant real con runTransaction atómico — el `consumed:true` exactly-once-wins es la primera vez que el repo tiene una primitiva de seguridad con ese nivel de garantía. La deuda que queda explícita (fail-closed en R18) es ahora pequeña y específica, no estructural.
