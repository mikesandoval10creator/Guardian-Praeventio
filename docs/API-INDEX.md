# API Index — catálogo completo de rutas HTTP (AUTO-GENERADO)

<!-- DO NOT EDIT BY HAND. Run: node scripts/gen-api-index.cjs  (gate: --check) -->
<!-- ponytail: regex scan, no TS AST. Misses dynamic paths / router.route() chains / sub-routers. -->

Índice de **dónde vive cada dato real**. Si una ruta no aparece aquí, no existe o es
ficticia → no cablear contra ella. Generado de `server.ts` (mounts `app.use`) +
`src/server/routes/*`. Para el detalle curado de auth/audit/idempotency de las rutas
clave ver `docs/api-routes.md`.

**196 routers montados · 688 rutas detectadas.**

### `src/server/routes/audit.ts` → `/api`
- `POST /api/audit-log`
- `GET /api/audit-log`

### `src/server/routes/externalAuditPortal.ts` → `/api`
- `POST /api/audit-portal/create`
- `GET /api/audit-portal/admin/list`
- `POST /api/audit-portal/:portalId/revoke`
- `GET /api/audit-portal/:portalId/access-log`
- `GET /api/audit-portal/public/:token`

### `src/server/routes/gamification.ts` → `/api`
- `POST /api/gamification/points`
- `GET /api/gamification/leaderboard`
- `POST /api/gamification/check-medals`
- `POST /api/coach/chat`

### `src/server/routes/gemini.ts` → `/api`
- `POST /api/ask-guardian`
- `POST /api/gemini`
- `POST /api/gemini/stream`

### `src/server/routes/health.ts` → `/api`
- `GET /api/health`
- `GET /api/health/deep`

### `src/server/routes/import.ts` → `/api`
- `POST /api/import/excel`
- `POST /api/import/commit`

### `src/server/routes/misc.ts` → `/api`
- `GET /api/environment/forecast`
- `POST /api/erp/sync`
- `POST /api/seed-glossary`
- `POST /api/seed-data`
- `GET /api/legal/check-updates`

### `src/server/routes/onboarding.ts` → `/api`
- `POST /api/onboarding/complete`

### `src/server/routes/openapi.ts` → `/api`
- `GET /api/openapi.json`
- `GET /api/openapi.html`

### `src/server/routes/organic.ts` → `/api`
- `POST /api/crews`
- `POST /api/crews/:id/members`
- `POST /api/processes`
- `POST /api/processes/:id/close`
- `POST /api/processes/:id/status`
- `POST /api/processes/:id/tasks`
- `POST /api/predictive-alerts/ack`
- `POST /api/tasks/:id/done`
- `GET /api/processes`
- `GET /api/projects/:projectId/roster`

### `src/server/routes/reports.ts` → `/api`
- `POST /api/reports/generate-pdf`

### `src/server/routes/telemetry.ts` → `/api`
- `POST /api/telemetry/ingest`
- `POST /api/admin/iot/rotate-secret`

### `src/server/routes/wisdomCapsule.ts` → `/api`
- `GET /api/wisdom-capsule/stats`
- `GET /api/wisdom-capsule/today`
- `POST /api/wisdom-capsule/ack`

### `src/server/routes/account.ts` → `/api/account`
- `POST /api/account/anonymize`

### `src/server/routes/admin.ts` → `/api/admin`
- `POST /api/admin/revoke-access`
- `POST /api/admin/webauthn/revoke`
- `POST /api/admin/set-role`
- `POST /api/admin/replicate-critical`
- `POST /api/admin/jobs/weekly-digest`
- `POST /api/admin/jobs/climate-scan`
- `GET /api/admin/quotas`
- `GET /api/admin/quotas/global`
- `POST /api/admin/quotas/reset`
- `GET /api/admin/circuit-state`
- `POST /api/admin/sync/clear-user-queue`
- `GET /api/admin/sync/stats`

### `src/server/routes/b2dAdmin.ts` → `/api/admin/b2d`
- `GET /api/admin/b2d/keys`
- `POST /api/admin/b2d/keys`
- `POST /api/admin/b2d/keys/:id/revoke`
- `GET /api/admin/b2d/metrics`
- `GET /api/admin/b2d/mrr-history`
- `GET /api/admin/b2d/events`

### `src/server/routes/adminJobs.ts` → `/api/admin/jobs`
- `POST /api/admin/jobs/aggregate-ai-feedback`

### `src/server/routes/aiFeedback.ts` → `/api/ai`
- `POST /api/ai/feedback`
- `GET /api/ai/feedback/summary`

### `src/server/routes/b2d/index.ts` → `/api/b2d/v1`
- _(no inline route decls found — router.route() chain or sub-router)_

### `src/server/routes/cad.ts` → `/api/cad`
- `POST /api/cad/convert-dwg`

### `src/server/routes/commute.ts` → `/api/commute`
- `POST /api/commute/start`
- `POST /api/commute/sample`
- `POST /api/commute/end`

### `src/server/routes/compliance.ts` → `/api/compliance`
- `GET /api/compliance/processing-activities`
- `POST /api/compliance/consent`
- `DELETE /api/compliance/consent/:purpose`
- `GET /api/compliance/consent`
- `POST /api/compliance/data-request`
- `GET /api/compliance/data-request/:id`
- `GET /api/compliance/data-export/:requestId`
- `POST /api/compliance/admin/data-request/:id/process`
- `POST /api/compliance/admin/data-request/:id/erase`
- `GET /api/compliance/:projectId/traffic-light`

### `src/server/routes/ds67.ts` → `/api/compliance`
- `GET /api/compliance/:projectId/ds67/simulator/prefill`
- `POST /api/compliance/:projectId/ds67/simulator/simulate`

### `src/server/routes/ds67ds76.ts` → `/api/compliance`
- `POST /api/compliance/ds67`
- `GET /api/compliance/ds67/:formId/pdf`
- `GET /api/compliance/ds67/:formId/sign-challenge`
- `POST /api/compliance/ds67/:formId/sign`
- `POST /api/compliance/ds76`
- `GET /api/compliance/ds76/:formId/pdf`
- `GET /api/compliance/ds76/:formId/sign-challenge`
- `POST /api/compliance/ds76/:formId/sign`

### `src/server/routes/complianceEmit.ts` → `/api/compliance/emit`
- `POST /api/compliance/emit/:type`

### `src/server/routes/dte.ts` → `/api/dte`
- `POST /api/dte/create`
- `GET /api/dte/sign-challenge`
- `GET /api/dte/:folio`
- `POST /api/dte/:folio/cancel`
- `POST /api/dte/generate`

### `src/server/routes/emergency.ts` → `/api/emergency`
- `POST /api/emergency/sos`
- `POST /api/emergency/notify-brigada`

