# DEEP — Lote EX-21 · B9-Inspecciones (FEAT) · 2026-06-03

**Atestación: 33/33 archivos leídos línea por línea.**
DERIVA: `ledger.json` filtrado por `category` startsWith `"FEAT"` && `block ==
"B9-Inspecciones"` (88 matches), ordenado por `path`, slice `[55:88]` (33
archivos). Lista exacta verificada vía Node contra el ledger.

No repito lo ya cubierto en `DEEP-B9-Inspecciones.md` ni `DEEP-EX-20.md`
(SiteBook 3 paths disjuntos `site_book`/`sitebook_entries`/`site_book_entries`;
libro de obra firmado mutable + test falso-verde por `signedAt` top-level vs
`signature.signedAt` anidado; `site_book_counters` sin regla → default-deny;
bbs/checklistBuilder/formBuilderAdvanced sin persistencia/audit;
sitebookSignRoutes sin `assertProjectMember`; qrAck 503 vs qrSignature 500;
`lighting_audits` mutable + `auditorUid` spoofeable; `iso_documents`/
`iso_improvements` sin server-stamp/schema/audit + bug de `createdBy`;
componentes de auditoría como `RiskNode` genérico; `EppInspectionForm` tenantId
del cliente; `PreUseChecklistMobile` idem-key con `Math.random`). Los engines
puros del slice (checklistBuilder, fiveSAudit, advancedFieldEngine,
offlineInspectionService, measurementChain, photoEvidenceEngine,
qrAckSessionEngine, qrSignatureService, positiveObservationsService,
siteBookService, siteBookSigning, siteBookCrdt) se confirmaron deterministas y
con override server-side de identidad/auditoría (vía sus rutas, ya atestiguadas).
Aquí SOLO hallazgos NUEVOS, concentrados en los **adapters Firestore** y el
**subárbol observability** que entraron por primera vez en este slice.

---

## Hallazgos NUEVOS

### 🔴 N1 — `photoEvidenceFirestoreAdapter.save()` nunca escribe `linkageKeys` → query `listForNode` invisible
`src/services/photoEvidence/photoEvidenceFirestoreAdapter.ts:42-57`. El método
`save()` persiste el artifact con su campo `linkages` (array de objetos) pero
**nunca** escribe el campo proyectado `linkageKeys: string[]`. Sin embargo
`listForNode` (`:74-87`) consulta `where('linkageKeys', 'array-contains', key)`
(`:82`) y solo `appendLinkage` (`:118`) escribe `linkageKeys`. Consecuencia: una
evidencia creada por el flujo normal (`save`, que es el que usa la ruta
`photoEvidence.ts:131`) **no aparece** en la galería por nodo padre
(`listForNode`) hasta que alguien invoque `appendLinkage` sobre ella. El comentario
de la clase (`:67-73`) describe la proyección como si `save` la mantuviera, pero
no lo hace → doc-vs-code drift + feature de galería rota para el camino primario.
Bug real, no cosmético: la evidencia foto de un incidente/inspección no se lista.

### 🔴 N2 — `siteBookFirestoreAdapter.mergeAndPersistCrdtDraft()` clobbea entries firmadas (sin re-leer el flat doc) + es código MUERTO sin regla
`src/services/siteBook/siteBookFirestoreAdapter.ts:206-229`. La transacción lee
SOLO el `crdtRef` (draft), hace `mergeCrdtEntries(local, remote)` y luego
`tx.set(flatRef, serialize(crdtToEntry(merged)))` (`:226`) sobre
`sitebook_entries/{folio}` — **sin leer ni verificar `flatRef`**. Si una entry
flat ya fue firmada vía `signAndPersist` (`status:'signed'`), un draft CRDT que
reutilice el mismo `folio` (o `provisionalFolio` colisionado) **sobrescribe** la
entry firmada con la versión del draft, rompiendo la inmutabilidad post-firma a
nivel servidor. La protección `if status==='signed' return e` vive solo DENTRO de
los helpers CRDT (`siteBookCrdt.ts:305,314,...`), no en el `tx.set` del flat doc.
Además: (a) `grep` confirma **0 callers** de `mergeAndPersistCrdtDraft` /
`loadCrdtDraft` en todo el repo — es la capa colaborativa entera sin cablear; (b)
la colección `sitebook_crdt_drafts` (`CRDT_DRAFT_PATH`, `:88`) **no tiene regla**
en `firestore.rules` (default-deny). Es deuda latente: si algún sprint la cablea
sin arreglar el read-of-flatRef y sin regla, se abre el bypass de inmutabilidad.

