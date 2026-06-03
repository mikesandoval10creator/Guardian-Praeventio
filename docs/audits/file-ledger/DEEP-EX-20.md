# DEEP — Lote EX-20 · B9-Inspecciones (FEAT) · 2026-06-03

**Atestación: 55/55 archivos leídos línea por línea.**
DERIVA: `ledger.json` filtrado por `category` startsWith `"FEAT"` && `block ==
"B9-Inspecciones"` (88 matches), ordenado por `path`, slice `[0:55]`. Lista
exacta verificada vía Node contra el ledger.

No repito lo ya cubierto en `DEEP-B9-Inspecciones.md` (libro de obra firmado
mutable + test falso-verde por `signedAt` top-level vs `signature.signedAt`
anidado; SiteBook 3 paths disjuntos `site_book`/`sitebook_entries`/`site_book_entries`;
`site_book_counters` sin regla → default-deny; bbs/checklistBuilder/
formBuilderAdvanced sin persistencia; qrAck 503 vs qrSignature 500;
sitebookSignRoutes sin `assertProjectMember`). Los archivos server de ese set
(offlineInspections, photoEvidence, positiveObservations, qrAck, qrSignature,
sitebook, sitebookSign, sitebookSignRoutes, bbs, checklistBuilder,
formBuilderAdvanced) se re-leyeron pero confirman lo anterior; aquí solo
hallazgos NUEVOS, sobre todo en componentes/hooks/pages.

---

## Hallazgos NUEVOS

### 🔴 N1 — `lighting_audits`: inmutabilidad post-firma ROTA (mismo patrón falso que SiteBook, otra colección)
`src/pages/LightPollutionAudit.tsx:113-125` escribe **client-side** vía `addDoc`
a la colección top-level `lighting_audits` con un campo plano `signed: false` y
**nunca** un `metadata.signedAt`. La regla (`firestore.rules:772-788`) intenta
append-only con:
```
allow update: ... && (!('metadata' in existing()) || existing().metadata.signedAt == null) && ...hasOnly([... 'compliant','signed',...])
```
Como el código NUNCA escribe `metadata`, el guard `!('metadata' in existing())`
es **siempre true** → el documento es **perpetuamente actualizable**, incluyendo
`measurementsLux`, `averageLux`, `compliant` y `signed`. No existe ninguna ruta
(UI ni server — `grep` confirma 0 hits de `lighting_audits` en `src/server/`)
que jamás escriba `metadata.signedAt`, así que la auditoría DS 594 Art. 103
nunca se sella. Esto es exactamente el mismo defecto que el `signedAt` anidado
de SiteBook, pero en una colección distinta y con un actor distinto.

### 🔴 N2 — `lighting_audits`: `auditorUid` spoofeable en create
`LightPollutionAudit.tsx:116` setea `auditorUid: user.uid` desde el cliente. La
regla de create (`firestore.rules:777-779`) solo exige `isProjectMember(incoming().projectId)`
y `metadata.signedAt == null`; **no** valida `incoming().auditorUid ==
request.auth.uid`. Un miembro del proyecto puede crear una auditoría de
iluminación atribuida a otro auditor. Viola el espíritu de la invariante "el
server estampa la identidad" (CLAUDE.md #3) aplicado a escrituras client-SDK.