### `src/server/routes/emergency.ts` → `/api/emergency`
- `POST /api/emergency/sos`
- `POST /api/emergency/notify-brigada`

### `src/server/routes/evacuationHeadcount.ts` → `/api/evacuation`
- `POST /api/evacuation/start`
- `POST /api/evacuation/scan-qr`
- `GET /api/evacuation/status`
- `POST /api/evacuation/end`

### `src/server/routes/healthVault.ts` → `/api/health-vault`
- `POST /api/health-vault/share`
- `GET /api/health-vault/view/:tokenId/:secret`
- `GET /api/health-vault/view/:tokenId/:secret/file/:recordId`
- `POST /api/health-vault/share/:tokenId/revoke`

### `src/server/routes/incidents.ts` → `/api/incidents`
- `POST /api/incidents/report`

### `src/server/routes/insights.ts` → `/api/insights`
- `GET /api/insights/:projectId/risk-ranking`
- `GET /api/insights/:projectId/top-risks`
- `GET /api/insights/:projectId/weak-controls`
- `GET /api/insights/:projectId/risk-timeseries`
- `GET /api/insights/:projectId/safety-talks`
- `GET /api/insights/:projectId/role-view`

### `src/server/routes/iot.ts` → `/api/iot`
- `POST /api/iot/devices/register`

### `src/server/routes/legalReconcile.ts` → `/api/legal`
- `POST /api/legal/:projectId/reconcile-obligations`

### `src/server/routes/maintenance.ts` → `/api/maintenance`
- `POST /api/maintenance/check-overdue`
- `POST /api/maintenance/run-b2d-mrr-snapshot`
- `POST /api/maintenance/run-lone-worker-escalation`
- `POST /api/maintenance/run-man-down-escalation`
- `POST /api/maintenance/run-daily-housekeeping`

### `src/server/routes/medicalAptitude.ts` → `/api/medical`
- `POST /api/medical/aptitude-cert/generate`
- `GET /api/medical/aptitude-cert/sign-challenge`
- `POST /api/medical/aptitude-cert/sign`

### `src/server/routes/mesh.ts` → `/api/mesh`
- `GET /api/mesh/key`

### `src/server/routes/projectHealth.ts` → `/api/projects`
- `POST /api/projects/:projectId/health-check`

### `src/server/routes/suseso.ts` → `/api/public/suseso`
- `POST /api/public/suseso/form`
- `POST /api/public/suseso/form/:id/sign`
- `GET /api/public/suseso/form/:id/sign-challenge`
- `POST /api/public/suseso/form/:id/submit`
- `POST /api/public/suseso/forms/:formId/mark-submitted`
- `GET /api/public/suseso/verify/:folio`

### `src/server/routes/push.ts` → `/api/push`
- `POST /api/push/register-token`

### `src/server/routes/rubroBenchmarks.ts` → `/api/sii`
- `GET /api/sii/:projectId/rubro-benchmarks`

### `src/server/routes/sitebook.ts` → `/api/sitebook`
- `GET /api/sitebook/:projectId/entries`
- `GET /api/sitebook/:projectId/entry/:folio`
- `POST /api/sitebook/:projectId/entries`

### `src/server/routes/adminBurden.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/admin-burden/report`
- `POST /api/sprint-k/:projectId/admin-burden/suggest-automations`

### `src/server/routes/adoption.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/adoption/module-adoption`
- `POST /api/sprint-k/:projectId/adoption/funnel`
- `POST /api/sprint-k/:projectId/adoption/churn-risk`
- `POST /api/sprint-k/:projectId/adoption/first-value`

### `src/server/routes/agenda.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/agenda/schedule-reminders`
- `POST /api/sprint-k/:projectId/agenda/select-channel`
- `POST /api/sprint-k/:projectId/agenda/should-deliver`
- `POST /api/sprint-k/:projectId/agenda/in-focus-block`
- `POST /api/sprint-k/:projectId/agenda/build-daily-digest`

### `src/server/routes/aggregateTelemetry.ts` → `/api/sprint-k`
- `GET /api/sprint-k/:projectId/telemetry/aggregate`
- `GET /api/sprint-k/tenants/:tenantId/telemetry/rollup`

### `src/server/routes/aiGuardrails.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/ai-guardrails/get-prompt`
- `POST /api/sprint-k/:projectId/ai-guardrails/get-latest-version`
- `POST /api/sprint-k/:projectId/ai-guardrails/list-versions`
- `POST /api/sprint-k/:projectId/ai-guardrails/list-prompt-ids`
- `POST /api/sprint-k/:projectId/ai-guardrails/get-catalog`
- `POST /api/sprint-k/:projectId/ai-guardrails/render-prompt-body`
- `POST /api/sprint-k/:projectId/ai-guardrails/find-unresolved-placeholders`
- `POST /api/sprint-k/:projectId/ai-guardrails/extract-citations`
- `POST /api/sprint-k/:projectId/ai-guardrails/validate-response`
- `POST /api/sprint-k/:projectId/ai-guardrails/guard-hallucination`

### `src/server/routes/aiQuality.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/ai-quality/log-response`
- `POST /api/sprint-k/:projectId/ai-quality/assert-human-gated`
- `POST /api/sprint-k/:projectId/ai-quality/record-human-decision`
- `POST /api/sprint-k/:projectId/ai-quality/record-override`
- `POST /api/sprint-k/:projectId/ai-quality/rate-entry`
- `POST /api/sprint-k/:projectId/ai-quality/summarize`

### `src/server/routes/aiToggle.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/ai-mode/decide`
- `POST /api/sprint-k/:projectId/ai-mode/rules-only-check`
- `POST /api/sprint-k/:projectId/ai-mode/rule-drift`

### `src/server/routes/annualReview.ts` → `/api/sprint-k`
- `GET /api/sprint-k/:projectId/annual-review/current`
- `POST /api/sprint-k/:projectId/annual-review/objectives`
- `POST /api/sprint-k/:projectId/annual-review/evidence`
- `POST /api/sprint-k/:projectId/annual-review/conclude`

### `src/server/routes/apprenticeship.ts` → `/api/sprint-k`
- `GET /api/sprint-k/:projectId/apprentices`
- `POST /api/sprint-k/:projectId/apprentices`
- `POST /api/sprint-k/:projectId/apprentices/:uid/authorize`
- `POST /api/sprint-k/:projectId/apprentices/:uid/expose`
- `GET /api/sprint-k/:projectId/mentors/availability`

### `src/server/routes/auditChain.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/audit-chain/append`
- `POST /api/sprint-k/:projectId/audit-chain/verify`
- `POST /api/sprint-k/:projectId/audit-chain/anchor`
- `POST /api/sprint-k/:projectId/audit-chain/find-gap`

