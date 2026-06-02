# Informe de Auditoría de Contexto — Praeventio Guard

**Fecha:** 2026-06-02 · **Rama:** `claude/technical-debt-review-e2e-87kVX`
**Universo medido:** `git ls-files` = **3.545 archivos** versionados.
**Estado del gate de totalidad:** ✅ `sin-mapear = 0`
(`node scripts/audit-coverage-census.cjs`).

> **Qué es este documento.** Un informe de contexto que describe **qué hace** la
> aplicación, **dónde vive** cada parte y **en qué estado real** está, cubriendo
> la **totalidad** del código. No es un barrido general: cada uno de los 3.545
> archivos queda asignado a una categoría verificable, y cada bloque funcional se
> describe con evidencia `file:line`. Sirve para tres cosas: (1) que ambos
> —usuario y asistente— estemos al tanto de lo que existe; (2) **no asumir**
> (el usuario puede corregir donde algo no le parezca); (3) compararlo con
> `TODO.md` y, recién después, decidir la deuda técnica y la incorporación de lo
> que falte.

> **Misión que enmarca el rigor.** Praeventio Guard es una aplicación de
> prevención de riesgos para industrias críticas en Latinoamérica. Su propósito
> es **proteger y salvar la vida** de los trabajadores, y hacerlo **respetando la
> privacidad** de las personas (Ley 19.628, biometría 100% on-device, trazas
> auditables e inmutables). Por eso el informe **prioriza primero lo más
> importante**: las funciones de vida y los datos sensibles.

---

## Índice

