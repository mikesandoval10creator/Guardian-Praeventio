# DEEP-EXI-35 — Auditoría línea-por-línea, Lote #35 (I-DOCS, slice [165:185])

**Atestación: 20/20 archivos leídos completos, línea por línea.**

Categoría `I-DOCS` del ledger (`docs/audits/file-ledger/ledger.json`, total 185
entradas), ordenada por `path`, slice `[165:185]`. Cada doc fue verificado
contra el código vivo (rutas, scripts npm, archivos de servicio, conteos,
firestore.rules, runbooks). Continúa la cobertura de `DEEP-I-DOCS.md` y
`DEEP-EXI-32/33/34.md` sin repetir hallazgos.

Severidades: 🔴 alta (compliance / promesa falsa material) · 🟡 media (drift
verificable que confunde a quien siga el doc) · 🔵 baja (link/path obsoleto,
naming, incompletitud menor).

---

## Hallazgos

| Doc:línea | Severidad | Drift | Evidencia |
|---|---|---|---|
| `docs/tracking/TRACKING_PLAN.md:3,4` | 🔴 | Header dice **"Status: design (not implemented)"** y "This is a *plan*, not code… no events are emitted". Falso: la capa de analytics ya está implementada. | `src/services/analytics/` existe con `adapter.ts` (320 LOC), `index.ts`, `queue.ts`, `serverAdapter.ts` (400 LOC), `sinks.ts`, `types.ts` (822 LOC) — 3457 LOC totales. `index.ts` documenta "ninth wave / 15th wave, Bucket D". |
| `docs/tracking/TRACKING_PLAN.md:60,235-247` | 🔴 | §3 tabla de cadena: fila **"Implement \| typed wrapper bajo `src/services/analytics/` \| Open"**, y §11 "Implementation handoff" descrito como trabajo futuro. Ya ejecutado. | `src/services/analytics/index.ts` construye singleton `analytics` (sentry-breadcrumb + console sink) y exporta `serverAnalytics`. Riesgo compliance: el doc gobierna redacción PII / retención y se presenta como no-vigente. |
| `marketplace/scope-justifications.md:5,87` | 🟡 | Call-sites citados como `server.ts lines 578-583` (Calendar/Fit OAuth), `server.ts line 944` (Drive), `server.ts:580-582` (Fit legacy) — todos incorrectos tras el split de `server.ts`. | `server.ts` ahora 1500 LOC; líneas 578-583 son comentarios de middleware de logging, línea 944 es `app.use('/api/incidents', …)`. Las rutas OAuth Google (`/api/fitness/sync`, scopes Fit/Drive) se extrajeron a `src/server/routes/oauthGoogle.ts` (ver `server.ts:880`). Viola convención #7 (server.ts split). |
| `security_spec.md:120-121` | 🟡 | Cierre: "Test Runner (firestore.rules.test.ts) — *placeholder for the logic that would be tested*". Stale: es una suite real y extensa. | `src/rules-tests/firestore.rules.test.ts` = **1649 LOC**, `describe('firestore.rules', …)` con docenas de `it(...)`. Hay 4 archivos `*.rules.test.ts` en `src/rules-tests/`. |
| `security_spec.md:86,88` | 🟡 | Sección Sprint-K dice "**13** colecciones `createProjectScopedStore`". El source-of-truth (`TODO.md §17`) dice "**14** stores" y además "el fix… quedó incompleto; faltan ≥20". Conteo subestimado. | `TODO.md:1028` ("fix de §17 (14 colecciones)… faltan ≥20"), `TODO.md:1898` ("🔴🔴 HALLAZGO CRÍTICO — 14 stores client-SDK sin write rules"). |
| `infrastructure/terraform/README.md:149` | 🟡 | Link `../../docs/KMS_ROTATION.md` está roto: resuelve a `docs/KMS_ROTATION.md`, inexistente. El runbook vive en raíz (`KMS_ROTATION.md`) y en `docs/runbooks/KMS_ROTATION.md`. | `ls docs/KMS_ROTATION.md` → No such file. Existen `./KMS_ROTATION.md` y `./docs/runbooks/KMS_ROTATION.md`. |
| `infrastructure/terraform/README.md:150` | 🟡 | Link `../../docs/DR_RUNBOOK.md` roto: el archivo vive en raíz (`DR_RUNBOOK.md`), no bajo `docs/`. | `ls docs/DR_RUNBOOK.md` → No such file; `./DR_RUNBOOK.md` sí existe. |
| `public/posters/README.md:38-40` | 🟡 | Instruye "run the embedding seed script: `npm run seed:posters`". No existe tal script npm; el flujo real es la página `/dev/poster-seeder` (browser flow). | `grep '"seed:posters"' package.json` → ninguno. `scripts/seed-poster-embeddings.md` documenta solo el browser flow (`/dev/poster-seeder`) + verificación con `npx vitest`. |
| `docs/usdz-converter-deploy.md:77,107` | 🔵 | "Generate the **17** production USDZs" como si estuvieran listos; solo 4 `.usdz` existen hoy (acción de deploy pendiente, no estática). | `public/models/ar/*.glb` = 17 (✓), pero `*.usdz` = 4 (`aed`, `extinguisher_pqs`, `first_aid_kit`, `hydrant`). |
| `docs/webxr-ar.md:85-90` | 🔵 | Troubleshooting referencia GLB en `/public/models/{kind}.glb`; los GLB reales viven en `public/models/ar/`. Path distinto. ARObjectOverlay aún usa primitivos (consistente). | `ls public/models/ar/*.glb` = 17; `ARObjectOverlay.tsx:57-61` `buildPreviewMesh()` aún genera primitivos ("Por ahora solo primitivos"). |
| `marketplace/listing-copy.md:110` | 🔵 | Referencia runbook `VERTEX_MIGRATION.md` como vigente en raíz; está archivado. (El adapter Vertex en sí es real, así que la *feature* sí está respaldada.) | `find VERTEX_MIGRATION.md` → solo `docs/archive/2026-05/VERTEX_MIGRATION.md`. `src/services/ai/vertexAdapter.ts` cabecera: "real implementation" (no stub). |
| `marketplace/scope-justifications.md:97,107` | 🔵 | Referencia `IMPACTO.md` y `VERTEX_MIGRATION.md` como vivos; ambos archivados a `docs/archive/2026-05/`. | `find IMPACTO.md` → solo `docs/archive/2026-05/IMPACTO.md`. |
| `tasks/plan-epp-vision.md:7` | 🔵 | Plan nombra la función `detectEPPWithVision(base64Image)`; lo que se envió es `verifyEPPWithAI(base64Image, workerName, requiredEPP)`. Naming drift en plan aspiracional. | `src/services/geminiService.ts:105` exporta `verifyEPPWithAI`; `AIEPPScannerModal.tsx:4,43` la importa y usa. Patrón (catálogo en prompt) sí se cumplió. |

