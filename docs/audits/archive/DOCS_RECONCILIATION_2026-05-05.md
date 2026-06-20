# Reconciliación de documentos vs código real — 2026-05-05

> Sprint 31 Bucket RR. Sweep cruzado entre los `.md` de planificación / estado
> y el código efectivamente presente en el repo (rama
> `dev/sprint-31-compliance-apac-tier-global-2026-05-05`, HEAD `7cd4a63`).
>
> Fuentes de verdad vivas tras este sweep:
>
> - Manifiesto estratégico (con checkboxes verificados) → [`TODO.md`](../../TODO.md)
> - Estado real de cobertura E2E → [`PRAEVENTIO_HONEST_STATE_2026-05-05.md`](PRAEVENTIO_HONEST_STATE_2026-05-05.md)
> - Backlog operacional vivo (hallazgos auditoría) → [`AUDIT_BACKLOG.md`](AUDIT_BACKLOG.md)
> - Plan unificado producto + skills/MCP → [`MASTER_PROPOSAL_2026-05.md`](../../MASTER_PROPOSAL_2026-05.md)

---

## Tabla de archivos auditados

Leyenda: 🟢 VIGENTE · 🟡 DESFASADO actualizado · 🔵 SUPERSEDED (con banner) · 🗄️ HISTÓRICO (banner solo) · ⚪ no tocado en este pasada