### `src/server/routes/auditPortal.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/audit-portal/create-portal`
- `POST /api/sprint-k/:projectId/audit-portal/derive-status`
- `POST /api/sprint-k/:projectId/audit-portal/revoke`
- `POST /api/sprint-k/:projectId/audit-portal/check-access`
- `POST /api/sprint-k/:projectId/audit-portal/summarize-usage`
- `POST /api/sprint-k/:projectId/audit-portal/generate-token`

### `src/server/routes/bbs.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/bbs/record-observation`
- `POST /api/sprint-k/:projectId/bbs/build-profile`

### `src/server/routes/bowtie.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/bowtie/build`
- `POST /api/sprint-k/:projectId/bowtie/list-unprotected-threats`
- `POST /api/sprint-k/:projectId/bowtie/recommend-next-barrier`

### `src/server/routes/cealSm.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/ceal-sm/campaigns`
- `GET /api/sprint-k/:projectId/ceal-sm/campaigns`
- `POST /api/sprint-k/:projectId/ceal-sm/campaigns/:id/respond`
- `GET /api/sprint-k/:projectId/ceal-sm/campaigns/:id/results`

### `src/server/routes/changeMgmt.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/change-mgmt/declare`
- `POST /api/sprint-k/:projectId/change-mgmt/acknowledge`
- `POST /api/sprint-k/:projectId/change-mgmt/revert`
- `POST /api/sprint-k/:projectId/change-mgmt/summarize-acks`

### `src/server/routes/checklistBuilder.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/checklists/validate-response`
- `POST /api/sprint-k/:projectId/checklists/rectify-field`
- `POST /api/sprint-k/:projectId/checklists/apply-signature`
- `POST /api/sprint-k/:projectId/checklists/lock-response`

### `src/server/routes/circadian.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/circadian/classify-window`
- `POST /api/sprint-k/:projectId/circadian/assess-alertness`
- `POST /api/sprint-k/:projectId/circadian/recommend-shift-rotation`

### `src/server/routes/climateAwareScheduling.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/climate-scheduling/assess-task`
- `POST /api/sprint-k/:projectId/climate-scheduling/build-daily-plan`

### `src/server/routes/coachRag.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/coach-rag/search-top-k`
- `POST /api/sprint-k/:projectId/coach-rag/list-chunks`
- `POST /api/sprint-k/:projectId/coach-rag/get-domain-prompt`

### `src/server/routes/comms.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/comms/best-channel-for-zone`
- `POST /api/sprint-k/:projectId/comms/detect-dead-zones`
- `POST /api/sprint-k/:projectId/comms/compute-escalation`
- `POST /api/sprint-k/:projectId/comms/build-contactability-report`
- `POST /api/sprint-k/:projectId/comms/plan-channel-failover`

### `src/server/routes/commsDrill.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/comms-drills/list-scripts`
- `POST /api/sprint-k/:projectId/comms-drills/get-by-id`
- `POST /api/sprint-k/:projectId/comms-drills/score`
- `POST /api/sprint-k/:projectId/comms-drills/plan-schedule`

### `src/server/routes/confidentialReports.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/confidential-reports`
- `GET /api/sprint-k/:projectId/confidential-reports`
- `POST /api/sprint-k/:projectId/confidential-reports/:id/respond`
- `POST /api/sprint-k/:projectId/confidential-reports/:id/close`
- `GET /api/sprint-k/:projectId/confidential-reports/retaliation-alerts`

### `src/server/routes/conflictQueue.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/conflict-queue/enqueue`
- `GET /api/sprint-k/:projectId/conflict-queue`
- `POST /api/sprint-k/:projectId/conflict-queue/:queueId/mark-in-review`
- `POST /api/sprint-k/:projectId/conflict-queue/:queueId/resolve`
- `POST /api/sprint-k/:projectId/conflict-queue/:queueId/reject`

### `src/server/routes/consistency.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/consistency/run-audit`
- `POST /api/sprint-k/:projectId/consistency/summarize-audit`

### `src/server/routes/consultativeSale.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/sales/build-playbook`

### `src/server/routes/contingencySimulation.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/contingency/build-scenario`
- `POST /api/sprint-k/:projectId/contingency/list-available-scenarios`
- `POST /api/sprint-k/:projectId/contingency/count-available-templates`
- `POST /api/sprint-k/:projectId/contingency/evaluate-tabletop`

### `src/server/routes/continuity.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/continuity/detect-spofs`
- `POST /api/sprint-k/:projectId/continuity/simulate-outage`
- `POST /api/sprint-k/:projectId/continuity/build-polyvalence-plan`

### `src/server/routes/contractors.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/contractors/compute-kpi`
- `POST /api/sprint-k/:projectId/contractors/rank-by-risk`
- `POST /api/sprint-k/:projectId/contractors/acreditation-gap-report`

### `src/server/routes/controlComparator.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/controls/compare`
- `POST /api/sprint-k/:projectId/controls/failures/lookup`
- `POST /api/sprint-k/:projectId/controls/failures/suggest`
- `GET /api/sprint-k/:projectId/controls/failures/summary`

### `src/server/routes/correctiveActions.ts` → `/api/sprint-k`
- `GET /api/sprint-k/:projectId/corrective-actions`
- `POST /api/sprint-k/:projectId/corrective-actions/:actionId/effectiveness-review`
- `POST /api/sprint-k/:projectId/corrective-actions`

### `src/server/routes/costCalculator.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/cost-calculator/non-compliance`
- `POST /api/sprint-k/:projectId/cost-calculator/prevention-roi`

### `src/server/routes/cphsMinute.ts` → `/api/sprint-k`
- `GET /api/sprint-k/:projectId/cphs/draft-minute`
- `POST /api/sprint-k/:projectId/cphs/actas`
- `POST /api/sprint-k/:projectId/cphs/actas/:actaId/acuerdos`
- `PATCH /api/sprint-k/:projectId/cphs/actas/:actaId/acuerdos/:acuerdoId`

### `src/server/routes/criticalControls.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/critical-controls/get-for-risk`
- `POST /api/sprint-k/:projectId/critical-controls/validate-pre-task`
- `POST /api/sprint-k/:projectId/critical-controls/robustness-score`
- `POST /api/sprint-k/:projectId/critical-controls/superior-to`
- `POST /api/sprint-k/:projectId/critical-controls/build-barrier-analysis`
- `POST /api/sprint-k/:projectId/critical-controls/detect-single-barrier`
- `POST /api/sprint-k/:projectId/critical-controls/verification-status`
- `POST /api/sprint-k/:projectId/critical-controls/energy-for-control`
- `POST /api/sprint-k/:projectId/critical-controls/by-energy`

