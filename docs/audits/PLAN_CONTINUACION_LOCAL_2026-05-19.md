# Plan continuación Guardian-Praeventio — informe consolidado para nueva sesión local con skills

> **Propósito de este documento:** entregar contexto completo a una nueva sesión de Claude Code Desktop (con skills `ui-ux-pro-max`, `superpowers:*`, `everything-claude-code:*` disponibles) para que continúe el trabajo SIN perder contexto. Incluye estado real verificado HOY (2026-05-19), cómo debería funcionar el producto al Day-1, y los 110+ items pendientes en orden estricto de prioridad.

---

## 1. CONTEXTO — qué pasó en la sesión cloud que terminó HOY

### 1.1 Trabajo realizado en branch `claude/review-pending-tasks-aUDD2` (PR #450)

5 horas de auditoría exhaustiva con 10 agentes paralelos + 3 Explore agents adicionales + reconciliación con plan exhaustivo 2026-05-17 del usuario.

**Commits finales en la branch:**
- `9fd8f97b` §28 EXHAUSTIVO + 35 items B
- `ea3872f3` §29 + 20 items C + TODO §14
- `29baf4c1` fix(a11y) ErrorBoundary main landmark (CI Playwright)
- `982bbf3e` §30 triage real 214 branches
- `5fd3fa39` §31 incorporación plan 2026-05-17 (38 H-items) + sweep H5 correos

**Archivos producidos:**
- `docs/audits/AUDIT_EXHAUSTIVA_2026-05-19.md` — **3433 LOC**, 31 secciones
- `docs/audits/BRANCHES_INVENTORY_2026-05-19.md` — 232 LOC
- `TODO.md` — **1119 LOC**, 15 secciones, **110+ items totales**

### 1.2 Hallazgos clave de la sesión

**Las "alarmas falsas" descubiertas:**
1. **215 branches "no mergeadas"** → realidad: 213/214 son history huérfana del rebranch del 2026-05-18. **0 trabajo perdido**, todo squashed en main. Cleanup = bulk delete (1-2h, no 2 semanas).
2. **Sprint K monolito 13230 LOC** → **YA ELIMINADO**. Modularizado en 294 routes individuales en `src/server/routes/`. Directiva del usuario "Sprint K = lista, no archivo" ya aplicada.
3. **DS 40 derogado** → migración a DS 44/2024 ya hecha en 10/10 archivos críticos con anotación histórica correcta.

**Los problemas reales descubiertos:**
1. **190/372 componentes huérfanos (51%)** — features implementadas sin ruta/menú/botón
2. **92/184 hooks huérfanos (50%)** — implementados sin consumer
3. **53/259 services huérfanos (20%)** — incluyendo `eventBus`, `eventStore`
4. **30+ fetch sin AbortController** — OAuth, Gemini, OpenWeather, USGS (slow-HTTP attack surface)
5. **355 `any` en signatures públicas** + **783 type assertions sin runtime check**
6. **0 telemetry en hot paths** — auth, SOS, KMS, payment
7. **Mutation orchestrator.ts: 7.69%** — 48 mutantes vivos
8. **10 rutas API críticas sin test** — emergency, OAuth, billing, audit, admin, import, compliance, subscription, health, onboarding
9. **iOS native casi vacío** — solo `ios/App/fastlane/`, falta Xcode project (bloqueado por Apple Developer Account)
10. **PR #450 CI Playwright failing** — fix aplicado HOY (ErrorBoundary `<main>` landmark + h2→h1)

### 1.3 Reconciliación con plan exhaustivo 2026-05-17 del usuario

El usuario aportó un plan de ~2000 LOC con 38 hallazgos H1-H26 + H25b.1-13. Verificación HOY contra código:

| Categoría | Count |
|---|---|
| **YA FIXED entre 2026-05-17 y HOY** | **10/26** (H1 lockfile, H2 playwright, H3 Dockerfile, H4 cloudbuild, H6 LICENSE, H12 sprintK eliminado, H13 useSprintK, H16 región, H17 deploy.yml, H26 DS 40) |
| Pendientes con file:line actualizado HOY | 16 |
| Omitidos por mi audit, ahora incorporados como items D1-D15 | 15 |

### 1.4 Sweep H5 correos canónicos aplicado HOY (commit `5fd3fa39`)

Directiva del usuario 2026-05-17: el único correo de la empresa es `contacto@praeventio.net`. Reemplazos hechos:
- `src/pages/Help.tsx:91` (soporte@.cl → contacto@.net)
- `src/pages/Pricing.tsx:560,563,586,589,1081` (soporte@/ventas@ → contacto@)
- `src/pages/PrivacyPolicy.tsx:44,125,151` (privacidad@ → contacto@)
- `src/services/openapi/specGenerator.ts:190` (soporte@.guard → contacto@.net)
- `src/i18n/locales/{es,en,pt-BR}/common.json` (soporte@/ventas@ → contacto@)

**Pendiente:** sweep equivalente en `marketplace/*.md` y `*.md` raíz (`SECURITY.md`, `README.md`, etc.).

---

## 2. CÓMO FUNCIONA EL PROYECTO HOY (verificado contra `origin/main` 2026-05-19)

### 2.1 Stack técnico