| Archivo | Estado | Última actualización conceptual | Acción tomada |
|---|---|---|---|
| `TODO.md` | 🟡 DESFASADO actualizado | 2026-05-05 | Marcados `[x]` SSO, Biometría nativa y Push FCM (existían en código). Resto se preservó. |
| `STATE_OF_FUNCTIONALITY_2026-05-04.md` | 🔵 SUPERSEDED | 2026-05-04 (Sprint 21) | Banner "DEPRECATED" → apunta al honest state vivo. |
| `ROADMAP.md` | 🔵 SUPERSEDED | pre-Sprint 20 | Banner → honest state + AUDIT_BACKLOG + TODO.md. |
| `ROADMAP_2026-05.md` | 🔵 SUPERSEDED | 2026-05-02 | Banner → MASTER_PROPOSAL + honest state. |
| `PLAN_PARTE4_ROADMAP_IMPLEMENTACION.md` | 🔵 SUPERSEDED | 2026-05-03 | Banner → MASTER_PROPOSAL + honest state. |
| `AUDIT.md` | 🗄️ HISTÓRICO | 2026-04-27 | Banner → audit vivo. |
| `INFORME_ESTADO_2026-04-29.md` | 🗄️ HISTÓRICO | 2026-04-29 | Banner → honest state. |
| `MASTER_PROPOSAL_2026-05.md` | 🟢 VIGENTE | 2026-05-03 | Plan unificado, fuente para visión + tiers. |
| `BILLING.md` | 🟢 VIGENTE | 2026-05-04 | Ya declara "scaffolding"; alineado con Khipu/Webpay/MP/IAP existentes. |
| `HEALTH_CONNECT_MIGRATION.md` | 🟢 VIGENTE | 2026-04-28 | Estado runbook honesto; ADR 0012 lo respalda. |
| `IOS_BUILD.md` | 🟢 VIGENTE | 2026-04-28 | HealthKit adapter + falta `npx cap add ios` real. Sprint 30 GG agregó Fastlane. |
| `BERNOULLI_EXTENSIONS.md` | 🟢 VIGENTE | Sprint 5+ | Engine implementado + 12 generadores; UI consumer pendiente (F-A). |
| `DIGITAL_TWIN_GPU_FREE_PLAN.md` | 🟢 VIGENTE | 2026-05-03 | Plan COLMAP/Modal vigente; runbooks `docs/photogrammetry-*` vivos. |
| `SKILL_ROUTING_2026-05-04.md` | 🟢 VIGENTE | 2026-05-04 | Skill catalog activo. |
| `ZETTELKASTEN_V2_SPEC.md` / `_NODES_FULL.md` | 🟢 VIGENTE | Sprint 12+ | Spec del grafo, código se le ajusta. |
| `API_B2D_SPEC.md` | 🟢 VIGENTE | 2026-05-05 | Sprint 10 D4: 3+1 APIs. |
| `PRICING.md` | 🟢 VIGENTE | 2026-05-03 | 4 planes + Stripe descartado documentado. |
| `BRAND.md` | 🟢 VIGENTE | 2026-05-04 | Sistema de tokens y 4 modos. |
| `CONTRIBUTING.md` | 🟢 VIGENTE | 2026-05-02 | Conventions activas. |
| `README.md` | 🟢 VIGENTE | 2026-05-04 | Página principal del repo. |
| `ARCHITECTURE.md` | 🟢 VIGENTE | 2026-05-02 | Visión global del stack. |
| `SECURITY.md` / `KMS_ROTATION.md` / `DR_RUNBOOK.md` / `RUNBOOK.md` | 🟢 VIGENTE | 2026-05-02 | Runbooks operacionales. |
| `OBSERVABILITY.md` / `MONITORING.md` / `PERFORMANCE.md` | 🟢 VIGENTE | 2026-05-02..04 | Sentry + dashboards. |
| `IMPACTO.md` | 🟢 VIGENTE | 2026-05-02 | Narrativa de impacto. |
| `MARKETPLACE_SUBMISSION.md` | 🟢 VIGENTE | 2026-05-02 | Pre-Day-1 mundial. |
| `PROTO_ARCHAEOLOGY.md` | 🟢 VIGENTE | 2026-05-03 | Lecciones de Proto-1/2. |
| `STRYKER_BASELINE.md` | 🟢 VIGENTE | 2026-05-02 | Mutation testing baseline 72%. |
| `SII_INTEGRATION.md` | 🟢 VIGENTE | 2026-05-02 | Bsale parcial; LibreDTE/OpenFactura/SimpleAPI lanzan SiiNotImplementedError (alineado). |
| `VERTEX_MIGRATION.md` | 🟢 VIGENTE | 2026-05-02 | Sprint 27 cerró el adapter real `@google-cloud/vertexai 1.12`. |
| `PLAN_PARTE1_GP_ACTUAL.md` / `_PARTE2_PROTOTIPO1.md` / `_PARTE3_PROTOTIPO2.md` | 🟢 VIGENTE (referenciales) | 2026-05-03 | MASTER_PROPOSAL las cita como insumo. |
| `security_spec.md` | 🟢 VIGENTE | reciente | Spec de superficie criptográfica. |
| `docs/audits/PRAEVENTIO_HONEST_STATE_2026-05-05.md` | 🟢 VIGENTE (vivo) | 2026-05-05 | Fuente de verdad de cobertura. |
| `docs/audits/AUDIT_BACKLOG.md` | 🟢 VIGENTE (vivo) | rolling | Backlog vivo audit. |
| `docs/architecture-decisions/0001..0014.md` | 🟢 VIGENTE | varios | ADRs activos. ADR 0006 ya está marcado "superseded" por 0009 dentro del propio archivo (ok). |
| `docs/audit/auditoria777.md` / `auditoria777-parte2.md` / `PENDING_AFTER_SPRINT_19.md` | 🗄️ HISTÓRICO (sin tocar) | Sprint 19 | Reemplazados conceptualmente por master-plan-end-to-end.md → honest state. Conservados. |
| `docs/proto/analisis_funcional.md` / `auditoria01.md` | 🗄️ HISTÓRICO | proto-era | Insumos arqueológicos. |
| `docs/master-plan-end-to-end.md` | 🟢 VIGENTE | rolling | Trazabilidad multi-ola Sprint 20+. |
| `docs/sprints/SPRINT_20_SPEC.md` / `EULER_INTEGRATION_SPEC.md` | 🟢 VIGENTE | Sprint 20+ | Specs sprint-locales aún en rotación. |
| `docs/runbooks/*` (DR, KMS, INCIDENT, CLIMATE_SCAN, CLOUD_BUILD, HEALTH, PERFORMANCE, QUOTA, SECRETS, TRANSBANK, KMS_PROD_ACTIVATION) | 🟢 VIGENTE | 2026-05-02..05 | Operacionales. |
| `docs/security/*` (THREAT_MODEL, STRIDE_findings, PENTEST_CHECKLIST, severity-rubric, csp-policy, data-flow-diagram, incident-response) | 🟢 VIGENTE | 2026-05-02 | Postura security viva. |
| `docs/observability/*` (INDEX, SENTRY_ALERTS, SENTRY_DASHBOARDS) | 🟢 VIGENTE | 2026-05-02 | Sentry MCP provisionado. |
| `docs/a11y/*` (A11Y_AUDIT, WCAG_findings, checklist-WCAG-2.2-AA) | 🟢 VIGENTE | rolling | A11y CI activo. |
| `docs/compliance/LEY_19628.md` | 🟢 VIGENTE | 2026-05-02 | Compliance CL. |
| `docs/setup/*` (google-maps-api-key, medical-icons-generation) | 🟢 VIGENTE | runbook setup | Acción del usuario pendiente. |
| `docs/testing/*` (MUTATION_BASELINE, MUTATION_TESTING, playwright) | 🟢 VIGENTE | rolling | Test infra. |
| `docs/tracking/*` (TRACKING_PLAN, event-catalog, property-glossary) | 🟢 VIGENTE | rolling | Telemetry plan. |
| `docs/i18n-coverage.md` | 🟢 VIGENTE | Sprint 28 B2 | 12 locales + RTL. |
| `docs/coach-domain.md` | 🟢 VIGENTE | rolling | Mantenimiento del corpus coach. |
| `docs/slm-offline.md` | 🟢 VIGENTE | Sprint 21 + Sprint 26 ZZ | Guardian Offline activo. |
| `docs/photogrammetry-deploy.md` / `photogrammetry-modal.md` | 🟢 VIGENTE | rolling | Cloud Run worker pendiente de deploy. |
| `docs/ar-assets.md` / `webxr-ar.md` / `usdz-converter-deploy.md` / `dwg-converter-deploy.md` | 🟢 VIGENTE | Sprint 21+ / Sprint 30 JJ | ARKit Quick Look fallback ya entrega `.usdz`. |
| `docs/api-routes.md` | 🟢 VIGENTE | Round 16 (2026-04-28) | Catálogo endpoints; nuevas rutas Sprint 27-30 quedan documentadas en cada PR. |
| `docs/billing-iap.md` | 🟢 VIGENTE | Sprint 27 | Apple SSN v2 + Google Play. |
| `docs/dte-sii.md` | 🟢 VIGENTE | Sprint 23 | Bsale + stubs documentados. |
| `docs/email-flows.md` / `firestore-indexes.md` / `gemini-split-plan.md` / `medical-catalogs.md` / `medical-icons-generation-prompt.md` / `mobile-build-runbook.md` / `mobile-signing-runbook.md` / `offline-sync.md` / `privacy-compliance-matrix.md` / `reports-cl.md` / `deep-linking-runbook.md` | 🟢 VIGENTE | rolling | Runbooks/specs activos. |
| `docs/suseso-deadlines.md` | 🟢 VIGENTE | Sprint 28 follow-up | DIAT/DIEP plazos. |

