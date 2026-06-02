# Auditoría archivo-por-archivo — Índice consolidado

**Fecha:** 2026-06-02 · **Rama:** `claude/technical-debt-review-e2e-87kVX`
**Universo:** 3.545 archivos versionados · **Cobertura mecánica:** 100% (gate `sin-fila=0`)
**Profundidad:** 25 documentos `DEEP-*.md` (18 bloques + 2 infra + 4 needs-human + tests)
**Método:** code-first, evidencia `file:line`, barridos cruzados contra grep directo.

> **Cómo leer esto.** Para cada bloque hay dos apartados: **Lo que YA HACE** (real,
> con evidencia) y **Lo que está PENDIENTE** (deuda, con `file:line`). El detalle
> completo por archivo vive en el `DEEP-<bloque>.md` enlazado y en el ledger
> mecánico (`ledger.json` + `<CATEGORÍA>.md`, una fila por cada uno de los 3.545
> archivos). Es una auditoría **viva** para comparar contra `TODO.md`: algunas
> cosas que los informes antiguos daban como deuda **ya están resueltas**, y este
> barrido lo corrige con el código como verdad.

> **Nada se arregló en esta fase (doc-only).** Todo queda anotado para que el
> usuario decida qué abordar, en qué orden, comparándolo con `TODO.md`.

---

## 0. Resumen ejecutivo

### 0.1 Veredicto global
El producto es **mayoritariamente real y de grado producción**, no humo: SOS,
evacuación con A* real, IPER/REBA/RULA/TMERT/PREXOR puros, HealthVault soberano,
biometría on-device, cifrado SQLite AES-256, **mesh nativo BLE GATT real**,
pasarelas de pago reales (Webpay/MercadoPago/Khipu), IAP con validación server-
to-server, WebAuthn cripto real, circuit-breaker Gemini, marco regulatorio
multi-jurisdicción. **Varios P0 de auditorías de mayo ya están corregidos**
(Stripe removido, KMS prod-gated, replay en aiFeedback, gating e2e, normalización
de planId, i18n 169/170 páginas).

La deuda real se concentra en **(a) un patrón sistémico de auditoría**, **(b)
reglas Firestore puntuales con bugs**, **(c) mucha UI/hooks construidos pero sin
montar**, y **(d) algunos controles de vida a medio cablear**.

### 0.2 🔴 Hallazgo SISTÉMICO #1 — bypass de auditoría client-side
El factory `createProjectScopedStore.save/patch` (`:190-215`) y varios contextos
(`ProjectContext`, `EmergencyContext.triggerEmergency` sobre `emergency_events`,
`UniversalKnowledgeContext`, `FirebaseContext`) escriben **directo a Firestore
client-side sin `auditServerEvent`** (0 refs a `audit_logs` en `contexts/
providers/store`). Lo usan ≥14 stores Sprint-K + páginas (MOC, CPHS, SiteBook,
Stoppage…). Las **rutas server SÍ auditan** (75 routers, 0 `void auditServerEvent`);
el gap es exclusivamente el camino cliente→Firestore. **Posible incumplimiento
Regla #3** para operaciones hechas por UI. → Decisión: emitir audit por trigger
server sobre esas colecciones, o re-cablear la UI a los endpoints auditados.

### 0.3 🔴 Reglas Firestore — bugs verificados (cumplimiento/privacidad)
- **Libro de obras firmado sigue MUTABLE** (`firestore.rules:414,422` chequea
  `signedAt` top-level; la firma escribe `signature.signedAt` anidado →
  `siteBookSigning.ts:247`); el rules-test pasa en **falso verde** sembrando un
  `signedAt` sintético (`projectScopedStores.rules.test.ts:181`). 🛟🔐
- **`health_vault`/`health_vault_shares` sin reglas explícitas** (grep=0) — la
  colección médica más sensible; writes funcionan por Admin SDK pero incumple
  Regla #4 (sin rules-tests/security_spec) y rompe el listado client-side.
- **`comite_actas` sin regla de write** (`ComiteParitario.tsx:73` escribe ahí) →
  default-deny en prod; además duplica el canónico `cphs_meetings`.
