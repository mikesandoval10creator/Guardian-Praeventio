# Impacto — Round 18 (Phase 3 split + WebAuthn verify + HMAC canonical + page refactors + Stryker baseline)

## TL;DR

R18 desplegó doce implementadores en paralelo y once aterrizaron limpio. Los seis commits sobre `67cf513` cierran la Phase 3 del split de `server.ts` (-1111 LOC con tres módulos: curriculum, projects, oauth/google), el cluster de seguridad (WebAuthn fail-closed + HMAC RFC 8785 canonical-JSON + IPN MercadoPago con idempotencia), el refactor de páginas pesadas (Dashboard 911→302 LOC y Telemetry 1010→534 LOC con doce sub-componentes y dos helpers), el cazador R18 que eliminó dos simulaciones residuales (`Math.random` en Calendar y los ocho valores fabricados de `getMockWeatherData`), el cableado de `stats.safeHours` a tres llamadores con `historyAggregator` integrado en `UserProfileModal` y el baseline de Stryker en 67.32% global con break threshold suave en 50%. `tsc -b` exit 0, `vitest` 1069 tests (1003 passed + 66 skipped, +102 sobre R17), build PWA con 220 entradas precache, `server.ts` 2377 → 1290 LOC neto. Único incidente: A8 (limpieza de `criticidad` en Gemini) reportó éxito pero git no registró cambios — re-encolado en R19 H1.

## Cambios por área

### server.ts Phase 3 split (A1, commit `a0e93da`)

A1 ejecutó el plan documentado al final de la Phase 2 R17 y extrajo tres módulos quirúrgicamente sobre el cuerpo de `server.ts`:

- `src/server/routes/curriculum.ts` (NEW, 619 LOC): `curriculumRouter` (rutas `/api/curriculum/*` para CRUD/reset/contact-link/email-claim), `webauthnChallengeRouter` montado en `/api/auth` con generador atómico de challenge consumible, helpers privados `enforceClaimRateLimit`, `buildClaimEmailHtml`, `buildWebAuthnDb` y la constante `curriculumResendCooldown`. Esta extracción concentra los flujos de portabilidad CV + biometría challenge en un solo módulo navegable.
- `src/server/routes/projects.ts` (NEW, 440 LOC): `projectsRouter` con cinco rutas (`POST /` create, `GET /` list, `GET /:id`, `PATCH /:id`, `DELETE /:id`) y `invitationsRouter` exportado para mount independiente. `buildInviteEmailHtml` movido inline. Los chequeos `createdBy === uid OR role in {gerente,admin}` se preservaron byte-identical para no quebrar comportamiento.
- `src/server/routes/oauthGoogle.ts` (NEW, 479 LOC): ocho+ rutas — `oauth/unlink`, `auth/google/url`, el callback root `/auth/google/callback` montado fuera de `/api`, `drive/auth/*`, `calendar/sync`, `calendar/list`, `fitness/sync`. `GOOGLE_CLIENT_ID/SECRET/SCOPES` viajan con el módulo.

Mounts en `server.ts`: `app.use('/api', oauthGoogleApiRouter)`, `app.use('/auth', oauthGoogleAuthRouter)`, `app.use('/api/projects', projectsRouter)`, `app.use('/api/invitations', invitationsRouter)`, `app.use('/api/curriculum', curriculumRouter)`, `app.use('/api/auth', webauthnChallengeRouter)`. Non-regression: 118+ supertest tests (12 archivos) preservados sin cambio.

`server.ts` queda en 1290 LOC. Phase 4 documentada en el commit body: gemini, ask-guardian, reports, telemetry, gamification, coach, legal, erp, seed, environment (10 módulos pendientes). Target post-Phase 5: `server.ts ~600 LOC` bootstrap-only.

### Cluster seguridad — WebAuthn + HMAC canonical + IPN MP (A2 + A3 + A7, commit `0222612`)

A2 cerró el R6 R17 MEDIUM #1 (WebAuthn fail-closed verify):

- `POST /api/auth/webauthn/verify` agregado en `webauthnChallengeRouter` (curriculum.ts +87 LOC). Consume el challenge atómico vía Firestore transaction (replay-resistant). La verificación CBOR + signatura quedó deferida a R19 con `@simplewebauthn/server`; el endpoint actual es consume-only MVP.
- Tipo `BiometricPurpose = 'login' | 'claim-signing' | 'enroll-test'`. Default `'login'` es fail-closed.
- `useBiometricAuth.ts` refactor: para `login` y `claim-signing`, si `fetchServerChallenge()` falla → retorna `{ available: false, reason: 'server_unreachable' }` inmediatamente, sin fallback a challenge generado en cliente. Esto cierra el downgrade vector que el reviewer R6 detectó en R17.
- 15 tests nuevos (5 webauthnChallenge + 10 webauthnVerify supertest).