Total revisado en este sweep: **~119 archivos** (38 root + 81 docs/).
Reclasificados / con banner añadido: **6** (STATE, ROADMAP, ROADMAP_2026-05, PLAN_PARTE4, AUDIT, INFORME_ESTADO_2026-04-29).
Actualizados con `[x]`: **3 ítems en TODO.md** (SSO, Biometría, Push FCM).

---

## Manifiesto TODO.md vs realidad — funcionalidades del producto

### Realmente E2E hoy (= ganancias rápidas para la moral; quitar de "pendiente" mental)

1. **DIAT / DIEP automatizado SUSESO** — Sprint 28 B6 cerró PDF + folio atómico + firma + verify público. `src/services/compliance/ds67/`, `ds76/`, `src/services/suseso/`.
2. **CalculatorHub con generadores Bernoulli** — Sprint 29 AA F-A. `src/pages/CalculatorHub.tsx` operativo.
3. **Mesh BLE/WiFi Direct via Capacitor** — Sprint 30 II. `packages/capacitor-mesh/` (Kotlin + Swift) + `transportFacade.ts`.
4. **AutoCAD / DWG pipeline** — `src/services/cad/dwgAdapter.ts` + dxfAdapter + `dwg-converter-deploy.md` runbook + `pages/AutoCADViewer.tsx`. Bloqueador real: ODA license — pivote a LibreDWG documentado en honest state.
5. **WebAuthn / Biométrica** — Sprint 30 LL UI + middleware `verifyTwinStepUp`; cuatro hits en Settings.tsx + tests.
6. **Push FCM Capacitor** — `usePushNotifications.ts` con tests + cross-collection lookup users/{uid}.fcmTokens (Sprint 27 H7).
7. **SSO Config UI** — `src/pages/SSOConfig.tsx` (Firebase Identity Platform).
8. **Vertex AI adapter real** — `@google-cloud/vertexai 1.12`, Sprint 27 H4 P1.
9. **SLM offline (Guardian Offline)** — `src/services/slm/` 28 archivos, ONNX + reconciliation runner + worker. Falta CDN bundle + flag prod.
10. **CPHS Comité Paritario container** — Sprint 28 B5 + Sprint 29 DD F-G wire container con auth/firestore.