### `src/server/routes/criticalRoles.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/critical-roles/for-industry`
- `POST /api/sprint-k/:projectId/critical-roles/find-by-code`
- `POST /api/sprint-k/:projectId/critical-roles/build-coverage`
- `POST /api/sprint-k/:projectId/critical-roles/suggest-training`

### `src/server/routes/culturePulse.ts` → `/api/sprint-k`
- `GET /api/sprint-k/:projectId/culture-pulse`
- `GET /api/sprint-k/openAt`
- `GET /api/sprint-k/closeAt`
- `GET /api/sprint-k/closeAt`
- `POST /api/sprint-k/:projectId/culture-pulse/survey`
- `POST /api/sprint-k/:projectId/culture-pulse/survey/:id/respond`
- `GET /api/sprint-k/:projectId/culture-pulse/history`
- `GET /api/sprint-k/openAt`
- `GET /api/sprint-k/openAt`

### `src/server/routes/custodyChain.ts` → `/api/sprint-k`
- `GET /api/sprint-k/:projectId/evidence-by-node/:nodeId`
- `GET /api/sprint-k/:projectId/evidence/:hash`
- `POST /api/sprint-k/:projectId/evidence`
- `POST /api/sprint-k/:projectId/evidence/:hash/replace`
- `POST /api/sprint-k/:projectId/evidence/:hash/access`
- `POST /api/sprint-k/:projectId/evidence/:hash/export`

### `src/server/routes/dataConfidence.ts` → `/api/sprint-k`
- `GET /api/sprint-k/:projectId/data-confidence`
- `POST /api/sprint-k/:projectId/data-confidence/dismiss/:issueId`
- `GET /api/sprint-k/:projectId/data-confidence/recommendations`

### `src/server/routes/dataQuality.ts` → `/api/sprint-k`
- `GET /api/sprint-k/:projectId/data-quality`
- `GET /api/sprint-k/:projectId/document-hygiene`

### `src/server/routes/deduplication.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/deduplication/detect`
- `POST /api/sprint-k/:projectId/deduplication/build-merge-plan`

### `src/server/routes/documentVersioning.ts` → `/api/sprint-k`
- `GET /api/sprint-k/:projectId/documents/:documentId/chain`
- `GET /api/sprint-k/:projectId/documents/:documentId/active`
- `POST /api/sprint-k/:projectId/documents/:documentId/versions`
- `POST /api/sprint-k/:projectId/documents/:documentId/versions/:versionId/status`
- `GET /api/sprint-k/:projectId/documents/:documentId/changelog`

### `src/server/routes/drillsManager.ts` → `/api/sprint-k`
- `GET /api/sprint-k/:projectId/drills`
- `GET /api/sprint-k/:projectId/drills/:drillId`
- `POST /api/sprint-k/:projectId/drills/plan`
- `POST /api/sprint-k/:projectId/drills/:drillId/execute`

### `src/server/routes/driving.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/driving/haversine-meters`
- `POST /api/sprint-k/:projectId/driving/accumulate-trip-mileage`
- `POST /api/sprint-k/:projectId/driving/detect-aggressive-brake`

### `src/server/routes/drivingSafety.ts` → `/api/sprint-k`
- `GET /api/sprint-k/:projectId/driving/routes`
- `POST /api/sprint-k/:projectId/driving/routes`
- `POST /api/sprint-k/:projectId/driving/routes/:id/alert`
- `GET /api/sprint-k/:projectId/driving/drivers`
- `POST /api/sprint-k/:projectId/driving/drivers/:uid/journey`
- `GET /api/sprint-k/:projectId/driving/ranking`
- `POST /api/sprint-k/:projectId/driving/incidents`

### `src/server/routes/efficacyVerification.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/efficacy/verify`
- `POST /api/sprint-k/:projectId/efficacy/default-window`

### `src/server/routes/emergencyBrigade.ts` → `/api/sprint-k`
- `GET /api/sprint-k/:projectId/emergency-brigade`
- `POST /api/sprint-k/:projectId/emergency-brigade/members`
- `POST /api/sprint-k/:projectId/emergency-brigade/resources`
- `POST /api/sprint-k/:projectId/emergency-brigade/resources/:id/inspect`

### `src/server/routes/engineeringControls.ts` → `/api/sprint-k`
- `GET /api/sprint-k/:projectId/engineering-controls`
- `POST /api/sprint-k/:projectId/engineering-controls`
- `POST /api/sprint-k/:projectId/engineering-controls/:id/verify`

### `src/server/routes/eppFlow.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/epp-flow/inspection`
- `GET /api/sprint-k/:projectId/epp-flow/pending-orders`
- `POST /api/sprint-k/:projectId/epp-flow/sign-order/:orderId`
- `GET /api/sprint-k/:projectId/epp-flow/order-pdf/:orderId`

### `src/server/routes/equipment.ts` → `/api/sprint-k`
- `GET /api/sprint-k/:projectId/equipment`

### `src/server/routes/equipmentQr.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/equipment-qr/register`
- `GET /api/sprint-k/:projectId/equipment-qr/list-by-site`
- `GET /api/sprint-k/:projectId/equipment-qr/:qrId`
- `POST /api/sprint-k/:projectId/equipment-qr/:qrId/preuse`
- `GET /api/sprint-k/:projectId/equipment-qr/:qrId/history`

### `src/server/routes/ergonomics.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/ergonomics/calculate-reba`
- `POST /api/sprint-k/:projectId/ergonomics/calculate-rula`
- `POST /api/sprint-k/:projectId/ergonomics/legal-trigger`

### `src/server/routes/escalation.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/escalation/sla-minutes`
- `POST /api/sprint-k/:projectId/escalation/assess-sla`
- `POST /api/sprint-k/:projectId/escalation/decide`
- `POST /api/sprint-k/:projectId/escalation/apply`
- `POST /api/sprint-k/:projectId/escalation/process-batch`

### `src/server/routes/evacuation.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/evacuation/compute-status`
- `POST /api/sprint-k/:projectId/evacuation/record-scan`
- `POST /api/sprint-k/:projectId/evacuation/end-drill`
- `POST /api/sprint-k/:projectId/evacuation/build-postmortem`

### `src/server/routes/eventReplay.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/event-replay/execute`
- `POST /api/sprint-k/:projectId/event-replay/diff-states`
- `POST /api/sprint-k/:projectId/event-replay/export-trail`

### `src/server/routes/exceptions.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/exceptions/create`
- `POST /api/sprint-k/:projectId/exceptions/derive-status`
- `POST /api/sprint-k/:projectId/exceptions/revoke`
- `POST /api/sprint-k/:projectId/exceptions/mark-fulfilled`
- `POST /api/sprint-k/:projectId/exceptions/filter-active-at`
- `POST /api/sprint-k/:projectId/exceptions/summarize`

