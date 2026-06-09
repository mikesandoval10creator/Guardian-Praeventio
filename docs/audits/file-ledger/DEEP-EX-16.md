# DEEP-EX-16 — Pasada exhaustiva línea-por-línea (Lote #16, B4-Incidentes)

**Ledger slice**: `category` empieza con `FEAT` && `block === "B4-Incidentes"`, ordenado por `path`,
`[0:55]` → 55 archivos.
**Método**: lectura completa línea-por-línea de cada archivo. Hallazgos NUEVOS respecto a
`DEEP-B4-Incidentes.md` (que cubrió: edges PDCA no inyectados 🔴, path-mismatch del bundle, feeds vacíos,
`Math.random` en `incidentRagService.ts:299`, CQRS in-memory, `root_cause_analyses` vs `root_causes`,
microtraining no auto-generado, comentario stale en server.ts). Esta pasada se enfoca en identidad
suplantable del cliente (#3), audit faltante / no-canónico (#14), colas/IDs que pierden datos, código
muerto disfrazado de feature (#13), `Math.random` IDs (#15), fuga de internals (#8), `JSON.parse` sin
try/catch (#5), read-modify-write sin transacción (#19), y doc/data-source drift.

## Atestación — 55/55 archivos leídos íntegros

| # | Archivo | LOC | Veredicto |
|---|---------|-----|-----------|
| 1 | src/components/correctiveActions/ActionBalanceCard.tsx | 109 | 🔵 |
| 2 | src/components/correctiveActions/CorrectiveActionsCenterPanel.tsx | 219 | 🔵 |
| 3 | src/components/digital-twin/PlacedObjectsLayer.tsx | 214 | 🔵 (miscat.) |
| 4 | src/components/escalation/SlaWatchPanel.tsx | 267 | 🔵 |
| 5 | src/components/gamification/DaysWithoutIncidentBadge.tsx | 104 | 🔵 |
| 6 | src/components/incidentBundle/IncidentEvidenceBundleCard.tsx | 293 | 🔵 |
| 7 | src/components/incidentFlow/AssignedMicrotrainingCard.tsx | 175 | 🔵 |
| 8 | src/components/incidentFlow/IncidentReportForm.tsx | 210 | 🔵 |
| 9 | src/components/incidentFlow/InvestigationPanel.tsx | 331 | 🔵 |
| 10 | src/components/incidentFlow/LessonPublishForm.tsx | 208 | 🔵 |
| 11 | src/components/incidentFlow/PDCAClosePanel.tsx | 236 | 🔵 |
| 12 | src/components/incidentTrends/TrendSeriesChart.tsx | 140 | 🔵 |
| 13 | src/components/investigation/PunitiveLanguageWarning.tsx | 90 | 🔵 |
| 14 | src/components/lessonsLearned/LessonSuggestionsCard.tsx | 106 | 🔵 |
| 15 | src/components/pdca/PdcaSummaryCard.tsx | 88 | 🔵 |
| 16 | src/components/researchMode/RootCauseTreeSummary.tsx | 128 | 🔵 |
| 17 | src/components/rootCause/RootCauseClassifierCard.tsx | 148 | 🔵 |
| 18 | src/hooks/useCorrectiveActions.ts | 152 | 🔵 |
| 19 | src/hooks/useEscalation.ts | 157 | 🔵 |
| 20 | src/hooks/useIncidentBundle.ts | 89 | 🔵 |
| 21 | src/hooks/useIncidentFlow.ts | 211 | 🔵 |
| 22 | src/hooks/useIncidentTrends.ts | 63 | 🔵 |
| 23 | src/hooks/useLessonsLearned.ts | 72 | 🟡 |
| 24 | src/hooks/usePdca.ts | 198 | 🔵 |
| 25 | src/hooks/useRootCause.ts | 127 | 🔵 |
| 26 | src/hooks/useRootCauseInvestigation.ts | 112 | 🔵 |
| 27 | src/pages/CorrectiveActions.tsx | 247 | 🔵 |
| 28 | src/pages/IncidentBundle.tsx | 215 | 🔵 |
| 29 | src/pages/IncidentReport.tsx | 358 | 🔵 |
| 30 | src/pages/IncidentTrends.tsx | 602 | 🔵 |
| 31 | src/pages/LessonsLearned.tsx | 439 | 🔵 |
| 32 | src/pages/PdcaModule.tsx | 818 | 🔵 |
| 33 | src/pages/RootCauseInvestigation.tsx | 370 | 🔵 |
| 34 | src/server/routes/correctiveActions.ts | 218 | 🔵 |
| 35 | src/server/routes/efficacyVerification.ts | 138 | 🔵 |
| 36 | src/server/routes/incidentBundle.ts | 214 | 🟡 |
| 37 | src/server/routes/incidentFlow.ts | 747 | 🟡 |
| 38 | src/server/routes/incidentTrends.ts | 492 | 🔵 |
| 39 | src/server/routes/incidents.ts | 193 | 🔵 |
| 40 | src/server/routes/lessonsLearned.ts | 177 | 🟡 |
| 41 | src/server/routes/pdca.ts | 467 | 🟡 |
| 42 | src/server/routes/rootCause.ts | 242 | 🔵 |
| 43 | src/server/routes/rootCauseInvestigation.ts | 197 | 🔵 |
| 44 | src/server/routes/sif.ts | 121 | 🔴 |
| 45 | src/services/correctiveActions/correctiveActionsCenter.ts | 336 | 🔵 |
| 46 | src/services/correctiveActions/correctiveActionsFirestoreAdapter.ts | 91 | 🔵 |
| 47 | src/services/correctiveActions/weakActionDetector.ts | 297 | 🔵 |
| 48 | src/services/cqrs/incidents/incidentCommands.ts | 464 | 🟡 |
| 49 | src/services/cqrs/incidents/incidentEvents.ts | 306 | 🔵 |
| 50 | src/services/cqrs/incidents/incidentReadModel.ts | 237 | 🔵 |
| 51 | src/services/cqrs/incidents/incidentSystem.ts | 161 | 🔵 |
| 52 | src/services/efficacyVerification/efficacyVerifier.ts | 341 | 🔵 |
| 53 | src/services/evidenceChain/custodyChainFirestoreAdapter.ts | 75 | 🟡 |
| 54 | src/services/evidenceChain/custodyChainService.ts | 248 | 🟡 |
| 55 | src/services/gamification/daysWithoutIncident.ts | 150 | 🟡 |

🔴 1 · 🟡 9 · 🔵 45

---

## 🔴 Hallazgos críticos

### 🔴 H1 — `sif.ts`: `reviewedByUid` viene del body, NO se fuerza al caller → atestación ejecutiva SIF suplantable (#3)
`src/server/routes/sif.ts:83-111`, endpoint `POST /:projectId/sif/:id/executive-review`:
```ts
const sifReviewSchema = z.object({
  reviewedByUid: z.string().min(1),   // ← del cliente
  reviewedAt: z.string().min(10),
  reviewNotes: z.string().max(2000).optional(),
});
// ...
await adapter.recordExecutiveReview(id, body.reviewedByUid, body.reviewedAt, body.reviewNotes);
```
El adapter persiste ese `reviewedByUid` tal cual (`sifFirestoreAdapter.ts:46-54`,
`update({ reviewedByUid, reviewedAt, reviewNotes })`). **El UID del revisor ejecutivo se toma del body
del cliente y nunca se contrasta contra `req.user!.uid`.** Cualquier miembro del proyecto puede grabar
una "revisión ejecutiva" de un precursor SIF (Serious Injury/Fatality — el evento de seguridad más
grave del SGSST, Ley 16.744 art. 76 / ISO 45001 §10.2) **atribuida a otra persona** (p.ej. el gerente),
sin que esa persona la haya hecho. Viola directiva #3 ("nunca confiar en identidad provista por el
cliente; el servidor estampa `userId` desde el token verificado"). Además `reviewedAt` también es
client-controlled (back-dating de la revisión). Contraste correcto en el mismo bloque:
`correctiveActions.ts:139` usa `effectivenessReviewScheduledBy: callerUid` (servidor estampa).
**Acción**: forzar `reviewedByUid = callerUid` (server-stamped) y `reviewedAt = new Date().toISOString()`;
o si la revisión ejecutiva la firma un rol distinto, exigir gate de rol (admin/gerente) + registrar al
caller como `recordedByUid` aparte. Añadir audit con el actor real (hoy `auditServerEvent:111` sí
estampa al caller, pero el campo de dominio `reviewedByUid` lo desmiente).

---

## 🟡 Hallazgos medios

### 🟡 H2 — `incidentFlow.ts`: `writeAudit` escribe `audit_logs` con shape NO-canónico → rows invisibles al bundle y al query estándar (#14)
`incidentFlow.ts:123-146` define un `writeAudit` propio que hace
`admin.firestore().collection('audit_logs').add({ kind, tenantId, projectId, actorUid, details, createdAt })`.
El shape canónico (`auditServerEvent`, `src/server/middleware/auditLog.ts:71-83`) usa
`action`/`module`/`userId`/`userEmail`/`timestamp`. Consecuencias:
- **No queryable igual**: cualquier consumidor que filtre `where('userId','==',…)` o `where('action',…)`
  (patrón estándar) **no encuentra** estas filas (tienen `actorUid`/`kind`).
- **Aparecen como "unknown" en el expediente**: `incidentBundle.ts:140-141` mapea
  `actorUid: String(data.userId ?? 'unknown')` y `action: String(data.action ?? 'unknown')` → toda la
  cadena PDCA (report → investigación → lección → microtraining) sale en el bundle con actor/acción
  **"unknown"**, justo el rastro que el expediente debe mostrar a fiscalizador/SUSESO.
- El swallow de fallo solo hace `logger.warn` (`:144`), sin `Sentry.captureException` (la directiva #14
  pide capturar el error de audit, no solo loguear). El regla `audit_logs` (firestore.rules:558-568) es
  server-only y schema-agnóstica, así que el shape divergente **no se rechaza** — la inconsistencia pasa
  silenciosa. **Acción**: reemplazar `writeAudit` por `auditServerEvent` (mismo patrón ya adoptado en
  `lessonsLearned.ts:162`, `pdca.ts`, `sif.ts`, `correctiveActions.ts`).

### 🟡 H3 — `incidentBundle.ts`: lee `incidents` root, pero el reporte canónico escribe tenant-anidado → expediente vacío (confirma patrón DEEP-B4, evidencia ampliada)
`incidentBundle.ts:83-86` lee `db.collection('incidents').doc(incidentId)`. El flujo canónico
(`incidents.ts:108` → `incidentRagService.ts`) persiste en
`tenants/{tid}/projects/{pid}/incidents/{id}`, y el flujo PDCA (`incidentFlow.ts`) ni siquiera escribe un
doc de incidente (solo nodos ZK). Por tanto un incidente reportado por cualquiera de los dos flujos
canónicos **devuelve 404 `incident_not_found`** al construir su propio expediente, salvo que exista una
copia legacy en root `incidents`. `incidentTrends.ts:281-312` resolvió esto leyendo ambos paths +
dedup; el bundle quedó sin alinear. **Acción**: leer tenant-anidado (o ambos+dedup como trends).

### 🟡 H4 — `pdca.ts /advance`: read-modify-write sin `runTransaction` (#19) → carrera en la máquina de estados PDCA
`pdca.ts:214-326` (`/pdca/cycles/:id/advance`): hace `ref.get()` (`:256`) → muta `stages`/`currentStage`
→ `ref.set(merged, { merge:false })` (`:311`) sobre el **mismo doc**, sin transacción. Dos avances
concurrentes (P→D y D→C, o doble-tap) leen el mismo estado base y el último `set` con `merge:false`
**sobre-escribe** el otro → se pierde una transición de fase y/o evidencia (`stages[]`). Es exactamente
el patrón que la directiva #19 exige envolver en `db.runTransaction(...)` (≥1 `get` + ≥1 `set` sobre el
mismo path). El módulo `pdca.ts` no está en la lista de candidatos flageados de #19, pero califica.
**Acción**: envolver get+set del advance en `runTransaction`. (Los otros writes de `pdca.ts` —create
cycle/NC— son `set` puros sin read previo, OK.)

### 🟡 H5 — `lessonsLearned.ts`: `adoptionCount` aceptado del body → ranking "top adopted" inflable por el cliente
`lessonsLearned.ts:132-143` (`lessonSchema`) acepta `adoptionCount: z.number().int().nonnegative()`
**desde el body** y `adapter.save(body)` lo persiste sin recálculo. El GET por defecto
(`listTopAdopted`, `:120`) ordena la biblioteca tenant-wide por `adoptionCount`. Un miembro puede
publicar una lección con `adoptionCount: 999999` y empujarla al tope del ranking de "lecciones más
reutilizadas", contaminando la priorización de aprendizaje organizacional. No es PII ni state-machine
crítica, pero es un server-field controlado por el cliente que altera un ranking. **Acción**: ignorar
`adoptionCount` del body en create (forzar 0) y mutarlo solo vía un endpoint de adopción server-side.

### 🟡 H6 — `daysWithoutIncident.ts`: feature de medallas (100/365 días) NO cableada en producción (#13 — dead-code) + data-source mismatch
`computeDaysWithoutIncident` / `awardDaysMilestones` (`daysWithoutIncident.ts:54,118`) **no tienen
ningún caller productivo**: `grep awardDaysMilestones` solo matchea el propio archivo y su `.test.ts`
(ningún mount en `server.ts`, ningún job en `src/server/jobs/`, ninguna ruta). El badge
`DaysWithoutIncidentBadge.tsx` es puramente presentacional (recibe `days` por prop) y el
`weeklyDigest.ts:189-191` lee un campo `daysWithoutIncident` del project doc que se inicializa en `0`
(`organic.ts:75`, `crewService.ts:73`) y nunca lo actualiza esta lógica. Es una feature aparentemente
completa (con tests) que **no se ejecuta** — no registrada en `docs/stubs-inventory.md` ni gated por
flag (viola el espíritu de #13). Adicional: aun si se cableara, `computeDaysWithoutIncident:64-70`
consulta `reports` con `where('type','==','Incidente')` (colección legacy del grafo Pizarra), mientras
el reporte canónico (`POST /api/incidents/report`) escribe en `tenants/.../incidents` con
`incidentType:'incident'|'near_miss'` — **el contador nunca se resetearía** con un incidente reportado
por el flujo canónico. **Acción**: cablear el cron + alinear la fuente al path/campo canónico, o
documentar como stub en el inventario.

### 🟡 H7 — `custodyChainFirestoreAdapter.ts`: `appendEvent` usa `event.at` (ISO ms) como doc id → colisión silenciosa pierde eventos de cadena de custodia
`custodyChainFirestoreAdapter.ts:49-55`: `appendEvent` hace
`.collection(EV_PATH).doc(event.at).set(event)` usando el timestamp ISO como id de documento. Dos
eventos de custodia sobre el mismo artefacto en la **misma marca de tiempo** (p.ej. upload+access
batcheados, o dos accesos dentro del mismo ms) colisionan: el segundo `set()` **sobre-escribe** al
primero → pérdida silenciosa de un eslabón en una cadena de custodia *legal* de evidencia (fotos, PDFs,
declaraciones). El comentario `// event id = at ISO timestamp (assumed unique per artifact)` reconoce el
supuesto frágil. **Acción**: id = `${at}_${randomId()}` o auto-id de Firestore + índice por `at`.

### ✅ H8 — Subsistema Cadena de Custodia (J.7) cableado a producción (era #13 — dead-code)
**RESUELTO.** El motor `custodyChainService.ts` (hash SHA-256,
register/replace/access/export/verifyIntegrity) + su adapter ya tienen caller productivo:
`src/server/routes/custodyChain.ts` monta 5 endpoints bajo `/api/sprint-k` (GET artifact+chain,
POST register/replace/access/export), cada uno con `verifyAuth` + `assertProjectMember`,
identidad server-stampeada desde el token verificado (`uploadedByUid`/`actorUid`, nunca del body),
y un `audit_logs` awaited en try/catch por cada op mutadora. Mount en `server.ts`. La colección
`tenants/{tid}/evidence_artifacts/{hash}` (+ `/events/{eid}`) ahora tiene regla Firestore:
member-read, write server-only (Admin SDK), `/events` APPEND-ONLY inmutable (sin update/delete por
nadie). Tests reales: `src/rules-tests/evidenceArtifacts.rules.test.ts` (9 casos, harness F1
`authenticatedContext`) + `src/__tests__/server/custodyChain.router.test.ts` (20 casos supertest
ejercitando el motor + adapter reales). Dirty-Dozen #67–69 en `security_spec.md`. Cierra también la
parte de H3 donde el bundle prometía custody-chain con feed vacío por no invocarse el subsistema.

### 🟡 H9 — `incidentCommands.ts:124-132`: `generateEventId()` usa `Math.random()` para IDs de evento (#15) — NUEVO (DEEP-B4 solo flageó `incidentRagService.ts:299`)
```ts
function generateEventId(): string {
  const rnd = (n: number) =>
    Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${rnd(8)}-${rnd(4)}-${rnd(4)}-${rnd(4)}-${rnd(12)}`;
}
```
Genera el `eventId` de cada evento de dominio CQRS con `Math.random()`. El comentario lo justifica como
"seedeable en tests", pero **no está seedeado** (usa `Math.random()` global, no un PRNG inyectable). Es
ID-generation → debería usar `randomId()`/`crypto.randomUUID()` (#15). Vive en `src/services/` (no
`src/server/`), así que el lint custom probablemente no lo capture, pero es el mismo descuido ya notado
para `incidentRagService.ts`. Mitigante: el Event Store CQRS es demo in-memory (no la ruta canónica),
así que el impacto real es bajo — pero si alguien promueve CQRS a persistente, colisiones de `eventId`
romperían la idempotencia. **Acción**: migrar a `randomId()` o un `nowIso()`-style id inyectable.

---

## 🔵 Limpios / sin hallazgo nuevo

- **Rutas server con guardia uniforme** — `correctiveActions.ts (34)`, `efficacyVerification.ts (35)`,
  `incidentTrends.ts (38)`, `incidents.ts (39)`, `rootCause.ts (42)`, `rootCauseInvestigation.ts (43)`:
  todas `verifyAuth` + `assertProjectMember` + `resolveTenantId` desde el project doc (no del body) +
  Zod validate + error-body `internal_error` sin internals (#8 OK). `incidents.ts` además
  `incidentsLimiter` + `idempotencyKey()` + tenant del project doc (#3 OK) + audit con `userId` del
  token. `rootCause.ts:113` fuerza `analyzedByUid = callerUid`. Audits relevantes `await`-eados (#14 OK)
  excepto el caso H2.
- **Motores puros determinísticos** — `weakActionDetector.ts (47)` (lenguaje débil + jerarquía ISO
  45001 + duplicados + recidivismo), `correctiveActionsCenter.ts (45)` (PDCA progress + semáforo +
  scheduleEffectivenessReview), `efficacyVerifier.ts (52)` (score 0..100, ventana incompleta →
  inconclusive, penalty por reincidencia/excepciones — fixes Codex PR#127 sólidos), `incidentEvents.ts
  (49)` / `incidentReadModel.ts (50)` (reducer event-sourced puro, idempotencia por sequenceNumber),
  `correctiveActionsFirestoreAdapter.ts (46)`. Sin side-effects, sin Firestore en el engine, sin
  `Math.random` (salvo H9 en `incidentCommands`).
- **`incidentCommands.ts (48)`** — invariantes de dominio correctas (close exige investigador +
  rootCause ≥20 chars + ≥1 acción preventiva ISO 45001 §10.2; reopen solo sobre closed; TENANT_MISMATCH
  guard; optimistic concurrency `expectedSeq`). Único pero: H9 (`Math.random` eventId).
- **Hooks** — `useCorrectiveActions (18)`, `useEscalation (19)`, `useIncidentBundle (20)`,
  `useIncidentFlow (21)`, `useIncidentTrends (22)`, `usePdca (24)`, `useRootCause (25)`,
  `useRootCauseInvestigation (26)`: thin fetch-wrappers vía `apiAuthHeader(s)` con AbortController y
  error tipado; toda la autorización vive server-side. `useLessonsLearned (23)` marcado 🟡 solo por
  reenviar `adoptionCount` (causa raíz en el server, H5).
- **Pages** — sin escrituras Firestore client-side (todas pasan por la API server, que aplica auth +
  membresía): `CorrectiveActions (27)`, `IncidentBundle (28)`, `IncidentReport (29)`, `IncidentTrends
  (30)`, `LessonsLearned (31)`, `PdcaModule (32)`, `RootCauseInvestigation (33)`. `IncidentReport.tsx:87`
  y `PdcaModule.tsx:73-77` usan `Math.random` para idempotency-key / doc-id, pero en `src/pages/`
  (fuera del scope duro de #15); el JSON.parse de `IncidentReport.tsx:151` **sí** está en try/catch
  (#5 OK).
- **Componentes** — `ActionBalanceCard (1)`, `CorrectiveActionsCenterPanel (2)`, `SlaWatchPanel (4)`,
  `DaysWithoutIncidentBadge (5)`, `IncidentEvidenceBundleCard (6)`, `AssignedMicrotrainingCard (7)`,
  `IncidentReportForm (8)`, `InvestigationPanel (9)`, `LessonPublishForm (10)`, `PDCAClosePanel (11)`,
  `TrendSeriesChart (12)`, `PunitiveLanguageWarning (13)`, `LessonSuggestionsCard (14)`,
  `PdcaSummaryCard (15)`, `RootCauseTreeSummary (16)`, `RootCauseClassifierCard (17)`: presentacionales,
  consumen hooks. `PlacedObjectsLayer (3)` es un layer R3F de gemelo digital (extintores/AED/señalética)
  **miscategorizado** en B4 — limpio, sin relación con incidentes.
- **Sin diagnóstico médico (ADR 0012)** en ningún archivo del lote. **Sin gamificación que castigue al
  reporter** (XP positivo-only confirmado en `incidents.ts:7-14`). **Sin `JSON.parse` server sin
  try/catch** (#5 OK — `incidentBundle`/`incidentFlow` parsean objetos validados por Zod, no
  `response.text` de Gemini). **Error-bodies sin internals** (#8 OK en las 11 rutas).

---

## Para decisión del usuario (❓/⚠️)

- ⚠️ **[H1, 🔴]** `sif.ts`: forzar `reviewedByUid = callerUid` (server-stamped) en la revisión ejecutiva
  SIF. Hoy es suplantable y back-dateable — atestación de compliance del evento más grave del SGSST.
- ⚠️ **[H2]** Reemplazar el `writeAudit` no-canónico de `incidentFlow.ts` por `auditServerEvent` para que
  la cadena PDCA no salga como actor "unknown" en el expediente y sea queryable.
- ⚠️ **[H4, #19]** Envolver `pdca.ts /advance` (get+set) en `runTransaction` para evitar carreras en la
  máquina de estados PDCA.
- ❓ **[H6/H8]** `daysWithoutIncident` y la Cadena de Custodia (J.7) están implementadas con tests pero
  **sin wiring productivo**. ¿Cablear el cron/endpoint, o registrarlas en `docs/stubs-inventory.md`
  como pendientes (directiva #13)?
- ❓ **[H5]** ¿Ignorar `adoptionCount` del body en `POST /lessons` (forzar 0) y mutarlo solo server-side?
- ❓ **[H7]** Cambiar el doc-id de los eventos de custodia para evitar colisión por timestamp idéntico.

---

## Resumen (6-10 líneas)

Lote #16 (55 archivos B4-Incidentes, slice [0:55]) leídos íntegros. La superficie es sólida: 11 rutas
server con `verifyAuth` + `assertProjectMember` + tenant resuelto del project doc (no del body) + Zod +
error-bodies sin internals (#8 OK); motores puros (weakActionDetector, efficacyVerifier, CQRS reducer,
correctiveActionsCenter) determinísticos y correctos; XP positivo-only; sin diagnóstico médico. **1
hallazgo 🔴**: `sif.ts` toma `reviewedByUid`/`reviewedAt` del body sin forzarlos al caller verificado —
la revisión ejecutiva de un precursor SIF (Ley 16.744 art. 76) es **suplantable y back-dateable**
(viola #3). **9 hallazgos 🟡**: (H2) `incidentFlow` escribe `audit_logs` con shape no-canónico
(`kind`/`actorUid` vs `action`/`userId`) → la cadena PDCA aparece como actor "unknown" en el expediente
y no es queryable; (H3) el bundle lee `incidents` root mientras el flujo canónico escribe tenant-anidado
→ 404; (H4) `pdca.ts /advance` hace read-modify-write sin `runTransaction` (#19) → carrera de estados;
(H5) `adoptionCount` aceptado del body infla el ranking de lecciones; (H6/H8) `daysWithoutIncident` y la
Cadena de Custodia J.7 están implementadas+testeadas pero **sin caller productivo** (dead-code, #13), y
el contador además lee una colección/campo legacy distinto al canónico; (H7) `appendEvent` usa el ISO
timestamp como doc-id → colisión pierde eslabones de custodia legal; (H9) `incidentCommands` genera
`eventId` con `Math.random()` (#15, NUEVO vs DEEP-B4). Doc-only; sin cambios de código ni commit.
