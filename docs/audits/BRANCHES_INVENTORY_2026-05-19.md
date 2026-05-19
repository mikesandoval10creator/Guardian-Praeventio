# Inventario REAL de branches no mergeadas — Guardian-Praeventio (2026-05-19)

> **Contexto crítico descubierto en triage:** main fue rebranched/squash-mergeado el 2026-05-18 (51 commits actuales). Las 213/214 dev/* branches NO comparten merge base — son snapshots viejos del repo + cambios pequeños. La métrica relevante es **archivos NUEVOS añadidos por la branch que NO existen en main**.

Total branches: 214

## Columnas
- **added** = archivos NUEVOS en branch (no en main) — work potencialmente perdido
- **del** = archivos en main que NO existen en branch — branch es más vieja
- **mod** = archivos modificados (existen en ambos pero distintos)

## Branches ordenadas por archivos AÑADIDOS (work único potencial)

| Branch | added | del | mod | Last commit |
|---|---|---|---|---|
| `dev/sprint-41-f6-offline-inspection` | 5 | 948 | 423 | feat(inspections): F.6 Modo Sin Señal — offline-first pure engine + UI |
| `feat/parallel-stream-slm-shell` | 3 | 629 | 416 | feat(slm): in-app downloader UX completo |
| `feat/parallel-stream-signing` | 3 | 629 | 416 | feat(mobile): scripts + runbook + CI check para signing assetlinks/AASA |
| `feat/parallel-stream-reconciliation-fcm` | 3 | 628 | 418 | feat(slm): auto-trigger reconciliation on online/FCM + status toast |
| `feat/parallel-stream-encrypted-queue` | 3 | 632 | 418 | feat(slm): encrypted offline queue migration |
| `dev/wire-ui-lote-final` | 3 | 589 | 409 | feat(wire-ui): 5 componentes para servicios sin UI — leadership/CPHS/engineeri |
| `dev/webxr-ar-foundation` | 3 | 593 | 421 | feat(ar): WebXR foundation — capabilities + hit-test stability + Quick Look (4 |
| `dev/test-stabilization-2026-05-15` | 3 | 549 | 395 | fix(tests): declarar requiredIf en el cast local de REQUIRED_PROD |
| `dev/sw-models-cache-e2e` | 3 | 598 | 421 | test(e2e): Service Worker /models/* runtime cache (3 specs × 2 projects) |
| `dev/stabilize-ci-workflows` | 3 | 548 | 394 | fix(rules): isSupervisorOfTenant ya no exige rol global supervisor cuando hay cl |
| `dev/sprint-f-nasa-codex-fixes` | 3 | 520 | 378 | fix(climate): 3 hallazgos Codex post-#279 mergeado |
| `dev/sprint-f-cleanups` | 3 | 525 | 379 | fix(twin): drop closure stale — usar setState updater para idx |
| `dev/sprint-f-ar-real-vision` | 3 | 511 | 384 | fix(ar+emergency): atender 6 hallazgos Codex P1 críticos |
| `dev/sprint-e-nasa-power-climate` | 3 | 520 | 383 | feat(climate): NASA POWER + EONET wire real a ClimateRoutes |
| `dev/sprint-e-nasa-power-climate-v2` | 3 | 520 | 383 | feat(climate): NASA POWER + EONET wire real a ClimateRoutes |
| `dev/sprint-d-arbitrary-data-fakes` | 3 | 525 | 380 | fix(b2d): B2dAdminPanel MRR — fin del ramp lineal sintético |
| `dev/sprint-c-life-critical-fakes` | 3 | 525 | 380 | feat(refuges): MountainRefuges con catálogo CONAF real + Haversine |
| `dev/sprint-53-s53-route` | 3 | 714 | 400 | feat(routeScoring): §70-73 critical route scoring + driver-route matcher (Sprin |
| `dev/sprint-53-s53-roi-sim` | 3 | 716 | 400 | feat(roiScenario): §175 extendido — ROI scenario simulator multi-escenario (S |
| `dev/sprint-53-s53-replay` | 3 | 716 | 400 | feat(eventReplay): §147-152 event replay sourcing audit tool (Sprint 53) |
| `dev/sprint-53-s53-raci` | 3 | 716 | 400 | feat(raciMatrix): §50-58 RACI matrix engine — validación + detección overlo |
| `dev/sprint-53-s53-portfolio` | 3 | 716 | 400 | feat(portfolioLessons): §120-132 transfer engine cross-portfolio (Sprint 53) |
| `dev/sprint-53-s53-form-adv` | 3 | 716 | 400 | feat(formBuilderAdvanced): §263-268 motor avanzado de form fields (Sprint 53) |
| `dev/sprint-52-s52-vendor` | 3 | 731 | 402 | feat(vendorOnboarding): §35-48 vendor portal — company-level flow + accredita |
| `dev/sprint-52-s52-role-onb` | 3 | 733 | 403 | feat(roleOnboarding): §164-170 onboarding por rol con tracks dirigidos (Sprint  |
| `dev/sprint-52-s52-control-compare` | 3 | 731 | 402 | feat(controlComparator): §193 A/B comparator + §306 failure library enhanced ( |
| `dev/sprint-52-s52-contingency` | 3 | 732 | 402 | feat(contingencySimulation): §241-242 scenario builder + tabletop engine (Sprin |
| `dev/sprint-51-s51-monthly-report` | 3 | 754 | 405 | feat(reporting): §117-118 monthly client report builder + reputational alert en |
| `dev/sprint-51-s51-i18n` | 3 | 758 | 401 | feat(i18n): batch 8 — 12 pages (D.13.c) |
| `dev/sprint-51-s51-cost-roi` | 3 | 752 | 405 | feat(financialAnalytics): §175-179 ROI + EPP budget + PO suggester (Sprint 51) |
| `dev/sprint-51-s51-ai-off` | 3 | 754 | 405 | feat(ai-toggle): §161-163 AI-off mode + drift detector (Sprint 51) |
| `dev/sprint-51-s51-admin-burden` | 3 | 755 | 405 | feat(adminBurden): Sprint 51 §259-260 tracker carga administrativa + auto-admin |
| `dev/sprint-50-s50-h5-sii` | 3 | 770 | 405 | feat(sii): E.5 P2 H5 SII pre-flight checks (Sprint 50) |
| `dev/sprint-50-s50-h3-stripe` | 3 | 770 | 405 | feat(billing): E.5 P2 H3 Stripe pre-flight checks (Sprint 50) |
| `dev/sprint-50-s50-h27-geofence` | 3 | 770 | 405 | feat(geofence): E.5 P2 H27 permission UX decision engine (Sprint 50) |
| `dev/sprint-50-s50-h1-dwg` | 3 | 770 | 405 | feat(cad): E.5 P2 H1 — DWG document validator pre-upload (Sprint 50) |
| `dev/sprint-49-s49-pdca-karin` | 3 | 792 | 407 | feat(sprint-k): §195-213 — PDCA + NC + Ley Karin + Retaliation (Sprint 49) |
| `dev/sprint-49-s49-h19-any` | 3 | 773 | 408 | fix(types): E.5 P2 H19 cleanup — reduce \`as any\` casts (Sprint 49) |
| `dev/sprint-49-s49-d8b-dte` | 3 | 796 | 407 | feat(dte): D.8.b DTE auto-issue + queue + billing wire (Sprint 49) |
| `dev/sprint-49-s49-d8a-suseso` | 3 | 797 | 407 | test(suseso): add 15 route tests for D.8.a admin-gated endpoints |
| `dev/sprint-48-s48-i18n` | 3 | 811 | 410 | feat(i18n): batch 7 — NormativeDetail completion (D.13.c) |
| `dev/sprint-48-s48-e4-jur` | 3 | 805 | 422 | feat(regulatory): E.4 — 6 jurisdicciones nuevas + 8 privacy regimes (Sprint 48 |
| `dev/sprint-48-s48-e2-r3f` | 3 | 772 | 405 | feat(testing): E.2 @react-three/test-renderer migracion (Sprint 48) |
| `dev/sprint-47-s47-c9-slm` | 3 | 829 | 423 | feat(slm): C.9 ONNX runtime + WebGPU + SHA256 integrity guard (Sprint 47) |
| `dev/sprint-47-s47-c5-sos` | 3 | 829 | 417 | feat(emergency): C.5 SOS orchestrator + GPS breadcrumb tracker (Sprint 47) |
| `dev/sprint-47-s47-c10-rag` | 3 | 829 | 419 | feat(ai-rag): C.10 Contextual RAG sobre Zettelkasten + citation policy (Sprint 4 |
| `dev/sprint-46-s46-ble-ios` | 3 | 837 | 417 | feat(mesh): D.12 BLE CoreBluetooth iOS real implementation (Sprint 46) |
| `dev/sprint-46-s46-ble-android` | 3 | 837 | 418 | feat(mesh): D.12 BLE GATT Android real implementation (Sprint 46) |
| `dev/sprint-45-s45-wireui` | 3 | 853 | 420 | feat(ui): wire 5 servicios batch S45 — riskRadar, softBlocking, syncStatus, wo |
| `dev/sprint-45-s45-sprintk` | 3 | 857 | 420 | feat(sprint-k): §191 investigation mode + bowtie analysis + BBS observations |
| `dev/sprint-45-s45-i18n` | 3 | 863 | 417 | feat(i18n): batch 5 — 10 pages (D.13.c) |
| `dev/sprint-44-s44-wireui` | 3 | 882 | 418 | feat(ui): wire 5 servicios sin componente (Wire UI batch S44) |
| `dev/sprint-44-s44-sprintk` | 3 | 886 | 418 | fix(sprint-k): 4 P2 Codex fixes — PYME quick path + supplier finite + Pro upse |
| `dev/sprint-44-s44-p2-h11` | 3 | 891 | 417 | fix(geofence): H11 hash de geometría usa coordinates real (E.5 P2) |
| `dev/sprint-44-s44-i18n` | 3 | 892 | 415 | feat(i18n): batch 4 — 10 pages (D.13.c) |
| `dev/sprint-43-wireui` | 3 | 900 | 423 | feat(ui): wire 5 servicios sin componente (Wire UI batch S43) |
| `dev/sprint-43-p2-backlog` | 3 | 910 | 422 | fix(triggers): re-check status DENTRO del mutex + idempotency marker (Codex P2 P |
| `dev/sprint-43-i18n-batch3` | 3 | 910 | 418 | feat(i18n): batch 3 — 10 pages wired with useTranslation + fallback (D.13.c) |
| `dev/sprint-42-f6-offline-inspection` | 3 | 924 | 422 | feat(inspections): F.6 Modo Sin Señal para Inspecciones |
| `dev/sprint-42-f20-drills-ui` | 3 | 924 | 423 | feat(drills): F.20 DrillResultReviewCard (post-drill review with gaps + recommen |
| `dev/sprint-42-f19-photo-evidence` | 3 | 924 | 422 | feat(photo-evidence): F.19 Photo evidence engine (validation + content-addressed |
| `dev/sprint-42-f18-worker-portable-history` | 3 | 924 | 422 | feat(worker-history): F.18 Historial Profesional Portátil — export subgrafo + |
| `dev/sprint-42-f15-permits-module` | 3 | 922 | 422 | feat(work-permits): F.15 permit lifecycle advisor + checklist UI |
| `dev/sprint-42-f14-heatmap-findings` | 3 | 922 | 422 | feat(heatmap): F.14 Mapa Calor Hallazgos — agregaciones geo simples sin Maps A |
| `dev/sprint-41-i18n-sweep-batch2` | 3 | 950 | 417 | feat(i18n): sweep batch 2 — add useTranslation + t() to 10 high-traffic pages |
| `dev/sprint-41-f30-telemetry-aggregate` | 3 | 928 | 420 | feat(telemetry): F.30 Telemetría agregada (rollups + velocities + privacy guard |
| `dev/sprint-41-f29-incident-trends` | 3 | 948 | 421 | fix(incident-trends): apply Codex P2 PR #102 (gap-fill empty buckets + leave-one |
| `dev/sprint-41-f28-recommendation-explainability` | 3 | 940 | 418 | fix(explainability): apply 3 Codex P2 PR #107 (weighted llmShare + exact thresho |
| `dev/sprint-41-f27-multi-project-comparator` | 3 | 948 | 422 | fix(multi-project): apply 4 Codex P2 PR #103 (null closure, leave-one-out TRIR,  |
| `dev/sprint-41-f26-maturity-index` | 3 | 946 | 422 | feat(maturity): F.26 Indicador Madurez Preventiva 1-5 (Bradley Curve) |
| `dev/sprint-41-f23-document-versioning` | 3 | 948 | 421 | fix(documents): apply Codex P2 PR #104 (multiset-aware diff handles duplicate li |
| `dev/sprint-41-f22-microtraining` | 3 | 946 | 422 | feat(microtraining): F.22 Modo Capacitación Relámpago — micro-trainings 3-5m |
| `dev/sprint-41-f21-shift-risk-panel` | 3 | 948 | 421 | feat(shift-risk): F.21 UI - PreShiftRiskCard (score gauge + factors detail + del |
| `dev/sprint-41-f17-soft-block` | 3 | 940 | 418 | feat(soft-blocking): F.17 Requirement gate + auditable override (no hard block,  |
| `dev/sprint-41-f16-worker-readiness` | 3 | 928 | 422 | feat(worker-readiness): F.16 Readiness Score (assist, no block) — directiva 2  |
| `dev/sprint-40-stream5-sentry-coverage-batch2` | 3 | 1031 | 433 | feat(observability): extend Sentry coverage to 11 server routes (Fase D.13.a bat |
| `dev/sprint-40-stream2-i18n-sweep-batch1-v2` | 3 | 1031 | 427 | feat(i18n): add useTranslation + t() to 9 high-traffic pages (batch 1) |
| `dev/sprint-40-post-pr87-ux-observ` | 3 | 1017 | 421 | feat(ux,observ,photogrammetry): post-PR #87 refinements + android scaffold |
| `dev/sprint-40-fixB-photogrammetry-codex` | 3 | 950 | 421 | fix(photogrammetry): apply Codex P1+3×P2 (gradlew chmod+x, Firestore index, Uni |
| `dev/sprint-40-fixA-sentry-context-wrap` | 3 | 1029 | 433 | fix(observability): centralize captureRouteError + fix Sentry tag mapping |
| `dev/sprint-40-f9-data-incompleteness` | 3 | 1029 | 433 | fix(data-quality): apply Codex P1+5×P2 — accept real field aliases (name/role |
| `dev/sprint-40-f8-inbox-prevencionista` | 3 | 1029 | 433 | fix(inbox): apply 3 Codex P2 (daysOverdue derive + quickActions clone + dismissa |
| `dev/sprint-40-f7-cphs-minute-autogen` | 3 | 1013 | 429 | fix(cphs): accept 'verified' status alongside 'verified_effective' (Codex P2 PR  |
| `dev/sprint-40-f5-qr-signature` | 3 | 1027 | 434 | fix(qr-signature): apply 3 Codex P2 (UTF-8 decode + nonce consumption + ack matc |
| `dev/sprint-40-f13-repeating-risk-radar` | 3 | 1029 | 435 | fix(risk-radar): apply 5 Codex P2 (cluster expand, multi-cluster, tz-compare, fu |
| `dev/sp39-eonet-rebased` | 3 | 1070 | 429 | feat(jobs): cron work_permit auto-expire + legal calendar reminders |
| `dev/site-book-crdt` | 3 | 597 | 419 | feat(siteBook): adapter Firestore integra CRDT drafts (6 tests nuevos) (#256) |
| `dev/site-book-crdt-adapter` | 3 | 597 | 419 | feat(siteBook): adapter Firestore integra CRDT drafts (6 tests nuevos) |
| `dev/settings-kek-mount` | 3 | 597 | 423 | feat(settings): mount <KekRotationPanel /> en Security tab |
| `dev/security-audit-fixes` | 3 | 548 | 389 | test(regulatory): privacyRegimeRegistry — esperar 11 regímenes (no 8) |
| `dev/resilience-health-alert-cron` | 3 | 597 | 421 | feat(observability): resilience health alert cron + FCM (11 tests) |
| `dev/resilience-dashboard-e2e-wire` | 3 | 545 | 394 | feat(observability): cablear ResilienceHealthDashboard end-to-end (5 tests) |
| `dev/report-quick-wins` | 3 | 595 | 413 | feat(infra): audit quick wins — lint real + Firestore session store + Firestor |
| `dev/panel-streaming-wire` | 3 | 599 | 418 | feat(ai): wire streaming tokens del SLM al <ResilientAiAssistantPanel /> |
| `dev/make-fake-premium-pages-real` | 3 | 591 | 417 | fix(typecheck): alinear WearablesIntegration + SecurityShield al shape REAL del  |
| `dev/maintenance-health-mount` | 3 | 598 | 421 | feat(maintenance): mount resilience health alert cron en /api/maintenance |
| `dev/kek-rotation-panel-ui` | 3 | 597 | 423 | feat(settings): mount <KekRotationPanel /> en Security tab (#254) |
| `dev/jsa-engine` | 3 | 597 | 421 | feat(jsa): Job Safety Analysis (AST) engine + ISO 45001 hierarchy (23 tests) |
| `dev/fix-main-typecheck-47-errors` | 3 | 599 | 409 | fix(types): elimina los 47 errores TS pre-existentes que rompían CI |
| `dev/critical-work-permits` | 3 | 597 | 421 | feat(workPermits): validadores profundos izaje/excavación/LOTO (36 tests) |
| `dev/cqrs-real-implementation` | 3 | 590 | 420 | feat(cqrs): CQRS real productivo — Event Store + Incident aggregate + read mod |
| `dev/consolidated-todo-2026-05-15` | 3 | 549 | 406 | docs(todo): consolidar TODO.md como fuente ÚNICA de verdad — audit profundo 2 |
| `dev/codex-fixes-pr250` | 3 | 549 | 399 | fix(audit): atender 3 hallazgos Codex P2 del PR #250 (AI streaming wire) |
| `dev/codex-fixes-plus-fakes` | 3 | 538 | 385 | fix(audit): producir lo pendiente — DIAT WebAuthn + MP HMAC manifest + DTE wir |
| `dev/codex-fixes-audit-pendings` | 3 | 549 | 402 | fix(audit): atender 7 hallazgos Codex de los PRs #263/#264/#266 + TS fix #248 |
| `dev/audit-pendings-real` | 3 | 597 | 410 | fix(erp): reemplazar setTimeout+success simulado con adapter HONESTO multi-modo |
| `dev/ai-response-card-streaming` | 3 | 599 | 418 | feat(ai): wire streaming tokens del SLM al <ResilientAiAssistantPanel /> (#255) |
| `dev/agent-webxr-rename` | 3 | 433 | 244 | feat(webxr): rebrand 'Capacitación AR' → 'Capacitación Interactiva' |
| `dev/agent-visitor-control` | 3 | 411 | 240 | feat(visitors): §23-24 Control de Visitas + Inducción Express QR |
| `dev/agent-ts-noimplicitany-services` | 3 | 443 | 253 | chore(types): enable noImplicitAny + fix src/services/** errors (wave 3) |
| `dev/agent-ts-noimplicitany-rest` | 3 | 375 | 243 | chore(types): noImplicitAny fixes en pages/components/server/__tests__ |
| `dev/agent-supplier-quality` | 3 | 455 | 259 | feat(suppliers): §90-91 Calidad Proveedores + Ranking Riesgo — endpoint + hoo |
| `dev/agent-residual-risk` | 3 | 451 | 263 | feat(residual-risk): §296-301 Riesgo Residual + Aceptación Formal + Criticidad |
| `dev/agent-project-closure` | 3 | 447 | 267 | feat(closure): §131-138 Cierre Proyecto + Lecciones Transferibles + Decisiones  |
| `dev/agent-pricing-calculator` | 3 | 375 | 249 | feat(pricing): §171-179 Pricing Calculator + ROI + OC sugerida EPP |
| `dev/agent-positive-observations` | 3 | 469 | 248 | fix(pr-320): Codex P2 x6 round 2 — symmetric corrective window + period chip w |
| `dev/agent-portable-history` | 3 | 386 | 250 | feat(portable-history): F.18 Historial Profesional Portátil — endpoint + hook |
| `dev/agent-pdca-module` | 3 | 457 | 257 | feat(pdca): §195-200 Ciclo PDCA + No Conformidades — endpoint + hook + page w |
| `dev/agent-occupational-bundle-real` | 3 | 434 | 244 | feat(health): exportOccupationalBundle() wired al vault real |
| `dev/agent-mountain-refuges-real` | 3 | 446 | 264 | fix(mountain-refuges): real CONAF/CAU coordinates + Haversine sorting (audit 202 |
| `dev/agent-mobile-fgs` | 3 | 440 | 270 | feat(mobile): Android Foreground Service nativo para Lone Worker check-in |
| `dev/agent-leadership-decisions` | 3 | 449 | 265 | feat(leadership): §276-277 Bitácora decisiones supervisión + ranking impacto  |
| `dev/agent-knowledge-base` | 3 | 459 | 255 | feat(knowledge-base): §185-190 Base de Conocimiento + Curador + Obsolescencia � |
| `dev/agent-install-blocked-deps` | 3 | 447 | 263 | feat(deps): install 5 authorized blocked deps + activate Tremor charts + MCP std |
| `dev/agent-infra-cleanup-tail` | 3 | 375 | 241 | chore(infra): cleanup long-tail — APP_BASE_URL fix + workflows pin Node 20 + . |
| `dev/agent-incident-trends` | 3 | 390 | 246 | feat(trends): F.29 Indicadores Tendencia Incidentes — endpoint + hook + page w |
| `dev/agent-incident-rag-report` | 3 | 440 | 270 | feat(incidents): wire reportIncident() + POST /api/incidents/report + UI |
| `dev/agent-hazmat-volcanic-wind-real` | 3 | 432 | 243 | feat(hazmat/volcanic): wire viento real via environmentBackend |
| `dev/agent-f7-cphs-minute` | 3 | 475 | 244 | fix(pr-317): Codex P2 x7 round 2 — read canonical writers + filter to draft pe |
| `dev/agent-f6-offline-inspections` | 3 | 465 | 250 | fix(pr-322): Codex P1 x3 + P2 x4 round 2 — multi-user outbox isolation + modul |
| `dev/agent-f5-qr-signature` | 3 | 489 | 244 | fix(pr-313): Codex P1 + P2 x4 — challenge HMAC verify + role gate + biometric  |
| `dev/agent-f26-maturity-indicator` | 3 | 487 | 246 | fix(pr-314): Codex P2 x3 — canonical cphs path + count active feeds + worker v |
| `dev/agent-f21-pre-shift-risk` | 3 | 481 | 248 | fix(pr-311): Codex P2 round 2 — 4 more (incidents/tasks/equipment/visibility) |
| `dev/agent-f20-drills-manager` | 3 | 477 | 247 | fix(pr-316): Codex R2 P1 + P2 x2 — drills firestore indexes + error banners vi |
| `dev/agent-f16-worker-readiness` | 3 | 473 | 244 | fix(pr-315): Codex P1 x2 + P2 x5 round 2 — EPP item names + completed-training |
| `dev/agent-f15-work-permits` | 3 | 485 | 244 | fix(pr-318): Codex P1 x2 + P2 x6 — no auto-attest + server-trusted issuer + st |
| `dev/agent-f13-repeating-risks` | 3 | 479 | 248 | fix(pr-312): Codex P1 + P2 round 2 — Firestore index + occurredAt fallback + f |
| `dev/agent-f12-lessons-learned` | 3 | 483 | 246 | fix(pr-310): Codex P2 round 2 — 3 more (tenant-scope leak + truncated-default  |
| `dev/agent-f-features-ui` | 3 | 392 | 244 | feat(ui): F.14 + F.17 + F.24 + F.27 Wire UI pages |
| `dev/agent-excel-importer` | 3 | 402 | 242 | feat(import): §106-108 Importador Excel + Validador + Deduplicador |
| `dev/agent-event-bus-core` | 3 | 425 | 239 | feat(eventBus+focusBlocks): C.4 event bus global + §201-210 agenda foco core |
| `dev/agent-engineering-controls` | 3 | 463 | 252 | fix(pr-319): Codex P1 x2 + P2 x5 round 2 — general-risk visible server-side +  |
| `dev/agent-emergency-brigade` | 3 | 471 | 246 | fix(pr-321): Codex P2 x10 round 2 — supervisor role + subcollection member che |
| `dev/agent-driving-safety` | 3 | 445 | 269 | feat(driving): §69-71 Conducción Segura + Rutas Críticas + Alertas — endpoi |
| `dev/agent-data-confidence` | 3 | 384 | 251 | feat(data-confidence): §104 Panel Confianza Datos — endpoint + hook + page wi |
| `dev/agent-culture-pulse` | 3 | 461 | 253 | fix(pr-323): Codex P1 x3 + P2 x2 round 2 — openAt time-window check (P2 truly  |
| `dev/agent-confidential-reports` | 3 | 443 | 271 | feat(confidential-reports): §211-213 Reportes Confidenciales + Canal Denuncias  |
| `dev/agent-backend-debt-final` | 3 | 443 | 270 | fix(backend-debt): idempotency on /api/billing/verify + susesoVerifyLimiter test |
| `dev/agent-attendance-demo-cleanup` | 3 | 434 | 244 | chore(attendance): gate demo-block logic by VITE_DEMO_MODE |
| `dev/agent-apprenticeship` | 3 | 388 | 248 | feat(apprentices): §244-250 Aprendices + Mentoría + Autorización Progresiva � |
| `dev/agent-annual-review` | 3 | 453 | 261 | feat(annual-review): §291-295 Revisión Anual SGI + Objetivos + Evidencias —  |
| `dev/agent-analytics-radar-real` | 3 | 434 | 245 | feat(analytics): radar Safety Dimensions derivado real de projectNodes |
| `dev/agent-ai-guardrails` | 3 | 422 | 241 | feat(ai-guardrails): versionedPrompts + citationValidator + hallucinationGuard + |
| `dev/agent-accessibility-modes` | 3 | 389 | 242 | feat(accessibility): §139-145 modos accesibles (lectura facil + alto contraste  |
| `dev/sprint-20-execution-medical-icons-hosted-2026-05-04` | 2 | 2225 | 434 | docs: ADR-0004 medical icons hosted + master plan SLM bundle relax |
| `claude/setup-github-access-9rYY6` | 2 | 2411 | 403 | chore: ignore .claude/ worktrees directory |
| `dev/sprint10-pricing-zettelkasten-2026-05-03` | 1 | 2346 | 401 | test(zettelkasten): registries integrity — count, uniqueness, kebab-case, sour |
| `dev/sprint-20-third-wave-multi-agent-2026-05-04` | 1 | 2195 | 450 | docs(master-plan): reflect Sprint 20 third wave (4 buckets: Iota+Kappa+Lambda+Mu |
| `dev/sprint-20-sixth-wave-multi-agent-2026-05-04` | 1 | 2183 | 445 | docs(master-plan): reflect Sprint 20 sixth wave (Psi+Omega+A-prime+B-prime) |
| `dev/sprint-20-seventh-wave-multi-agent-2026-05-04` | 1 | 2174 | 444 | docs(master-plan): reflect Sprint 20 seventh wave (Mobile-prep+Tracking+Runbooks |
| `dev/sprint-20-second-wave-multi-agent-2026-05-04` | 1 | 2211 | 440 | docs(master-plan): reflect Sprint 20 second wave (Delta + Epsilon + Eta) |
| `dev/sprint-20-multi-agent-execution-2026-05-04` | 1 | 2219 | 433 | docs(master-plan): reflect Sprint 20 multi-agent progress (3 buckets done) |
| `dev/sprint-20-master-plan-end-to-end-2026-05-04` | 1 | 2226 | 432 | chore(gitignore): playwright-report + test-results (local artifacts) + dedupe .c |
| `dev/sprint-20-images-generation-one-by-one-2026-05-04` | 1 | 2187 | 451 | docs(medical): rewrite with 50 standalone prompts (33 medical + 17 informational |
| `dev/sprint-20-icons-bundled-offline-2026-05-04` | 1 | 2224 | 429 | docs: ADR-0004 medical icons bundled for offline + master plan Fase 1b update |
| `dev/sprint-20-fourth-wave-multi-agent-2026-05-04` | 1 | 2191 | 453 | docs(master-plan): reflect Sprint 20 fourth wave (Nu+Xi+Omicron+Pi) |
| `dev/sprint-20-fifth-wave-multi-agent-2026-05-04` | 1 | 2188 | 451 | docs(master-plan): reflect Sprint 20 fifth wave (Rho+Sigma+Tau+Phi) |
| `dev/sprint-20-eighth-wave-multi-agent-2026-05-04` | 1 | 2159 | 452 | fix(ci): use 'cap doctor' for Capacitor config sanity step |
| `dev/sprint-19-orchestrator-debt-cleanup-2026-05-04` | 1 | 2227 | 431 | docs(audit): pending-after-sprint-19 — verified-in-place + deferred to Sprint  |
| `dev/sprint-17c-bioicons-medical-2026-05-04` | 1 | 2240 | 433 | fix(e2e): skip landing tests pending Firebase env mocking in CI (Sprint 19) |
| `dev/sprint-16-gemini-first-ui-2026-05-04` | 1 | 2289 | 423 | feat(safety): FallDetectionMonitor opt-in toggle (battery preservation for non-a |
| `dev/sprint-15-organic-structure-2026-05-04` | 1 | 2307 | 422 | chore(deps): sync package-lock.json after @testing-library/dom devDep addition |
| `dev/sprint-11-12-13-14-multi-2026-05-03` | 1 | 2324 | 416 | test(driving): commute lifecycle + endpoint coverage |
| `dev/multiagent-bernoulli-sweep` | 1 | 2400 | 394 | docs(brand): document 4-mode color theory and semantic token usage |
| `dev/audit-update-2026-05` | 1 | 2399 | 391 | docs(physics): add BERNOULLI_EXTENSIONS.md with 15 use cases for fluid dynamics  |
| `claude/review-pending-tasks-aUDD2` | 1 | 0 | 8 | fix(a11y): ErrorBoundary + ErrorFallback expose <main> landmark + h1 |
| `claude/fix-cloud-run-syntax-0pfGU` | 1 | 2412 | 395 | test(billing): add default export to transbank-sdk mock for ESM/CJS interop fix |
| `claude/code-audit-planning-Ihe1q` | 1 | 1892 | 434 | docs(audit): comprehensive 2026-05-05 audit with non-obvious findings |
| `dev/sprint-40-gstack-pirate-cso-canary-codex-2026-05-06` | 0 | 1560 | 410 | feat(dx): gstack pirate adoption — 6 local replicas (K1-K6) |
| `dev/sprint-39-eonet-usgs-recomendacion-tranquila-2026-05-06` | 0 | 1568 | 420 | ci: real change retrigger CI #77 |
| `dev/sprint-38-cl-adapter-photogrammetry-stryker-locales-2026-05-06` | 0 | 1592 | 433 | ci: retrigger CI (workflows did not auto-fire on PR create) |
| `dev/sprint-37-rebased-2026-05-06` | 0 | 1579 | 410 | Merge remote-tracking branch 'origin/dev/sprint-37-i18n-heavy-slm-otel-w61-2026- |
| `dev/sprint-37-i18n-heavy-slm-otel-w61-2026-05-06` | 0 | 1605 | 429 | fix(test): PublicDemo i18n-agnostic — drop literal text assertion (H3 followup |
| `dev/sprint-36-i18n-massive-wcag-logging-openapi-2026-05-06` | 0 | 1601 | 417 | fix(perf): remove lazy-* entries from size-limit (caused exit 1 on no-match) |
| `dev/sprint-35-rebased-2026-05-06` | 0 | 1587 | 441 | fix(perf): remove lazy-* entries from size-limit (caused exit 1 on no-match) |
| `dev/sprint-35-aptitude-mesh-i18n-cron-idempotency-2026-05-06` | 0 | 1611 | 442 | fix(perf): bump main entry size-limit 340->420KB (Sprint 35 net-new code) |
| `dev/sprint-34-zk-offline-edge-stryker-loadtest-sii-i18n-2026-05-06` | 0 | 1607 | 439 | revert(ci): restore continue-on-error: true on e2e-full-stack (Sprint 34 E7 part |
| `dev/sprint-33-promise-gaps-2026-05-06` | 0 | 1631 | 439 | fix(build): replace node:crypto with @noble/hashes in meshPacket (D3 followup) |
| `dev/sprint-32-iot-mqtt-streaming-ml-coverage-2026-05-05` | 0 | 1637 | 445 | fix(tests): update 4 stale assertions to match post-Sprint-28/29 reality |
| `dev/sprint-31-compliance-apac-tier-global-2026-05-05` | 0 | 1662 | 451 | fix(observability): add Sentry capture to 10 server error paths (Sprint 32 audit |
| `dev/sprint-30-mobile-day1-readiness-2026-05-05` | 0 | 1710 | 461 | Merge branch 'dev/sprint-29-p2p3-features-jurisdictions-2026-05-05' into dev/spr |
| `dev/sprint-29-p2p3-features-jurisdictions-2026-05-05` | 0 | 1743 | 457 | Merge branch 'dev/sprint-28-global-foundation-2026-05-05' into dev/sprint-29-p2p |
| `dev/sprint-28-global-foundation-2026-05-05` | 0 | 1765 | 453 | Merge branch 'dev/sprint-27-audit-p0-fixes-2026-05-05' into dev/sprint-28-global |
| `dev/sprint-27-audit-p0-fixes-2026-05-05` | 0 | 1815 | 439 | Merge branch 'dev/sprint-26-roadmap-execution-2026-05-05' into dev/sprint-27-aud |
| `dev/sprint-26-roadmap-execution-2026-05-05` | 0 | 1821 | 442 | Merge branch 'dev/sprint-25-gaps-cleanup-2026-05-05' into dev/sprint-26-roadmap- |
| `dev/sprint-25-gaps-cleanup-2026-05-05` | 0 | 1844 | 436 | fix(ci): allowlist color-contrast a11y violations (tracked debt Sprint 33+) |
| `dev/sprint-21-debt-cleanup-2026-05-04` | 0 | 2070 | 413 | feat(mobile): Universal Links iOS + App Links Android — deep linking config-on |
| `dev/sprint-20-twelfth-wave-multi-agent-2026-05-04` | 0 | 2134 | 448 | fix(test): hmac mutation test uses middle char (not last) |
| `dev/sprint-20-thirteenth-wave-multi-agent-2026-05-04` | 0 | 2134 | 447 | docs(master-plan): 13va ola registrada (a11y closure + i18n locales + CSP nonce  |
| `dev/sprint-20-tenth-wave-multi-agent-2026-05-04` | 0 | 2139 | 455 | docs(master-plan): décima ola registrada (analytics x6 + Sentry alerts + perf - |
| `dev/sprint-20-sixteenth-wave-multi-agent-2026-05-04` | 0 | 2128 | 425 | docs(master-plan): 16va ola registrada (Stryker uplift confirmed + analytics 46/ |
| `dev/sprint-20-seventeenth-wave-multi-agent-2026-05-04` | 0 | 2128 | 413 | chore(perf): raise main entry size limit 300 → 310 KB (gzipped) |
| `dev/sprint-20-ninth-wave-multi-agent-2026-05-04` | 0 | 2149 | 455 | docs(master-plan): novena ola registrada (TM-I03 + TM-T03 cerrados, stryker unif |
| `dev/sprint-20-nineteenth-wave-multi-agent-2026-05-04` | 0 | 2126 | 407 | docs(master-plan): 19va ola — Stryker 14/14 baseline COMPLETE |
| `dev/sprint-20-fourteenth-wave-multi-agent-2026-05-04` | 0 | 2133 | 438 | docs(master-plan): 14va ola registrada (a11y final 0/2/18 + analytics 30/45 + i1 |
| `dev/sprint-20-fifteenth-wave-multi-agent-2026-05-04` | 0 | 2130 | 435 | docs(master-plan): 15va ola registrada (Stryker test gaps + analytics 35/45 + i1 |
| `dev/sprint-20-euler-wave-2-2026-05-04` | 0 | 2108 | 406 | docs(billing): TRANSBANK_RUNBOOK + .env.example WEBPAY_* vars |
| `dev/sprint-20-euler-wave-1-2026-05-04` | 0 | 2116 | 406 | docs(master-plan): Euler-1 ola registrada — Fases 1, 3, 6, 10 + spec doc |
| `dev/sprint-20-eleventh-wave-multi-agent-2026-05-04` | 0 | 2136 | 454 | docs(master-plan): undécima ola registrada (a11y fixes + analytics x4 + i18n x6 |
| `dev/sprint-20-eighteenth-wave-multi-agent-2026-05-04` | 0 | 2128 | 410 | docs(master-plan): 18va ola registrada — deuda técnica accionable mayormente  |
| `claude/technical-debt-documentation-pd2gN` | 0 | 1533 | 414 | feat(todo): añadir 22 ítems de auditoría técnica faltantes al manifiesto |
| `claude/system-engine-foundation-2026-05-06` | 0 | 1497 | 417 | fix(systemEngine): typecheck — JSX.Element + QueryConstraint typing |
| `claude/informe-avance-notebooklm` | 0 | 1531 | 415 | docs(informe): incorpora la lente de TECHNICAL_DEBT_AUDIT.md |
| `claude/impl-roadmap-life-safety` | 0 | 1533 | 414 | docs(roadmap): expand roadmap to 1503 lines + configure dev port 57335 |

---
Generado: 2026-05-19T21:34:44+00:00