1. [Objetivo](#1-objetivo)
2. [Alcance](#2-alcance)
3. [Metodología y medidas de control](#3-metodología-y-medidas-de-control)
4. [Libro de Cobertura (totalidad verificada)](#4-libro-de-cobertura-totalidad-verificada)
5. [Mapa funcional por bloque — qué hace la app](#5-mapa-funcional-por-bloque--qué-hace-la-app)
6. [Reconciliación con TODO.md](#6-reconciliación-con-todomd)
7. [Planificación — orden por criticidad (vida/privacidad primero)](#7-planificación--orden-por-criticidad-vidaprivacidad-primero)
8. [Apéndices](#8-apéndices)

---

## 1. Objetivo

Producir un **único informe** que permita **ver qué hace la aplicación** en su
totalidad antes de tocar nada, dada la magnitud del código (3.545 archivos,
~3.053 en `src/`). El informe es el **entregable primario**. La incorporación de
funcionalidad huérfana y la remediación de deuda técnica son **fases
posteriores** que se planifican a partir de este documento, con visto bueno del
usuario en cada paso.

**Secuencia macro acordada:**

1. **Informe de contexto** (este documento) — qué hay y qué hace. ← *entregado*
2. **Comparación informe ↔ `TODO.md`** — qué se deseaba vs. qué existe (§6).
3. **Plan de deuda técnica** priorizado (§7) — referencias para decidir.
4. **Incorporación bloque por bloque** (módulo + menú + Zettelkasten) — *posterior, con aprobación.*

---

## 2. Alcance

**Incluye:** la totalidad de los archivos versionados (frontend, servidor,
servicios/engines, hooks, tests, infraestructura, datos normativos, i18n, docs,
assets, nativo móvil). Cada archivo se asigna a **exactamente una** categoría de
cobertura (§4), con gate de cierre **`sin-mapear = 0`**.

**No incluye (por diseño, esta fase):**

- No modifica código de producto (es **doc-only**; el único archivo nuevo de
  soporte es `scripts/audit-coverage-census.cjs`, la medida de control).
- No incorpora huérfanos ni crea páginas/menús (Fase 4).
- No corrige reglas de Firestore ni resuelve hallazgos abiertos (Fase 3).
- No descarta nada: los ítems ambiguos (⚠️/❓) se listan para consulta, **no se
  borran**.

**Universo y distribución (verificado por el script):**

```
total tracked files: 3545   ·   UNMAPPED: 0   (gate PASS)
```

| Categoría | Archivos | Qué agrupa |
|---|---:|---|
| I-TEST | 1.246 | Suites Vitest/Playwright/rules, smoke, loadtest, `*.test/*.spec`, `firestore.test.rules` |
| FEAT-services | 692 | `src/services/**` — engines puros + clientes de dominio |
| FEAT-components | 424 | `src/components/**` — UI compartida (modales, wizards, charts) |
| FEAT-server | 243 | `src/server/**` + `server.ts` — rutas, middleware, triggers, jobs |
| I-DOCS | 184 | `docs/**`, `*.md`, `tasks/`, `templates/`, `LICENSE` |
| FEAT-hooks | 206 | `src/hooks/**` — data-fetching, sensores, IA |
| FEAT-pages | 170 | `src/pages/**` — features top-level lazy-routed |
| I-BUILD | 131 | configs raíz, `scripts/`, `.github/`, `.husky/`, `infra*/`, Docker, rules |
| I-ASSETS | 77 | `public/**`, `marketplace/`, `index.html` |
| I-PLAT | 72 | `android/`, `ios/`, `fastlane/`, `packages/capacitor-mesh/`, `src/workers/` |
| I-CORE | 53 | `contexts/`, `store/`, `providers/`, `lib/`, `utils/`, `types/`, `constants/`, raíz `src/` |
| I-DATA | 18 | `src/data/**` — corpus normativo (RAG) |
| I-I18N | 18 | `src/i18n/**` — locales |
| FEAT-routes | 7 | `src/routes/**` — route-groups React Router 7 |
| **TOTAL** | **3.545** | **mapped = total → gate PASS** |

> **Nota de honestidad sobre el etiquetado por bloque.** El script también
> intenta etiquetar cada archivo de feature con su bloque funcional (B1–B18) por
> heurística de palabra clave. De los 1.742 archivos de feature, **725 quedan
> como `B?-needs-human`** (nombres genéricos: adaptadores, utilidades internas de
> `services/`, etc.). Esto es **deliberadamente honesto**: el gate de totalidad
> es a nivel de categoría (donde `sin-mapear = 0`); la asignación fina por bloque
> es un **apoyo**, no una verdad mecánica, y los 725 quedan disponibles para que
> el usuario los ubique durante la revisión. El mapa funcional (§5) sí asigna los
> dominios principales a su bloque con evidencia `file:line`.

---

## 3. Metodología y medidas de control

**Principio rector:** *code-first, sin asumir.* Todo aserto se respalda con
evidencia `file:line` real (Regla #1 de `CLAUDE.md`: nada marcado ✅ sin
referencia). Cuando una doc y el código discrepan, **el código es la verdad**.

**Medidas de control aplicadas a este informe:**

1. **Gate de totalidad mecánico.** `scripts/audit-coverage-census.cjs` recomputa
   `git ls-files` contra el Libro de Cobertura y **falla (exit≠0) si algún
   archivo queda sin mapear**. Hoy: `UNMAPPED = 0`. Reproducible y CI-friendly.
2. **Trazabilidad.** Cada bloque enlaza a su evidencia en código y, donde aplica,
   a `TODO.md §X` / commit / PR.
3. **No-asumir + checkpoints de usuario.** El informe se entrega para revisión por
   tandas (vida/privacidad primero); el usuario corrige antes de avanzar a la
   incorporación. Los ítems ambiguos se marcan ❓/⚠️ y se consultan, no se
   resuelven especulativamente.
4. **Foco vida y privacidad.** Cada ficha de bloque marca explícitamente si es
   **función de seguridad de vida** (🛟) y/o si trata **datos sensibles/PII/
   biometría** (🔐), con la nota legal correspondiente (Ley 16.744, Ley 19.628,
   ADR 0012 no-diagnóstico).
5. **Apoyo en auditoría previa verificada.** Este informe **sintetiza y no
   contradice** el barrido de primera mano `TODO.md §17` (B1→B18, 2026-06-01) y
   los triages de `docs/audits/{SERVICES,COMPONENTS,HOOKS}_TRIAGE.md`. Donde una
   doc previa quedó obsoleta (STALE), se anota la corrección.

**Leyenda de veredictos de estado** (consistente con `TODO.md §17`):

| Símbolo | Significado |
|---|---|
| ✅ | Real / cableado end-to-end con evidencia |
| 🟡 | Parcial — lógica existe, falta wire crítico / sensor / test |
| 🏚️ | Sin hogar de frontend — backend listo y montado, sin UI que lo consuma |
| 🔌 | Backend-only por diseño (API HTTP / job / trigger sin consumer único) |
| 🔵 | Stub honesto (tipado / `503` / feature-flag, registrado) |
| 🔑 | Bloqueado por secret/cuenta del usuario (§ secrets) |
| ❓ | Requiere decisión del usuario |
| ⚠️ | Posible descarte a confirmar (no borrar sin preguntar) |

**Marcadores transversales:** 🛟 seguridad de vida · 🔐 datos sensibles/PII/biometría.

---

## 4. Libro de Cobertura (totalidad verificada)

La tabla de §2 **es** el Libro de Cobertura a nivel de categoría: 3.545 archivos,
14 categorías, `sin-mapear = 0`. La distribución por **bloque funcional**
(best-effort, apoyo a la revisión) según el script:

| Bloque (heurística) | Archivos de feature |
|---|---:|
| B14 IA/Gemini/SLM | 107 |
| B1 Emergencia | 103 |
| B7 Salud ocupacional | 99 |
| B5 Cumplimiento/SUSESO | 95 |
| B18 Analítica/Reportes | 80 |
| B6 Capacitación | 73 |
| B9 Inspecciones | 66 |
| B4 Incidentes | 55 |
| B10 EPP/Activos | 49 |
| B2 Riesgo/IPER | 48 |
| B8 Permisos/LOTO | 43 |
| B15 Facturación/Tier | 41 |
| B17 Admin/Auth | 38 |
| B13 MOC/Ops críticas | 34 |
| B12 CPHS/Comités | 28 |
| B16 Offline/PWA | 24 |
| B3 Ergonomía | 19 |
| B11 Contratistas/Visitas | 15 |
| **B?-needs-human** | **725** |
| **TOTAL feature** | **1.742** |

> El alto conteo de B14/B7/B5/B1 es coherente con un producto de prevención de
> riesgos centrado en vida (emergencia, salud) y cumplimiento, con una capa de IA
> extensa. El residual `B?-needs-human` (41%) refleja servicios de infraestructura
> de dominio (adaptadores, sync, observabilidad, zettelkasten) cuya pertenencia a
> un bloque es ambigua por nombre — se resuelve en la revisión guiada.

---

## 5. Mapa funcional por bloque — qué hace la app

> Núcleo del informe. Cada ficha responde: **propósito** · **superficie**
> (página/ruta/servicio) · **persistencia/auditoría** · **estado** · **vida/
> privacidad** · **evidencia**. El orden sigue la criticidad: vida y privacidad
> primero. La fuente de verdad de cada veredicto es el barrido de primera mano
> `TODO.md §17` (2026-06-01), aquí sintetizado.

### 🛟 Tanda A — Vida y seguridad crítica

#### B1 — Emergencia & Respuesta · ✅ REAL · 🛟

- **Propósito:** salvar vidas en eventos críticos: SOS, evacuación con ruteo,
  conteo de personal, trabajador solitario (lone-worker), caída/ManDown,
  refugios, zonas restringidas, brigada, simulacros y comunicaciones de
  contingencia.
- **Superficie:** `SOSButton` → `POST /api/sos` (Firestore + FCM + email
  fallback, rate-limited + auditado); `src/server/routes/evacuation.ts`
  (Haversine + A* sobre grid, montado en `server.ts:1060`); route-group
  `src/routes/EmergencyRoutes.tsx`; contexto `src/contexts/EmergencyContext.tsx`
  (con fallback mesh).
- **Persistencia/auditoría:** SOS y eventos escriben a Firestore + `audit_logs`.
- **Estado:** ✅ mayoritariamente production-grade. Tras el barrido se cablearon
  **4 routers que estaban huérfanos** (loneWorker, refuges, restrictedZones,
  evacuationHeadcount): implementados y unit-tested pero **nunca montados** →
  daban **404** a sus consumidores (`useLoneWorker`, `useRefuges`,
  `useRestrictedZones`, `useEvacuationHeadcount`, `EvacuationQRScanner.tsx`).
  Resueltos con TDD (B1-F1, B1-F2; contrato `serverMountOrder.test.ts`).
- **Vida/Privacidad:** 🛟 máxima criticidad. Función directa de salvamento.
- **Deferido:** B1-D2 verificar lone-worker nativo (Foreground Service Android);
  B1-D3 reconciliar specs E2E `sos-button.spec` (hoy en `describe.fixme`).
- **Evidencia:** `TODO.md §17 B1` (líneas 1765-1817); `emergencyRouter` mount
  `server.ts:895`; `EmergencyContext.meshFallback.test.tsx`.

#### B7 — Salud ocupacional & Vigilancia · ✅ REAL + ADR 0012 · 🛟🔐

- **Propósito:** vigilancia de salud ocupacional sin diagnóstico clínico:
  catálogos médicos, carga mental, fatiga, ritmo circadiano, higiene, historia
  del trabajador, retorno al trabajo, bóveda de salud (HealthVault) con
  compartición por QR.
- **Superficie:** routers `medicalCatalogs`, `hygiene`, `mentalLoad`, `fatigue`,
  `circadian`, `workerHistory`, `returnToWork` (montados `/api/sprint-k`);
  páginas `HealthVaultShare/Viewer`, `Medicine`, `MyData`, `SystemHealth`;
  route-group `src/routes/HealthRoutes.tsx`; servicios `src/services/health/*`
  (19 archivos), `src/services/medical/*` (8).
- **Persistencia/auditoría:** datos de salud cifrados; bóveda con compartición
  controlada.
- **Estado:** ✅ sin huérfanos. **ADR 0012 (no-diagnóstico) enforced**: 0
  funciones prohibidas en `src/` (único match = el test del guard); 8 usos de
  `<MedicalDisclaimer/>`.
- **Vida/Privacidad:** 🛟🔐 crítico en ambas dimensiones. Biometría **100%
  on-device** (Regla #12): `health/healthFacadeNative.ts`, `nativeHealthAdapter.ts`
  (Health Connect / HealthKit) — no salen frames ni ritmo cardíaco del
  dispositivo. PII médica → Ley 19.628 + KMS.
- **Evidencia:** `TODO.md §17 B7` (líneas 1979-1991).

#### B16 — Offline / PWA / Capacitor / Mesh / Biometría on-device · ✅ REAL · 🛟🔐

- **Propósito:** que la app funcione **sin red** en faenas remotas: PWA offline,
  SQLite cifrado on-device, relay mesh BLE/WiFi-Direct, sincronización y sensores.
- **Superficie:** `src/services/sync/*` (15), `packages/capacitor-mesh/`,
  `src/workers/*`, `SensorContext.tsx`; router `syncStatus` (montado tras
  barrido).
- **Persistencia:** IndexedDB/SQLite on-device; sync con cola de conflictos.
- **Estado:** ✅. **Cifrado SQLite ON** (Regla #16): `createConnection(..., true,
  mode, ...)` en `pwa-offline.ts:78` y `offlineStorage.ts:89`; el único match
  `"no-encryption"` es un comentario histórico, no código activo. `syncStatus.ts`
  estaba huérfano → montado (B16-F1).
- **Vida/Privacidad:** 🛟 (la operación offline sostiene el SOS/evacuación sin
  red) · 🔐 (cifrado obligatorio de datos en reposo en el dispositivo).
- **Evidencia:** `TODO.md §17 B16` (líneas 2084-2095).

#### B2 — Riesgo & IPER · ✅ REAL · 🛟

- **Propósito:** identificación de peligros y evaluación de riesgos (IPER), mapa
  de calor, ranking, riesgo residual, bowtie, JSA, controles críticos, riesgo de
  turno y madurez.
- **Superficie:** motor `src/services/protocols/iper.ts` (135 LOC, puro,
  unit+mutation-tested); routers `riskRadar`/`residualRisk`/`maturity`/`bowtie`/
  `jsa`/`criticalControls`/`raciMatrix`/`preShiftRisk` montados; route-group
  `src/routes/RiskRoutes.tsx`.
- **Estado:** ✅. `riskRanking.ts` y `shiftRiskPanel.ts` estaban huérfanos →
  montados (B2-F1).
- **Vida/Privacidad:** 🛟 (la matriz de riesgo es la columna vertebral preventiva).
- **Deferido:** B2-D1 faltan 3 endpoints **GET** que consumen los dashboard cards
  (`risk-ranking/timeseries|top-risks|weak-controls`) — hoy los hooks devuelven
  idle (stub honesto, `useRiskRanking.ts:135-172`); B2-D2 `useShiftRiskPanel` sin
  consumidor UI (🏚️ sin hogar) → **❓ decisión de producto**: dónde vive la vista.
- **Evidencia:** `TODO.md §17 B2` (líneas 1821-1854).

#### B3 — Ergonomía & Protocolos MINSAL · ✅ REAL · 🛟🔐

- **Propósito:** evaluación ergonómica y protocolos MINSAL: REBA, RULA, TMERT,
  PREXOR; estimación de postura on-device por visión.
- **Superficie:** motores puros `services/ergonomics/{reba.ts:378,rula.ts:284}`,
  `services/protocols/{tmert.ts:106,prexor.ts:128}` (unit+mutation-tested);
  `landmarksToScore.ts`, `useMediaPipePose.ts`, `AIPostureAnalysisModal.tsx`;
  routers `ergonomics`/`protocols` montados (compute-only, stateless).
- **Persistencia/auditoría:** la evaluación persiste client-side en
  `services/safety/ergonomicAssessments.ts` (`setDoc` + `logAuditAction`,
  append-only tras firma, Ley 16.744 + ISO 45001 §7.5.3) — la ruta compute-only
  es correcta por diseño (B3-D2 cerrado).
- **Vida/Privacidad:** 🛟 (previene TME) · 🔐 (Regla #12: 0 subidas de frame de
  cámara; el análisis de pose es on-device).
- **Deferido:** **B3-D1 — PLAESI** aparece en `CLAUDE.md` (Regla #10) pero **no
  existe en `src/`** (0 referencias) → ⚠️ doc-vs-code gap: implementar o quitar de
  la doc.
- **Evidencia:** `TODO.md §17 B3` (líneas 1858-1886).

### 🔐 Tanda B — Privacidad, cumplimiento e integridad

#### B17 — Admin / Multi-tenant / Auth / RBAC / Audit / Privacidad · ✅ REAL · 🔐

- **Propósito:** control de acceso, aislamiento multi-tenant, autenticación,
  RBAC, cadena de auditoría inmutable y privacidad. Base de confianza de toda la
  app.
- **Superficie:** routers `admin (×4)`, `b2dAdmin`, `oauthGoogle (×2)`,
  `adminJobs`, `audit (×3)`, `auditChain`, `auditPortal`; middleware
  `verifyAuth`, `assertProjectMember`; servicios `src/services/auth/*` (14),
  `src/services/privacy/*` (16), `src/services/security/*` (12); contextos
  `FirebaseContext`, `ProjectContext`.
- **Persistencia/auditoría:** `firestore.rules` (1k+ LOC, default-deny con
  catch-all `match /{document=**}`); `audit_logs` append-only
  (`create:true, update:false, delete:false`).
- **Estado:** ✅ stack sólido. `pymeOnboarding.ts` y `pymeWizard.ts` estaban
  huérfanos → montados (B17-F1).
- **Vida/Privacidad:** 🔐 núcleo de privacidad. Invariante de auditoría: el
  servidor estampa `userId`/`userEmail` del token verificado (nunca confía en el
  cliente); las llamadas de audit se `await`ean (Regla #14).
- **Evidencia:** `TODO.md §17 B17` (líneas 2099-2114).
- **🔴 Hallazgo crítico asociado (ver §6):** 14 colecciones client-SDK sin reglas
  de write en producción (default-deny bloquea writes legítimos).

#### B5 — Cumplimiento & SUSESO · ✅ REAL · 🔐

- **Propósito:** cumplimiento normativo chileno (Ley 16.744, DS54, DS44/2024,
  DS40), calendario legal, no conformidades, retención de privacidad, emisión DTE
  y formularios DIAT/DIEP a la mutual.
- **Superficie:** routers `compliance (×3)`, `complianceEmit`, `dte`,
  `regulatoryFramework`, `industryRules`, `nonConformity`, `privacyRetention`
  montados; route-group `src/routes/ComplianceRoutes.tsx`; servicios
  `services/compliance/*` (27), `services/suseso/*` (15), `services/sii/*` (18),
  `services/regulatory/*` (25).
- **Estado:** ✅. `legalObligations.ts` estaba huérfano → montado (B5-F1).
- **Vida/Privacidad:** 🔐 (retención de datos, marco regulatorio multi-jurisdicción
  — ADR 0014).
- **Evidencia:** `TODO.md §17 B5` (líneas 1943-1957).

#### B4 — Incidentes & Investigación · ✅ REAL · 🛟

- **Propósito:** reporte de incidentes, investigación (árbol de causas),
  lecciones aprendidas, acciones correctivas, tendencias, y paralización de faena
  (stoppage).
- **Superficie:** routers `rootCauseInvestigation`, `incidentTrends`,
  `incidentBundle`, `lessonsLearned`, `correctiveActions` montados; `incidentFlow`
  y `stoppage` montados tras barrido (B4-F1).
- **Persistencia/auditoría:** `incidentFlow` audita a **root `audit_logs`**
  (`incidentFlow.ts:115`, corrige hallazgo STALE previo que lo daba en path
  tenant-scoped). `stoppage` es **stateless de transición** (cliente persiste).
- **Vida/Privacidad:** 🛟 (la investigación de incidentes previene recurrencia).
- **Deferido:** **🔴 B4-D1 (real):** la persistencia client-side de `stoppages`
  cae bajo default-deny — **`firestore.rules` no tiene entrada para `stoppages`**
  → write bloqueado en prod. Requiere **decisión del modelo de acceso** (¿inmutable
  tras declarar?, ¿quién resume/cancela?, ¿folio?) antes de escribir las reglas
  (Regla #4). Candidato a PR de seguridad dedicado. B4-D2 cerrado (no-defecto).
- **Evidencia:** `TODO.md §17 B4` (líneas 1890-1939).

### ⚙️ Tanda C — Operación y soporte

#### B6 — Capacitación & Currículum · ✅ REAL

- **Propósito:** capacitación DS44, ODI, microtraining, repetición espaciada,
  brechas de competencia, retorno al trabajo, aprendices, gamificación.
- **Superficie:** 9 routers montados (`curriculum`, `safetyTalks`,
  `microtraining`, `postTraining`, `spacedRepetition`, `skillGap`,
  `returnToWork`, `apprenticeship`, `adoption`); `services/curriculum/*`,
  `trainingBackend.ts`; route-group `TrainingRoutes.tsx`; páginas `Training`,
  `Onboarding`, `PortableCurriculum`, `LessonsLearned`, más mini-juegos
  (`ArcadeGames`, `ClawMachine`).
- **Estado:** ✅ sin huérfanos ni stubs (B6-D1 cerrado: cobertura audit 1:1).
- **Evidencia:** `TODO.md §17 B6` (líneas 1961-1975).

#### B8 — Permisos de trabajo & LOTO · ✅ REAL · 🛟

- **Propósito:** permisos de trabajo (DS132), bloqueo/etiquetado (LOTO), controles
  críticos y de ingeniería, soft-blocking, excepciones.
- **Superficie:** routers `workPermits` (audit=4), `loto`, `criticalControls`,
  `engineeringControls`, `softBlocking`, `exceptions` montados; página
  `WorkPermits.tsx`.
- **Estado:** ✅ sin huérfanos (B8-D1 cerrado: el "write" sospechoso era un
  `createHash('sha256')`, no Firestore).
- **Vida/Privacidad:** 🛟 (LOTO previene energización accidental).
- **Evidencia:** `TODO.md §17 B8` (líneas 1995-2008).

#### B9 — Inspecciones, Checklists & Observaciones · ✅ REAL

- **Propósito:** inspecciones offline, checklists, observaciones de conducta
  (BBS), libro de obras con firma, evidencia fotográfica, ack por QR.
- **Superficie:** routers `positiveObservations`, `offlineInspections`,
  `checklistBuilder`, `formBuilderAdvanced`, `bbs`, `qrSignature`, `qrAck`,
  `photoEvidence`, `sitebook` + `sitebookSign` (WebAuthn) montados; páginas
  `Findings`, `FindingsHeatMap`, `OfflineInspection`, `PositiveObservations`,
  `SiteBook`; servicios `services/siteBook/*` (12).
- **Estado:** ✅. `qrAck` devuelve `503` honesto (`qr_ack_not_configured`) si
  falta `QR_ACK_HMAC_SECRET` → 🔑 bloqueado por secret, no stub.
- **Evidencia:** `TODO.md §17 B9` (líneas 2012-2024).

#### B10 — EPP, Activos & Mantenimiento · ✅ REAL

- **Propósito:** flujo de EPP (inspección/órdenes/firma/PDF), activos con QR,
  mantenimiento, horómetro, señalética, inventario hazmat con compatibilidad
  química.
- **Superficie:** routers `equipment`, `maintenance`, `horometro`, `signaletics`
  montados; `eppFlow`, `equipmentQr`, `hazmatInventory` montados tras barrido
  (B10-F1); `services/hazmat/*` (8); página `Assets.tsx`.
- **Estado:** ✅. `hazmatInventory` es superficie stateless next-state (cliente
  persiste), no stub.
- **Evidencia:** `TODO.md §17 B10` (líneas 2028-2043).

#### B11 — Contratistas, Visitas & Acreditación · ✅ REAL

- **Propósito:** gestión de contratistas (DS76), visitas en tiempo real,
  onboarding y acreditación de proveedores, venta consultiva, permisos de
  geocerca.
- **Superficie:** routers `contractors`, `visitors`, `vendorOnboarding`,
  `consultativeSale`, `geofencePermissions` montados.
- **Estado:** ✅ sin huérfanos. **Nota triage:** `resolveObservation`
  (`vendorAccreditationTracker.ts:147`) es API pública de calc engine sin UI
  consumer → 🏚️ DEFER hasta `<VendorAccreditationPanel/>`.
- **Evidencia:** `TODO.md §17 B11` (líneas 2052-2053); `SERVICES_TRIAGE.md`.

#### B12 — CPHS & Comités · ✅ REAL · 🔐

- **Propósito:** Comité Paritario de Higiene y Seguridad: actas, estructura
  orgánica, pulso de cultura, agenda, paquete de reunión, matriz RACI.
- **Superficie:** routers `cphsMinute`, `organic`, `culturePulse`, `agenda`,
  `meetingPack`, `raciMatrix` montados; páginas `ComiteParitario`, `CphsModule`,
  `CphsDraftMinute`, `CulturePulse`.
- **Estado:** ✅. Actas inmutables post-firma por reglas (H29 cerrado).
- **Evidencia:** `TODO.md §17 B12` (líneas 2054-2055).

#### B13 — Gestión del cambio (MOC) & Operaciones críticas · ✅ REAL

- **Propósito:** management of change (ISO 45001 §8.1.3), entrega de turno,
  cambio organizacional, conmutación, continuidad operacional, roles críticos.
- **Superficie:** routers `operationalChange`, `shiftHandover`, `changeMgmt`,
  `commute`, `continuity`, `criticalRoles` montados (cierra el gap de PR #606).
- **Estado:** ✅ sin huérfanos.
- **Evidencia:** `TODO.md §17 B13` (líneas 2056-2058).

### 🤖 Tanda D — Inteligencia y negocio

#### B14 — IA / Gemini / SLM & Copilots · ✅ REAL · 🔐

- **Propósito:** asistencia IA: acciones Gemini whitelisted, SLM offline,
  guardrails, calidad, explicabilidad, coach con RAG, feedback, modo
  investigación. Es el bloque más grande por archivos (107).
- **Superficie:** routers `gemini`, `aiToggle`, `aiGuardrails`, `aiQuality`,
  `explainability`, `coachRag`, `aiFeedback`, `researchMode` montados; route-group
  `AIRoutes.tsx`; servicios `services/gemini/*` (26, post-split), `services/slm/*`
  (50), `services/ai/*` (22), `services/aiGuardrails/*` (11).
- **Estado:** ✅. Whitelist `ALLOWED_GEMINI_ACTIONS` presente (Regla #5);
  **88 actions mapeadas 1:1** entre whitelist y exports (sin huérfanos en ninguna
  dirección, `SERVICES_TRIAGE.md`). Los 3 `503` son **circuit-breaker**
  (`gemini_circuit_open`), no stubs.
- **Vida/Privacidad:** 🔐 (los prompts no deben tener forma diagnóstica — ADR
  0012; SLM offline mantiene datos en dispositivo).
- **Evidencia:** `TODO.md §17 B14` (líneas 2059-2062).

#### B15 — Facturación, Suscripciones & Tier-gating · ✅ REAL · 🔐

- **Propósito:** cobros (Webpay, MercadoPago, Khipu, Google Play/Apple IAP),
  suscripciones, tier-gating server-side, costo de prevención.
- **Superficie:** routers `billing (×2: /api/billing + /billing Webpay)`,
  `subscription`, `dte` montados; `preventionCost` montado tras barrido (B15-F1);
  servicios `services/billing/*` (27), `services/pricing/*` (12); contexto
  `SubscriptionContext`.
- **Estado:** ✅. **Tier-gating server-side presente** (Regla #11): checks
  `RANK_`/`subscription.planId` en `subscription.ts`, `billing.ts`,
  `onboarding.ts` (el gating frontend es solo UX).
- **Vida/Privacidad:** 🔐 (datos de pago; webhooks firmados con audit replays).
- **Adaptadores parciales:** LibreDTE/OpenFactura/SimpleAPI con `SiiNotImplemented`
  (🔵 stub honesto, plan K1); MercadoPago/Webpay TODOs (K10/F13).
- **Evidencia:** `TODO.md §17 B15` (líneas 2068-2080); `SERVICES_TRIAGE.md`.

#### B18 — Analítica / Reportes / Dashboards / KPIs · ✅ REAL

- **Propósito:** agregación de telemetría, métricas organizacionales, confianza
  de datos, historia portable, desempeño de seguridad, comparador de proyectos,
  alertas predictivas, automatización de reportes.
- **Superficie:** routers `aggregateTelemetry`, `orgMetrics`, `dataConfidence`,
  `portableHistory`, `safetyPerformance`, `explainability` montados;
  `reportsAutomation`, `safetyMetrics`, `projectComparator`, `predictiveAlerts`
  montados tras barrido (B18-F1, este último consumido por
  `AlertSchedulerMount.tsx`); servicios `services/analytics/*` (10).
- **Estado:** ✅.
- **Evidencia:** `TODO.md §17 B18` (líneas 2118-2133).

### 🧱 Tanda E — Infraestructura / plataforma

- **I-PLAT (72):** PWA/offline, Capacitor 8 (`android/` 53, `ios/`), mesh
  (`packages/capacitor-mesh/` 13), workers, fastlane. **Bloqueos conocidos:**
  plugins nativos HealthConnect/HealthKit y signing pendientes de keystore/cuentas
  (🔑). `allowBackup="false"` por defecto (Regla #17). Mesh: engine puro listo,
  consumer en `src/` históricamente débil (drift vs ADR 0013).
- **I-CORE (53):** contextos (18 incl. `EmergencyContext`, `FirebaseContext`,
  `ProjectContext`, `SubscriptionContext`, `SensorContext`), stores Zustand
  (migrando vía `createProjectScopedStore`), `lib/`, `utils/`, `types/`.
- **I-I18N (18):** es-CL (referencia) + en + pt-BR a paridad de claves (Regla #18,
  gate `validate-i18n.cjs`); locales lazy (fr/de/it/ja/zh/ar/ko/hi/ru) fuera de
  scope por diseño (fallback chain).
- **I-DATA (18):** corpus normativo BCN + ISO + NCh (fuente RAG).
- **I-BUILD (131):** configs raíz, `scripts/` (55), CI `.github/` (15), husky,
  Docker, `firestore.rules`/`storage.rules`, infra Cloud Run.
- **I-TEST (1.246):** Vitest 4 (node default; jsdom por archivo), suites server
  con supertest (33+), rules-tests (emulador), Playwright E2E, smoke, mutation
  (Stryker sobre calc engines), loadtest. **Nota:** `firestore.test.rules` son
  reglas TEST-ONLY abiertas (ver hallazgo §6).
- **I-DOCS (184) / I-ASSETS (77):** runbooks, ADRs, auditorías, sprints;
  `public/.well-known` (PGP, AASA, assetlinks), `index.html`, marketplace.

---

## 6. Reconciliación con TODO.md

> Comparación informe ↔ lo que `TODO.md` dice que se desea hacer. Conclusión
> central: **no hubo descarte masivo por miss-concept**; la mayoría de lo que
> figuraba "pendiente" ya se construyó. El límite real es el techo de secrets/
> cuentas (§ provisioning), no código faltante.

### 6.1 Estado global según `TODO.md` y honest-state

- `TODO.md §17.99` (cierre 2026-06-01): **los 18 bloques auditados de primera
  mano**; **20 routers huérfanos** encontrados y **los 20 cableados** con TDD
  (B1:4, B2:2, B4:2, B5:1, B10:3, B15:1, B16:1, B17:2, B18:4). Bloques sin
  huérfanos: B3, B6, B7, B8, B9, B11, B12, B13, B14. **Ningún bug de wiring
  abierto.**
- Baseline de runtime verificado (`TODO.md §17`): `npm ci` ✅, `typecheck` **0
  errores**, `build` ✅ (2m03s), `lint` ✅. (El flake §2.31 open-handle afecta
  ~30-40% de runs de `npm run test`.)
- `PRAEVENTIO_HONEST_STATE_2026-05-05.md`: promedio ponderado E2E ~62% (cifra de
  mayo, anterior al cierre de huérfanos de junio). Dominios fuertes: Auth/RBAC
  95%, Emergencia 90%, PWA 90%, Billing 85%, HealthVault 80%. Dominios débiles
  por secret/cuenta: native plugins 30%, mobile pipeline 30%, mesh 35%.

### 6.2 Tabla de veredictos (síntesis de §8/§9/§16 + triages)

| Veredicto | Ítems (ejemplos verificados) |
|---|---|
| ✅ Construido (figuraba "pendiente") | gemini split (`src/services/gemini/*`, 26 archivos), 88 Gemini actions 1:1, SLM offline (`services/slm/*`, 50), MediaPipe local, conflict_queue, safeNormativeQuery, OpenAPI, Bernoulli en paneles, los 20 routers huérfanos cableados |
| 🧱 Pendiente real | MaestrIA foto→hallazgo (`TODO.md §16.1.3`), ARIA 5 agentes (§16.1.4), MCP internos gp-* (§16.1.5), 3 GET dashboard de riskRanking (B2-D1) |
| 🏚️ Sin hogar de frontend | `useShiftRiskPanel` (B2-D2), `resolveObservation`/`VendorAccreditationPanel`, ~24 componentes en `COMPONENTS_TRIAGE.md` (Ds67Modal, PymeMaturityWizard, HazmatCompatibilityPanel, SpofPanel, NonConformityListPanel…), ~71 hooks en `HOOKS_TRIAGE.md` (useAuditChain, useBowtie, useChangeMgmt, useContractors, useCriticalControls…) |
| 🔵 Stub honesto / 🔑 key-blocked | adaptadores SII (LibreDTE/OpenFactura/SimpleAPI), Stripe (no instalado), Khipu (cuenta), `qrAck 503`, gemini circuit-breaker, native plugins (keystore/cuentas) |
| ⚠️ Posible descarte a confirmar | `useBinanceIntegration.ts` eliminado del árbol (§9 "descartado por usuario", sin commit-directiva citado) — **confirmar antes de dar por cerrado** |
| ❓ Decisión del usuario | dónde vive la vista de `shiftRiskPanel`; workshop 512 nodos, Wake Word, Pinecone, Marketplace, tier "Global", MQTT broker IoT, WebXR `immersive-ar` real |
| 🗑️ Descarte legítimo (documentado) | Stripe pre-flight, Vertex SDK directo, scraping-SUSESO, ODA File Converter (→ LibreDWG) |

### 6.3 Hallazgos abiertos que el informe registra (no resuelve en esta fase)

1. **🔴 14 stores client-SDK sin reglas de write en prod (B17/transversal).**
   `firebase.json` despliega `firestore.rules`; el master-gate
   `match /{subCollection=**}/{docId}` (`firestore.rules:258`) da **solo read** a
   project-members. Las 14 colecciones Sprint-K creadas con
   `createProjectScopedStore` (CLIENT SDK `setDoc`/`updateDoc`) **no tienen regla
   de write** → default-deny **bloquea los writes en producción**. Enmascarado por
   `firestore.test.rules` (TEST-ONLY open). Colecciones: `stoppages`, `site_book`,
   `site_book_entries`, `legal_obligations`, `operational_changes`, `root_causes`,
   `lone_worker_events`, `lone_worker_sessions`, `exceptions`, `shifts`,
   `audit_portals`, `safety_talks_given`, `documents_for_read`, `sample_live`
   (test-only). **Fix en progreso** (`TODO.md §17`, líneas 1714-1761): reglas de
   write conservadoras para las 13 reales + rules-tests parametrizados +
   `security_spec.md`; verificación vía CI (emulador no corre en este entorno).
   **Requiere revisión del usuario** de los modelos de acceso marcados inline
   (especialmente `exceptions`/`legal_obligations`/`shifts` sin campo creator-uid
   confirmado, e inmutabilidad de paralización). **Toca cumplimiento (Regla #4) y
   afecta vida (lone_worker) → P1.**
2. **🔴 B4-D1 — `stoppages` sin regla (subconjunto del #1).** Persistencia de
   paralización bloqueada; requiere decisión de modelo de acceso antes de escribir
   reglas. **🛟 (paralización de faena es seguridad de vida) → P1.**
3. **5 reglas firestore con bugs reales (threads Codex #650):** lone-worker sin
   ownership, libro de obras firmado editable, `site_book_counters` faltante,
   `documents_for_read`/`audit_portals` desalineados. (7 threads de authz ya
   fijos por #651/#652.) **🛟🔐 → P1.**
4. **B3-D1 — PLAESI** en doc pero ausente en código → ⚠️ resolver doc-vs-code.
5. **B2-D1 — 3 endpoints GET** de riskRanking inexistentes (feature-work).

### 6.4 Correcciones a docs previas (código = verdad)

- `incidentFlow` audita a **root `audit_logs`** (`incidentFlow.ts:115`), no a path
  tenant-scoped como decía el audit L795 → **STALE corregido**.
- Veredicto inicial B1 "Headcount ✅" era parcial → faltaba el CRUD persistente
  (resuelto en B1-F2).
- `PRAEVENTIO_HONEST_STATE` (mayo) reporta E2E ~62%; el cierre de huérfanos de
  junio (`§17.99`) sube el wiring real de varios dominios — la cifra de mayo está
  desactualizada al alza de junio.

---

## 7. Planificación — orden por criticidad (vida/privacidad primero)

> Backlog priorizado para las **fases posteriores** (no se ejecuta en esta fase).
> Orden: primero lo que protege la vida y la privacidad.

### P0/P1 — Vida y privacidad (cerrar primero)

1. **Reglas de write de las 14 colecciones client-SDK** (§6.3#1) — incluye
   `lone_worker_*` (🛟) y cumplimiento (🔐). Requiere visto bueno del usuario a los
   modelos de acceso inline. **Verificar por CI (emulador).**
2. **Modelo de acceso + reglas de `stoppages`** (§6.3#2, B4-D1) — 🛟 paralización.
3. **5 reglas firestore con bugs reales** (§6.3#3) — libro de obras firmado
   inmutable, lone-worker ownership, `site_book_counters`. 🛟🔐
4. **B1-D2/D3** — verificar lone-worker nativo (FGS Android) y reconciliar specs
   E2E de SOS (hoy `describe.fixme`). 🛟

### P2 — Operación y completitud funcional

5. **Sin-hogar de frontend (🏚️):** dar página/menú a los componentes y hooks
   listos (COMPONENTS_TRIAGE: ~24; HOOKS_TRIAGE: ~71). Priorizar críticos:
   Ds67Modal (DIAT mutual), NonConformityListPanel (ISO 45001 §10.2),
   useConfidentialReports (Ley 21.643), useAuditChain. **Decidir caso a caso** con
   el usuario (incl. ❓ `useShiftRiskPanel`).
6. **B2-D1** — 3 endpoints GET de riskRanking (timeseries/top-risks/weak-controls).
7. **B3-D1** — resolver PLAESI (implementar o quitar de doc).

### P3 — Inteligencia, negocio e infraestructura

8. Adaptadores SII reales (LibreDTE/OpenFactura/SimpleAPI), MercadoPago/Webpay
   TODOs (K-series).
9. Plugins nativos HealthConnect/HealthKit + pipeline de signing (🔑 bloqueado por
   keystore/cuentas — input del usuario).
10. Features mencionadas-no-implementadas (honest-state §"de lado"): MQTT broker
    IoT, WebXR `immersive-ar`, CalculatorHub Bernoulli, RAG NL incidentes,
    Gamification×salud, Coach IA por dominio. **❓ confirmar prioridad con el
    usuario.**

### Confirmaciones pendientes (no asumir)

- ⚠️ `useBinanceIntegration` — confirmar que el descarte fue intencional.
- ❓ Decisiones de producto sobre features grandes (§6.2) antes de invertir.

---

## 8. Apéndices

### 8.1 Reproducir el gate de totalidad

```bash
node scripts/audit-coverage-census.cjs            # resumen + gate (exit≠0 si sin-mapear>0)
node scripts/audit-coverage-census.cjs --unmapped # lista de no mapeados (debe ser vacía)
node scripts/audit-coverage-census.cjs --blocks   # tally por bloque (apoyo)
node scripts/audit-coverage-census.cjs --json     # salida máquina
```

Salida actual: `total 3545 · UNMAPPED 0 (gate PASS)`.

### 8.2 Glosario de veredictos

Ver leyenda en §3. Marcadores transversales: 🛟 vida · 🔐 privacidad/PII/biometría.

### 8.3 Fuentes primarias del informe

- `TODO.md §17` (auditoría B1→B18 de primera mano, 2026-06-01) y `§17.99` (cierre).
- `docs/audits/SERVICES_TRIAGE.md`, `COMPONENTS_TRIAGE.md`, `HOOKS_TRIAGE.md`.
- `docs/audits/PRAEVENTIO_HONEST_STATE_2026-05-05.md`.
- `firestore.rules`, `server.ts`, y el árbol completo `git ls-files` (3.545).

### 8.4 Índice de bloques

B1 Emergencia · B2 Riesgo/IPER · B3 Ergonomía/Protocolos · B4 Incidentes ·
B5 Cumplimiento/SUSESO · B6 Capacitación · B7 Salud ocupacional · B8 Permisos/LOTO ·
B9 Inspecciones · B10 EPP/Activos · B11 Contratistas/Visitas · B12 CPHS/Comités ·
B13 MOC/Ops-críticas · B14 IA/Gemini/SLM · B15 Facturación/Tier · B16 Offline/PWA ·
B17 Admin/Multi-tenant/Auth · B18 Analítica/Reportes. Infra: I-PLAT, I-CORE,
I-I18N, I-DATA, I-BUILD, I-TEST, I-DOCS, I-ASSETS.

---

*Informe doc-only. No modifica código de producto. Próximo paso sugerido: revisión
por tandas (A→E) con el usuario, partiendo por vida/privacidad, antes de la Fase 3
(deuda) y Fase 4 (incorporación de huérfanos).*
