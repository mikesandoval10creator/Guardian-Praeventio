# Worklist verificado — next-real-work-sweep (2026-06-17)

Workflow wi6ai3fpv: 58 hallazgos -> 38 confirmados reales, 31 feasible_now. Cada uno verificado adversarialmente (isReal && !duplicate).

## Síntesis priorizada

The `useRootCause` hook and `rootCause.ts` route do exist. The final JSON item ("Mount useRootCause route — 5 endpoints: build-analysis, compute-stats, a...") is truncated mid-evidence/verdict. Since I cannot see its verdict (feasibility, lifeOrLegal, dataSource), I'll include it conservatively at the end of the orphan-hook tier with an explicit truncation note rather than invent its attributes.

The following is the prioritized worklist.

---

# Make-It-Real Serial Worklist (prioritized)

Each item = one PR. "Review" column = adversarial review mandatory (life / legal / payment).

## TIER 1 — Life / Legal, feasible_now (do first)

**1. Lone-worker 'help' (man-down) audit not guaranteed — safety message can be silently lost**
- `src/server/routes/loneWorker.ts:199` (also start-session ~147-152, end-session ~235-239)
- Why: a `status:'help'` man-down alert returns 200 even if the compliance-trail audit write fails; breaks detection→response chain (Flow Infinito). Safety-critical + user-visible.
- Wire: check the boolean return of `await auditServerEvent()` (it returns `Promise<boolean>`, swallows Firestore errors per `auditLog.ts:84-105`); guard per CLAUDE.md #14; apply consistently to start/check-in/end.
- Effort: S · **Review: YES**

**2. Resume audit failure silently ignored — legal seal (biometric + approver) incomplete**
- `src/server/routes/stoppage.ts:399` (post-`txn.update` at 374)
- Why: resumption is a legal act; audit write after commit only `logger.error`, user gets 200 believing audit succeeded. No `captureRouteError`.
- Wire: add `captureRouteError(err, 'stoppage.resume.audit', { projectId })` per `auditLog.ts:96-101` / `custodyChain.ts` pattern.
- Effort: S · **Review: YES**

**3. mark-precondition-fulfilled audit not Sentry-captured**
- `src/server/routes/stoppage.ts:274` (block 261-276)
- Why: juridical state change on a work stoppage loses its compliance trail silently if Firestore audit_logs unreachable.
- Wire: `getErrorTracker().captureException()` / `captureRouteError(err,'stoppage.markPrecondition.audit',{projectId})`.
- Note: items 2, 3, and the resolve-audit block (`:638`) are the SAME defect across 4 catch blocks (`217, 274, 399, 638`). Recommend ONE PR fixing all four `stoppage.ts` audit catch blocks together (the verdicts cross-reference each other). Keep separate from #1 (different file).
- Effort: S · **Review: YES**

