# DEEP-EXT-10 — Auditoría EXHAUSTIVA de TESTS (Lote #10)

**Atestación: 55/55 tests leídos línea por línea.**

Deriva: `ledger.json` filtrado `category === "I-TEST"`, ordenado por `path`,
slice `[495:550]` (índices 495–549; cspReport.test.ts es el último). Total
I-TEST en ledger: 1247.

Foco: falsos-verdes y tests débiles — rules-tests con Admin SDK, datos
sintéticos que setean el campo del gate, asserts sobre campo/valor equivocado,
over-mocking, "ID crypto contract" tautológico, reimplementación-disfrazada,
`validate→next` sin 400, asserts triviales/vacíos, skip/todo/fixme/`it()`
vacío, snapshot-only, y tests que pasarían con una impl incorrecta.

Severidades: 🔴 grave (falso-verde / cobertura engañosa de invariante de
seguridad) · 🟡 débil (cobertura parcial o tautológica que infla la señal) ·
🔵 nota menor.

---

## Hallazgo sistémico dominante — "wire-up contract" tests 🟡

Aproximadamente **30 de los 55 archivos** del lote son "router wire-up
contract" tests: importan el `Router` de Express, leen su `.stack` por
reflexión y **solo** afirman que (a) el export es una función y (b) cada
`(path, method)` esperado está registrado. **Nunca** ejercitan el handler,
`verifyAuth`, `assertProjectMember`, validación Zod / 400, tier-gating,
ni el cuerpo de la respuesta.

Por qué es débil: el test pasa aunque el handler omita `verifyAuth`, fugue
datos cross-tenant, no escriba `audit_logs`, devuelva 500, o produzca el
resultado equivocado. Es una aserción tautológica sobre la tabla de rutas
(reflexión del propio objeto bajo prueba), no sobre comportamiento. Equivale
a "el archivo importa sin tirar + tiene los nombres correctos".

Severidad 🟡 (no 🔴) porque NO afirman falsamente cubrir un invariante de
seguridad — el comentario los rotula honestamente como "(wire-up contract)".
El riesgo real es que inflan el conteo de tests y pueden dar falsa confianza
de que la ruta "está testeada".

### Archivos afectados (wire-up only)

