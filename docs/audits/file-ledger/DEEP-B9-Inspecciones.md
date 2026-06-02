# DEEP — B9 Inspecciones, Checklists & Observaciones · 2026-06-02

**Archivos revisados:** 124 listados en el ledger bajo `block=="B9-Inspecciones"`.
De estos, ~50 son del subárbol `src/services/observability/*` + `docs/observability/*`
+ `docs/security/*` + `docs/a11y/*` (mis-etiquetados — pertenecen a un bloque de
observabilidad/seguridad, no a inspecciones). El núcleo funcional real de B9 son
los ~40 archivos de los dominios offlineInspections, photoEvidence, qrAck,
qrSignature, sitebook(+sign), bbs, checklistBuilder, formBuilderAdvanced y
positiveObservations, que se revisaron A FONDO. Lectura profunda directa: 12
archivos server/services + verificación cruzada de `firestore.rules`,
`server.ts` (mounts) y rules-tests.

---

## 1. Lo que YA HACE (implementado y real)

- **offlineInspections** (`src/server/routes/offlineInspections.ts`, 494 LOC):
  CRUD project-scoped sólido. Append de observaciones vía
  `db.runTransaction` (`:334`) con **idempotencia 3-way real**: same-content →
  200 dup (`:380`), completed-retry → 200 (`:369`), content-mismatch → 409
  `observation_id_conflict` (`:387`), completed con id nuevo → 409 (`:376`).
  Start es idempotente por doc-id (`:229`). Fallback honesto a missing-index
  sólo en `FAILED_PRECONDITION` (`:153-167`). Audit log `await`ed (`:412`,
  `:470`). ✅
- **photoEvidence** (`src/server/routes/photoEvidence.ts`, 222 LOC):
  `capturedByUid` **forzado** al caller, anti-tampering explícito
  (`:111-114` "Caller uid wins over body uid"). El engine además exige el
  campo (`photoEvidenceEngine.ts:132-133` `missing_uid`). `contentHash`
  validado regex sha256 (`:83`), linkages 1..10 (`:95`), 422 tipado en
  `PhotoEvidenceValidationError`. ✅
- **qrAck** (`src/server/routes/qrAck.ts`, 252 LOC): **503 honesto** si falta
  `QR_ACK_HMAC_SECRET` (≥32 bytes) en ambos endpoints (`:116-119`, `:177-180`).
  Replay protection vía transacción Firestore sobre `qr_ack_used_scans/{sid|uid}`
  (`:207-234`) — doble-firma imposible. `scannedByUid`/`createdByUid` forzados
  al caller (`:188`, `:123`). HMAC verify constant-time (`timingSafeEqual`,
  `:86`). TTL 7d en el record (`:222`). ✅🔑
- **qrSignature** (`src/server/routes/qrSignature.ts`, 356 LOC): challenge
  persistido server-side, role-gate (supervisor/prevencionista/admin, `:159`),
  acknowledge en transacción con verify HMAC + idempotencia (`:266-321`),
  `initiatedByUid`/`acknowledgedByCallerUid` server-controlled. ✅
- **sitebookSign** (`src/server/routes/sitebookSign.ts`, 276 LOC): **WebAuthn
  real**. Hash del payload se **re-computa server-side** desde la entry
  persistida (`:145`, `:230`) → corta cliente comprometido (`hash_mismatch`).
  Challenge **derivado** del hash, no random (`:157`). Challenge consume
  atómico + TTL 5min. Firma sólo persiste si TODAS las capas pasan
  (`:253-267`). Mapa de status HTTP completo (`sitebookSignRoutes.ts:67-83`). ✅🔑
- **siteBookService** (`src/services/siteBook/siteBookService.ts`, 296 LOC):
  inmutabilidad post-firma a nivel servicio: `signEntry` lanza `NOT_OPEN` si
  `status!=='open'` (`:193`); correcciones se hacen como **nueva entry**
  referenciando folio original, nunca mutando (`createCorrection`, `:206`). El
  adapter re-verifica open dentro de transacción al firmar
  (`siteBookFirestoreAdapter.ts:152-167`). Folio counter atómico vía
  transacción (`siteBookFirestoreAdapter.ts:109-120`). ✅
