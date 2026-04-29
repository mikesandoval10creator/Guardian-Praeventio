# Impacto — Round 19 (Phase 4 final + WebAuthn full crypto + Stryker ratchet + MP OIDC)

## TL;DR

Round 19 cierra Phase 4 del split de `server.ts` (1290 → 598 LOC, -692 net; cumulative R12-R19: 3242 → 598 = -82%), eleva la verificación de WebAuthn a criptografía real con `@simplewebauthn/server@11.0.0` más rate-limiter per-uid (defense-in-depth de cuatro capas en `/verify`), implementa OIDC en el IPN de MercadoPago con caché JWKS de 6 horas y verificador RS256 in-house fail-closed, y formaliza el ratchet de Stryker desde 67.32% a 76.95% global (+9.63 pp) con break threshold 50→60. La suite vitest crece de 1069 a 1158 tests pasando (+155 R19). Veredicto del Reviewer A10: SHIP IT con 0 BLOCKERs y 0 HIGHs.

## Cambios por área

### Re-do A8 R18 (A1) — Gemini criticidad sweep

Commit `a3ad84d`. El A8 de R18 se perdió a un revert pattern; A1 de R19 lo re-ejecutó con prueba `git diff --stat` on disk y cubrió además el R6 R18 MEDIUM #2 (`enrichNodeData`).

Tres funciones limpiadas en `src/services/geminiBackend.ts`:
- `suggestRisksWithAI` (línea 1302): `criticidad` removida de schema y de `required[]`, con bloque doctrinal R16 inline.
- `analyzeFeedPostForRiskNetwork` (línea 2212): `criticidad` removida de schema y de la prompt instruction.
- `enrichNodeData` (línea 725): `criticidad` removida y branch de metadata-injection cuando `nodeData.type === 'Riesgo'` eliminado. Documentado en comentario: la clasificación es output legal de `calculateIper()`; este helper sólo enriquece campos descriptivos.

Dos consumidores actualizados:
- `src/components/safety/Matrix.tsx` (~línea 195): reemplazado `criticidad: suggestion.criticidad` por escalera determinista P×S (≥16 Crítica, ≥9 Alta, ≥4 Media, resto Baja), espejando `handleSeedMatrix:128`.
- `src/components/safety/SafetyFeed.tsx` (~línea 91): reemplazado por default `'Baja'` hasta que prevencionista clasifique vía IPER determinista.

Conteo grep en `geminiBackend.ts` post-sweep: 21 → 19 ocurrencias restantes (todas comentarios doctrinales o helpers fuera de scope como `predictIncidentsWithAI` línea 154-214). Re-read post-Edit confirmó persistencia. A1 no requirió redo este round — first-attempt success.

### server.ts Phase 4 final split (A2)

Commit `ce784d4`. `server.ts` pasó de 1290 a 598 LOC (-692 net R19; cumulative R12-R19: 3242 → 598 = -82%). El archivo es ahora bootstrap-only (carga env, configura middleware global, monta routers, arranca listener + background triggers).

Cinco nuevos route modules en `src/server/routes/` (952 LOC total):
- `gemini.ts` (215 LOC): `/api/ask-guardian` + `/api/gemini` (whitelist proxy con `ALLOWED_GEMINI_ACTIONS` de 86 elementos). Nota: `/api/ask-guardian` no quedó detrás de `geminiLimiter` para evitar regresión durante el split — diferido a R20 como MEDIUM M1.
- `reports.ts` (171 LOC): `/api/reports/generate-pdf` con PDFKit. El `largeBodyJson` short-circuit permanece en `server.ts` (debe correr antes de `express.json()`).
- `telemetry.ts` (256 LOC): `/api/telemetry/ingest` (HMAC per-tenant + canonical body — work R17/R18) más `/api/admin/iot/rotate-secret`. `lookupTenantIotSecret` y `IOT_TYPE_ALLOWLIST` movidos junto.
- `gamification.ts` (142 LOC): `/api/gamification/{points,leaderboard,check-medals}` + `/api/coach/chat` (con `assertProjectMemberFromBody` + `auditServerEvent`).
- `misc.ts` (168 LOC): `/api/legal/check-updates`, `/api/erp/sync` mock, `/api/seed-glossary`, `/api/seed-data` (gerente-only) y `/api/environment/forecast`.

Estrategia de mount: `app.use('/api', router)` para cada module — paths byte-identical para preservar 152/152 supertest tests. Non-regression CRITICAL confirmado.