| # | Archivo | Rutas | Por qué débil |
|---|---|---|---|
| 511 | adminBurden.test.ts | 2 POST | Solo `.stack` reflection; sin auth/handler/400. |
| 512 | adoption.test.ts | 4 POST | idem. |
| 513 | agenda.test.ts | 5 POST | idem. |
| 514 | aggregateTelemetry.test.ts | 2 GET | idem. |
| 516 | aiGuardrails.test.ts | 10 POST | idem; ruta IA sin probar guard de salida. |
| 517 | aiQuality.test.ts | 6 POST | idem; `assert-human-gated` sin probar gate real. |
| 518 | aiToggle.test.ts | 3 POST | idem. |
| 519 | annualReview.test.ts | 4 (get+post) | idem. |
| 520 | apprenticeship.test.ts | 5 (get+post) | idem; flagged tx-audit en CLAUDE.md #19 sin cubrir. |
| 521 | auditChain.test.ts | 4 POST | 🟡+ ruta de cadena de auditoría (append/verify/anchor) sin probar integridad. |
| 522 | auditPortal.test.ts | 6 POST | 🟡+ create-portal/revoke/check-access sin probar control de acceso. |
| 527 | bbs.test.ts | 2 POST | idem. |
| 528 | bowtie.test.ts | 3 POST | idem. |
| 530 | changeMgmt.test.ts | 4 POST | idem. |
| 531 | checklistBuilder.test.ts | 4 POST | idem; `apply-signature`/`lock-response` sin probar inmutabilidad post-firma. |
| 532 | circadian.test.ts | 3 POST | idem. |
| 533 | climateAwareScheduling.test.ts | 2 POST | idem. |
| 534 | coachRag.test.ts | 3 POST | idem. |
| 535 | comms.test.ts | 5 POST | idem. |
| 536 | commsDrill.test.ts | 4 POST | idem. |
| 537 | confidentialReports.test.ts | 5 (get+post) | 🟡+ **Ley Karin / denuncias confidenciales**: solo registro de rutas; confidencialidad/RBAC/retaliation-alerts sin probar comportamiento. |
| 538 | consistency.test.ts | 2 POST | idem. |
| 539 | consultativeSale.test.ts | 1 POST | idem; archivo de 24 líneas para 1 ruta. |
| 540 | contingencySimulation.test.ts | 4 POST | idem. |
| 541 | continuity.test.ts | 3 POST | idem. |
| 542 | contractors.test.ts | 3 POST | idem. |
| 543 | controlComparator.test.ts | 4 (get+post) | idem. |
| 544 | correctiveActions.test.ts | 3 (get+post) | idem. |
| 545 | costCalculator.test.ts | 2 POST | idem; cálculo CLP sin probar valores. |
| 546 | cphsMinute.test.ts | 1 GET | 🟡 archivo de 22 líneas, 1 ruta; flagged tx-audit (#19) sin cubrir. |
| 547 | criticalControls.test.ts | 9 POST | idem. |
| 548 | criticalRoles.test.ts | 4 POST | idem. |

> Recomendación: para cada router migrado, añadir al menos el mínimo del
> repo (CLAUDE.md "Testing notes"): 401 sin token, 200 happy path,
> 400/403/404 — vía supertest, no reflexión de `.stack`. Priorizar
> `confidentialReports`, `auditChain`, `auditPortal`, `checklistBuilder`
> (firma/lock), `criticalControls`.

---

## Tests SÓLIDOS (sin objeción material)

Estos ejercitan comportamiento real con dobles in-memory, asserts sobre
valores correctos, ramas de error, e invariantes verificados:

| # | Archivo | Nota |
|---|---|---|
| 495 | runWorkPermitAutoExpire.test.ts | Scan/expire/partial-fail/notify; asserts sobre `expiredBy`, paths escritos. Sólido. |
| 496 | sendSusesoReminders.test.ts | Recipients por rol, idempotencia mismo día, no-spam submitted, escalations green/yellow/orange/red/overdue, fallo de dispatch logueado + no-abort. Excelente. |
| 497 | kmsPreflight.test.ts | Fail-closed prod con adapter in-memory; exige key resource. Sólido. |
| 498 | zkFirebaseReadAdapter.test.ts | Aislamiento de tenant por whitelist (throw fuera de lista), defaults seguros, caps depth/maxNodes, BFS por niveles. Sólido (aislamiento testea el propio whitelist del adapter, no reglas Firestore — correcto para su responsabilidad). |
| 499 | b2dAuth.test.ts | 401 missing/invalid, 403 scope, 429 quota + headers, 200 + remaining, `suite.all`. Sólido. |
| 500 | canonicalBody.test.ts | RFC 8785: orden de claves anidado, arrays preservados, NaN/Inf throw, determinismo cross-orden. Sólido. |
| 501 | captureRouteError.test.ts | Pinea regresión Codex P2 (tags vs top-level), scalars→tags, callerUid→userId, swallow + warn. Sólido. |
| 502 | geminiCircuit.test.ts | Reloj inyectado; threshold/window/half-open/re-open/aislamiento por key. Sólido. |
| 503 | idempotencyKey.test.ts | Header ausente, replay, scope=uid isolation, TTL, race (1 row), 422 fingerprint mismatch. Sólido. |
| 504 | securityHeaders.test.ts | CSP directivas, sin wildcard `*.googleapis.com`, nonce por request ≥128 bits, prod sin `unsafe-eval`. Sólido. |
| 505 | stampCspNonce.test.ts | `$&`/`$$`/`$1` literales (bug replacement-string). Sólido. |
| 506 | validate.test.ts | 200 happy, **400 invalid_payload con issues**, query/params, transform, defaults, warn con uid. Sólido. |
| 507 | verifyAuth.test.ts | Mutation-driven: guard prod+E2E, Bearer positivo/negativo case-sensitive, sepIdx +1, MAX_SESSION_HOURS boundaries, session-age 8h. Excelente. |
| 508 | verifySchedulerToken.test.ts | 503 sin secret, 401 sin/wrong/short/no-Bearer, next en match. Sólido. |
| 509 | verifyTwinStepUp.test.ts | 6 paths ADR 0011 (missing/project/stale/invalid/uid mismatch) + secret corto throw. Sólido. |
| 510 | firestoreRateLimitStore.test.ts | increment/decrement/reset, prefix, slash-key (IPv6 CIDR), Date vs Timestamp legacy, fail-soft. Sólido. |
| 515 | aiFeedback.replay.test.ts | 200 + audit row, **409 already_voted** (no flip), force override, **429 a los 30 votos**. Excelente. |
| 523 | b2d/climate.test.ts | Integración real con fetch mockeado→fallback; 200 shape+citations, **400 invalid_coordinates**, **400 invalid_industry**. Sólido. |
| 524 | b2d/hazmat.test.ts | 200 + citas DS, **400 invalid_input**, clases Pasquill, NCh/DS594/OSHA. Sólido. |
| 525 | b2d/normativa.test.ts | 200 search, **400 invalid_country**, 404 by-id miss, validate gaps. Sólido. |
| 526 | b2d/suite.test.ts | **400 invalid_input**, Gemini válido vs fallback determinístico (JSON inválido / parcial / throw), **no-leak Zettelkasten/tenant/firestore**. Excelente. |
| 529 | cad.test.ts | 503 not_configured (x2), **400 missing_input_uri**, 200 + assert sobre URL/headers/body upstream, 502 5xx/4xx/unreachable. Excelente. |
| 549 | cspReport.test.ts | 204 + breadcrumb, **strip query/fragment PII**, keyword tokens, fallback effective-directive, Sentry-throw→204, URL malformada. Excelente. |

---

## Observaciones puntuales 🔵

- **#515 aiFeedback.replay.test.ts:50** — usa `Math.random()` dentro del mock
  in-memory (`auto_${Math.random()...}`). Permitido por convención #15
  (archivos de test), y el doble es hermético; sin acción. 🔵
- **#523/#524/#525/#526 (b2d)** — mockean `b2dAuth` para pasar siempre, así
  que estos archivos NO prueban auth; aceptable porque #499 b2dAuth.test.ts
  cubre el gate por separado (separación de responsabilidades correcta). 🔵
- **#496 sendSusesoReminders.test.ts:168** — comentario "4 recipients" lista
  gerente/supervisor/creator/worker (supervisor SÍ se notifica). El conteo
  esperado `8` (4×2 canales) es consistente con el cuerpo; el comentario es
  ligeramente confuso pero el assert es correcto. 🔵
- **#498 zkFirebaseReadAdapter.test.ts:347** — `depth capado a 5` solo afirma
  `>= 4` (el seed tiene 4 nodos), no prueba estrictamente el cap a 5; aceptable
  pero podría endurecerse con un seed más profundo. 🔵

---

## Conteo de sólidos

- **Sólidos / fuertes**: 25/55 (todos los middleware/jobs/b2d/cad/cspReport
  + adapter + replay).
- **Débiles 🟡 (wire-up contract, tautológicos)**: 30/55.
- **Falsos-verdes graves 🔴**: 0/55 — ningún test afirma falsamente cubrir un
  invariante de seguridad; los débiles están honestamente rotulados.
- **skip/todo/fixme/`it()` vacío / snapshot-only**: 0.
- **rules-test con Admin SDK / dato que setea el gate / reimplementación**: 0
  en este lote (no hay `*.firestore.test.ts` ni rules-tests aquí).

---

## Resumen ejecutivo (6–10 líneas)

Lote #10 = 55 tests, todos bajo `src/server/` (jobs, middleware, rateLimit,
mcp, b2d, routes). La calidad es **bimodal**: 25 archivos son sólidos a
excelentes — middleware (`verifyAuth`, `validate`, `securityHeaders`,
`idempotencyKey`, `geminiCircuit`), jobs (`sendSusesoReminders`,
`runWorkPermitAutoExpire`), e integraciones reales con supertest
(`cad`, `cspReport`, `aiFeedback.replay`, b2d/*) que ejercitan 400/401/409/429,
ramas de error, PII-scrub y no-leak. Varios son mutation-driven (verifyAuth).
El **único patrón problemático** son ~30 "router wire-up contract" tests que
solo reflexionan sobre el `.stack` de Express y afirman que las rutas existen,
sin tocar handler, auth, `assertProjectMember` ni validación — pasarían con un
handler roto o inseguro. Severidad 🟡 (honestamente rotulados, inflan señal),
con énfasis en routers sensibles (`confidentialReports`/Ley Karin,
`auditChain`, `auditPortal`, `checklistBuilder` firma/lock, `criticalControls`)
que merecen el trío supertest mínimo del repo (401/200/4xx).
**Cero falsos-verdes graves, cero skips, cero snapshot-only.**
