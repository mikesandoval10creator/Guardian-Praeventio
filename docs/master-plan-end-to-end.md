# Master Plan End-to-End — Guardian Praeventio

Fecha: 2026-05-04 · Branch base: `dev/sprint-20-master-plan-end-to-end-2026-05-04` · Sucesor de `auditoria777.md` y `auditoria777-parte2.md` · Predecesor del Sprint 20 ejecutivo.

## Progreso Sprint 20 multi-agent execution (2026-05-04)

### Primera ola — 3 buckets (PR #28 mergeado)

- **Alpha — KMS bug fix** (Fase 11 anticipada): `e1e121b` — `KMS_ADAPTER=in-memory-dev` → `cloud-kms` en deploy.yml + `KMS_KEY_RESOURCE_NAME` env var. Operator follow-up: provisionar secret antes próximo prod deploy.
- **Beta — IPERC split F-C13** (Fase 4 anticipada): `1cf53f0` — IPERCAnalysis 634 → 519 LOC, IPERCMatrix.tsx nuevo 145 LOC.
- **Gamma — SLM scaffolding T-1.1**: `7c02ead` — types + registry (3 modelos) + 8 tests.
- Bonus: `8b004c1` script retry/backoff respetando free tier Gemini.

### Sexta ola — 4 buckets (PR #34)

- **Psi — @sentry/react client init** (2 commits, Fase 2 client-side): `54b2798` Sentry init endurecido con `replaysSessionSampleRate: 0.05` + `replaysOnErrorSampleRate: 1.0` + redacción PII (cookies/auth headers/user.email/contexts.user.email/request.cookies) + `redactPii()` helper exportable + idempotency guard · `baa3c11` `Sentry.ErrorBoundary` wrap + `ErrorFallback.tsx` reusable con i18n (`errors.unexpected`, `errors.team_notified`, `errors.event_id`, `common.retry`). 4 nuevos tests, 26 sentry total pass.
- **Omega — Image optimization** (3 commits, Fase 5 parcial): `8764dd9` preload Inter weights en `index.html` (preconnect + preload-as-style pattern para Google Fonts) · `64c788a` `scripts/convert-to-webp.mjs` con `sharp@0.34` (transitive dep, no install) · `27ad938` `mascot.png` (931KB) → `mascot.webp` (86KB, **-90.7%**) en 3 call sites con `<picture>` fallback (ConsciousnessLoader + EmptyState + Login).
- **A-prime — Accessibility shell** (3 commits, Fase 6): `2420550` `RootLayout` + `Sidebar` con skip link / `<main>` landmark / `<header role="banner">` / `<nav aria-label>` / `aria-current="page"` / `aria-expanded`+`aria-controls` en grupos · `01bc34c` `Settings` con accordion sections (`<button aria-expanded>`+`<div role="region">`), 10 toggles con `role="switch"`+`aria-checked`+`aria-label`, `aria-busy` en fall-detection load, `useId()` en 9 form fields · `848e2f7` `Login` con `<main role="main">` + `aria-busy` en submit + `<p role="alert">` + `aria-describedby` + `aria-label` botones (no hay register dedicada — todo OAuth/biometric).
- **B-prime — i18n coverage cont.** (1 commit, Fase 6): `2e9b5ae` 7 componentes migrados (`CookieConsent` legal + `NormativaSwitch`+`NormativaMismatchBanner` normativa + `AddFindingModal` findings + `AddDocumentModal`+`EditDocumentModal` documents + `AssignEPPModal` epp + `CurrencyToggle` pricing/currency). 6 nuevos namespaces con keys es/en/pt-BR.

Total 9 commits + master plan. **2028 tests pass / 0 fail / 88 skipped**. Build OK con preload fonts + WebP picture fallback.

### Quinta ola — 4 buckets (PR #32)

- **Rho — `reconciliationRunner.ts`** (1 commit, completa lo deferido de Xi 4ta ola): `eae3ef4` adapter que mappea `QueuedSession → RiskNodePayload (type='safety-learning')` y llama `writeNodes` real del Zettelkasten. Único punto en `src/services/slm/` que importa de `../zettelkasten/`. 4 nuevos tests, 56 SLM total pass.
- **Sigma — Real BPE tokenizer Phi-3 (T-1.3.1)** (4 commits): `c69c696` `@huggingface/transformers@3.8.1` runtime dep · `d5cdf20` `tokenizerUrl?: string` en `ModelDescriptor` + URLs HF para Phi-3/Qwen/Gemma · `18eef6b` `AutoTokenizer.from_pretrained` con dynamic import + fallback al `NaiveTokenizer` si load/decode fallan · `36a7954` 3 smoke tests con `vi.doMock`. 43 SLM tests pass.
- **Tau — i18n coverage (Fase 6 parcial)** (1 commit): `b3e35c4` 5 componentes migrados (`ISOManagementHeader`, `AddAuditModal`, `AddMedicineModal`, `AnatomyLibrary`, `SurvivalMode`) con `t('key', 'fallback')` pattern. 104 keys nuevas en `es` (canonical ES-CL), `en`, `pt-BR`. `es-AR`/`es-MX`/`es-PE` heredan via `fallbackLng`. Refactor `BreathingPhase` enum-style para hacer motion logic locale-agnostic.
- **Phi — Wire Asesor al orchestrator** (1 commit): `4dd4f9e` `AsesorChat.tsx` (main floating chat) + `Asesor.tsx` (emergency tactical) ambos llaman `ask({ prompt })` del orchestrator en lugar de `fetch('/api/ask-guardian', ...)` directo. `enqueueSession` cuando backend offline + `SLM_ENQUEUED_EVENT` dispatch + `pendingCount` badge en header + chip "online/offline". Streaming SSE removido (orchestrator returns single response — UX side-effect, no diseñado).

### Cuarta ola — 4 buckets (PR #31)

- **Nu — Wire SLM al app real** (2 commits): `83e28fa` SLMProvider con `isOnline`/`pendingCount`/`activeModelId` + listeners `online`/`offline` + poll `listPending()` + custom event `gp-slm-enqueued` · `938bff0` SLMShellOverlay (banner global fixed top, mode-aware vía `useAppMode`) integrado en `AppProviders.tsx`. 4 nuevos tests passing.
- **Xi — Orchestrator online path** (1 commit, commiteado por orchestrator principal por timeout): `085ab42` `callOnlineBackend` real a `/api/ask-guardian` con Firebase ID token (dynamic import seguro), latency client-side, fallback al SLM si falla. `'gemini'` agregado al `SLMBackend` union. Pendiente del bucket: `reconciliationRunner.ts` (deferido a próxima ola).
- **Omicron — Listeners onSnapshot refactor real** (1 commit, Fase 7 cerrada): `d6e9100` 4 listeners ahora con filtros — DocsModal `where('archived','==',false).limit(50)`, EmergencyCheckIn `where('timestamp','>=',last24h).orderBy.limit(100)`, EmergenciaAvanzada `limit(50)`, ControlsAndMaterials `where('active','==',true).limit(200)` ambas queries. TODOs Sprint 20+ removidos, replaced con schema contract notes.
- **Pi — Accessibility (Fase 6 parcial)** (4 commits, último commiteado por orchestrator): `d666eca` `@axe-core/playwright` devDep · `386db7d` `tests/e2e/accessibility.spec.ts` con axe analysis (gated `E2E_FULL_STACK`) · `4663ef5` aria-label en icon-only buttons en CrisisChat + EmergencyDashboard · `b135f27` skip link `<a href="#main-content">` + `<main id="main-content" tabIndex={-1}>` landmark en LandingPage (WCAG 2.4.1).

### Tercera ola — 4 buckets (PR #30)

- **Iota — T-1.3 ONNX inference real** (1 commit): `c648877` — `slmWorker.ts` con `ort.InferenceSession` (WebGPU/WASM fallback), greedy decoding, two-layer fallback al stub determinístico si init/generate fallan. 27/27 tests SLM pass.
- **Kappa — T-1.4 adapter + orchestrator + queue + reconciliation** (5 commits): `57361d1` slmAdapter facade · `8973bbc` orchestrator selector online/offline · `e040af7` offlineQueue IndexedDB v2 · `7f92807` reconciliation con writeFn inyectado · `0c5527b` index barrel re-exports. 36 tests SLM pass.
- **Lambda — T-1.5 SLM UI** (3 commits): `7e35fe5` SLMStatusPanel · `71d7d7e` SLMModelPicker · `d1780f9` OfflineSLMBanner con 4-mode tokens + framer-motion. 12/12 tests pass.
- **Mu — Fase 2 Sentry instrumentación** (archivos en `0c5527b` por race con Kappa, +1 fix): `withSentryScope` helper en `@sentry/core` (browser-safe vs `@sentry/node` que rompía bundle frontend), 4 servicios instrumentados (gemini/webpay/prediction/zettelkasten), 8 tests. Fix en `99c3e3f` para resolver build.

### Segunda ola — 3 buckets (PR #29)

- **Delta — ISOManagement split F-C14** (Fase 4 anticipada): `059665d` — ISOManagement 773 → 614 LOC, ISOManagementHeader.tsx (128 LOC) + ISOManagementFilters.tsx (130 LOC) extraídos.
- **Epsilon — SLM Web Worker T-1.2** (Fase 1, 3 commits): `3c7743b` IndexedDB modelCache + 7 tests · `64eb404` loader con fetch streaming + cache + onProgress + 4 tests · `388eb89` Web Worker proxy + onnxruntime-web@1.20+ + comlink integration. Inferencia real con prompt→tokens deferred a T-1.3 con stub determinístico actual.
- **Eta — Performance lazy-load** (Fase 5 anticipada parcial, 2 commits): `52ab7f0` `react-force-graph-3d` + `jspdf` lazy en KnowledgeGraph · `71d190a` tesseract.js lazy en DocumentOCRManager. Bundle delta: ~470KB+ raw fuera del main bundle, descarga on-demand.

### Estado verificación post-second-wave

- `npm run typecheck` clean.
- `npm test` — **1976 pass / 0 fail / 88 skipped** (+15 nuevos tests SLM cache+loader vs primera ola).
- `npm run build` — OK, chunks separados confirmados (`react-force-graph-3d-*.js.br` 25KB brotli, `jspdf.es.min-*.js.br` 99KB brotli, `Workers-*.js.br` 18KB brotli con onnxruntime-web excluido del bundle vía `optimizeDeps.exclude`).

### Pendientes ejecutables tras estas dos olas

| Item | Fase | Próximo bucket |
|---|---|---|
| Inferencia SLM real (prompt→tokens con onnxruntime-web) | 1 T-1.3 | Sí — corazón funcional del SLM |
| `slmAdapter` + `orchestrator` selector online/offline | 1 T-1.3 | Sí |
| Cola offline + reconciliation Zettelkasten | 1 T-1.4 | Sí |
| UI gestión modelo SLM (panel + picker) | 1 T-1.5 | Sí |
| Sentry instrumentación completa | 2 | Sí |
| Tracking eventos producto | 2 + CC-1 | Sí |
| Listeners onSnapshot refactor real | 7 | Sí |
| Mobile native Capacitor sync + plugins | 4 | Requiere infra |
| Billing prod Transbank+MP+Play+SII | 5 | Requiere credenciales prod |
| Performance restante (más lazy-load + image opt) | 5 | Sí |
| Accesibilidad WCAG 2.2 AA + i18n hardening | 6 | Sí |
| Brecha C fotogrametría | 9 | Sprint 28+ |

**Bloqueadores conocidos del usuario**:
- Generación 33 PNG médicos: free tier Gemini `limit: 0` para `gemini-2.5-flash-image`. Habilitar billing en https://aistudio.google.com/app/apikey o usar key con billing GCP. Costo total ~$1.30.
- Provisionar secret `KMS_KEY_RESOURCE_NAME` en GitHub Actions antes del próximo prod deploy (output de `terraform output -raw kms_key_resource_name`).



> Este documento define cómo llevamos el repo de "MVP avanzado con disciplina arquitectónica" (post Sprint 19) a "producción real con confianza" (deployable, observable, monetizable, multi-plataforma, accesible). El audit 777 cerró el cleanup post-Sprint 19; este plan cubre los próximos 6 a 8 sprints. Tono: positivo, ambicioso, ejecutable.

---

## Tabla de contenidos