### Parciales (UI o engine sí, falta wire crítico — Sprint 32+)

- **MQTT Broker IoT total** — solo `pages/IoTEdgeFiltering.tsx` (UI). Falta el broker real (EMQX / GCP IoT Core).
- **Streaming SSE de respuestas Gemini** (Prioridad 9) — sin EventSource ni `streamGenerateContent` en `services/ai/`.
- **Bucle RLHF "Útil/No útil"** (Prioridad 9) — sin endpoint dedicado.
- **Búsqueda híbrida vector + metadata** (Prioridad 9) — Firestore embeddings sí, filtro por proyecto sin compose semántico.
- **Cloud Function generador SUSESO PDF dedicado** (Prioridad 10) — render existe en server.ts; no aislado en CF.
- **Cron nocturno ERP** (Prioridad 10) — endpoint `/api/erp/sync` con Zod y limiter, sin Cloud Scheduler programado en producción.
- **Webhook facturación → activar Premium** — webhooks billing existen para Apple/Google/Webpay/MP/Khipu pero no para "activar módulo Premium" tras pago externo.
- **Apple Watch / WearOS apps nativas** — solo refs en `WearablesIntegration.tsx`; no hay proyectos watch dedicados.
- **CQRS / Redis** — pageshell `pages/CQRSArchitecture.tsx`; sin instancia Redis real en infra.
- **Matriz de Permisos formal con custom claims completos** (Prioridad 8) — RBAC presente, falta tabla canónica + Cloud Function de inyección documentada.
- **Auditoría ISO interactiva con flujo dependiente** — pendiente.
- **Compresión de imágenes en cliente generalizada** — implementada en `ProjectDocuments` y `OfflineSyncManager`; falta extender a todos los uploads.
- **Mapa de Contaminación Lumínica (vista táctica nocturna)** — `pages/ContaminacionLuminica.tsx` con Vision IA pero sin "vista mapa de focos del campamento".
- **Control de Acceso SSO Local casino/campamento** — pendiente integración hardware.
- **Carga diferida inteligente todos los modales pesados** — parcial.
- **Sistema de logros locales offline-first** — parcial.

### En TODOs pero el código NO las tiene (deuda real, candidatos Sprint 32+)

1. **Cripto/Tokens** — descartado oficialmente por usuario; conservar `[ ]` con marca "*Pausado/Descartado*" (ya está así).
2. **Digital Twins simulación 3D inmersiva entrenamiento** (Prioridad 13 Fase 4) — el twin actual es geo-locación de objetos; entrenamiento inmersivo sin código.
3. **Telemetría IoT ↔ Probabilidad de Falla** (Fase 4 deep tech) — sin pipeline `telemetry.payload → riskNode.probability`.
4. **Fatiga humana ↔ Asignación de tareas en ERP** — MediaPipe local sí, reasignación automática backend no.
5. **Dashboards Analíticos Predictivos ML** (Vertex AI custom) — sin training pipeline propio.
6. **Gestión de memoria 3D agresiva (WebGL GC al cerrar)** — explícitamente marcado `[ ]` en TODO; no existe hook de teardown agresivo en componentes 3D.
7. **Rotación automática de Keys JWT corta** — política manual, no automatizada.
8. **Compresión de imágenes universal** — ver "parciales".
9. **Purgado de Caché Obsoleto entre versiones** — sin script.
10. **Precarga de DNS (`<link rel=dns-prefetch>`)** — sin tags configurados.

