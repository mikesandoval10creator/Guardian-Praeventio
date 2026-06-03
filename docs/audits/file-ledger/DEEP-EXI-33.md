# DEEP-EXI-33 — Lote #33 (I-DOCS) · slice [55:110]

**Categoría:** `I-DOCS` (filtrada de `docs/audits/file-ledger/ledger.json`, ordenada por `path`).
**Universo I-DOCS:** 185 docs · **Slice auditado:** índices [55:110] = **55 docs**.
**Método:** lectura completa línea-por-línea + verificación code-first (`file:line`, `grep`, conteos reales).
**Regla:** el código es la verdad. Snapshots fechados/archivados se evalúan con criterio histórico (drift
esperado ≠ drift de runbook vivo). No se repite `DEEP-I-DOCS.md` ni `DEEP-EXI-32.md`.

## Atestación 55/55

Los 55 docs del slice fueron leídos en su totalidad (los `.md` íntegros; los artefactos
`.json`/`.yaml` de observabilidad verificados estructuralmente contra su doc-espejo). Todas las
afirmaciones técnicas verificables fueron contrastadas contra el código en HEAD.

---

## Hallazgos de doc-drift

| Doc:línea | Severidad | Drift | Evidencia |
|---|---|---|---|
| `docs/photogrammetry-deploy.md` (todo el doc) | 🔴 | **Runbook obsoleto y contradicho por directiva inviolable.** Documenta como procedimiento vivo el despliegue de un worker COLMAP en Cloud Run para fotogrametría server-side. Esa arquitectura fue **DESCARTADA** (§2.28, on-device-only) y está **bloqueada por test de contrato en CI**. | `src/__tests__/contracts/noServerSidePhotogrammetry.test.ts:1-26` (directiva §2.28, prohíbe `cloud-run/photogrammetry-worker/`, `colmapAdapter.ts`, `PHOTOGRAMMETRY_WORKER_*`); el doc cita `colmapAdapter.ts` + `ColmapAdapter.fromEnv()` que **no existen** (dir real: `onDeviceAdapter.ts`, `mockAdapter.ts`, `reconstructionJobStore.ts`); reemplazo real `src/services/digitalTwin/onDeviceReconstruction/` + `OnDeviceReconstructionAdapter` (`engine='on-device-webxr'`). |
| `docs/photogrammetry-modal.md` (todo el doc) | 🔴 | **Runbook obsoleto y contradicho.** Documenta despliegue de worker GPU en Modal.run (Meshroom). DESCARTADO por §2.28; el test de contrato prohíbe `modalAdapter.ts`, `MODAL_SUBMIT_URL/STATUS/TOKEN`. | `noServerSidePhotogrammetry.test.ts` (banea Modal); `find src -name "modalAdapter*"` → vacío; `src/pages/DigitalTwinFaena.tsx:350` "Reemplazamos el polling vía `/api/photogrammetry/jobs` (descartado)". `infra/modal-photogrammetry/app.py` sigue en disco (straggler de infra, no en scope del test). |
| `docs/COWORK_REQUIREMENTS.md:56` (item **D1**) | 🔴 | Lista como pendiente vivo "Deploy COLMAP worker (Cloud Run)" y afirma "El worker ya existe en `cloud-run/photogrammetry-worker/` (325 LOC reales); falta deployarlo". Contradice §2.28 y la ruta `cloud-run/` no existe. | `ls cloud-run/` → no existe; `noServerSidePhotogrammetry.test.ts` (banea esa ruta); `src/server/routes/photogrammetry.ts` eliminado. |
| `docs/gemini-split-plan.md:1-11, 19, 28-35` | 🟡 | Declara `Status: scope-discovery only … R22+ executes`, `geminiBackend.ts … 2701 LOC`, `60 direct exports`. **El split YA se ejecutó.** | Real: `src/services/gemini/` existe con 12 módulos + test files (`risk/vision/chat/embeddings/emergency/governance/operations/parsing/personPlans/pii/safetyDocs/suggestions`, nombres distintos a los planeados); `wc -l geminiBackend.ts` = **1466** (no 2701); 28 exports directos (no 60). `ALLOWED_GEMINI_ACTIONS` sigue en 84 (estable). El doc nunca se actualizó tras la ejecución. |
| `docs/i18n-coverage.md:7, 13-15` | 🟡 | Line counts muy desactualizados: dice `es`=1158, `en`=1158, `pt-BR`=1158. | Real: `es/common.json`=**2962**, `en`=**2975**, `pt-BR`=**2902** (≈2.5×). |
| `docs/i18n-coverage.md:16-24, 52-59` | 🟡 | Tabla de locales + snippet `lazyLoaders` listan solo 6 lazy locales (fr,de,it,ja,zh-CN,ar). | Real: `src/i18n/index.ts:67-76` tiene **10** lazy loaders (añade ko, hi, zh-TW, ru); 16 dirs en `src/i18n/locales/`. Doc omite ko/hi/zh-TW/ru (sí documentados en CLAUDE.md). |
| `docs/mobile-build-runbook.md:4` (Status) | 🟡 | "Native folders (`android/`, `ios/`) are NOT generated yet". | Real: `android/` y `ios/App/` existen (mobile-signing-runbook §2.1 instruye commitearlas). |
| `docs/mobile-build-runbook.md:252-260` (§6.5) | 🟡 | "iOS deferral (still active) … The `Fastfile` will gain a `platform :ios` block when iOS automation is activated". | Superseded por Sprint 30: `ios/App/fastlane/Fastfile:39 platform :ios` con lanes `build_only`(60)/`testflight`(71)/`appstore`(88). mobile-signing-runbook ya documenta el pipeline iOS completo. |
| `docs/dte-sii.md:8-21` | 🔵 | Presenta Bsale como "el PSE" y Defontana como única alternativa. El código soporta 4 PSEs vía `SII_PSE`. | `src/services/sii/index.ts:39-44` `SII_PSE_KEYS` = {openfactura, simpleapi, bsale, libredte}; adapters `libredteAdapter.ts`/`openfacturaAdapter.ts`/`simpleApiAdapter.ts` presentes. Doc subdimensiona la cobertura. |
| `docs/observability/INDEX.md:36, 49, 51` | 🔵 | Cita `geminiBackend.ts:34-39` para el breadcrumb `pii.redaction` y `withSentryScope('gemini',…)` en `geminiBackend.ts`. Tras el split, esa lógica migró a `src/services/gemini/*` (p.ej. `risk.ts:59`) y `geminiBackend.ts` solo importa el helper. Line-refs viejos. | `grep withSentryScope src/services/geminiBackend.ts` → solo `:6 import`; lógica en `src/services/gemini/risk.ts:59,162,243`. `redactPii` sí en `src/lib/sentry.ts:16` (OK). |
| `docs/privacy-compliance-matrix.md` (tabla por país) | 🔵 | Documenta 9 regímenes; el registry implementa más (no listados): 152fz-ru, pipa-tw, pipl-cn. Doc subdimensiona. | `src/services/privacy/regimes/` = 11 archivos (incl. 152fz-ru, pipa-tw, pipl-cn); maquinaria toda existe (`getActiveRegimes`, `strictestDeadlineDays`, `generateDpiaPdf`) bajo `src/services/privacy/` (NO `src/services/compliance/` como podría inferirse). |
| `docs/dev-workflow/DESIGN_HTML_PATTERN.md:63` | 🔵 | Cheat-sheet referencia `src/contexts/UxModeContext` y `<DrivingModeProvider>`. | Real: el contexto es `src/contexts/AppModeContext.tsx`; no existe `UxModeContext` ni export `DrivingModeProvider`. Tokens de paleta (#4db6ac/#d4af37/#061f2d/#b66258) sí verifican en `src/index.css:12-48`. |
| `docs/dev-workflow/SAFETY_PATTERNS.md:96-99` | 🔵 | Nombra "path SOS (notify-brigada, sosFlow, panicHandler, brigadaRouter)" como rutas concretas. Ninguna existe con ese nombre. | `find src` por esos nombres → vacío. Son ejemplos ilustrativos, no rutas reales; comandos/hook (`.claude/commands/*`, `scripts/check-frozen.cjs`, `.claude/settings.json` PreToolUse) sí verifican. |
| `docs/mcp/README.md:56-62` | 🔵 | Instruye `npm run build:mcp`; el script no existe (el doc se cubre con "Si todavía no existe el script…"). | `grep build:mcp package.json` → vacío. Auto-hedged, no engañoso. Resto del doc (tools `zk.getNode/listNodes/expandSubgraph`, `MCP_TOOLS`, archivos) verifica. |
| `docs/audits/DIGITAL_TWIN_LINGBOT_MAP_REVIEW_2026-05-07.md` (todo) | 🔵 | Snapshot fechado que presenta la ruta COLMAP-on-Cloud-Run + `/api/photogrammetry/jobs` + `cloud-run/photogrammetry-worker/src/index.ts` como el plan forward "honesto para ventas". Toda superseded por §2.28. | Mismo cluster que los 🔴 de fotogrametría; severidad baja por ser audit fechado, pero ya no debe usarse como guía de mensajería comercial. |

---

## Docs limpios (sin drift material): conteo

**42 / 55 limpios** (verificados contra código, sin discrepancias accionables):

- **Integración/runbooks vivos verificados OK:** `billing-iap.md` (rutas validate-receipt + webhook/apple + SKUs 9.990/95.904 ✓), `dte-sii.md` (salvo 🔵 PSE), `email-flows.md` (`resendService.ts`+`EmailService.fromEnv`+endpoints admin ✓), `offline-sync.md` (`syncStateMachine.ts`, 10 tests, MAX_ATTEMPTS=6, endpoints admin ✓), `firestore-indexes.md` (hooks/jobs/`firestore.indexes.json` ✓), `deep-linking-runbook.md` (well-known files, DeepLinkHandler, ADRs ✓), `mobile-signing-runbook.md` (13 secrets, Fastfiles iOS+Android, ADR 0009/0006 ✓), `dwg-converter-deploy.md` (cad.ts route, LibreDWG 0.13.3 = Dockerfile, ADR 0008 ✓), `mcp/README.md` (salvo 🔵 build:mcp), `medical-catalogs.md` (73/68/50 entradas ≈ ~70/~70/~50 ✓, CatalogBrowser ✓), `reports-cl.md` (DS109/67/76 generators + `susesoApiClient.ts` submit Diat/Diep/Roi ✓), `coach-domain.md` (coach/ módulos ✓; ergonomiaBackend es ejemplo, no claim).
- **Cumplimiento verificado OK:** `compliance/LEY_19628.md` (`PROCESSING_ACTIVITIES`, endpoints `compliance/*`, `CONSENT_TEXT_VERSION='consent_v1.0'`, `eraseUserData(keepLegalRecords)` ✓), `privacy-compliance-matrix.md` (salvo 🔵 subconteo).
- **Observabilidad (excelente sincronía):** `observability/SENTRY_ALERTS.md` + `sentry-alerts.yaml` (14 IDs en espejo 1:1 exacto; 4 P0/5 P1/3 P2/2 P3), `SENTRY_DASHBOARDS.md` (3 dashboards/16 widgets ✓), `dashboard-praeventio-overview.json` (esqueleto declarado placeholder), `observability/INDEX.md` (cross-links a runbooks/security ✓, salvo 🔵 line-refs gemini). Señales SLM (`hmac_mismatch`/`unsigned_legacy`/`hmac_verify_error`) existen en `src/services/slm/`.
- **Dev-workflow:** `SAFETY_PATTERNS.md`/`DESIGN_HTML_PATTERN.md` (estructura/hook/comandos/template/paleta OK, salvo 🔵 nombres ilustrativos/contexto).
- **mobile-build-runbook.md** resto del doc (prereqs, plugins matrix, HealthKit/Health Connect, §6 Android, §6.4 Gemfile.lock TODO aún válido) OK — solo el Status header y §6.5 driftearon.
- **Snapshots históricos correctamente fechados/marcados (drift esperado, NO accionable):** `archive/2026-05/{PROTO_ARCHAEOLOGY, README, ROADMAP, ROADMAP_2026-05 (SUPERSEDED marcado), SKILL_ROUTING_2026-05-04, STATE_OF_FUNCTIONALITY_2026-05-04 (DEPRECATED marcado), STRYKER_BASELINE, TECHNICAL_DEBT_AUDIT, VERTEX_MIGRATION}.md`, `archive/README.md`, `audit/{auditoria777, auditoria777-parte2, PENDING_AFTER_SPRINT_19}.md`, `audits/{AUDIT_2026-05-05_FULL, AUDIT_BACKLOG, AUDIT_CODEX_2026-05-07, AUDIT_TRUTH_MATRIX_2026-05-07, COMPONENTS_TRIAGE, CONTEXT_AUDIT_2026-06, DOCS_RECONCILIATION_2026-05-05, HOOKS_TRIAGE, PRAEVENTIO_HONEST_STATE_2026-05-05, SERVICES_TRIAGE}.md`, `proto/{analisis_funcional, auditoria01}.md`, `master-plan-end-to-end.md`, `medical-icons-generation-prompt.md`.

> **Nota sobre snapshots:** los triage (HOOKS_TRIAGE "96/113 hooks" vs 236 reales hoy; COMPONENTS/SERVICES) y los STATE/AUDIT fechados reportan métricas viejas, pero todos llevan fecha explícita y/o marca SUPERSEDED/DEPRECATED/recuperado-de-prototipo y la convención de `docs/archive/README.md` los declara no-autoritativos (la verdad viva es `TODO.md`). No se cuentan como drift accionable. Excepción de mención: `PRAEVENTIO_HONEST_STATE_2026-05-05.md` se autodenomina "nueva fuente de verdad" — contradice a `TODO.md` como SSoT, pero es snapshot fechado ya superseded por `CONTEXT_AUDIT_2026-06`.

---

## Resumen

- **Severidad:** 🔴 ×3, 🟡 ×5, 🔵 ×6. **Limpios:** 42/55.
- **Cluster crítico (🔴):** los tres docs de fotogrametría server-side (`photogrammetry-deploy.md`, `photogrammetry-modal.md`, `COWORK_REQUIREMENTS.md` D1) documentan/prometen una arquitectura COLMAP/Modal en Cloud Run que fue **descartada por directiva §2.28 (on-device-only) y está bloqueada en CI** por `noServerSidePhotogrammetry.test.ts`. Promesas de despliegue no respaldadas y rutas/archivos inexistentes (`cloud-run/photogrammetry-worker/`, `colmapAdapter.ts`).
- **Drift de "scope-discovery → ejecutado" (🟡):** `gemini-split-plan.md` quedó congelado pre-ejecución; el split a `src/services/gemini/*` ya ocurrió (1466 LOC, 12 módulos).
- **Drift de métricas viejas (🟡):** i18n line-counts (1158 → ~2900) y locale list (6 → 10 lazy); mobile-build-runbook status header + §6.5 iOS-deferral superseded por Sprint 30.
- **Lo mejor:** la suite de observabilidad (`SENTRY_ALERTS.md`/`sentry-alerts.yaml`/`SENTRY_DASHBOARDS.md`/`INDEX.md`) está en sincronía 1:1 ejemplar con el código y entre sí.
- **Doc-only. NO commit.**
