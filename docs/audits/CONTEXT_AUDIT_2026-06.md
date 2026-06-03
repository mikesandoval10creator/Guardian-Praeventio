# Informe de Auditoría de Contexto — Praeventio Guard

**Fecha:** 2026-06-02 · **Rama:** `claude/technical-debt-review-e2e-87kVX`
**Universo medido:** `git ls-files` = **3.545 archivos** versionados.
**Gate de totalidad:** ✅ `sin-mapear = 0` (`node scripts/audit-coverage-census.cjs`).
**Método:** code-first (el código es la verdad), evidencia `file:line`, 4 barridos
profundos en paralelo + escaneos de métricas + barrido de primera mano `TODO.md §17`.

> **Qué es este documento.** Un informe de contexto **detallado** que describe
> qué hace la aplicación, dónde vive cada parte, su estado real (con endpoints,
> patrones y evidencia `file:line`), cubriendo la **totalidad** del código. No es
> un barrido general. Sirve para: (1) que ambos estemos al tanto de lo que
> existe; (2) **no asumir** (puedes corregir donde algo no te parezca); (3)
> compararlo con `TODO.md` y luego decidir la deuda técnica y la incorporación de
> lo que falte.

> **Misión que enmarca el rigor.** Praeventio Guard protege y **salva la vida**
> de trabajadores en industrias críticas de LATAM, **respetando la privacidad**
> (Ley 19.628, biometría 100% on-device, trazas auditables e inmutables, ADR 0012
> no-diagnóstico). El informe **prioriza primero lo más importante**: funciones de
> vida y datos sensibles.

---

## Índice