### `src/server/routes/expirations.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/expirations/scan`
- `POST /api/sprint-k/:projectId/expirations/build-finding-payload`
- `GET /api/sprint-k/:projectId/expirations/list`

### `src/server/routes/explainability.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/explainability/recommendation`
- `POST /api/sprint-k/:projectId/explainability/batch`

### `src/server/routes/expressBundle.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/express-bundle/build`

### `src/server/routes/fatigue.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/fatigue/assess`

### `src/server/routes/firstResponderMap.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/first-responder-map/build-dispatch-plan`
- `POST /api/sprint-k/:projectId/first-responder-map/analyze-coverage`
- `GET /api/sprint-k/:projectId/first-responder-map/responder-feed`

### `src/server/routes/fiveS.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/five-s/checklist`
- `POST /api/sprint-k/:projectId/five-s/build-report`
- `POST /api/sprint-k/:projectId/five-s/rank-zones`

### `src/server/routes/formBuilderAdvanced.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/forms-advanced/evaluate-computed-field`
- `POST /api/sprint-k/:projectId/forms-advanced/validate-cross-field`
- `POST /api/sprint-k/:projectId/forms-advanced/detect-circular-deps`
- `POST /api/sprint-k/:projectId/forms-advanced/topo-sort`
- `POST /api/sprint-k/:projectId/forms-advanced/evaluate-all-computed`

### `src/server/routes/geofencePermissions.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/geofence-permissions/decide-ux`

### `src/server/routes/hazmatInventory.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/hazmat/substance`
- `POST /api/sprint-k/:projectId/hazmat/substance/get`
- `POST /api/sprint-k/:projectId/hazmat/inventory`
- `POST /api/sprint-k/:projectId/hazmat/substance/update`
- `POST /api/sprint-k/:projectId/hazmat/substance/delete`
- `POST /api/sprint-k/:projectId/hazmat/compatibility-check`
- `POST /api/sprint-k/:projectId/hazmat/spill-plan`

### `src/server/routes/horometro.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/horometro/reading`
- `GET /api/sprint-k/:projectId/horometro/equipment/:eqId/maintenance-tasks`
- `POST /api/sprint-k/:projectId/horometro/maintenance-task/:taskId/complete`

### `src/server/routes/hygiene.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/hygiene/bmr`
- `POST /api/sprint-k/:projectId/hygiene/current-burn`

### `src/server/routes/inbox.ts` → `/api/sprint-k`
- `GET /api/sprint-k/:projectId/inbox`

### `src/server/routes/incidentBundle.ts` → `/api/sprint-k`
- `GET /api/sprint-k/:projectId/incidents/:incidentId/bundle`

### `src/server/routes/incidentFlow.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/incident-flow/report`
- `POST /api/sprint-k/:projectId/incident-flow/:incidentId/open-investigation`
- `POST /api/sprint-k/:projectId/incident-flow/:incidentId/conclude-investigation`
- `POST /api/sprint-k/:projectId/incident-flow/:incidentId/publish-lesson`
- `POST /api/sprint-k/:projectId/incident-flow/:incidentId/assign-microtraining`
- `POST /api/sprint-k/:projectId/incident-flow/training/:assignmentId/complete`
- `GET /api/sprint-k/:projectId/incident-flow/:incidentId/status`

### `src/server/routes/incidentTrends.ts` → `/api/sprint-k`
- `GET /api/sprint-k/:projectId/incidents/trends`
- `GET /api/sprint-k/:projectId/incidents/list`

### `src/server/routes/industryRules.ts` → `/api/sprint-k`
- `GET /api/sprint-k/:projectId/industry/list`
- `POST /api/sprint-k/:projectId/industry/select`
- `GET /api/sprint-k/:projectId/industry/applicable-norms`
- `GET /api/sprint-k/:projectId/industry/required-epp`
- `GET /api/sprint-k/:projectId/industry/typical-hazards`

### `src/server/routes/jsa.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/jsa/validate`
- `POST /api/sprint-k/:projectId/jsa/compute-residual-risks`
- `POST /api/sprint-k/:projectId/jsa/finalize`

### `src/server/routes/knowledgeBase.ts` → `/api/sprint-k`
- `GET /api/sprint-k/:projectId/knowledge-base`
- `POST /api/sprint-k/:projectId/knowledge-base`
- `POST /api/sprint-k/:projectId/knowledge-base/:id/use`
- `POST /api/sprint-k/:projectId/knowledge-base/:id/flag-obsolete`

### `src/server/routes/leadership.ts` → `/api/sprint-k`
- `GET /api/sprint-k/:projectId/leadership/decisions`
- `POST /api/sprint-k/:projectId/leadership/decisions`
- `GET /api/sprint-k/:projectId/leadership/ranking`

### `src/server/routes/legalObligations.ts` → `/api/sprint-k`
- `GET /api/sprint-k/:projectId/legal-calendar/upcoming`
- `GET /api/sprint-k/:projectId/legal-calendar/overdue`
- `POST /api/sprint-k/:projectId/legal-calendar/acknowledge`
- `POST /api/sprint-k/:projectId/legal-calendar/snooze`
- `GET /api/sprint-k/:projectId/legal-calendar/history`

### `src/server/routes/lessonsLearned.ts` → `/api/sprint-k`
- `GET /api/sprint-k/:projectId/lessons`
- `POST /api/sprint-k/:projectId/lessons`

### `src/server/routes/loneWorker.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/lone-worker/start-session`
- `POST /api/sprint-k/:projectId/lone-worker/check-in`
- `POST /api/sprint-k/:projectId/lone-worker/end-session`
- `POST /api/sprint-k/:projectId/lone-worker/derive-status`
- `POST /api/sprint-k/:projectId/lone-worker/decide-escalation`
- `POST /api/sprint-k/:projectId/lone-worker/admin-overview`

### `src/server/routes/loto.ts` → `/api/sprint-k`
- `GET /api/sprint-k/:projectId/loto`
- `POST /api/sprint-k/:projectId/loto`
- `POST /api/sprint-k/:projectId/loto/:appId/apply-lock`
- `POST /api/sprint-k/:projectId/loto/:appId/verify-zero-energy`
- `POST /api/sprint-k/:projectId/loto/:appId/release`

### `src/server/routes/maturity.ts` → `/api/sprint-k`
- `GET /api/sprint-k/:projectId/maturity-index`

### `src/server/routes/medicalCatalogs.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/medical-catalogs/diagnoses/search`
- `POST /api/sprint-k/:projectId/medical-catalogs/drugs/search`
- `POST /api/sprint-k/:projectId/medical-catalogs/anatomy/search`
- `POST /api/sprint-k/:projectId/medical-catalogs/diagnoses/by-risk-agent`
- `POST /api/sprint-k/:projectId/medical-catalogs/anatomy/by-system`
- `POST /api/sprint-k/:projectId/medical-catalogs/list-meta`