- **positiveObservations** (378 LOC): `observerUid`/`observerRole` forzados al
  caller (`:166-167`), paginación con cursor (`:230-247`), balance §215 con
  `count()` aggregates y fallback `safeCount` (`:301`). ✅
- **bbs / checklistBuilder / formBuilderAdvanced**: motores puros, deterministas,
  con override server-side de campos de identidad/auditoría
  (`checklistBuilder.ts:147,187` rectifiedByUid/signedByUid=caller;
  `bbs.ts:99` observerUid=caller). Validación 400 tipada. ✅ (ver §2 sobre
  persistencia)

## 2. Lo que está PENDIENTE (deuda de este bloque)

- 🔴 **SiteBook: tres esquemas de almacenamiento disjuntos.** La firma WebAuthn
  no puede encontrar las entries creadas:
  - Cliente (`siteBookStore.ts:6`): `projects/{pid}/site_book/{entry.id}` +
    counter `projects/{pid}/site_book_counters/{year}` (campo `value`).
  - Server create (`siteBookFirestoreAdapter.ts:78-81`):
    `tenants/{tid}/projects/{pid}/sitebook_entries/{folio}` + counter
    `sitebook_counters/{year}` (campo `lastSequence`).
  - Server WebAuthn sign (`sitebookSignRoutes.ts:94`):
    `projects/{pid}/site_book_entries/{entryId}`.
  Tres colecciones distintas (`site_book` vs `sitebook_entries` vs
  `site_book_entries`), tres doc-keys (id vs folio vs entryId) y dos esquemas de
  prefijo tenant. El cliente de firma envía `entryId: entry.id`
  (`siteBookSigningClient.ts:138`) → la ruta de firma lee/escribe una colección
  que **ninguna ruta de creación puebla**. Flujo de firma efectivamente roto
  cross-path.
- 🔴 **Append-only post-firma NO se enforza en `firestore.rules`.** El gate
  (`firestore.rules:414`, `:422`) es `!('signedAt' in existing())`, pero el
  código de firma nunca escribe un `signedAt` top-level — lo pone anidado en
  `signature.signedAt` (`siteBookSigning.ts:247`) y marca `status:'signed'`. Por
  tanto, para datos reales el gate siempre evalúa true → **entries firmadas
  siguen siendo actualizables desde cliente**. El rules-test pasa en verde
  (`projectScopedStores.rules.test.ts:181`) porque siembra un doc sintético con
  `signedAt` top-level — falsa confianza; la invariante real no se prueba ni se
  cumple. La inmutabilidad sólo existe server-side (`signEntry` NOT_OPEN).
- 🟡 **`site_book_counters` (path cliente) sin regla → default-deny.** No hay
  match para `site_book_counters` ni `sitebook_counters` en `firestore.rules`
  (sólo existe `suseso_counters`, `:1006`). El counter cliente
  `nextSequenceForYear` (`siteBookStore.ts:33`) escribe vía SDK cliente → será
  **denegado por default-deny** en prod. El test
  `siteBookCounter.firestore.test.ts` corre contra el emulador de datos (no
  carga rules), así que no detecta el bloqueo.
- 🟡 **bbs / checklistBuilder / formBuilderAdvanced no persisten ni auditan.**
  Son endpoints stateless de cómputo puro (comentarios `bbs.ts:16`,
  `checklistBuilder.ts:6`). `record-observation` sugiere persistencia pero sólo
  devuelve el objeto; no hay write a Firestore ni `auditServerEvent`. Si el
  registro durable se espera, vive sólo en cliente/offline — no en B9 server.
- 🟡 **Inconsistencia de "honestidad de secreto":** qrAck devuelve 503
  `qr_ack_not_configured`; qrSignature devuelve **500**
  `qr_signature_secret_not_configured` ante `QR_SIG_SECRET` ausente
  (`qrSignature.ts:171-175`, `:249-253`). Debería ser 503 para coherencia.
