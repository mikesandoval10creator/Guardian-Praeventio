# DEEP-EXT-12 — Auditoría exhaustiva de tests (Lote #12)

**Scope:** `ledger.json` filtro `category==="I-TEST"`, orden por `path`, slice `[605:660]` (55 archivos).
**Universo:** todos `src/server/routes/*.test.ts`.
**Método:** lectura línea por línea + cruce contra la implementación de cada router (`*.ts`) y de los servicios subyacentes.
**Fecha:** 2026-06-03. Doc-only, sin commit.

Leyenda severidad: 🔴 falso-verde grave (un bug real pasaría) · 🟡 cobertura ilusoria / tautológica · 🔵 menor / nota.

---

## Hallazgo sistémico (🔴) — "wire-up contract" no prueba seguridad ni comportamiento

**51 de 55** archivos del lote son tests del patrón *"wire-up contract"*: cargan el router como módulo, hacen cast a `{ stack: Layer[] }` y assertan únicamente que existe `route.path` con el método HTTP esperado. NO arrancan Express, NO hacen requests (`supertest`), NO ejercitan handlers, NO verifican middleware.

Esto sería defendible si los routers fueran trivial passthrough. **No lo son.** Verificado contra impl:

- `restrictedZones.ts` cablea `verifyAuth`, `validate(zodSchema)` y `assertProjectMember(uid, projectId)` por ruta (`restrictedZones.ts:252-259, 300, 339, 376-384, 492-509`).
- `operationalChange.ts` idem (`operationalChange.ts:126-128, 179, 221-223`, `assertProjectMember` en `:89`).