- **`site_book_counters` sin regla**; **`documents_for_read`** exige `authorUid`
  que el writer no estampa; **`lone_worker_sessions` update** sin
  `existing().workerUid==auth.uid` (un member muta sesión de otro); **`root_cause_analyses`**
  (`rootCauseStore.ts:20`) no coincide con la regla `root_causes`. (Threads Codex #650.)
- **Modelos laxos** `exceptions`/`legal_obligations`/`shifts` (`:466-477`) sin
  anti-spoof creator-uid (hay `TODO(review dahosandoval@)` en `:463`).
- ✅ **CPHS sí está bien** (pivota sobre `resource.data.signatures.size()`, no
  repite el bug de site_book) — buen patrón de referencia.

### 0.4 🔴/🛟 Controles de vida a medio cablear
- **ManDown no hace push** (`useManDownDetection.ts` escribe Firestore, sin
  `triggerEmergency`/FCM; 0 triggers server sobre `mandown_events`). FallDetection
  sí. → Un trabajador inconsciente no despierta al supervisor con app cerrada.
- **LOTO es read-only** (`loto.ts:55` solo `GET`; aplicar candado / cero-energía /
  liberar no tienen endpoint; `LotoAdapter`/`applyFullRelease` código muerto). El
  control que "previene energización" no está cableado.
- **AlertSchedulerMount** alimentado con `probes={[]}` (`RootLayout.tsx:467`) →
  pipeline predictivo Bernoulli dormido en prod.

### 0.5 🔐 Privacidad puntual
- `Medicine.tsx` cablea componentes de diagnóstico (`MedicalAnalyzer`,
  `DifferentialDiagnosis`, `DrugInteractions`) cuyas acciones Gemini no están
  whitelisted → 403, **y contradicen ADR 0012**.
- `AIPostureAnalysisModal` fallback Gemini Vision **sube la foto del trabajador**.
- Biometría de login (`utils/biometrics.ts`) retorna `true` **sin verificación
  server-side** de firma.
- **External Audit Portal**: endpoints admin sin `assertProjectMember`/`isAdmin`
  → cualquier member del tenant podría emitir tokens de auditor externo (acceso
  cross-proyecto). 🔴 ALTO.
- **`visitors.ts`** sin `assertProjectMember` → escritura de visitas cross-proyecto.
- `culturePulse.respondSurvey` audita `userId` → re-identificación de encuesta "anónima".

### 0.6 🏚️ "Potencia construida sin consumir" (huérfanos)
- **86 UI huérfanas** (48 componentes + 38 hooks, 0 pages sin rutear).
- **`euler/*` ~4.053 LOC 100% huérfano** (mayor código muerto); `eventBus/*` sin
  listeners; cadena RAG-coach huérfana; ~12 `*Backend.ts` sin consumer prod.
- Subsistemas muertos: cost calculator (928 LOC), EPP purchase-order UI, twin
  instanced, AR placement, `ProjectScopedPage` scaffold.
- Bernoulli **NO** es huérfano (montado en `CalculatorHub`). Mesh nativo **SÍ** es
  real. (Ambos corrigen informes previos.)

### 0.7 🔵 Stubs honestos / no-wired / doc-drift
- IoT MQTT: cloud/EMQX `NotImplementedError`; dos MQTT paralelos sin broker;
  comentario "mqtt is NOT a dependency" **falso** (`package.json:151`).
- Adapters SII LibreDTE/OpenFactura/SimpleAPI = `SiiNotImplementedError` (Bsale real).
- SLM offline OFF por defecto; Phi-3/Gemma caen a HuggingFace CDN en runtime.
- COLMAP server-side muerto (infra en repo); `health.ts` aún lo sondea (opcional).
- **Guards #13 (stub) y #17 (allowbackup) NO wired** en husky/CI pese a que
  CLAUDE.md dice "Enforced (PR #514)".
- `firebase-applet-config.json` tracked pese a `.gitignore:13` (config web, riesgo bajo).
- SystemEngineProvider `tenantId` desde `window.__GP_TENANT_ID__||'default'` (spoofable; flag OFF).

### 0.8 Métricas de deuda (verificadas)
`as any` prod 160 (ratchet) · TODO/FIXME 191 · `console.*` en server 20/13 archivos
🔴 · `@ts-ignore` 47 · `Math.random` server 0 ✅ (1 en `incidentRagService.ts:299`
para ID → Regla #15) · tests skip/fixme 20 · cobertura co-located 974/1.794 (54%)
· i18n 169/170 páginas con `useTranslation` ✅.

---

## 1. Resumen por bloque (YA HACE / PENDIENTE)

### B1 — Emergencia & Respuesta 🛟 · [DEEP](./DEEP-B1-Emergencia.md)
- **YA HACE:** SOS (`/api/emergency/sos`, audit+rate-limit+FCM+email fallback),
  evacuación A* real, lone-worker anti-blame + cron reintento, drills, comms,
  zonas restringidas (entrada informada). 4 routers huérfanos ya cableados.
- **PENDIENTE:** 🔴 ManDown sin push; EmergencyOverlay no persiste "a salvo";
  DynamicEvacuationMap usa Gemini no A*; 6 componentes + 6 hooks huérfanos
  (incl. FirstResponderDispatchPanel); E2E SOS en `describe.fixme`.

### B2 — Riesgo & IPER 🛟 · [DEEP](./DEEP-B2-RiesgoIPER.md)
- **YA HACE:** motor IPER puro (10 consumidores), residualRisk persiste+audita,
  routers montados.
- **PENDIENTE:** B2-D1 faltan 3 GET (riskRanking idle stub); B2-D2 `shiftRiskPanel`
  huérfano (superseded por `preShiftRisk`); ~1.760 LOC UI huérfana (riskRanking
  cluster + 8 componentes).

### B3 — Ergonomía & Protocolos 🛟🔐 · [DEEP](./DEEP-B3-Ergonomia.md)
- **YA HACE:** REBA/RULA/TMERT/PREXOR puros, persistencia append-only post-firma,
  pose on-device, trigger legal DS-594.
- **PENDIENTE:** PLAESI ausente en código; AIPostureAnalysisModal fallback Gemini
  sube foto; muñeca fijada 0°.

### B4 — Incidentes 🛟 · [DEEP](./DEEP-B4-Incidentes.md)
- **YA HACE:** árbol de causas (Ishikawa+5Why), incidentFlow audita a root
  `audit_logs`, stoppages con regla, todos verifyAuth+assertProjectMember.
- **PENDIENTE:** 🔴 flujo PDCA no crea edges (grafo ZK desconectado);
  `root_cause_analyses` vs regla `root_causes`; incidents path mismatch;
  `Math.random` en ID.

### B5 — Cumplimiento & SUSESO 🔐 · [DEEP](./DEEP-B5-Cumplimiento.md)
- **YA HACE:** DTE auto-emisión real en webpay/MP (env-gated, vía PSE, nunca push
  a SII); SUSESO end-to-end (folio atómico+WebAuthn+verify público); DIAT/DIEP
  reales; `susesoApiClient` con `getStatus`; marco multi-jurisdicción dinámico.
- **PENDIENTE:** adapters SII salvo Bsale = stub; `mark-paid` no emite;
  `dteIssueQueue` inerte; doble PDF renderer.

### B6 — Capacitación · [DEEP](./DEEP-B6-Capacitacion.md)
- **YA HACE:** WebAuthn register/verify cripto real, microtraining server-side,
  13 engines puros gateados, apprenticeship con transacción.
- **PENDIENTE:** 🔴 gamificación deja auto-otorgar puntos (amount del cliente);
  referee co-sign sin verificación cripto; 7 hooks + 5 componentes huérfanos;
  duplicación pyme; trainingCertificate sobre-afirma cumplimiento legal.

### B7 — Salud ocupacional 🛟🔐 · [DEEP](./DEEP-B7-Salud.md)
- **YA HACE:** HealthVault soberano (Ley 20.584), ADR 0012 enforced (0 funciones
  prohibidas), biometría on-device sin egress, motores de vida (fatiga/circadiano/
  carga mental/higiene) que nunca bloquean.
- **PENDIENTE:** 🔴 `health_vault` sin reglas; Medicine.tsx diagnóstico (403+ADR
  0012); biometría login débil; medical-guard no cubre 2 backends raíz.

### B8 — Permisos & LOTO 🛟 · [DEEP](./DEEP-B8-PermisosLOTO.md)
- **YA HACE:** workPermits (DS132) + engineeringControls persisten+auditan con
  validadores críticos (izaje/excavación/NFPA70E) advisory.
- **PENDIENTE:** 🔴 LOTO read-only (sin aplicar candado); LotoStatusPanel
  huérfano; exceptions laxo; adapters tenant-scoped sin caller.

### B9 — Inspecciones · [DEEP](./DEEP-B9-Inspecciones.md)
- **YA HACE:** offlineInspections (txn+idempotencia), photoEvidence
  (capturedByUid forzado), qrAck (503 honesto+replay), sitebookSign (hash server-side).
- **PENDIENTE:** 🔴 libro de obras firmado mutable + test falso verde; SiteBook
  3 paths disjuntos; `site_book_counters` sin regla.

### B10 — EPP & Activos · [DEEP](./DEEP-B10-EPP.md)
- **YA HACE:** directivas "nunca bloquear"/"no auto-push" cumplidas; pre-uso
  siempre persiste; eppFlow WebAuthn claim-signing.
- **PENDIENTE:** muchas UI admin sin montar; `horometerEngine` con lógica de
  bloqueo contradictoria (consumer huérfano); eppFlow OC en Map volátil; TODO
  revalidación WebAuthn server-side.

### B11 — Contratistas & Visitas · [DEEP](./DEEP-B11-Contratistas.md)
- **YA HACE:** visitas (hostUid del token, txn, audit), vendorOnboarding compute
  puro, DS76 PDF.
- **PENDIENTE:** 🔴 `visitors.ts` sin `assertProjectMember` (cross-proyecto);
  stack de visitas paralelo muerto; `resolveObservation` sin UI; DS76 duplicado.

### B12 — CPHS & Comités 🔐 · [DEEP](./DEEP-B12-CPHS.md)
- **YA HACE:** ✅ inmutabilidad de actas correcta (signatures.size()), quórum ≥6
  DS54, engines compute puro.
- **PENDIENTE:** 🔴 `comite_actas` sin regla (duplica cphs_meetings); 0 rules-tests
  para cphs_*; cphsService client-side sin audit; re-identificación culturePulse.

### B13 — MOC & Ops críticas · [DEEP](./DEEP-B13-MOC.md)
- **YA HACE:** operationalChange persiste+audita con guardrail 100% ack; commute
  es el modelo correcto; 4 suites supertest grandes.
- **PENDIENTE:** 🔴 UI MOC/handover escribe por store cliente (sin audit);
  shiftHandover compute-only + adapter huérfano (#606 no cerrado); ~2.500 LOC UI
  huérfana; changeMgmt redundante.

### B14 — IA / Gemini / SLM 🔐 · [DEEP](./DEEP-B14-IA.md)
- **YA HACE:** whitelist 84 acciones 1:1, circuit-breaker real, aiFeedback replay
  (409)+PII redaction, ADR 0012 OK, orquestador resiliente.
- **PENDIENTE:** SLM offline OFF + Phi-3/Gemma a CDN runtime; dos runtimes SLM;
  onnxAdapter→tinyllama inexistente; orquestador detrás de flag OFF.

### B15 — Facturación & Tier 🔐 · [DEEP](./DEEP-B15-Billing.md)
- **YA HACE:** adapters reales, Stripe removido, IAP valida receipt server-to-
  server, webhooks firmados+replay+audit, normalización planId, upgrade exige pago.
- **PENDIENTE:** 🔴 tier-gating **por-feature solo client-side** (Regla #11 parcial);
  `mark-paid` no activa tier; Khipu sin checkout; Apple SSN leaf-only; FX hardcoded.

### B16 — Offline / PWA / Mesh 🛟🔐 · [DEEP](./DEEP-B16-Offline.md)
- **YA HACE:** cifrado SQLite AES-256 (secure store), mesh nativo BLE GATT real,
  service worker VitePWA, OfflineSyncManager (conflict per-field+LWW+audit).
- **PENDIENTE:** 🔴 `conflict_queue` código muerto sin reglas; `encryptData`=base64
  en web; mesh `signature:'unsigned-dev'`; useSyncStatus/SyncQueueBadge huérfanos.

### B17 — Admin / Auth / RBAC 🔐 · [DEEP](./DEEP-B17-Admin.md)
- **YA HACE:** default-deny, audit_logs append-only, `isSupervisorOfTenant`
  tenant-scoped, WebAuthn cripto+anti-clon, TOTP/OAuth-CSRF, admin RBAC server-side.
- **PENDIENTE:** 🔴 External Audit Portal sin gate de rol (ALTO); 4 bugs de reglas
  (#650); OAuth refresh_token plaintext por defecto; referee co-sign sin cripto;
  admin.ts audit sin try/catch (#14).

### B18 — Analítica / Reportes · [DEEP](./DEEP-B18-Analitica.md)
- **YA HACE:** aggregateTelemetry sin PII (whitelist), dataConfidence anti-inyección,
  compute puro, dashboards reales (Recharts+PDF).
- **PENDIENTE:** AlertSchedulerMount con probes vacíos (predictivo dormido);
  ~16 componentes/hooks huérfanos; `assertNoPII` muerto; projectComparator duplicado.

---

## 2. Infraestructura · [I-CORE/I18N/DATA](./DEEP-INFRA-CORE.md) · [I-PLAT/BUILD/ASSETS](./DEEP-INFRA-PLAT.md)
- **YA HACE:** i18n parity GREEN (es=en=2290), corpus normativo real (7 países+ISO),
  KMS prod cloud-kms-only, Stryker bloqueante en CI, allowBackup=false, Dockerfiles
  endurecidos, certificados DS/SUSESO jsPDF reales.
- **PENDIENTE:** patrón audit-bypass (§0.2); guards #13/#17 no-wired; SystemEngine
  tenantId spoofable; firebase-applet-config tracked; doc-drift `ds-40`; deep-link
  domain inconsistency (`praeventio.app` vs `.net`).

## 3. needs-human (730 sin bloque) · [knowledge](./DEEP-NH-services-knowledge.md) · [twin/infra](./DEEP-NH-services-infra.md) · [server](./DEEP-NH-server.md) · [UI](./DEEP-NH-ui.md)
- Servicios: Zettelkasten dual-write síncrono (no 3 fuentes); DigitalTwin on-device
  real (MiDaS ONNX); privacy/security producción; External APIs reales. Huérfanos:
  euler 4.053 LOC, eventBus, RAG-coach, IoT MQTT. Sugerencia: crear bloque
  **B-DigitalTwin** (~25 archivos).
- Server: mount 60/60, audit invariant OK, KMS preflight; huérfanos menores
  (consistency cron, materializer flag, consolidate one-shot).
- UI: 86 huérfanos (48 comp + 38 hooks), 0 pages sin rutear, 38 cross-cutting.

## 4. Tests · [mapa](./DEEP-TESTS-map.md)
1.247 tests (1.029 co-located + 154 server supertest + 13 e2e + rules/smoke);
cobertura co-located 54%; 20 skip/fixme a reconciliar. Gaps sensibles:
kmsAdapter, onDeviceReconstruction, privacy/regimes, cphs_* rules-tests.

---

## 5. Decisiones pendientes para el usuario (❓/⚠️ — no asumidas)
1. Patrón audit-bypass (§0.2): ¿trigger server o re-cablear UI a endpoints auditados?
2. Modelos laxos `exceptions`/`legal_obligations`/`shifts` (sin creator-uid): ¿endurecer?
3. ⚠️ `useBinanceIntegration` eliminado — ¿descarte intencional?
4. Doble-MQTT, doble-DS76, doble PDF SUSESO, `changeMgmt` vs `operationalChange`: ¿consolidar/deprecar?
5. ¿Crear bloque B-DigitalTwin? ¿Borrar/documentar euler, COLMAP infra, AR sin caller?
6. ¿Montar o borrar las 86 UI huérfanas (cost calculator, EPP PO, etc.)?
7. Verificación por emulador/CI de las reglas Firestore (no corre en este entorno).

---

## 6. Artefactos del barrido
- `scripts/audit-coverage-census.cjs` — gate de totalidad (`sin-mapear=0`).
- `scripts/audit-file-ledger.cjs` + `ledger.json` + `<CATEGORÍA>.md` — ficha por archivo (3.545).
- `scripts/audit-test-coverage-map.cjs` + `DEEP-TESTS-map.md` — mapa de tests.
- 25× `DEEP-*.md` — revisión profunda por bloque/infra/needs-human.
- `CONTEXT_AUDIT_2026-06.md` — informe narrativo de contexto.

*Todo doc-only. Comparar contra `TODO.md` y priorizar (vida/privacidad primero)
es la Fase 3; la incorporación de huérfanos es la Fase 4 — ambas con tu visto bueno.*
