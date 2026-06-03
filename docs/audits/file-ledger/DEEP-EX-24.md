# DEEP — Lote EX-24 · B10-EPP, Activos & Mantenimiento (FEAT) · 2026-06-03

**Atestación: 55/55 archivos leídos línea por línea.**
DERIVA: `ledger.json` filtrado por `category` startsWith `"FEAT"` && `block ==
"B10-EPP"` (62 matches), ordenado por `path`, slice `[0:55]`. Lista exacta
verificada vía Node contra el ledger.

No repito lo ya cubierto en `DEEP-B10-EPP.md` (lógica de bloqueo contradictoria
de `horometerEngine.ts`; suite UI activos/QR/horómetro cableada pero NO montada
por ningún page/route; `eppFlow` OC pendientes en `Map` en memoria volátil
`eppFlow.ts:240`; `companyName:'Empresa'` hardcoded `eppFlow.ts:505`; TODO
revalidación server WebAuthn `eppFlow.ts:22`; hazmat/signaletics puro-compute
sin push a SUSESO; las directivas no-bloqueo/no-push CUMPLIDAS en
equipmentQr/horometro/eppFlow). Aquí solo hallazgos NUEVOS, concentrados en los
modales EPP cliente-SDK, el detector EPP "on-device", el reaper sin audit y los
idem-keys `Math.random` cliente.

---

## Hallazgos NUEVOS

### 🔴 N1 — La foto del trabajador SÍ va a la nube en los modales EPP (viola directiva #12 + contradice el header on-device)
`src/components/epp/EPPVerificationModal.tsx:63` y
`src/components/workers/AIEPPScannerModal.tsx:43` llaman
`verifyEPPWithAI(base64Image, ...)`, que es un wrapper HTTP a la acción cloud
`/api/gemini` action `verifyEPPWithAI` (`geminiService.ts:105`;
`gemini.ts:169`). Es decir: la imagen del trabajador (base64) **sale del
dispositivo y se envía a Gemini cloud**. Esto contradice:
- la directiva #12 ("Biometric processing is 100% on-device … No camera frames
  … leave the device"), y
- el propio `eppDetectorOnDevice.ts` cuyo header (`:24-30`) promete "La IMAGEN
  nunca sale del dispositivo. Solo el RESULT … se sincroniza", y el comentario
  histórico `:12-14` que marca el path Gemini-vision como "P0 LIE de marketing".