Los tests de esos dos routers (`restrictedZones.test.ts`, `operationalChange.test.ts`) **no assertan ni una sola vez** la presencia de `verifyAuth` / `validate` / `assertProjectMember` en el `stack` de la ruta. Un PR que elimine `verifyAuth` de cualquier endpoint (auth bypass, viola directiva #6 del CLAUDE.md) o que borre `validate` (viola validate→400) **pasa el 100% de estos tests en verde**. El `stack` introspeccionado contiene los handlers de middleware, pero el helper `hasPost(path)` los descarta deliberadamente — solo mira `route.methods`.

Esto es la definición de falso-verde a escala de lote: la suite da una falsa sensación de cobertura de los routers más sensibles de seguridad del servidor.

**Archivos afectados (todos 🔴 por el mismo motivo — auth/validate no aseverado):**

| Archivo | Líneas clave | Nota |
|---|---|---|
| `restrictedZones.test.ts:17-77` | `hasMethod` solo mira `methods` | router con `verifyAuth`+`validate`+`assertProjectMember`; nada aseverado |
| `operationalChange.test.ts:11-64` | `hasMethod` | idem; además tests "negativos" (`:50` no-DELETE, `:57` no change-mgmt) son tautológicos sobre rutas inexistentes |
| `nonConformity.test.ts:9-31` | `hasPost` | |
| `offlineInspections.test.ts:16-26` | inline stack | |
| `orgMetrics.test.ts:9-39` | `hasPost` | |
| `pdca.test.ts:13-28` | inline stack | |
| `photoEvidence.test.ts:12-46` | inline stack | |
| `pinSign.test.ts:9-29` | `hasPost` | **PIN signing** — flujo de firma, sin un solo test de comportamiento |
| `portableHistory.test.ts:10-29` | inline stack | colección PII (portable health history) sin test de consent gate |
| `portfolioLessons.test.ts:9-27` | `hasPost` | |
| `positiveObservations.test.ts:12-31` | inline stack | |
| `postTraining.test.ts:9-37` | `hasPost` | |
| `preShiftRisk.test.ts:12-21` | inline stack | |
| `predictiveAlerts.test.ts:9-26` | `hasPost` | |
| `preventionCost.test.ts:19-65` | `hasMethod` | el más "completo" del estilo, pero todo es shape (`:45` count, `:50` prefix, `:57/:62` method-exclusivity) — cero comportamiento |
| `pricingCalculator.test.ts:9-32` | `hasPost` | |
| `pricingSimulator.test.ts:9-31` | `hasPost` | |
| `privacyRetention.test.ts:9-35` | `hasPost` | módulo de retención PII sin test de lógica |
| `privacyShield.test.ts:9-31` | `hasPost` | idem (`classify-field`, `reap-expired`) |
| `projectClosure.test.ts:13-28` | inline stack | |
| `projectComparator.test.ts:9-23` | `hasPost` | |
| `protocols.test.ts:9-31` | `hasPost` | iper/prexor/tmert — engines mutation-tested aparte, pero el route en sí (auth) no |
| `pymeOnboarding.test.ts:9-26` | `hasPost` | |
| `pymeWizard.test.ts:9-23` | `hasPost` | |
| `qrAck.test.ts:9-27` | `hasPost` | |
| `qrSignature.test.ts:16-24` | inline stack | challenge/acknowledge de firma QR sin test cripto/comportamiento |
| `raciMatrix.test.ts:9-34` | `hasPost` | |
| `readReceipts.test.ts:9-34` | `hasPost` | |
| `refuges.test.ts:9-27` | `hasPost` | |
| `regulatoryFramework.test.ts:9-29` | `hasPost` | |
| `reportsAutomation.test.ts:9-31` | `hasPost` | |
| `reputationalAlerts.test.ts:9-27` | `hasPost` | |
| `researchMode.test.ts:9-35` | `hasPost` | |
| `residualRisk.test.ts:13-26` | inline stack | |
| `retaliationProtection.test.ts:9-27` | `hasPost` | módulo anti-represalias (sensible) sin test de lógica |
| `returnToWork.test.ts:9-31` | `hasPost` | rozando ADR-0012 (`assess-task-fit`, `decide-derivation`) — sin test de disclaimer/no-diagnóstico |
| `riskRadar.test.ts:12-21` | inline stack | |
| `riskRanking.test.ts:9-28` | `hasPost` | |
| `roiScenario.test.ts:9-23` | `hasPost` | |
| `roleViews.test.ts:9-23` | `hasPost` | |
| `rootCause.test.ts:9-33` | `hasPost` | |
| `rootCauseInvestigation.test.ts:9-35` | `hasPost` | |
| `routeScoring.test.ts:12-34` | inline stack | |
| `routing.test.ts:9-27` | `hasPost` | |
| `safetyMetrics.test.ts:9-31` | `hasPost` | |
| `safetyPerformance.test.ts:9-27` | `hasPost` | |
| `safetyTalks.test.ts:9-23` | `hasPost` | |
| `shiftHandover.test.ts:9-30` | `hasPost` | |
| `shiftRiskPanel.test.ts:9-23` | `hasPost` | |
| `sif.test.ts:13-34` | inline stack | SIF precursors (alta criticidad) sin test de comportamiento |
| `signaletics.test.ts:13-46` | inline stack | |
| `skillGap.test.ts:9-35` | `hasPost` | |

**Por qué cuenta como falso-verde y no "decisión de diseño":** el propio CLAUDE.md (sección "Testing notes") fija como mínimo para una ruta nueva: *401 (no token), 200 happy path, 400/403/404 validation paths* vía supertest. Ninguno de estos 51 archivos cumple ese mínimo. Comentan que el comportamiento "vive en el engine test" (ej. `preventionCost.test.ts:9-11`, `restrictedZones.test.ts:4-5`), lo cual cubre la **matemática pura** pero deja **sin cobertura el contrato HTTP/auth** que es exactamente lo que un archivo `routes/*.test.ts` debería proteger.

---

## Hallazgos individuales

### 🔴 `sitebookSignRoutes.webauthn.test.ts:67-95` — reimplementación-disfrazada que CONTRADICE la impl real

El test define `helperMirror()` (`:67-74`) y aseverta su comportamiento (`:76-99`), declarando que es un "mirror" de `getWebAuthnRpId()`. **No lo es.** Divergencia verificada contra `sitebookSignRoutes.ts:53-65`:

- `helperMirror()` en producción sin env: **`throw new Error('WEBAUTHN_RP_ID required in production')`** (`:70-72`).
- `getWebAuthnRpId()` real en producción sin env: **NO lanza** — `logger.warn(...)` y `return 'app.praeventio.net'` (`sitebookSignRoutes.ts:56-61`).

El test "throws when WEBAUTHN_RP_ID is missing in production" (`:82-85`) pasa en verde verificando una función fantasma que vive solo en el test. La implementación real hace lo opuesto (fallback silencioso a host hardcoded — justo el riesgo que el comentario del test, `:1-13`, dice estar previniendo). Es un test tautológico (se prueba a sí mismo) **y** que da cobertura falsa de un comportamiento de seguridad que en realidad no existe en el código.

### 🟡 `sitebookSignRoutes.webauthn.test.ts:35-63` — tests source-grep frágiles + uno engañoso

`:35-47` y `:50-53` y `:55-62` leen el `.ts` como string y aplican regex. El de `:55-62` aseverta que el patrón `?? 'app.praeventio.net'` está ausente — y pasa, pero la impl real **sí hardcodea exactamente** `'app.praeventio.net'` como fallback de producción (`sitebookSignRoutes.ts:61`), solo que vía bloque `if` en vez de `??`. El test "no hardcodea fallback" es verde mientras el fallback hardcoded sigue ahí. Falso-verde sobre el invariante que dice proteger. Los grep-tests además rompen ante cualquier refactor que renombre la variable, sin que cambie el comportamiento.

### 🟡 `operationalChange.test.ts:48-64` — asserts negativos tautológicos

`:48` ("all routes under `/:projectId/moc/`") y `:57` ("no monta change-mgmt") iteran sobre las 5 rutas ya declaradas en el mismo router. Son auto-cumplidos por construcción: el router solo registra rutas `moc/`, así que aseverar que ninguna es `change-mgmt/` no prueba "separación de concerns", solo re-lee la lista. Lo mismo `restrictedZones.test.ts:50-59` (no-DELETE) y `:61-76` (lista exacta) — útil como snapshot de rutas, pero etiquetado como garantía de comportamiento de seguridad ("never block") que no ejercita.

### 🟡 `openapi.test.ts:30-32` — único con supertest real, pero spot-check superficial

Buen archivo relativo al lote (monta app real, verifica 200 + content-type + no-auth, `:22-42`). El `:32` solo verifica que UNA ruta (`/api/b2d/v1/climate/current`) exista en `paths` como "prueba de que el bootstrap corrió end-to-end". No valida la forma del documento ni que las rutas auth tengan `security`. Cobertura aceptable pero el comentario sobreestima ("proof the bootstrap ran end-to-end") lo que un único spot-check garantiza. No es falso-verde; nota.

### 🔵 `sitebookSign.test.ts` — el archivo BUENO del lote (referencia)

`sitebookSign.test.ts:135-430` es comportamiento real vía inyección de dependencias: deriva el challenge desde el hash y compara contra `deriveSigningChallenge` (`:241-252`, no tautológico — recomputa por vía independiente), prueba tamper de hash (`:185-195, :316-338`), idempotencia post-firma (`:197-207, :340-363`), propagación de fallo de firma (`:365-393`) y los args pasados a `verifyAssertion` (`:395-430`). Esto es lo que los 51 wire-up tests deberían aspirar a ser. Sin hallazgos.

---

## Resumen (TL;DR)

Lote 100% `src/server/routes/*.test.ts`. **51/55 son "wire-up contract"**: solo introspeccionan `router.stack` para confirmar `path`+método, sin supertest, sin auth, sin validación, sin comportamiento — un falso-verde sistémico (🔴) porque routers como `restrictedZones`/`operationalChange` SÍ cablean `verifyAuth`+`validate`+`assertProjectMember` y borrar cualquiera de esos middlewares dejaría toda la suite en verde, violando las directivas #6 y el mínimo de cobertura de ruta del propio CLAUDE.md (401/200/400). Routers sensibles afectados sin cobertura de comportamiento: `pinSign`, `qrSignature`, `privacyRetention`, `privacyShield`, `retaliationProtection`, `returnToWork` (roza ADR-0012), `sif`, `portableHistory` (PII). Hallazgo crítico individual: `sitebookSignRoutes.webauthn.test.ts:67-95` es reimplementación-disfrazada — su `helperMirror()` LANZA en producción mientras la impl real (`sitebookSignRoutes.ts:53-65`) hace fallback silencioso a `'app.praeventio.net'`; el test valida una función fantasma y un grep-test (`:55-62`) declara ausente un hardcode que sigue presente (🔴+🟡). Único test ejemplar: `sitebookSign.test.ts` (DI, comportamiento real, recomputación independiente del challenge). `openapi.test.ts` es el único con supertest real pero spot-check de una sola ruta. Recomendación: subir los routers de seguridad (auth/validate/assertProjectMember) a tests supertest reales y alinear/eliminar `helperMirror()` con la impl real de `getWebAuthnRpId`.