### `src/server/routes/meetingPack.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/meeting-pack/build-summary`
- `POST /api/sprint-k/:projectId/meeting-pack/build-supervisor-briefing`
- `POST /api/sprint-k/:projectId/meeting-pack/extract-action-items`

### `src/server/routes/mentalLoad.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/mental-load/score-survey`
- `POST /api/sprint-k/:projectId/mental-load/build-admin-burden`

### `src/server/routes/microtraining.ts` → `/api/sprint-k`
- `GET /api/sprint-k/:projectId/microtraining/catalog`
- `GET /api/sprint-k/:projectId/microtraining/recommend`
- `POST /api/sprint-k/:projectId/microtraining/session`
- `GET /api/sprint-k/:projectId/microtraining/certs`

### `src/server/routes/multiProject.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/multi-project/compare`
- `POST /api/sprint-k/:projectId/multi-project/best-practices`
- `POST /api/sprint-k/:projectId/multi-project/risk-projects`
- `GET /api/sprint-k/:projectId/multi-project/snapshots`

### `src/server/routes/multiRoleSummary.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/role-summary/compose`
- `POST /api/sprint-k/:projectId/role-summary/compose-all`
- `POST /api/sprint-k/:projectId/role-summary/filter-lessons`

### `src/server/routes/nonConformity.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/non-conformity/link-to-action`
- `POST /api/sprint-k/:projectId/non-conformity/evaluate-cycle-stage`
- `POST /api/sprint-k/:projectId/non-conformity/bulk-classify-by-pattern`

### `src/server/routes/offlineInspections.ts` → `/api/sprint-k`
- `GET /api/sprint-k/:projectId/inspections`
- `POST /api/sprint-k/:projectId/inspections`
- `POST /api/sprint-k/:projectId/inspections/:inspectionId/observations`
- `POST /api/sprint-k/:projectId/inspections/:inspectionId/complete`

### `src/server/routes/operationalChange.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/moc/declare`
- `GET /api/sprint-k/:projectId/moc/pending-acks`
- `POST /api/sprint-k/:projectId/moc/:mocId/acknowledge`
- `POST /api/sprint-k/:projectId/moc/:mocId/submit-for-review`
- `POST /api/sprint-k/:projectId/moc/:mocId/decide`
- `POST /api/sprint-k/:projectId/moc/:mocId/activate`
- `POST /api/sprint-k/:projectId/moc/:mocId/verify`
- `POST /api/sprint-k/:projectId/moc/:mocId/revert`
- `GET /api/sprint-k/:projectId/moc/list`
- `POST /api/sprint-k/:projectId/moc/:mocId/close`

### `src/server/routes/orgMetrics.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/org-metrics/detect-silos`
- `POST /api/sprint-k/:projectId/org-metrics/build-friction-report`
- `POST /api/sprint-k/:projectId/org-metrics/build-closure-time-report`
- `POST /api/sprint-k/:projectId/org-metrics/detect-chronic-gaps`
- `POST /api/sprint-k/:projectId/org-metrics/compute-operational-pressure`

### `src/server/routes/pdca.ts` → `/api/sprint-k`
- `GET /api/sprint-k/:projectId/pdca/cycles`
- `POST /api/sprint-k/:projectId/pdca/cycles`
- `POST /api/sprint-k/:projectId/pdca/cycles/:id/advance`
- `GET /api/sprint-k/:projectId/pdca/non-conformities`
- `POST /api/sprint-k/:projectId/pdca/non-conformities`
- `GET /api/sprint-k/:projectId/pdca/summary`

### `src/server/routes/photoEvidence.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/photo-evidence`
- `GET /api/sprint-k/:projectId/photo-evidence/by-node/:kind/:id`
- `POST /api/sprint-k/:projectId/photo-evidence/:artifactId/linkage`

### `src/server/routes/pinSign.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/pin-sign/validate-policy`
- `POST /api/sprint-k/:projectId/pin-sign/register`
- `POST /api/sprint-k/:projectId/pin-sign/verify`
- `POST /api/sprint-k/:projectId/pin-sign/sign-item`
- `POST /api/sprint-k/:projectId/pin-sign/verify-acknowledgement`

### `src/server/routes/portableHistory.ts` → `/api/sprint-k`
- `GET /api/sprint-k/:projectId/workers/:workerUid/portable-history`
- `POST /api/sprint-k/:projectId/workers/:workerUid/portable-history/consent`
- `GET /api/sprint-k/:projectId/workers/:workerUid/portable-history/export`

### `src/server/routes/portfolioLessons.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/portfolio-lessons/recommend`
- `POST /api/sprint-k/:projectId/portfolio-lessons/summarize`

### `src/server/routes/positiveObservations.ts` → `/api/sprint-k`
- `GET /api/sprint-k/:projectId/positive-observations/worker/:workerUid`
- `POST /api/sprint-k/:projectId/positive-observations`
- `GET /api/sprint-k/:projectId/positive-observations`
- `GET /api/sprint-k/:projectId/positive-observations/balance`

### `src/server/routes/postTraining.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/post-training/score-assessment`
- `POST /api/sprint-k/:projectId/post-training/next-review-delay`
- `POST /api/sprint-k/:projectId/post-training/schedule-next-reviews`
- `POST /api/sprint-k/:projectId/post-training/find-case-studies`

### `src/server/routes/predictiveAlerts.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/predictive-alerts/should-fire-windowed`
- `POST /api/sprint-k/:projectId/predictive-alerts/evaluate-probes`

### `src/server/routes/preShiftRisk.ts` → `/api/sprint-k`
- `GET /api/sprint-k/:projectId/pre-shift-risk`

### `src/server/routes/preventionCost.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/cost/simulate`
- `POST /api/sprint-k/:projectId/cost/save-scenario`
- `GET /api/sprint-k/:projectId/cost/scenarios`

### `src/server/routes/pricingCalculator.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/pricing-calculator/estimate-tier-cost`
- `POST /api/sprint-k/:projectId/pricing-calculator/compare-tiers`
- `POST /api/sprint-k/:projectId/pricing-calculator/compute-roi`
- `POST /api/sprint-k/:projectId/pricing-calculator/suggest-purchase-orders`

### `src/server/routes/pricingSimulator.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/pricing/estimate-bill`
- `POST /api/sprint-k/:projectId/pricing/compare-tiers`
- `POST /api/sprint-k/:projectId/pricing/worker-break-even`

### `src/server/routes/privacyRetention.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/privacy/decide-retention`
- `POST /api/sprint-k/:projectId/privacy/check-consent`
- `POST /api/sprint-k/:projectId/privacy/pii-bucket`
- `POST /api/sprint-k/:projectId/privacy/sensitivity-for-category`