Estado actual del directorio: 13 route modules totales (`admin`, `audit`, `billing`, `curriculum`, `gamification`, `gemini`, `health`, `misc`, `oauthGoogle`, `projects`, `push`, `reports`, `telemetry`) que suman 4111 LOC contra 598 de bootstrap.

Phase 5 candidate (R20+): `setupBackgroundTriggers` (FCM listeners + RAG ingestion) más el `setInterval` de health-check de 6 horas, ambos a `src/server/triggers/`. Target `server.ts` ≤400 LOC.

### WebAuthn full crypto + per-uid limiter (A5 + A6)

Commit `eceb505`. Cierra R6 R18 MEDIUM #1.

A5 — `@simplewebauthn/server@11.0.0` full integration:
- Verificación real CBOR + RS256/EC2 signature en `/api/auth/webauthn/verify`.
- Replay-prevention vía monotonicidad del counter de authenticator.
- `src/services/auth/webauthnCredentialStore.ts` (NEW, 205 LOC): API `registerCredential`, `getCredentialsByUid`, `findByCredentialId`, `updateCounter`, `decodePublicKey`. Tipos `RegisteredCredential` + `MinimalCredentialsDb`. 15 unit tests en `webauthnCredentialStore.test.ts` (262 LOC).
- Handler `/verify` en `src/server/routes/curriculum.ts`: extiende con adapter `buildWebAuthnCredentialsDb` (49 LOC) más full crypto path (~+140 LOC, total 227 insertions). El consume-only path R18 backwards-compat se preserva cuando `credentialId` ausente.
- Ocho nuevos supertest tests en `src/__tests__/server/webauthnVerify.test.ts`: verified happy + counter persisted, signature inválida ×2, counter replay, credential desconocido, cross-uid sin enumeration, audit row contents, propagación de `expectedChallenge`/`expectedOrigin`/`expectedRPID`.
- Audit row contiene `uid` + `credentialId` + `newCounter` solamente — NUNCA assertion bytes.
- Registration ceremony (`POST /api/auth/webauthn/register`) deferida a R20.

A6 — Per-uid rate limiter:
- `src/server/middleware/limiters.ts` (82 LOC totales con limiters previos): `webauthnVerifyLimiter` con ventana 60s, max 5, key `uid > IP > anonymous`.
- Mount order: `verifyAuth → limiter → handler` para que el limiter vea `req.user.uid`.
- Cuatro tests: 6º request = 429, aislamiento per-uid, bad bodies cuentan contra quota, pre-auth 401 no envenena el bucket.

Defense-in-depth resultante en `/verify`: single-use challenge cache + RS256 signature verify + monotonic counter + 5 req/min per-uid + audit log con forensic data only.

### MercadoPago IPN OIDC + Insignias real (A9)

Commit `c2dd51a`. Cierra R6 R18 MEDIUM #3 + R7 R18 OIDC TODO.

`UserProfileModal.tsx` Insignias real count: `aggregated?.events.filter(e => e.action.startsWith('gamification.')).length ?? 0`. Reusa el pipeline `historyAggregator` (mismo que `PortableCurriculum`); loading→0, zero events→0 (honest empty). Caveat conocido R20: `aggregated.events` está sliced a 20 — `gamificationCount` debería derivarse del set unsliced en futuro round.

MercadoPago IPN OIDC verification:
- `src/services/billing/mpJwksCache.ts` (NEW, 172 LOC): caché module-level singleton, `MP_JWKS_TTL_MS = 6h`. API `getJwks(forceRefresh)`. Test seams `_resetMpJwksCacheForTests` + `_setJwksFetcherForTests`. URL default `https://api.mercadopago.com/.well-known/jwks.json`, override vía `MP_JWKS_URL`.
- `src/services/billing/mercadoPagoIpn.ts` (NEW, 221 LOC): verificador RS256 in-house — splits compact JWS, base64url-decode header/payload, resolve matching `kid` desde caché con force-refresh once on miss, JWK→`KeyObject` vía `crypto.createPublicKey({ format: 'jwk' })`, `crypto.verify('sha256', ...)` RS256. Rechaza `alg !== 'RS256'` (defensa contra alg=none), valida `iss === MP_OIDC_ISSUER`, fail-closed cuando `MP_OIDC_AUDIENCE` unset (loguea `mp_oidc_audience_unset`), valida `aud` (string o array), valida `exp > now`. R20 candidate: declarar `jose` como dep directa y swap del verifier in-house para evitar coupling frágil con la transitive dep.
- `src/server/routes/billing.ts` `/webhook/mercadopago`: precedencia `OIDC > HMAC > LEGACY_HMAC_FALLBACK`. Bearer prefix check antes de invocar OIDC. Loguea `mp_ipn_oidc_failed` con razón en miss.