---

## Limpios (sin drift material) — 7/20

- `docs/testing/SOS_LOAD_TEST.md` — `loadtest/` (run.sh, Dockerfile, sos-1000-concurrent.yml, sos-processor.cjs, seed-and-assert.cjs), `.github/workflows/loadtest.yml` (workflow_dispatch), y `loadtest:sos` en package.json: todo verificado y vigente.
- `docs/testing/playwright.md` — `tests/e2e/*.spec.ts`, `playwright.config.ts` (4 projects: chromium/mobile-android/firefox/webkit), `.github/workflows/e2e.yml`, scripts `test:e2e*`, fixture `auth.ts`: todo presente. (Lista de specs lev. desactualizada — hoy hay 9 specs y los "skip Sprint 19" se resolvieron vía `E2E_FULL_STACK` gating; cosmético, no tabulado.)
- `docs/tracking/event-catalog.md` — 46 eventos, 12 superficies, tally por clase (lifecycle 23/engagement 10/safety_critical 9/commerce 4) cuadra; cardinalidad coincide con `.telemetry/proposed-events.yaml` (46) y con `src/services/analytics/types.ts` (46 nombres idénticos).
- `docs/tracking/property-glossary.md` — refs a `pricing/tiers.ts`, `slm/registry.ts`, `emergency/autoTrigger.ts`, `protocols/`, `normativa/` verificadas; sin propiedad PII `medium`/`high`.
- `marketplace/assets-spec.md` — spec de diseño "out of code scope"; refs a `manifest.json` y `oauth-consent-screen.md` válidas; assets aún no producidos (consistente).
- `marketplace/oauth-consent-screen.md` — refs a manifest / assets-spec / scope-justifications válidas; dominios `praeventio.net`/`.cl` consistentes con manifest (`praeventio.net`).
- `public/models/README.md`, `scripts/seed-poster-embeddings.md` (parcial), `templates/design-html-shell.html`, `tasks/lessons.md`, `tasks/plan-pts-grounding.md` — `prePackagedPath` en registry, `tryCreateMidasEstimator`, 8 IDs de poster (idénticos), `posterCatalog/Matcher`, `DevPosterSeeder` + ruta `dev/poster-seeder`, `generatePTSWithManufacturerData` + `PTSGenerator.tsx`, y tokens de diseño del shell (teal #4db6ac / petroleum #061f2d / gold #d4af37 / coral #b66258) que reflejan fielmente `src/index.css @theme`: todo verificado.

*Pricing en `listing-copy.md` (11990/30990/50990/90990/249990/499990/1499990/2999990/5999990) coincide exacto con `src/services/pricing/tiers.ts`. El header Sunset RFC8594 de `/api/fitness/sync` que cita scope-justifications SÍ se emite (`oauthGoogle.ts:278`).*

---

## Resumen

Lote final I-DOCS limpio en lo esencial: 7/20 docs sin drift y la mayoría de
claims técnicos (pricing, eventos, tokens de diseño, scopes OAuth, posters,
loadtest, e2e) se verifican contra el código. Los dos hallazgos 🔴 son del par
de tracking: `TRACKING_PLAN.md` se sigue presentando como "design (not
implemented)" mientras `src/services/analytics/` ya está implementado en ~3.5k
LOC (waves 9-15) — material porque ese doc gobierna redacción PII y retención.
El patrón 🟡 dominante es **drift post-split de `server.ts`**:
`scope-justifications.md` cita líneas de `server.ts` que ya no existen (rutas
OAuth movidas a `src/server/routes/oauthGoogle.ts`), y `security_spec.md` aún
llama "placeholder" a una suite de reglas de 1649 LOC y subestima el conteo de
stores (13 vs 14+≥20 según `TODO.md §17`). Lo demás es link-rot (runbooks
movidos a raíz o a `docs/archive/2026-05/`), un `npm run seed:posters`
inexistente, y naming aspiracional en planes de tasks. Doc-only, sin commit.