A3 cerró el R6 R17 MEDIUM #2 (HMAC canonical-JSON):

- `src/server/middleware/canonicalBody.ts` (NEW): serializador RFC 8785 — claves de objeto ordenadas lexicográficamente, escape JSON estándar de strings, números en forma corta, `undefined` descartado, `NaN`/`Infinity` rechazados. 17 unit tests + 6 IPN sig tests + 8 supertest telemetry = 31 tests nuevos.
- `/api/telemetry/ingest` ahora hace `rawBody = canonicalize(req.body)` antes de calcular HMAC. `mercadoPagoIpn.ts` expone `verifyMercadoPagoIpnSignatureFromBody` para reutilizar el mismo canonicalizador.
- Flag de rollback `LEGACY_HMAC_FALLBACK`: si está activo y la firma canónica falla, reintenta con `JSON.stringify` legacy emitiendo warn-log. Default OFF, documentado en `.env.example`. Es la salida de emergencia para gateways IoT que aún serializan en orden de inserción.
- Breaking change documentado en headers de cada call site. Tests existentes de `telemetryRotation` migrados al nuevo canonicalizer.

A7 cerró la última brecha de billing Phase 2 (IPN MercadoPago):

- `POST /api/billing/webhook/mercadopago` (+47 LOC en `billing.ts`).
- `src/services/billing/mercadoPagoIpn.ts` (NEW): `verifyMercadoPagoIpnSignature` + `processMercadoPagoIpn` con idempotencia vía colección `processed_mp_ipn`.
- 16 tests nuevos (4 sig + 6 process unit + 6 supertest).
- Audit row `billing.mercadopago.ipn.processed` con `paymentId/outcome/invoiceId/mpStatus` — sin PII.

Total cluster: 62 tests nuevos, todos verdes.

### Refactor de páginas pesadas — Dashboard + Telemetry (A11 + A12, commit `f887f07`)

A11 partió `Dashboard.tsx` 911 → 302 LOC con seis sub-componentes extraídos a `src/components/dashboard/`. La lógica de `challengeUtils` quedó cubierta por 17 tests dedicados. El componente raíz queda como contenedor de layout + data fetching, delegando UI a piezas auditables individualmente.

A12 partió `Telemetry.tsx` 1010 → 534 LOC con seis sub-componentes y dos helpers. Trece tests nuevos cubren el flujo de comando webhook (`src/components/telemetry/webhookCommand.ts` +19 LOC). Esto habilita testing RTL granular en R19+ sobre la matriz de configuración telemetry.

Doce sub-componentes total + cuatro helpers nuevos. La refactorización descompone grandes blobs JSX en piezas con tipo de prop explícito, lo que hace mantenible la cobertura visual y reduce tiempo de re-render por aislar memos por hijo.

### Cazador R18 — Calendar + orchestratorService (A4 + A5, commit `5272bea`)

A4 eliminó `Math.random()` de `Calendar.tsx` (líneas 86 y 94 en revisión previa):

- `src/pages/Calendar.tsx` +169/-36 LOC. Dos `useEffect` independientes con failure modes separados — uno para clima actual, otro para forecast multi-día.
- `/api/environment/forecast?days=3` con siete códigos de condición Spanish-CL.
- `windKmh > 40` ahora viene del feed real (no más `weatherData.windSpeed` fabricado).
- Empty honesto: "Pronóstico no disponible" / "—°C" cuando falta API key.

A5 forzó honestidad en `orchestratorService.getMockWeatherData`:

- Ocho valores fabricados eliminados (24°C, `'Soleado'`, humidity 45, uv 8, `'Moderada'`, altitude 1200, `'Faena Minera'`, windSpeed 55) → `null` + flag `unavailable: true`.
- Tipo `WeatherData` extendido con `unavailable?: boolean`.
- Seis tests nuevos verificando: NUNCA retorna los números/strings legacy, recommendations array vacío, fetch throw mismo payload.
- `PredictiveGuard.tsx` actualizado en tres call sites: banner ámbar con icono `WifiOff`, `role="status"` + `aria-live="polite"`, guard del widget Haki, fallback "Sin datos climáticos" en el prompt AI.