**4. Resolve-verdict audit write failure → compliance trail broken (no Sentry)**
- `src/server/routes/stoppage.ts:638` (block 622-639)
- Why: same class as #2/#3 — fold into the single `stoppage.ts` audit-hardening PR above.
- Wire: `captureRouteError(err,'stoppage.resolve.audit',{projectId})`.
- Effort: S (covered by #3's PR) · **Review: YES**

**5. Culture-pulse survey audit calls NOT wrapped in try/catch — Ley Karín 21.643 / Ley 19.628 anonimato trail breaks**
- `src/server/routes/culturePulse.ts:572-578` (schedule) and `:677-683` (respond)
- Why: `await auditServerEvent(...)` unguarded → audit failure bubbles to outer handler, returns 500 masking the audit failure as a generic error; privacy-critical worker-participation trail lost.
- Wire: wrap both in try/catch with `logger.error('audit_event_failed', err)` + Sentry, per `stoppage.ts:203-218` pattern.
- Effort: S · **Review: YES**

**6. Subscription upgrade — false-negative: write succeeds, audit unguarded → user shown 500**
- `src/server/routes/subscription.ts:133`
- Why: legal/payment-adjacent. `await auditServerEvent()` not in try/catch (violates CLAUDE.md #14); subscription write at 112-124 already committed, so audit failure shows the user an error for a successful change.
- Wire: wrap in try/catch (non-blocking), log+capture, let success response continue — per `account.ts:92-99,130-135,148-157`.
- Effort: S · **Review: YES**

**7. Mount useEvacuation route — RECLASSIFY, likely NO-OP**
- `src/hooks/useEvacuation.ts:45-120`
- Why: verdict downgraded it — NOT an orphan. The 4 stateless compute endpoints ARE wired and tested (`evacuation.ts:88,122,154,182`); it is a legitimate stateless-compute split from stateful `useEvacuationHeadcount`. Verdict recommendation: reclassify to `compute_client_hook`, **no code change needed**.
- Action: confirm-and-close (doc/reclassify only). Do NOT build. Effort: S · Review: no

## TIER 2 — User-visible fabrications / silent-failures, feasible_now

**8. Webpay checkout returns 200 `status='pending-config'` on adapter throw — silent payment failure**
- `src/server/routes/billing/webpay.ts:180-183` (response built 192-197, returned 206; invoice persisted 154-160 as `pending-payment`)
- Why: `createTransaction()` throw → catch logs but leaves `status='pending-config'`, `paymentUrl=undefined`, HTTP 200; user sees misconfiguration, not transient failure; state contradiction with persisted invoice.
- Wire: set `status='error'` in catch (or re-throw to outer catch for 500); add test for `createTransaction()` throwing when `isConfigured()===true`.
- Effort: M · **Review: YES (payment)**

**9. Prize/XP award failure swallowed — user shown 200, recognition=null indistinguishable from ineligible**
- `src/server/routes/stoppage.ts:614` (block 614-619; recognition init null at 568)
- Why: user can't tell prize failed vs conditions-not-met; positive-gamification integrity.
- Wire: return 202/207 with `recognitionStatus:'failed'` per CLAUDE.md #14; add test covering `awardPoints()` rejection.
- Effort: M · Review: recommended (gamification, not life/legal/payment)

**10. Analytics KPI hardcoded trend literals (+2% / -15% / +5%)**
- `src/pages/Analytics.tsx:454, 467, 491`
- Why: static fabricated trends on Riesgos Críticos / Incidentes / Cumplimiento EPP — user reads them as real deltas.
- Wire: extend existing `calculateTrendData()` (`:247-280`, already groups incidents/findings by real `createdAt`) to compute `(curr-prev)/prev*100`; follow Hygiene.tsx #787 trend pattern.
- Effort: S · Review: no

**11. ExecutiveDashboard KPI trends from single-point / inverted logic**
- `src/pages/ExecutiveDashboard.tsx:289-290`
- Why: line 289 binary `up` if `recentIncidents.length>0`; line 290 inverted (`down` if compliance ≥70) — semantically false arrows (icons 301-302).
- Wire: reuse existing `incidentTrend` 6-month series (`:147-154`), add prior-month window, compute delta %, render direction by improvement not absolute threshold; add prev-period to KPI card schema.
- Effort: S · Review: no

**12. PredictiveAnalysis ↔ Gemini schema contract broken (UI reads fields backend never returns)**
- `src/components/ai/PredictiveAnalysis.tsx:37, 67` vs schema `src/services/gemini/risk.ts:100-157`
- Why: UI expects `probabilidadGlobal / nivelRiesgo / confianza` and per-prediction `razon / mitigacionSugerida / nodoId / fundamentoLegal`; Gemini returns `{titulo, descripcion, criticidad, probabilidad, accionPreventiva}`. No transform layer → undefined renders. (Parsing/whitelist are correct; contract is not.)
- Wire: either extend `risk.ts` schema to emit all UI fields, or add a transform/refactor UI to the actual schema. **NEEDS DESIGN** decision on which side owns the contract — listed here because it surfaces as user-visible fabrication; treat the design choice as a gate.
- Effort: S (once contract direction chosen) · **Review: YES (AI safety output)**

## TIER 3 — Orphans, feasible_now, real data source (mount-only)

**13. Mount PortalPublicView — external SUSESO/auditor read-only portal**
- `src/components/auditPortal/PortalPublicView.tsx:40`; hook `useExternalAuditPortal.ts:230`; backend live `externalAuditPortal.ts:502` (mounted `server.ts:1132`)
- Why: production-ready token-gated auditor portal, zero React route; legal/audit value.
- Wire: add unauthenticated public route `/audit-portal/:token` in `App.tsx` near `/vault/share` `/public/*` (~line 431), lazy-load, pass token param + optional `?projectId`.
- Effort: M · Review: recommended (unauthenticated public surface — token handling)

**14. Mount MOCStatusPanel on OperationalChanges page**
- `src/components/changeMgmt/MOCStatusPanel.tsx:40`; hooks `useMocList`/`closeMoc` (`useOperationalChange.ts:194,218`); backend `operationalChange.ts:490-520, 532-593`
- Why: admin MOC ack overview + 100%-coverage closure gate, never mounted.
- Wire: render in `src/pages/OperationalChanges.tsx` as admin section (pass `selectedProject?.id` + refetch callback) above/below the changes list.
- Effort: S · Review: no

**15. Wire PendingPurchaseOrdersPanel (+ PurchaseOrderSignModal) to a procurement surface**
- `src/components/eppFlow/PendingPurchaseOrdersPanel.tsx:1` (companion `PurchaseOrderSignModal.tsx`); hook `useEppFlow.listPendingEppOrders`; backend `eppFlow.ts:369-391` (mounted `server.ts`)
- Why: real `pending_signature` orders from EPP inspection flow, no UI.
- Wire: mount panel+sign-modal in a Procurement/Operations surface; add modal open/close state. Update `docs/stubs-inventory.md`.
- Effort: S · Review: no

**16. Wire CostSimulator to Pricing or /cost-analysis**
- `src/components/cost/CostSimulator.tsx:158`; hook `usePreventionCost.ts`; backend `preventionCost.ts:1-407` (mounted `server.ts:1176`)
- Why: feature-complete ROI calculator (Ley 16.744/SUSESO rates), zero consumers.
- Wire: mount on `Pricing.tsx` as a tool tab OR new `/cost-analysis` route; pass `projectId` from context.
- Effort: M · Review: no

**17. Mount SafetyCapsules in SafetyFeed sidebar**
- `src/components/safety/SafetyCapsules.tsx:21`; source `generateSafetyCapsule()` `personPlans.ts:165` (whitelisted `gemini.ts:179`); target `SafetyFeed.tsx:470-501`, route `/safety-feed` (`App.tsx:474`)
- Why: real Gemini-backed safety capsules, orphaned.
- Wire: mount in SafetyFeed sidebar near "Soluciones IA"; Suspense + skeleton; confirm `UniversalKnowledgeContext` nodes populate on load.
- Effort: M · Review: no

**18. Wire useErgonomics REBA/RULA remote functions (or close as intentional dual-path)**
- `src/hooks/useErgonomics.ts:36-60`; engines `reba.ts`/`rula.ts` (mutation-tested); route `ergonomics.ts:149-172,220-243` (mounted `server.ts:389`)
- Why: remote calc wrappers are dead — `AddErgonomicsModal.tsx` does all calc locally via pure fns (imports at 18-19). DS-594 art.110 legal trigger already separate.
- Wire: add optional "verify remotely" path in `AddErgonomicsModal`, OR consolidate to calc-local + single server round-trip (validation + legal-trigger + folio). Decide before building (dual-path already works → may be confirm-and-close).
- Effort: S · Review: recommended (legal threshold)

**19. Mount useSafetyMetrics (build-report / compare-vs-industry / analyze-trend)**
- `src/hooks/useSafetyMetrics.ts:46-99`; service `osha.ts:79-319` (TRIR/LTIFR/DART/SIFR, BLS-2023/SUSESO/ICMM benchmarks); route `safetyMetrics.ts:105/135/181` (mounted `server.ts:1139`)
- Why: production backend, no UI consumer.
- Wire: bind hook to a SafetyMetrics dashboard / analytics page. Backend untouched.
- Effort: M · Review: no
- DEPENDENCY: see #25 (SafetyTrendChartLazy) and the unmounted `SafetyMetricsDashboard` — mounting that dashboard is the natural consumer for this hook; sequence #19 with the dashboard-mount decision.

**20. Wire useRouting (A* + climate) remote functions (or skip if local suffices)**
- `src/hooks/useRouting.ts:47-76`; services `gridAStar.ts:131-221`, `routeClimateAssessment.ts:127-307` (real NASA POWER + EONET adapters `external/index.ts:16-17`); route mounted `server.ts:1192`
- Why: consumers `ClimateRoutes.tsx:125` / `EvacuationRoutes.tsx:20` use local versions. Per Directiva #4, external data stays a discreet enrichment, not authority.
- Wire: wrap remote fns in a React hook w/ loading/error; mount in ClimateRoutes/EvacuationRoutes for multi-site scale. SKIP if local computation satisfies use case → confirm-and-close.
- Effort: S · Review: no

**21. Wire useActiveVisitors to canonical `/api/visitors` (or delete)**
- `src/hooks/useActiveVisitors.ts:85-89`
- Why: calls non-existent `/api/sprint-k/:projectId/visitors/active`; canonical is `GET /api/visitors?projectId=` (`server.ts:1000`). Hook's own comment flags it legacy-monolith. Never imported.
- Wire: EITHER delete the orphan hook OR migrate to canonical endpoint w/ query-string. Default: delete unless a consumer is planned.
- Effort: S · Review: no

**22. Mount useAiToggle (decide / rules-only-check / rule-drift)**
- `src/hooks/useAiToggle.ts:35-87`; services `aiModeController.ts` + `ruleDriftDetector.ts` (unit-tested); routes `aiToggle.ts:75-151` (mounted `server.ts:224`)
- Why: dead code; infra honest but no consumer. Note alignment with the Gemini-prod / SLM-fallback boundary (cloud vs local vs rules-only).
- Wire: call `decideAiMode` at app start to capture network/battery/budget snapshot; expose mode toggle in Settings.
- Effort: M · Review: no

**23. Mount useRootCause route — INCLUDE WITH CAVEAT (JSON truncated)**
- `src/hooks/useRootCause.ts` (confirmed exists); route `src/server/routes/rootCause.ts` (confirmed exists). NOTE: also present `useRootCauseInvestigation.ts` + `rootCauseInvestigation.ts` — verify which the item targets.
- Why: the confirmed-findings JSON is **truncated mid-item** at "5 endpoints: build-analysis, compute-stats, a…" so its verdict (feasibility / lifeOrLegal / dataSource) is NOT readable. Implementer must re-confirm before scheduling. Incident root-cause is life/legal-adjacent — if re-verified as feasible_now, promote toward Tier 1/3 accordingly.
- Effort: unknown until re-confirmed · **Review: YES (incident investigation)**

## TIER 4 — needs_design (resolve the design question first)

**24. RADAR_BENCHMARK hardcoded to 80 — safety-dimensions radar has no real comparator (life/legal)**
- `src/pages/Analytics.tsx:103` (TODO `:91-95`, Sprint K §164-170)
- Why: all 5 dimensions (EPP/Normativa/Conducta/Procesos/Entorno) compared to a constant; user reads it as benchmarked.
- Design question: which source calibrates — `rubroBenchmarks.ts` (k-anonymity sector medians) vs `adoptionAnalytics.ts` vs survey/consultant? How to handle sub-k-threshold sectors (fallback baseline vs honest "insufficient comparators" — NEVER fabricate)? Migration path off 80.
- Data source: `rubroBenchmarks.ts` (sector median) recommended in verdict.
- Effort: L · **Review: YES**

**25. Mount HorometroEntryForm — placement decision in equipment lifecycle**
- `src/components/horometro/HorometroEntryForm.tsx:35`; hook `useHorometro.ts:16`; backend `horometro.ts:60-142` (writes audit, triggers ZK maintenance flow)
- Design question: dedicated `/equipment/horometro/:mode` page vs modal in Assets/Equipment admin; needs mode-selector with `PreUseChecklistMobile` (`EquipmentQRScannerEntry.tsx:22`). Add B10-component entries to `docs/stubs-inventory.md` (CLAUDE.md rule 13).
- Effort: M · Review: no

**26. Mount EppInspectionForm — routing decision**
- `src/components/eppFlow/EppInspectionForm.tsx:35`; hook `useEppFlow.ts:67-76`; backend `eppFlow.ts` (mounted `server.ts:1084`), flow `eppInventoryPurchaseFlow.ts`, suggester `purchaseOrderSuggester.ts`
- Design question: dedicated `/epp/inspection` page vs modal/tab in `EPP.tsx`. Directiva #2 already honored (no push to supplier). No backend work.
- Effort: M · Review: no
- DEPENDENCY: pairs with #15 (PendingPurchaseOrdersPanel) — the inspection form feeds the pending-orders panel; sequence together.

**27. Wire useArPlacement to real AR session + geo-anchor transforms**
- `src/hooks/useArPlacement.ts:137-186`; services `placedObjectsStore.updatePlacedObject`, `useGeoAnchor.meshToGeo`, `useObjectLifecycle`
- Design question: `ARObjectOverlay` accepts `onConfirm` but `DigitalTwinFaena.tsx:1115` doesn't provide it — needs the AR overlay mounting/`startSession`/`confirmPlacement` wiring decided. No route needed (client + Firestore write).
- Effort: L · Review: no

**28. Wire remaining ~20 orphan form/modal/panel components (tier by priority)**
- `src/components/*/(*Form|*Modal|*Panel).tsx` — incl. ChangeDeclarationForm (`changeMgmt/ChangeDeclarationForm.tsx:86`), InvestigationPanel (`incidentFlow/InvestigationPanel.tsx:37`, backend `server.ts:1090`), MaintenanceCompleteForm/MaintenanceTaskList (/horometro), AssignedMicrotrainingCard, LessonPublishForm, PDCAClosePanel, Ds67Modal, PinSignModal, AcknowledgmentBanner, CostScenarioCard, RePositionConfirmDialog, VehiclePreOpChecklistCard, HazmatStorageManager, LoneWorkerAdminPanel, ShiftHandoverHistoryList, MedicalIconAttribution, + others
- Design question: which page/modal mounts each; define page hierarchy/flow. Each wraps a real mounted backend route.
- Sequencing: prioritize life-safety FIRST — InvestigationPanel (incident investigation) ahead of cosmetic cards. Tier by business priority, one component per PR, incrementally per sprint.
- Effort: L (umbrella; split per component) · **Review: YES for incident/Hazmat/lone-worker/sign-modal items**

## TIER 5 — blocked / delete-don't-build

**29. SafetyTrendChartLazy — DELETE, do not mount**
- `src/components/safetyMetrics/SafetyTrendChartLazy.tsx:1`
- Why: verdict `duplicate_already_inline`. Wrapper has zero consumers; `SafetyTrendChart` is used directly only in `SafetyMetricsDashboard` (`:35,257-264`), which is itself unmounted. Data source (`osha.ts`) real but components never mounted.
- Action: delete the wrapper; if/when `SafetyMetricsDashboard` is mounted (see #19), inline the `lazy()` there. Effort: S · Review: no

---

### Cross-cutting notes for the implementer
- **The four `stoppage.ts` audit catch blocks (217, 274, 399, 638) are one defect** repeated — verdicts cross-reference each other. Items 2/3/4 here = a SINGLE PR. Item 9 (prize, line 614) is a DIFFERENT defect in the same file (200-with-null vs missing-Sentry) — keep it separate.
- **Audit-hardening pattern is identical across files** (`stoppage`, `culturePulse`, `loneWorker`, `subscription`): guard `await auditServerEvent()` in try/catch + `captureRouteError(err,'<route>.<action>.audit',{projectId})`, non-blocking. Canonical reference: `src/server/middleware/auditLog.ts:96-101`; working examples `admin.ts:171-180` (`safeAudit`), `account.ts:92-99`. Still ship per-route (different files / different review surfaces).
- **Items 7, 18, 20, 21 may be confirm-and-close** (reclassify or delete) rather than build — verify the dual-path/local-suffices condition before writing code; default to no-fabrication.
- **JSON truncation:** item 23 (`useRootCause`) is cut off; re-confirm its verdict before scheduling. No items were invented beyond the confirmed list. The 22 components in item 28 are the umbrella's named members (from that finding's own evidence), not new findings.

Relevant absolute paths: `D:\Guardian Praeventio\repo\src\server\routes\stoppage.ts`, `...\loneWorker.ts`, `...\culturePulse.ts`, `...\subscription.ts`, `...\billing\webpay.ts`, `...\src\pages\Analytics.tsx`, `...\ExecutiveDashboard.tsx`, `...\src\components\ai\PredictiveAnalysis.tsx`, `...\src\hooks\useRootCause.ts`.

## Confirmados (estructurado)

- [feasible_now|hygiene|fabricated_data] **Hardcoded trend percentages in Analytics KPI cards (+2%, -15%, +5%)** @ `src/pages/Analytics.tsx:454, 467, 491`
  - Extend calculateTrendData() to compute (currentMonth - previousMonth) / previousMonth * 100 for risks/incidents/eppCoverage; wire to KPI trend spans; follow Hygiene.tsx pattern for test coverage.
- [needs_design|VIDA/LEGAL|fabricated_data] **Safety dimensions radar benchmark hardcoded to constant 80 (RADAR_BENCHMARK)** @ `src/pages/Analytics.tsx:103, 91-95 (TODO comment)`
  - Wire rubro benchmarks (sector median) to radar benchmark; if sector below k-threshold, either use fallback baseline or show honest 'insufficient comparators' state — never fabricate."
- [feasible_now|hygiene|fabricated_data] **ExecutiveDashboard KPI trends inferred from single-point comparisons (not proper YoY/MoM)** @ `src/pages/ExecutiveDashboard.tsx:289-290`
  - Extract 30-day incident and compliance baseline from prior month; compute delta %; render trend direction and color based on improvement/degradation, not absolute value. Estimated effort: S (reuse incidentTrend logic, add prior-month window, add delta to KPI card schema)."
- [needs_design|hygiene|fabricated_data] **PredictiveAnalysis Gemini actions call real geminiService (server-proxied, no hardcoded responses)** @ `src/components/ai/PredictiveAnalysis.tsx:37, 67`
  - Fix the Gemini response schema in src/services/gemini/risk.ts to include ALL fields the UI expects (probabilidadGlobal, nivelRiesgo, confianza, and per-prediction transformations), or refactor the UI to use the actual schema fields. The backend is calling real Gemini, but the response contract is broken."
- [feasible_now|hygiene|silent_failure] **Prize/XP award failure silently swallowed; user shown 200 success** @ `src/server/routes/stoppage.ts:614`
  - Return 202 or 207 with error field (e.g., recognitionStatus:'failed') when catch block is hit, per CLAUDE.md #14 pattern: verdict persists server-side but user knows award failed. Minimum: add test covering awardPoints() rejection to expose the ambiguity."
- [feasible_now|VIDA/LEGAL|silent_failure] **Audit log write failure allowed to succeed; compliance trail broken** @ `src/server/routes/stoppage.ts:638`
  - Add captureRouteError(err, 'stoppage.resolve.audit', { projectId }) after line 638 to match CLAUDE.md #14 pattern and auditLog.ts implementation. Compliance-critical fix for observability."
- [feasible_now|VIDA/LEGAL|silent_failure] **Audit failure in mark-precondition-fulfilled not Sentry-captured** @ `src/server/routes/stoppage.ts:274`
  - Add getErrorTracker().captureException() to all four audit catch blocks in stoppage.ts (lines 274, 217, 399, 638), following the guarded pattern from auditLog.ts:96-101, and tag with action+module for searchability."
- [feasible_now|VIDA/LEGAL|silent_failure] **Resume audit failure silently ignored; legal seal incomplete** @ `src/server/routes/stoppage.ts:399`
  - Add captureRouteError(err, 'stoppage.<action>.audit', {projectId}) call in each of the four audit failure catch blocks (lines 217, 275, 399, 638) to match pattern in custodyChain.ts and satisfy CLAUDE.md#14."
- [feasible_now|VIDA/LEGAL|silent_failure] **Lone-worker audit of 'help' request not guaranteed; critical safety message lost** @ `src/server/routes/loneWorker.ts:199`
  - Check return value of await auditServerEvent() or throw if failure detected; guard with try/catch per CLAUDE.md #14 pattern; apply to start-session, check-in, end-session consistently."
- [feasible_now|VIDA/LEGAL|silent_failure] **Subscription upgrade audit not captured in Sentry on write failure** @ `src/server/routes/subscription.ts:133`
  - Wrap the auditServerEvent call in try/catch following CLAUDE.md #14 pattern; log/capture exception; allow success response to continue (non-blocking).
- [feasible_now|hygiene|silent_failure] **Billing checkout returns 200 with status='pending-config' on webpay adapter failure** @ `src/server/routes/billing/webpay.ts:180-183`
  - Set status to 'error' in catch block (line 180-183) or re-throw error to outer catch (line 207) for proper HTTP 500 response; add test case covering createTransaction() throwing despite isConfigured()===true."
- [feasible_now|VIDA/LEGAL|silent_failure] **Culture pulse response audit failure silently swallowed; survey response trail broken** @ `src/server/routes/culturePulse.ts (approximate)`
  - Wrap both culturePulse.ts audit calls (lines 572-578, 677-683) in try/catch with logger.error('audit_event_failed', err) pattern from stoppage.ts:203-218. Audit responses also likely affected (same pattern across routes). Scan loneWorker.ts and other recently-migrated routes for identical issue."
- [feasible_now|hygiene|orphan_component] **Mount PortalPublicView for external auditor portal** @ `src/components/auditPortal/PortalPublicView.tsx:1`
  - Mount PortalPublicView in App.tsx at /audit-portal/:token as a standalone public route (no auth required). Accept token from URL params, pass to component. Optionally accept ?projectId query param as hint. Consider lazy-loading since it's unauthenticated cold-start (external auditor = infrequent visitor). Wire at line 431 near other public routes (/vault/share, /public/*) before the RootLayout-wrapped authenticated section."
- [feasible_now|hygiene|orphan_component] **Mount MOCStatusPanel on OperationalChanges page** @ `src/components/changeMgmt/MOCStatusPanel.tsx:40`
  - Mount MOCStatusPanel on OperationalChanges page as admin section (pass selectedProject?.id + callback for refetch) above or below activeChanges list."
- [feasible_now|hygiene|orphan_component] **Wire CostSimulator to Pricing or dedicated cost-analysis page** @ `src/components/cost/CostSimulator.tsx:31`
  - Wire CostSimulator to Pricing.tsx or create dedicated /cost-analysis route. Backend is production-ready, component is feature-complete, hook is tested. Mounting is straightforward — pass projectId prop from context, display in either a new tab on Pricing or as standalone route."
- [needs_design|hygiene|orphan_component] **Mount HorometroEntryForm in equipment check-in flow** @ `src/components/horometro/HorometroEntryForm.tsx:35` (blocked: decision)
  - Wire to Assets.tsx or Equipment admin context with mode selector (PreUseChecklistMobile vs HorometroEntryForm), or create /equipment/horometro routing layer + add B10-component entry to stubs-inventory.md if deferred."
- [feasible_now|hygiene|orphan_component] **Mount EppInspectionForm in EPP workflow** @ `src/components/eppFlow/EppInspectionForm.tsx:35` (blocked: decision)
  - CONFIRM REAL. Mount EppInspectionForm in dedicated /epp/inspection page (lazy route under src/pages/) or as a modal tab in existing EPP.tsx. Backend (/api/sprint-k/:projectId/epp-flow/*) is already live; no backend work needed. Update TODO.md with routing decision + mount location once decided."
- [feasible_now|hygiene|orphan_component] **Wire PendingPurchaseOrdersPanel to procurement dashboard** @ `src/components/eppFlow/PendingPurchaseOrdersPanel.tsx:1` (blocked: decision)
  - 
- [feasible_now|hygiene|orphan_component] **Mount SafetyCapsules component in knowledge/safety-feed** @ `src/components/safety/SafetyCapsules.tsx:1` (blocked: decision)
  - Mount SafetyCapsules in SafetyFeed sidebar next to "Soluciones IA" section; wrap in Suspense with fallback skeleton; verify UniversalKnowledgeContext populates nodes on page load.
- [duplicate_already_inline|hygiene|orphan_component] **Consolidate SafetyTrendChartLazy into existing analytics** @ `src/components/safetyMetrics/SafetyTrendChartLazy.tsx:1`
  - Delete SafetyTrendChartLazy.tsx and move the lazy-wrapper logic directly into SafetyMetricsDashboard when/if that component is mounted in a real page. The wrapper exists but has no consumer.
- [needs_design|hygiene|orphan_component] **Wire remaining 20 orphan form/modal components** @ `src/components/*/(*Form|*Modal|*Panel).tsx:1`
  - Design UX flow for each component: which feature page/modal mounts it? Then wire incrementally (prioritize life-safety incident investigation first). This is a real but blocked-on-design finding.
- [feasible_now|hygiene|orphan_hook] **Wire useActiveVisitors to /api/visitors endpoint (legacy /api/sprint-k path mismatch)** @ `src/hooks/useActiveVisitors.ts:85-89`
  - Delete the orphaned useActiveVisitors hook OR migrate it to call the canonical GET /api/visitors?projectId= endpoint with proper query string construction. Hook's own comment (line 8) acknowledges it is legacy monolith code."
- [feasible_now|hygiene|orphan_hook] **Mount useAiToggle route (3 endpoints: decide, rules-only-check, rule-drift)** @ `src/hooks/useAiToggle.ts:35-87`
  - Mount the hook in a Settings page (e.g., Settings.tsx advanced toggle) to expose AI mode selection to users, wiring decideAiMode on every app start to capture network/battery/budget snapshot and inform downstream Gemini/SLM consumers whether to use cloud, local, or rules-only fallback. This unblocks the architecture decision (§161-162) intended by the original PR but never exposed to UX."
- [needs_design|hygiene|orphan_hook] **Wire useArPlacement to real AR session + geo-anchor mesh-to-world transforms** @ `src/hooks/useArPlacement.ts:137-186`
  - 
- [feasible_now|VIDA/LEGAL|orphan_hook] **Mount useEvacuation route (4 endpoints: compute-status, record-scan, end-drill, build-postmortem)** @ `src/hooks/useEvacuation.ts:45-120`
  - 
- [feasible_now|hygiene|orphan_hook] **Wire useErgonomics to REBA/RULA routes (calculate-reba, calculate-rula)** @ `src/hooks/useErgonomics.ts:36-60`
  - Wire calculateRebaRemote and calculateRulaRemote into AddErgonomicsModal by adding an optional server-side validation path post-calculation (e.g., toggleable 'verify remotely' step before save), or consolidate into a single client-side + server audit pattern (calculate locally, POST full assessment + score to server for validation + legal trigger + folio allocation in one round-trip). Current dual-path (local calc + separate legal-trigger POST) works but leaves the remote calc functions unmounted in the UI layer."
- [feasible_now|hygiene|orphan_hook] **Mount useSafetyMetrics route (3 endpoints: build-report, compare-vs-industry, analyze-trend)** @ `src/hooks/useSafetyMetrics.ts:46-99`
  - Candidate is REAL orphan hook with working backend. Wire hook to SafetyMetricsDashboard or analytics page. No code fix needed on backend; backend is already in production (mounted 2026-06-02 per TODO.md B18-F1)."
- [feasible_now|hygiene|orphan_hook] **Wire useRouting to A* pathfinding + climate assessment routes** @ `src/hooks/useRouting.ts:47-76`
  - Wire both remote functions into React hook (useRouting()) with loading/error state, then mount consumers in ClimateRoutes and EvacuationRoutes to call remote versions for scaled/multi-site deployments. Skip if local computation satisfies the use case."
- [feasible_now|hygiene|orphan_hook] **Mount useRootCause route (5 endpoints: build-analysis, compute-stats, analyze-punitive-language, get-investigation-questions, get-starter-questionnaire)** @ `src/hooks/useRootCause.ts:55-126`
  - Wire the hook functions into RootCauseInvestigation.tsx for optional server-side computation (enable remote analysis for team-wide patterns), OR document intentional separation and remove the orphan hook. The routes+services are real and working; the integration is the gap."
- [feasible_now|hygiene|orphan_hook] **Wire useRoleViews to role-dashboard builder (build endpoint)** @ `src/hooks/useRoleViews.ts:47-59`
  - Wire RoleAwareDashboard into Dashboard.tsx early render, gather RoleViewState from existing contexts (ProjectContext, useGamification, etc.) and pass state prop. Alternatively: add a hook useRoleViewState() that queries Firestore for the metrics and returns the state shape, then call buildRoleViewRemote() if server-side card computation is desired (currently client-side is simpler since buildRoleView() is pure)."
- [blocked_external|VIDA/LEGAL|feasibility] **Wire MediaPipe ObjectDetector for EPP detection instead of color-heuristic fallback** @ `src/services/ai/eppDetectorOnDevice.ts:325-354`
  - 
- [feasible_now|VIDA/LEGAL|fabricated_data] **WP-V2: Evacuation route still uses hardcoded SVG, not site_geometry real data** @ `src/components/emergency/VectorialEvacuationMap.tsx:30-51`
  - Wire VectorialEvacuationMap to subscribe to real site_geometry via DynamicEvacuationMap prop or in-component subscription (same pattern as EvacuationGridMap), rendering polygons as SVG instead of hardcoded floor plan. Or remove if dead-reckoning mode should show only the worker position + grid, not a fake site."
- [feasible_now|VIDA/LEGAL|orphan_component] **WP-V3: LoneWorkerAdminPanel and EmergencyBrigadePanel components exist but are orphaned (not mounted)** @ `src/components/loneWorker/LoneWorkerAdminPanel.tsx:33 + src/components/emergencyBrigade/EmergencyBrigadePanel.tsx:33`
  - Create supervisor dashboard page that mounts both panels. Wire LoneWorkerAdminPanel to display live project sessions with polling; wire EmergencyBrigadePanel to show brigade readiness status. Both are free-tier features (life-safety, never tier-gated per CLAUDE.md rule 11)."
- [feasible_now|VIDA/LEGAL|orphan_component] **WP-I7: EPP color detector lacks confidence % and tier labeling in UI** @ `src/services/ai/eppDetectorOnDevice.ts:1-50 / src/components/ai/VisionAnalyzer.tsx:25`
  - 
- [feasible_now|VIDA/LEGAL|feasibility] **WP-L3: Folio `site_book_counters` rule lacks server-side runTransaction safeguard** @ `firestore.rules / src/server/routes/sitebook.ts`
  - 
- [feasible_now|VIDA/LEGAL|silent_failure] **WP-L4: Daily housekeeping cron not provisioned in deploy.yml (legal expirations/reminders don't run in prod)** @ `.github/workflows/deploy.yml / src/server/jobs/` (blocked: scheduler-IAM (GCP service account needs Cloud Scheduler permission))
  - Add daily-housekeeping to Cloud Scheduler provisioning in deploy.yml (3-line ensure_job call). Unblock legal reminder delivery per regulatory requirement. Not external-blocked.
- [feasible_now|VIDA/LEGAL|silent_failure] **WP-I12: `commute_sessions` still writable from client; should route through `/api/commute` only** @ `firestore.rules / src/server/routes/commute.ts`
  - Add Firestore rule block match /commute_sessions/{sessionId} under tenants/{tenantId} with allow read: if isSignedIn() && isMemberOfTenant(tenantId); and allow create, update, delete: if false. Wire ≥5 rules-tests: authenticated tenant-member read OK, non-member denied, direct client create denied, direct client update denied, cross-tenant isolation verified.
- [feasible_now|VIDA/LEGAL|silent_failure] **WP-I2: 'Simular IoT' inject lacks simulated:true tag and gas-gate doesn't filter simulation events** @ `src/server/routes/ / src/services/iot/`
  - Add simulated:boolean to TelemetrySample type; tag on HTTP ingest when E2E_MODE=1, on MQTT bridge when adapter is InMemoryAdapter; filter gas-gate queries where simulated!=true; update FCM alerts to check flag; write rules-tests for filtering."
