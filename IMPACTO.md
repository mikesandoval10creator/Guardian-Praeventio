# Impacto — Round 21 (Phase 5 server.ts triggers + reba snapshot + IPv6 keyGen + docs sweep + gemini split plan)

## TL;DR

Round 21 desplegó cinco implementadores en paralelo y todos fueron firmados SHIP IT por el B6 Reviewer (0 BLOCKERs, 0 HIGHs). B1 cerró el deferred A1 R20 — Phase 5 split de `server.ts` extrayendo triggers vía worktree isolation, eliminando 141 LOC y dejando el bootstrap en 457 LOC (cumulative R12-R21: 3242 → 457, -86%). B2 ratchetó Stryker con 243 tests parametricos de `reba.ts` (75.81% → 77.74%, global 84.95% → 85.52%, break 65 mantenido). B3 entregó el inventario completo de `geminiBackend.ts` con plan phased R22-R26 (60 exports directos + 12 barrel + 84 acciones whitelist en 18 módulos). B4 cerró el R6 R20 MEDIUM #2 con 4 keyGenerators IPv6-safe vía `ipKeyGenerator` y 6 tests nuevos. B5 documentó la `MP_OIDC_CLOCK_TOLERANCE_SEC`, agregó la sección "revert pattern" a AUDIT.md con un playbook de 6 pasos, y anotó la baseline de Stryker. La suite vitest pasó de 1522 a 1719 tests (+197 R21 contando 66 skipped llega a 1785 totales, lo cual entrega +263 sobre el universo previo); `tsc` se mantiene en cero errores. Mid-round un incidente de pwd drift del orchestrator generó falsa alarma de pérdida de datos — verificado y descartado vía `git diff` por B6 — resolución captured como mejora de proceso.

## Cambios por área

### Phase 5 server.ts triggers extract (B1, vía worktree)

Commit `7721816`. Cierra el A1 R20 que se atascó en watchdog 600s en main-tree. La estrategia de aislamiento `EnterWorktree` evitó el stall: pre-pass de 75s (bajo el budget de 300s), no triggereó ningún criterio de HARD ABORT, y la rama mergea limpia.

`server.ts` pasó de 598 a **457 LOC** (-141, -23.6%). Cumulative R12-R21: 3242 → 457 LOC (**-86%**, -2785 LOC). Cerca de bootstrap-only.

Nuevos módulos en `src/server/triggers/`:

- `backgroundTriggers.ts` (275 LOC, `src/server/triggers/backgroundTriggers.ts`): `setupBackgroundTriggers(deps)` registra los listeners FCM más la ingestión RAG. Retorna `{ unsubscribe() }` para graceful shutdown / test seam. La forma del DI es `BackgroundTriggersDeps { db, messaging, resend, firestoreNamespace, ...overrides }` — `firestoreNamespace` está separado del `db` porque `FieldValue.serverTimestamp()` vive en el namespace.
- `backgroundTriggers.test.ts` (341 LOC): 7 tests con `vi.mock` de `firebase-admin` + Resend.
- `healthCheck.ts` (71 LOC, `src/server/triggers/healthCheck.ts`): `setupHealthCheckInterval(deps)` con default de 6h, override custom, retorna `{ stop() }`.
- `healthCheck.test.ts` (127 LOC): 7 tests para registración del intervalo.

`server.ts` ahora almacena los handles en module-level vars y el handler `SIGTERM` invoca `triggersHandle.unsubscribe()` + `healthHandle.stop()` antes de `process.exit(0)`. Cloud Run envía SIGTERM ~10s antes del SIGKILL, así que las suscripciones `onSnapshot` liberan limpiamente. Removida también una `import { GoogleGenAI }` y un `const ai = new GoogleGenAI(...)` muertos en el trigger RAG (la variable se construía pero nunca se leía).

Pre-pass arch findings (sin ABORT): `setupBackgroundTriggers` ya estaba dentro del callback `app.listen()` (`server.ts:579`) — preservado post-extract; `admin.firestore()` resuelve lazy dentro del setup, mientras que `admin` init completa top-level (líneas 119-152) antes del listen; sin module-load side effects, sin cyclic deps, sin module-level state mutations. `process.env` checked at handler-call time, preserved vía optional override hooks.