- **Frontend:** React 19 + TypeScript strict (noImplicitAny, strictNullChecks) + Vite 5 + Tailwind 3 + Framer Motion + React Router 6
- **Backend:** Express + TypeScript ejecutado vía `tsx` en runtime (H10 deuda: no compila a JS para prod)
- **Bundle:** 30 MB build físico, 15.6 MiB PWA precache (485 entries)
- **Tests:** Vitest (10029/10030 passing), Playwright E2E (con job `e2e-full-stack` Sprint 22+), Stryker mutation (46.88% promedio)
- **Database:** Firestore (rules default-deny + tests inmutabilidad audit_logs)
- **Auth:** Firebase Auth + WebAuthn server-side verify real + KMS preflight fail-fast prod
- **Pagos:** Webpay (Transbank Chile) + MercadoPago LatAm + Google Play IAP + Apple StoreKit
- **IA runtime:** Gemini + Vertex AI Agent Builder + SLM local (Gemma 2 2B en navegador via transformers.js)
- **Mobile:** Capacitor 8 — Android nativo COMPLETO (minSdk 24, FGS, App Links), iOS BLOQUEADO por falta Apple Dev Account
- **Infra:** Cloud Run (region southamerica-west1) + Firestore + KMS (90d rotation) + Cloud Scheduler + Modal GPU (photogrammetry)
- **CI/CD:** 14 workflows GitHub Actions (mutation gating, signing check, e2e full-stack, prepackage-slm, etc.)

### 2.2 Arquitectura por dominio

```
src/
├── pages/                      155 páginas (top routes)
├── components/                 372 componentes — 190 HUÉRFANOS (51%)
│   ├── shared/                 (GuardianMascot, ErrorBoundary, ConsciousnessLoader...)
│   ├── ai/, ar/, audit/, ...   (50+ subdirectorios por dominio)
│   └── ...
├── hooks/                      184 hooks — 92 HUÉRFANOS (50%)
├── services/                   259 services (40 .ts + 219 dirs) — 53 HUÉRFANOS (20%)
│   ├── ai/                     resilientAiOrchestrator 5-tier fallback ✅
│   ├── auth/                   webauthnAssertion ✅
│   ├── billing/                mercadoPagoIpn HMAC ✅
│   ├── compliance/             (17 hooks multi-país sin wire)
│   ├── emergency/, sos/        SOS submit + escalation
│   ├── engineering/            scratchCalculations auto-promote ✅
│   ├── environment/            chileClimatology fallback determinístico (Regla #3)
│   ├── photogrammetry/         (cliente del worker)
│   ├── slm/                    Gemma 2 2B loader (SHA-256 null pendiente)
│   ├── suseso/                 diatPdfRenderer + folioGenerator atómico ✅
│   ├── zettelkasten/           core + healthEvent adapter
│   └── ...
├── lib/
│   ├── firebase.ts             init persistent cache
│   └── sentry.ts               redactPii + maskAllText
├── server/
│   ├── routes/                 294 archivos (post-Sprint K refactor)
│   └── auth/                   webauthnAssertion
├── contexts/                   17 contexts (AppProviders.tsx wrap tree)
├── i18n/locales/               16 idiomas (99% wire, solo Onboarding.tsx pendiente useTranslation)
└── routes/                     EmergencyRoutes, ComplianceRoutes, AIRoutes, etc.

infra/                          ✅ TODO production-ready
├── dwg-converter/              Python Flask + bearer + GCS signed URLs 1hr
├── usdz-converter/             Python Flask + glb_to_usdz subprocess
├── modal-photogrammetry/       Modal serverless GPU A10G (~$0.10/job)
└── photogrammetry-worker/      COLMAP CPU Cloud Run

cloud-run/photogrammetry-worker/   Variante TypeScript (Sprint 38 Brecha C) — duplicado a decidir

infrastructure/terraform/       ✅ 11 .tf production-ready, KMS 90d rotation, IAM least-privilege

scripts/                        40 utilidades — 5 críticas production-ready (rotate-secrets, backup-firestore, dr-failover, migrate-oauth, security-review)

bin/mcp-server.mjs              ✅ MCP stdio + tenant whitelist read-only

loadtest/sos-1000-concurrent.yml ✅ Artillery 1000 RPS SOS, p95<800ms

ios/App/                        ❌ Solo fastlane/, falta Xcode project (npx cap add ios)
android/app/                    ✅ minSdk 24, targetSdk 34, FGS service, App Links, multi-density

docs/
├── architecture-decisions/     16 ADRs (0001-0004, 0006-0017) — **falta 0005** (declarado en master plan)
├── adr/                        1 ADR (0018) — separado de architecture-decisions/
├── audits/                     7 docs (incl. AUDIT_EXHAUSTIVA_2026-05-19.md 3433 LOC)
├── compliance/                 LEY_19628.md (Chile)
├── observability/              SENTRY_ALERTS, DASHBOARDS
├── setup/                      Google Maps + medical icons
├── tracking/                   TRACKING_PLAN + event-catalog
└── ...
```

### 2.3 Lo que el usuario VE hoy (UX visible)

- Landing page pública
- Login (Google + biometric register/verify WebAuthn)
- Onboarding (industria + roles + plan)
- Dashboard con role-based view (Sprint J J.4)
- 155 páginas accesibles vía sidebar/routes
- **Pero NO ve 51% de los componentes implementados** (190 huérfanos sin wire)
- **Y NO ve los 3 flujos Zettelkasten flagship** que demuestran valor producto

### 2.4 Lo que el usuario NO VE pero existe (gap principal del proyecto)