---

## Resumen 1-líner por archivo (root)

| Archivo | Cubre |
|---|---|
| `API_B2D_SPEC.md` | Spec 3+1 APIs B2D (Climate/Hazmat/Normativa/Suite) + 8 tiers. |
| `ARCHITECTURE.md` | Stack global, capas y módulos del producto. |
| `AUDIT.md` | Auditoría de saneamiento 2026-04-27 (histórica). |
| `BERNOULLI_EXTENSIONS.md` | Inventario y wire de generadores Bernoulli. |
| `BILLING.md` | Scaffolding billing internacional + decisión Stripe out. |
| `BRAND.md` | Tokens, paletas, 4 modos UX. |
| `CONTRIBUTING.md` | Flujo de contribución, convenciones, checklists. |
| `DIGITAL_TWIN_GPU_FREE_PLAN.md` | Plan Modal/Cloud Run para fotogrametría. |
| `DR_RUNBOOK.md` | Disaster recovery. |
| `HEALTH_CONNECT_MIGRATION.md` | Migración Health Connect Android. |
| `IMPACTO.md` | Narrativa de impacto humano + métrica. |
| `INFORME_ESTADO_2026-04-29.md` | Informe operacional histórico R12-R21. |
| `IOS_BUILD.md` | Runbook build iOS + HealthKit. |
| `KMS_ROTATION.md` | Procedimiento rotación de claves. |
| `MARKETPLACE_SUBMISSION.md` | Submission Play Store / App Store. |
| `MASTER_PROPOSAL_2026-05.md` | Plan unificado tras prototipos + skills/MCP. |
| `MONITORING.md` / `OBSERVABILITY.md` / `PERFORMANCE.md` | Observabilidad y performance. |
| `PLAN_PARTE1..3*.md` | Análisis arqueológico GP actual + 2 prototipos. |
| `PLAN_PARTE4_*` | Roadmap (superseded). |
| `PRICING.md` | 4 planes + filosofía sin gating de seguridad. |
| `PROTO_ARCHAEOLOGY.md` | Lecciones de Proto-1/2. |
| `README.md` | Landing del repo. |
| `ROADMAP*.md` | Roadmaps históricos (superseded). |
| `RUNBOOK.md` | Runbook operacional general. |
| `SECURITY.md` / `security_spec.md` | Postura security + spec criptográfica. |
| `SII_INTEGRATION.md` | DTE Bsale + stubs LibreDTE/OpenFactura/SimpleAPI. |
| `SKILL_ROUTING_2026-05-04.md` | Routing skills/MCP. |
| `STATE_OF_FUNCTIONALITY_2026-05-04.md` | (DEPRECATED) reporte 99% optimista. |
| `STRYKER_BASELINE.md` | Mutation baseline 72%. |
| `TODO.md` | Manifiesto estratégico vivo (~13 prioridades + Fases). |
| `VERTEX_MIGRATION.md` | Migración Gemini → Vertex AI. |
| `ZETTELKASTEN_V2_NODES_FULL.md` / `_SPEC.md` | Spec del grafo y nodos. |

---

## Convenciones para mantener este doc

- Cada sprint que mueva un archivo de DESFASADO → VIGENTE debe actualizar la fila correspondiente.
- Cuando un nuevo `.md` nazca, añadirlo en una sub-tabla "post-2026-05-05".
- Cuando dos docs digan cosas opuestas, ganar siempre el más nuevo en `mtime` y poner banner SUPERSEDED en el otro.
- Si un ítem migra de "deuda real" a "parcial" o "E2E", trasladarlo entre las tres listas del manifiesto.

**Próxima revisión sugerida: cierre de Sprint 32** (post Day-1 readiness sweep).