Esto cierra la doctrina cazador R16: empty states honestos, nunca fabricar datos para satisfacer un type. Bajo Ley 16.744 + DS 594 los datos inventados son vector de responsabilidad civil.

### Stats safeHours + UserProfileModal aggregator (A9 + A10, commit `85a7076`)

A9 cableó `stats.safeHours` siguiendo el follow-up R5 R17:

- `auditService.ts`: payload type extendido con `details.durationMin?: number`.
- `historyAggregator.ts` +27 LOC: `stats.safeHours = sum(safety.* durationMin where finite && positive) / 60`. Skip defensivo de `NaN`/negativos/cero/no-numérico. Agrega sobre el set filtrado completo, no solo el slice de UI.
- Tres llamadores agregan `durationMin` vía timestamps: `AddErgonomicsModal.tsx` (`openedAtMs` `useEffect` → `durationMin` en `safety.{reba,rula}.completed`), `IPERCAnalysis.tsx` (`openedAtMs` `useState` mount → `durationMin` en `safety.iper.matrix.classified`) y `WebXR.tsx` (`scanStartedAtMs` desde "Iniciar AR" → `durationMin` en `training.webxr.completed`, conservado por consistencia de schema).
- `ergonomicAssessments.ts` + `iperAssessments.ts` solo forwardean `durationMin` cuando es finito y > 0. Llamadores legacy + tests sin cambio.
- 4 tests nuevos en `historyAggregator.test.ts` (suma correcta, excluye no-safety, skip valores inválidos, agrega con ≥21 eventos). 17 tests totales en el archivo.

A10 amplió el alcance de `historyAggregator` a `UserProfileModal`:

- `UserProfileModal.tsx` +103 LOC, refactored para usar `aggregateUserHistory`.
- Tres `try/catch` independientes (ergonomic + audit_logs + gamification) — falla en una fuente NO suprime las otras.
- Panel "Últimas actividades" muestra top 5 eventos con helpers `describeAction` y `formatEventDate`.
- Per-worker uid: `where('userId', '==', worker.id)`. Supervisores ven al worker correcto, no al current user.

### Stryker baseline (A6, commit `b14d38b`)

A6 ejecutó la primera corrida real de mutation testing, diferida en R17 al instalar la infraestructura:

- `npm run mutation` completó en 5min01s (1230 mutants, 0 errors, 0 timeouts).
- Per-file scores: `protocols/iper.ts` 89.58%, `protocols/tmert.ts` 85.29%, `protocols/prexor.ts` 81.71%, `ergonomics/reba.ts` 75.07%, `ergonomics/rula.ts` 59.63%, `safety/iperAssessments.ts` 56.08%, `safety/ergonomicAssessments.ts` 54.61%. Global 67.32%.
- `stryker.conf.json`: `break threshold null → 50` (lowest -5%, soft start). Justificación inline en field `_thresholds_comment`. Ratchet planeado a 60-65% en R19 tras tests adicionales en `ergonomicAssessments.ts`.
- `STRYKER_BASELINE.md` (NEW, 248 LOC): análisis per-file, top 5 mutantes sobrevivientes por archivo y plan R19 (validation tests para `*Assessments` throw guards [+10-15pp esperados], rula boundary tests, snapshot de TABLE_A/B/C, cleanup `StringLiteral`).
- `README.md`: sección Mutation testing linkeada.

A13 H2 fix: `.gitignore` agregó `reports/` (output HTML de Stryker 788K que estaba untracked — un `git add -A` accidental lo habría committeado).

## A8 — incidente revert pattern

A8 (limpieza de `criticidad` en Gemini, R6 R18 carry-over) reportó éxito al orquestador pero `git status` mostró cero cambios sobre los archivos esperados. La limpieza nunca aterrizó. El reviewer A13 lo elevó a HIGH H1 y lo re-encoló para R19. Es el incidente más caro del patrón hasta la fecha porque el agente declaró completion sin verificación on-disk; el orquestador asumió la palabra del agente y la sub-tarea pasó al pipeline como hecha.

Lección operacional: a partir de R19 todos los implementadores deben correr `git diff --stat` o un `grep` por la cadena cambiada antes de reportar "complete". Verificación explícita de que el cambio existe en disco, no solo que la herramienta `Edit` retornó éxito.

## Métricas

