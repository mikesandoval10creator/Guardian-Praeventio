# File ledger — I-DOCS (185 files)

Mechanical per-file extraction (purpose = file's own header comment; exports from source). Part of the file-by-file context audit.

| Archivo | Bloque | LOC | Test | Propósito / exports |
|---|---|---:|:--:|---|
| `.claude/commands/canary.md` |  | 38 |  | /canary — post-deploy monitoring |
| `.claude/commands/careful.md` |  | 50 |  | /careful — extra-cautious gate |
| `.claude/commands/cross-review-vs-codex.md` |  | 111 |  | /cross-review-vs-codex — Hybrid cross-model review |
| `.claude/commands/cross-review.md` |  | 160 |  | /cross-review — Adversarial second-opinion review |
| `.claude/commands/cso-praeventio.md` |  | 153 |  | /cso-praeventio — Chief Security Officer review |
| `.claude/commands/design-html.md` |  | 52 |  | /design-html — zero-deps Praeventio mockup |
| `.claude/commands/freeze.md` |  | 67 |  | /freeze — congelar scope de edición |
| `.claude/commands/guard.md` |  | 65 |  | /guard — modo blindaje total |
| `.claude/commands/retro.md` |  | 110 |  | /retro — Weekly retrospective |
| `.claude/commands/unfreeze.md` |  | 28 |  | /unfreeze — liberar scope de edición |
| `.telemetry/audits/2026-05-04.md` | B7-Salud | 109 |  | Tracking audit — 2026-05-04 |
| `.telemetry/current-implementation.md` | B7-Salud | 111 |  | Current implementation — how telemetry is wired |
| `API_B2D_SPEC.md` |  | 505 |  | Praeventio Guard — API B2D Spec (OpenAPI 3.1) |
| `ARCHITECTURE.md` |  | 479 |  | Praeventio Guard — Architecture |
| `BERNOULLI_EXTENSIONS.md` |  | 288 |  | BERNOULLI EXTENSIONS — 15 Use Cases para el Motor de Dinámica de Fluidos |
| `BILLING.md` | B15-Billing | 426 |  | Praeventio Guard — Billing scaffolding (Chile + International) |
| `BRAND.md` |  | 192 |  | Guardian Praeventio — Brand & 4-Mode Color System |
| `CLAUDE.md` |  | 268 |  | CLAUDE.md |
| `CONTRIBUTING.md` |  | 313 |  | Contributing to Praeventio Guard |
| `docs/a11y/A11Y_AUDIT.md` |  | 179 |  | Guardian Praeventio — WCAG 2.2 AA accessibility audit |
| `docs/a11y/checklist-WCAG-2.2-AA.md` | B9-Inspecciones | 154 |  | WCAG 2.2 AA per-criterion checklist |
| `docs/a11y/WCAG_findings.md` | B9-Inspecciones | 42 |  | WCAG 2.2 AA — concrete findings |
| `docs/api-routes.md` |  | 537 |  | Praeventio Guard — API Routes Catalog |
| `docs/api/openapi.yaml` |  | 615 |  | TODO.md §12.1.10**: Esta es la spec OpenAPI v1 cubriendo el subset |
| `docs/ar-assets.md` | B10-EPP | 125 |  | AR assets — `.glb` y `.usdz` para PlacedObjectKind |
| `docs/architecture-decisions/0001-organic-collections-top-level.md` | B12-CPHS | 90 |  | ADR 0001 — Organic collections live at the Firestore root |
| `docs/architecture-decisions/0002-cad-viewer-mit-only-no-gpl-contamination.md` |  | 106 |  | ADR 0002 — CAD viewer is MIT-only; no GPL contamination from libredwg-web |
| `docs/architecture-decisions/0003-medical-iconography-bioicons-primary.md` | B7-Salud | 97 |  | 0003 — Medical iconography: Bioicons primary, BioRender exploratory only |
| `docs/architecture-decisions/0004-medical-icons-bundled-for-offline.md` | B7-Salud | 128 |  | ADR-0004: Imágenes médicas bundleadas al repo (offline-first) |
| `docs/architecture-decisions/0005-nodeodm-agpl-backend-only.md` |  | 82 |  | ADR-0005 — NodeODM (AGPL) sólo backend para fotogrametría |
| `docs/architecture-decisions/0006-mobile-deferred-to-local-build.md` |  | 105 |  | ADR-0006: Mobile build deferred to local — rationale + Sprint 21 plan |
| `docs/architecture-decisions/0007-euler-phi-rsa-in-kms-envelope.md` |  | 96 |  | ADR-0007: La función φ de Euler ya vive (implícitamente) en `kmsEnvelope.ts` |
| `docs/architecture-decisions/0008-libredwg-cloud-function-isolation.md` |  | 138 |  | ADR 0008 — DWG conversion via isolated LibreDWG Cloud Run service |
| `docs/architecture-decisions/0009-mobile-ci-signing-supersedes-0006.md` |  | 68 |  | ADR-0009: Mobile CI signing supersedes ADR-0006 (local-build deferral) |
| `docs/architecture-decisions/0010-privacy-by-design-no-intimate-data.md` |  | 255 |  | ADR 0010 — Privacy by Design: NO datos íntimos del trabajador |
| `docs/architecture-decisions/0011-digital-twin-triple-gate-auth.md` | B17-Admin | 306 |  | ADR 0011 — Digital Twin Access Control: Triple-Gate Authentication |
| `docs/architecture-decisions/0012-health-data-sovereignty-no-diagnosis.md` | B7-Salud | 402 |  | ADR 0012 — Health Data Sovereignty: HealthVault del Trabajador (NO Diagnóstico) |
| `docs/architecture-decisions/0013-mesh-information-relay.md` | B16-Offline | 493 |  | ADR 0013 — Mesh Information Relay (Bluetooth/Wi-Fi Direct + DTN/ICN) |
| `docs/architecture-decisions/0014-regulatory-framework-abstraction.md` | B5-Cumplimiento | 157 |  | ADR 0014 — Regulatory Framework Abstraction (ISO 45001 baseline + jurisdictional adapters) |
| `docs/architecture-decisions/0015-mqtt-iot-broker-strategy.md` |  | 222 |  | ADR 0015 — MQTT IoT Broker Strategy (dual adapter) |
| `docs/architecture-decisions/0016-cqrs-redis-deferred.md` |  | 47 |  | ADR 0016 — CQRS / Redis: deferred until P95 latency demands it |
| `docs/architecture-decisions/0017-per-country-emission-adapters.md` |  | 190 |  | ADR 0017 — Per-country emission adapters (no push, doc-only) |
| `docs/architecture-decisions/0018-webxr-renamed.md` |  | 12 |  | ADR-0018: WebXR rebranded as "Capacitación Interactiva" |
| `docs/architecture-decisions/PLAN_MAESTRO_2026-Q3.md` |  | 321 |  | PLAN MAESTRO 2026-Q3 — Nodos 321-512 (scoping ratificado) |
| `docs/archive/2026-05/AUDIT.md` |  | 236 |  | Auditoría — Praeventio Guard |
| `docs/archive/2026-05/DIGITAL_TWIN_GPU_FREE_PLAN.md` |  | 435 |  | Digital Twin sin GPU — Plan técnico |
| `docs/archive/2026-05/IMPACTO.md` |  | 142 |  | Impacto — Round 21 (Phase 5 server.ts triggers + reba snapshot + IPv6 keyGen + docs sweep + gemini split plan) |
| `docs/archive/2026-05/IMPLEMENTATION_ROADMAP.md` |  | 1504 |  | Hoja de Ruta de Implementación — Guardian Praeventio |
| `docs/archive/2026-05/INFORME_AVANCE_NOTEBOOK_LLM.md` |  | 326 |  | Informe de Avance — Guardian Praeventio |
| `docs/archive/2026-05/INFORME_ESTADO_2026-04-29.md` |  | 427 |  | Informe de Estado — Guardian-Praeventio (Praeventio Guard) |
| `docs/archive/2026-05/MASTER_PROPOSAL_2026-05.md` |  | 828 |  | MASTER_PROPOSAL — Guardian Praeventio |
| `docs/archive/2026-05/PLAN_PARTE1_GP_ACTUAL.md` |  | 200 |  | PLAN PARTE 1 — Guardian-Praeventio: Estado Actual y Brechas |
| `docs/archive/2026-05/PLAN_PARTE2_PROTOTIPO1.md` |  | 173 |  | PLAN PARTE 2 — Prototipo 1 (praevium-guard): Hallazgos y Recuperación |
| `docs/archive/2026-05/PLAN_PARTE3_PROTOTIPO2.md` |  | 241 |  | PLAN PARTE 3 — Prototipo 2 (Firebase Lovable.dev): Hallazgos y Recuperación |
| `docs/archive/2026-05/PLAN_PARTE4_ROADMAP_IMPLEMENTACION.md` |  | 261 |  | PLAN PARTE 4 — Roadmap de Implementación Unificado |
| `docs/archive/2026-05/PROTO_ARCHAEOLOGY.md` |  | 168 |  | Arqueología de prototipos — Guardian Praeventio |
| `docs/archive/2026-05/README.md` |  | 58 |  | Archive — Mayo 2026 |
| `docs/archive/2026-05/ROADMAP_2026-05.md` |  | 164 |  | Roadmap Guardian Praeventio — actualizado 2026-05-02 |
| `docs/archive/2026-05/ROADMAP.md` |  | 120 |  | ROADMAP: Praeventio Guard - El Despertar de la Conciencia |
| `docs/archive/2026-05/SKILL_ROUTING_2026-05-04.md` |  | 422 |  | SKILL_ROUTING_2026-05-04 — Matriz Feature × Skill × Connector |
| `docs/archive/2026-05/STATE_OF_FUNCTIONALITY_2026-05-04.md` |  | 341 |  | STATE_OF_FUNCTIONALITY_2026-05-04 |
| `docs/archive/2026-05/STRYKER_BASELINE.md` |  | 791 |  | Stryker mutation baseline — Round 18 + R19 + R20 Ratchet |
| `docs/archive/2026-05/TECHNICAL_DEBT_AUDIT.md` |  | 346 |  | Auditoría de Deuda Técnica — Guardian Praeventio |
| `docs/archive/2026-05/VERTEX_MIGRATION.md` |  | 247 |  | Vertex AI Migration — Data Residency Santiago |
| `docs/archive/README.md` |  | 90 |  | docs/archive/ — snapshots históricos |
| `docs/audit/auditoria777-parte2.md` |  | 475 |  | Auditoria 777 — Parte 2 (Apéndices Bucket C y D) |
| `docs/audit/auditoria777.md` |  | 1220 |  | Auditoria 777 — Plan Sprint 19 orchestrator multi-agente |
| `docs/audit/PENDING_AFTER_SPRINT_19.md` |  | 37 |  | Pendientes después de Sprint 19 — input para próximo orchestrator |
| `docs/audits/AUDIT_2026-05-05_FULL.md` |  | 236 |  | Auditoría Completa Multi-Bucket — Guardian Praeventio |
| `docs/audits/AUDIT_BACKLOG.md` |  | 132 |  | Backlog Vivo — Auditoría 2026-05-05 + Visión Global |
| `docs/audits/AUDIT_CODEX_2026-05-07.md` |  | 244 |  | Auditoria tecnica Codex - Guardian Praeventio |
| `docs/audits/AUDIT_TRUTH_MATRIX_2026-05-07.md` |  | 316 |  | Auditoria de verdad operacional - Guardian Praeventio |
| `docs/audits/COMPONENTS_TRIAGE.md` |  | 97 |  | Components — triage de huérfanos |
| `docs/audits/CONTEXT_AUDIT_2026-06.md` |  | 688 |  | Informe de Auditoría de Contexto — Praeventio Guard |
| `docs/audits/DIGITAL_TWIN_LINGBOT_MAP_REVIEW_2026-05-07.md` |  | 29 |  | Digital Twin / LingBot Map review - 2026-05-07 |
| `docs/audits/DOCS_RECONCILIATION_2026-05-05.md` |  | 181 |  | Reconciliación de documentos vs código real — 2026-05-05 |
| `docs/audits/HOOKS_TRIAGE.md` |  | 85 |  | Hooks scaffolding — triage exhaustivo |
| `docs/audits/PRAEVENTIO_HONEST_STATE_2026-05-05.md` |  | 264 |  | Praeventio Guard — Estado Honesto 2026-05-05 |
| `docs/audits/SERVICES_TRIAGE.md` |  | 124 |  | Services / triggers / jobs — triage 2026-05-26 |
| `docs/billing-iap.md` | B15-Billing | 190 |  | Billing — In-App Purchases (Apple / Google) and Web Rails |
| `docs/coach-domain.md` |  | 250 |  | Coach IA por dominio especializado |
| `docs/compliance/LEY_19628.md` | B5-Cumplimiento | 128 |  | Cumplimiento Ley 19.628 — Praeventio Guard |
| `docs/COWORK_REQUIREMENTS.md` |  | 81 |  | Cowork — qué necesito de ti (Daho) para destrabar el ~15% final |
| `docs/deep-linking-runbook.md` |  | 147 |  | Deep linking runbook — Universal Links (iOS) + App Links (Android) |
| `docs/dev-workflow/DESIGN_HTML_PATTERN.md` |  | 71 |  | DESIGN_HTML pattern |
| `docs/dev-workflow/SAFETY_PATTERNS.md` |  | 110 |  | Safety Patterns — `/careful`, `/freeze`, `/guard` |
| `docs/dte-sii.md` | B5-Cumplimiento | 134 |  | DTE / SII — Factura Electrónica Chile |
| `docs/dwg-converter-deploy.md` |  | 130 |  | DWG Converter — Deploy Runbook (Sprint 21 Bucket Q · verificado 2026-05-26) |
| `docs/email-flows.md` |  | 128 |  | Email flows (Resend) |
| `docs/firestore-indexes.md` |  | 66 |  | Firestore Composite Indexes |
| `docs/gemini-split-plan.md` | B14-IA | 582 |  | Gemini Backend split plan — R21 B3 scope discovery |
| `docs/i18n-coverage.md` |  | 106 |  | i18n Coverage |
| `docs/master-plan-end-to-end.md` |  | 1202 |  | Master Plan End-to-End — Guardian Praeventio |
| `docs/mcp/README.md` |  | 124 |  | Praeventio Guardian — MCP Server |
| `docs/medical-catalogs.md` | B7-Salud | 112 |  | Catálogos médicos bundled (offline-first) |
| `docs/medical-icons-generation-prompt.md` | B7-Salud | 521 |  | Generación manual de imágenes — 50 prompts standalone |
| `docs/mobile-build-runbook.md` |  | 282 |  | Mobile build runbook — Android + iOS |
| `docs/mobile-signing-runbook.md` |  | 151 |  | Mobile signing runbook — secrets, provisioning, triggers |
| `docs/observability/dashboard-praeventio-overview.json` | B9-Inspecciones | 109 |  |  |
| `docs/observability/INDEX.md` | B9-Inspecciones | 105 |  | Observability — INDEX |
| `docs/observability/SENTRY_ALERTS.md` | B9-Inspecciones | 381 |  | Sentry Alerts — Praeventio Guard |
| `docs/observability/SENTRY_DASHBOARDS.md` | B9-Inspecciones | 247 |  | Sentry Dashboards — Praeventio Guard |
| `docs/observability/sentry-alerts.yaml` | B9-Inspecciones | 259 |  | Sentry alert rules — Praeventio Guard |
| `docs/offline-sync.md` | B16-Offline | 138 |  | Offline Sync State Machine |
| `docs/photogrammetry-deploy.md` |  | 154 |  | Photogrammetry worker — deployment runbook (COLMAP / Cloud Run) |
| `docs/photogrammetry-modal.md` |  | 146 |  | Photogrammetry on Modal.run (GPU branch) |
| `docs/privacy-compliance-matrix.md` | B5-Cumplimiento | 80 |  | Privacy compliance matrix (Sprint 31 Bucket MM) |
| `docs/proto/analisis_funcional.md` |  | 84 |  | Análisis Funcional del Código Fuente de Praeventio |
| `docs/proto/auditoria01.md` |  | 74 |  | **INFORME DE ESTADO ABSOLUTO DEL SISTEMA — AUDITORÍA 01** |
| `docs/reports-cl.md` | B18-Analitica | 59 |  | Reportes regulatorios — Chile |
| `docs/runbooks/canary-monitoring.md` |  | 99 |  | Canary monitoring runbook |
| `docs/runbooks/CLIMATE_SCAN_RUNBOOK.md` |  | 153 |  | Climate Risk Daily Scan — Runbook |
| `docs/runbooks/CLOUD_BUILD_RUNBOOK.md` |  | 273 |  | Cloud Build Runbook — Guardian Praeventio |
| `docs/runbooks/DR_RUNBOOK.md` |  | 346 |  | Disaster Recovery Runbook (DR_RUNBOOK) |
| `docs/runbooks/HEALTH_RUNBOOK.md` | B7-Salud | 180 |  | Health Endpoints + Tracing Runbook |
| `docs/runbooks/INCIDENT_RESPONSE.md` | B4-Incidentes | 427 |  | Incident Response Runbook (INCIDENT_RESPONSE) |
| `docs/runbooks/KMS_PROD_ACTIVATION.md` |  | 165 |  | KMS Prod Activation Runbook |
| `docs/runbooks/KMS_ROTATION.md` |  | 411 |  | KMS Key Rotation Runbook (KMS_ROTATION) |
| `docs/runbooks/MERCADOPAGO_RUNBOOK.md` | B15-Billing | 140 |  | MercadoPago Runbook — Sandbox → Production |
| `docs/runbooks/MOBILE_SIGNING.md` |  | 336 |  | Mobile signing runbook — Android + iOS deep links |
| `docs/runbooks/PERFORMANCE.md` |  | 168 |  | PERFORMANCE — Runbook |
| `docs/runbooks/photogrammetry-deploy.md` |  | 109 |  | Photogrammetry Worker — Cloud Run Deploy Runbook |
| `docs/runbooks/QUOTA_RUNBOOK.md` |  | 221 |  | QUOTA_RUNBOOK — Gemini Per-Tenant Quotas + Circuit Breaker |
| `docs/runbooks/SCHEDULER_INVENTORY.md` | B10-EPP | 104 |  | Scheduler inventory — Cloud Scheduler jobs |
| `docs/runbooks/SECRETS_RUNBOOK.md` |  | 443 |  | Secrets Runbook |
| `docs/runbooks/TRANSBANK_RUNBOOK.md` |  | 227 |  | Transbank / Webpay — Runbook |
| `docs/runbooks/TYPESCRIPT_STRICT_ROADMAP.md` |  | 204 |  | TypeScript Strict Mode — Roadmap incremental |
| `docs/security/csp-policy.md` |  | 215 |  | CSP Policy — Praeventio Guard |
| `docs/security/data-flow-diagram.md` |  | 138 |  | Guardian Praeventio — Data Flow Diagram (DFD) |
| `docs/security/incident-response.md` | B4-Incidentes | 46 |  | Incident Response Runbook |
| `docs/security/PENTEST_CHECKLIST.md` | B9-Inspecciones | 166 |  | Firestore Rules Pentest Checklist — Dirty Dozen |
| `docs/security/PGP_GENERATION.md` |  | 78 |  | PGP key para `/.well-known/pgp-key.asc` |
| `docs/security/severity-rubric.md` |  | 125 |  | Severity Rubric — Praeventio Guard |
| `docs/security/STRIDE_findings.md` | B9-Inspecciones | 57 |  | Guardian Praeventio — STRIDE Findings |
| `docs/security/THREAT_MODEL.md` |  | 293 |  | Guardian Praeventio — STRIDE Threat Model |
| `docs/setup/google-maps-api-key.md` |  | 121 |  | Configurar Google Maps API key — guía paso a paso |
| `docs/setup/medical-icons-generation.md` | B7-Salud | 126 |  | Generación de iconos médicos originales con Gemini 2.5 Flash Image |
| `docs/slm-offline.md` | B14-IA | 258 |  | SLM Offline (Brecha B) |
| `docs/SPRINT_K_REFORMULATED.md` |  | 373 |  | Sprint K — Reformulación arquitectónica |
| `docs/sprints/EULER_INTEGRATION_SPEC.md` |  | 153 |  | Euler Integration Spec — Plan de 10 Fases |
| `docs/sprints/SPRINT_20_SPEC.md` |  | 1065 |  | Sprint 20 — Brecha B: SLM Offline para Praeventio (Mining Safety PWA) |
| `docs/sprints/sprint-20-architecture.png` |  |  |  |  |
| `docs/sprints/sprint-20-architecture.svg` |  | 187 |  |  |
| `docs/stubs-inventory.md` | B10-EPP | 134 |  | Stubs Inventory |
| `docs/suseso-deadlines.md` | B5-Cumplimiento | 101 |  | SUSESO DIAT/DIEP — plazos legales y sistema de recordatorios |
| `docs/testing/COVERAGE_BASELINE.md` |  | 126 |  | Coverage baseline — Guardian Praeventio |
| `docs/testing/MUTATION_BASELINE.md` |  | 754 |  | Mutation Testing Baseline (Stryker) |
| `docs/testing/MUTATION_TESTING.md` |  | 200 |  | Mutation Testing (Stryker) |
| `docs/testing/playwright.md` |  | 107 |  | Playwright E2E testing — guía de uso |
| `docs/testing/SOS_LOAD_TEST.md` |  | 111 |  | SOS Load Test — 1,000 Concurrent Workers |
| `docs/tracking/event-catalog.md` |  | 130 |  | Event Catalog v1.0.0 |
| `docs/tracking/property-glossary.md` |  | 204 |  | Property Glossary v1.0.0 |
| `docs/tracking/TRACKING_PLAN.md` |  | 256 |  | Guardian Praeventio — Tracking Plan v1.0.0 |
| `docs/usdz-converter-deploy.md` |  | 115 |  | USDZ Converter — Deploy Runbook |
| `docs/webxr-ar.md` |  | 112 |  | WebXR `immersive-ar` — Guardian Praeventio |
| `DR_RUNBOOK.md` |  | 286 |  | Praeventio Guard — Disaster Recovery Runbook |
| `HEALTH_CONNECT_MIGRATION.md` | B7-Salud | 262 |  | Health Connect Migration Runbook |
| `infrastructure/terraform/README.md` |  | 151 |  | Praeventio Guard — GCP Infrastructure (Terraform) |
| `IOS_BUILD.md` |  | 338 |  | Guardian Praeventio — Build iOS |
| `KMS_ROTATION.md` |  | 302 |  | KMS Envelope Encryption — Operations Runbook |
| `LICENSE` |  |  |  |  |
| `MARKETPLACE_SUBMISSION.md` |  | 219 |  | Google Workspace Marketplace — submission runbook |
| `marketplace/assets-spec.md` | B10-EPP | 181 |  | Marketplace assets — required image specs & content brief |
| `marketplace/listing-copy.md` |  | 235 |  | Marketplace listing copy — Spanish-CL primary, English secondary |
| `marketplace/oauth-consent-screen.md` | B17-Admin | 170 |  | OAuth Consent Screen — GCP Console form content |
| `marketplace/scope-justifications.md` |  | 111 |  | Scope justifications — for OAuth verification & Marketplace review |
| `MONITORING.md` |  | 256 |  | Praeventio Guard — Monitoring runbook |
| `OBSERVABILITY.md` | B9-Inspecciones | 422 |  | Production Observability — Operations Runbook |
| `PERFORMANCE.md` |  | 178 |  | Performance Budgets |
| `PRICING.md` | B15-Billing | 274 |  | Praeventio Guard — Política de Precios |
| `public/models/README.md` |  | 79 |  | Pre-packaged SLM models |
| `public/posters/README.md` |  | 55 |  | Safety Poster Reference Images |
| `README.md` |  | 300 |  | Praeventio Guard |
| `RUNBOOK.md` |  | 335 |  | Praeventio Guard — Operations Runbook |
| `scripts/seed-poster-embeddings.md` |  | 104 |  | Seed Poster Embeddings — runbook |
| `security_spec.md` |  | 122 |  | Security Specification for Praeventio Guard |
| `SECURITY.md` |  | 84 |  | Política de Divulgación Responsable / Responsible Disclosure Policy |
| `SII_INTEGRATION.md` |  | 157 |  | SII (Servicio de Impuestos Internos) — Boleta / Factura electrónica integration runbook |
| `tasks/lessons.md` | B6-Capacitacion | 21 |  | Registro de Lecciones y Patrones (Self-Improvement Cycle) |
| `tasks/plan-epp-vision.md` | B10-EPP | 14 |  | Plan: Módulo de Inspección Visual de EPP con IA |
| `tasks/plan-pts-grounding.md` |  | 12 |  | Plan: Generador de PTS con Búsqueda de Manuales de Fabricante (Google Search Grounding) |
| `templates/design-html-shell.html` |  | 126 |  |  |
| `TODO.md` |  | 2175 |  | TODO.md — Guardian Praeventio (Fuente Única de Verdad) |
| `ZETTELKASTEN_V2_NODES_FULL.md` |  | 650 |  | Zettelkasten v2 — Catalogo Completo de los 512 Nodos |
| `ZETTELKASTEN_V2_SPEC.md` |  | 815 |  | ZETTELKASTEN V2 — Especificación de Arquitectura del Grafo de Conocimiento |