- 🟡 **Mismatch de validación de descripción SiteBook.** El schema de ruta
  permite `min(15)` (`sitebook.ts:50`) pero el servicio exige `>=20`
  (`siteBookService.ts:154`) → descripciones de 15-19 chars pasan validación
  HTTP y luego 400 `DESCRIPTION_TOO_SHORT`. Cosmético pero confunde.
- 🟡 **sitebookSignRoutes sin `assertProjectMember`.** `/sign/options` y
  `/sign/verify` sólo aplican `verifyAuth` (`sitebookSignRoutes.ts:115`,
  `:143`); no verifican membresía de proyecto (CLAUDE.md #6 exige
  `assertProjectMember` en rutas con `projectId`). El hash-rebind mitiga
  manipulación pero un miembro de otro proyecto podría enumerar/firmar entries.

## 3. Tabla por archivo (núcleo B9 revisado)

| Archivo | LOC | Estado | Cableado | Propósito + hallazgo file:line |
|---|---|---|---|---|
| src/server/routes/offlineInspections.ts | 494 | ✅ | server.ts:1016 `/api/sprint-k` | CRUD offline; txn + idempotencia 3-way `:334,:380` |
| src/server/routes/offlineInspections.test.ts | — | ✅ | vitest | supertest 401/200/409 |
| src/server/routes/photoEvidence.ts | 222 | ✅🔑 | server.ts:1047 | metadata+linkages; capturedByUid forzado `:111-114` |
| src/server/routes/qrAck.ts | 252 | ✅🔑 | server.ts:1110 | 503 honesto `:116`; replay txn `:207` |
| src/server/routes/qrSignature.ts | 356 | 🟡 | server.ts:1017 | challenge+ack txn; usa 500 no 503 `:171` |
| src/server/routes/sitebook.ts | 179 | 🟡 | server.ts:990 `/api/sitebook` | create folio atómico; min desc 15≠20 `:50` |
| src/server/routes/sitebookSign.ts | 276 | ✅🔑 | via sitebookSignRoutes | WebAuthn; hash re-compute `:145,:230` |
| src/server/routes/sitebookSignRoutes.ts | 189 | 🔴 | server.ts:1322 | path `projects/{pid}/site_book_entries` ≠ create `:94`; sin assertProjectMember `:115` |
| src/server/routes/bbs.ts | 170 | 🟡 | server.ts:1113 | cómputo puro; no persiste/audita `:16` |
| src/server/routes/checklistBuilder.ts | 231 | 🟡 | server.ts:1059 | cómputo puro; signedByUid=caller `:187`; no persiste |
| src/server/routes/formBuilderAdvanced.ts | 265 | 🟡 | server.ts:1069 | evaluador determinista; no eval/Function `:35`; no persiste |
| src/server/routes/positiveObservations.ts | 378 | ✅ | server.ts:1004 | observerUid forzado `:166`; balance count() `:328` |
| src/services/siteBook/siteBookService.ts | 296 | ✅ | importado por adapter/route | signEntry NOT_OPEN `:193`; createCorrection `:206` |
| src/services/siteBook/siteBookFirestoreAdapter.ts | 387 | 🔴 | sitebook.ts | counter atómico `:109`; path `tenants/.../sitebook_entries` `:78` (disjunto del sign route) |
| src/services/siteBook/siteBookStore.ts | 63 | 🟡 | cliente | path `site_book` + counter sin regla `:25` |
| src/services/siteBook/siteBookSigning.ts | 253 | ✅🔑 | sitebookSign | buildSignatureRecord; signedAt anidado `:247` |
| src/services/siteBook/siteBookSigningClient.ts | — | 🟡 | cliente | envía entryId=entry.id `:138` (hash, no folio) |
| src/services/siteBook/siteBookCrdt.ts | 497 | 🔵 | adapter merge | CRDT multi-supervisor drafts |
| src/services/inspections/offlineInspectionService.ts | 253 | ✅ | route/offline | servicio puro inspecciones |
| src/services/inspections/inspectionOutbox.ts | 553 | ✅ | offline sync | outbox IndexedDB |
| src/services/photoEvidence/photoEvidenceEngine.ts | 274 | ✅ | route | exige capturedByUid `:132` |
| src/services/qrAck/qrAckSessionEngine.ts | 367 | ✅ | route | crypto.getRandomValues; Math.random sólo fallback documentado `:156-164` |
| src/services/qrSignature/qrSignatureService.ts | — | ✅ | route | buildChallenge/verifyChallenge HMAC |
| src/services/behaviorObservation/bbsObservationEngine.ts | — | ✅ | route | recordObservation/buildProfile puro |
| src/services/checklistBuilder/checklistBuilder.ts | — | ✅ | route | validate/rectify/sign/lock puro |
| src/services/formBuilderAdvanced/advancedFieldEngine.ts | — | ✅ | route | evaluador recursivo sin eval |
| src/services/positiveObservations/*Service/*Adapter.ts | — | ✅ | route | persiste positive_observations |
| firestore.rules (site_book*, counters) | — | 🔴 | rules | gate signedAt no aplica a datos reales `:414,:422`; counters sin regla |
| src/rules-tests/projectScopedStores.rules.test.ts | — | 🔴 | test:rules | siembra signedAt sintético `:181` → falso verde |
| Hooks (useChecklistBuilder, useFormBuilderAdvanced, useOfflineInspections, usePhotoEvidence, usePositiveObservations, useQrAck, useQrSignature) | — | ✅ | pages | wrappers fetch a `/api/sprint-k/*` |
| Pages (OfflineInspection 1208, SiteBook 337, Findings 372, QrSignature 370, PositiveObservations 761) | — | ✅ | rutas lazy | UI; sin stubs/NotImplemented detectados |
| Components (BbsProfileCard, EppInspectionForm, PreUseChecklistMobile, AddFindingModal, VehiclePreOpChecklistCard, PhotoEvidenceCard, PositiveObservationsBoard, QrSignatureModal, SafetyInspection, SiteBook NewEntryForm/Viewer) | — | ✅ | pages | UI; tests presentes |
| Subárbol observability/* + docs/* (~50 files) | — | 🔵 | — | Mis-etiquetados en ledger; fuera de scope funcional B9 |

## 4. Para decisión del usuario (❓/⚠️)

- ⚠️ **SiteBook path divergence (🔴).** ¿Cuál es el path canónico —
  `tenants/.../sitebook_entries` (server), `site_book` (cliente) o
  `site_book_entries` (sign)? Hoy la firma WebAuthn no opera sobre las entries
  creadas por ninguna de las otras dos rutas. Requiere decisión de unificación
  + migración (KMS/rules entry si toca PII).
- ⚠️ **Append-only post-firma (🔴).** El rules gate usa `signedAt` top-level que
  el código nunca escribe. Decidir: ¿cambiar la regla a
  `existing().status != 'signed'` (o `'signature' in existing()`)? Y corregir
  el rules-test para sembrar `status:'signed'` sin `signedAt` espurio, de modo
  que pruebe la invariante real (CLAUDE.md #20).
- ⚠️ **`site_book_counters` sin regla (🟡).** El counter cliente será denegado en
  prod. Decidir: agregar regla explícita (server-only o member-write) o mover el
  counter 100% server-side (ya existe `sitebook_counters` Admin-SDK).
- ❓ **bbs/checklist/formBuilder sin persistencia ni audit (🟡).** ¿Es por diseño
  (offline-first, persiste IndexedDB en device) o falta el write durable +
  `auditServerEvent`? Si es compliance-relevante (firmas de checklist), la
  ausencia de rastro server-side viola el invariante de audit-log.
- ❓ **qrSignature 500→503 y sitebookSign assertProjectMember (🟡).** Confirmar si
  se endurecen para coherencia con qrAck y CLAUDE.md #6.