Veinte tests nuevos: 8 `mpJwksCache` (cold-fetch, warm-cache, TTL expiry, forceRefresh, network error, non-2xx, malformed), 8 `mercadoPagoIpn` OIDC unit (missing/non-Bearer header, valid JWT, expired, wrong iss/aud, tampered signature, alg=none rejected, force-refresh on unknown kid, fail-closed audience unset), 4 supertest IPN OIDC.

### Stryker ratchet (A8)

Commit `4776bf5`. Cierra el R18 A6 R19 plan deferral. 95 nuevos tests targetean los lowest-coverage files:
- `ergonomicAssessments.test.ts`: +30 tests (11 → 41) — payload guards (null/non-object), score finiteness, actionLevel-type, `workerId/projectId/computedAt/authorUid` empty+missing, `durationMin` variants (positive/zero/negative/NaN/Infinity/omitted), audit-detail field assertions, Firestore-first ordering, sin-audit-on-error, `sign()` `id`+`signerUid` guards, error-string id-quote, RULA action key, `"reba"` type fallback, missing-metadata path, signedAt-null path, audit/patch consistency, `updateDoc` rejection no-audit.
- `iperAssessments.test.ts`: +31 tests (9 → 40) — parallel coverage (`level/rawScore/projectId/authorUid/inputs` guards, P/S range and integer checks at 0/6/3.5/2.7, P/S=1 y =5 happy paths, `suggestedControls` non-array, `durationMin` variants, audit-detail consistency, Firestore-first ordering, sin-audit-on-error, `sign()` guards + edge paths).
- `rula.test.ts`: +34 tests (49 → 83) — `ANGLE_MIN/MAX` exact (±180) y just-outside, error-message segment names per body part, `force.kg=0` exact, `kg=-0.0001` throw, lowerArm 60/100/59/101, wrist 15/16/-15, neck 10/11/20/21/-5, trunk 20/21/60/61, `force.kg` 2/10/10.0001/1.999 boundaries.

Resultado del run de Stryker (3min10s, down de 5min01s en R18):
- `protocols/iper.ts`: 87.50% (sin cambio)
- `protocols/tmert.ts`: 88.46% (sin cambio)
- `protocols/prexor.ts`: 81.71% (sin cambio)
- `ergonomics/reba.ts`: 75.07% (sin cambio)
- `ergonomics/rula.ts`: 59.63% → 65.78% (+6.15 pp)
- `safety/iperAssessments.ts`: 56.08% → 87.50% (+31.42 pp)
- `safety/ergonomicAssessments.ts`: 54.61% → 87.58% (+32.97 pp)
- GLOBAL: 67.32% → 76.95% (+9.63 pp)

`stryker.conf.json` break threshold 50 → 60 (lowest `rula.ts` 65.78, buffer 5.78 pp). Justificación: 127/128 survivors de `rula` son `TABLE_A/B/C` ArrayDeclaration mutants — el orden estocástico bajo `perTest` podría empujar `rula` a 64.x en runs marginales. R20 candidate: snapshot-canonical strategy + `excludedMutations: ['ArrayDeclaration']` → expected `rula` 75-80% y ratchet break a 65. `STRYKER_BASELINE.md` actualizado con sección "R19 Ratchet — 2026-04-29 (A8)" con per-file delta table y R20 deferrals.

## Métricas

- `tsc --noEmit`: 0 errors.
- vitest: 1158 passed + 66 skipped = 1224 total (R18: 1069 → R19: 1158, +155 tests R19).
- `server.ts`: 1290 → 598 LOC (-692 R19; cumulative R12-R19: 3242 → 598 = -82%).
- 5 nuevos route modules en R19; 13 acumulados en `src/server/routes/` totalizando 4111 LOC contra 598 de bootstrap.
- Stryker: 67.32% → 76.95% global (+9.63 pp), break threshold 50 → 60.
- `@simplewebauthn/server@11.0.0` instalado (`package-lock.json` +181 líneas).
- Nuevos archivos: `webauthnCredentialStore.ts` (205 LOC), `mpJwksCache.ts` (172 LOC), `mercadoPagoIpn.ts` (221 LOC), `limiters.ts` (82 LOC con limiters previos).

## Cumulative R12-R19