1. [Objetivo](#1-objetivo)
2. [Alcance y Libro de Cobertura](#2-alcance-y-libro-de-cobertura)
3. [Metodología y medidas de control](#3-metodología-y-medidas-de-control)
4. [Patrones de seguridad transversales](#4-patrones-de-seguridad-transversales)
5. [Mapa funcional detallado por bloque](#5-mapa-funcional-detallado-por-bloque)
6. [Deuda silenciosa transversal (métricas verificadas)](#6-deuda-silenciosa-transversal-métricas-verificadas)
7. [Matriz de promesas vs realidad (actualizada a hoy)](#7-matriz-de-promesas-vs-realidad-actualizada-a-hoy)
8. [Hallazgos abiertos y correcciones a docs previas](#8-hallazgos-abiertos-y-correcciones-a-docs-previas)
9. [Oportunidades cross-cutting (alta palanca)](#9-oportunidades-cross-cutting-alta-palanca)
10. [Planificación por criticidad (vida/privacidad primero)](#10-planificación-por-criticidad-vidaprivacidad-primero)
11. [Apéndices](#11-apéndices)

---

## 1. Objetivo

Ver **qué hace la aplicación** en su totalidad antes de tocar nada, dada la
magnitud (3.545 archivos; ~3.053 en `src/`). El informe es el **entregable
primario**; la incorporación de huérfanos y la remediación de deuda son **fases
posteriores** planificadas a partir de aquí, con visto bueno del usuario.

**Secuencia macro:** (1) **informe de contexto** ← *este documento* → (2)
comparación con `TODO.md` (§7-8) → (3) plan de deuda (§10) → (4) incorporación
bloque por bloque (posterior, con aprobación).

---

## 2. Alcance y Libro de Cobertura

**Incluye** la totalidad de archivos versionados; cada uno se asigna a **una**
categoría, gate **`sin-mapear = 0`**. **No incluye** (esta fase): no modifica
código de producto (doc-only; único archivo de soporte
`scripts/audit-coverage-census.cjs`); no incorpora huérfanos ni crea menús (F4);
no corrige rules ni resuelve hallazgos (F3); **no descarta nada** (⚠️/❓ se
consultan).

**Distribución verificada** (`total tracked files: 3545 · UNMAPPED: 0 · gate PASS`):

| Categoría | Archivos | Qué agrupa |
|---|---:|---|
| I-TEST | 1.246 | Vitest/Playwright/rules/smoke/loadtest, `firestore.test.rules` |
| FEAT-services | 692 | `src/services/**` — engines puros + clientes de dominio |
| FEAT-components | 424 | `src/components/**` — UI compartida |
| FEAT-server | 243 | `src/server/**` + `server.ts` |
| FEAT-hooks | 206 | `src/hooks/**` |
| I-DOCS | 184 | `docs/**`, `*.md`, `tasks/`, `templates/`, `LICENSE` |
| FEAT-pages | 170 | `src/pages/**` |
| I-BUILD | 131 | configs raíz, `scripts/`, `.github/`, `.husky/`, `infra*/`, Docker, rules |
| I-ASSETS | 77 | `public/**`, `marketplace/`, `index.html` |
| I-PLAT | 72 | `android/`, `ios/`, `fastlane/`, `packages/capacitor-mesh/`, `src/workers/` |
| I-CORE | 53 | `contexts/`, `store/`, `providers/`, `lib/`, `utils/`, `types/` |
| I-DATA | 18 | `src/data/**` — corpus normativo (RAG) |
| I-I18N | 18 | `src/i18n/**` — 16 locales |
| FEAT-routes | 7 | `src/routes/**` — route-groups React Router 7 |
| **TOTAL** | **3.545** | **mapped = total → gate PASS** |

**Distribución por bloque funcional** (best-effort, apoyo a la revisión): B14 IA
107 · B1 Emergencia 103 · B7 Salud 99 · B5 Cumplimiento 95 · B18 Analítica 80 ·
B6 Capacitación 73 · B9 Inspecciones 66 · B4 Incidentes 55 · B10 EPP 49 · B2
Riesgo 48 · B8 Permisos/LOTO 43 · B15 Facturación 41 · B17 Admin 38 · B13 MOC 34
· B12 CPHS 28 · B16 Offline 24 · B3 Ergonomía 19 · B11 Contratistas 15 ·
**B?-needs-human 725** · TOTAL feature 1.742.

> El residual `B?-needs-human` (41%) son servicios de infra de dominio
> (adaptadores, sync, observabilidad, zettelkasten) cuya pertenencia a un bloque
> es ambigua por nombre. El gate de totalidad es a nivel de categoría; la
> asignación por bloque es apoyo, no verdad mecánica.

---

## 3. Metodología y medidas de control

**Principio rector:** *code-first, sin asumir.* Toda afirmación con `file:line`
real (Regla #1: nada ✅ sin referencia). **Si doc y código discrepan, el código
manda** — este informe corrige varias docs obsoletas (§8).

**Control de calidad de este informe:** lancé **4 barridos profundos en paralelo**
(vida crítica / cumplimiento+admin+rules / IA+negocio+operación / deuda silenciosa
+ infra) y **crucé sus hallazgos contra el código** — donde un barrido afirmó algo
no confirmado por grep directo, prevaleció el grep (p.ej. corregí "0 `console.*`
en server" → en realidad **20 en 13 archivos**; "14 colecciones sin reglas de
write" → en realidad **ya tienen reglas**, `firestore.rules:388-477`).

**Medidas de control:** (1) **gate mecánico** `sin-mapear=0` (exit≠0 en CI); (2)
**trazabilidad** a `TODO.md §X`/commit/PR; (3) **no-asumir + checkpoints** por
tandas (vida/privacidad primero); (4) **foco vida/privacidad** marcado por ficha;
(5) síntesis de `TODO.md §17` + triages sin contradecirlos.

**Leyenda:** ✅ Real e2e · 🟡 Parcial · 🏚️ Sin hogar de frontend (backend listo,
sin UI) · 🔌 Backend-only por diseño · 🔵 Stub honesto (503/flag) · 🔑 Bloqueado
por secret/cuenta · ❓ Decisión del usuario · ⚠️ Posible descarte a confirmar.
**Marcadores:** 🛟 seguridad de vida · 🔐 datos sensibles/PII/biometría.

---

## 4. Patrones de seguridad transversales

Verificados de forma repetida en todos los routers; son el "ADN" de seguridad:

- **Identidad estampada server-side, nunca del cliente.** El `uid` del actor se
  fuerza desde el token verificado: SOS `emergency.ts:211-212`, lone-worker
  `loneWorker.ts:124-128` (anti-blame: un trabajador solo puede hacer su propio
  check-in), evacuación `evacuation.ts:133` (`scannedByUid` forzado),
  mental-load `mentalLoad.ts:89`, visitas `visitors.ts:16-20` (`hostUid`),
  photo-evidence `photoEvidence.ts:110` (`capturedByUid`).
- **Cadena de middleware:** `verifyAuth` → `idempotencyKey()` (en mutaciones) →
  `validate(zodSchema)` → handler → `captureRouteError` (Sentry) →
  `auditServerEvent` (en operaciones críticas).
- **Tenancy:** `tenants/{tid}/projects/{pid}/…`; cross-tenant vía
  `collectionGroup(...)` filtrado por `tenantId`. `assertProjectMember(uid,pid,db)`
  antes de todo write.
- **Auditoría append-only:** `audit_logs` con `create: server-only, update:false,
  delete:false` (`firestore.rules:558-569`). Las llamadas se `await`ean (Regla #14).
- **Idempotencia:** transacciones `get()+update()` atómicas + 3-way idempotence
  (visitas `visitors.ts:202-216`, inspecciones `offlineInspections.ts:311-332`).
- **Rate-limiting:** `sosLimiter` (`emergency.ts:200`), `geminiLimiter`
  (30/15min), `aiFeedbackLimiter`, `verifySchedulerToken` en crons.
- **Directiva "nunca bloquear maquinaria":** salud/fatiga/horómetro/EPP devuelven
  *recomendaciones/flags*, jamás bloqueo automático (ver B7, B8, B10).
- **Directiva "no auto-push":** EPP/hazmat/DTE generan documento; la empresa lo
  entrega al proveedor/SUSESO/SII — Praeventio nunca empuja (header
  `X-Praeventio-Pushed-To-Supplier=false`, `eppFlow.ts:561`).

---

## 5. Mapa funcional detallado por bloque

> Cada ficha: **propósito · endpoints/superficie (file:line) · persistencia/
> auditoría · patrón · estado · vida/privacidad · deferido**. Orden por criticidad.

### 🛟 Tanda A — Vida y seguridad crítica

#### B1 — Emergencia & Respuesta · ✅ REAL (production-grade) · 🛟

**Propósito:** salvar vidas: SOS, evacuación, headcount, lone-worker, fall/ManDown,
refugios, zonas restringidas, brigada, drills, comms, contingencia, first-responder.

**Endpoints reales:**
- **SOS** — `POST /api/emergency/sos` (`emergency.ts:211`, montado `server.ts:940`).
  `verifyAuth` + `sosLimiter` (10/min, `:200`) + Zod `sosSchema`. Escribe
  `tenants/{tid}/emergency_alerts/{id}` (`:216-227`) + **siempre** `audit_logs`
  (`:258-260`). Fan-out a supervisores (`sendToProjectSupervisors :277-310`):
  lookup cross-collection de tokens (`users/{uid}/fcmTokens` + fallback legacy
  `members/{uid}.fcmToken`) con cache 5-min; **FCM multicast** y **fallback email**
  si push falla (`:306-354`). `uid` forzado server-side (`:211-212`).
- **Brigada** — `POST /api/emergency/notify-brigada` (`emergency.ts:412`):
  supervisor activa; 12 tipos (fall/sos/medical/fire/gas/collapse/tsunami/flood/
  earthquake/volcanic/storm/other); escribe `brigada_activations` + audita;
  `supervisorUid` forzado (`:421`). *(Corrige el bug histórico H7 de `notify-brigada`
  inline en server.ts — migrado, ver `server.ts:1327-1333`.)*
- **Evacuación (stateless compute)** — `POST /:projectId/evacuation/{compute-status,
  record-scan,end-drill,build-postmortem}` (`evacuation.ts:87,121,153,181`).
  `verifyAuth` + `assertProjectMember`. **Sin writes** (el cliente persiste); evita
  carreras en evacuaciones concurrentes. `scannedByUid` forzado (`:133`).
- **Lone-worker** — `POST /:projectId/lone-worker/{check-in,end-session,
  derive-status,decide-escalation,admin-overview}` (`loneWorker.ts:111,158,193,218,
  255`). **Anti-blame** (`:124-128`); check-in **siempre** auditado, en especial
  `status:'help'` (`:134-139`). Escalación pura determinista.
- **Comms** — `POST /:projectId/comms/{best-channel-for-zone,detect-dead-zones,
  compute-escalation,build-contactability-report,plan-channel-failover}`
  (`comms.ts:102…232`). Compute puro; canales: radio UHF/VHF, cel, satélite, push,
  whatsapp, face-to-face.
- **Drills** — `GET /:projectId/drills`, `POST /:projectId/drills/plan|:id/execute`
  (`drillsManager.ts:142,236,297`). Plan persiste + audita (`drill.planned`);
  ejecución = scoring determinista (`participationRate`, `speedDeficitPercent`,
  `level`) + audita (`drill.executed`).
- **Zonas restringidas** — `restrictedZones.ts` (506 LOC). **Nunca bloquea
  maquinaria** (Directiva #1): marca para *acknowledgement* + logging (entrada
  informada). Tipos: hot/confined/atex/lifting/high_voltage/biohazard/…
- **First-responder** — `build-dispatch-plan`, `analyze-coverage` (compute puro).

**Cliente:** `SOSButton.tsx:46-230` — long-press 3s (`HOLD_MS=3000`), geoloc alta
precisión, **fallback `tel:` deeplink** si falla la red, `aria-label` + touch
target 96×96px.

**Estado:** ✅. El barrido B1 (`TODO.md §17`) cableó **4 routers huérfanos**
(loneWorker, refuges 169 LOC, restrictedZones 506 LOC, evacuationHeadcount) que
daban **404** — resueltos con TDD (`serverMountOrder.test.ts`).
**Vida/Privacidad:** 🛟 máxima. **Deferido:** B1-D2 verificar lone-worker nativo
(FGS Android); B1-D3 specs E2E `sos-button` en `describe.fixme`.

#### B7 — Salud ocupacional & Vigilancia · ✅ REAL + ADR 0012 enforced · 🛟🔐

**Propósito:** vigilancia ocupacional **sin diagnóstico clínico**.

**ADR 0012:** grep de funciones prohibidas (`inferDiagnosis`/`assessClinicalRisk`/
`suggestTreatment`) → **0 hits** en `src/`. Cada router lo declara: fatiga
`fatigue.ts:19`, carga mental `mentalLoad.ts:14`, retorno al trabajo
`returnToWork.ts:19` ("opera con `restrictionTags` operacionales, NUNCA con
diagnóstico/PHI"), catálogos `medicalCatalogs.ts:14-15` ("sin LLM, no reemplaza
juicio médico").

**Endpoints destacados:**
- **HealthVault (Ley 20.584 — el trabajador es dueño de su dato)** —
  `services/health/vaultShare.ts` (257 LOC): tokens de compartición **temporales**
  (no permisos por rol). Secreto **nunca persistido**, solo SHA-256
  (`:80-83`); verificación con `timingSafeEqual` (`:85-88`); TTL 24h, 5 consumos
  máx; cada consumo audita viewer + `ipHash` (`:228-256`); revocación inmediata.
- **Fatiga** — `POST /:projectId/fatigue/assess` (`fatigue.ts:64`): umbrales
  DS594 Art.102 (>12h) y Código del Trabajo Art.38 (<11h descanso); devuelve
  `shouldRestrictCritical` (flag para supervisor, **no bloqueo**, `:19`).
- **Carga mental NASA-TLX** — `score-survey`, `build-admin-burden`
  (`mentalLoad.ts:79,115`); `workerUid` forzado (`:89`).
- **Circadiano** — `classify-window`, `assess-alertness`, `recommend-shift-rotation`
  (`circadian.ts:70,101,132`). Solo soporte a decisión.
- **Higiene (Mifflin-St Jeor)** — `bmr`, `current-burn` (`hygiene.ts:66,95`);
  **rechaza datos incompletos** (devuelve `null`, no inventa, `:15-16`).
- **Catálogos médicos** — ICD-10/DS109, ATC/DrugBank, anatomía
  (`medicalCatalogs.ts`, 6 endpoints): lookup read-only, **sin LLM**.
- **Retorno al trabajo** — `assess-task-fit`, `decide-derivation`, `build-plan`
  (`returnToWork.ts:150,190,223`): 23 `restrictionTags` operacionales; el
  diagnóstico/PHI se mapea a tags en la mutual (externamente).

**Biometría on-device (Regla #12):** `services/health/healthFacadeNative.ts`
(HealthKit iOS / Health Connect Android); en web devuelve arrays vacíos; **cero
egress al servidor** de telemetría de salud.

**Estado:** ✅ sin huérfanos. **Vida/Privacidad:** 🛟🔐 crítico en ambas.

#### B16 — Offline / PWA / Capacitor / Mesh / Sensores · ✅ REAL (móvil pre-release) · 🛟🔐

- **Cifrado SQLite (Regla #16):** `utils/sqliteEncryption.ts` (77 LOC) — SQLCipher
  AES-256, passphrase 256-bit (`getRandomValues(32)`, `:40-46`), persistida en
  **secure store nativo** (Keychain/Keystore, no SharedPreferences),
  inicialización idempotente `ensureSqliteEncryptionSecret` (`:64-76`) con guard
  `isSecretStored()` (`:67-68`). Migración: bases sin cifrar no se reabren →
  base instalada de producción = 0 (móvil pre-release).
- **Mesh relay (ADR 0013 store-carry-forward):** `services/mesh/meshRelayQueue.ts`
  (dedup TTL 6h, prioridad SOS, anti-loop `relayedBy[]`, hook `onRelaySuccess`
  para gamificación) + `transportFacade.ts` (abstracción BLE/WiFi, reconciliación
  30s, snapshot de peers/queue). **Cola en memoria** (no persistida).
- **Sync / syncStatus:** router `syncStatus` cableado tras barrido (B16-F1).
- **Plugin nativo:** `packages/capacitor-mesh` — **web simulator funciona (~240
  LOC); nativo Kotlin/Swift son STUBS** que loggean + emiten eventos fake
  (`MeshPlugin.kt:552`, `Plugin.swift:350`; `docs/stubs-inventory.md:69-75`). 🔑
  pendiente BLE GATT/CoreBluetooth real (Sprint 31/32).

**Vida/Privacidad:** 🛟 (sostiene SOS/evacuación sin red) · 🔐 (cifrado at-rest).

#### B2 — Riesgo & IPER · ✅ REAL · 🛟

**Propósito:** IPER, mapa de calor, ranking, residual, bowtie, JSA, controles
críticos, riesgo de turno, madurez.
**Superficie:** motor `services/protocols/iper.ts` (135 LOC, puro, unit+mutation);
routers `riskRadar/residualRisk/maturity/bowtie/jsa/criticalControls/raciMatrix/
preShiftRisk` montados (`server.ts:961-964`); route-group `RiskRoutes.tsx`.
`riskRanking`/`shiftRiskPanel` cableados tras barrido (B2-F1).
**Deferido:** **B2-D1** faltan 3 GET (`risk-ranking/timeseries|top-risks|
weak-controls`) — los hooks devuelven idle (stub honesto, `useRiskRanking.ts:135-172`);
**B2-D2** `useShiftRiskPanel` 🏚️ sin consumidor UI → **❓ dónde vive la vista**.

#### B3 — Ergonomía & Protocolos MINSAL · ✅ REAL · 🛟🔐

**Motores puros:** `ergonomics/reba.ts` (378 LOC), `rula.ts` (284),
`protocols/tmert.ts` (106), `prexor.ts` (128) — unit+mutation-tested.
**Persistencia:** client-side en `services/safety/ergonomicAssessments.ts`
(`setDoc` + `logAuditAction`, append-only tras firma); reglas
`ergonomic_assessments` (`firestore.rules:698-715`): `delete:false` (Ley 16.744
Art.76 + ISO 45001 §7.5.3), inmutable post-firma. `iper_assessments`
(`:720-742`): probability/severity ∈ [1-5], whitelist de campos editables.
**On-device:** 0 subidas de frame de cámara (Regla #12).
**Deferido:** **B3-D1 — PLAESI** en `CLAUDE.md` pero **ausente en `src/`** (0
refs) → ⚠️ doc-vs-code. **AIPostureAnalysisModal:** verificar si ya usa MediaPipe
local (deuda histórica era Gemini-vision).

### 🔐 Tanda B — Privacidad, cumplimiento e integridad

#### B17 — Admin / Multi-tenant / Auth / RBAC / Audit / Privacidad · ✅ REAL · 🔐

**`firestore.rules` (1.182 LOC):** default-deny `match /{document=**} {allow read,
write: if false}` (`:17-19`). Roles: `isAdmin()` (token+doc, `:36-43`),
`isSupervisor()` **global** (`:45-50`), `isSupervisorOfTenant()` per-tenant
(`:84-109`, fix 2026-05-15 que cierra escalada horizontal). Master-gate
`match /{subCollection=**}/{docId}` **read-only** para project-members (`:258-260`).

**🟢 CORRECCIÓN CRÍTICA (resuelto en esta rama):** las **14 colecciones Sprint-K**
client-SDK **ahora tienen reglas de write explícitas** (`:366-477`) — antes el
default-deny bloqueaba los writes en producción. Modelo por colección:

| Colección | create | update | delete | Líneas |
|---|---|---|---|---|
| stoppages | member + `declaredByUid==auth.uid` | `declaredByUid` inmutable | false | 388-394 |
| operational_changes | member, `declaredByUid` inmutable | idem | false | 395-401 |
| root_causes | member, `analyzedByUid` inmutable | idem | false | 402-408 |
| site_book | member | append-only post-firma | false | 410-417 |
| site_book_entries | member, `recordedByUid` inmutable | idem | false | 418-425 |
| lone_worker_sessions | `workerUid==auth.uid` | `workerUid` inmutable | admin/sup | 428-434 |
| lone_worker_events | `workerUid==auth.uid` | inmutable | admin/sup | 435-441 |
| safety_talks_given | `givenByUid==auth.uid` | inmutable | admin/sup | 442-448 |
| audit_portals | `createdByUid==auth.uid` | inmutable | admin/sup | 449-455 |
| documents_for_read | `authorUid==auth.uid` | inmutable | admin/sup | 456-462 |
| **exceptions** | member (**sin creator-uid**) | member | admin/sup | 466-469 |
| **legal_obligations** | member (**sin creator-uid**) | member | admin/sup | 470-473 |
| **shifts** | member (**sin creator-uid**) | member | admin/sup | 474-477 |

> **Para tu revisión (❓):** `exceptions`/`legal_obligations`/`shifts` permiten
> create/update a cualquier project-member **sin anti-spoof de creator-uid** (no
> tienen ese campo). Verificación final por **emulador/CI** (no corre en este
> entorno). Rules-tests parametrizados en `src/rules-tests/projectScopedStores.rules.test.ts`.

**Otras colecciones críticas:** `audit_logs` append-only (`:558-569`);
`suseso_forms` inmutable post-creación, firma vía Admin SDK (`:989-1003`);
`cphs_committees` (≥6 miembros, `:1117-1133`), `cphs_meetings` (signed records
append-only, `:1135-1180`).
**Huérfanos cableados:** `pymeOnboarding`, `pymeWizard` (B17-F1).
**Deuda residual (threads Codex #650):** 5 reglas con bugs (lone-worker ownership,
libro de obras firmado editable, `site_book_counters` faltante,
`documents_for_read`/`audit_portals` desalineados) — **P1**. (7 threads de authz
ya fijos por #651/#652.)

#### B5 — Cumplimiento & SUSESO · ✅ REAL · 🔐

**DTE (decisión, nunca push directo a SII):** `services/dte/dteAutoIssueOrchestrator.ts`
(277 LOC, motor puro idempotente). `decideDteIssue()` (`:198-276`): dedup por
paymentId → `already_issued`; gateway webpay/mercadopago soportado, `manual` no
(`:209-216`); clasifica RUT (`classifyChileanTaxId :141-156`) → boleta/factura;
idempotency = sha256(paymentId|tenantId) (`:169-177`). **Directiva (`:8-13`):
Praeventio NUNCA hace push a SII; emisión real vía PSE intermediario.**
**Generación DTE con WebAuthn:** `POST /api/dte/generate` (`dte.ts`, requireAdmin
`:83-101`): genera XML + PDF firmado localmente; **no push a SII**. `BsaleAdapter`
503 si falta `BSALE_ACCESS_TOKEN`/`OFFICE_ID` (`:105-114`).
**Adapters SII:** `libredteAdapter.ts` (25 LOC) — `emitDte`/`getDteStatus` lanzan
`SiiNotImplementedError` (`:18-23`) → 🔵 **stub honesto**. OpenFactura/SimpleAPI
similares (plan K1).
**SUSESO:** `services/sii/susesoApiClient.ts` — **server-only** (warning "NO
importar desde browser", `:1-10`; `fromEnv()` devuelve `null` sin env, `:148-150`).
Payloads DIAT/DIEP/ROI. **🔴 B5-D1:** **sin métodos de lectura de estado** post-
envío (fire-and-forget; sin retry/webhook ni persistencia de receipt SUSESO).
**Otros:** routers `compliance(×3)`, `complianceEmit`, `regulatoryFramework`,
`industryRules`, `nonConformity`, `privacyRetention`; `legalObligations` cableado
(B5-F1). DIAT/DIEP: PDF + folio atómico + firma + verify público (Sprint 28 B6).
Marco multi-jurisdicción ADR 0014.

#### B4 — Incidentes & Investigación · ✅ REAL · 🛟

Routers `rootCause/incidentTrends/incidentBundle/lessonsLearned/correctiveActions`
montados; `incidentFlow` y `stoppage` cableados (B4-F1).
**`incidentFlow` audita a root `audit_logs`** (`incidentFlow.ts:115` — corrige
hallazgo STALE que lo daba tenant-scoped). **`stoppage` stateless** de transición.
**🟢 B4-D1 (antes 🔴, ahora resuelto en esta rama):** `stoppages` ya tiene regla
de write (`firestore.rules:388-394`); persiste con `declaredByUid==auth.uid`,
inmutable, `delete:false`. Pendiente verificación emulador/CI.

### ⚙️ Tanda C — Operación y soporte

#### B6 — Capacitación & Currículum · ✅ REAL
9 routers (`curriculum`, `safetyTalks`, `microtraining`, `postTraining`,
`spacedRepetition`, `skillGap`, `returnToWork`, `apprenticeship`, `adoption`).
**WebAuthn register/verify** vive en `curriculum.ts` (`/api/auth/webauthn/register/
options|verify`). Páginas Training/Onboarding/PortableCurriculum/LessonsLearned +
gamificación (ArcadeGames/ClawMachine). B6-D1 cerrado (audit 1:1).

#### B8 — Permisos de trabajo & LOTO · ✅ REAL · 🛟
Routers `workPermits` (DS132, audit=4), `loto`, `criticalControls`,
`engineeringControls`, `softBlocking`, `exceptions`. B8-D1 cerrado (el "write"
sospechoso era `createHash('sha256')`, no Firestore). 🛟 LOTO previene energización.

#### B9 — Inspecciones, Checklists & Observaciones · ✅ REAL
- **offlineInspections** (`offlineInspections.ts`, 495 LOC): list (con index
  fallback `:153-192`), start (idempotente), observations (**transacción** +
  3-way idempotence `:311-332`), complete. Storage
  `tenants/{tid}/projects/{pid}/inspections/{id}`.
- **photoEvidence** (223 LOC): artifacts con `contentHash`, linkages a
  incident/inspection/audit/finding/work_permit/training/corrective;
  `capturedByUid` forzado (`:110`).
- `checklistBuilder`, `formBuilderAdvanced`, `bbs`, `qrSignature`, `qrAck` (503
  honesto `qr_ack_not_configured` si falta `QR_ACK_HMAC_SECRET` → 🔑), `sitebook`
  + `sitebookSign` (WebAuthn).

#### B10 — EPP, Activos & Mantenimiento · ✅ REAL
- **eppFlow** (581 LOC): inspection/pending-orders/sign-order/order-pdf. **No
  auto-push** (`X-Praeventio-Pushed-To-Supplier=false :561`); WebAuthn
  'claim-signing' con `challengeId` — **TODO revalidación server-side de firma
  (`:22`)** (deuda real). Server-writer Admin-SDK (`makeServerWriteNodes`, Codex P1).
- **equipmentQr** (474 LOC): register/list/preuse/history. **Nunca bloquea**: el
  pre-use **siempre persiste** (`:370`); el cambio de estado es recomendación.
- **horometro** (432 LOC): reading/maintenance-tasks/complete. **Nunca bloquea**:
  crea task `status=open`, no marca `fuera_servicio` (`:13-18`).
- **hazmatInventory** (377 LOC): substance CRUD + compatibility-check + spill-plan;
  compute puro, **no auto-push** a SUSESO/MINSAL. `signaletics`, `maintenance`,
  `equipment` montados.

#### B11 — Contratistas, Visitas & Acreditación · ✅ REAL
- **visitors** (348 LOC): check-in/check-out (**transacción** `:202-216`)/
  acknowledge-induction/list; `hostUid` del token (`:16-20`).
- **vendorOnboarding** (301 LOC): evaluate-stage/missing-mandatory/build-client-
  bundle/accreditation summarize+should-escalate (compute puro). `resolveObservation`
  (`vendorAccreditationTracker.ts:147`) 🏚️ API sin UI consumer.
- `consultativeSale`, `geofencePermissions` (decide-ux; nunca bloquea maquinaria).

#### B12 — CPHS & Comités · ✅ REAL · 🔐
Routers `cphsMinute`, `organic`, `culturePulse`, `agenda`, `meetingPack`,
`raciMatrix`. Actas inmutables post-firma (`cphs_meetings` signed-records
append-only). Páginas ComiteParitario/CphsModule/CphsDraftMinute/CulturePulse.

#### B13 — Gestión del cambio (MOC) & Operaciones críticas · ✅ REAL
Routers `operationalChange`, `shiftHandover`, `changeMgmt`, `commute`,
`continuity`, `criticalRoles` (cierra gap PR #606). ISO 45001 §8.1.3.

### 🤖 Tanda D — Inteligencia y negocio

#### B14 — IA / Gemini / SLM & Copilots · ✅ REAL · 🔐  (bloque más grande, 107 archivos)

- **`/api/gemini`** (`gemini.ts`, 595 LOC): allowlist **`ALLOWED_GEMINI_ACTIONS`
  ≈ 84 acciones** (`:119-204`), RPC con gate (`:398`); `/api/ask-guardian` (RAG +
  streaming), `/api/gemini/stream` (SSE para AsesorChat). **Circuit breaker**
  (closed→open a 5 fallos/60s→half-open a 300s; los 3 `503` son
  `gemini_circuit_open`, no stubs). **Gobernanza** `gemini/governance.ts`:
  `assertGeminiAllowed` (`:39-59`), `estimateGeminiCostUsd` (`:82-95`),
  `recordGeminiOutcome` (`:109-132`); cuota diaria por tenant + tier.
- **aiFeedback** (`aiFeedback.ts`): **replay protection** (Sprint 33, flag `force`
  + `runTransaction`, 409 conflict, `:194-234`) + **redacción PII** (RUT/email/
  teléfono) + TTL 7 días. *(Corrige el P0 de mayo "sin replay protection".)*
- **SLM offline:** 28 archivos `services/slm/*` (TinyLlama/Qwen/Gemma + transformers).
  Regla de decisión (`useSlmOffline`): `forceSlm`→SLM; offline→SLM; si online,
  intenta cloud y cae a SLM. **Consumers:** `Evacuation.tsx` ✅; `AsesorChat`,
  `Driving`, `InhospitableGuide` 🟡 TODO (deuda de fallback offline).
- Montados: `aiToggle`, `aiGuardrails`, `aiQuality`, `explainability`, `coachRag`,
  `researchMode`.

#### B15 — Facturación, Suscripciones & Tier-gating · ✅ REAL · 🔐

- **`billing.ts`** (1.800+ LOC, mount `/api/billing` + `/billing`): adapters
  `webpay`, `Khipu`, `mercadoPago` (IPN HMAC SHA-256), Google Play RTDN, Apple SSN.
  **Stripe removido** (`:93` §2.12, 2026-05-21 — *corrige el hallazgo de mayo
  "Stripe aún enrutado"*).
- **Normalización de planId** (`subscriptionPlan.ts`, 61 LOC):
  `normalizeSubscriptionPlanId` mapea canonical↔legacy (`:49-53`) — *corrige el P0
  de mayo "planId canónico que el frontend no entiende"*. Planes: free/comite/
  departamento/plata/oro/titanio/platino/empresarial/corporativo/ilimitado.
- **Tier-gating server-side** (Regla #11): `RANK_`/`subscription.planId` en
  subscription.ts/billing.ts/onboarding.ts (frontend = solo UX).
- `preventionCost` cableado (B15-F1).

#### B18 — Analítica / Reportes / Dashboards / KPIs · ✅ REAL
- **aggregateTelemetry** (178 LOC): `/telemetry/aggregate?window=` + `/tenants/:tid/
  telemetry/rollup`; **nunca retorna PII** (`assertNoPII` como defensa final).
- **dataConfidence** (614 LOC): snapshot de calidad de datos, dismiss (roles admin/
  gerente/prevention_lead), recommendations; validación anti-inyección de `issueId`
  (`:476-479`).
- **reportsAutomation** (179): validate/render/check-due (compute puro).
- **projectComparator** (98): compare 2-10 snapshots (**nunca recomienda decisión**).
- `safetyMetrics`, `safetyPerformance`, `orgMetrics`, `portableHistory`,
  `predictiveAlerts` (consumido por `AlertSchedulerMount.tsx`) — cableados (B18-F1).

### 🧱 Tanda E — Infraestructura / plataforma

- **I-PLAT (72):** Capacitor 8 (`android/` 53 archivos, `ios/`), mesh nativo
  **STUB** (web simulator OK), workers, fastlane. `allowBackup="false"`
  (`AndroidManifest.xml`, Regla #17 ✅). `assetlinks.json` con fingerprint real
  ✅; **`apple-app-site-association` con placeholder `TEAMID`** ⚠️ (rompe iOS app
  links en prod).
- **I-CORE (53):** 18 contextos (Emergency, Firebase, Project, Subscription,
  Sensor, SystemEngine…), stores Zustand (migrando vía `createProjectScopedStore`).
  **🔴 SystemEngineProvider bloqueado:** falta fuente client-side de `tenantId`
  (`docs/stubs-inventory.md`) → no se monta sin 500.
- **I-I18N (18):** 16 locales; es-CL+en+pt-BR a paridad (Regla #18, gate
  `validate-i18n.cjs`); resto lazy.
- **I-DATA (18):** corpus normativo BCN+ISO+NCh (RAG).
- **I-BUILD (131):** `scripts/` (55), CI `.github/` (15), husky, 5 Dockerfiles
  (app + loadtest + dwg/usdz/photogrammetry workers), `firestore.rules`. **KMS
  preflight** `src/server/kmsPreflight.ts:27-32` exige `cloud-kms` en producción
  (*corrige el P0 de mayo "KMS dev en prod"*).
- **I-TEST (1.246):** Vitest 4 (excluye rules-tests del default, `vitest.config.ts:55-61`),
  supertest (153 archivos server), rules-tests (emulador), Playwright, Stryker
  **required en CI** (`mutation.yml`, ya **sin** `continue-on-error` — *corrige el
  P0 "gating engañoso"*). `firestore.test.rules` = reglas TEST-ONLY abiertas.

---

## 6. Deuda silenciosa transversal (métricas verificadas)

> "Potencia construida sin consumir" + métricas de calidad. Números **verificados
> por grep directo hoy** (algunos corrigen a los barridos).

### 6.1 Huérfanos / sub-consumidos

- **Servicios `*Backend.ts`:** ~20 archivos; varios **sin consumer de producción**
  (solo self + tests): chemicalBackend, comiteBackend, eppBackend, inventoryBackend,
  legalBackend, medicineBackend, medicalAnalysisBackend, psychosocialBackend,
  shiftBackend, susesoBackend, trainingBackend, predictionBackend. *(Down de "16+"
  en mayo. Matiz: tienen 2-3 archivos que los referencian — self/test/barrel — no
  "cero"; requieren confirmación caso a caso antes de borrar.)*
- **Stacks:** `services/iot/` (12 archivos, ~2 importers externos → casi huérfano),
  `services/mesh/` (12, ~10), `services/ml/` (vertexTrainer = stub intencional,
  `stubs-inventory.md:13-19`).
- **Bernoulli/Euler — YA NO huérfanos:** `CalculatorHub.tsx:32-45` **monta los 12
  generadores** + 3 paneles de ingeniería (desde Sprint 29). `physics/bernoulliEngine`
  importado por ~26 archivos. *(Corrige el hallazgo de mayo "12 generadores sin UI".)*
- **Componentes huérfanos:** ~24 listados en `COMPONENTS_TRIAGE.md` (Ds67Modal,
  PymeMaturityWizard, HazmatCompatibilityPanel, SpofPanel, NonConformityListPanel,
  PreventiveObjectivesPanel…) — 🏚️ backend listo, falta página contenedora.
- **Hooks sin consumer UI:** ~71 en `HOOKS_TRIAGE.md` (useAuditChain, useBowtie,
  useChangeMgmt, useContractors, useCriticalControls, useConfidentialReports…).

### 6.2 Métricas de calidad (conteos de hoy)

| Métrica | Valor | Nota |
|---|---|---|
| `: any` + `as any` (todo `src`, incl. tests/anotaciones) | **1.461** en 402 archivos | métrica gobernada distinta ↓ |
| `as any` producción (ratchet) | **160** | baseline `any-ratchet-baseline.json`, gate CI lo congela |
| TODO/FIXME en `src` | **191** | dispersos, sin concentración en SOS/emergencia |
| `@ts-ignore`/`@ts-expect-error` | **47** en 23 archivos | aceptable en código browser/React |
| `console.*` en `src/server` (no-test) | **20 en 13 archivos** | 🔴 **deuda viva** (ver abajo) |
| `Sentry.captureException` en `src/server` | 30 en 16 archivos | conviven con console.* |
| `Math.random` en `src/server` | **0** (solo en un `.test.ts`) | Regla #15 ✅ |
| Tests `skip/fixme` en `src` | **2** | (antes varios críticos) |
| Rutas server / tests server | 191 / 153 (~78%) | buena cobertura |
| Páginas con `useTranslation` | **169/170** (solo `Onboarding.tsx` no) | *corrige "107/110 hardcoded" de mayo* |

**🔴 `console.*` en server (deuda viva, P2):** 13 archivos siguen usando
`console.error/warn/log` en vez de Sentry — exactamente los que mayo marcó P0 +
algunos: `verifyAuth.ts`, `billing.ts`, `dte.ts`, `gemini.ts`, `healthVault.ts`,
`misc.ts`, `oauthGoogle.ts`, `projects.ts`, `reports.ts`,
`triggers/backgroundTriggers.ts`, `triggers/healthCheck.ts`,
`firestoreRateLimitStore.ts`, `firestoreSessionStore.ts`. En prod = fallos
silenciosos sin captura.

### 6.3 Observabilidad

- **Sentry** inicializado en `src/lib/sentry.ts` + `server.ts` + `main.tsx`.
- **OTel** opcional: `services/observability/tracing.ts` (`tracedAsync`/`tracedSync`),
  usado en ~12 archivos server (30 invocaciones); fallback graceful sin SDK.
- **Logging estructurado (pino/winston): inexistente** — todo `console.*`/Sentry.
- **Noops registrados** (`stubs-inventory.md`): CloudErrorReporting (3 métodos),
  Metrics adapter (6 métodos) — pendientes de migración GCP/OTel real.

### 6.4 Móvil / nativo

- `allowBackup="false"` ✅; `assetlinks.json` real ✅; **AASA con `TEAMID`
  placeholder ⚠️** (bloquea iOS Universal Links en prod).
- Plugin mesh nativo = STUB (web simulator funcional).
- KMS preflight gateado ✅. 5 Dockerfiles (app + 4 workers).

---

## 7. Matriz de promesas vs realidad (actualizada a hoy)

> Compara claims históricos contra el código de hoy. **Varios P0/P1 de mayo están
> corregidos** — el barrido de junio cerró la mayor parte de la brecha.

| Promesa / hallazgo de mayo | Estado HOY | Evidencia |
|---|---|---|
| "Stripe aún enrutado pese a descarte" | ✅ **Corregido** | `billing.ts:93` Stripe removido §2.12 |
| "KMS dev permitido en producción" | ✅ **Corregido** | `kmsPreflight.ts:27-32` exige cloud-kms |
| "planId canónico que frontend no entiende" | ✅ **Corregido** | `subscriptionPlan.ts:49-53` normaliza |
| "aiFeedback sin replay protection" | ✅ **Corregido** | `aiFeedback.ts:194-234` runTransaction+409 |
| "e2e-full-stack continue-on-error (vida no bloquea merge)" | ✅ **Corregido** | solo queda en comentario de `mutation.yml` |
| "Stryker no en CI" | ✅ **Corregido** | `mutation.yml` required, sin continue-on-error |
| "107/110 páginas hardcoded (bloqueador global)" | ✅ **Muy mejorado** | 169/170 usan `useTranslation` |
| "12 generadores Bernoulli sin UI" | ✅ **Corregido** | `CalculatorHub.tsx:32-45` los monta |
| "14 stores client-SDK sin reglas de write" | ✅ **Corregido (esta rama)** | `firestore.rules:366-477` |
| "incidentFlow audita a path tenant-scoped" | ✅ **STALE corregido** | `incidentFlow.ts:115` root audit_logs |
| "WebAuthn cae a legacy consume-only verified:true" | 🟡 **Parcial** | register/verify en curriculum.ts; eppFlow `:22` TODO revalidación server-side |
| "DTE autoemisión no cableada / push a SII" | 🔵 **Por diseño** | nunca push directo; PSE; adapters stub (K1) |
| "SUSESO cliente en browser (secreto)" | ✅ **Mitigado** | `susesoApiClient.ts:1-10` server-only, `fromEnv` null |
| "Mesh BLE real" | 🔴 **No (stub nativo)** | web simulator OK; Kotlin/Swift fake |
| "Zettelkasten 3 fuentes (no canonical)" | 🟡 **Deuda viva** | materializer behind flag (`SERVICES_TRIAGE.md`) |
| "A* evacuación real" | ❓ **Verificar** | evacuation usa Haversine + grid; confirmar si A* real |
| "console.error en server en vez de Sentry" | 🔴 **Aún presente** | 20 en 13 archivos |
| "SystemEngineProvider huérfano" | 🔴 **Bloqueado** | falta `tenantId` client-side |
| "Apple AASA placeholder" | ⚠️ **Pendiente** | `TEAMID` literal |

---

## 8. Hallazgos abiertos y correcciones a docs previas

**Hallazgos abiertos (registrados, no resueltos esta fase):**
1. **🔴 5 reglas firestore con bugs reales** (threads Codex #650): lone-worker
   ownership, libro de obras firmado editable, `site_book_counters`,
   `documents_for_read`/`audit_portals`. 🛟🔐 **P1**.
2. **❓ Modelos laxos** `exceptions`/`legal_obligations`/`shifts` (sin creator-uid
   anti-spoof, `firestore.rules:466-477`) — tu revisión.
3. **🔴 B5-D1 SUSESO fire-and-forget** (sin lectura de estado/receipt) — riesgo de
   cumplimiento. 🔐
4. **🔴 console.* en 13 archivos server** (fallos silenciosos) — P2.
5. **🔴 SystemEngineProvider bloqueado** por `tenantId` client-side.
6. **⚠️ AASA `TEAMID`** placeholder (iOS links).
7. **🟡 eppFlow WebAuthn** sin revalidación server-side de firma (`:22`).
8. **B3-D1 PLAESI** doc-vs-code; **B2-D1** 3 GET de riskRanking; **B2-D2/❓**
   `useShiftRiskPanel` sin hogar.
9. **⚠️ `useBinanceIntegration`** eliminado (§9 TODO "descartado por usuario", sin
   commit citado) — confirmar.

**Correcciones a docs (código = verdad):** incidentFlow root audit_logs (no
tenant-scoped); B1 "Headcount" parcial→B1-F2; 14 colecciones **ya con reglas** (no
"en progreso"); i18n 169/170 (no 107/110); Bernoulli montado; Stripe/KMS/replay/
gating/normalización **corregidos** desde mayo. La cifra E2E ~62% (mayo) quedó baja.

---

## 9. Oportunidades cross-cutting (alta palanca)

Features que conectan 2-5 módulos **ya existentes** (bajo esfuerzo, alto impacto):

1. **SOS auto-relay con XP** — `mesh/meshRelayQueue` + `gamification/positiveXp` +
   `emergency`. (S, alto, narrativa de marca; el hook `onRelaySuccess` ya existe.)
2. **REBA/RULA → folio SUSESO** — `ergonomics` + `safety/ergonomicAssessments` +
   `suseso/folioGenerator`. (S, demo legal tangible.)
3. **Dar hogar a los ~24 componentes + ~71 hooks 🏚️** (Ds67Modal/DIAT,
   NonConformityListPanel/ISO 45001 §10.2, useConfidentialReports/Ley 21.643,
   useAuditChain). (M, desbloquea inversión hecha.)
4. **SLM offline en Driving/Emergency/AsesorChat** (hoy solo Evacuation lo usa) —
   asesor sin red. (M, vida.)
5. **MQTT IoT → Bernoulli → alerta predictiva + folio** — desbloquea el stack
   `iot/` casi huérfano. (M.)
6. **Zettelkasten canonical** (materializer behind flag) → curriculum/RAG. (M.)

---

## 10. Planificación por criticidad (vida/privacidad primero)

**P0/P1 — Vida y privacidad:**
1. **Verificar por emulador/CI** las reglas de las 14 colecciones (ya escritas) +
   **revisar contigo** los modelos laxos (`exceptions`/`legal_obligations`/`shifts`).
2. **5 reglas firestore con bugs reales** (#650): libro de obras firmado inmutable,
   lone-worker ownership, `site_book_counters`. 🛟🔐
3. **B5-D1 SUSESO**: añadir lectura de estado/receipt + retry (cumplimiento). 🔐
4. **B1-D2/D3**: lone-worker nativo (FGS Android) + specs E2E de SOS. 🛟
5. **SLM offline** en Driving/Emergency/InhospitableGuide. 🛟

**P2 — Operación/completitud:**
6. **Hogar para 🏚️** (~24 componentes + ~71 hooks) — caso a caso contigo.
7. **console.* → Sentry** en los 13 archivos server.
8. **eppFlow** revalidación server-side de WebAuthn.
9. **B2-D1** 3 GET riskRanking; **B3-D1** PLAESI.

**P3 — IA/negocio/infra:**
10. Adapters SII reales (K1); **AASA Team ID** real (iOS); SystemEngineProvider
    (`tenantId` client-side); Zettelkasten canonical; MQTT→Bernoulli; logging
    estructurado/OTel spans; plugins nativos HealthConnect/HealthKit (🔑 cuentas).

**Confirmaciones (no asumir):** ⚠️ `useBinanceIntegration`; ❓ A* real en
evacuación; ❓ modelos laxos de rules; ❓ features grandes (MQTT, WebXR real, tier
Global, Marketplace).

---

## 11. Apéndices

**Reproducir el gate:** `node scripts/audit-coverage-census.cjs` (+ `--unmapped`,
`--blocks`, `--json`). Salida: `total 3545 · UNMAPPED 0 (gate PASS)`.

**Fuentes primarias:** `TODO.md §17`/`§17.99` (barrido B1→B18 de primera mano);
`firestore.rules` (1.182 LOC); `server.ts`; barridos profundos verificados contra
código; triages SERVICES/COMPONENTS/HOOKS; PRAEVENTIO_HONEST_STATE; AUDIT_TRUTH_
MATRIX; AUDIT_2026-05-05_FULL; `docs/stubs-inventory.md`.

**Glosario:** ver §3. **Marcadores:** 🛟 vida · 🔐 privacidad/PII/biometría.

**Índice de bloques:** B1 Emergencia · B2 Riesgo/IPER · B3 Ergonomía · B4
Incidentes · B5 Cumplimiento/SUSESO · B6 Capacitación · B7 Salud · B8 Permisos/
LOTO · B9 Inspecciones · B10 EPP/Activos · B11 Contratistas · B12 CPHS · B13 MOC ·
B14 IA/Gemini/SLM · B15 Facturación · B16 Offline/PWA · B17 Admin/Auth · B18
Analítica. Infra: I-PLAT, I-CORE, I-I18N, I-DATA, I-BUILD, I-TEST, I-DOCS, I-ASSETS.

---

*Informe doc-only. No modifica código de producto. Próximo paso sugerido: revisión
por tandas (A→E), vida/privacidad primero, antes de Fase 3 (deuda) y Fase 4
(incorporación de huérfanos).*