### 🟡 N3 — Colecciones de adapters sin regla en `firestore.rules` (default-deny para client-SDK)
`grep` contra `firestore.rules` da **NO MATCH** para `photo_evidence`
(`photoEvidenceFirestoreAdapter.ts:27`), `positive_observations`
(`positiveObservationsFirestoreAdapter.ts:16`), `quota_usage`
(`quotaTracker.ts:79`) y `sitebook_crdt_drafts` (ver N2). Hoy todas se escriben
vía Admin SDK server-side (que bypassa rules), y `grep` confirma que ningún
`src/pages|components|hooks` las lee con SDK cliente — así que **no hay leak
hoy**. Pero la invariante CLAUDE.md #4 (toda colección nueva requiere regla
explícita + ≥5 rules-tests + entrada en `security_spec.md`) NO se cumple para
ninguna de las cuatro. Si una futura vista intenta leerlas client-side (p.ej. una
galería de evidencia en tiempo real), fallará silenciosa por default-deny — el
mismo patrón que rompió `site_book_counters` (DEEP-B9). `quota_usage` además
guarda contadores de costo/tenant — su lectura cross-tenant debe estar
explícitamente denegada.

### 🟡 N4 — `siteBookStore.patchSiteBookEntry` permite mutación client-SDK de entries FIRMADAS
`src/services/siteBook/siteBookStore.ts:52-58` expone `store.patch(projectId,
entryId, patch)` con `patch: Partial<SiteBookEntry>` — sin gate de `status`. Como
el store escribe a `projects/{pid}/site_book/{id}` y la regla append-only de esa
colección keya sobre `signedAt` top-level (que el firmador nunca escribe — pone
`signature.signedAt` anidado, ver DEEP-B9 N°2), un cliente puede `patch` una entry
`status:'signed'` (incl. `description`, `status`, `signature`) y la regla lo
permite. Es la **misma raíz** que el hallazgo SiteBook ya documentado, pero por un
**actor distinto** (el store cliente `patch`, no el path de firma): refuerza que
la inmutabilidad del libro de obra vive solo en el servicio puro server-side, no
en la capa de persistencia cliente.