Issues adyacentes fuera de scope (M1/M2 R22 backlog del Reviewer): el `setInterval` de 10 minutos `updateGlobalEnvironmentalContext` es estructuralmente similar y debería migrar a un trigger module con su propio cleanup en SIGTERM (asimetría con el contrato B1); el field `geminiApiKey` de `BackgroundTriggersDeps` quedó unused pero se preservó por simetría de API.

### reba TABLE_A/B/C parametric snapshot (B2)

Commit `188adce`. Mirror de la estrategia A4 R20 aplicada a `reba.ts`.

243 tests nuevos vía `vitest test.each` en `src/services/ergonomics/reba.test.ts` (51 → 294, +425 LOC):

- `TABLE_A`: 60 cells (5 trunk × 3 neck × 4 legs).
- `TABLE_B`: 36 cells (6 upperArm × 2 lowerArm × 3 wrist).
- `TABLE_C`: 144 cells (12 A × 12 B).
- Structural identity tests: 3.

Resultados Stryker R21:

- `reba.ts`: 75.81% → **77.74%** (+1.93pp). Killed 235 → 241 (+6); survivors 67 → 61 (-6).
- `rula.ts`: 94.22% (unchanged).
- Global: 84.95% → **85.52%** (+0.57pp).

**Break threshold mantenido en 65** (no bumped a 70): `reba.ts` quedó en banda 75-79 — la spec dice keep break en 65. No se alcanzó el target ≥80% porque los survivors restantes son boundary checks en `trunkScore`/`neckScore` más validation `NoCoverage` (5 throws) — diferidos a R22 con concrete test list.

Key finding: la mejora modesta de +1.93pp (vs +28.44pp en `rula.ts` R20) es porque la `excludedMutations: ['ArrayDeclaration']` global de R20 ya suprimía los ArrayDeclaration mutants en las tablas de reba. Las cell-snapshot tests killed mostly mutants que ya estaban excluded. Net win: defense-in-depth si el `ArrayDeclaration` global exclusion se narrowea futuro.

`STRYKER_BASELINE.md` actualizado con sección Ratchet R21 + tabla per-file delta + R22 deferrals (boundary tests trunk/neck/upperArm extension paths + validation NoCoverage 5 throws).

### geminiBackend.ts scope discovery (B3, inventory only)

Commit `383d1e7`. Inventario only — cero cambios `.ts`. Drives la extracción phased R22-R26.

`docs/gemini-split-plan.md` (NEW, 581 LOC):

- Inventory: 60 exports directos + 12 sibling re-exports = **72 surface names**.
- `ALLOWED_GEMINI_ACTIONS` whitelist: **84 acciones** (61 propias + 23 de siblings).
- File size real: 2701 LOC (35 más que la estimación inicial).
- Por dominio: embeddings 2, classify 9, vision 6, audio 1, pts 3, evacuation 4, bcn-rag 2, compliance 9, engineering 2, chat 1, recommendations 20, ergonomic 2.
- Shared internals: `API_KEY`, `sleep`, `withExponentialBackoff` + `GoogleGenAI` factory + 7 model-ID constants + base64 prefix stripper.

Asignación de módulos (12 dominio + `_shared` + `index` barrel): `recommendations.ts` excede el budget de ~860 LOC (20 funciones) — recomendado sub-split en R26 a `recommendations/{predict,incidents,personal}`. El `geminiBackend.ts` existente queda como barrel ~30 LOC backward-compat.

Recomendación de migración: **PHASED 5 rondas (R22-R26)**, 4-18 funciones por round. Big-bang rejected — 3000-LOC churn unreviewable + amplifies dynamic-import risk.

Top 3 riesgos identificados para R22:

