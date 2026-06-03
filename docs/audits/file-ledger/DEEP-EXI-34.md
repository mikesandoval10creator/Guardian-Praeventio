# DEEP-EXI-34 — I-DOCS Lote #34 (slice [110:165]) · 2026-06-03

**Atestación: 55/55** documentos del ledger `category==="I-DOCS"`, ordenados por
`path`, slice `[110:165]`. Cada doc leído línea por línea + verificación
dirigida doc-vs-código (`file:line`, existencia de scripts/dirs/endpoints,
LOC reales, wiring de providers/CI).

No repite hallazgos ya cubiertos en `DEEP-I-DOCS.md` (D1 ARCHITECTURE LOC, D2
mesh-stub, D3 runbooks/photogrammetry-deploy) salvo nota de "sigue sin fix".
`DEEP-EXI-32/33.md` no existen en el repo → sin riesgo de solapamiento.

Leyenda severidad: 🔴 drift que puede inducir acción incorrecta / claim de
cumplimiento falso · 🟡 drift de referencia (file:line/LOC/conteo) que confunde
pero no rompe · 🔵 nota menor / obsoleto-pero-etiquetado.

---

## Hallazgos

| Doc:línea | Sev | Drift | Evidencia |
|---|---|---|---|
| `docs/stubs-inventory.md:51-59` | 🔴 | "SystemEngineProvider orphan (no mounted)" — afirma "provider definido pero `AppProviders.tsx` no lo envuelve" + blocker "no existe fuente client-side de tenantId". **Ambos falsos hoy.** | `src/providers/AppProviders.tsx:14,140-145` monta `<SystemEngineProvider tenantId={engineTenantId} enabled={engineEnabled}>`; gateado por `VITE_SYSTEM_ENGINE_ENABLED` (`AppProviders.tsx:56-74`). El stub fue cableado pero el inventory nunca se actualizó. |
| `docs/photogrammetry-deploy.md:16-20,91,122` | 🔴 | Doc raíz describe arquitectura server-side COLMAP/Cloud Run y referencia el adapter TS `colmapAdapter.ts` (+ `.test.ts`) "wired into `DigitalTwinFaena.tsx`". **El adapter TS no existe.** | `src/services/digitalTwin/photogrammetry/` solo tiene `mockAdapter.ts` + `onDeviceAdapter.ts` + `reconstructionJobStore.ts` + `types.ts`. `DigitalTwinFaena.tsx:26,476` usa `createOnDeviceReconstructionAdapter()` exclusivamente. (La infra `infra/photogrammetry-worker/server.py` sí existe, pero ya no hay wiring TS — el módulo pasó a on-device.) |
| `docs/photogrammetry-modal.md:8,78,135,143` | 🔴 | Mismo patrón: describe selección GPU/CPU vía `ModalAdapter.fromEnv()`/`ColmapAdapter.fromEnv()` y referencia `modalAdapter.ts` + `modalAdapter.test.ts`. **No existen.** | Solo `onDeviceAdapter.ts`. `DigitalTwinFaena.tsx` ya no inspecciona env `MODAL_*`/`COLMAP_*` ni hace fallback CPU/GPU; reconstrucción es 100% on-device. (Doc-drift distinto del flagged en DEEP-I-DOCS D3, que apuntaba a `runbooks/photogrammetry-deploy.md`; estos son los dos docs raíz.) |
| `docs/observability/INDEX.md:49,51` | 🔴 | Afirma `pii.redaction` breadcrumb en `geminiBackend.ts:34-39` y `withSentryScope('gemini',…)` en `geminiBackend.ts`. **Tras el split, ninguna de esas señales vive ya en `geminiBackend.ts`.** | `grep` de `pii.redaction` y `withSentryScope('gemini'` en `geminiBackend.ts` = 0. Las señales migraron a `src/services/gemini/{operations,chat,risk,pii,_shared}.ts`. Path + line stale. |
| `docs/security/STRIDE_findings.md:34` | 🔴 | TM-I03 afirma redactor PII "wired en `src/services/geminiBackend.ts` via `redactPromptForVertex`". Mismo split obsoleto. | El seam de redacción de prompts vive en `src/services/gemini/pii.ts` (y consumido en `operations.ts`/`chat.ts`/`risk.ts`). `geminiBackend.ts` ya no es el seam centralizado descrito. |
| `docs/security/THREAT_MODEL.md:129` | 🟡 | `SESSION_SECRET` "boot fails… (`server.ts:231-243`)". | Real: `server.ts:753-761`. Drift ~+520 líneas (server.ts creció). Mitigación real, ref incorrecta. |
| `docs/security/THREAT_MODEL.md:202` | 🟡 | TM-T01 self-promote tier "diff-based deny at `firestore.rules:177-182`". | `firestore.rules:177-182` es `isValidProject` (schema de proyecto, no subscripción). El deny real de `subscriptionPlan` está en `firestore.rules:238-239`. |
| `docs/security/THREAT_MODEL.md:123` | 🟡 | Medical exams sub-collection "`firestore.rules:186-189`". | Real: `match /medical_exams/{examId}` en `firestore.rules:245`. |
| `docs/security/THREAT_MODEL.md:153-154` | 🟡 | audit_logs immutability "`firestore.rules:375-386`". | Real: bloque `audit_logs` en `firestore.rules:558`. (`firestore.rules` = 1182 LOC hoy → todas las refs de la familia 177/186/375 quedaron stale al crecer ~180%.) |
| `docs/security/THREAT_MODEL.md:219` | 🟡 | TM-I04 prod stack trace generic en `gemini.ts:323-330`. | Real: `'Internal server error'` en `src/server/routes/gemini.ts:371,457`. Mitigación real, ref stale. |
| `docs/testing/COVERAGE_BASELINE.md:96` | 🟡 | Lista `geminiBackend.ts (229, 0%)` como "top remaining non-UI lever". | `geminiBackend.ts` ya fue split a `src/services/gemini/*`; el conteo de líneas-sin-cubrir del monolito quedó stale (el grueso de la lógica ya no está ahí). |
| `docs/observability/SENTRY_DASHBOARDS.md` (+ `INDEX.md:20`) | 🟡 | Afirma "3 dashboards, **16 widgets totales**". | Conteo real de widget-ids distintos `W#.#` = **17** (SLM Health llega a `W2.7`). Off-by-one en el total. |
| `docs/mcp/README.md:58-62` | 🔵 | Instruye `npm run build:mcp` (con `tsconfig.mcp.json`). | Ni el script `build:mcp` ni `tsconfig.mcp.json` existen. El doc ya hedge ("Si todavía no existe el script… `tsx bin/mcp-server.mjs`"), y `bin/mcp-server.mjs` sí existe → degradado a 🔵 (auto-documentado). |
| `docs/mobile-build-runbook.md:256-260` (§6.5) | 🔵 | "El `Fastfile` ganará un bloque `platform :ios` cuando se active iOS." | El iOS Fastfile ya tiene `platform :ios` con lanes `build_only/testflight/appstore` (`ios/App/fastlane/Fastfile:39,60,71,88`); `mobile-signing-runbook.md` (Sprint 30) ya documenta los 8 secrets iOS. §6.5 quedó atrás respecto a su doc hermano. |
| `docs/mobile-signing-runbook.md:48-53` (§2.1) | 🔵 | "commits `ios/App/` + `ios/App.xcworkspace`". | `ios/App/` solo contiene `fastlane/` — el proyecto Xcode nativo (`*.xcodeproj`/`*.xcworkspace`) aún no fue generado/commiteado (esperado: requiere bootstrap macOS). El scaffold Fastlane existe; el proyecto nativo no. Consistente con el estado "inerte hasta secrets", anotado por completitud. |
| `docs/proto/analisis_funcional.md` · `docs/proto/auditoria01.md` | 🔵 | Describen arquitectura Cloud Functions ("Portal/Sentidos/Mente", `cloud-functions/src/*`, `firestore-utils.ts`) que el stack actual (Express monolito + `src/server/`) abandonó. | **No es violación**: ambos llevan banner línea 1 "recuperado del prototipo… valor histórico" y fecha de sanitización 2026-05-03. Correctamente etiquetados como históricos. |