El detector real on-device (`ColorBasedEppDetector`) EXISTE y está cableado a
`VisionAnalyzer.tsx` + `gemini/vision.ts`, pero **los tres modales del bloque
EPP (`EPPVerificationModal`, `AIEPPScannerModal`, vía `EPPModal`→`EPP.tsx`) NO
lo usan** — siguen en el path cloud. Es la regresión/incongruencia más seria
del lote y debería decidirse explícitamente (migrar los modales al detector
on-device, o documentar por qué este flujo es excepción a #12).

### 🟡 N2 — `MockEppDetector` activo en producción como path síncrono (stub disfrazado, sin inventario #13)
`eppDetectorOnDevice.ts:361-363` `getEppDetectorImplSync()` devuelve
**`MockEppDetector`** (detecciones sintéticas fijas: casco 0.92, chaleco 0.88,
botas 0.71, gafas 0.45 — `:170-177`). El header del archivo (`:31-42`) lo
reconoce como STUB pendiente del modelo TFLite real ("Real TFLite loader:
STUB"). No tiene `// TODO(sprint-N): <owner>` formal, no está tras feature-flag,
y **no aparece en `docs/stubs-inventory.md`** → incumple la invariante #13
(anti-stub-disfrazado). El path async `getEppDetectorImpl('auto')` sí degrada al
`ColorBasedEppDetector` real, pero el sync sigue sirviendo mock a cualquier
caller que no pueda esperar el import dinámico.

### 🟡 N3 — Toda la familia de modales EPP escribe Firestore client-SDK sin server-stamp ni `auditServerEvent` (#3/#14)
Cinco escrituras de estado vía SDK cliente, sin pasar por server, sin
`audit_logs`:
- `AssignEPPModal.tsx:88` `addDoc(epp_assignments)` + `:107` `addDoc(documents)`
  + `:121` `updateDoc(epp_items, stock-1)` — la entrega de EPP (acta legal Ley
  16.744) no deja rastro en `audit_logs`; `uploadedBy` se setea desde
  `user.displayName` del cliente (`:114`), spoofeable.
- `EPPVerificationModal.tsx:77` `addDoc(epp_verifications)` — la verificación de
  cumplimiento EPP se persiste client-side sin audit.
- `EPP.tsx:77` `handleAddItem` → `addDoc(epp_items)` sin audit.
- `EPPModal.tsx:53` `updateDoc(workers, {eppIds})` sin audit.
Todas dependen 100% de `firestore.rules` para autorización; ninguna registra el
evento en la cadena de auditoría de cumplimiento. Contrasta con el path server
(`eppFlow`, `equipmentQr`, `horometro`) que sí audita y await-ea (#14).

### 🟡 N4 — `MaquinariaManager`: `assets` escrito client-SDK sin audit ni server-stamp
`src/components/projects/MaquinariaManager.tsx:71` `addDoc(collection(db,
'assets'), assetData)` (online) / `saveForSync` (offline). Colección `assets`
top-level escrita directo, sin `auditServerEvent`, sin validar que `projectId`
del payload corresponda al miembro. Es el único componente que `Assets.tsx`
monta (`Assets.tsx:29`), así que es el path productivo real de alta de activos —
y queda fuera del trail de auditoría. (La suite QR/horómetro que sí audita está
huérfana — ver `DEEP-B10-EPP.md`.)

### 🟡 N5 — `checkOverdueMaintenance` flipea lifecycle + estado de evento SIN escribir `audit_logs` (#3)
`src/server/jobs/checkOverdueMaintenance.ts:121` hace
`objRef.update({lifecycle:'maintenance_due'})` y `:132`
`doc.ref.update({status:'overdue'})` — dos operaciones que **cambian estado**
sobre `placed_objects` y `calendar_events`, pero el job **no escribe ninguna
fila `audit_logs`**. Su hermano `checkExpiredPpe.ts:147` SÍ audita cada
transición (`action:'ppe.expired'`). Asimetría: el cambio automático de
lifecycle de un equipo a "mantención vencida" no deja rastro auditable de quién/
cuándo (aunque sea el sistema). State-changing job sin audit = incumple el
espíritu de #3.

### 🟡 N6 — Idem-keys `Math.random()` en cuatro componentes cliente (frágil para retry offline / doble-tap)
Cuatro idem-keys construidas con `Math.random().toString(36)`:
- `EquipmentAdminPanel.tsx:313` `register-${Date.now()}-${Math.random()...}`
- `HorometroEntryForm.tsx:60` `${eq.id}-${hours}-${Date.now()}-${Math.random()...}`
- `MaintenanceCompleteForm.tsx:105` `${task.id}-complete-${Date.now()}-${Math.random()...}`
- `HazmatStorageManager.tsx:78` `newItemId()` fallback `hzm_${Date.now()}_${Math.random()...}`
La directiva #15 (`Math.random` prohibido) aplica a `src/server/` — esto es
cliente, así que no la viola. Pero como **clave de idempotencia** un
`Math.random` corto es frágil: un retry offline o doble-tap puede generar otra
key y duplicar el POST. `HazmatStorageManager` y `MaintenanceCompleteForm`
prefieren `crypto.randomUUID()` cuando existe (correcto) y caen a `Math.random`;
`EquipmentAdminPanel` y `HorometroEntryForm` usan `Math.random` directo sin
preferir UUID. Patrón ya señalado en EX-20 N6 (PreUseChecklistMobile) — se
repite aquí en cuatro lugares más. Recomendado: `crypto.randomUUID()` para
todas las idem-keys.

### 🟡 N7 — `HorometerStatusCard` renderiza copy "Equipo BLOQUEADO" (superficie del engine que viola no-bloqueo)
`src/components/maintenance/HorometerStatusCard.tsx:119-127` consume
`status.shouldBlock` de `horometerEngine.ts` y, si es `true`, renderiza
literalmente "Equipo BLOQUEADO hasta completar mantención". Es la **superficie
UI** del engine paralelo con lógica de bloqueo ya señalado en `DEEP-B10-EPP.md`
(`horometerEngine.ts:69,117`). Confirmado: la card es el único consumidor y
sigue huérfana (no montada), por lo que no hay riesgo productivo HOY, pero el
vocabulario "BLOQUEADO" contradice la directiva del fundador y debería alinearse
con "RECOMENDAMOS detener" antes de montar la card.

### 🔵 N8 — Soft-block emergente: pre-use de equipo crítico se auto-pone `fuera_servicio`, y el siguiente pre-use rebota con 422
`equipmentQrService.ts:171-173`: un pre-use `failed` en equipo
`critical`/`high` deriva `fuera_servicio`, que el route persiste
(`equipmentQr.ts:382`). Pero `runPreUseValidation` (`:122`) lanza
`EQUIPMENT_NOT_AVAILABLE` si el status NO es `operativo`/`restringido` → el route
responde 422 (`equipmentQr.ts:360`). Resultado: tras una falla crítica, el
SIGUIENTE trabajador que escanee el QR **no puede ni registrar su pre-use**
(rebota 422), un bloqueo blando emergente de la interacción de dos piezas que
individualmente "solo recomiendan". No es un flag `blocked:true` literal (por eso
🔵), pero el efecto operacional se parece a un bloqueo. Vale documentar la
intención (¿es deseable que un equipo crítico fallado quede sin poder
re-inspeccionarse vía QR hasta que un supervisor lo reabra?).

### 🔵 N9 — `hazmatExtensions.ts` engine completo (354 LOC) con CERO consumidores
`src/services/hazmat/hazmatExtensions.ts` (substanceQrLookup, spillProtocol×10
familias, storageCompatibilityCheck GHS, checkWasteCapacity, eyewash registry)
es un engine puro y bien hecho pero `grep` confirma **0 consumidores
no-test**. Es código muerto de cara al usuario (paralelo a
`hazmatInventory.ts`/`hazmatSegregation.ts` que SÍ se consumen). Sin entrada en
stubs-inventory. Deuda de wiring, no exploit.

### 🔵 N10 — `useEquipment.ts`: import `auth` muerto
`src/hooks/useEquipment.ts:7` `import { auth } from '../services/firebase'`
nunca se usa (la auth va por `apiAuthHeader()` `:12`). Mismo patrón cosmético
que EX-20 N7. Bajo impacto.

---

## Tabla por archivo (55/55)

| # | Archivo | LOC | Estado | Hallazgo / nota (file:line) |
|---|---|---|---|---|
| 1 | components/digital-twin/HazmatWindOverlay.tsx | 148 | ✅ | Montado en Site25DPanel; overlay viento puro |
| 2 | components/digital-twin/MaintenanceStatusPanel.tsx | 311 | ✅ | Montado DigitalTwinFaena; lee calendar_events read-only |
| 3 | components/engineering/HazmatStorageDesigner.tsx | 533 | ✅ | Montado AIHub/CalculatorHub; persiste vía scratch/writeNodesDebounced |
| 4 | components/environmental/WasteInventoryPanel.tsx | 132 | 🔴 | Presentacional puro; page NONE (huérfano, ver B10) |
| 5 | components/epp/AssignEPPModal.tsx | 278 | 🟡 | N3 addDoc client epp_assignments/documents sin audit `:88,:107`; uploadedBy cliente `:114` |
| 6 | components/epp/EPPVerificationModal.tsx | 357 | 🔴🟡 | N1 verifyEPPWithAI cloud `:63`; N3 addDoc epp_verifications sin audit `:77` |
| 7 | components/eppFlow/PendingPurchaseOrdersPanel.tsx | 177 | ✅ | Polling de pending-orders; UI pura |
| 8 | components/eppFlow/PurchaseOrderSignModal.tsx | 291 | 🟡 | WebAuthn OC; challengeId `chal-${Date.now()}` placeholder `:107` (ver B10 TODO) |
| 9 | components/equipment/EquipmentAdminPanel.tsx | 663 | 🔴🟡 | N6 idem-key Math.random `:313`; page NONE (B10) |
| 10 | components/equipment/EquipmentQRScannerEntry.tsx | 270 | 🔴 | Scanner pre-uso huérfano (B10) |
| 11 | components/equipment/EquipmentStatusCard.tsx | 165 | 🔴 | Presentacional; page NONE (B10) |
| 12 | components/hazmat/HazmatCompatibilityAlert.tsx | 141 | ✅ | Copy no-bloqueo correcta ("recomendamos trasladar") `:107` |
| 13 | components/hazmat/HazmatCompatibilityPanel.tsx | 104 | 🔴 | Presentacional; page NONE (B10) |
| 14 | components/hazmat/HazmatStorageManager.tsx | 633 | 🔴🟡 | N6 idem-key fallback Math.random `:78`; page NONE (B10) |
| 15 | components/horometro/HorometroEntryForm.tsx | 265 | 🔴🟡 | N6 idem-key Math.random `:60`; page NONE (B10) |
| 16 | components/horometro/MaintenanceCompleteForm.tsx | 317 | 🔴🟡 | N6 idem-key Math.random `:105`; signatureHash local provisional `:100`; page NONE |
| 17 | components/horometro/MaintenanceTaskList.tsx | 223 | 🔴 | Lista tareas; page NONE (B10) |
| 18 | components/maintenance/HorometerStatusCard.tsx | 157 | ⚠️🔴 | N7 copy "Equipo BLOQUEADO" `:126`; único consumidor de horometerEngine; huérfano |
| 19 | components/projects/MaquinariaManager.tsx | 281 | 🟡 | N4 addDoc assets sin audit `:71`; montado en Assets.tsx |
| 20 | components/workers/AIEPPScannerModal.tsx | 269 | 🔴 | N1 verifyEPPWithAI cloud `:43` (la foto sale del device) |
| 21 | components/workers/EPPModal.tsx | 223 | 🟡 | N3 updateDoc workers eppIds sin audit `:53`; abre AIEPPScannerModal |
| 22 | hooks/useEppFlow.ts | 195 | ✅ | 4 mutators thin; no-push reflejado `:149` |
| 23 | hooks/useEquipment.ts | 95 | 🔵 | N10 import auth muerto `:7` |
| 24 | hooks/useEquipmentQr.ts | 203 | ✅ | 5 wrappers; docstring no-bloqueo `:10-16` |
| 25 | hooks/useHazmatInventory.ts | 216 | ✅ | 7 wrappers; idempotency-key-ready |
| 26 | hooks/useHorometro.ts | 137 | ✅ | 3 wrappers; docstring no-bloqueo `:8-11` |
| 27 | hooks/useSignaletics.ts | 92 | ✅ | 3 mutators stateless |
| 28 | pages/Assets.tsx | 43 | 🔴 | Solo monta MaquinariaManager; no QR/horómetro (B10) |
| 29 | pages/ControlsAndMaterials.tsx | 189 | 🔵 | onSnapshot controls/materials read-only; botón "Nuevo" sin handler (no-op) `:112` |
| 30 | pages/EPP.tsx | 375 | 🔴🟡 | N3 handleAddItem addDoc epp_items sin audit `:77`; monta AssignEPP/EPPVerification |
| 31 | pages/HazmatMap.tsx | 455 | ✅ | Usa exposureCalculator real + viento real (B10) |
| 32 | pages/HazmatStorage.tsx | 225 | ✅ | Usa segregation IMDG real (B10) |
| 33 | pages/OcSugerida.tsx | 303 | ✅ | Self-contained; export CSV client-side; sin push |
| 34 | pages/Transparencia.tsx | 374 | ✅ | Pricing transparencia; lee tiers.ts; sin escritura |
| 35 | server/jobs/checkExpiredPpe.ts | 212 | ✅ | EPP vencido→expired + audit `:147` + FCM; idempotente |
| 36 | server/jobs/checkOverdueMaintenance.ts | 140 | 🟡 | N5 flip lifecycle+evento SIN audit_logs `:121,:132` |
| 37 | server/routes/b2d/hazmat.ts | 209 | ✅ | 4 cálculos Bernoulli b2dAuth; sin tenant data (B10) |
| 38 | server/routes/eppFlow.ts | 580 | 🟡 | (B10) Map memoria `:240`; TODO firma `:22`; no valida tenantId vs token al firmar |
| 39 | server/routes/equipment.ts | 77 | ✅ | GET equipment; verifyAuth+assertProjectMember |
| 40 | server/routes/equipmentQr.ts | 473 | ✅ | preuse nunca 4xx por checklist; copy RECOMENDAMOS `:406` (B10) |
| 41 | server/routes/hazmatInventory.ts | 376 | ✅ | 7 endpoints stateless; cliente persiste; no push SUSESO `:14` |
| 42 | server/routes/horometro.ts | 431 | ✅ | reading→task open, jamás fuera_servicio `:13-18` (B10) |
| 43 | server/routes/maintenance.ts | 698 | 🟡 | (B10) cron monolito 8 jobs; verifySchedulerToken `:79` |
| 44 | server/routes/signaletics.ts | 198 | ✅ | 3 endpoints puros ISO 7010; sin Firestore `:15` |
| 45 | services/ai/colorBasedEppDetector.ts | 348 | ✅ | Detector real HSV on-device; determinístico; 7 clases DS 594 |
| 46 | services/ai/eppDetectorOnDevice.ts | 364 | 🟡 | N2 MockEppDetector path sync prod `:361`; STUB TFLite sin stubs-inventory |
| 47 | services/eppBackend.ts | 75 | ✅ | predictEPPReplacement/auditEPPCompliance whitelisted gemini.ts:193-194 |
| 48 | services/equipment/equipmentFirestoreAdapter.ts | 85 | ✅ | Adapter pre_uses subcolección; tenant-scoped paths |
| 49 | services/equipment/equipmentQrService.ts | 177 | 🔵 | N8 soft-block: failed crítico→fuera_servicio→siguiente preuse 422 `:122,:171` |
| 50 | services/hazmat/hazmatExposureCalculator.ts | 276 | ✅ | Radios GRE 2024 reales; determinístico (B10) |
| 51 | services/hazmat/hazmatExtensions.ts | 354 | 🔵 | N9 engine completo con 0 consumidores (código muerto) |
| 52 | services/hazmat/hazmatInventory.ts | 198 | ✅ | Matriz incompat DS 78/NCh 2245; puro (B10) |
| 53 | services/hazmat/hazmatSegregation.ts | 210 | ✅ | Matriz IMDG 7.2.4 real 15 sub-clases; puro (B10) |
| 54 | services/horometro/horometroService.ts | 392 | ✅ | Regresión solo manual `:352`; puro determinista |
| 55 | services/inventoryBackend.ts | 79 | ✅ | optimizePPEInventory whitelisted gemini.ts:181 |

## Archivos limpios (sin hallazgo nuevo): 1,2,3,7,12,22,24,25,26,27,31,32,33,34,35,37,39,40,41,42,44,45,47,48,50,52,53,54,55 (29/55).

---

## Resumen (6-10 líneas)

Lote EX-24 — 55/55 leídos. El hallazgo 🔴 NUEVO top (N1): los tres modales de IA
del bloque EPP (`EPPVerificationModal`, `AIEPPScannerModal`/`EPPModal`,
`EPP.tsx`) llaman `verifyEPPWithAI`, que **sube la foto base64 del trabajador a
Gemini cloud** (`/api/gemini`), contradiciendo la directiva #12 ("biometría/
cámara 100% on-device") y el propio header de `eppDetectorOnDevice.ts` que
promete que la imagen nunca sale del device — el detector real on-device
(`ColorBasedEppDetector`) existe pero esos modales no lo usan. 🟡: el path
síncrono `getEppDetectorImplSync()` aún devuelve `MockEppDetector` en producción,
un stub sin entrada en `stubs-inventory.md` (#13) (N2); toda la familia de
modales EPP + `MaquinariaManager` escribe Firestore client-SDK sin
`auditServerEvent` ni server-stamp (N3/N4, viola #3/#14 para entregas de EPP que
son actas legales); el reaper `checkOverdueMaintenance` flipea lifecycle/eventos
sin escribir `audit_logs` mientras su hermano `checkExpiredPpe` sí lo hace (N5);
cuatro idem-keys cliente usan `Math.random` frágil para retry/doble-tap (N6); y
`HorometerStatusCard` muestra copy "Equipo BLOQUEADO" — superficie del engine
paralelo que viola la directiva no-bloqueo, mitigado solo por estar huérfano
(N7). 🔵: soft-block emergente en pre-use de equipo crítico (failed→fuera_servicio
→siguiente scan rebota 422, N8); `hazmatExtensions.ts` (354 LOC) sin consumidores
(N9); import `auth` muerto en `useEquipment` (N10). Las directivas no-bloqueo y
no-push siguen cumplidas en el path server (equipmentQr/horometro/eppFlow), y los
engines hazmat/signaletics/horometro son puros y reales. Doc-only, sin commit.
</content>
</invoke>
