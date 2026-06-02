# DEEP — B10 EPP, Activos & Mantenimiento · 2026-06-02

**Archivos revisados:** 87 del ledger (`block==="B10-EPP"`) + 4 fuera-de-ledger
detectados por grep y centrales al bloque (`src/server/routes/eppFlow.ts`,
`src/server/routes/eppFlow.test.ts`, `src/hooks/useEppFlow.ts`,
`src/components/eppFlow/PurchaseOrderSignModal.tsx`) + el reaper EPP
`src/server/jobs/checkExpiredPpe.ts`. Total efectivo ≈ 92.

> Nota de ledger: el ledger NO incluye `eppFlow.*` ni `useEppFlow.ts` aunque la
> consigna referencia explícitamente `eppFlow.ts:22`. Son los archivos que
> implementan la directiva no-push + WebAuthn. Quedan auditados aquí; conviene
> re-etiquetarlos `block==="B10-EPP"` en el ledger.

---

## 1. Lo que YA HACE (implementado y real)

**Backend (rutas montadas y verificadas en `server.ts`):**

- **EPP Inventory→OC flow** (`eppFlow.ts`, mont. `server.ts:1038`
  `/api/sprint-k`): 4 endpoints (inspection / pending-orders / sign-order /
  order-pdf) sobre el orquestador puro `eppInventoryPurchaseFlow.ts`. Cadena ZK
  de 7 nodos (`eppInventoryPurchaseFlow.ts:64-71`). Todos con `verifyAuth` +
  `assertProjectMember` (guard `eppFlow.ts:63`). Rol elevado exigido para
  pending/sign/pdf (`callerCanSignEpp` `eppFlow.ts:96`); `signerUid` debe ==
  caller (`eppFlow.ts:406`). Inspección de worker NO gateada por rol (correcto,
  `eppFlow.ts:91`).
- **Directiva NO-PUSH cumplida** (verificada en 3 capas):
  - Header `X-Praeventio-Pushed-To-Supplier: false` en el PDF
    (`eppFlow.ts:561`).
  - Metadata del nodo PDF `pushedToSupplier: false` con comentario
    "nunca true" (`eppInventoryPurchaseFlow.ts:443`).
  - Disclaimer impreso en el footer del PDF
    (`eppInventoryPurchaseFlow.ts:846-854`) + texto en el nodo firmado
    (`eppInventoryPurchaseFlow.ts:392-394`).
- **WebAuthn 'claim-signing'** para firma de OC: el server confía en el ceremony
  del cliente (mismo patrón que StoppageResumeModal) y solo persiste
  `challengeId` (no bytes de firma) (`eppInventoryPurchaseFlow.ts:368-413`).
- **Equipment QR + Pre-uso** (`equipmentQr.ts`, mont. `server.ts:1039`):
  register/list/lookup/preuse/history. **Directiva "nunca bloquear maquinaria"
  cumplida**: `/preuse` SIEMPRE persiste la validación aunque `passed:false`;
  jamás devuelve 4xx por checklist fallido; el cambio de status es una
  recomendación digital y la copy es "RECOMENDAMOS no operar", nunca
  "BLOQUEAMOS" (`equipmentQr.ts:368-417`). Persistencia ANTES del derive-status
  (`equipmentQr.ts:370`). El motor `deriveEquipmentStatusAfterPreUse` jamás
  setea un flag `blocked`, solo `restringido`/`fuera_servicio`
  (`equipmentQrService.ts:164-176`).
- **Horómetro→Mantención** (`horometro.ts`, mont. `server.ts:1085`): reading /
  list-tasks / complete. **Directiva no-bloqueo cumplida**: el cruce de umbral
  crea task con estado `open` y NUNCA marca el equipo `bloqueado`/`fuera_servicio`
  (`horometro.ts:13-18`). Motor puro determinista `checkThresholdsCrossed`
  (`horometroService.ts:199`) + scheduler idempotente con id determinista
  (`maintenanceScheduler.ts:107`). Regresión de horas rechazada salvo
  `source='manual'` (`horometroService.ts:352`).
- **Hazmat inventario** (`hazmatInventory.ts`, mont. `server.ts:1040`): 7
  endpoints stateless puro-compute (cliente persiste). Compatibilidad química
  vía matriz DS 78/NCh 2245 (`hazmatInventory.ts:48`), spill-plan, audit de
  ubicación. **No-push explícito** a SUSESO/MINSAL (`hazmatInventory.ts:14`).