1. **Dynamic-import barrel surface drift**: `gemini.ts:202` hace `await import` y `ALLOWED_GEMINI_ACTIONS` actúa como allowlist — mitigación es un test CI que assertea que las 84 acciones permanecen en el barrel post-cada-round.
2. **networkBackend.ts ↔ geminiBackend.ts cycle**: `networkBackend.ts:3` importa `autoConnectNodes` y `geminiBackend.ts:2699` re-exporta `networkBackend.js` — fix atómico R22 cambiando el import a `./gemini/classify.js` y el `vi.mock` en `networkBackend.test.ts:131`.
3. **IPER doctrine drift**: `criticidad` MUST estar ausente de prompts/schemas (Ley 16.744 / DS 40 / DS 54). Comments en L229, L714, L1289, L2197 enforcean hoy; archivos más chicos abren surface a accidental reintroduction. Mitigación: regression test per-módulo + JSDoc top-of-file.

### IPv6 keyGenerator fix (B4)

Commit `123d698`. Cierra R6 R20 MEDIUM #2.

`src/server/middleware/limiters.ts`: `import rateLimit, { ipKeyGenerator } from 'express-rate-limit'` reemplaza el bare `req.ip`. Cuatro keyGenerators rewired — `geminiLimiter`, `invoiceStatusLimiter`, `webauthnVerifyLimiter`, `webauthnRegisterLimiter` — todos con el patrón `(req as any).user?.uid || ipKeyGenerator(req.ip ?? '') || 'anonymous'`. `refereeLimiter` usa default keyGenerator (ya IPv6-safe).

Suprime el warning `ERR_ERL_KEY_GEN_IPV6` introducido por `express-rate-limit ≥7.5`. El bare `req.ip` era unsafe — un IPv6 `/128` se veía único al limiter, peers podían bypass per-IP buckets. La sanity test de IPv6 verifica que las nuevas keys son strings válidos (no throw, no undefined).

`src/__tests__/server/limiters.test.ts` (NEW, 116 LOC, 6 tests): `ipKeyGenerator` IPv6 `::1` + `2001:db8::1` → string válido; IPv4 fallback works; ANY de los 5 limiters mount sin `ERR_ERL_KEY_GEN_IPV6`; per-uid override prefiere `req.user.uid`.

### Docs sweep (B5)

Commit `123d698` (mismo que B4). Tres deltas docs sin cambios runtime.

- `.env.example` (+5 LOC): `MP_OIDC_CLOCK_TOLERANCE_SEC` documentada con bloque de 3 líneas (default 0 strict, 30-120 NTP-drift, replay window warning), ubicada adyacente a `MP_IPN_SECRET`.
- `AUDIT.md` (+42 LOC): nueva sección "Known harness behaviour: working-tree revert pattern (R14-R20)" — symptom (Edit/Write success pero file reverts mid-session), incidence log (R14 R3, R15 I5, R16 R1/R3/R4, R17 R3, R18, R20 A3+A5), hipótesis (sandbox/checkpoint behaviour, Windows FS caching, race), playbook de 6 pasos: `git status` post-Edit, `git diff --stat` en report, Read tool re-verify, NEVER `git stash`, `EnterWorktree` para high-stakes, re-apply on revert detection. Confirmed safe patterns: 4-step verification 100% recovery rate.
- `STRYKER_BASELINE.md`: nota de side-effect del `ArrayDeclaration` global exclusion sobre las tables reba (B2 finding).

## Métricas

- `tsc`: 0 errors.
- `vitest`: **1719 passed + 66 skipped = 1785 total** (+263 sobre R20 en universo total). Skips son flaky `vi.useFakeTimers` window-resets.
- Stryker global: **85.52%** (+0.57pp). Break threshold: **65** mantenido.
- `server.ts`: **457 LOC** (-141 R21; cumulative R12-R21: -86%, -2785 LOC).
- Test files: 86.

## Cumulative R12-R21

- Tests: ~600 → 1719 passed (+186%).
- `server.ts`: 3242 → 457 LOC (-86%).
- 14 route modules + 2 trigger modules extraídos.
- Stryker global 85.52%, break 65.
- 86 test files.

## Round 21 incidents