### `src/server/routes/privacyShield.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/privacy-shield/classify-field`
- `POST /api/sprint-k/:projectId/privacy-shield/detect-gaps`
- `POST /api/sprint-k/:projectId/privacy-shield/reap-expired`

### `src/server/routes/projectClosure.ts` → `/api/sprint-k`
- `GET /api/sprint-k/:projectId/closure/status`
- `POST /api/sprint-k/:projectId/closure/initiate`
- `POST /api/sprint-k/:projectId/closure/lessons`
- `POST /api/sprint-k/:projectId/closure/decisions`
- `POST /api/sprint-k/:projectId/closure/finalize`
- `GET /api/sprint-k/:projectId/closure/summary`

### `src/server/routes/projectComparator.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/project-comparator/compare`

### `src/server/routes/protocols.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/protocols/iper`
- `POST /api/sprint-k/:projectId/protocols/prexor`
- `POST /api/sprint-k/:projectId/protocols/tmert`
- `POST /api/sprint-k/:projectId/protocols/planesi`
- `POST /api/sprint-k/:projectId/protocols/tmert/assessments`
- `POST /api/sprint-k/:projectId/protocols/prexor/assessments`
- `POST /api/sprint-k/:projectId/protocols/planesi/assessments`
- `GET /api/sprint-k/:projectId/protocols/assessments`

### `src/server/routes/pymeOnboarding.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/pyme-onboarding/maturity`
- `POST /api/sprint-k/:projectId/pyme-onboarding/plan`

### `src/server/routes/pymeWizard.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/pyme-wizard/build-plan`

### `src/server/routes/qrAck.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/qr-ack/create-session`
- `POST /api/sprint-k/:projectId/qr-ack/validate-scan`

### `src/server/routes/qrSignature.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/qr-signature/challenge`
- `POST /api/sprint-k/:projectId/qr-signature/acknowledge`

### `src/server/routes/raciMatrix.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/raci-matrix/build`
- `POST /api/sprint-k/:projectId/raci-matrix/validate`
- `POST /api/sprint-k/:projectId/raci-matrix/detect-overload`
- `POST /api/sprint-k/:projectId/raci-matrix/find-critical-gaps`
- `POST /api/sprint-k/:projectId/raci-matrix/list-uids`
- `POST /api/sprint-k/:projectId/raci-matrix/summarize-health`

### `src/server/routes/readReceipts.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/read-receipts/resolve-audience`
- `POST /api/sprint-k/:projectId/read-receipts/build-initial`
- `POST /api/sprint-k/:projectId/read-receipts/compute-deadline`
- `POST /api/sprint-k/:projectId/read-receipts/derive-status`
- `POST /api/sprint-k/:projectId/read-receipts/acknowledge`
- `POST /api/sprint-k/:projectId/read-receipts/summarize`

### `src/server/routes/refuges.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/refuges/list-catalog`
- `POST /api/sprint-k/:projectId/refuges/find-nearest`
- `POST /api/sprint-k/:projectId/refuges/availability`

### `src/server/routes/regulatoryFramework.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/regulatory/active-jurisdictions`
- `POST /api/sprint-k/:projectId/regulatory/cite`
- `POST /api/sprint-k/:projectId/regulatory/resolve-control`
- `POST /api/sprint-k/:projectId/regulatory/list-controls`
- `POST /api/sprint-k/:projectId/regulatory/references`

### `src/server/routes/reportsAutomation.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/reports-automation/validate`
- `POST /api/sprint-k/:projectId/reports-automation/render`
- `POST /api/sprint-k/:projectId/reports-automation/check-due`

### `src/server/routes/reputationalAlerts.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/reputational-alerts/analyze`
- `POST /api/sprint-k/:projectId/reputational-alerts/summarize`

### `src/server/routes/researchMode.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/research-mode/find-root-branches`
- `POST /api/sprint-k/:projectId/research-mode/summarize-tree`
- `POST /api/sprint-k/:projectId/research-mode/compare-trees`
- `POST /api/sprint-k/:projectId/research-mode/detect-failed-control-patterns`

### `src/server/routes/residualRisk.ts` → `/api/sprint-k`
- `GET /api/sprint-k/:projectId/residual-risk/suspicious`
- `GET /api/sprint-k/:projectId/residual-risk`
- `POST /api/sprint-k/:projectId/residual-risk`
- `POST /api/sprint-k/:projectId/residual-risk/:id/accept`

### `src/server/routes/retaliationProtection.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/retaliation/analyze`
- `POST /api/sprint-k/:projectId/retaliation/recommend-actions`

### `src/server/routes/returnToWork.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/return-to-work/assess-task-fit`
- `POST /api/sprint-k/:projectId/return-to-work/decide-derivation`
- `POST /api/sprint-k/:projectId/return-to-work/build-plan`

### `src/server/routes/riskRadar.ts` → `/api/sprint-k`
- `GET /api/sprint-k/:projectId/repeating-risks`

### `src/server/routes/riskRanking.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/risk-ranking/risks`
- `POST /api/sprint-k/:projectId/risk-ranking/weak-controls`
- `POST /api/sprint-k/:projectId/risk-ranking/zones`
- `POST /api/sprint-k/:projectId/risk-ranking/tasks`

### `src/server/routes/roiScenario.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/roi-scenario/compare`

### `src/server/routes/roleViews.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/role-views/build`

### `src/server/routes/rootCause.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/root-cause/build-analysis`
- `POST /api/sprint-k/:projectId/root-cause/compute-stats`
- `POST /api/sprint-k/:projectId/root-cause/analyze-punitive-language`
- `POST /api/sprint-k/:projectId/root-cause/get-investigation-questions`
- `POST /api/sprint-k/:projectId/root-cause/get-starter-questionnaire`

### `src/server/routes/rootCauseInvestigation.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/investigations/build-tree`
- `POST /api/sprint-k/:projectId/investigations/extract-chain`
- `POST /api/sprint-k/:projectId/investigations/classify-category`
- `POST /api/sprint-k/:projectId/investigations/is-shallow-answer`

### `src/server/routes/routeScoring.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/routes/build-profile`
- `POST /api/sprint-k/:projectId/routes/evaluate-driver`

### `src/server/routes/routing.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/routing/find-path-astar`
- `POST /api/sprint-k/:projectId/routing/assess-climate`

### `src/server/routes/safetyMetrics.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/safety-metrics/build-report`
- `POST /api/sprint-k/:projectId/safety-metrics/compare-vs-industry`
- `POST /api/sprint-k/:projectId/safety-metrics/analyze-trend`
- `POST /api/sprint-k/:projectId/safety-metrics/exposure`
- `GET /api/sprint-k/:projectId/safety-metrics/report`