**Categoría A — Implementado pero desconectado (wire pendiente):**
- 17 hooks compliance multi-país (UK/CA/AU/JP/KR/IN)
- 25+ servicios Sprint A-J sin componente UI consumidor:
  - `readReceiptService`, `exceptionEngine`, `consistencyAuditor`, `aiAuditLog`
  - `hazmatInventory`, `exposureRegistry`, `restrictedZonesEngine`
  - `loneWorkerService`, `evacuationHeadcount`, `faenaOnboardingBundle`
  - `externalAuditPortal`, `siteBookService`, `syncQueueTracker`
  - `stoppageEngine`, `criticalControlsLibrary`, `rootCauseClassifier`
  - `fatigueMonitor`, `equipmentQrService`, `riskRankingEngine`
  - `industryRuleEngine`, `legalObligationsCalendar`, `preventionCostCalculator`
  - `roleViewBuilder` (extiende Dashboard), `talkTopicSuggester`
  - `operationalChangeService`, `custodyChainService`, `shiftHandoverService`
- 50 componentes Modal sin base común (oportunidad consolidación)
- 87 oportunidades catálogo mascot (GuardianMascot por contexto)

**Categoría B — Features parciales (existe lógica, falta completar):**
- Mesh BLE: plugin Capacitor real, sin consumer en `src/`
- EPP Edge AI: usa Gemini-vision cloud, no edge TFLite local
- WearablesPanel: UI sin lectura sensores Health Connect + HealthKit
- Geofence: lógica parcial sin background tracking
- 3 WebAuthn STUB: `Ds76Builder:59`, `Ds67Builder:64`, `SusesoFormBuilder:90`
- Karin engine: código huérfano
- Pricing OC: descarga JSON, no PDF formal

**Categoría C — Funciones del informe taxonomía 255+ del usuario sin implementar:**
- **3 Flujos Zettelkasten flagship:**
  1. Inspección EPP → Inventario → Orden Compra
  2. Accidente → Investigación → Lección → Capacitación
  3. Horómetro → Mantenimiento Preventivo
- Catálogo 500+ industrias con códigos SII (infraestructura existe, completitud por verificar)
- LOTO digital (control energías)
- Bloqueo por Competencia (impide asignar tarea sin capacitación)
- Riesgos Psicosociales CEAL-SM (SUSESO emergente)
- Generador de Afiches (Imagen AI con Gemini Image)
- Risk Forecaster (ML predictivo clima+tareas+historial)
- API Gateway Enterprise (B2B integration)
- Computer Vision EPP detection (edge)

---

## 3. CÓMO DEBERÍA FUNCIONAR AL DAY-1 (visión producto)

### 3.1 Producto B2B SaaS prevención de riesgos laborales

**Mercado:** Chile (DS 54, DS 44/2024, Ley 16.744, ISO 45001) → LatAm → expansión global UK/CA/AU/JP/KR/IN/EU.

**Modelo:** 10-tier híbrido (Free + Comité + Departamento + Enterprise + verticales industria).

**Filosofía Flow Infinito** (privada, no en commits/docs/repo).

### 3.2 Compliance objetivo Day-1

- **Chile:** DS 54 ✅, DS 44/2024 ✅ (DS 40 derogado), Ley 16.744 ✅, Ley 19.628 (datos) ✅, Ley 19.496 (consumidor) ✅, Ley Karin 21.643 ✅, ISO 45001 ✅
- **LatAm:** Perú, Colombia, México (adapter pattern existente)
- **Global Day-1+:** UK HSE, CA OHS, AU WHS, JP Industrial Safety, KR OSHA, IN Factories Act
- **Day-1+ EU expansion:** EU AI Act compliance (Reglamento 2024/1689) — sistemas alto riesgo
- **OWASP Top 10 + STRIDE** ✅ (KMS preflight, WebAuthn, rate limit Firestore-backed, hash chain forense)

### 3.3 Visión arquitectura objetivo