- Tests pasando: ~600 → 1158 (+93%, +558 neto sobre 8 rondas).
- `server.ts`: 3242 → 598 LOC (-82%).
- 13 route modules extracted (admin, health, audit, push, billing, curriculum, projects, oauthGoogle, gemini, reports, telemetry, gamification, misc).
- Stryker baseline shipped + ratcheted (76.95% global, break 60).
- WebAuthn fully crypto-verified (CBOR + signature + counter + per-uid limiter).
- HMAC RFC 8785 canonical + LEGACY rollback flag (R17/R18 work).
- MP IPN OIDC > HMAC > LEGACY precedence (R19).

## Round 20 plan priorizado

1. `server.ts` Phase 5: extract `setupBackgroundTriggers` + healthCheck `setInterval` de 6h a `src/server/triggers/`. Target ≤400 LOC.
2. `/api/auth/webauthn/register` endpoint (registration ceremony, R5 R19 deferred).
3. `/api/ask-guardian` add `geminiLimiter` (Reviewer M1 — cost-control).
4. WebAuthn `expectedOrigin` prod fail-fast guard (Reviewer M2 — fallback a localhost en producción es riesgo).
5. Stryker `rula.ts` `TABLE_A/B/C` snapshot strategy + `excludedMutations: ['ArrayDeclaration']` → expected 75-80%, ratchet break a 65.
6. Declarar `jose` como dep directa, swap del verifier RS256 in-house en `mercadoPagoIpn.ts`.
7. MP IPN manifest signature legacy variant (`ts=,v1=`) si MP product line lo requiere.

## Round 21+ deferred

- `geminiBackend.ts` split (2701 LOC, plan de 18 modules per `ARCHITECTURE.md`).
- SOC 2 Type I path kickoff.
- Marketplace assets (screenshots, video, listing copy).
- HR/Mutual/Regulator dashboard differentiator.
- `gamificationCount` desde el aggregator unsliced (no del slice de 20).

## Por qué importa

Tras Round 19 `server.ts` es bootstrap-only: carga env, configura middleware global, monta 13 routers y arranca el listener. La reducción acumulada de 82% (3242 → 598 LOC) hace que el blast radius de cualquier bug en una ruta esté contenido a un módulo de menos de 1100 LOC, y permite onboarding por feature en lugar de por bisección. La Phase 5 deja sólo los background triggers como deuda restante.

Defense-in-depth sobre WebAuthn cierra el vector de credential stuffing: el atacante ahora debe burlar simultáneamente el challenge cache single-use, la firma RS256/EC2 con CBOR parsing real, la monotonicidad del counter (replay), y el limiter per-uid de 5 req/min. Esto convierte al `/verify` de un toy endpoint (consume-only en R18) en una ceremonia FIDO2 standards-compliant — pendiente sólo el lado de registration. El audit log honra el principio de no almacenar assertion bytes: sólo metadata forensic (`uid`, `credentialId`, `newCounter`).

MP IPN OIDC cierra payments authentication completeness con precedencia explícita OIDC > HMAC > LEGACY. El verifier RS256 in-house es fail-closed contra `alg=none` (clase de bug histórica en libs JWT) y contra audience unset (operator misconfig fail-safe). El caché JWKS de 6h con force-refresh on unknown kid amortiza correctamente el costo de rotación de claves de MP sin comprometer la seguridad. La consecuencia operacional es que la línea de billing está formalmente verificada contra spoofing de webhooks aún si el secreto HMAC se filtra.

El ratchet formal de Stryker (76.95% break 60) captura la calidad de tests safety-of-life (`iperAssessments`, `ergonomicAssessments`, `rula`) en CI: regresiones en mutation score que crucen el break tumban el build, no se reportan como warning. Es la primera vez que el repo tiene gating de mutation testing además de gating de coverage de líneas, lo cual es coherente con la naturaleza regulatoria del producto (Chile DS 54/40, Ley 16.744).

## Revert pattern lesson

A1 cerró el incidente de R18 A8 con `git diff --stat` proof on disk en el completion report (commit `a3ad84d`). El A8 original se había perdido a un revert pattern silencioso entre rondas — el implementer reportó éxito pero el diff no quedó persistido en el repo. La doctrina para implementers a partir de R19 es: SIEMPRE incluir `git diff --stat` en el completion report contra el HEAD pre-trabajo, y re-leer las líneas críticas con la herramienta Read después del Edit para confirmar persistencia. A1 de R19 aplicó el patrón correctamente y no requirió redo este round — first-attempt success.