### `src/server/routes/safetyPerformance.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/safety-performance/compute`
- `POST /api/sprint-k/:projectId/safety-performance/build-trend`

### `src/server/routes/safetyTalks.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/safety-talks/suggest`

### `src/server/routes/shiftHandover.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/shift-handover/start`
- `POST /api/sprint-k/:projectId/shift-handover/log-entry`
- `POST /api/sprint-k/:projectId/shift-handover/add-note`
- `POST /api/sprint-k/:projectId/shift-handover/end`
- `POST /api/sprint-k/:projectId/shift-handover/acknowledge`
- `POST /api/sprint-k/:projectId/shift-handover/summarize`

### `src/server/routes/shiftRiskPanel.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/shift-risk-panel/compose`

### `src/server/routes/sif.ts` → `/api/sprint-k`
- `GET /api/sprint-k/:projectId/sif/pending-review`
- `POST /api/sprint-k/:projectId/sif/:id/executive-review`
- `POST /api/sprint-k/:projectId/sif/:id/notify-mandante`

### `src/server/routes/signaletics.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/signaletics/audit-zone`
- `POST /api/sprint-k/:projectId/signaletics/rank-site`
- `POST /api/sprint-k/:projectId/signaletics/evacuation-paths`

### `src/server/routes/skillGap.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/skills/analyze-gaps`
- `POST /api/sprint-k/:projectId/skills/build-training-plan`
- `POST /api/sprint-k/:projectId/skills/polyvalence-matrix`
- `POST /api/sprint-k/:projectId/skills/find-substitutes`

### `src/server/routes/softBlocking.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/soft-blocking/evaluate-gate`
- `POST /api/sprint-k/:projectId/soft-blocking/validate-override`
- `POST /api/sprint-k/:projectId/soft-blocking/build-audit-entry`
- `POST /api/sprint-k/:projectId/soft-blocking/is-override-valid`

### `src/server/routes/spacedRepetition.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/spaced-repetition/create-card`
- `POST /api/sprint-k/:projectId/spaced-repetition/review-card`
- `POST /api/sprint-k/:projectId/spaced-repetition/select-due-cards`
- `POST /api/sprint-k/:projectId/spaced-repetition/build-retention-report`

### `src/server/routes/stoppage.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/stoppage/declare`
- `POST /api/sprint-k/:projectId/stoppage/mark-precondition-fulfilled`
- `POST /api/sprint-k/:projectId/stoppage/resume`
- `POST /api/sprint-k/:projectId/stoppage/cancel`
- `POST /api/sprint-k/:projectId/stoppage/summarize`
- `POST /api/sprint-k/:projectId/stoppage/resolve`

### `src/server/routes/structuralLoads.ts` → `/api/sprint-k`
- `GET /api/sprint-k/:projectId/structural-loads`
- `POST /api/sprint-k/:projectId/structural-loads`
- `GET /api/sprint-k/:projectId/structural-loads/build-probes`

### `src/server/routes/suppliers.ts` → `/api/sprint-k`
- `GET /api/sprint-k/:projectId/suppliers`
- `POST /api/sprint-k/:projectId/suppliers`
- `POST /api/sprint-k/:projectId/suppliers/:id/incidents`
- `POST /api/sprint-k/:projectId/suppliers/:id/audits`
- `GET /api/sprint-k/:projectId/suppliers/ranking`

### `src/server/routes/syncStatus.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/sync-status/create-item`
- `POST /api/sprint-k/:projectId/sync-status/transition`
- `POST /api/sprint-k/:projectId/sync-status/summarize`
- `POST /api/sprint-k/:projectId/sync-status/find-ready`
- `POST /api/sprint-k/:projectId/sync-status/derive-badge`

### `src/server/routes/upsell.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/upsell/suggest`

### `src/server/routes/vendorOnboarding.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/vendors/onboarding/evaluate-stage`
- `POST /api/sprint-k/:projectId/vendors/:vendorId/onboarding/missing-mandatory`
- `POST /api/sprint-k/:projectId/vendors/onboarding/build-client-bundle`
- `POST /api/sprint-k/:projectId/vendors/:vendorId/accreditation/summarize`
- `POST /api/sprint-k/:projectId/vendors/:vendorId/accreditation/should-escalate`

### `src/server/routes/vulnerability.ts` → `/api/sprint-k`
- `GET /api/sprint-k/:projectId/vulnerability/latest`

### `src/server/routes/waste.ts` → `/api/sprint-k`
- `GET /api/sprint-k/:projectId/waste/inventory`

### `src/server/routes/workerHistory.ts` → `/api/sprint-k`
- `POST /api/sprint-k/:projectId/worker-history/build-portable`
- `POST /api/sprint-k/:projectId/worker-history/redact-pii`
- `POST /api/sprint-k/:projectId/worker-history/serialize`

### `src/server/routes/workerReadiness.ts` → `/api/sprint-k`
- `GET /api/sprint-k/:projectId/worker-readiness/:workerUid`

### `src/server/routes/workPermits.ts` → `/api/sprint-k`
- `GET /api/sprint-k/:projectId/work-permits`
- `POST /api/sprint-k/:projectId/work-permits`
- `POST /api/sprint-k/:projectId/work-permits/validate-critical`
- `POST /api/sprint-k/:projectId/work-permits/:permitId/sign`
- `POST /api/sprint-k/:projectId/work-permits/:permitId/close`

### `src/server/routes/subscription.ts` → `/api/subscription`
- `POST /api/subscription/upgrade`

### `src/server/routes/suseso.ts` → `/api/suseso`
- `POST /api/suseso/form`
- `POST /api/suseso/form/:id/sign`
- `GET /api/suseso/form/:id/sign-challenge`
- `POST /api/suseso/form/:id/submit`
- `POST /api/suseso/forms/:formId/mark-submitted`
- `GET /api/suseso/verify/:folio`

### `src/server/routes/systemEvents.ts` → `/api/system-events`
- `POST /api/system-events/emit`

### `src/server/routes/visitors.ts` → `/api/visitors`
- `POST /api/visitors/check-in`
- `POST /api/visitors/:id/check-out`
- `POST /api/visitors/:id/acknowledge-induction`
- `GET /api/visitors`

### `src/server/routes/zettelkasten.ts` → `/api/zettelkasten`
- `POST /api/zettelkasten/nodes`
- `POST /api/zettelkasten/nl-query`
- `POST /api/zettelkasten/risk-control-suggestions`
- `POST /api/zettelkasten/backlinks`

### `src/server/routes/restrictedZones.ts` → `/api/zones`
- `POST /api/zones/define`
- `GET /api/zones/by-site/:projectId`
- `POST /api/zones/check`
- `POST /api/zones/entry-event`
- `GET /api/zones/entry-permissions/:projectId/:workerUid`