- **Zettelkasten** como sistema nervioso del producto (private API, NO exposing pública per B2D directive)
- **A* determinístico** para evacuación + rutas críticas (Regla #3: NO Math.random)
- **5-tier AI fallback** (SLM offline → ZK → Firestore → Gemini → canned response)
- **Hash chain forense** tamper-proof en audit logs
- **CQRS pattern** en incidents domain
- **Outbox pattern** offline sync
- **Multi-tenant isolation** Firestore rules + KMS keys per-tenant
- **Cloud Run multi-region** Day-1+ (failover us-east1 via `scripts/dr-failover.sh`)

### 3.4 KPIs Day-1 (del informe taxonomía 255+ del usuario)

| Métrica | 2025 | 2026 |
|---|---|---|
| Clientes | 500 | 2500 |
| ARR | $500K | $5M |
| Retention | >85% | >90% |
| NPS | >50 | >70 |
| Trabajadores protegidos | 50K | 250K |
| Accidentes prevenidos | 500 | 2500 |
| Horas capacitación | 100K | 500K |

### 3.5 Métricas técnicas Day-1

- Uptime 99.9%, Response p95 <200ms, Error rate <0.1%
- Test coverage >80%, Mutation score >75%
- Lighthouse >90 (accessibility/best-practices/performance)
- E2E ponderado real >95%

---

## 4. PLAN SECUENCIAL — 110+ items en orden estricto

> Orden: primero lo primero, segundo lo segundo, etc. Cada bloque se completa antes de pasar al siguiente. Items dentro del bloque se pueden paralelizar con worktrees.

### BLOQUE 1 — Seguridad latente + CI green (PRIMERO, ~2-3 días)

**Por qué primero:** exposiciones de seguridad activas + CI rojo bloquea todo lo demás.

| Orden | Item | Severidad | Esfuerzo | Skill recomendado |
|---|---|---|---|---|
| 1.1 | **C20** — Verificar fix CI Playwright pushed (commit `29baf4c1`) | P0 | 30min | — |
| 1.2 | **C6** — OAuth refresh `AbortController` + timeout 10s (`oauthTokenStore.ts:197`) | P0 | 1h | `superpowers:tdd` + `cso-praeventio` |
| 1.3 | **C7** — Sweep `AbortController` en fetch Gemini/OpenWeather/USGS (~10 archivos) | P0 | 4h | `everything-claude-code:build-fix` |
| 1.4 | **C8** — OAuth refresh Idempotency-Key + lock per-user (`oauthTokenStore.ts:215-219`) | P0 | 4h | `superpowers:tdd` + `cso-praeventio` |
| 1.5 | **D9** — Auditar WebAuthn register flow `credentialId` (H25b.1) en `useBiometricAuth.ts` | P0 seguridad | 4h | `cso-praeventio` + `everything-claude-code:security-reviewer` |
| 1.6 | **B2** — Worker auth bypass (cloud-run/photogrammetry-worker) | P0 | 2h | `cso-praeventio` |
| 1.7 | **B1** — Catch-all SPA `/api/*` bloquea Webpay return | P0 | 2h | — |
| 1.8 | **B4** — FCM SW hardcoded keys | P0 | 1h | — |
| 1.9 | **B8** = **H18** = **C2 parcial** — AASA TEAMID placeholder (`apple-app-site-association:6,9`) | P0 | bloqueado | (Bloqueado: Apple Developer Account) |
| 1.10 | **C9** — Mutation orchestrator.ts: 7.69% → 70%+ (48 mutantes vivos) | P0 | 1 sprint | `superpowers:tdd` + `everything-claude-code:test-coverage` |
| 1.11 | **C10** — Tests para 10 rutas API críticas (emergency, OAuth, billing, audit, admin, import, compliance, subscription, health, onboarding) | P0 | 1 sprint | `superpowers:subagent-driven-development` (paralelizar 10 worktrees) |

**Verificación post-Bloque 1:**
- `npm test` 10030/10030 (sin skip)
- `npm run test:e2e:full` Playwright passing
- Mutation orchestrator.ts ≥70%
- 10 rutas críticas con coverage E2E

---

### BLOQUE 2 — Governance + ADR + branches cleanup (~1 día)

**Por qué segundo:** establece fuente única de verdad antes de tocar producto.

| Orden | Item | Esfuerzo | Skill |
|---|---|---|---|
| 2.1 | **C1** — Crear `docs/architecture-decisions/0005-photogrammetry-pipeline.md` (declarado en master plan, no existe) | 1h | `everything-claude-code:doc-updater` |
| 2.2 | **Bulk delete 213 branches huérfanas** (verificado §30 todo squashed) | 1-2h | — |
| 2.3 | **EXTRACT propuestas** de 15 docs históricos a TODO.md (directiva 2026-05-17) — antes de archivar | 4-6h | `everything-claude-code:doc-updater` + `everything-claude-code:learn` |
| 2.4 | **Archivar** docs a `docs/archive/2026-05/` post-EXTRACT (15 docs raíz + audits viejos) | 1h | — |
| 2.5 | **D1 continuación** — sweep H5 correos canónicos restante en `marketplace/*.md` + `*.md` raíz (SECURITY.md, README.md, MARKETPLACE_SUBMISSION.md, MONITORING.md, CONTRIBUTING.md, DR_RUNBOOK.md, infrastructure/terraform/monitoring.tf, infrastructure/cloud-scheduler.yaml) | 1h | — |
| 2.6 | **Tests de contrato anti-drift** (5 archivos `src/__tests__/contracts/*.test.ts`): contactEmail, releaseBlockers, playwrightHealth, docConsistency, sentryConfig | 4h | `superpowers:tdd` |
| 2.7 | **D-COMP** — crear `docs/COMPETITORS.md` (SafeHS, SafetyMind, Zyght, Prodity, Twind, PrevenControl) | 2h | — |

**Verificación post-Bloque 2:**
- `git branch -r | wc -l` ≤ 5
- `ls docs/architecture-decisions/*.md | wc -l` = 17
- `ls docs/archive/2026-05/*.md | wc -l` ≥ 15
- Tests de contrato passing
- `grep -rn "soporte@\|privacidad@\|security@\|ventas@\|founder@\|dev@" --include="*.md"` sin matches no canónicos

---

### BLOQUE 3 — Wire huérfanos visibles (UI salto) (~1-2 semanas)

**Por qué tercero:** el usuario VE features ya construidas. Es el bloque de mayor ROI percibido.

**Esfuerzo:** 25 servicios Sprint A-J sin UI consumer + 190 componentes huérfanos = mucho trabajo. Priorizar top 30 visibles.

| Orden | Servicio Sprint | UI requerida | Skill |
|---|---|---|---|
| 3.1 | Sprint G `loneWorkerService` | check-in widget mobile + admin dashboard | `ui-ux-pro-max` |
| 3.2 | Sprint G `evacuationHeadcount` | `<EvacuationDashboard />` + QR scanner | `ui-ux-pro-max` |
| 3.3 | Sprint G `hazmatInventory` | `<HazmatStorageManager />` | `ui-ux-pro-max` |
| 3.4 | Sprint G `restrictedZonesEngine` | overlay mapa + `<ZoneEntryGate />` | `ui-ux-pro-max` |
| 3.5 | Sprint G `readReceiptService` | `<DocumentReadConfirmModal />` | `ui-ux-pro-max` |
| 3.6 | Sprint H `siteBookService` | `<SiteBookViewer />` + `<NewEntryForm />` | `ui-ux-pro-max` |
| 3.7 | Sprint H `externalAuditPortal` | `<PortalManager />` admin + portal público | `ui-ux-pro-max` |
| 3.8 | Sprint I `stoppageEngine` | `<StoppageBanner />` + reanudación modal | `ui-ux-pro-max` |
| 3.9 | Sprint I `criticalControlsLibrary` | `<PreTaskValidationModal />` (terreno mobile) | `ui-ux-pro-max` |
| 3.10 | Sprint I `rootCauseClassifier` | `<RootCauseWizard />` | `ui-ux-pro-max` |
| 3.11 | Sprint I `equipmentQrService` | `<PreUseChecklistMobile />` + QR scanner | `ui-ux-pro-max` |
| 3.12 | Sprint I `riskRankingEngine` | `<TopRisksWidget />` + `<WeakControlsWidget />` | `ui-ux-pro-max` |
| 3.13 | Sprint J `industryRuleEngine` | wizard onboarding `<IndustrySelector />` | `ui-ux-pro-max` |
| 3.14 | Sprint J `legalObligationsCalendar` | `<LegalCalendarView />` + reminders | `ui-ux-pro-max` |
| 3.15 | Sprint J `preventionCostCalculator` | `<CostSimulator />` | `ui-ux-pro-max` |
| 3.16 | Sprint J `roleViewBuilder` | extiende Dashboard con role-based | `ui-ux-pro-max` |
| 3.17 | Sprint J `operationalChangeService` (MOC) | `<ChangeDeclarationForm />` + ack flow | `ui-ux-pro-max` |
| 3.18 | Sprint J `shiftHandoverService` | `<ShiftHandoverPanel />` cambio turno | `ui-ux-pro-max` |
| 3.19 | **C16** — KnowledgeGraph.tsx: 16 useState → useReducer + memoization | `frontend-design` + `everything-claude-code:code-architect` |
| 3.20 | **C17** — 50 Modal components → BaseModal común | `ui-ux-pro-max` + `everything-claude-code:design-system` |
| 3.21 | **C18** — 4 imgs sin alt fix (MorningRoutine, AnatomyLibrary, FindTheGuardian, EPPCharacter) | `everything-claude-code:a11y-architect` |
| 3.22 | **C19** — 3 `key={index}` fix (CompensatoryExercises, NormativeQuiz, FirstAidCards) | — |

**Patrón de migración (7 pasos por feature, ver §31.4 del AUDIT):**
1. Crear `src/server/routes/{domain}.ts` con endpoints del feature
2. Crear `src/hooks/use{Feature}.ts` con hook cliente
3. Verificar que la página existente consuma el nuevo hook
4. Agregar entrada Sidebar con sub-menú por dominio
5. Test contractual (importa endpoint, verifica hook lo llama)
6. Si genera/consume nodos ZK, agregar `NodeFactory` en `src/services/zettelkasten/families/`
7. Commit atómico → push → CI verde

**Verificación post-Bloque 3:**
- Sidebar con 18 sub-menús dominio: Personal / EPP / Capacitación / Riesgos / Compliance / Emergencias / Operaciones / Cultura / Liderazgo / IA / Pricing / Reportes / Datos / Importación / Maquinaria / Medicina / Documentos / Análisis
- 30+ features Sprint A-J wireados a UI visible
- Tests de contrato endpoint↔hook passing

---

### BLOQUE 4 — Flujos Zettelkasten flagship (~3 semanas)

**Por qué cuarto:** demuestran el valor diferencial del producto (sistema nervioso ZK). Requieren los wires de Bloque 3 ya hechos.

| Orden | Flujo | Esfuerzo | Skill |
|---|---|---|---|
| 4.1 | **D-FLUJO3** — Horómetro → Mantenimiento Preventivo (primer flujo según informe usuario, "primera demostración del poder Zettelkasten") | 1 sprint | `superpowers:dispatching-parallel-agents` + `ui-ux-pro-max` |
| 4.2 | **D-FLUJO1** — Inspección EPP → Inventario → Orden Compra (continuidad operacional automatizada) | 1 sprint | `superpowers:dispatching-parallel-agents` |
| 4.3 | **D-FLUJO2** — Accidente → Investigación → Lección Aprendida → Capacitación (cierra ciclo PDCA aprendizaje organizacional) | 1 sprint | `superpowers:dispatching-parallel-agents` + `everything-claude-code:architect` |

**Cada flujo requiere:**
- ZK NodeFactory por nodo del flujo
- Trigger automático (cron job o evento dominio)
- UI navigation Risk Network
- Notificaciones FCM
- Audit log inmutable cada paso

**Verificación:**
- Demo a prevencionista chileno: navegar end-to-end un flujo desde origen al cierre, ver el ZK Risk Network actualizado
- Tests E2E Playwright del flujo completo

---

### BLOQUE 5 — Type safety + resilience sweep (~1-2 semanas)

**Por qué quinto:** fortalece foundation antes de expansion. Tras Bloques 1-4 el producto es VISIBLE y FUNCIONAL; ahora robusto.

| Orden | Item | Esfuerzo | Skill |
|---|---|---|---|
| 5.1 | **C11** — Sweep 355 `any` → `unknown` + type guards | 1 sprint | `everything-claude-code:typescript-reviewer` (paralelizar por dominio) |
| 5.2 | **C12** — Sweep 783 type assertions `as X` → zod schemas + safeParse | 1 sprint | `everything-claude-code:typescript-reviewer` + `superpowers:tdd` |
| 5.3 | **C13** — Sentry spans en auth/SOS/KMS/payment hot paths | 2 días | `everything-claude-code:silent-failure-hunter` |
| 5.4 | **C14** — SyncManager distributed lock (Firestore-backed, Cloud Run scale-out) | 1 día | `superpowers:systematic-debugging` |
| 5.5 | **C15** — Colapsar `geminiService.ts` (126 LOC wrapper) → `geminiBackend.ts` directo | 1 día | `everything-claude-code:code-simplifier` |
| 5.6 | **D2** — Lint real cubrir `src/**/*.{ts,tsx}` con typescript-eslint + react-hooks (deps ya en devDeps) | 1 día | `everything-claude-code:build-fix` |
| 5.7 | **D7** — Update `oauthTokenStore.ts:19-20` comentario stub KMS obsoleto (kmsAdapter real) | 5min | — |
| 5.8 | **D8** — README update claim mutation/lint post-D2 | 10min | `everything-claude-code:update-docs` |
| 5.9 | **D10** — Excluir `src/rules-tests/**` del vitest default (sólo via `npm run test:rules`) | 30min | — |
| 5.10 | **D11** — Sweep 42 `alert()` → `useToast()` | 1 día | `ui-ux-pro-max` + `everything-claude-code:design-system` |

---

### BLOQUE 6 — Performance + bundle optimization (~1 semana)

| Orden | Item | Esfuerzo | Skill |
|---|---|---|---|
| 6.1 | **D12** — Vite `manualChunks` MediaPipe + Three.js (~500KB c/u code split) | 4h | `everything-claude-code:performance-optimizer` |
| 6.2 | **D3** = **H10** — Backend tsc → `dist/server/`, `start: node dist/server/server.js` | 1 día | `everything-claude-code:build-fix` |
| 6.3 | **D4** — `.npmrc legacy-peer-deps` audit (investigar deps incompatibles, OSS-first replacement) | 2-3 días | `superpowers:brainstorming` |

---

### BLOQUE 7 — Compliance multi-país wire (~1-2 semanas)

| Orden | Item | Esfuerzo | Skill |
|---|---|---|---|
| 7.1 | Wire UI 17 hooks compliance multi-país (UK/CA/AU/JP/KR/IN) | 1-2 semanas | `superpowers:dispatching-parallel-agents` (6 worktrees por país) |
| 7.2 | Citation snippets dinámicos por país | — | — |
| 7.3 | Tests E2E por país (mock localidad) | — | `superpowers:tdd` |

---

### BLOQUE 8 — Producto pendiente + Day-1 prep (~2-3 semanas)

| Orden | Item | Esfuerzo | Skill |
|---|---|---|---|
| 8.1 | **C3** — Photogrammetry worker dedup (`infra/` Python vs `cloud-run/` TypeScript) — decisión canónico + eliminar otro o ADR uso dual | 1 día | `everything-claude-code:architect` |
| 8.2 | **C4** — `marketplace/manifest.json` pricing enum "External pricing" decision | 30min | — |
| 8.3 | **C5** — `tests/e2e/landing.spec.ts` un-skip + Firebase test config CI | 2h | `superpowers:tdd` |
| 8.4 | **D5** — Pricing OC PDF formal (reusar `diatPdfRenderer.ts` patrón) | 1 día | `everything-claude-code:doc-updater` |
| 8.5 | **D-IND** — Auditar catálogo 500+ industrias SII completitud (`src/data/industryIPER.ts`, `src/services/industryRules/`, `src/services/pricing/eppIndustryCatalog.ts`) | 4h | `everything-claude-code:code-explorer` |
| 8.6 | **D-KPI** — Integrar KPIs 2025-2026 al TODO §6 criterios éxito Day-1 | 30min | — |
| 8.7 | iOS native scaffolding (**C2** = **H18 unblock**) — `npx cap add ios` (requiere macOS + Xcode + Apple Developer Account) | XL 1 semana | (Bloqueado externamente) |
| 8.8 | **D14** — Mobile CI/CD pipeline iOS/Android (post keystore + Apple Dev) | 1 semana | `superpowers:devops` |

---

### BLOQUE 9 — Long-tail backlog + Day-1+ (~Day-1 post)

| Orden | Item | Cuándo |
|---|---|---|
| 9.1 | **D6** — `tsconfig.json allowJs` eliminar post `.js` → `.ts` sweep | Iterativo |
| 9.2 | **D13** — EU AI Act compliance audit (Reglamento UE 2024/1689) | Antes EU expansion |
| 9.3 | Sprint K remaining ~85 items (§26, §31-32 LOTO, §45, §47-48, §59, §85-89, §97-99, §105, §109-112, §116, §119-128, §146-170, §180-184, §191-194, §201-243, §251-270) | Distribuido en futuras fases |
| 9.4 | Sprint L 9 sub-épicas restantes auditar | Cuando se confirme estado |
| 9.5 | API Gateway Enterprise (B2B integration) | Day-1+ |
| 9.6 | Marketplace de Add-ons (ecosistema partners) | Day-1+ |
| 9.7 | Blockchain certificaciones inmutables (viem/ethers OSS-first) | Day-1+ |
| 9.8 | Computer Vision EPP detection (edge TFLite) | Day-1+ |
| 9.9 | Voice AI manos libres (`GuardianVoiceAssistant.tsx` extender) | Day-1+ |
| 9.10 | Digital Twin completo (foundation existe en `src/components/twinScene/`) | Day-1+ |
| 9.11 | AR/VR mantenimiento | Day-1+ |
| 9.12 | Risk Forecaster (ML predictivo clima+tareas+historial) | Day-1+ |

---

## 5. RESTRICCIONES INVIOLABLES (directivas usuario verificadas)

1. **No exponer Zettelkasten en API pública** (B2D API model)
2. **No mencionar "Flow Infinito"** en repo/commits/docs (filosofía privada)
3. **Skill-first heuristic** — anunciar skill antes de proceso largo
4. **Runtime productivo en Gemini + Vertex AI Agent Builder** (Claude Code SOLO desarrollo)
5. **Nunca bloquear maquinaria**, solo recomendar
6. **Nunca push automático SUSESO/SII/MINSAL/OSHA** — empresa firma+entrega
7. **Nunca XP negativo por factores incontrolables**
8. **Datos externos como enriquecedor discreto** (no centrales)
9. **Regla TODO.md #1**: nada se marca ✅ sin file:line
10. **Regla TODO.md #3**: PRODUCIR la solución (fallback determinístico), no etiquetar ni sacar
11. **Patrón multi-agente**: worktree aislado obligatorio (lección plan vivo línea 1970)
12. **Correo único empresa: `contacto@praeventio.net`** (directiva 2026-05-17). Excepciones técnicas: `noreply@` (SMTP), `marketplace-demo@` (test)
13. **OSS-first si hay problemas de licencia** (directiva 2026-05-17): forkear OSS equivalente antes de quedarse atado
14. **Sprint K = lista de pendientes, NO archivo** (directiva 2026-05-17 — ya aplicado, 294 routes modulares)
15. **EXTRACT propuestas a TODO.md ANTES de archivar docs** (directiva 2026-05-17)
16. **DS 44/2024 vigente** (DS 40 derogado 2025-02-01) — toda referencia DS 40 debe tener anotación histórica

---

## 6. SKILLS LOCALES — mapeo recomendado por bloque

| Skill | Cuándo usar | Bloques |
|---|---|---|
| `ui-ux-pro-max:ui-ux-pro-max` | TODO cambio UI (componentes React + Tailwind) | 3, 4, 5.10 |
| `superpowers:using-git-worktrees` | Aislar trabajo paralelo | 1.10-1.11, 3, 4, 5.1, 7 |
| `superpowers:dispatching-parallel-agents` | 4+ tareas independientes simultáneas | 3, 4, 7 |
| `superpowers:subagent-driven-development` | TDD con subagents por dominio | 1.10-1.11, 4 |
| `superpowers:tdd` | TDD para nuevas features | 1.2, 1.4-1.5, 4, 5.2 |
| `superpowers:systematic-debugging` | Debug complejo | 1.x, 5.4 |
| `superpowers:verification-before-completion` | Gate previo a cada commit | TODOS |
| `superpowers:writing-plans` | Sub-planes por bloque | Inicio de cada bloque |
| `superpowers:executing-plans` | Durante ejecución | TODOS |
| `superpowers:requesting-code-review` | Coordinar con Codex | Antes de cada PR |
| `superpowers:receiving-code-review` | Procesar feedback | Tras Codex review |
| `superpowers:finishing-a-development-branch` | Cierre limpio PR | Al final de cada PR |
| `superpowers:brainstorming` | Desbloqueos creativos | 6.3 |
| `everything-claude-code:gan-design` | Piezas visuales críticas | Landing, demo project |
| `everything-claude-code:multi-frontend` | Multi-modelo components+layouts | 3.x |
| `everything-claude-code:design-system` | Auditar consistencia visual | 3.20, 5.10 |
| `everything-claude-code:multi-plan` | Roadmaps multi-modelo | Inicio sesión |
| `everything-claude-code:plan` | Risk assessment antes sprint | Cada bloque |
| `everything-claude-code:council` | Decisiones ambiguas (4 voces) | 8.1 (photogrammetry dedup) |
| `everything-claude-code:tdd-workflow` | Workflow alternativo TDD | 1.10-1.11, 4 |
| `everything-claude-code:test-coverage` | Gap analysis hacia 80%+ | 1.10, 5.2 |
| `everything-claude-code:e2e-testing` | Reactivar landing E2E | 8.3 |
| `everything-claude-code:browser-qa` | Verificación post-deploy | Tras cada deploy |
| `everything-claude-code:code-review` | Review local antes PR | Antes de cada PR |
| `everything-claude-code:typescript-reviewer` | 355 `any` + 783 assertions | 5.1, 5.2 |
| `everything-claude-code:security-reviewer` | Nuevas APIs + Hallazgos seguridad | 1.x, 2.6, 7 |
| `everything-claude-code:silent-failure-hunter` | Swallowed errors | 5.3 |
| `everything-claude-code:type-design-analyzer` | Invariantes services | 5.1, 5.2 |
| `everything-claude-code:architect` | Diseño arquitectónico | 4 (flujos ZK), 8.1 |
| `everything-claude-code:code-explorer` | Mapear dependencias | 8.5 (catálogo industrias) |
| `everything-claude-code:code-architect` | Blueprints implementación | 4 |
| `everything-claude-code:code-simplifier` | Cleanup post-refactor | 5.5 |
| `everything-claude-code:refactor-cleaner` | Dead code con knip/depcheck/ts-prune | 5.x, 9.x |
| `everything-claude-code:build-fix` | Incremental fix typecheck/lint | 5.6, 6.2 |
| `everything-claude-code:build-error-resolver` | Minimal-diff fixes | 5.6 |
| `everything-claude-code:update-codemaps` | `docs/CODEMAPS/*` post-refactor | Post Bloque 3, 5 |
| `everything-claude-code:update-docs` | Sync README/CONTRIBUTING | 5.8 |
| `everything-claude-code:doc-updater` | Orquestación docs | 2.1, 2.3, 8.4 |
| `everything-claude-code:learn` + `learn-eval` | Extraer patterns post-fase | Post Bloque 3, 4 |
| `everything-claude-code:a11y-architect` | WCAG 2.2 | 3.21 |
| `everything-claude-code:performance-optimizer` | Bundle + perf | 6.1 |
| `everything-claude-code:harness-audit` | Scorecard determinístico | Trimestral |
| `everything-claude-code:workspace-surface-audit` | Drift detection | Trimestral |
| `frontend-design:frontend-design` | Alternativa creativa anti-AI-genérico | 3.x cuando ui-ux-pro-max necesita 2da opinión |

---

## 7. ARCHIVOS DE REFERENCIA CLAVE (al arrancar nueva sesión LEER PRIMERO)

| Archivo | LOC | Contenido |
|---|---|---|
| `docs/audits/AUDIT_EXHAUSTIVA_2026-05-19.md` | 3433 | 31 secciones, hallazgos completos con file:line |
| `docs/audits/BRANCHES_INVENTORY_2026-05-19.md` | 232 | 214 branches huérfanas tabla |
| `TODO.md` | 1119 | 15 secciones, 110+ items por prioridad |
| Plan exhaustivo 2026-05-17 (provisto por usuario) | ~2000 | 38 hallazgos H1-H26 + H25b.1-13 |
| `ARCHITECTURE.md` | — | Mapa módulos |
| `RUNBOOK.md` | — | Operaciones |
| `SECURITY.md` | — | Disclosure (correo H5 sweep pendiente) |
| `BERNOULLI_EXTENSIONS.md` | — | 12 calculadoras (Bloque 8) |

**Comando inicial recomendado al abrir local:**
```
1. cat docs/audits/AUDIT_EXHAUSTIVA_2026-05-19.md | less
2. cat TODO.md | less
3. git log --oneline origin/main | head -20
4. git status
```

---

## 8. ESTADO DEL PR #450 AL CERRAR SESIÓN CLOUD

- Branch: `claude/review-pending-tasks-aUDD2`
- HEAD SHA: `5fd3fa39` (último commit con §31 + H5 sweep)
- CI: pending sobre nuevo SHA — esperar webhook
- `mergeable_state: dirty` — necesita rebase contra main (main avanzó 1 commit durante la sesión)

**Recomendación al abrir local:**
1. `git fetch origin`
2. `git checkout claude/review-pending-tasks-aUDD2`
3. `git rebase origin/main` (resolver conflictos si los hay)
4. Verificar CI verde
5. Continuar con Bloque 1 (P0 seguridad)

---

## 9. VERIFICACIÓN END-TO-END (cómo validar Day-1)

- **Tests:** `npm test` 10030/10030 + `npm run test:e2e:full` + `npm run test:rules` + `npm run mutation` ≥75%
- **Lint:** `npm run lint` 0 errors, warnings ≤ baseline
- **TypeScript:** `npm run typecheck` 0 errores
- **Build:** `npm run build` exitoso, bundle ≤ `.size-limit.json`
- **Lighthouse CI:** accessibility ≥90, best-practices ≥90, performance ≥80
- **CI:** 8/8 workflows verdes 7 días consecutivos
- **Demo a prevencionista chileno:** confirma DS 44/2024 vigente, NO refs DS 40 sin anotación
- **Auditor externo pentest:** OWASP Top 10 + STRIDE + prompt-injection clean
- **Cobertura E2E ponderada:** ≥95%

---

## 10. RESUMEN EJECUTIVO

**Estado HOY (verificado 2026-05-19):**
- ✅ Infraestructura production-ready (workers + IaC + scripts críticos)
- ✅ Backend 542 endpoints, 167 routes (Sprint K modularizado en 294 archivos)
- ✅ Tests 10029/10030 passing
- ✅ Compliance DS 44/2024 migrado (10/10 archivos con anotación histórica)
- ✅ Android nativo listo signing
- ❌ iOS native solo fastlane (bloqueado Apple Dev)
- ❌ 51% componentes UI desconectados (190 huérfanos)
- ❌ 30+ fetch sin timeout (slow HTTP attack surface)
- ❌ Mutation orchestrator 7.69% (48 mutantes vivos)

**Esfuerzo restante Day-1 mundial:** ~13 semanas-dev (12 sem cubierto + 1 sem D-items integrados)

**Skills críticas para arrancar local:**
- `superpowers:writing-plans` + `everything-claude-code:plan` para sub-plans por bloque
- `ui-ux-pro-max` para Bloque 3 (wire huérfanos)
- `superpowers:dispatching-parallel-agents` para Bloques 1.10-1.11, 3, 4, 7
- `cso-praeventio` + `everything-claude-code:security-reviewer` para Bloque 1

**Total items en este plan:** 110+ items distribuidos en 9 bloques secuenciales + 12 long-tail Day-1+.

---

**Última actualización:** 2026-05-19 — sesión cloud cerrada con commits `9fd8f97b` → `5fd3fa39`. PR #450 pending merge. Próxima sesión: local con skills disponibles.