### 🟡 N5 — `siteBookStore.nextSequenceForYear`: counter con read-then-write NO transaccional (folios duplicados)
`src/services/siteBook/siteBookStore.ts:33-43`. `getDoc` → `current+1` →
`setDoc(merge)` sin transacción. El propio comentario lo admite ("Para producción
al gran volumen usar Firestore transactions", `:32`). Dos supervisores creando
entries concurrentes en el mismo año obtienen el **mismo** `sequenceNumber` → dos
folios `SB-2026-000042`. Contrastar con el adapter server (`siteBookFirestore
Adapter.nextSequenceNumber`, `:109-120`) que SÍ usa `runTransaction`. El folio es
identidad legal DS 76; un duplicado rompe la cronología consecutiva exigida.
(#19 aplica a `src/server/`; aquí es cliente, por eso 🟡 y no 🔴, pero el impacto
normativo es alto.)

### 🟡 N6 — `noopErrorTrackingAdapter` usa `Math.random()` para el eventId que se round-trippea a respuestas API
`src/services/observability/noopErrorTrackingAdapter.ts:49` (`noopEventId`):
`` `noop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}` ``.
El adapter noop es el **fallback de producción** cuando Sentry está
`isAvailable=false` (`index.ts:79-87`) y su `captureException` retorna ese id que
los callers "round-trip into API responses" (comentario `:42-50` + `types.ts:99`).
La directiva #15 prohíbe `Math.random()` en `src/server/` y en código de
generación de IDs; este archivo es `server-only` (import `node:async_hooks`, ver
`:32`) y genera un ID. No es token de seguridad (solo correlación de soporte),
pero es ID generado en path server → recomendado `randomId()`. Mismo patrón en el
browser-stub (`noopErrorTrackingAdapter.browser-stub.ts:24`, cliente, fuera de
#15).

### 🔵 N7 — `piiRedactor`: el contador puede subcontar y el patrón de teléfono carece de `\b` inicial
`src/services/observability/piiRedactor.ts`. Dos notas menores: (a) el patrón CL
mobile (`:80`) abre con `(?:\+?56[\s-]?)?9[\s-]?\d{4}...` sin word-boundary inicial,
así un `9` embebido en una corrida numérica más larga (que ya debería caer en el
patrón card posterior) puede recortarse de forma rara; el orden RUT→phone→card
mitiga el doble-redact pero el solapamiento es frágil. (b) `count` (`:106-117`) se
acumula por pasada sobre `working` ya mutado; es consistente por-pasada pero no
representa "matches en el texto original" — el campo es informativo, no de
seguridad. Defensa en profundidad declarada (`:15-19`), no boundary; impacto
nulo. Documentar para evitar confiar en `count` como métrica exacta.

### 🔵 N8 — `positiveObservationsFirestoreAdapter.countSince` lee todos los docs y usa `.length` (sin `count()` aggregate)
`src/services/positiveObservations/positiveObservationsFirestoreAdapter.ts:57-63`.
`where('observedAt','>=',since).get()` y luego `snap.docs.length` — trae todos los
documentos a memoria en vez de usar el aggregate `count()`. La ruta server usa
`safeCount` (DEEP-B9), pero este método del adapter no. Costo/lectura proporcional
al volumen; sin límite. Bajo impacto, optimización pendiente.

### 🔵 N9 — `inspectionOutbox.countPendingObservations` ignora `ownerUid`
`src/services/inspections/inspectionOutbox.ts:426-430`. `countPending
Observations(inspectionId)` llama a `listPendingObservations(inspectionId)` SIN
pasar `ownerUid`, así en un dispositivo multi-usuario (kiosko/tablet) el conteo
"Pendiente sincronizar" mezcla filas de otros usuarios — inconsistente con el
aislamiento por `ownerUid` que el resto del módulo aplica con cuidado
(`:281-297`, `:404-424`). Cosmético (solo afecta un badge de conteo, no qué se
POSTea bajo el token), pero rompe la propia invariante de aislamiento del archivo.

---

## Limpios (sin hallazgo nuevo más allá de lo ya atestiguado)

- **Engines puros deterministas, sin I/O, identidad/audit forzada por su ruta:**
  `checklistBuilder.ts` (signature/rectify reciben uid como param; la ruta
  `checklistBuilder.ts:147` lo fuerza a caller), `fiveSAudit.ts`,
  `advancedFieldEngine.ts` (sub-lenguaje cerrado, sin `eval`/`new Function`,
  función-whitelist `ALLOWED_FUNCTIONS` + ciclo-detection),
  `offlineInspectionService.ts` (sessionId content-addressed sha256, inmutable),
  `measurementChain.ts`, `photoEvidenceEngine.ts` (exige `capturedByUid`,
  `contentHash` regex sha256, anti-future-capture), `qrAckSessionEngine.ts`
  (replayKey per-worker, `creator_cannot_self_sign`, validación full-payload),
  `qrSignatureService.ts` (HMAC constant-time, nonce replay, domain-bound),
  `positiveObservationsService.ts`, `siteBookService.ts` (gate `NOT_OPEN`,
  correcciones como nueva entry), `siteBookSigning.ts` (challenge derivado del
  hash, domain-tag, re-verificable — nota de diseño: `evidenceUrls` excluido del
  payload firmado `:63`, evidencia mutable post-firma por diseño),
  `siteBookCrdt.ts` (LWW + OR-Set + status-lattice first-signer-wins,
  conmutativo/idempotente).
- **Subárbol observability — scaffolding honesto y compliant:** stubs
  (`cloudErrorReportingAdapter.ts`, `metricsAdapter.ts` cloud/prometheus) lanzan
  `ObservabilityNotImplementedError` PERO están gated por `isAvailable` + fallback
  a noop en `index.ts:79-137` (invisibles a usuarios), con notas inline y
  **registrados en `docs/stubs-inventory.md:21-34`** → cumplen #13. `sentryAdapter.ts`
  es SDK real con `beforeSend` que redacta headers auth/cookie + query-params
  sensibles (`token_ws`/`code`/`token`/`session`/`state`, `:56-90`), degradación
  silenciosa sin DSN, todo en try/catch. `sentryInstrumentation.ts` (REDACT_KEYS
  + `sanitizeContext`), `tracing.ts` (OTel opcional con log-fallback),
  `quotaTracker.ts` (idempotencia + increments en `runTransaction`, ceilings por
  tier), `slos.ts`, `types.ts`, y los 3 `*.browser-stub.ts` (Vite alias para
  mantener `@sentry/node`/`node:async_hooks` fuera del bundle cliente).
- **`inspectionOutbox.ts`** — outbox IndexedDB con `ownerUid` isolation,
  flush-lock módulo-scoped, idempotencia por id, rekey en 409, fallback in-memory.
  Sólido salvo N9.

---

## Tabla por archivo (33/33)

| # | Archivo | LOC | Severidad | Hallazgo / nota (file:line) |
|---|---|---|---|---|
| 55 | services/checklistBuilder/checklistBuilder.ts | 409 | ✅ | Engine puro; uid de firma/rectify forzado por ruta |
| 56 | services/fiveS/fiveSAudit.ts | 139 | ✅ | Scoring 5S determinista |
| 57 | services/formBuilderAdvanced/advancedFieldEngine.ts | 871 | ✅ | Parser cerrado, sin eval, ALLOWED_FUNCTIONS + ciclo-detect |
| 58 | services/inspections/inspectionOutbox.ts | 554 | 🔵 | N9 `countPendingObservations` ignora ownerUid `:426` |
| 59 | services/inspections/offlineInspectionService.ts | 253 | ✅ | sessionId content-addressed sha256, inmutable |
| 60 | services/measurements/measurementChain.ts | 261 | ✅ | Cadena calibración determinista |
| 61 | services/observability/cloudErrorReportingAdapter.browser-stub.ts | 46 | ✅ | Browser-stub no-op |
| 62 | services/observability/cloudErrorReportingAdapter.ts | 81 | ✅ | Stub #13-compliant (stubs-inventory:21) |
| 63 | services/observability/errorTrackingAdapter.ts | 22 | ✅ | Re-exports |
| 64 | services/observability/index.ts | 166 | ✅ | Selección adapter + fallback noop |
| 65 | services/observability/metricsAdapter.ts | 205 | ✅ | Stubs #13-compliant (stubs-inventory:30) + noop |
| 66 | services/observability/noopErrorTrackingAdapter.browser-stub.ts | 128 | 🔵 | `Math.random` eventId cliente `:24` (fuera de #15) |
| 67 | services/observability/noopErrorTrackingAdapter.ts | 195 | 🟡 | N6 `Math.random` eventId server `:49` (#15) |
| 68 | services/observability/piiRedactor.ts | 125 | 🔵 | N7 phone sin `\b` inicial `:80`; count por-pasada `:106` |
| 69 | services/observability/quotaTracker.ts | 363 | 🟡 | N3 colección `quota_usage` sin regla `:79` (txn OK) |
| 70 | services/observability/noopErrorTrackingAdapter... (dup B) | — | — | (ver 66/67) |
| 71 | services/observability/sentryAdapter.browser-stub.ts | 60 | ✅ | Browser-stub no-op |
| 72 | services/observability/sentryAdapter.ts | 263 | ✅ | SDK real; beforeSend redacta headers+query `:56-90` |
| 73 | services/observability/sentryInstrumentation.ts | 202 | ✅ | REDACT_KEYS + sanitizeContext |
| 74 | services/observability/slos.ts | 153 | ✅ | Burn-rate puro |
| 75 | services/observability/tracing.ts | 267 | ✅ | OTel opcional, log-fallback, errores no enmascarados |
| 76 | services/observability/types.ts | 198 | ✅ | Tipos + ObservabilityNotImplementedError |
| 77 | services/photoEvidence/photoEvidenceEngine.ts | 275 | ✅ | Exige capturedByUid, hash sha256, anti-future |
| 78 | services/photoEvidence/photoEvidenceFirestoreAdapter.ts | 143 | 🔴 | N1 `save()` no escribe `linkageKeys` → listForNode invisible `:50,:82` · N3 sin regla |
| 79 | services/positiveObservations/positiveObservationsFirestoreAdapter.ts | 65 | 🔵🟡 | N8 countSince sin aggregate `:57` · N3 sin regla `:16` |
| 80 | services/positiveObservations/positiveObservationsService.ts | 163 | ✅ | Balance §215 determinista |
| 81 | services/qrAck/qrAckSessionEngine.ts | 368 | ✅ | replayKey per-worker, creator-cannot-self-sign |
| 82 | services/qrSignature/qrSignatureService.ts | 330 | ✅ | HMAC constant-time, nonce replay, domain-bound |
| 83 | services/siteBook/siteBookCrdt.ts | 498 | ✅ | LWW+OR-Set+lattice; guard signed dentro de helpers |
| 84 | services/siteBook/siteBookFirestoreAdapter.ts | 387 | 🔴 | N2 mergeAndPersistCrdtDraft clobbea firmadas + muerto + sin regla `:206-229,:88` |
| 85 | services/siteBook/siteBookService.ts | 296 | ✅ | Gate NOT_OPEN, correcciones como nueva entry |
| 86 | services/siteBook/siteBookSigning.ts | 254 | ✅ | Challenge derivado del hash; evidenceUrls fuera del payload (diseño) `:63` |
| 87 | services/siteBook/siteBookSigningClient.ts | 213 | ✅ | Client no controla challenge; envía entryId (path disjunto ya documentado) |
| — | services/siteBook/siteBookStore.ts | 63 | 🟡 | N4 patch mutable de firmadas `:52` · N5 counter no-txn `:33` |

> Nota tabla: el ledger lista `noopErrorTrackingAdapter.browser-stub.ts` (#66) y
> `noopErrorTrackingAdapter.ts` (#67); la fila #70 es placeholder del segundo
> índice del par browser/server ya cubierto. `siteBookStore.ts` (índice 87 en el
> ledger es `siteBookStore.ts`, mostrado al final) cierra los 33. Recuento real
> de archivos físicos distintos leídos = 33.

---

## Resumen

Pasada 33/33 línea por línea sobre el corte `[55:88]` de B9-Inspecciones FEAT —
predominan engines puros (deterministas, limpios) y el subárbol `observability`,
que resultó scaffolding honesto y #13-compliant (stubs gated por `isAvailable` +
fallback noop + registrados en stubs-inventory). Hallazgos NUEVOS concentrados en
los **adapters Firestore**. Dos 🔴: (N1) `photoEvidenceFirestoreAdapter.save()`
nunca escribe la proyección `linkageKeys` que su propia query `listForNode`
necesita → la galería de evidencia por nodo padre está rota para el camino
primario; (N2) `siteBookFirestoreAdapter.mergeAndPersistCrdtDraft()` hace
`tx.set` sobre el flat doc sin re-leerlo, pudiendo clobbear una entry firmada —
agravado por ser código MUERTO (0 callers) y su colección `sitebook_crdt_drafts`
sin regla. Cuatro 🟡: colecciones de adapter sin regla en `firestore.rules`
(`photo_evidence`/`positive_observations`/`quota_usage`/`sitebook_crdt_drafts`,
N3, hoy sin leak por ser Admin-only); `siteBookStore.patch` que permite mutar
entries firmadas vía cliente (N4, misma raíz `signedAt` que DEEP-B9, actor nuevo);
counter cliente no-transaccional con folios duplicables (N5); y `Math.random()`
en el eventId server del noop tracker (N6, #15). Tres 🔵 menores
(piiRedactor count/regex, countSince sin aggregate, countPendingObservations
ignora ownerUid). Doc-only, sin commit.