1. [Visión end-to-end](#vision-end-to-end)
2. [Estado actual (post Sprint 19)](#estado-actual-post-sprint-19)
3. [Brechas estratégicas pendientes](#brechas-estrategicas-pendientes)
4. [Mapa de fases](#mapa-de-fases)
5. [Fase 1 — Sprint 20 · SLM offline (Brecha B)](#fase-1)
5b. [Fase 1b — Sprint 20 paralelo · Iconografía médica generada (nano-banana + BioRender ref)](#fase-1b)
6. [Fase 2 — Sprint 21 · Observability + tracking real](#fase-2)
7. [Fase 3 — Sprint 22 · Hardening de deployment + secrets + DR](#fase-3)
8. [Fase 4 — Sprint 23 · Mobile native (Capacitor sync, builds, store readiness)](#fase-4)
9. [Fase 5 — Sprint 24 · Billing real (Transbank prod + MercadoPago IPN + Play RTDN cierre)](#fase-5)
10. [Fase 6 — Sprint 25 · Performance + accesibilidad WCAG 2.2 AA + i18n hardening](#fase-6)
11. [Fase 7 — Sprint 26 · Listeners onSnapshot rearquitectura + Firestore composite indexes + cost budget hard](#fase-7)
12. [Fase 8 — Sprint 27 · Security hardening + Ley 19628 + audit log retention + pen-test readiness](#fase-8)
13. [Fase 9 — Sprint 28 · Brecha C (fotogrametría auto) + iconografía médica enriquecida + Bioicons curation real](#fase-9)
14. [Fase 10 — Sprint 29 · Polish final + GA readiness + post-launch playbook](#fase-10)
15. [Tareas cross-cutting](#tareas-cross-cutting)
16. [Métricas de progreso end-to-end](#metricas-de-progreso)
17. [Apéndice — Mapping con audit anterior](#apendice-mapping)
18. [Apéndice — Riesgos top 5 con mitigación](#apendice-riesgos)
19. [Apéndice — Glosario operativo](#apendice-glosario)

---

<a name="vision-end-to-end"></a>
## 1. Visión end-to-end

"End-to-end correcto" para Guardian Praeventio significa cinco cosas, en orden de prioridad para el negocio:

**Primero, el operario en faena tiene una experiencia confiable y completa**. Abre la app en un celular Android entry-level con Capacitor wrap, en una mina del altiplano sin 4G, y el sistema responde: detección de caída en background, SOS por long-press de 3 segundos, asistente conversacional offline (SLM Sprint 20), formularios IPER que funcionan sin red y se sincronizan al volver, notificaciones push para alertas críticas. Cuando hay red, el cerebro Gemini productivo orquesta sugerencias adaptativas. La iconografía médica Bioicons + boceto Praeventio cubre los 11 módulos identificados con el sistema gracioso de fallback. Los 4 modos UX (normal-light, normal-dark, driving, emergency) preservan jerarquía visual en cualquier contexto, con paleta teal+petroleum+gold y coral solo para alertas reales.

**Segundo, el producto despliega con confianza y se observa con detalle**. Cada commit a `main` que pasa CI dispara un build Docker multi-stage, Cloud Run en `us-central1` con secrets en Secret Manager rotados desde Cloud KMS, healthchecks vivos, autoscaling con min-instances ajustado para evitar cold-start en horario faena (06:00–22:00 hora Chile), métricas custom Sentry + Cloud Monitoring (latencia p50/p95 por ruta, error rate por tenant, quota Gemini consumida). Un dashboard único responde "¿la app está bien ahora?" en menos de 5 segundos. El runbook DR existe, está probado en simulacro al menos una vez por trimestre, y el RPO/RTO está documentado para los datos críticos (audit_logs, projects, organic chains, billing). El equipo mete logs estructurados con contexto (uid, projectId, requestId) que se correlacionan con traces.

**Tercero, el producto se monetiza con flujos reales y compliantes**. Los 8 tiers del modelo B2D (Climate API, Hazmat API, Normativa API, Suite, más planes Praeventio core) funcionan end-to-end con Transbank en producción para CLP, MercadoPago para PE/AR/CO/MX/BR con IPN webhook idempotente verificado, Google Play Billing RTDN con replays soportados. NO Stripe. La Suite Praeventio expone APIs medibles con quota tier-aware, dashboards admin para revenue, MRR/ARR, churn cohort. La factura electrónica chilena vía SII (proveedor de DTE como Bsale o Defontana) emite documentos válidos y queda referenciada en el invoice. Cero acceso del Zettelkasten externamente — siempre interno.

**Cuarto, el producto cumple con accesibilidad, performance y ley de datos**. WCAG 2.2 AA validado con lecturas screen-reader, navegación teclado, contraste verificado en los 4 modos. Lighthouse PWA score ≥ 90, perf score ≥ 0.85 (hoy 0.65), LCP p75 ≤ 2.5s, INP p75 ≤ 200ms, CLS ≤ 0.1. Bundle inicial ≤ 250KB minified+gz; chunks lazy donde aplica (mapas, three.js, slm-runtime). i18n consistente: ES-CL como default, soporte ES-AR/ES-MX/ES-PE/PT-BR/EN como secundarios (estructura ya existe en `src/i18n/locales/`). Compliance Ley 19628 Chile (datos personales): registro de tratamiento, consentimientos, derecho de acceso, eliminación a petición. CSP estricto, CORS allowlist, rate limiters por tier, audit log retention con policy clara.

**Quinto, el producto genera confianza humana**. Tono positivo en todo lo que el usuario lee, gamificación organic positive-only (XP nunca negativo por factores incontrolables), iconografía médica que respeta las disciplinas (no caricatura), idioma chileno donde corresponde. Un operario puede demostrar a su supervisor que cumplió un proceso porque el sistema lo valida con dignidad, no con vigilancia. Un supervisor puede demostrar a la mutual cumplimiento documentado, exportable en PDF, trazable en audit log. Un gerente puede demostrar al directorio que la cuadrilla aprende, mejora, y genera capital de seguridad medible.

Este master plan asume que el código base actual ya tiene disciplina arquitectónica notable (auditoria777 lo confirma). El trabajo restante NO es arreglar incendios, es completar superficie funcional, endurecer infra de producción, y pulir las dimensiones que un MVP avanzado deja para después: deployment hardening, observability profunda, mobile native real, billing en producción, accesibilidad validada.

---

<a name="estado-actual-post-sprint-19"></a>
## 2. Estado actual (post Sprint 19)

### Lo que YA está sólido

- **Arquitectura organic Project→Crew→Process→Task** (Sprint 15-16). Top-level Firestore collections con `projectId` denormalizado (ADR-0001). Server-only writes para crews/processes (Admin SDK) hacen XP unforgeable. `firestore.rules` con tests reales en `src/rules-tests/firestore.rules.test.ts` (Sprint 16 R6). 7 commits en Sprint 15 + 10 en Sprint 16 documentados en commit `747cf21` y `88a879c`.
- **Zettelkasten v2** (Sprint 11-14). 192 nodos catalogados en `docs/ZETTELKASTEN_V2_NODES_FULL.md` (referido por commit `ff81017`). 15 generadores Bernoulli físicos. `nodeIdFor` con SHA-256 16 hex idempotente, tests en `src/services/zettelkasten/persistence/writeNode.test.ts` líneas 82-110 (4 casos: idempotency, projectId-distinct, metadata-distinct, order-insensitive). NUNCA expuesto externamente.
- **Sistema 4 modos UX** (Sprint Bernoulli sweep). Tokens semánticos en `src/index.css`. `AppModeContext` con persistencia + emergency auto-expiry. `ModeSwitcher` montado en `RootLayout`. Paleta teal+petroleum+gold completa scales 50-900 documentada en `docs/BRAND.md` (referido por commits 7c87869, 8a0a0df, 9a76556). `lime-500` preservado intencionalmente para `NodeType.ATTENDANCE` (memoria `feedback_no_blind_sweeps`).
- **Iconografía médica Bioicons** (Sprint 17c, ADR-0003). 33 SVG placeholders en `public/icons/biology/`. `MedicalIcon` componente con fallback graceful en `src/components/medical/`. 11 módulos identificados (memoria `product_medical_iconography_2026-05-04`). `findMedicalIcon` ya O(1) Map lookup (commit a6bf214). Script `scripts/generate-medical-icons.mjs` (Gemini 2.5 Flash Image alias Nano Banana) con 33 prompts brand-aligned.
- **Cost optimization Sprint 19**. `geminiGlobalDailyLimiter` (commit b8a7c75) cap 1000 req/día agregado. `comiteBackend` y `susesoBackend` downgraded a Flash (commits 94ebbcd, ecccdc4). Map loader unificado en 9 componentes (commit bbc87f7). Tokens semánticos reemplazaron hex en 5 componentes médicos (commits 3154d88, 9cc7435).
- **E2E Playwright fixtures Sprint 19** (Brecha D). `tests/e2e/fixtures/` con `auth.ts`, `server.ts`, `seed.ts`. `verifyAuth` con guard `E2E_MODE=1` doble-checked contra `NODE_ENV !== 'production'` (commit 970dc32). Mock Gemini en E2E (commit bbe4d2). 4 specs un-skipped (commit 84f474e). `webServer` compose en `playwright.config.ts` (commit f87ff20).
- **Capacitor 8 deps instaladas**. Geolocation, motion, push-notifications, biometric-auth, bluetooth-le, healthkit (iOS), health-connect (Android), sqlite con encryption, keep-awake. FallDetection preference hook ya implementado (Sprint 17b, Brecha A parcial).
- **Audit posture**. 38 hallazgos auditoria777 cubren cleanup post-Sprint 19. Pendientes diferidos documentados en `PENDING_AFTER_SPRINT_19.md`. Sprint 20 spec lista para arrancar (`docs/sprints/SPRINT_20_SPEC.md`, 1064 líneas).
- **CI baseline**. `.github/workflows/ci.yml` con typecheck, tests, rules-tests, build. `deploy.yml` con Cloud Run us-central1 + Secret Manager + Workload Identity + post-deploy smoke `/api/health` y `/`. `e2e.yml`, `perf.yml`, `smoke.yml` complementan.
- **API surface**. 43 rutas catalogadas en `docs/api-routes.md`. Billing Webpay (CLP), MercadoPago (PE/AR/CO/MX/BR), Google Play. Curriculum claims con magic-link + WebAuthn. Telemetry IoT con HMAC canonical-JSON (R18 R2). Reports PDF.

### Lo que está a MEDIAS

- **Mobile native**. Capacitor 8 deps instaladas, `capacitor.config.ts` configurado, pero NO existen carpetas `android/` ni `ios/` (verificado: `ls android ios` falla). `cap sync` nunca corrió en main. Build pipelines Android/iOS no existen en `.github/workflows/`. App Store / Play Store submission docs no existen. Health Connect migration parcial (deps presentes, lógica en `src/services/health/` pero sin runbook publicado en repo).
- **Observability**. `src/lib/sentry.ts` y `src/services/observability/` existen con adapters (sentryAdapter, cloudErrorReporting, metricsAdapter, noopErrorTrackingAdapter). `main.tsx:19` llama `initSentry()`. PERO el DSN real está como placeholder en `.env.example`. No hay dashboards Cloud Monitoring publicados en repo. No hay alerting policies definidas. Tracing distribuido OpenTelemetry no presente. Métricas custom de billing webhook latency existen (`praeventio/webpay/return_latency_ms`) pero no están agregadas en un dashboard único.
- **Tracking de producto**. La memoria menciona `product-tracking-skills` como suite con 6 sub-skills. Hoy NO hay un audit del tracking actual (`product-tracking-audit-current-tracking` no se ha invocado). No hay `.telemetry/` directory. No hay `product-tracking-design-tracking-plan` ejecutado. Hooks de Sentry capturan errores pero NO hay eventos de producto (activation, retention, conversion).
- **Billing**. Webpay return URL existe (`/billing/webpay/return`) con idempotency lock. MercadoPago checkout existe pero IPN webhook dedicado falta (TODO documentado en `api-routes.md` línea 442). Google Play RTDN webhook existe con `withIdempotency`. Lo que falta: dashboards admin de revenue, MRR/ARR, churn cohort, métricas conversion por país, factura electrónica SII para CLP (proveedor DTE no integrado), reconciliación contable manual a automática.
- **Internacionalización**. Estructura `src/i18n/locales/` con 6 idiomas (en, es, es-AR, es-MX, es-PE, pt-BR). Pero no hay verificación de coverage por idioma — algunos pueden estar al 30% mientras es-CL está al 95%. No hay flujo de QA de strings nuevas, no hay budget de traducción, no hay locale routing en URL.
- **Accesibilidad**. Tokens semánticos cubren contraste base, pero WCAG 2.2 AA NO está validado formalmente. No hay tests axe-core en CI. Screen reader testing manual no documentado. Modo emergency tiene contraste alto por diseño pero sin métrica formal.
- **Performance**. Lighthouse perf threshold = 0.65 (commit 14ff0ed). Target del master proposal era 0.90+. Bundle size budget existe (`size-limit`) pero los chunks nuevos (slm-runtime futuro, three.js Site25DPanel) no tienen budget enforcement. LCP/INP/CLS p75 metrics no tracked en producción.
- **Security**. Helmet montado, CSP definido (con relax para MediaPipe WASM blob: en commit 1879a1c), CORS configurado. Rate limiters por endpoint. Audit log existente. PERO: pen-test readiness sin runbook, secrets rotation sin schedule documentado, KMS rotation sin runbook publicado, Ley 19628 compliance documentation faltante, retention policy de audit_logs no definida formalmente.
- **Listeners Firestore**. 4 onSnapshot sin filtros con TODO comments (DocsModal, EmergencyCheckIn, EmergenciaAvanzada, ControlsAndMaterials). Documentados en `PENDING_AFTER_SPRINT_19.md`. No están bloqueando MVP pero son riesgo en escalamiento.
- **Iconos médicos generados**. 33 SVG placeholders existen pero los PNG generados con Nano Banana NO están commiteados (script existe pero ejecución pendiente). 11 módulos médicos referencian MedicalIcon pero el wireup completo a los assets reales falta.
- **Documentación deployment**. `Dockerfile` existe (multi-stage Node 20 alpine). `deploy.yml` despliega. PERO: runbook de DR no en repo, runbook de KMS rotation no en repo, runbook de marketplace submission no en repo, runbook de incident response solo cubre security (en `docs/security/incident-response.md`).

### Lo que NO existe todavía

- **Brecha B (SLM offline)**: spec lista (Sprint 20), implementación completa pendiente.
- **Brecha C (fotogrametría auto)**: mini-RFC en spec Sprint 20, implementación diferida a Sprint 28 según este master plan.
- **Cloud Build CI** alternativa al deploy.yml actual (en este momento basta con GitHub Actions, pero para mayor seguridad de pipeline GCP-native es opción).
- **Cloud KMS rotation runbook** (deploy.yml usa `KMS_ADAPTER=in-memory-dev` en producción — comentario inquietante).
- **DR runbook** validado con simulacro real.
- **Health Connect Android migration runbook** end-to-end.
- **iOS build** (TestFlight, certificados, App Store Connect).
- **Android build** (Play Internal Testing, Play Console upload).
- **App store submission** (screenshots, copy, listings ES/PT, privacy nutrition labels).
- **OpenTelemetry tracing** distribuido cross-service.
- **Cloud Monitoring custom dashboards** en repo (definiciones IaC).
- **Factura electrónica SII** integración real (CLP es webpay, pero el DTE para el cliente final falta).
- **Compliance Ley 19628** documentación + flow de derecho de acceso/eliminación.
- **Pen-test report** por tercero.
- **Tracking plan formal** con eventos definidos, instrumentación, SDK.
- **A11y CI gate** (axe-core en Playwright o Storybook).
- **Performance budgets hard** por chunk con CI fail.
- **Service worker** con runtime caching estrategia documentada (workbox-build instalado pero stub local en `vite-pwa-stub.ts` por dependencias incompletas — memoria `reference_build_quirks`).
- **Storybook** (no hay; cada componente se valida en página real).
- **i18n coverage report** automatizado.
- **Cost dashboard** para Gemini, Maps, OpenWeather, Resend, Pinecone.
- **MARKETPLACE_SUBMISSION runbook** (Google Cloud Marketplace y Apple/Google App Stores).

---

<a name="brechas-estrategicas-pendientes"></a>
## 3. Brechas estratégicas pendientes (memoria del usuario `product_strategic_gaps_2026-05-04`)

| Brecha | Estado | Sprint asignado | Notas |
|---|---|---|---|
| **A — Capacitor plugins nativos opt-in** | Parcial. FallDetection ya hecho (Sprint 17b). Restantes: BluetoothLE wearables, HealthConnect avanzado, PushNotifications avanzadas, Bluetooth proximity en SOS. | Fase 4 (Sprint 23) | Deps ya instaladas; falta integrar lógica + opt-in UI + persistencia preferencia. |
| **B — SLM offline** | Spec Sprint 20 lista (1064 líneas). | Fase 1 (Sprint 20) | Phi-3 Mini int4 + ONNX Runtime Web + WebGPU + IndexedDB + reconciliación Zettelkasten. |
| **C — Pipeline fotogrametría auto** | Mini-RFC en spec Sprint 20. | Fase 9 (Sprint 28) | NodeODM AGPL backend-only OK + three.js mesh viewer. |
| **D — E2E Playwright** | Cerrada Sprint 18+19. | — | Specs un-skipped, fixtures completos, CI workflow `e2e.yml`. |

---

<a name="mapa-de-fases"></a>
## 4. Mapa de fases

```
Sprint 20 ─→ Fase 1:  SLM offline (Brecha B)                    [18h core + 6h opc]
Sprint 20 ─→ Fase 1b: Iconografía médica nano-banana+BioRender  [4h paralelo a Fase 1]
Sprint 21 ─→ Fase 2:  Observability + tracking real             [22h]
Sprint 22 ─→ Fase 3:  Deploy hardening + secrets + DR           [24h]
Sprint 23 ─→ Fase 4:  Mobile native (Capacitor sync, builds)    [26h]
Sprint 24 ─→ Fase 5:  Billing prod (Transbank+MP IPN+Play+SII)  [28h]
Sprint 25 ─→ Fase 6:  Performance + a11y WCAG 2.2 + i18n        [22h]
Sprint 26 ─→ Fase 7:  onSnapshot rearq. + indexes + cost budget [16h]
Sprint 27 ─→ Fase 8:  Security hardening + Ley 19628 + pen-test [20h]
Sprint 28 ─→ Fase 9:  Brecha C (fotogrametría) + curation extra [20h - 4h movidos a 1b]
Sprint 29 ─→ Fase 10: Polish final + GA + post-launch playbook  [16h]
                                                  TOTAL ≈ 216h
```

Cada fase es 1 sprint. Una fase puede tener sub-épicos paralelos. El orden está optimizado para reducir riesgo: lo que más dolor producirá si falla en producción va primero (deployment, observability, mobile, billing, security). La feature work puramente nueva (Brecha C, fotogrametría) va al final cuando la base es sólida.

---

<a name="fase-1"></a>
## 5. Fase 1 — Sprint 20 · SLM offline (Brecha B)

**Objetivo**: el operario en faena sin red recibe respuestas adaptativas vía un Small Language Model corriendo on-device dentro de la PWA + Capacitor wrapper. Cuando vuelve la red, la cola de sesiones offline se reconcilia al Zettelkasten via `nodeIdFor` idempotente.

**Por qué primero**: cierra la brecha de safety más crítica (operario aislado), la spec ya está validada (`docs/sprints/SPRINT_20_SPEC.md`), no toca infra GCP nueva, OPEX recurrente cero, libs MIT/Apache, NO Anthropic SDK. Es feature work autocontenido en `src/services/slm/` namespace nuevo — riesgo bajo de regresión.

**Estimación**: 18h core (6 fases) + 6h opcionales = 24h.

**Archivos a tocar/crear** (resumen — el detalle exhaustivo vive en `docs/sprints/SPRINT_20_SPEC.md` líneas 165-700):

- `src/services/slm/types.ts` (CREATE) — tipos canónicos.
- `src/services/slm/registry.ts` (CREATE) — 3 modelos: Phi-3 Mini int4 (default), Qwen 2.5 0.5B int4 (fallback small), Gemma 2 2B IT int4 (premium opcional).
- `src/services/slm/cache/modelCache.ts` (CREATE) — wrapper sobre `idb` para cache IndexedDB del blob del modelo + checksum verification.
- `src/services/slm/worker/slmWorker.ts` (CREATE) — Web Worker con onnxruntime-web/webgpu y comlink.
- `src/services/slm/loader.ts` (CREATE) — orquestación fetch streaming + verify + cache.
- `src/services/slm/slmAdapter.ts` (CREATE) — facade `chat()` / `complete()` con misma firma que `geminiAdapter`.
- `src/services/ai/orchestrator.ts` (CREATE) — selector adapter según `navigator.onLine` + fallback heurístico.
- `src/services/slm/offlineQueue.ts` + `reconciliation.ts` (CREATE) — cola IndexedDB + flush al volver red.
- `src/components/ai/OfflineSLMBanner.tsx` (CREATE) — banner offline con tokens semánticos.
- `src/components/ai/SLMStatusPanel.tsx` + `SLMModelPicker.tsx` (CREATE) — UI gestión.
- `src/pages/dev/SLMDebug.tsx` (CREATE) — pantalla QA gated `NODE_ENV !== 'production'`.
- `vite.config.ts` (MODIFY) — `optimizeDeps.exclude`, `worker.format = 'es'`, `manualChunks.slm-runtime`.
- `package.json` (MODIFY) — agregar `onnxruntime-web@^1.20.0`, `@huggingface/transformers@^3.0.0`, `comlink@^4.4.1`.
- `src/components/ai/GuardianVoiceAssistant.tsx` (MODIFY) — usar `orchestrator` en lugar de `geminiAdapter` directo.

**Tareas concretas (descomposición — 6 fases internas)**:

- [ ] T-1.1 — Fase 1 (2h): scaffolding deps + types + registry + tests TDD. Skill: `superpowers:test-driven-development`. MCP: `plugin_context7_context7` para `onnxruntime-web` y patrón Vite WASM copy.
- [ ] T-1.2 — Fase 2 (4h): Web Worker + IndexedDB cache + checksum verify + fetch streaming chunked. Skill: TDD + `systematic-debugging`. MCP: context7 para ReadableStream/Capacitor browser. 8 tests unitarios target.
- [ ] T-1.3 — Fase 3 (3h): `slmAdapter` + `orchestrator` con fallback heurístico determinístico. Skill: TDD + `simplify` para no agregar superficie API innecesaria. 5+ tests target.
- [ ] T-1.4 — Fase 4 (3h): `offlineQueue` + `reconciliation` + `OfflineSLMBanner`. Skill: TDD. Integration test contra Firestore real (sin mocks) para validar no-duplicate via `nodeIdFor`. 8 tests target.
- [ ] T-1.5 — Fase 5 (3h): `SLMStatusPanel` + `SLMModelPicker` + página `/dev/slm-debug`. Skill: `frontend-design` (cuidando 4 modos UX y tokens semánticos). 6 tests target.
- [ ] T-1.6 — Fase 6 (3h): PWA precache estratégico + bundle budget `slm-runtime ≤ 1MB minified+gz` + smoke tests CI. Skill: `verification-before-completion`.
- [ ] T-1.7 — (opcional, 2h) Fase 7: embeddings on-device para búsqueda offline en Zettelkasten con `Xenova/all-MiniLM-L6-v2`.
- [ ] T-1.8 — (opcional, 2h) Fase 8: localización ES-CL del modelo (system prompt en chileno minero, glosario faena/cuadrilla/EPP).
- [ ] T-1.9 — (opcional, 2h) Fase 9: Capacitor Health Connect → SLM context bridge para fatiga del operario.

**Criterio de éxito**:

- Latencia P50 SLM (WebGPU, prompt 50 tokens, response 256 tokens) < 500ms.
- Latencia P95 SLM (WebGPU) < 1500ms.
- Latencia P95 SLM (WASM SIMD fallback) < 8000ms.
- Tamaño chunk `slm-runtime` minified+gz < 1MB.
- Shell sin SLM mantiene presupuesto < 250KB minified+gz.
- Lighthouse PWA score ≥ 90 (sin regresión).
- ≥ 30 tests unitarios nuevos pasando.
- ≥ 4 tests E2E Playwright nuevos (offline flow happy path + 3 edge cases).
- Cobertura archivos nuevos `src/services/slm/` ≥ 85%.
- Bundle initial load NO descarga onnxruntime-web (smoke test pasa en CI).
- Reconciliation: 0 duplicate Firestore docs con E2E real (10 sessions queued, vuelta de red, count exacto post-flush).

**Dependencies**: ninguna (Sprint 19 ya cerrado, fixtures E2E listos).

**Riesgos**: 

1. Quota IndexedDB en mobile Capacitor (mitigación: `navigator.storage.estimate()` + persisted storage).
2. WebGPU no en algunas WebView Capacitor 8 (mitigación: detect runtime + fallback WASM SIMD).
3. Hallucinations en safety contexts (mitigación: SLM nunca toca decisiones binarias safety, system prompt con disclaimer "verificar con supervisor", test corpus 50 prompts safety).

---

<a name="fase-1b"></a>
## 5b. Fase 1b — Sprint 20 paralelo · Iconografía médica generada (nano-banana + BioRender ref)

**Objetivo**: cerrar el ciclo del Sprint 17c reemplazando los 33 placeholders SVG en `public/icons/biology/` por bocetos médicos originales generados con Gemini 2.5 Flash Image (alias Nano Banana), enriqueciendo cada prompt con la nomenclatura canónica que entrega BioRender via MCP — **sin copiar assets de BioRender, license-safe**.

**Por qué paralelo a Fase 1**: el usuario solicitó explícitamente que la generación de imágenes "esté hecha" desde el inicio del nuevo ciclo. El SLM offline (Fase 1a) y la iconografía médica (Fase 1b) tocan namespaces disjuntos (`src/services/slm/` vs `scripts/` + `public/icons/biology/`), así que se ejecutan en paralelo sin coordinación de archivos. Ambos cierran en el mismo Sprint 20.

**Estimación**: 4h (movido de Fase 9, donde quedaba como tail T-9.7..T-9.9).

**Archivos a tocar/crear** (decisión arquitectónica del usuario 2026-05-04 — los iconos se BUNDLEAN al repo para offline-first; reemplaza una versión previa que proponía hosting en GCS, descartada — ver ADR-0004):

- `scripts/generate-medical-icons.mjs` (MODIFY) — flag `--enrich-with-bioicons` que lee `scripts/biorender-references.json` (cache 33 descripciones canónicas) y concatena al prompt como "anatomical reference (conceptual only — generate ORIGINAL artwork)". El asset de BioRender NUNCA se descarga.
- `scripts/biorender-references.json` (CREATE) — cache del mapping concepto → descripciones canónicas BioRender, license-safe (solo metadata pública).
- `public/icons/biology/*.png` (33 archivos GENERADOS y COMMITEADOS al repo) — bundleados con la app. Bundle crece ~1.65MB, aceptable por la decisión force "subir a lo necesario para SLM/iconos, no hay problema".
- `src/services/medical/iconLibrary.ts` **SIN CAMBIOS** — los paths siguen siendo `.svg`. El componente `MedicalIcon` computa el PNG candidate del path SVG transparentemente.
- `src/components/medical/MedicalIcon.tsx` (MODIFY) — fallback chain `PNG → SVG → placeholder graceful`. Helper exportado `pngPathFor(entry)` para tests. State machine `'png' | 'svg' | 'placeholder'`.
- `src/services/medical/iconLibrary.test.ts` (MODIFY) — 2 nuevos casos (cada entry resuelve bajo `/icons/biology/`, cada SVG path tiene basename computable a PNG candidate).
- `docs/architecture-decisions/0004-medical-icons-bundled-for-offline.md` (CREATE) — ADR documentando offline-first + license-safe (BioRender descripciones públicas como referencia conceptual, nano-banana genera originales).

**Tareas concretas** (estado actualizado 2026-05-04):

- [x] T-1b.1 — Script con `--enrich-with-bioicons` (sin `--upload`, descartado por offline-first). ✅
- [x] T-1b.2 — `scripts/biorender-references.json` con 33 descripciones canónicas. ✅
- [x] T-1b.3 — `MedicalIcon.tsx` con fallback chain PNG→SVG→placeholder + helper `pngPathFor`. ✅
- [x] T-1b.4 — `iconLibrary.test.ts` extendido con 2 nuevos casos (paths bajo `/icons/biology/`, PNG candidate computable). ✅ 9 tests verdes.
- [x] T-1b.5 — ADR-0004 commit con razonamiento offline-first + license-safe. ✅
- [ ] T-1b.6 — **Acción del usuario**: ejecutar `export GEMINI_API_KEY=... && node scripts/generate-medical-icons.mjs --enrich-with-bioicons`. Genera los 33 PNG en `public/icons/biology/`. Costo ~$1.30. Tiempo ~5-10 min wall-clock.
- [ ] T-1b.7 — **Acción del usuario**: `git add public/icons/biology/*.png && git commit -m "feat(medical): generated 33 PNG bocetos with nano-banana"`. Bundle crece ~1.65MB.
- [ ] T-1b.8 — Smoke test visual post-deploy con Playwright MCP: navegar a 3 módulos médicos (HumanBodyViewer, AnatomyLibrary, MedicalAnalyzer), tomar screenshots y validar que `data-medical-icon-stage="png"` (los PNG cargan, no caen al SVG fallback). MCP: `mcp__plugin_playwright_playwright__browser_take_screenshot`.

**Criterio de éxito**:

- 33 PNG bundleados al repo, sin watermarks, sin texto, sin logos copyrighted, paleta brand verificable.
- `scripts/biorender-references.json` commiteado (cache de descripciones, no assets).
- `npm run build` no rompe el bundle budget (PNG son assets estáticos, no contribuyen al budget JS).
- 11 módulos médicos renderizan los nuevos bocetos sin regresión visual (Playwright snapshots OK).
- ADR-0004 commiteado con razonamiento offline-first + license-aware.
- `iconLibrary.test.ts` y `MedicalIcon.test.tsx` verdes con cobertura PNG.
- Operario en faena sin red ve los iconos (PNG bundleados; sin red el browser no hace requests externos).

**Dependencies**: requiere `GEMINI_API_KEY` válida en env del usuario. NO requiere `gcloud auth` ni acceso a buckets GCS (decisión revertida por offline-first).

**Riesgos**: 

1. Gemini Image puede generar imágenes con artefactos (mitigación: flag `--force --name X` para regenerar individuales).
2. Rate limit Free Tier (mitigación: ejecución spaced 2s + manejo de 429 con backoff).
3. BioRender API search no devuelve hits para algún concepto exotic (mitigación: el script igual genera con prompt estándar; el enrichment es opcional por icono).
4. El primer load de la app descarga +1.65MB extra (33 PNG). Mitigación: los iconos son `<img loading="lazy">` — no contribuyen al LCP. Se descargan cuando el usuario navega a un módulo médico, no en el shell inicial.

**TDD entry point**: `iconLibrary.test.ts` con caso "every SVG path has a known basename so the PNG candidate is computable" (✅ en este PR).

**Nota**: en Fase 9 (Sprint 28) original quedaban T-9.7..T-9.9 con esta misma generación. Esos items están MOVIDOS a esta Fase 1b — Fase 9 ahora cubre solo fotogrametría + curation real opcional de Bioicons CC-BY restantes si los hay.

**TDD entry point**: `src/services/slm/registry.test.ts` con `it('exposes 3 model entries with valid HuggingFace Hub URLs')` falla porque `registry.ts` no existe → crear tipos + registry → pasa.

---

<a name="fase-2"></a>
## 6. Fase 2 — Sprint 21 · Observability + tracking real

**Objetivo**: cualquier persona del equipo puede responder en menos de 5 segundos "¿la app está bien ahora?" con un solo dashboard Cloud Monitoring + Sentry. Cualquier feature shippable tiene eventos de tracking definidos, instrumentados, validados. Las decisiones de roadmap se basan en datos de activation, retention, conversion, no intuición.

**Por qué segundo (después de SLM)**: una vez que la app tiene la feature crítica (offline) shippable, hay que poder verla operar en producción con detalle. Sin observability, el SLM offline en faena pasa desapercibido si falla. Y sin tracking, no sabemos si los usuarios efectivamente activan el modo offline o ignoran la feature. Ambos problemas son ortogonales pero se resuelven en el mismo sprint porque comparten infraestructura (eventos estructurados, dashboards, alerting).

**Estimación**: 22h.

**Archivos a tocar/crear**:

- `.telemetry/product.md` (CREATE) — modelo de producto via `product-tracking-skills:product-tracking-model-product`.
- `.telemetry/current-state.yaml` (CREATE) — audit del tracking actual via `product-tracking-skills:product-tracking-audit-current-tracking`.
- `.telemetry/tracking-plan.yaml` (CREATE) — plan target via `product-tracking-skills:product-tracking-design-tracking-plan`.
- `.telemetry/delta.md` (CREATE) — gap analysis.
- `.telemetry/instrument.md` (CREATE) — guía instrumentación SDK-specific (probablemente PostHog self-hosted o Cloud Logging structured + BigQuery export).
- `tracking/events.ts` (CREATE) — typed wrapper alrededor del SDK elegido.
- `tracking/identity.ts` (CREATE) — identify + group calls.
- `tracking/index.ts` (CREATE) — barrel export.
- `src/services/observability/index.ts` (MODIFY) — re-exportar tracking façade unificado.
- `src/lib/sentry.ts` (MODIFY) — agregar `tracesSampleRate`, `replaysOnErrorSampleRate` (5%), `beforeSend` para sanitizar PII (uid OK, email NO).
- `server.ts` (MODIFY) — agregar `Sentry.NodeProfiling.profilingIntegration()`, `Sentry.requestHandler()`, `Sentry.errorHandler()`.
- `src/server/middleware/tracing.ts` (CREATE) — middleware que estampa `requestId` + `traceId` en logs estructurados, expone en `X-Request-Id` header response.
- `docs/observability/dashboards.md` (CREATE) — definiciones de dashboard Cloud Monitoring (JSON/IaC) committed para reproducibilidad.
- `docs/observability/alerting-policies.md` (CREATE) — alerts: 5xx burst > 1% en 5min, latency p95 > 2s, quota Gemini > 80% diario, error rate por tenant > 5%.
- `docs/observability/runbook.md` (CREATE) — qué hacer cuando una alerta dispara.
- `docs/SKILL_ROUTING_2026-05-04.md` ya en parent dir → usar como referencia.

**Tareas concretas**:

- [ ] T-2.1 — (1h) Invocar `product-tracking-skills:product-tracking-model-product` para producir `.telemetry/product.md`. Conversación corta con el usuario para confirmar entidades core: User, Worker, Supervisor, Project, Crew, Process, Task, Incident, IPER, Finding, Subscription.
- [ ] T-2.2 — (2h) Invocar `product-tracking-skills:product-tracking-audit-current-tracking`. Output: `.telemetry/current-state.yaml`. Resultado esperado: muy poco tracked actualmente (Sentry errors sí, eventos producto NO).
- [ ] T-2.3 — (3h) Invocar `product-tracking-skills:product-tracking-design-tracking-plan`. Output: `.telemetry/tracking-plan.yaml` con eventos clave: `user_signed_up`, `project_created`, `crew_assigned`, `process_started`, `process_closed`, `iper_filled`, `finding_reported`, `sos_triggered`, `slm_offline_activated`, `slm_response_generated`, `subscription_started`, `subscription_renewed`, `subscription_churned`, `gemini_quota_exhausted`. Properties tipadas. Identity: `userId`, group: `projectId`, super-properties: `tenantId`, `tier`.
- [ ] T-2.4 — (2h) Invocar `product-tracking-skills:product-tracking-generate-implementation-guide` con SDK target: **Cloud Logging structured + BigQuery export** (privacidad-first, no terceros). Alternativa: PostHog self-hosted en Cloud Run separado (defer).
- [ ] T-2.5 — (3h) Invocar `product-tracking-skills:product-tracking-implement-tracking`. Output: `tracking/` directory con typed wrappers + identity + un client SDK que llama `/api/track` (server-side relay para no exponer keys).
- [ ] T-2.6 — (1h) Crear endpoint `/api/track` server-side: `POST` con `{event, properties, identity, group}`, valida shape vs tracking-plan, escribe a Cloud Logging con label `praeventio.event=<event>` para query en BigQuery. Skill: TDD.
- [ ] T-2.7 — (2h) Cablear los 14 eventos clave en código existente. Cada call wrapped en try/catch para no afectar UX. Tests unitarios verifican el call, no el efecto. Skill: TDD.
- [ ] T-2.8 — (2h) Sentry hardening: `tracesSampleRate=0.1` (10% sampling), `replaysOnErrorSampleRate=0.05`, `beforeSend` sanitiza email/RUT/phone. Server-side Sentry node con `requestHandler` + `errorHandler` + profiling integration. Skill: TDD.
- [ ] T-2.9 — (3h) Cloud Monitoring custom dashboard JSON committed: panel "Health" con uptime, error rate, p95 latency por ruta crítica (`/api/ask-guardian`, `/api/gemini`, `/api/billing/*`, `/api/telemetry/ingest`). Panel "Cost" con Gemini req/día (vs limiter cap 1000), Maps loads/día, OpenWeather requests/día. Panel "Business" con MRR, active crews, SOS triggered últimas 24h.
- [ ] T-2.10 — (2h) Alerting policies committed: 5xx burst, latency degradation, quota exhaustion, error spike por tenant, billing webhook failure rate. Notification channel: email + Slack (cuando haya).
- [ ] T-2.11 — (1h) Runbook observability: cuando dispara cada alerta, qué hacer, cómo confirmar, cómo escalar. Vinculado a `docs/security/incident-response.md`.

**Criterio de éxito**:

- 14 eventos clave instrumentados con types + tests.
- Cloud Monitoring dashboard accesible vía URL en `docs/observability/dashboards.md`.
- 5 alerting policies committed y activas.
- Sentry sample rate = 10% para traces, 5% para replays-on-error.
- `beforeSend` sanitiza PII (test unit verifica que email/phone/RUT NO llegan a Sentry).
- Server-side requestId estampado en logs y header `X-Request-Id`.
- Runbook observability con 5 escenarios de alerta documentados.
- Smoke test E2E: navegar a `/asistente`, generar evento, verificar BigQuery export.

**Dependencies**: Fase 1 completa (eventos `slm_offline_activated`, `slm_response_generated` requieren SLM existente).

**Riesgos**: 

1. Cloud Logging + BigQuery export tiene ventana de delay 60s (no real-time). Mitigación: para alerting crítico usar Cloud Monitoring directo (síncrono). BigQuery solo para análisis posterior.
2. PII leak inadvertido en properties. Mitigación: `beforeSend` con whitelist de keys permitidas, lint custom que escanea `track()` calls.
3. Quota Cloud Logging puede crecer rápido. Mitigación: budget alert + retention 30 días + sampling al 100% (no perder eventos pequeños) pero compresión.

**TDD entry point**: `tracking/events.test.ts` con `it('track() llama el endpoint con shape válido')` falla porque módulo no existe → crear → pasa.

---

<a name="fase-3"></a>
## 7. Fase 3 — Sprint 22 · Hardening de deployment + secrets + DR

**Objetivo**: deploy a producción es repetible, observable, reversible y resiliente. Secrets están rotados desde KMS con schedule. Si Cloud Run cae, el RTO/RPO está documentado y testeado vía simulacro DR.

**Por qué tercero**: con SLM (Fase 1) y observability (Fase 2) en producción, el siguiente eslabón débil es la infra. El deploy.yml actual es básico (512Mi/1cpu/min0/max10, `KMS_ADAPTER=in-memory-dev` en producción — comentario inquietante). Endurecer este pipeline ANTES de cargar mobile native + billing en Sprint 23-24 es pre-requisito.

**Estimación**: 24h.

**Archivos a tocar/crear**:

- `.github/workflows/deploy.yml` (MODIFY) — endurecer: min-instances=1 horario faena, max-instances=20, memoria 1Gi, cpu 2, region failover us-east1, full E2E gate antes de deploy, post-deploy E2E smoke con SLM offline, rollback automático si smoke falla.
- `.github/workflows/deploy-canary.yml` (CREATE) — pipeline canary con traffic split 5%→25%→100% gradual.
- `cloudbuild.yaml` (CREATE) — alternativa GCP-native al deploy.yml (defensa en profundidad).
- `Dockerfile` (MODIFY) — multi-stage final con `node:20-alpine` + `tini` PID 1 + non-root user + read-only filesystem + minimal attack surface (eliminar `npm`, `npx` del runner stage).
- `docs/DEPLOYMENT_RUNBOOK.md` (CREATE) — pasos manuales para deploy emergency, rollback, incidente operativo.
- `docs/DR_RUNBOOK.md` (CREATE) — disaster recovery: qué pasa si us-central1 cae, cómo failover a us-east1, RPO/RTO objetivos por colección crítica (audit_logs RPO=5min, projects RPO=1h, organic chains RPO=15min).
- `docs/KMS_ROTATION_RUNBOOK.md` (CREATE) — schedule mensual de rotación de keys, fallback en caso de KMS unavailable, audit log de rotation events.
- `docs/SECRET_MANAGEMENT.md` (CREATE) — política completa de secrets: dónde viven (Secret Manager + Cloud KMS envelope), quién accede, schedule rotation, audit.
- `scripts/rotate-secrets.sh` (CREATE) — helper que rota un secret en Secret Manager + actualiza Cloud Run revision + smoke test post-rotation.
- `scripts/dr-failover.sh` (CREATE) — helper que dispara failover a us-east1.
- `scripts/dr-simulate.sh` (CREATE) — simulacro DR controlado (deploy a us-east1 con tráfico mock).
- `src/server/middleware/healthCheck.ts` (CREATE) — `/api/health/deep` que valida Firestore, KMS, Gemini, Resend, OpenWeather, todas en paralelo con timeout 2s. `/api/health` queda como liveness probe simple.
- `firestore.indexes.json` (MODIFY) — completar composite indexes que faltan (auditar todos los listeners actuales).
- `firestore.rules` (MODIFY si necesario) — endurecer reglas que dependen de `request.auth.token.role` para admin paths.

**Tareas concretas**:

- [ ] T-3.1 — (2h) Auditoría infra GCP actual: invocar `mcp__d3b06c6a-..._sentry__find_organizations` + `find_projects` para confirmar Sentry. `gcloud` manual para listar Cloud Run services, IAM bindings, Secret Manager secrets, KMS keys. Output: `docs/INFRA_INVENTORY.md` con tabla completa. Skill: `code-review`.
- [ ] T-3.2 — (2h) Endurecer `Dockerfile`: agregar `tini`, non-root user `praeventio:praeventio`, `--read-only` filesystem (con tmpfs para `/tmp`), eliminar `npm`/`npx` del runner stage (usar `node` directo con bundle). Verificar que `tsx` funciona compilado o cambiar a `node --loader` con dist. Skill: TDD (build verification).
- [ ] T-3.3 — (3h) Endurecer `deploy.yml`: min-instances=1 (eliminar cold-start en horario faena 06:00-22:00 Chile via Cloud Scheduler), max-instances=20, memoria 1Gi, cpu 2, traffic split 5%→25%→100% via `gcloud run services update-traffic`. Agregar gate: `npm run test:e2e:full` debe pasar antes de deploy a prod. Skill: TDD via dry-run.
- [ ] T-3.4 — (1h) Crear `cloudbuild.yaml` paralelo (opcional uso, default deploy sigue siendo GH Actions). Documentar tradeoffs en `DEPLOYMENT_RUNBOOK.md`.
- [ ] T-3.5 — (2h) `/api/health/deep` middleware: paralelo Firestore (read 1 doc), KMS (encrypt+decrypt 1 byte), Gemini ping (HEAD a endpoint), Resend ping, OpenWeather ping. Timeout individual 2s. Response shape: `{status: ok|degraded|down, checks: {firestore, kms, gemini, resend, openweather}, version, region, instance}`. Skill: TDD.
- [ ] T-3.6 — (3h) DR runbook completo: scenario us-central1 down. Pasos: 1) detectar via Sentry alerting; 2) confirmar via `gcloud run services describe`; 3) failover us-east1 vía `scripts/dr-failover.sh`; 4) update DNS si tenemos custom domain; 5) verificar via smoke test; 6) post-mortem template. RPO/RTO por colección documentado. Skill: `superpowers:writing-plans`.
- [ ] T-3.7 — (3h) Simulacro DR controlado: `scripts/dr-simulate.sh` deploy a us-east1 paralelo, mock traffic 1%, comparar latencia + correctness, teardown. Documentar resultados en `docs/dr-drill-2026-Q2.md`. Skill: TDD.
- [ ] T-3.8 — (2h) KMS rotation runbook: schedule mensual via Cloud Scheduler → trigger Cloud Function → rotate key + revision Cloud Run + audit log. `KMS_ADAPTER=in-memory-dev` en producción es bug — reemplazar por adapter real Cloud KMS. Skill: `code-review` + TDD.
- [ ] T-3.9 — (2h) Política completa secrets: Secret Manager para todos (no en `.env` excepto local dev), envelope encryption con Cloud KMS, audit logs. Auditar `deploy.yml` actual: `GEMINI_API_KEY`, `SESSION_SECRET`, `RESEND_API_KEY`, `IOT_WEBHOOK_SECRET`, `VITE_GOOGLE_MAPS_API_KEY`, `VITE_OPENWEATHER_API_KEY` ya están en Secret Manager. Falta: agregar `MP_IPN_SECRET`, `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`, `SENTRY_DSN`, `VITE_SENTRY_DSN`, `WEBHOOK_SECRET`, `E2E_TEST_SECRET` (este NO en prod). Documentar en `docs/SECRET_MANAGEMENT.md`. Skill: `code-review`.
- [ ] T-3.10 — (2h) `firestore.indexes.json` completo: auditar todos los `useFirestoreCollection` + `onSnapshot` para listar queries que requieren composite. Cross-checkear con `firestore.indexes.json` actual. Agregar los faltantes. `firestore deploy --only firestore:indexes` smoke en emulator.
- [ ] T-3.11 — (2h) Canary deploy: `deploy-canary.yml` con traffic split 5% durante 30min, smoke + latency check, ramp 25% durante 30min, smoke + latency check, ramp 100%. Si cualquier gate falla, rollback automático. Skill: TDD via dry-run.

**Criterio de éxito**:

- `deploy.yml` modificado y un deploy exitoso a prod con nueva config (memoria 1Gi, min-instances=1 horario faena).
- `KMS_ADAPTER=in-memory-dev` ya NO en producción.
- `cloudbuild.yaml` paralelo committed.
- DR runbook validado con simulacro real (resultado documentado en `docs/dr-drill-2026-Q2.md`).
- KMS rotation ejecutada manualmente al menos 1 vez con runbook.
- `/api/health/deep` retorna shape válido en prod.
- 5 alerting policies de Fase 2 disparan correctamente en simulacros.
- Canary deploy probado al menos 1 vez sin rollback.
- Cloud Run cold-start eliminado en horario faena (verificable vía latency p99 al primer request del día).

**Dependencies**: Fase 2 completa (alerting policies necesitan Sentry maduro).

**Riesgos**: 

1. Min-instances=1 24/7 cuesta ~$15/mes adicional. Mitigación: schedule horario faena 06:00-22:00 Chile via Cloud Scheduler `update-revision-tag`.
2. KMS rotation puede romper sesiones activas. Mitigación: graceful key versioning (Cloud KMS soporta múltiples versiones simultáneas), test en simulacro.
3. DR simulacro consume tráfico real. Mitigación: traffic mock vía `gcloud run services update-traffic --to-tags=dr-test=1`.

**TDD entry point**: `src/server/middleware/healthCheck.test.ts` con `it('returns degraded when Firestore is unreachable')` falla → crear middleware → pasa.

---

<a name="fase-4"></a>
## 8. Fase 4 — Sprint 23 · Mobile native (Capacitor sync, builds, store readiness)

**Objetivo**: la app corre como native Android (Play Store internal testing) e iOS (TestFlight). Capacitor 8 plugins opt-in funcionan: BluetoothLE wearables, HealthConnect Android, PushNotifications avanzadas, Bluetooth proximity en SOS. Todos con UI de opt-in respetando privacidad. Brecha A queda completamente cerrada.

**Por qué cuarto**: una vez que la app web tiene SLM offline (Fase 1), observability (Fase 2) y deployment hardening (Fase 3), el siguiente paso lógico para llegar al usuario faena es empaquetarla como app nativa. Sin esto, los plugins Capacitor instalados (geolocation, motion, biometric-auth, sqlite, healthkit, health-connect) están inertes en la PWA — no se accede a sensores nativos sin el wrap.

**Estimación**: 26h.

**Archivos a tocar/crear**:

- `android/` (CREATE via `npx cap sync android`) — proyecto Gradle + AndroidManifest.xml + permisos.
- `ios/` (CREATE via `npx cap sync ios`) — proyecto Xcode + Info.plist + entitlements.
- `.github/workflows/mobile-android.yml` (CREATE) — build Android AAB + lint + signing + upload Play Internal.
- `.github/workflows/mobile-ios.yml` (CREATE) — build iOS .ipa + lint + signing + TestFlight upload via Fastlane o `xcrun altool`.
- `fastlane/Fastfile` + `fastlane/Appfile` (CREATE) — fastlane lanes para iOS + Android.
- `docs/IOS_BUILD_RUNBOOK.md` (CREATE) — checklist completo para build iOS: certificados Apple Developer, Push provisioning profiles, HealthKit capability, App Tracking Transparency strings.
- `docs/ANDROID_BUILD_RUNBOOK.md` (CREATE) — checklist Android: signing key vault, Play Console upload key, Play Integrity API, Health Connect permissions.
- `docs/MARKETPLACE_SUBMISSION.md` (CREATE) — listings ES-CL y PT-BR para Play + App Store: copy, screenshots, privacy nutrition labels, content rating.
- `docs/HEALTH_CONNECT_MIGRATION.md` (CREATE) — migration runbook desde Google Fit (deprecated 2026-12-31) a Health Connect Android via `@kiwi-health/capacitor-health-connect`.
- `src/services/health/healthConnectAdapter.ts` (CREATE) — adapter Android usando `@kiwi-health/capacitor-health-connect`.
- `src/services/health/healthKitAdapter.ts` (CREATE) — adapter iOS usando `@perfood/capacitor-healthkit`.
- `src/services/health/healthAdapter.ts` (CREATE) — facade que selecciona adapter por plataforma.
- `src/services/bluetooth/bluetoothMeshAdapter.ts` (MODIFY o CREATE si no existe) — `@capacitor-community/bluetooth-le` integration para SOS proximity.
- `src/components/sos/BluetoothProximitySOS.tsx` (CREATE) — feature: cuando 2 operarios están cerca por BLE y ambos disparan SOS, alerta dual.
- `src/components/settings/MobilePluginsConsent.tsx` (CREATE) — UI opt-in para cada plugin Capacitor con consentimiento granular.
- `src/hooks/useCapacitorPlatform.ts` (CREATE) — detecta plataforma (web, ios, android) y expone capacidades.
- `capacitor.config.ts` (MODIFY) — completar plugins config para Bluetooth, HealthConnect.

**Tareas concretas**:

- [ ] T-4.1 — (2h) `npx cap sync android` + `npx cap sync ios` por primera vez. Cometer `android/` y `ios/` (parcialmente — los archivos de signing y profiles van a `.gitignore`). Validar que `npx cap open android` abre Android Studio sin errores. Skill: `verification-before-completion`.
- [ ] T-4.2 — (3h) Configurar AndroidManifest.xml: permisos `ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION` (Android 10+), `BLUETOOTH_SCAN`/`BLUETOOTH_CONNECT` (Android 12+), `BODY_SENSORS`, `ACTIVITY_RECOGNITION`. Health Connect permissions via separate XML. Push Notifications channel.
- [ ] T-4.3 — (3h) Configurar Info.plist iOS: `NSLocationWhenInUseUsageDescription`, `NSLocationAlwaysUsageDescription`, `NSMotionUsageDescription`, `NSHealthShareUsageDescription`, `NSHealthUpdateUsageDescription`, `NSBluetoothAlwaysUsageDescription`. App.entitlements con HealthKit + Push + Background fetch.
- [ ] T-4.4 — (3h) Build pipelines: `mobile-android.yml` y `mobile-ios.yml` con cache Gradle/CocoaPods, lint, build AAB/.ipa, signing con secrets, upload Play Internal/TestFlight automático en push a `release/*` branches. macOS runner para iOS, ubuntu para Android. Skill: TDD via dry-run.
- [ ] T-4.5 — (2h) Fastlane setup: `fastlane init` para Android e iOS. Lanes: `beta` (TestFlight/Play Internal), `release` (App Store/Play Production). Match para certificados iOS. Skill: TDD.
- [ ] T-4.6 — (3h) Health Connect adapter Android + HealthKit adapter iOS + facade. Permisos opt-in con UI. Persistencia preferencia. Tests unitarios mock. Skill: TDD.
- [ ] T-4.7 — (3h) Bluetooth mesh adapter + Bluetooth proximity SOS. UI para parear con compañeros de cuadrilla. Persistencia de mesh peers. Skill: TDD.
- [ ] T-4.8 — (2h) `MobilePluginsConsent.tsx` UI: lista de plugins con toggle opt-in, descripción de qué datos accede, link a privacy policy. Persiste en `@capacitor/preferences`. Skill: `frontend-design`.
- [ ] T-4.9 — (2h) Marketplace submission docs: listings ES-CL y PT-BR (copy markdown), screenshots requeridos por plataforma (320×480, 750×1334, 1242×2208 iPhone; 480×800, 1080×1920 Android), privacy nutrition labels (Apple) y data safety form (Google), content rating IARC. Skill: `frontend-design` + `writing-plans`.
- [ ] T-4.10 — (3h) Smoke test on-device: build .aab firmado, upload Play Internal Testing, instalar en device físico, verificar 6 features clave: SOS long-press, FallDetection background, push notification recibida, BLE pairing, HealthConnect data read, biometric auth login.

**Criterio de éxito**:

- `android/` y `ios/` projects committed (con `.gitignore` apropiado para signing assets).
- Build Android exitoso en CI generando AAB firmado.
- Build iOS exitoso en CI generando .ipa firmado.
- TestFlight build distribuido y testeable.
- Play Internal Testing build distribuido y testeable.
- 6 features clave funcionan on-device en al menos 1 Android (Pixel/Samsung) y 1 iOS (iPhone 12+).
- HealthConnect Android adapter passes integration test con datos reales.
- HealthKit iOS adapter passes integration test con datos reales.
- BLE proximity SOS: 2 devices en mismo proyecto detectan SOS dual.
- `MobilePluginsConsent.tsx` UI accesible desde `/settings`.
- Marketplace listings revisados por usuario (Daho).

**Dependencies**: Fase 1 (SLM offline funciona en mobile via Capacitor wrap), Fase 3 (deployment hardening — algunas configs de mobile dependen de URLs prod estables).

**Riesgos**: 

1. Apple App Tracking Transparency puede bloquear analítica si no se pide consentimiento explícito. Mitigación: ATT prompt al primer launch, gate analytics behind consent.
2. Health Connect permissions Android 14 requieren manifest XML específico. Mitigación: seguir docs oficiales, validar en Play Console pre-launch.
3. Apple review puede rechazar HealthKit usage si descripción usage no es clara. Mitigación: redactar `NSHealthShareUsageDescription` con caso de uso específico ("Detección de fatiga del operario para alertar a supervisor").
4. Cobertura de testing en device real requiere hardware. Mitigación: BrowserStack o Firebase Test Lab para dispositivos reales virtualizados.

**TDD entry point**: `src/services/health/healthAdapter.test.ts` con `it('selects healthKit on iOS')` falla → crear adapter → pasa.

---

<a name="fase-5"></a>
## 9. Fase 5 — Sprint 24 · Billing real (Transbank prod + MercadoPago IPN + Play RTDN cierre + factura SII)

**Objetivo**: los 8 tiers del modelo B2D + tier core Praeventio se monetizan con flujos reales en producción. Transbank Webpay procesa CLP con DTE válido emitido vía proveedor SII (Bsale/Defontana). MercadoPago procesa LATAM con IPN webhook idempotente. Google Play Billing maneja suscripciones Android. Dashboards admin muestran MRR, ARR, churn cohort, conversion por país. NO Stripe.

**Por qué quinto**: con app funcionando, observable, deployable, mobile-ready, ahora hay que cobrar. Las rutas billing existen (`/api/billing/*`) pero faltan piezas críticas: IPN MercadoPago dedicado, SII DTE, dashboards admin. Sin cierre de billing, el negocio no escala.

**Estimación**: 28h.

**Archivos a tocar/crear**:

- `src/server/routes/billing.ts` (MODIFY o split en sub-files) — actualmente puede estar grande, refactorizar en `billing/index.ts`, `billing/webpay.ts`, `billing/mercadopago.ts`, `billing/googleplay.ts`, `billing/sii.ts`.
- `src/server/routes/billing/sii.ts` (CREATE) — endpoint `/api/billing/sii/emit` para emisión DTE post-payment-success.
- `src/services/billing/siiAdapter.ts` (CREATE) — adapter para proveedor DTE. Decisión Bsale (más usado en Chile) o Defontana. Ambos REST API. Skill: `code-review`.
- `src/server/routes/billing/mercadopago.ts` (MODIFY o CREATE) — agregar IPN webhook dedicado `/api/billing/mercadopago/ipn` con HMAC-SHA256 canonical-JSON.
- `src/services/billing/billingDashboardService.ts` (CREATE) — agregaciones MRR, ARR, churn, conversion. Tests TDD.
- `src/pages/admin/BillingDashboard.tsx` (CREATE) — dashboard admin gated por role admin.
- `src/components/billing/MRRChart.tsx`, `ChurnCohort.tsx`, `ConversionFunnel.tsx` (CREATE) — recharts components.
- `src/services/billing/tierConfig.ts` (CREATE o MODIFY) — definición canonical de los 8 tiers + core tier con quotas, precios CLP/USD/PEN/ARS/COP/MXN/BRL.
- `docs/BILLING_RUNBOOK.md` (CREATE) — runbook de operaciones billing: refunds, disputes, manual mark-paid, reconciliación contable.
- `docs/SII_INTEGRATION.md` (CREATE) — runbook integración SII: ambiente certificación → producción, contingencia, retry strategy.
- `tests/integration/billing/` (CREATE) — tests integración con Webpay sandbox, MercadoPago test, Play Billing test.

**Tareas concretas**:

- [ ] T-5.1 — (2h) Definir canonical 8 tiers + core en `src/services/billing/tierConfig.ts`. Memoria menciona: Climate API, Hazmat API, Normativa API, Suite API, más planes Praeventio core (Free, Cuadrilla, Faena, Mutual, Enterprise). Quotas: requests/día por API, workers/projects máx, storage. Precios CLP/USD por country. Skill: TDD.
- [ ] T-5.2 — (2h) Refactor `billing.ts` actual en sub-files. Verificar tests existentes siguen pasando. Skill: `simplify`.
- [ ] T-5.3 — (3h) Decidir + integrar proveedor SII DTE. Bsale recomendado (API REST, free tier hasta 100 DTE/mes, soporte boleta + factura electrónica). Crear `siiAdapter.ts` con `emitDTE(invoice, payment)` retornando `{folio, codigoSII, pdfUrl, xmlUrl}`. Almacenar en `invoices/{id}.dte`. Skill: TDD + `code-review` + MCP `plugin_context7_context7` para docs Bsale.
- [ ] T-5.4 — (2h) Endpoint `/api/billing/sii/emit` server-side gated por role admin (manual emit fallback) + auto-trigger desde webpay-return cuando `outcome=success`. Skill: TDD.
- [ ] T-5.5 — (3h) MercadoPago IPN webhook dedicado `/api/billing/mercadopago/ipn`. Validación HMAC-SHA256 canonical-JSON via `canonicalBody` middleware existente. Idempotency lock en `processed_mercadopago_ipn/{messageId}`. Trigger emisión DTE para preferencia exitosa. Skill: TDD.
- [ ] T-5.6 — (2h) Validar Play RTDN actual (`POST /api/billing/webhook`): cubre subscriptions + one-time purchases? Replays soportados? Test contra Pub/Sub mock. Skill: `code-review` + TDD.
- [ ] T-5.7 — (4h) Dashboards admin: `BillingDashboard.tsx` con 4 paneles: MRR rolling 12 meses, ARR proyectado, Churn cohort 30/60/90 días, Conversion funnel (visitor → checkout → paid). Recharts. Filtros por país, tier, fecha rango. Skill: `frontend-design` + TDD.
- [ ] T-5.8 — (3h) Servicio `billingDashboardService` con queries Firestore + agregaciones BigQuery (events de Fase 2). Cache 1h en memoria (Cloud Run instance-local). Skill: TDD.
- [ ] T-5.9 — (2h) Quota enforcement por tier en `geminiBackend` y otros services consumidores. Hoy `geminiLimiter` per-uid pero sin awareness de tier. Agregar middleware `tierQuotaMiddleware` que lee `users/{uid}.subscription.tier` y aplica límite específico. Skill: TDD.
- [ ] T-5.10 — (2h) Webpay sandbox → producción: validar que `transbank-sdk@6.1.1` está en modo prod cuando `NODE_ENV=production`, sandbox en otro caso. Update `.env.example` con vars Transbank prod (commerce code + api key). Skill: `code-review`.
- [ ] T-5.11 — (3h) Tests integración billing: smoke against Webpay sandbox (full flow checkout → return → DTE), MercadoPago test mode (full flow + IPN), Play Billing replay scenarios. Skill: TDD.

**Criterio de éxito**:

- 9 tiers definidos en código con TS types.
- Webpay producción funciona end-to-end con DTE emitido vía Bsale.
- MercadoPago IPN webhook idempotente, replay-safe, con test integration verde.
- Play RTDN cubre subscriptions + one-time, replay-safe.
- Dashboard admin `/admin/billing` accesible y funcional.
- Quota enforcement por tier en Gemini calls.
- 0 bugs P0 en billing post-launch (criterio: reportes Sentry billing < 1%/día en primer mes).
- Runbook billing completo con 5 escenarios documentados.

**Dependencies**: Fase 2 (eventos `subscription_*` necesitan tracking), Fase 3 (secrets management).

**Riesgos**: 

1. SII certificación a producción puede demorar 2-3 semanas. Mitigación: arrancar paralelo en Sprint 24 inicio.
2. MercadoPago IPN puede tener delay (eventual consistency). Mitigación: idempotency lock + reconciliation job nightly.
3. Webpay producción requires commerce code real (no sandbox). Mitigación: Daho proporciona credenciales pre-Sprint 24.
4. Play RTDN replays con `messageId` viejo deben no procesar 2 veces. Test específico requerido.

**TDD entry point**: `src/services/billing/siiAdapter.test.ts` con `it('emits DTE for paid invoice and returns folio')` falla → crear adapter mock + impl → pasa.

---

<a name="fase-6"></a>
## 10. Fase 6 — Sprint 25 · Performance + accesibilidad WCAG 2.2 AA + i18n hardening

**Objetivo**: la app cumple WCAG 2.2 AA verificado por axe-core en CI. Lighthouse performance score ≥ 0.85 (hoy 0.65). LCP p75 ≤ 2.5s, INP p75 ≤ 200ms, CLS ≤ 0.1. Bundle initial ≤ 250KB minified+gz con budgets enforcement por chunk. i18n coverage ≥ 95% para los 6 idiomas (es-CL primary, ES-AR/ES-MX/ES-PE/PT-BR/EN secondary).

**Por qué sexto**: con feature work + observability + deploy + mobile + billing en producción, la calidad transversal es lo que separa MVP de producto-de-mercado. WCAG y performance son requisitos legales/contractuales para mutuales y entidades públicas. i18n es habilitador de expansión LATAM.

**Estimación**: 22h.

**Archivos a tocar/crear**:

- `tests/a11y/` (CREATE) — Playwright tests con `@axe-core/playwright`.
- `.github/workflows/a11y.yml` (CREATE) — gate de a11y en CI.
- `src/components/__tests__/a11y.spec.ts` (CREATE) — tests axe-core unitarios para componentes core.
- `lighthouserc.json` (MODIFY) — perf threshold 0.65 → 0.85, agregar a11y threshold 0.95, best-practices 0.95, SEO 0.90.
- `size-limit.config.cjs` o equivalente (CREATE/MODIFY) — budgets hard por chunk: shell ≤ 250KB, slm-runtime ≤ 1MB, three.js-runtime ≤ 800KB, mediapipe ≤ 600KB.
- `src/i18n/coverage.ts` (CREATE) — script que valida coverage por idioma vs es-CL como source-of-truth.
- `scripts/i18n-coverage.mjs` (CREATE) — CLI que genera report y falla CI si coverage < 95%.
- `src/components/SkipNav.tsx` (CREATE) — skip-to-main-content link para keyboard nav.
- `src/hooks/useA11yAnnounce.ts` (CREATE) — hook para anuncios screen-reader (aria-live).
- `docs/A11Y_AUDIT_2026-Q2.md` (CREATE) — auditoría manual con NVDA + VoiceOver + JAWS, screenshots, hallazgos.
- `docs/PERFORMANCE_OPTIMIZATIONS.md` (CREATE) — registro de optimizations aplicadas.
- `vite.config.ts` (MODIFY) — `build.cssCodeSplit`, `build.minify`, `terser` options optimizadas.

**Tareas concretas**:

- [ ] T-6.1 — (2h) Setup `@axe-core/playwright` en `tests/a11y/`. Tests para: Landing page, Login, Dashboard, Gantt, IPER form, SOS button, Settings, BillingDashboard. Skill: TDD + `superpowers:test-driven-development`.
- [ ] T-6.2 — (2h) Auditoría manual screen-reader: NVDA en Windows, VoiceOver en Mac/iOS, TalkBack Android. Screenshots de hallazgos. Output: `docs/A11Y_AUDIT_2026-Q2.md`. Skill: `code-review`.
- [ ] T-6.3 — (2h) Fix top 10 hallazgos a11y de auditoría manual: aria-labels faltantes, contrast ratios sub-AA, focus management en modals, alt text en imágenes decorativas. Skill: TDD.
- [ ] T-6.4 — (1h) `SkipNav.tsx` + `useA11yAnnounce.ts`. Cablear en `RootLayout`. Tests RTL. Skill: TDD.
- [ ] T-6.5 — (2h) `.github/workflows/a11y.yml` gate: axe-core sobre 8 páginas core, falla si serious/critical violations. Skill: TDD.
- [ ] T-6.6 — (3h) Performance audit Lighthouse: identificar top 5 bottlenecks. Probable: bundle size, unused JS, render-blocking CSS, image optimization, third-party JS. Documentar en `docs/PERFORMANCE_OPTIMIZATIONS.md`. Skill: `code-review` + MCP `plugin_context7_context7` (Vite + React optimizations).
- [ ] T-6.7 — (3h) Aplicar top 5 optimizations: code-splitting agresivo (lazy de pages), tree-shake lucide-react (importar individualmente), PurgeCSS Tailwind (ya activo via Vite plugin), image optimization (WebP fallback PNG, sizes responsive). Skill: TDD verificando cada optimization no rompe.
- [ ] T-6.8 — (2h) Bundle budgets: `size-limit.config.cjs` con 4 chunks tipados, hard fail en CI. Adjustar `lighthouserc.json` con thresholds nuevos. Skill: TDD.
- [ ] T-6.9 — (3h) i18n coverage script: `scripts/i18n-coverage.mjs` lee `src/i18n/locales/es-CL/*.json` (source-of-truth), compara con otros idiomas, reporta keys faltantes %. Falla CI si idioma activo < 95% (es-CL, es-AR, pt-BR; secondary 80%: en, es-MX, es-PE). Skill: TDD.
- [ ] T-6.10 — (2h) Llenar gaps i18n para alcanzar threshold. Skill: `simplify` (replicar strings existentes en otros idiomas).

**Criterio de éxito**:

- Lighthouse perf score ≥ 0.85 en `/`, `/dashboard`, `/asistente`, `/settings`.
- Lighthouse a11y score ≥ 0.95 en mismas páginas.
- LCP p75 ≤ 2.5s en producción (medible via Sentry web vitals).
- INP p75 ≤ 200ms.
- CLS ≤ 0.1.
- Bundle initial ≤ 250KB minified+gz.
- 0 violations critical/serious axe-core en 8 páginas core.
- i18n coverage ≥ 95% es-CL/es-AR/pt-BR; ≥ 80% en/es-MX/es-PE.
- A11y audit manual completo con NVDA/VoiceOver/TalkBack documentado.

**Dependencies**: Fase 1 (chunk slm-runtime ya con budget), Fase 4 (mobile native lighthouse on-device).

**Riesgos**: 

1. Some lucide-react icons may not tree-shake si el componente las importa via destructure dinámico. Mitigación: lint rule custom + audit imports.
2. CSS variants Tailwind 4 + PurgeCSS pueden over-purge. Mitigación: safelist explícito en `tailwind.config`.
3. WCAG validation en componentes complex (Gantt, Three.js Site25DPanel) puede ser alto esfuerzo. Mitigación: target serious/critical only en Sprint 25; minor/moderate diferidos a Sprint 26.

**TDD entry point**: `tests/a11y/landing.a11y.spec.ts` con `it('LandingPage has no axe violations')` falla → fix violations → pasa.

---

<a name="fase-7"></a>
## 11. Fase 7 — Sprint 26 · Listeners onSnapshot rearquitectura + Firestore composite indexes + cost budget hard

**Objetivo**: los 4 listeners flagged con TODO comments en Sprint 19 (DocsModal, EmergencyCheckIn, EmergenciaAvanzada, ControlsAndMaterials) tienen filtros `where`/`limit` apropiados con composite indexes desplegados. Cost budget hard en CI: si un PR agrega un listener sin `where('archived','==',false)` o sin `limit(N)`, el lint falla. Cost dashboards muestran consumo Firestore por colección y por tenant.

**Por qué séptimo**: a esta altura del master plan, la app tiene tráfico real (post Fase 5 billing live). Los 4 listeners sin filtros se vuelven dolorosos si una cuadrilla escala a >200 workers. Tomar deuda específica con métricas reales de uso es mejor que adivinar antes.

**Estimación**: 16h.

**Archivos a tocar/crear**:

- `src/components/workers/DocsModal.tsx` (MODIFY) — agregar `where('archived','==',false)` + `orderBy('createdAt','desc')` + `limit(50)`.
- `src/components/emergency/EmergencyCheckIn.tsx` (MODIFY) — `where('lastCheckinAt','>',Date.now()-24h)` + `limit(50)`.
- `src/pages/EmergenciaAvanzada.tsx` (MODIFY) — `where('lastUpdate','>',Date.now()-24h)` + `limit(100)`.
- `src/pages/ControlsAndMaterials.tsx` (MODIFY) — `where('active','==',true)` + `limit(100)`.
- `firestore.indexes.json` (MODIFY) — agregar composite indexes para queries nuevos.
- `eslint-rules/no-unfiltered-onsnapshot.js` (CREATE) — lint rule custom que escanea `onSnapshot` o `useFirestoreCollection` calls y exige `where` o `limit`.
- `src/services/firestore/listenerBudget.ts` (CREATE) — wrapper que cuenta listeners activos por user + emite Sentry breadcrumb si > N.
- `docs/observability/firestore-cost-dashboard.md` (CREATE) — definición dashboard Cloud Monitoring con métricas Firestore reads/writes por colección.
- `docs/architecture-decisions/0004-firestore-listener-policy.md` (CREATE) — ADR formal: todos los listeners deben tener `where` o `limit`. Excepciones documentadas case-by-case.

**Tareas concretas**:

- [ ] T-7.1 — (1h) Refactor DocsModal: agregar `where('archived','==',false)` + `orderBy('createdAt','desc')` + `limit(50)`. Test integration. Verificar UX: si user tiene > 50 docs, agregar paginación con `startAfter`. Skill: TDD.
- [ ] T-7.2 — (1h) Refactor EmergencyCheckIn similar.
- [ ] T-7.3 — (1h) Refactor EmergenciaAvanzada similar.
- [ ] T-7.4 — (1h) Refactor ControlsAndMaterials similar.
- [ ] T-7.5 — (1h) Composite indexes: deploy `firestore.indexes.json` updated. Verify via emulator.
- [ ] T-7.6 — (3h) `eslint-rules/no-unfiltered-onsnapshot.js`: AST-based lint rule que detecta `onSnapshot(query)` sin `where`/`limit` y `useFirestoreCollection(collection, options)` sin filters. Allow `// eslint-disable-next-line no-unfiltered-onsnapshot — explanation` para excepciones. Skill: TDD.
- [ ] T-7.7 — (2h) Activar lint rule en CI: `.eslintrc.cjs` agrega `no-unfiltered-onsnapshot: 'error'`. Identificar excepciones legítimas del code-base actual y comentarlas.
- [ ] T-7.8 — (3h) `listenerBudget.ts`: hook + wrapper que cuenta listeners activos en mounting, emite Sentry breadcrumb si > 5 simultáneos. Útil para detectar leaks. Skill: TDD.
- [ ] T-7.9 — (2h) Firestore cost dashboard JSON: panel con reads/writes por colección, top tenants, listeners activos histograma. Skill: `code-review`.
- [ ] T-7.10 — (2h) ADR-0004 firestore listener policy: principios, excepciones permitidas, runbook si dashboard sube > X.

**Criterio de éxito**:

- 4 listeners refactorizados con filtros y composite indexes.
- Lint rule `no-unfiltered-onsnapshot` activa en CI.
- 0 false positives después de excepciones marcadas.
- Cost dashboard Firestore committed.
- ADR-0004 committed.
- Reads Firestore por listener observado bajaron ≥ 60% post-refactor (verificable en cost dashboard).

**Dependencies**: Fase 2 (Cloud Monitoring metrics).

**Riesgos**: 

1. AST-based lint rule puede tener false positives. Mitigación: tests del rule + iteración.
2. `where` en algunos listeners cambia comportamiento UX (e.g. archivados no aparecen). Mitigación: agregar UI "Mostrar archivados" toggle donde aplique.

**TDD entry point**: `eslint-rules/no-unfiltered-onsnapshot.test.js` con `it('flags onSnapshot without where or limit')` falla → impl rule → pasa.

---

<a name="fase-8"></a>
## 12. Fase 8 — Sprint 27 · Security hardening + Ley 19628 + audit log retention + pen-test readiness

**Objetivo**: la app es defensible contra ataques realistas. Compliance Ley 19628 Chile: tratamiento de datos personales documentado, consentimientos registrados, derecho de acceso/eliminación funcional. Audit log retention con policy 7 años para datos contables, 5 años para auditorías safety, 30 días para logs operacionales. Pen-test por tercero ejecutado y hallazgos remediados.

**Por qué octavo**: con producto en producción + observable + deployable + mobile + monetizable + performante, el siguiente foco es resiliencia contra abuso/ataque/compliance. Esto NO es "polish" — es requisito legal y contractual para clientes mutuales/entidades públicas.

**Estimación**: 20h.

**Archivos a tocar/crear**:

- `docs/security/penetration-test-2026-Q3.md` (CREATE) — informe pen-test (3rd party).
- `docs/security/threat-model.md` (CREATE) — STRIDE analysis: spoofing, tampering, repudiation, info disclosure, DoS, elevation.
- `docs/compliance/ley-19628-tratamiento.md` (CREATE) — registro completo de tratamiento de datos personales según Ley 19628.
- `docs/compliance/derecho-acceso.md` (CREATE) — runbook ARCO (acceso, rectificación, cancelación, oposición).
- `src/server/routes/compliance.ts` (CREATE) — endpoints `/api/compliance/data-export`, `/api/compliance/data-deletion`.
- `src/services/compliance/dataExportService.ts` (CREATE) — empaqueta toda la data de un usuario en JSON descargable.
- `src/services/compliance/dataDeletionService.ts` (CREATE) — soft-delete con marcador + hard-delete después de 30 días grace period.
- `src/services/audit/retentionService.ts` (CREATE) — Cloud Function scheduled diaria que aplica retention policy.
- `firestore.rules` (MODIFY) — gate compliance endpoints por role admin o self.
- `docs/security/audit-log-retention-policy.md` (CREATE) — tabla de retention por collection/log type.
- `docs/security/pen-test-runbook.md` (CREATE) — preparación para pen-test (qué entornos, qué credenciales, qué scope, qué fuera de scope).
- `src/server/middleware/cspStrict.ts` (MODIFY o CREATE) — endurecer CSP a strict (sin `'unsafe-inline'` para CSS, considerando hashes).
- `scripts/security-scan.sh` (CREATE) — script local que ejecuta `npm audit`, `gitleaks`, `trivy` sobre Docker image.

**Tareas concretas**:

- [ ] T-8.1 — (3h) Threat model STRIDE completo. Identificar top 10 amenazas. Skill: `code-review`.
- [ ] T-8.2 — (3h) Registro Ley 19628 completo: tipos de datos personales, finalidades, base de licitud (consentimiento, contrato, interés legítimo), tiempo retención, terceros con acceso (Vertex AI, Sentry, SII proveedor, Resend, Maps, Transbank). Output: `docs/compliance/ley-19628-tratamiento.md`. Skill: `code-review` + `writing-plans`.
- [ ] T-8.3 — (2h) Derecho ARCO runbook: cómo un usuario solicita su data, plazo respuesta (15 días hábiles según Ley 19628), template respuesta. Skill: `writing-plans`.
- [ ] T-8.4 — (3h) Endpoints compliance: `/api/compliance/data-export` (autenticado, retorna JSON con projects, crews, processes, audit_logs, billing — sanitizado), `/api/compliance/data-deletion` (autenticado, soft-delete + grace 30d, hard-delete confirmado). Tests TDD. Skill: TDD.
- [ ] T-8.5 — (2h) Retention service: Cloud Function scheduled (Cloud Scheduler trigger) que escanea audit_logs > 5y, telemetry_events > 30d, processed_pubsub > 90d y borra. Test integration. Skill: TDD.
- [ ] T-8.6 — (1h) Audit log retention policy table: collection/log type, retention días, basis legal, runbook borrado. Skill: `writing-plans`.
- [ ] T-8.7 — (2h) CSP strict: eliminar `'unsafe-inline'` para CSS via hash de inline styles (Vite genera). Validar que MediaPipe WASM blob: sigue funcionando. Skill: `code-review`.
- [ ] T-8.8 — (2h) Security scan local + CI: `scripts/security-scan.sh` con npm audit, gitleaks, trivy. CI gate `.github/workflows/security.yml` que ejecuta semanal. Skill: TDD.
- [ ] T-8.9 — (2h) Pen-test prep: scope (production read-only access), out-of-scope (Firestore real data, billing prod), credenciales test, runbook respuesta a hallazgos. Skill: `writing-plans`.
- [ ] T-8.10 — (post-pen-test, variable) Remediar hallazgos pen-test priorizados por severity.

**Criterio de éxito**:

- Threat model STRIDE committed y revisado.
- Registro Ley 19628 completo y revisado por usuario.
- Endpoints `/api/compliance/data-export` y `/api/compliance/data-deletion` funcionan con tests integration.
- Retention service activo con Cloud Function deployed.
- CSP strict deployado (no `'unsafe-inline'` CSS).
- Security scan CI gate activa.
- Pen-test ejecutado por 3rd party (e.g. Mountain View, Hackmetrix) — fuera de scope de este sprint pero queda agendado.
- 0 hallazgos critical/high pos-pen-test remediated.

**Dependencies**: Fase 2 (audit logs maduros), Fase 5 (billing data flows compliance-aware).

**Riesgos**: 

1. Pen-test puede revelar bugs serios. Mitigación: agendar para después de Sprint 27 cierre, con buffer 2 semanas remediación pre-Sprint 28.
2. Ley 19628 modificación en agenda legislativa Chile (proyecto LPD nueva). Mitigación: documentar conforme a ley actual + monitoring legal.
3. CSP strict puede romper algún componente con inline style. Mitigación: deploy gradual + Sentry CSP violation report.

**TDD entry point**: `src/server/routes/compliance.test.ts` con `it('exports user data as JSON')` falla → crear endpoint → pasa.

---

<a name="fase-9"></a>
## 13. Fase 9 — Sprint 28 · Brecha C (fotogrametría auto) + iconografía médica enriquecida + Bioicons curation real

**Objetivo**: el usuario en faena puede tomar 30-60 fotos con la app móvil, subirlas, y obtener un mesh GLB navegable en `Site25DPanel`. La iconografía médica integra los 33 SVG placeholders con assets reales generados (Nano Banana via `generate-medical-icons.mjs` ejecutado), y opcionalmente enriquece prompts con búsqueda Bioicons via MCP `mcp__49cafb66-...__search-icons` para nomenclatura canónica.

**Por qué noveno**: las brechas restantes son features puramente nuevas (no requisito de "producto sólido"). Esperan a que la base esté completa. Fotogrametría requiere infra GCP nueva (Cloud Run GPU T4) que es preferible introducir cuando el resto está estable.

**Estimación**: 24h.

**Archivos a tocar/crear**:

- `src/services/photogrammetry/index.ts` + adapter (CREATE) — pipeline NodeODM Cloud Run.
- `src/server/routes/photogrammetry.ts` (CREATE) — `POST /api/scan/photos` (multipart), `GET /api/scan/:id` (status), `GET /api/scan/:id/mesh` (signed URL).
- `infrastructure/photogrammetry-cloud-run/Dockerfile` (CREATE) — NodeODM AGPL backend-only image.
- `infrastructure/photogrammetry-cloud-run/cloudbuild.yaml` (CREATE).
- `src/components/digital-twin/MeshViewer.tsx` (CREATE) — react-three-fiber viewer para GLB.
- `src/components/digital-twin/Site25DPanel.tsx` (MODIFY) — agregar tab "Mesh" con `MeshViewer`.
- `src/pages/faena/PhotoScan.tsx` (CREATE) — UI captura: gate cámara, instrucciones spiral pattern, upload progress, status polling.
- `scripts/generate-medical-icons.mjs` (MODIFY) — agregar opción `--enrich-with-bioicons` que via MCP busca nomenclatura.
- `public/icons/biology/*.png` (GENERATE) — ejecutar script para todos los 33 iconos.
- `src/services/medical/iconLibrary.ts` (MODIFY) — soportar PNG además de SVG (agregar `format: 'svg'|'png'` field).
- `src/components/medical/MedicalIcon.tsx` (MODIFY) — soportar render PNG con fallback graceful preservado.
- `docs/architecture-decisions/0005-photogrammetry-pipeline.md` (CREATE) — ADR pipeline fotogrametría.

**Tareas concretas**:

- [ ] T-9.1 — (4h) Setup Cloud Run NodeODM: Dockerfile basado en `opendronemap/nodeodm:latest`, GPU T4 attached, scale-to-zero por defecto, max 1 instance (single-tenant per scan). cloudbuild.yaml. Skill: `code-review` + MCP `plugin_context7_context7` (NodeODM docs).
- [ ] T-9.2 — (3h) Endpoint `/api/scan/photos`: multipart upload (max 60 fotos, max 10MB each), valida exif, dispara Cloud Run job, retorna `scanId`. `/api/scan/:id` poll status. `/api/scan/:id/mesh` retorna signed URL GCS al GLB. Tests TDD. Skill: TDD.
- [ ] T-9.3 — (3h) `MeshViewer.tsx` con react-three-fiber + drei `useGLTF`. Performance: Draco compression, max 100K vertices, fallback bajo si device es low-end. Skill: `frontend-design` + TDD.
- [ ] T-9.4 — (2h) `Site25DPanel.tsx` agregar tab "Mesh". Render según availability del scan. Skill: `frontend-design`.
- [ ] T-9.5 — (3h) `PhotoScan.tsx` UI: instrucciones spiral pattern, gate cámara via Capacitor, upload progress, status polling cada 30s. Skill: `frontend-design` + TDD.
- [ ] T-9.6 — (2h) ADR-0005: justificación NodeODM AGPL backend-only OK (no se distribuye al cliente), alternativas evaluadas (Reality Capture API, PostShot Gaussian Splatting), decisión final.
- [ ] T-9.7 — **MOVIDO a Fase 1b (Sprint 20 paralelo)** — generación 33 PNG médicos con nano-banana + BioRender ref ya cubierta antes de llegar a este sprint. Si quedan iconos CC-BY pendientes de curation visual (3 modos: outline + filled + accent), reservar 2h aquí.
- [ ] T-9.8 — **MOVIDO a Fase 1b** — soporte PNG en iconLibrary + MedicalIcon ya wireado al inicio del master plan.
- [ ] T-9.9 — **MOVIDO a Fase 1b** — enrichment BioRender vía MCP ya integrado al script desde el primer sprint.

**Criterio de éxito**:

- `POST /api/scan/photos` acepta 30-60 fotos, dispara Cloud Run, retorna scanId.
- Cloud Run job procesa con NodeODM y emite GLB a GCS.
- `MeshViewer.tsx` renderiza GLB con react-three-fiber sin lag (60fps target).
- `PhotoScan.tsx` UI flow funciona end-to-end on-device.
- 33 PNG médicos generados y commiteados en `public/icons/biology/`.
- `MedicalIcon` renderiza PNG cuando está disponible, fallback SVG graceful.
- ADR-0005 committed.
- Costo por scan medido y dentro de target ~$0.50–$2.

**Dependencies**: Fase 4 (mobile native para captura), Fase 3 (Cloud Run hardening).

**Riesgos**: 

1. NodeODM AGPL: hay que asegurar binario solo en backend, nunca en cliente. Mitigación: ADR explícito, lint guard.
2. GPU T4 disponibilidad regional limitada. Mitigación: usar us-central1 con fallback us-east1.
3. Captura del usuario puede dar fotos de baja calidad → mesh fallido. Mitigación: tutorial UX in-app + fallback "no se pudo generar mesh" con sugerencia de re-scan.

**TDD entry point**: `src/server/routes/photogrammetry.test.ts` con `it('accepts multipart upload of 30 photos')` falla → crear endpoint → pasa.

---

<a name="fase-10"></a>
## 14. Fase 10 — Sprint 29 · Polish final + GA readiness + post-launch playbook

**Objetivo**: la app está lista para General Availability (GA). Todos los features documentados, todos los runbooks publicados, post-launch playbook con primeros 30 días post-GA mapeados (qué monitorear, qué escalar, qué iterar). Anuncio público preparado.

**Por qué décimo**: GA es el cierre simbólico del master plan. Captura ese momento como un sprint dedicado en lugar de dejarlo como "happens by itself".

**Estimación**: 16h.

**Archivos a tocar/crear**:

- `docs/GA_LAUNCH_PLAN.md` (CREATE) — checklist GA: features done, runbooks published, security cleared, billing tested, mobile shipped, dashboards live.
- `docs/POST_LAUNCH_PLAYBOOK.md` (CREATE) — primeros 30 días post-GA: monitoreo intenso, on-call rotation, hotfix process, customer communication.
- `docs/RELEASE_NOTES_v1.0.md` (CREATE) — release notes públicas v1.0.
- `docs/MARKETING_LAUNCH.md` (CREATE) — handoff a marketing: features destacadas, screenshots, copy ES/PT.
- `README.md` (MODIFY) — actualizar a GA: badges, quickstart, links a docs.
- Cleanup: eliminar archivos obsoletos, consolidar duplicados, refactor que se haya acumulado.

**Tareas concretas**:

- [ ] T-10.1 — (3h) GA checklist completo: features done, tests passing, runbooks published, security cleared, billing tested live, mobile shipped a stores, dashboards live, alerting active. Lo que falte: bloquear GA. Skill: `verification-before-completion`.
- [ ] T-10.2 — (3h) Post-launch playbook: on-call rotation, hotfix process, customer communication template, escalation criteria. Primeros 30 días planificados con cadencia daily standup hasta day 7, weekly hasta day 30. Skill: `writing-plans`.
- [ ] T-10.3 — (2h) Release notes v1.0 publicas: features highlighted, breaking changes vs beta (ninguno esperado), known issues. Skill: `writing-plans`.
- [ ] T-10.4 — (2h) Marketing handoff: copy ES-CL y PT-BR, screenshots clave, video walkthrough demo. Skill: `frontend-design` + `writing-plans`.
- [ ] T-10.5 — (2h) README.md update con quickstart desarrollador, link a docs, badges build/test/coverage/license.
- [ ] T-10.6 — (2h) Cleanup repo: eliminar `proposed-changes/` parent dir si todo aplicado, consolidar runbooks duplicados, archive auditorías viejas.
- [ ] T-10.7 — (2h) Final smoke test on-device + on-web: 8 flows críticos pasan en producción.

**Criterio de éxito**:

- GA checklist 100% completo.
- Post-launch playbook revisado y firmado por usuario.
- Release notes v1.0 published.
- README.md actualizado.
- 8 flows críticos smoke-tested en producción.
- Ningún ticket P0 abierto al momento de GA.

**Dependencies**: todas las fases previas completas.

**Riesgos**: 

1. Algo crítico de fases previas se descubre incompleto en T-10.1. Mitigación: usar TODOs claramente marcados a lo largo del master plan, no dejar deuda silenciosa.

**TDD entry point**: `tests/smoke/ga.spec.ts` con `it('all 8 critical flows pass in production')` falla por algún detalle → fix → pasa.

---

<a name="tareas-cross-cutting"></a>
## 15. Tareas cross-cutting (no encajan en una fase específica)

Estas tareas suceden a lo largo de todas las fases sin "owner" exclusivo:

- **Documentación viva**: cada PR mergeado actualiza al menos un doc en `docs/` (lint custom puede enforcearlo opcionalmente).
- **Conventional commits**: ya en uso (feat/fix/chore/style/refactor/test/perf/docs). Agregar `ci/` y `infra/` para infra-as-code commits.
- **Memory de proyecto**: usuario actualiza `~/.claude/projects/D--Guardian-Praeventio/memory/` cuando aprende algo nuevo. Master plan referencia memorias sin duplicar.
- **Skill routing**: `docs/SKILL_ROUTING_2026-05-04.md` (referido por usuario) define qué skill para qué tarea. Mantener actualizado.
- **GitHub issues**: cada hallazgo del audit que no se ataque inmediatamente queda como issue con label `sprint-N` o `tech-debt`. Issues son la fuente de verdad de pendientes.
- **PR review checklist**: tests pasan, typecheck pasa, lint pasa, a11y check pasa (post-Fase 6), bundle budget pasa (post-Fase 6), no listeners sin filter (post-Fase 7), no PII en track() calls (post-Fase 2), security scan pasa (post-Fase 8).
- **Tono positivo**: en docs, code comments, error messages, notifications. Memoria `feedback_long_processes` + producto memoria `product_organic_structure_2026-05-04` (gamificación positive-only).
- **Constraint duros**: NO Anthropic SDK runtime, NO Stripe, frontend MIT/CC0/CC-BY puro, tests integration con Firestore real, 4 modos UX preservados, paleta teal+petroleum+gold, coral solo alertas, módulos en expansión (medicina/ergonomía/química) intocados, `lime-500` ATTENDANCE intencional, BioRender solo referencia conceptual no copy, Nano Banana para generar originales brand-aligned.

---

<a name="metricas-de-progreso"></a>
## 16. Métricas de progreso end-to-end

Tabla maestra de KPIs que el dashboard debería mostrar de un vistazo:

| Métrica | Hoy (post Sprint 19) | Target Fase final (Sprint 29) |
|---|---|---|
| Coverage de tests (vitest) | ~130 archivos test (estimado 60-65% líneas) | ≥ 85% líneas |
| Coverage de tests E2E (Playwright) | 5 specs (Sprint 19) | ≥ 25 specs cubriendo 8 flows críticos |
| Lighthouse perf score | 0.65 | ≥ 0.85 |
| Lighthouse a11y score | sin baseline público | ≥ 0.95 |
| Lighthouse PWA score | ~90 (estimado) | ≥ 0.90 |
| LCP p75 producción | sin baseline | ≤ 2.5s |
| INP p75 producción | sin baseline | ≤ 200ms |
| CLS producción | sin baseline | ≤ 0.1 |
| Bundle initial minified+gz | <250KB (presupuesto actual) | mantener |
| Type safety (zero `any`) | parcial (algunos `any` en tests) | zero `any` en `src/` excluyendo tests fixtures |
| WCAG 2.2 AA serious/critical | sin auditoría formal | 0 violations |
| Tracking events instrumentados | ~0 | 14 eventos clave + 30+ secundarios |
| Sentry error rate | sin baseline público | < 1% requests |
| Cloud Run cold-start P99 | high (min-instances=0) | low (min-instances=1 horario faena) |
| RPO/RTO documentado | no | sí, validado vía simulacro |
| Pen-test report por 3rd party | no | sí, hallazgos critical/high remediated |
| KMS rotation schedule | manual (in-memory-dev en prod) | mensual automático |
| Mobile native shipped | no (sin android/ios dirs) | sí, Play Internal + TestFlight |
| Brechas estratégicas cerradas | 1 de 4 (D parcial Sprint 18-19) | 4 de 4 |
| Locales i18n cobertos ≥95% | desconocido (no medido) | es-CL, es-AR, pt-BR ≥95%; en/es-MX/es-PE ≥80% |
| Billing producción real | parcial (Webpay sandbox+IPN gaps) | full (Webpay prod + MP IPN + Play RTDN + SII) |
| Audit log retention policy | informal | formal con runbook + Cloud Function scheduled |
| Compliance Ley 19628 | informal | formal con derecho ARCO funcional |
| Cost dashboards Gemini/Maps/etc | no | sí (Fase 2-3) |
| TODO comments en código | múltiples (visible en grep) | ≤ 30, todos con issue link |

---

<a name="apendice-mapping"></a>
## 17. Apéndice — Mapping con audit anterior (auditoria777)

Para cada hallazgo F-XXX del audit Sprint 19, su estado en este master plan:

### Bucket A (cost optimization)

- F-A01: ✅ Ejecutado Sprint 19 (commit 94ebbcd).
- F-A02: ✅ Ejecutado Sprint 19 (commit ecccdc4).
- F-A03: ✅ Ejecutado Sprint 19 (commit b8a7c75).
- F-A04: ✅ Ejecutado Sprint 19 (commit b8a7c75).
- F-A05: ✅ Ejecutado Sprint 19 (commit bbc87f7).
- F-A06–A14: ✅ Ejecutado Sprint 19 (commit bbc87f7).
- F-A15: ⏭ Asignado a Fase 7 (Sprint 26).
- F-A16: ⏭ Asignado a Fase 7 (Sprint 26).
- F-A17: ⏭ Asignado a Fase 7 (Sprint 26).
- F-A18: ⏭ Asignado a Fase 7 (Sprint 26).

### Bucket B (E2E fixtures Sprint 19 — Brecha D)

- F-B01–F-B11: ✅ Ejecutado Sprint 19 (commits a5ecbfd, f87ff20, bbe4d2, 84f474e).

### Bucket C (code review + simplify + UX polish)

- F-C01: ✅ Ejecutado Sprint 19 (commit a6bf214).
- F-C02–C08: ✅ Verificado in-place (PENDING_AFTER_SPRINT_19.md — coherence ya OK).
- F-C09: ✅ Ejecutado Sprint 19 (commit 9cc7435).
- F-C10: ✅ Ejecutado Sprint 19 (commits 3154d88, 86985c1).
- F-C11: ✅ Verificado in-place (writeNode.test.ts líneas 82-110 ya cubren).
- F-C12: ✅ Verificado in-place (climateRiskCoupling sin hot path).
- F-C13: ⏭ Diferido a Sprint 26+ (split IPERCAnalysis 634 LOC) — agendar como issue tech-debt.
- F-C14: ⏭ Diferido a Sprint 26+ (split ISOManagement 773 LOC) — agendar como issue tech-debt.
- F-C15: ⏭ Diferido a polish pass.

### Bucket D (Spec Sprint 20)

- F-D01: ✅ Ejecutado Sprint 19 (commit e190ad8 — `docs/sprints/SPRINT_20_SPEC.md` 1064 líneas).

### Acciones de seguridad post-PR (auditoria777 apéndice final)

- Rotar `GEMINI_API_KEY`: ⏭ acción manual usuario, agendar pre-Fase 3.
- Auditar leaks históricos: ⏭ ejecutar como parte de Fase 8 T-8.8 (security scan).
- Confirmar `E2E_TEST_SECRET` no en prod: ✅ guard verificado en `verifyAuth` (commit 970dc32).
- Monitorear F-A03/A04 cap 48h: ⏭ acción operacional Sprint 20+ (Fase 2 dashboards lo cubren).

---

<a name="apendice-riesgos"></a>
## 18. Apéndice — Riesgos top 5 con mitigación

1. **Quota IndexedDB en mobile (Fase 1)** — modelo 600MB puede no caber. Mitigación: detect runtime + fallback Qwen 0.5B 280MB + persisted storage permission.

2. **Pen-test descubre vulnerabilidad critical (Fase 8)** — un hallazgo serio puede bloquear GA. Mitigación: agendar pen-test temprano en Sprint 27 (no al cierre), buffer 2 semanas remediación pre-Sprint 28-29.

3. **App Store / Play Store rejection (Fase 4)** — primer submission tarda. Mitigación: empezar build pipelines + listings en Sprint 23 inicio, submit a Internal Testing/TestFlight en mid-sprint, buffer 1 semana iteración con review.

4. **SII certificación delay (Fase 5)** — proveedor DTE puede demorar 2-3 semanas en habilitar producción. Mitigación: kick-off SII en Sprint 23 paralelo a Fase 4 mobile, no bloqueante para Sprint 24 si ya certificado.

5. **Performance regressions cumulativas (Fase 6)** — features nuevos (SLM, fotogrametría, mesh viewer) pueden empeorar perf. Mitigación: budgets hard en CI desde Fase 6 que fallan PRs que regresionan.

---

<a name="apendice-glosario"></a>
## 19. Apéndice — Glosario operativo

- **B2D** — Business-to-Developer. Modelo donde Praeventio expone APIs (Climate, Hazmat, Normativa, Suite) a desarrolladores externos en 8 tiers.
- **Brecha A/B/C/D** — Las 4 brechas estratégicas identificadas por usuario (memoria `product_strategic_gaps_2026-05-04`): Capacitor opt-in / SLM offline / Fotogrametría auto / E2E Playwright.
- **DR** — Disaster Recovery. RPO = Recovery Point Objective (cuánta data se puede perder), RTO = Recovery Time Objective (cuánto demora restaurar).
- **DTE** — Documento Tributario Electrónico (Chile). Boleta o factura electrónica obligatoria para CLP via SII.
- **GA** — General Availability. Cierre del MVP avanzado al producto-de-mercado.
- **IPER** — Identificación de Peligros y Evaluación de Riesgos. Formulario core de safety en faenas chilenas.
- **NCh** — Norma Chilena. Estándares técnicos del INN (Instituto Nacional de Normalización) referidos en Zettelkasten v2.
- **Operario en faena** — usuario primario: trabajador de cuadrilla en obra/mina/puerto. Mobile-first, intermitente connectivity.
- **Praeventio** — nombre del producto. "Prevenir" en latín.
- **PWA** — Progressive Web App. La app actual es PWA con Capacitor wrap para mobile.
- **RTDN** — Real-Time Developer Notification (Google Play Billing).
- **SLM** — Small Language Model (Phi-3 Mini, Qwen 2.5, etc). Diferente de LLM grande tipo Gemini Pro.
- **SUSESO** — Superintendencia de Seguridad Social (Chile). Reportes obligatorios via formularios.
- **Vertex AI** — Plataforma Google Cloud para Gemini productivo. NO Anthropic SDK.
- **Zettelkasten v2** — Sistema interno de nodos de conocimiento (192 nodos). NUNCA expuesto externamente.

---

## Cierre

Master plan de 10 fases ejecutables, ≈ 216 horas de esfuerzo, distribuido en 10 sprints. Cada fase tiene archivos identificados, tareas TDD, criterios de éxito medibles, dependencias explícitas, riesgos con mitigación. La estructura sigue el principio "lo que más duele si falla, primero": SLM offline (safety crítico), observability (visibilidad operacional), deployment hardening (resiliencia infra), mobile native (alcance al usuario), billing real (sostenibilidad económica), performance + a11y + i18n (calidad transversal), listeners + cost (eficiencia), security + compliance (defensibilidad), brechas restantes (features puramente nuevas), GA + post-launch (cierre).

El repo demuestra disciplina arquitectónica notable post Sprint 19. Este master plan es el plan de cómo capitalizamos esa disciplina hacia un producto-de-mercado producible, monetizable, escalable. Tono final: hay mucho que ganar. La base está sólida. El trabajo restante es completar superficie y endurecer producción — no apagar incendios.

— Master Plan Agent · 2026-05-04