---

## Limpios (verificados, sin drift accionable)

Conteo: **39/55** documentos sin hallazgos accionables tras verificación.

- `docs/medical-catalogs.md` — `src/data/medical/{diagnoses,drugs,anatomy}.json` + `index.ts` + test existen; `scripts/generate-medical-catalogs.mjs` ausente pero marcado `TODO Ola 5b` (honesto).
- `docs/offline-sync.md` — `syncStateMachine.ts` + 10 tests verificados; endpoints `/api/admin/sync/{clear-user-queue,stats}` en `admin.ts:625,664`.
- `docs/reports-cl.md` — los 5 generadores (`ds109/ds67/ds76`, `SusesoReports.tsx`, `susesoApiClient.ts`) existen.
- `docs/suseso-deadlines.md` — `sendSusesoReminders`, `SusesoDeadlineBadge`, `mark-submitted` (`suseso.ts:336`), `computeLegalDeadlines` verificados.
- `docs/slm-offline.md` — todos los archivos listados existen; `onnxAdapter.generate()` con loop real (`sampleGreedy/sampleNucleus`); guardianOffline 19 tests; "What's next: wire `useSlmOffline` en AsesorChat" honesto (`AsesorChat.tsx:3` lo deja como TODO).
- `docs/setup/google-maps-api-key.md` — `Site25DPanel.tsx` en `src/components/digital-twin/` (ref correcta).
- `docs/setup/medical-icons-generation.md` + `docs/medical-icons-generation-prompt.md` — `scripts/generate-medical-icons.mjs` + `iconLibrary.ts` + `MedicalIcon.tsx` existen.
- `docs/testing/MUTATION_BASELINE.md` / `MUTATION_TESTING.md` — `REDACT_KEYS` (`sentryInstrumentation.ts:157`), `shouldUseOffline` (`orchestrator.ts:74`), `isE2EModeEnabled` (`verifyAuth.ts:56`) existen; refs de línea con drift ≤25 líneas (no flagged — baseline snapshot fechado, naturaleza histórica).
- `docs/runbooks/TYPESCRIPT_STRICT_ROADMAP.md` — los 8 flags `✅ activado` calzan 1:1 con `tsconfig.json:29-36` (preciso). (Nota: el doc no afirma `"strict": true` global, y en efecto no está; usa flags individuales — consistente.)
- `docs/observability/SENTRY_ALERTS.md` ↔ `sentry-alerts.yaml` — paridad de ids 14:14; `dashboard-praeventio-overview.json` JSON válido; `sentry-alerts.yaml` YAML válido; todos los source files del Anexo A existen (sentry.ts, slm/reconciliation.ts, hmac.ts, webpayAdapter.ts, predictionBackend.ts, organic.ts, etc.).
- `docs/runbooks/{KMS_ROTATION,KMS_PROD_ACTIVATION,TRANSBANK,MERCADOPAGO,QUOTA,SCHEDULER_INVENTORY,SECRETS,DR,INCIDENT_RESPONSE,HEALTH,CLOUD_BUILD,CLIMATE_SCAN,PERFORMANCE,MOBILE_SIGNING,canary-monitoring}.md` — verificación spot: adapters billing (webpay/mercadopago/khipu) existen, `infrastructure/terraform/scheduler.tf` existe, KMS adapters (`cloud-kms`/`in-memory-dev`) + `KMS_KEY_RESOURCE_NAME` en `kmsPreflight.ts`. Sin claims de "activado/done" falsos detectados.
- `docs/security/{PGP_GENERATION,csp-policy,data-flow-diagram,incident-response,severity-rubric,PENTEST_CHECKLIST}.md` — `PENTEST_CHECKLIST` mapea correctamente a `src/rules-tests/dirtyDozen.test.ts`.
- `docs/master-plan-end-to-end.md`, `docs/sprints/{SPRINT_20_SPEC,EULER_INTEGRATION_SPEC}.md`, `sprint-20-architecture.{png,svg}` — specs/logs de sprint fechados 2026-05-04; naturaleza histórica de planificación (no claims operativos vigentes).
- `docs/privacy-compliance-matrix.md` — endpoints `compliance/*`, `getActiveRegimes`, `strictestDeadlineDays` existen (`compliance.ts:204,217,221`); estados HONESTOS (IMPLEMENTADO/DECLARADO/STUB) con brechas explícitas — doc ejemplar de "honestidad de cumplimiento".

---

## Patrón sistémico

El cluster 🔴/🟡 dominante es **post-split staleness de `geminiBackend.ts`**:
INDEX.md, STRIDE_findings.md y COVERAGE_BASELINE.md siguen apuntando al
monolito `geminiBackend.ts` para señales/cobertura que migraron a
`src/services/gemini/*`. Segundo cluster: **THREAT_MODEL.md line-refs a
`firestore.rules`/`server.ts`** desfasadas por el crecimiento de ambos
archivos (rules 1182 LOC, server.ts >750 para SESSION_SECRET). Tercer cluster:
**digital-twin pasó a on-device** y dos docs raíz de photogrammetry
(deploy/modal) describen adapters TS server-side ya eliminados. Las
mitigaciones de seguridad subyacentes son reales en todos los casos; el riesgo
es de navegabilidad/confianza del auditor, no de control faltante — salvo
stubs-inventory (SystemEngineProvider) que afirma orphan-no-mounted cuando ya
está cableado, lo que sí puede inducir trabajo duplicado.