- **B1 worktree isolation**: la extracción Phase 5 logró completar sin watchdog stall, lección aprendida del A1 R20 aplicada exitosamente (`EnterWorktree` para refactors estructurales high-stakes).
- **Orchestrator pwd confusion mid-round**: el orchestrator quedó dentro del worktree dir post-B1 y por un momento creyó (falsamente) que el work de B2/B3/B4/B5 se había perdido. Recovery: `cd` al main, `git log` confirmó los 4 commits intactos. ALL R21 work survived. B6 documentó como process improvement: orchestrator MUST `cd <project-root>` después de que un worktree-isolated agent termina, antes de evaluar status.

## Round 22 plan priorizado

1. **Reba boundary tests** trunk/neck/upperArm extension paths + validation `NoCoverage` 5 throws → target ≥80% para break ratchet 65→70.
2. **B1 Phase 5 cleanup** (M1 Reviewer): `setInterval` de 10 min `updateGlobalEnvironmentalContext` → trigger module + cleanup en SIGTERM (asymmetry vs B1 contract).
3. **B3 execution kickoff**: gemini split start (3-5 modules per round, R22-R26) — empezar por `_shared` + `embeddings` + `classify` (resuelve cycle networkBackend en el mismo round).
4. `.gitignore` `.claude/` (N1 Reviewer).
5. `BackgroundTriggersDeps.geminiApiKey` unused field cleanup (M2 Reviewer).
6. `jose` 6.x major bump prep (currently 5.10.0 direct dep desde A5 R20).
7. `rula.ts` remaining 4 EqualityOperator + 7 BooleanLiteral mutants.
8. `*Assessments` crypto + metadata coverage.

## Round 23+ deferred

- gemini split completion (R23-R26 — 4 rondas restantes per phased plan).
- SOC 2 Type I path kickoff (compliance/* docs only, sin código).
- Marketplace assets.
- HR / Mutual / Regulator dashboard differentiator.
- Real production deploy vía Cloud Run (`terraform apply` pendiente vos).

## Por qué importa

R21 marca el momento en que `server.ts` se acerca a su forma final como bootstrap-only: 457 LOC, una caída acumulada de **-86%** desde R12 (3242 LOC). Lo que queda son imports, app bootstrap, route mounting y graceful shutdown — la lógica de dominio vive en 14 route modules + 2 trigger modules. La consecuencia operacional es directa: cada nuevo endpoint o trigger entra por una superficie chica y testeable, no por mutación del entrypoint. El handler `SIGTERM` con `unsubscribe()` + `stop()` cierra una clase de bug que en Cloud Run habría manifestado como subscriptions colgadas durante deploys.

La extracción Phase 5 vía `EnterWorktree` validó un patrón operativo. El intento R20 main-tree colgó el watchdog a los 600s; el R21 worktree completó pre-pass en 75s y mergea limpio. Es el primer refactor estructural que probó el isolation pattern, y el trade-off (un nuevo failure mode: orchestrator pwd drift) ya quedó capturado en AUDIT.md y resuelto con disciplina post-worktree.

`docs/gemini-split-plan.md` es el último gran refactor estructural antes del production deploy. Con `geminiBackend.ts` partido en 18 módulos (R22-R26) y los riesgos de cycle / dynamic-import / IPER doctrine drift mitigados por test antes de cada round, el repo entra a R22 con: (i) entrypoint chico, (ii) Stryker 85.52% global con break 65, (iii) suite vitest cerca de 1800 tests, y (iv) plan operativo para los siguientes cinco rounds. Es la madurez que se necesita antes de `terraform apply`.

## Revert pattern lesson v4

Worktree isolation (B1) sirvió perfectamente — pero introdujo una nueva clase de error: orchestrator pwd drift. La falsa alarma R21 se atrapó rápido porque el B6 Reviewer corrió `git diff` directo sobre el HEAD verdadero (`123d698`) y vio los 4 commits + las 12 files con +2204 inserciones. Mitigación operativa: el orchestrator SIEMPRE `cd <project-root>` después de que un worktree-isolated agent termina, y antes de cualquier comando de status. El playbook AUDIT.md a extender en R22 con esta lección — la sección "revert pattern" agrega un séptimo paso "post-worktree pwd-reset" sobre los 6 actuales.