- **Hazmat B2D** (`b2d/hazmat.ts`, mont. `b2d/index.ts:31`
  `/api/b2d/v1/hazmat`): 4 cálculos Bernoulli puros (pipe-pressure,
  gas-dispersion, scaffold-uplift, extinguisher-coverage) con `b2dAuth`,
  sin acceso a datos de tenant (`b2d/hazmat.ts:17-19`).
- **Signaletics** (`signaletics.ts`, mont. `server.ts:1050`): 3 endpoints puros
  (audit-zone, rank-site, evacuation-paths) ISO 7010/3864 + NCh 1411. Sin
  escritura Firestore (`signaletics.ts:15`).
- **Equipment list** (`equipment.ts`, mont. `server.ts:1036`): GET equipment por
  status, wired a `useEquipment.ts`.
- **Crons de mantención** (`maintenance.ts`, mont. `server.ts:651`
  `/api/maintenance`): `check-overdue` corre `checkOverdueMaintenance` +
  `checkExpiredPpe` + SUSESO + prewarn + resilience (gateado por
  `verifySchedulerToken`). El reaper de overdue flipea lifecycle a
  `maintenance_due` (NO bloquea) (`checkOverdueMaintenance.ts:120`). El reaper
  EPP flipea assignments vencidos a `expired` + notifica supervisores
  (`checkExpiredPpe.ts`). Documentado en `SCHEDULER_INVENTORY.md`.

**Capa servicio (pura, determinista, testeada):** equipmentQrService,
horometroService, maintenanceScheduler, hazmatInventory, hazmatSegregation
(matriz IMDG 7.2.4 completa — reemplazó el SEGREGATION_MATRIX "demo"),
hazmatExposureCalculator (radios GRE 2024 — reemplazó radios hardcoded),
signageValidator. Las 2 páginas hazmat SÍ consumen estos servicios
(`HazmatStorage.tsx:7`, `HazmatMap.tsx:9`).

**Hooks (cliente):** useEppFlow, useEquipmentQr, useHorometro, useHazmatInventory,
useEquipment, useSignaletics — todos completos y tipados, con
`X-Praeventio-Pushed-To-Supplier`/no-bloqueo reflejados en sus docstrings
(`useEquipmentQr.ts:10`, `useHorometro.ts:8`, `useEppFlow.ts:149`).

**Componentes wired al hook correcto:** EquipmentAdminPanel→useEquipmentQr
(`EquipmentAdminPanel.tsx:27`), HorometroEntryForm→useHorometro
(`HorometroEntryForm.tsx:16`), etc.

---

## 2. Lo que está PENDIENTE (deuda de este bloque)

- 🔴 **UI huérfana — page→component roto en casi toda la familia activos.**
  El cableado route→service→hook→component está completo, pero NINGÚN
  page/route monta estos componentes (grep exhaustivo sobre `src/`):
  `EquipmentAdminPanel`, `EquipmentQRScannerEntry`, `HorometroEntryForm`,
  `MaintenanceTaskList`, `MaintenanceCompleteForm`, `HorometerStatusCard`,
  `EquipmentStatusCard`, `HazmatStorageManager`, `HazmatCompatibilityPanel`,
  `WasteInventoryPanel` → **NONE**. `Assets.tsx` (43 LOC) solo renderiza
  `MaquinariaManager` (`Assets.tsx:8`), no la suite QR/horómetro. Resultado: el
  backend EPP/QR/horómetro está vivo y sin superficie de usuario que lo invoque.
- 🟡 **`eppFlow` pendingOrders es un Map en memoria por instancia**
  (`eppFlow.ts:222-240`), evictado entre reinicios y no compartido entre
  réplicas de Cloud Run. La fuente de verdad real son los nodos ZK; las OC
  pendientes se pierden tras un reinicio. Comentario lo reconoce
  ("La proxima iteracion debe persistir esto en Firestore").
- 🟡 **`order-pdf` no persiste `signedNodeId`** en pendingOrders, así que el
  nodo PDF queda sin edge al nodo firmado (best-effort, `eppFlow.ts:532-552`):
  la cadena ZK queda con un eslabón suelto (vinculable solo por `orderId`).
- 🔑 **TODO server-side revalidation de firma WebAuthn** (`eppFlow.ts:22`): el
  server confía en el ceremony del cliente. Aceptable por paridad con
  StoppageResumeModal pero es deuda de defensa-en-profundidad explícita.