- `tsc -b` exit 0.
- `vitest`: 1069 tests (1003 passed + 66 skipped). +102 sobre R17 (967).
- Build PWA: 220 entradas precache.
- `server.ts`: 2377 → 1290 LOC (-1087 neto, ~46% reducción R18).
- 12 sub-componentes extraídos (Dashboard 6 + Telemetry 6) + 4 helpers.
- Stryker baseline 67.32% global, break 50% soft start.
- 11 de 12 implementadores aterrizaron limpio; A8 perdido al revert pattern.

## Cumulativo R12-R18

- Tests: 542 (R12) → 1069 (R18) = +527 tests netos.
- `server.ts`: 3242 (pre-R16) → 1290 (post-R18) = -1952 LOC, ~60% reducción.
- 8 módulos de ruta extraídos: `admin`, `health`, `audit`, `push`, `billing`, `curriculum`, `projects`, `oauthGoogle`.
- 5 docs foundation: `CONTRIBUTING`, `ARCHITECTURE`, `RUNBOOK`, `api-routes`, `STRYKER_BASELINE`.

## Round 19 plan priorizado

1. **Re-do A8** (R6 R18 H1): limpieza de `criticidad` en `suggestRisksWithAI` + `analyzeFeedPostForRiskNetwork` + `Matrix.tsx` P×S + `SafetyFeed.tsx` default `'Baja'`. Corre primero con `git diff --stat` obligatorio antes de reportar.
2. Integración full `@simplewebauthn/server` (CBOR + signature verify) — cierra M1 del review R18.
3. `server.ts` Phase 4 extracts: gemini, ask-guardian, reports, telemetry, gamification, coach, legal, erp, seed, environment (10 módulos por plan A1). Target final ~600 LOC bootstrap.
4. Stryker break threshold ratchet a 60-65% tras +10pp tests en `ergonomicAssessments.ts`.
5. Per-uid rate limiter en `/api/auth/webauthn/verify` (mitigación M1).
6. `enrichNodeWithAI` (`geminiBackend.ts:725`) audit de `criticidad` — helper distinto fuera de la doctrina R16 R1 (M2).
7. UserProfileModal Insignias real count vía `aggregated.events.filter(...).length` (M3).
8. `/api/billing/webhook/mercadopago` con verificación OIDC real (canonical-JSON ya en place).

## Round 20+ deferred

- Split de `geminiBackend.ts` (2666 LOC, 18 módulos según plan en `ARCHITECTURE.md`).
- SOC 2 Type I path kickoff.
- Marketplace assets (operativo voz).
- Dashboard diferenciador HR/Mutual/Regulator.

## Por qué importa

La Phase 3 split deja `server.ts` a distancia de strike de los <600 LOC bootstrap-only. Cada módulo extraído es una superficie de testing aislada con sus propios supertest files; eso permite a R19 paralelizar Phase 4 sobre diez módulos restantes con red de seguridad (118+ supertest tests preservados).

El cluster de seguridad cierra tres familias ISO 27001 simultáneamente: `A.9.4` (acceso autenticado vía WebAuthn fail-closed sin downgrade a challenge cliente), `A.13.2.1` (transferencias seguras vía HMAC RFC 8785 sin divergencia entre serializadores) y `A.10.1` (controles criptográficos vía idempotencia IPN MP). El flag `LEGACY_HMAC_FALLBACK` permite rollback emergente sin perder telemetría IoT.

El refactor de Dashboard y Telemetry habilita coverage RTL granular en R19+: doce sub-componentes con props tipados son doce superficies de test independientes, donde antes había dos blobs JSX entrelazados. La doctrina cazador R18 (Calendar real forecast + orchestratorService honest empty + safeHours real-data) sostiene la línea ética del producto — bajo DS 54/40 y Ley 16.744, fabricar datos para satisfacer un type es vector de responsabilidad civil. El baseline Stryker captura por primera vez la calidad de tests sobre safety-of-life: 67.32% global con break en 50% es un punto de partida defensible que ratchet hacia arriba cada round.

## Lección revert pattern

La pérdida total de A8 este round es el incidente más caro del patrón hasta la fecha. Recomendación operacional para R19+: los implementadores DEBEN correr `git diff --stat` y un `grep` por sus cambios clave antes de reportar "complete". El orquestador no tiene cómo detectar el modo silencioso del revert pattern sin esa señal. Regla simple: ningún reporte de completitud sin output de `git diff` adjunto.