### 🟡 N3 — `iso_documents` / `iso_improvements`: escritura client-SDK sin server-stamp, sin schema, sin audit
`src/components/audits/ISOManagement.tsx:115` (`addDoc` a `projects/{pid}/iso_documents`)
y `:394` (`addDoc` a `projects/{pid}/iso_improvements`) escriben directo con el
SDK cliente. Las reglas existen (`firestore.rules:346-354`) pero:
- **Sin validación de schema** (cualquier forma de doc pasa).
- **Sin `auditServerEvent`** — operaciones que cambian estado de cumplimiento ISO
  no dejan rastro en `audit_logs` (CLAUDE.md #3, #14).
- **Bug de owner**: la regla de update de `iso_improvements` (`:352`) exige
  `existing().createdBy == request.auth.uid`, pero el create (`ISOManagement.tsx:394`)
  **nunca escribe `createdBy`** → el autor-miembro NO puede editar su propia mejora
  (solo admin/supervisor). Funcionalidad rota + invariante de propiedad inverificable.

### 🟡 N4 — Componentes de auditoría persisten todo como `RiskNode` genérico (sin colección/audit propios)
`AddAuditModal`, `AuditDetailModal`, `ISOAudit`/`ISOChecklist`, `SafetyInspection`,
`AddFindingModal` guardan auditorías/inspecciones/hallazgos llamando
`useRiskEngine().addNode({ type: AUDIT|FINDING, ... })` — no hay colección
`audits`/`inspections`/`findings` dedicada ni `auditServerEvent` para el evento
"auditoría completada". `AddFindingModal` (`:136`) y `Findings.tsx` (`:80`) sí
llaman `logAuditAction` (audit client-side); `AddAuditModal`, `AuditDetailModal`,
`ISOChecklist` y `SafetyInspection` **no** auditan el guardado. La inmutabilidad
post-firma y el folio normativo (DS 76 / 16.744) no aplican a estos nodos: son
nodos de grafo mutables. Deuda de cumplimiento, no exploit.

### 🟡 N5 — `EppInspectionForm`: `tenantId` y `inspectionId` provienen del cliente
`src/components/eppFlow/EppInspectionForm.tsx:38` recibe `tenantId` como prop y
lo inyecta crudo en el payload del flow (`:204 input.tenantId`). El componente no
verifica membresía/tenant; depende 100% de que el server lo haga. Además
`inspectionId: \`insp-${Date.now()}\`` (`:195`) es un ID no-criptográfico y
colisionable (dos inspecciones en el mismo ms → mismo id). Recomendado: derivar
`tenantId` server-side desde el token/proyecto y usar `randomId()`.

### 🟡 N6 — `PreUseChecklistMobile`: idempotency key débil (`Math.random`)
`src/components/equipment/PreUseChecklistMobile.tsx:133`:
`\`${equipment.id}-${Date.now()}-${Math.random().toString(36).slice(2,10)}\``.
Es client-side (la directiva #15 aplica a `src/server/`), pero como **clave de
idempotencia** un `Math.random()` de 8 chars es frágil: en retries offline o
doble-tap puede generarse otra key y duplicar el envío, o (raro) colisionar.
Preferir `crypto.randomUUID()` para la idem-key. Contrastar con
`OfflineInspection.tsx` y `PositiveObservations.tsx` que usan
`crypto.randomUUID()`/`randomId()` con fallback documentado.

### 🔵 N7 — Hooks: `import { auth }` muerto + `workerUid` enviado por cliente en qr-signature
`useOfflineInspections.ts:6`, `usePositiveObservations.ts:7`, `useQrSignature.ts:6`
importan `auth` desde firebase pero nunca lo usan (la auth va vía
`apiAuthHeader()`); import muerto cosmético. En `useQrSignature.persistQrAcknowledgement`
(`:41-46`) el payload incluye `workerUid` del cliente; el server fuerza
`acknowledgedByCallerUid` (confirmado en DEEP-B9), así que el `workerUid` typed por
el supervisor representa al *trabajador firmando en presencial* (tablet del
supervisor, `QrSignature.tsx:58,116`), no la identidad del caller — diseño OK,
pero la UI muestra `signedByUid = workerUid` tipeado (`QrSignatureModal` vía
`QrSignature.tsx:132`): es una atestación del supervisor, no una firma del propio
trabajador. Documentar para evitar lectura forense engañosa.

### 🔵 N8 — `FastCheckModal` offline: clasificación fija, sin sello server
`src/components/FastCheckModal.tsx:33-66` en offline crea un `RISK` con
`criticidad:'Media'` hard-coded y `status:'pending_sync'`; depende de
`savePendingOfflineQuery` + reanálisis posterior. Honesto (marca pending), pero el
nodo offline no lleva `capturedByUid` forzado ni timestamp server — confía en
`addNode`. Bajo impacto.

---

## Tabla por archivo (55/55)

| # | Archivo | LOC | Estado | Hallazgo / nota (file:line) |
|---|---|---|---|---|
| 1 | components/FastCheckModal.tsx | 229 | 🔵 | N8 offline risk fijo `:35-66` |
| 2 | components/audit/AuditExpressButton.tsx | 98 | ✅ | UX puro; orquesta bundle server |
| 3 | components/audits/AddAuditModal.tsx | 239 | 🟡 | N4 persiste vía addNode, sin audit `:51` |
| 4 | components/audits/AuditDetailModal.tsx | 367 | 🟡 | N4 update vía updateNode, sin audit `:118` |
| 5 | components/audits/ISOAudit.tsx | 497 | 🟡 | N4 checklist→addNode, sin audit `:145` |
| 6 | components/audits/ISOManagement.tsx | 656 | 🟡 | N3 addDoc client iso_documents/improvements `:115,:394` |
| 7 | components/audits/ISOManagementFilters.tsx | 133 | ✅ | Form presentacional puro |
| 8 | components/audits/ISOManagementHeader.tsx | 131 | ✅ | KPIs presentacional puro |
| 9 | components/behaviorObservation/BbsProfileCard.tsx | 238 | ✅ | Anti-blame; nunca muestra workerUid |
| 10 | components/eppFlow/EppInspectionForm.tsx | 354 | 🟡 | N5 tenantId/inspectionId cliente `:204,:195` |
| 11 | components/equipment/PreUseChecklistMobile.tsx | 487 | 🟡 | N6 idem-key Math.random `:133` |
| 12 | components/evidenceChain/CustodyChainTimelineCard.tsx | 149 | ✅ | Presentacional; render hash+timeline |
| 13 | components/expirations/ExpirationsListPanel.tsx | 146 | ✅ | Wrapper de scanForExpirations puro |
| 14 | components/findings/AddFindingModal.tsx | 416 | ✅ | addNode + logAuditAction `:136` |
| 15 | components/fiveS/FiveSAuditForm.tsx | 159 | ✅ | Form controlado; engine puro |
| 16 | components/hvac/AirQualityPanel.tsx | 134 | ✅ | Render thermalModel puro |
| 17 | components/internalTransit/VehiclePreOpChecklistCard.tsx | 322 | ✅ | Controlado; live-validation correcta |
| 18 | components/measurements/MeasurementQualityCard.tsx | 109 | ✅ | Wrapper buildQualityReport puro |
| 19 | components/photoEvidence/PhotoEvidenceCard.tsx | 95 | ✅ | Presentacional; render artifact |
| 20 | components/positiveObservations/PositiveObservationsBoard.tsx | 159 | ✅ | Presentacional; balance §215 |
| 21 | components/qrSignature/QrSignatureModal.tsx | 197 | ✅ | Stale-ack guard correcto `:48,:71` |
| 22 | components/safety/SafetyInspection.tsx | 238 | 🟡 | N4 addNode sin audit `:50`; id=Date.now `:34` |
| 23 | components/siteBook/NewEntryForm.tsx | 241 | 🔵 | min(15) vs servicio>=20 (ya en B9) |
| 24 | components/siteBook/SiteBookViewer.tsx | 138 | ✅ | Read-only viewer |
| 25 | hooks/useChecklistBuilder.ts | 125 | ✅ | Thin authedFetch; stateless |
| 26 | hooks/useExpirations.ts | 102 | ✅ | Thin authedFetch; stateless |
| 27 | hooks/useExpressBundle.ts | 78 | ✅ | Thin authedFetch |
| 28 | hooks/useFiveS.ts | 92 | ✅ | Thin authedFetch |
| 29 | hooks/useFormBuilderAdvanced.ts | 143 | ✅ | Thin authedFetch; stateless |
| 30 | hooks/useOfflineInspections.ts | 170 | 🔵 | N7 import auth muerto `:6` |
| 31 | hooks/usePhotoEvidence.ts | 151 | ✅ | capturedByUid Omit del payload `:103` |
| 32 | hooks/usePositiveObservations.ts | 111 | 🔵 | N7 import auth muerto `:7` |
| 33 | hooks/useQrAck.ts | 105 | ✅ | createdByUid/scannedByUid forzados server (docstring) |
| 34 | hooks/useQrSignature.ts | 74 | 🔵 | N7 workerUid cliente `:43`; import auth muerto `:6` |
| 35 | pages/Audits.tsx | 266 | ✅ | Wrapper; filtra RiskNode AUDIT |
| 36 | pages/CustodyChain.tsx | 352 | ✅ | Render de props; sin fetch |
| 37 | pages/Findings.tsx | 373 | ✅ | logAuditAction en plan `:80` |
| 38 | pages/LightPollutionAudit.tsx | 242 | 🔴 | N1 signedAt-gate roto `:113`; N2 auditorUid spoof `:116` |
| 39 | pages/OfflineInspection.tsx | 1209 | ✅ | Ejemplar: randomId, flush-lock, 409 re-key `:312,:363` |
| 40 | pages/PositiveObservations.tsx | 762 | ✅ | crypto.randomUUID + fallback `:298`; observerUid server |
| 41 | pages/QrSignature.tsx | 371 | 🔵 | N7 biometría honesta `:94`; signedByUid=workerUid tipeado |
| 42 | pages/SiteBook.tsx | 338 | 🔴 | Confirma B9: nextSequenceForYear+saveSiteBookEntry client cross-path `:141,:154` |
| 43 | server/routes/bbs.ts | 171 | ✅ | (B9) compute puro, observerUid=caller |
| 44 | server/routes/checklistBuilder.ts | 232 | ✅ | (B9) compute puro, override identidad |
| 45 | server/routes/fiveS.ts | 158 | ✅ | verifyAuth+assertProjectMember, compute puro `:47` |
| 46 | server/routes/formBuilderAdvanced.ts | 266 | ✅ | (B9) compute puro stateless |
| 47 | server/routes/offlineInspections.ts | 495 | ✅ | (B9) txn + idempotencia 3-way |
| 48 | server/routes/photoEvidence.ts | 223 | ✅ | (B9) capturedByUid forzado |
| 49 | server/routes/positiveObservations.ts | 379 | ✅ | (B9) observerUid forzado, paginación |
| 50 | server/routes/qrAck.ts | 253 | ✅ | (B9) 503 honesto, replay-protect txn |
| 51 | server/routes/qrSignature.ts | 357 | 🟡 | (B9) 500 vs 503 ante secret ausente |
| 52 | server/routes/sitebook.ts | 180 | 🔵 | (B9) min(15) vs servicio>=20 |
| 53 | server/routes/sitebookSign.ts | 277 | ✅ | (B9) WebAuthn, hash re-computado server |
| 54 | server/routes/sitebookSignRoutes.ts | 190 | 🟡 | (B9) sin assertProjectMember |
| 55 | services/behaviorObservation/bbsObservationEngine.ts | 216 | ✅ | Puro; anti-PII (RUT/nombres) + tenant-isolation `:96,:154` |

## Archivos limpios (sin hallazgo nuevo): 2,7,8,9,12,13,14,15,16,17,18,19,20,21,24,25,26,27,28,29,31,33,35,36,37,39,40,43,44,45,46,47,48,49,50,53,55 (37/55).

---

## Resumen (6-10 líneas)

Lote EX-20 — 55/55 leídos. Dos hallazgos 🔴 NUEVOS, ambos del mismo patrón
"firma falsa" que ya golpeó a SiteBook: (N1) `lighting_audits` declara
append-only en `firestore.rules` vía `metadata.signedAt`, pero
`LightPollutionAudit.tsx` jamás escribe `metadata` (usa un `signed:false` plano)
→ el documento queda perpetuamente mutable y la auditoría DS 594 nunca se sella;
(N2) su `auditorUid` es client-set sin chequeo de igualdad con el caller →
spoofeable. 🟡: las sub-colecciones ISO (`iso_documents`/`iso_improvements`) se
escriben con SDK cliente sin schema, sin `auditServerEvent`, y el gate de update
de improvements referencia un `createdBy` que el create nunca escribe (autor no
puede editar lo suyo). Varios componentes de auditoría/inspección persisten como
`RiskNode` genérico mutable sin audit ni folio normativo (N4). `EppInspectionForm`
toma `tenantId` del cliente y genera `insp-${Date.now()}` colisionable (N5);
`PreUseChecklistMobile` usa `Math.random` como idem-key (N6). En contraste,
`OfflineInspection.tsx` y `PositiveObservations.tsx` son ejemplares (randomId,
flush-lock, 409 re-key, crypto.randomUUID). Los engines puros (bbs, fiveS,
expirations) y los hooks thin-wrapper están limpios salvo imports `auth` muertos.
Doc-only, sin commit.