- 🟡 **`companyName: 'Empresa'` hardcoded** en el PDF (`eppFlow.ts:505`) — MVP,
  debería resolver `projects/{projectId}`.
- ⚠️ **`horometerEngine.ts` contradice la directiva no-bloqueo.** Engine Sprint
  39 C.6 con `blockOnMandatory:true`, `shouldBlock`, copy "Bloquear operación"
  (`horometerEngine.ts:44,69,89,117,121`). Es un engine PARALELO al
  `horometroService.ts` (Bloque 4.1, sí cumple). Solo lo consume
  `HorometerStatusCard.tsx:15` — y esa card NO está montada en ninguna página
  (huérfana). No hay riesgo en producción HOY, pero el vocabulario "bloquear"
  viola la directiva del fundador y debería alinearse o retirarse.
- 🟡 **`maintenance.ts` cron monolítico** (698 LOC) acumula 8+ jobs no-EPP
  (lone-worker, B2D MRR, housekeeping legal). Candidato a split; fuera del
  alcance estricto de B10 pero contamina el dominio de mantención.
- 🟡 **Auditoría:** los endpoints stateless de hazmat e signaletics NO escriben
  `audit_logs` (son puro-compute sin mutación → aceptable por invariante, que
  exige audit solo en operaciones que cambian estado). eppFlow/equipmentQr/
  horometro SÍ auditan (`eppFlow.ts:343,457,554`; `equipmentQr.ts:210,385`;
  `horometro.ts:306,418`) — y están `await`eados (cumple invariante #14).

---

## 3. Tabla por archivo (selección de los revisados a fondo)

| Archivo | LOC | Estado | Cableado | Propósito + hallazgo file:line |
|---|---|---|---|---|
| src/server/routes/eppFlow.ts | 580 | 🟡 | mont. server.ts:1038 | Flow OC EPP. No-push header+disclaimer OK (561). pendingOrders en memoria (240). TODO firma server (22). |
| src/server/routes/equipmentQr.ts | 473 | ✅ | mont. server.ts:1039 | QR+preuse. Nunca bloquea, persiste siempre, copy "RECOMENDAMOS" (368-417). |
| src/server/routes/horometro.ts | 431 | ✅ | mont. server.ts:1085 | Reading→task open, jamás fuera_servicio (13-18). |
| src/server/routes/maintenance.ts | 698 | 🟡 | mont. server.ts:651 | Cron overdue+EPP-expiry. Monolito 8 jobs. verifySchedulerToken (79). |
| src/server/routes/equipment.ts | 77 | ✅ | mont. server.ts:1036 | GET equipment por status. |
| src/server/routes/signaletics.ts | 198 | ✅ | mont. server.ts:1050 | 3 endpoints puros ISO 7010. Sin Firestore (15). |
| src/server/routes/hazmatInventory.ts | 376 | ✅ | mont. server.ts:1040 | 7 endpoints stateless DS 43. No-push a SUSESO (14). |
| src/server/routes/b2d/hazmat.ts | 209 | ✅ | mont. b2d/index.ts:31 | 4 cálculos Bernoulli, sin tenant data (17). |
| src/services/equipment/equipmentQrService.ts | 176 | ✅ | via routes | Puro. derive-status nunca pone flag blocked (164-176). |
| src/services/equipment/equipmentFirestoreAdapter.ts | 84 | ✅ | via routes | Adapter pre_uses como subcolección. |
| src/services/horometro/horometroService.ts | 392 | ✅ | via routes/flow | Puro checkThresholdsCrossed (199). Regresión solo manual (352). |
| src/services/maintenance/maintenanceScheduler.ts | 310 | ✅ | via flow | Task id determinista idempotente (107). |
| src/services/maintenance/horometerEngine.ts | 268 | ⚠️ | solo HorometerStatusCard (huérfana) | Engine paralelo con shouldBlock/"Bloquear" (69,117) — viola directiva no-bloqueo. |
| src/services/zettelkasten/flows/eppInventoryPurchaseFlow.ts | 871 | ✅ | via eppFlow.ts | Cadena 7 nodos. pushedToSupplier:false (443) + disclaimer PDF (846). |
| src/services/zettelkasten/flows/horometroMaintenanceFlow.ts | 705 | ✅ | via horometro.ts | Orquestador puro buildChainSpecs (331), ids deterministas. |
| src/services/hazmat/hazmatInventory.ts | 198 | ✅ | via route + HazmatStorageManager | Matriz incompat. (48), spill-plan (171). |
| src/services/hazmat/hazmatSegregation.ts | 210 | ✅ | HazmatStorage.tsx:7 | Matriz IMDG 7.2.4 real (reemplazó "demo"). |
| src/services/hazmat/hazmatExposureCalculator.ts | 276 | ✅ | HazmatMap.tsx:9 | Radios GRE 2024 (reemplazó hardcode). |
| src/services/signaletics/signageValidator.ts | 463 | ✅ | via route | Puro ISO 7010/NCh 1411. |
| src/server/jobs/checkOverdueMaintenance.ts | 140 | ✅ | via maintenance.ts | Flip lifecycle a maintenance_due, no bloquea (120). Idempotente. |
| src/server/jobs/checkExpiredPpe.ts | ~190 | ✅ | via maintenance.ts | EPP vencido→expired + FCM + audit. Idempotente. |
| src/hooks/useEppFlow.ts | 194 | ✅ | EPP UI (no montada) | 4 mutators, no-push reflejado (149). |
| src/hooks/useEquipmentQr.ts | 202 | ✅ | EquipmentAdminPanel | 5 mutators, no-bloqueo reflejado (10). |
| src/hooks/useHorometro.ts | 136 | ✅ | HorometroEntryForm | 3 mutators, no-bloqueo (8). |
| src/hooks/useHazmatInventory.ts | 215 | ✅ | HazmatStorageManager (no montada) | 7 wrappers. |
| src/hooks/useEquipment.ts | 94 | ✅ | (no montada) | GET equipment por status. |
| src/hooks/useSignaletics.ts | 91 | ✅ | (no montada) | 3 mutators. |
| src/pages/Assets.tsx | 43 | 🔴 | route OperationsRoutes:44 | Solo MaquinariaManager; NO monta QR/horómetro/admin. |
| src/pages/EPP.tsx | 375 | 🟡 | route RiskRoutes:24 | AssignEPP/EPPVerification modals; NO usa useEppFlow ni el flow OC. |
| src/pages/HazmatMap.tsx | 455 | ✅ | route EmergencyRoutes:42 | Usa exposureCalculator real. |
| src/pages/HazmatStorage.tsx | 225 | ✅ | route EmergencyRoutes:43 | Usa segregation real. |
| src/components/equipment/EquipmentAdminPanel.tsx | 663 | 🔴 | hook OK, page NONE | Wired a useEquipmentQr (27) pero sin montar. |
| src/components/equipment/EquipmentQRScannerEntry.tsx | 270 | 🔴 | page NONE | Scanner pre-uso huérfano. |
| src/components/equipment/PreUseChecklistMobile.tsx | 486 | 🔴 | usado por 2 comps huérfanos | Sin alcanzar montaje real. |
| src/components/horometro/HorometroEntryForm.tsx | 265 | 🔴 | hook OK, page NONE | Wired a useHorometro (16), sin montar. |
| src/components/horometro/MaintenanceTaskList.tsx | 223 | 🔴 | page NONE | Huérfano. |
| src/components/horometro/MaintenanceCompleteForm.tsx | 317 | 🔴 | solo MaintenanceTaskList (huérfano) | Cierre con firma biométrica, sin montar. |
| src/components/maintenance/HorometerStatusCard.tsx | 157 | ⚠️🔴 | page NONE | Único consumidor de horometerEngine (con bloqueo); huérfano. |
| src/components/equipment/EquipmentStatusCard.tsx | 165 | 🔴 | page NONE | Huérfano. |
| src/components/hazmat/HazmatStorageManager.tsx | 633 | 🔴 | hook OK, page NONE | Wired a useHazmatInventory + CompatibilityAlert, sin montar. |
| src/components/hazmat/HazmatCompatibilityPanel.tsx | 104 | 🔴 | page NONE | Huérfano. |
| src/components/environmental/WasteInventoryPanel.tsx | — | 🔴 | page NONE | Huérfano. |
| src/components/digital-twin/MaintenanceStatusPanel.tsx | — | ✅ | DigitalTwinFaena.tsx | Panel mantención en gemelo digital (sí montado). |
| src/components/digital-twin/HazmatWindOverlay.tsx | — | ✅ | Site25DPanel.tsx | Overlay viento hazmat (sí montado). |
| src/components/eppFlow/PurchaseOrderSignModal.tsx | — | 🟡 | (verificar montaje) | Modal firma WebAuthn OC; fuera de ledger. |
| src/services/inventoryBackend.ts | 79 | ✅ | gemini whitelist | optimizePPEInventory en ALLOWED_GEMINI_ACTIONS (gemini.ts:181). |
| src/data/epp.ts | 82 | 🟡 | seed | Catálogo seed con `picsum.photos` placeholder image URLs. |
| src/services/zettelkasten/families/assetsFaenaNodeRegistry.ts | 115 | ✅ | RAG family | Catálogo 80 nodos ASSETS_FAENA. |

(Tests `*.test.ts(x)` del bloque presentes y coherentes: equipmentQr, hazmatInventory,
horometro, maintenance, eppFlow ×2, b2d/hazmat, signaletics, +engines puros.)

---

## 4. Para decisión del usuario (❓/⚠️)

- ⚠️ **`horometerEngine.ts` viola la directiva "nunca bloquear maquinaria"**
  (`shouldBlock`, `blockOnMandatory:true`, copy "Bloquear operación":
  `horometerEngine.ts:69,89,117,121`). Coexiste con `horometroService.ts`
  (Bloque 4.1) que SÍ cumple. ¿Retirar/alinear el engine con bloqueo, o solo
  cambiar la copy a "RECOMENDAMOS detener"? Hoy mitigado porque su único
  consumidor (`HorometerStatusCard`) está huérfano.
- ❓ **UI huérfana de toda la familia activos/QR/horómetro.** El backend +
  hooks + componentes existen y están cableados entre sí, pero ningún
  page/route los monta (`Assets.tsx` solo trae `MaquinariaManager`; `EPP.tsx`
  no usa `useEppFlow`/el flow OC). ¿Es intencional (feature-flag pendiente de
  lanzamiento) o regresión de wiring? Si es lo primero, falta gate de feature
  flag + entrada en `docs/stubs-inventory.md` (invariante #13). Hoy NO hay
  entradas B10 en stubs-inventory.md.
- ❓ **`eppFlow` pendingOrders en memoria** (`eppFlow.ts:240`): aceptable para
  MVP demo pero pierde OC pendientes en reinicio y rompe en multi-réplica.
  ¿Persistir a Firestore antes del lanzamiento del flow OC?
- 🔑 **Revalidación server-side de la firma WebAuthn** (`eppFlow.ts:22`):
  decisión consciente de confiar en el ceremony cliente. ¿Aceptar como deuda
  o priorizar dado que la OC autoriza gasto?

---

### Resumen ejecutivo

Audité ~92 archivos del bloque B10 (87 del ledger + eppFlow/useEppFlow/modal +
checkExpiredPpe, no etiquetados). Las **tres directivas se cumplen en el
código**: (1) "nunca bloquear maquinaria" — equipmentQr `/preuse` siempre
persiste y solo recomienda (`equipmentQr.ts:368-417`), horómetro crea task
`open` sin fuera_servicio (`horometro.ts:13-18`); (2) eppFlow no-push con triple
refuerzo: header `X-Praeventio-Pushed-To-Supplier:false` (`eppFlow.ts:561`),
`pushedToSupplier:false` en nodo (`eppInventoryPurchaseFlow.ts:443`) y disclaimer
en PDF (`:846`); (3) WebAuthn 'claim-signing' con TODO revalidación server
(`eppFlow.ts:22`). hazmat es puro-compute sin push a SUSESO
(`hazmatInventory.ts:14`). Todas las rutas montadas, con verifyAuth+
assertProjectMember y audit `await`eado. **Hallazgo top #1 (🔴):** la suite UI de
activos/QR/horómetro (EquipmentAdminPanel, EquipmentQRScannerEntry,
HorometroEntryForm, MaintenanceTaskList, HazmatStorageManager, etc.) está
cableada hook→route pero **ningún page/route la monta** — `Assets.tsx:8` solo
trae MaquinariaManager. **Hallazgo top #2 (⚠️):** `horometerEngine.ts:69,117`
contiene lógica de bloqueo ("shouldBlock"/"Bloquear operación") que contradice
la directiva, mitigado solo porque su consumidor está huérfano. **#3 (🟡):**
`eppFlow` guarda OC pendientes en un Map en memoria (`eppFlow.ts:240`),
volátil y no multi-réplica. No se hizo commit (doc-only).
