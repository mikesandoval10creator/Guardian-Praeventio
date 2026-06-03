# DEEP — Lote EX-27 · B13-MOC (FEAT) · 2026-06-03

**Atestación: 55/55 archivos leídos línea por línea.**
DERIVA: `ledger.json` filtrado por `category` startsWith `"FEAT"` &&
`block === "B13-MOC"` (60 matches), ordenado por `path`, slice `[0:55]` → 55
archivos. Lista verificada vía Node contra el ledger.

> Base de no-repetición: `DEEP-B13-MOC.md` (ya cubrió: UI MOC/handover escribe
> client-side vía `createProjectScopedStore` sin audit; `shiftHandover.ts`
> pure-compute + `ShiftHandoverAdapter` huérfano; ~2.500 LOC UI huérfana
> [MOCStatusPanel, AcknowledgmentBanner, ChangeDeclarationForm,
> ShiftHandoverPanel, ShiftHandoverHistoryList, SpofPanel,
> CriticalRoleCoverageCard + hooks]; `changeMgmt.ts` redundante vs
> `operationalChange.ts`; mismatch path `tenants/...` vs `projects/...`). Aquí
> SOLO hallazgos NUEVOS de la lectura fina. Este slice además trae archivos que
> NO eran del block B13 conceptualmente pero el ledger los etiqueta así
> (processes/*, projects Gantt, Calendar, driving/*, routeScoring/*, cargo,
> internalTransit) — se auditan igual.

---

## Hallazgos NUEVOS

### 🔴 N1 — `useShiftHandover.ts`: stubs disfrazados que devuelven datos FALSOS de un handover de relevo, sin las 4 salvaguardas de la directiva #13
`useShiftHandover.ts:171-242` exporta tres funciones que el `ShiftHandoverPanel`
**sí llama en producción** (`createShiftHandover`, `acknowledgeShiftHandover`,
`addShiftHandoverDiscrepancy`). NO golpean ningún endpoint: `createShiftHandover`
(`:186`) **eco-construye** un `ShiftRecord` con el `id` del cliente y lo devuelve
como si se hubiera persistido (`return { shift: {...} }`, `:200-210`);
`acknowledgeShiftHandover` (`:220`) y `addShiftHandoverDiscrepancy` (`:235`)
devuelven `{ shift: { id: shiftId } }` — un objeto vacío tipado. El panel
(`ShiftHandoverPanel.tsx:198,219,240`) hace `onShiftUpdated?.(res.shift)` con ese
fake y muestra al supervisor entrante "Acuse registrado" / "Discrepancia
registrada" **sin que nada se haya guardado ni auditado**. Esto incumple la
directiva #13 anti-stub-disfrazado en TRES de sus cuatro requisitos: (b) NO es
invisible al usuario (no hay feature-flag ni 503 — el panel está cableado a estos
stubs y renderiza éxito), y (c) el "test que fija la forma" no impide el engaño
visual. Sí cumplen (a) comentario inline `// Stub` y (d) registro en
`docs/stubs-inventory.md` + TODO §13. Mitigación real: `ShiftHandoverPanel` y
`ShiftHandoverHistoryList` son huérfanos (0 importadores fuera de su propio par
y del hook — confirmado por grep), así que HOY no hay exploit en producción; pero
si alguien monta el panel (cerrando la deuda D de `DEEP-B13-MOC.md`) el relevo
legal de turno reportaría éxito sobre un no-op. `fetchShiftHandoverHistory`
(`:171`) devuelve `{ shifts: [] }` — honesto (empty-state), menos grave.

### 🟡 N2 — `OperationalChanges.tsx`: el modal afirma al usuario "quedará registrado en el audit log (DS 76 + ISO 45001 §8.1.3)" pero la acción NO escribe `audit_logs`
`DEEP-B13-MOC.md` ya marcó que la página persiste client-side sin audit. NUEVO:
la afirmación es **explícita en copy user-facing**. El `ReasonModal` de revert
muestra `description: '...quedará registrado en el audit log (DS 76 + ISO 45001
§8.1.3).'` (`OperationalChanges.tsx:522`), y `handleModalConfirm` ejecuta
`revertChange(...)` (engine puro) + `patchChange(...)` (store cliente,
`:238-244`) — ningún `auditServerEvent` ni POST al server. Igual el banner de
declaración: `ChangeDeclarationForm`/el form inline declaran vía `declareChange`
+ `saveChange` (`:156,169`). Es una promesa de cumplimiento legal (DS 76 = libro
de obra / trazabilidad) impresa en pantalla que el código no honra → más severo
que "falta audit" porque le miente al prevencionista sobre la trazabilidad. La
ruta auditada correcta (`operationalChange.ts` `/moc/*`) existe pero la página
viva usa `/change-mgmt` indirectamente sólo para el engine, nunca para persistir.

### 🟡 N3 — Read-modify-write sin `runTransaction` en 3 superficies de este lote (directiva #19)
Ninguno de los archivos auditados usa `db.runTransaction` (grep confirma 0):
- `projectClosure.ts` **finalize** (`:505-530`): `readClosureState` (get) +
  `readPendingCounts` (gets) → `writeClosureState` (`set merge:false`, `:530`)
  sobre `closure/state`. Dos `finalize` concurrentes ambos leen `status!=='finalized'`,
  ambos escriben `finalized` con su propio `finalizedByUid` → el segundo pisa al
  primero (firma de cierre formal del proyecto sobreescrita). `initiate` (`:327-341`)
  mismo patrón sobre el mismo doc.
- `operationalChange.ts` **close** (`:339-371`): `adapter.getById` (get) →
  `summarizeAcknowledgments` → `.set(merge)` con `implementedAt/implementedBy`.
  Read-then-write sin transacción; el guard de 100% ack y el sello de cierre
  pueden carrera con un revert concurrente.
- `operationalChangeFirestoreAdapter.addAcknowledgment` (`:36-45`): `ref.get()`
  → dedup en memoria → `ref.set(updated)`. Dos acks concurrentes de workers
  distintos: ambos leen el array sin el otro, el segundo `set` **pierde** el ack
  del primero (no es `arrayUnion`, es replace del doc completo). Para un MOC de
  alto impacto donde el cierre exige 100% cobertura, un ack perdido bloquea el
  cierre indefinidamente o (peor) un ack fantasma. Ninguno de los tres está en la
  lista nominal de candidatos #19 — deberían añadirse.

### 🟡 N4 — `calendar_events`: colección escrita client-side por `useAutoCalendarEvents.ts` SIN regla Firestore explícita (default-deny la bloquea, o la auto-programación es muerta)
`useAutoCalendarEvents.ts:27,59` hace `addDoc(collection(db,
\`projects/${id}/calendar_events\`), {...})` y `getDocs` sobre la misma ruta
(`:33`). `firestore.rules` NO tiene `match /calendar_events/{...}` (grep: "NO
RULE"), y el default-deny `match /{document=**} { allow read,write: if false }`
(`firestore.rules:17`) está activo. Resultado: o bien (a) la escritura
auto-generada de inspecciones CPHS **falla silenciosamente** — el hook envuelve
todo en `try{}catch{ /* silent */ }` (`:72-74`), así que el prevencionista nunca
se entera de que la programación automática de inspecciones por ≥3 hallazgos
críticos NO ocurre; o (b) si hay una regla wildcard de proyecto más arriba que la
cubra, sería una colección sin las ≥5 rules-tests + entrada Dirty Dozen que exige
la directiva #4. La página `Calendar.tsx` lee de `projects/{id}/events` (`:246`),
NO de `calendar_events` — distinta colección, así que los eventos auto-generados
ni siquiera se mostrarían en el calendario. Función muerta o silenciosamente rota.
Consumidor: `ComiteParitario.tsx` (1).

### 🔵 N5 — `Math.random()` para IDs en client (`ShiftHandover.tsx`, `commuteSession.ts`) — fuera del scope estricto de #15 pero inconsistente con el server
`ShiftHandover.tsx:137` genera el shift id con
`shift_${Date.now()}_${Math.random().toString(36).slice(2,8)}` y
`commuteSession.ts:216` el commute id con `cs_${now()}_${Math.random()...}`. La
directiva #15 prohíbe `Math.random()` solo en `src/server/` e ID-generation
server-side; estos son client. PERO el server **sí** usa `randomUUID()` para los
mismos conceptos (`commute.ts:92` `cs_${Date.now()}_${randomUUID()}`,
`drivingSafety.ts:303`, `projectClosure.ts:382,466`), generando un mismatch de
formato/entropía: 6 chars base36 (~31 bits) client vs UUID v4 (128 bits) server.
Para el shift id, baja entropía + `Date.now()` colisiona en ráfagas; como el id
viaja a `start` y se usa de doc-id, dos supervisores en el mismo ms podrían
colisionar. Bajo impacto (mitigado porque el panel orphan no monta, y commute
client está marcado "non-fatal/local"); anoto la inconsistencia.

### 🔵 N6 — `ProcessDetailModal.tsx`: suscribe `hallazgos` (best-effort, error silencioso) — colección leída sin garantía de regla/existencia
`ProcessDetailModal.tsx:79-85` hace `onSnapshot(query(collection(db,'hallazgos'),
where('processId','==',...)))` con fallback `() => setHallazgos([])` silencioso
(comentado `:72-73` "collection may not exist for all tenants"). Si la regla
deniega (default-deny para colección desconocida), el listener cae al catch y la
sección "Hallazgos relacionados" siempre muestra 0 — el supervisor cree que no
hay hallazgos asociados al proceso cuando en realidad el read fue denegado. Misma
clase que N4 (read denegado ⇒ falso "vacío"). `tasks` (`:61`) sí tiene regla
(`firestore.rules:905`). Modal montado (3 importadores) → impacto real si la
colección `hallazgos` no es legible para el rol.

### 🔵 N7 — `CloseProcessModal` / `StartProcessModal` / `ProcessDetailModal`: el cómputo de compliance/XP corre 100% client-side y se POSTea como verdad
`CloseProcessModal.computeAutoCompliance` (`:32`) calcula
`100 - incidentes*5 + alertas*5` en el cliente y lo manda como
`complianceScore: auto` al `POST /api/processes/:id/close` (`:67`). El server
recibe el score ya calculado del cliente. Si el endpoint confía en ese valor sin
recomputar, un cliente manipulado puede declarar compliance 100 con incidentes.
No pude verificar el server-side de `/api/processes/:id/close` en este lote (no
está en el slice), pero la superficie cliente envía un valor de cumplimiento
auto-calculado — anoto para revisión del handler. La gamificación XP previa
(`computeProcessCloseXp`) sí se recalcula server-side ("mismo contrato que el
server", `:7`). `StartProcessModal`/`CreateCrewModal` son thin-clients correctos
(server gatea membership; `memberUids:[]` con `createdBy` server-side).

### 🔵 N8 — `commute.ts`: `/sample` y `/end` resuelven la sesión por `collectionGroup` query sin reafirmar tenant del proyecto del caller
`commute.ts:164-171,220-225` localizan la sesión vía
`db.collectionGroup('commute_sessions').where('id','==',sessionId)` y luego
chequean `session.startedBy === callerUid` (`:181,235`). El ownership por
`startedBy` es correcto y suficiente para que un atacante no toque sesiones
ajenas. PERO el lookup cross-tenant por id no verifica que la sesión pertenezca a
un proyecto del que el caller es miembro — sólo que él la inició. Si un usuario
fue removido de un proyecto pero su sesión sigue abierta, puede seguir
appendeando samples/cerrarla (el `/start` sí valida `assertProjectMember`, pero
`/sample` y `/end` NO re-validan membership, sólo `startedBy`). Riesgo bajo
(es su propia sesión), anoto la asimetría: `/start` exige membership, `/sample`+
`/end` sólo exigen autoría.

### 🔵 N9 — Engines puros del lote: limpios, sin hallazgo de seguridad
`continuityPlanning.ts`, `criticalRolesMap.ts`, `faenaStateEngine.ts`,
`projectClosureService.ts`, `speedTrigger.ts`, `criticalRouteScoring.ts`,
`driverRouteMatcher.ts`, `drivingSafetyService.ts`, `internalTransitService.ts`,
`stowageOptimizer.ts`, `operationalChangeService.ts` (engine) — todos
determinísticos, sin Firestore, sin `Math.random`, sin stubs, sin diagnosis. El
id por defecto de `declareChange` usa `sha256` content-addressed
(`operationalChangeService.ts:218`), no `Math.random` — correcto. `ReasonModal`,
`OperationalChangeCard`, `ChangeWorkflowActions`, `ShiftQualityCard`,
`GanttProjectView` — presentacionales limpios. `auditServerEvent` confirmado
**no-throw** (swallow interno + `return false`, `auditLog.ts:83-92`), así que los
`await auditServerEvent(...)` sin try/catch en `projectClosure.ts`/
`operationalChange.ts`/`drivingSafety.ts` NO pueden 5xx la request — cumple #14.

---

## Tabla por archivo (55/55)

| # | Archivo | LOC | Estado | Hallazgo / nota (file:line) |
|---|---|---|---|---|
| 1 | components/changeMgmt/AcknowledgmentBanner.tsx | 233 | 🏚️ | Huérfano (0 imp). Firma biométrica `claim-signing` correcta; usa `acknowledgeMoc` auditado. |
| 2 | components/changeMgmt/ChangeDeclarationForm.tsx | 452 | 🏚️ | Huérfano (0 imp). Usa `declareMoc` auditado — bridge correcto sin montar. |
| 3 | components/changeMgmt/ChangeWorkflowActions.tsx | 238 | ✅ | Montado (OperationalChanges). Role-gates client-only (UX); el engine reafirma. |
| 4 | components/changeMgmt/MOCStatusPanel.tsx | 278 | 🏚️ | Huérfano (0 imp). Usa `closeMoc`/`useMocList` auditados. |
| 5 | components/changeMgmt/OperationalChangeCard.tsx | 106 | ✅ | Presentacional, montado. |
| 6 | components/changeMgmt/ReasonModal.tsx | 181 | ✅ | Modal validado, limpio. |
| 7 | components/continuity/SpofPanel.tsx | 116 | 🏚️ | Huérfano (confirmado 0 imp). |
| 8 | components/criticalRoles/CriticalRoleCoverageCard.tsx | 112 | 🏚️ | Huérfano (0 imp). |
| 9 | components/governance/DeviationRadarPanel.tsx | 134 | 🏚️ | Huérfano (0 imp). Service `deviationNormalizationRadar.ts` existe; UI no montada. |
| 10 | components/operationalState/FaenaStateBanner.tsx | 106 | 🏚️ | Huérfano (0 imp). Engine `faenaStateEngine` listo, sin consumidor. |
| 11 | components/processes/CloseProcessModal.tsx | 184 | 🔵 | N7 `computeAutoCompliance` client → POST `complianceScore` `:67`. Montado (2 imp). |
| 12 | components/processes/CreateCrewModal.tsx | 169 | ✅ | Thin-client correcto; server gatea membership. Montado. |
| 13 | components/processes/ProcessDetailModal.tsx | 310 | 🔵 | N6 `onSnapshot('hallazgos')` error silencioso `:79-85`. Montado (3 imp). |
| 14 | components/processes/StartProcessModal.tsx | 252 | ✅ | Thin-client; analytics try/catch-guarded. Montado. |
| 15 | components/projectClosure/ProjectClosureCard.tsx | 162 | 🏚️ | Huérfano (0 imp). La page usa el hook directo, no esta card. |
| 16 | components/projects/GanttProjectView.tsx | 440 | ✅ | Montado (3 imp). XP recomputado client mirror del server; sin hallazgo. |
| 17 | components/shiftHandover/ShiftHandoverHistoryList.tsx | 282 | 🏚️ | Huérfano. Consume `fetchShiftHandoverHistory` stub (N1, empty-state). |
| 18 | components/shiftHandover/ShiftHandoverPanel.tsx | 612 | 🔴 | N1 consume stubs que fingen persistencia/ack `:186,213,234`. Huérfano (mitiga). |
| 19 | components/shiftHandover/ShiftQualityCard.tsx | 93 | ✅ | Presentacional, montado (ShiftHandover page). |
| 20 | hooks/useAutoCalendarEvents.ts | 80 | 🟡 | N4 escribe `calendar_events` sin regla; fail silencioso `:59,72`. Consumidor ComiteParitario. |
| 21 | hooks/useChangeMgmt.ts | 139 | 🏚️ | Huérfano (0 imp). Pure-compute legacy `/change-mgmt/*`. |
| 22 | hooks/useContinuity.ts | 102 | 🏚️ | Huérfano (0 imp). |
| 23 | hooks/useCriticalRoles.ts | 118 | 🏚️ | Huérfano (0 imp). |
| 24 | hooks/useOperationalChange.ts | 238 | 🟡 | Bridge auditado correcto; sólo lo usan los 3 comps huérfanos (1,2,4). |
| 25 | hooks/useProjectClosure.ts | 168 | ✅ | Montado (ProjectClosure page). Bridge a `/closure/*` auditado. |
| 26 | hooks/useShiftHandover.ts | 243 | 🔴 | N1 stubs disfrazados `:171,186,220,235` violan #13(b)(c). |
| 27 | pages/Calendar.tsx | 619 | ✅ | Lee `projects/{id}/events` `:246` (NO `calendar_events` — ver N4). Forecast honesto sin Math.random. |
| 28 | pages/OperationalChanges.tsx | 552 | 🟡 | N2 copy promete audit_logs `:522`; persiste client sin audit `:169,238`. Montado. |
| 29 | pages/ProjectClosure.tsx | 646 | ✅ | Usa hook auditado; finalize gateado por isAdmin+canClose. |
| 30 | pages/Projects.tsx | 768 | ✅ | MFA-gate en create `:81`. Gantt schedule-from-modal es TODO-stub honesto `:730`. |
| 31 | pages/ShiftHandover.tsx | 472 | 🟡 | N5 `Math.random` shift id `:137`; persiste client sin audit (ya en B13). Montado. |
| 32 | server/routes/changeMgmt.ts | 249 | 🟡 | Pure-compute legacy (ya B13). verifyAuth+guard OK; sin persist/audit por diseño. |
| 33 | server/routes/commute.ts | 263 | 🔵 | N8 `/sample`+`/end` sólo validan `startedBy`, no re-membership `:181,235`. audit OK `:106,243`. |
| 34 | server/routes/continuity.ts | 196 | ✅ | Pure-compute; verifyAuth+guard+zod. Sin consumidor UI (ya B13). |
| 35 | server/routes/criticalRoles.ts | 209 | ✅ | Pure-compute; verifyAuth+guard+zod. Sin consumidor UI. |
| 36 | server/routes/driving.ts | 161 | ✅ | Pure-compute telemetría; verifyAuth+guard+zod. Limpio. |
| 37 | server/routes/drivingSafety.ts | 643 | 🟡 | N3 route create/alert/journey get+set sin tx; audit OK (no-throw, #14 cumple). |
| 38 | server/routes/operationalChange.ts | 396 | 🟡 | N3 close get→set sin runTransaction `:339-371`. Guard 100%-ack + audit OK. |
| 39 | server/routes/projectClosure.ts | 675 | 🟡 | N3 initiate/finalize read-modify-write sin tx `:327,505-530`. audit no-throw OK. |
| 40 | server/routes/routeScoring.ts | 162 | ✅ | Pure-compute; verifyAuth+guard+zod. Limpio. |
| 41 | server/routes/shiftHandover.ts | 320 | 🟡 | Pure-compute sin persist ni audit `:30` (ya B13, gap PR #606). verifyAuth+guard OK. |
| 42 | services/cargo/stowageOptimizer.ts | 309 | ✅ | COG + 3DBPP FFD puro determinista. Limpio. |
| 43 | services/changeMgmt/operationalChangeFirestoreAdapter.ts | 64 | 🟡 | N3 addAcknowledgment get→set (no arrayUnion) pierde acks concurrentes `:36-45`. |
| 44 | services/changeMgmt/operationalChangeService.ts | 553 | ✅ | Engine MOC puro; id sha256 content-addressed `:218`. Workflow ISO 45001 completo. |
| 45 | services/changeMgmt/operationalChangeStore.ts | 29 | 🟡 | Store client `createProjectScopedStore` sin audit (ya B13). |
| 46 | services/continuity/continuityPlanning.ts | 225 | ✅ | SPOF/outage/polyvalencia puro. Limpio. |
| 47 | services/criticalRoles/criticalRolesMap.ts | 236 | ✅ | Bus-factor + catálogo curado. Limpio. |
| 48 | services/driving/commuteSession.ts | 299 | 🔵 | N5 `Math.random` session id `:216` (server usa randomUUID). Tagging puro OK. |
| 49 | services/driving/speedTrigger.ts | 224 | ✅ | Haversine/brake puro determinista. Limpio. |
| 50 | services/drivingSafety/drivingSafetyService.ts | 203 | ✅ | Driver score/route risk puro. Limpio. |
| 51 | services/internalTransit/internalTransitService.ts | 353 | ✅ | Pre-op checklist + speed zones + fatiga, puro. Limpio. |
| 52 | services/operationalState/faenaStateEngine.ts | 132 | ✅ | Estado faena first-match-wins puro. Limpio. |
| 53 | services/projectClosure/projectClosureService.ts | 212 | ✅ | Summary multi-rol + readiness puro. Limpio. |
| 54 | services/routeScoring/criticalRouteScoring.ts | 266 | ✅ | Perfil segment-aware puro, never-throws. Limpio. |
| 55 | services/routeScoring/driverRouteMatcher.ts | 232 | ✅ | Driver↔ruta match puro. Limpio. |

Leyenda: ✅ ok · 🟡 deuda/parcial · 🏚️ huérfano · 🔵 backend listo / nota menor · 🔴 invariante rota.

## Archivos limpios (sin hallazgo 🔴/🟡): 3,5,6,12,14,16,19,25,27,29,30,34,35,36,40,42,44,46,47,49,50,51,52,53,54,55 (26/55). Huérfanos sin defecto propio: 1,2,4,7,8,9,10,15,17,21,22,23 (12). Con hallazgo nuevo 🔴/🟡: 18,20,24,26,28,31,33,37,38,39,41,43,45,48,11,13 (16, incl. 🔵 menores 11/13/33/48).

---

## Resumen (6-10 líneas)

Lote EX-27 — 55/55 archivos B13-MOC (FEAT) leídos línea por línea. Un 🔴 NUEVO:
`useShiftHandover.ts` exporta tres stubs disfrazados (`createShiftHandover`,
`acknowledgeShiftHandover`, `addShiftHandoverDiscrepancy`) que el
`ShiftHandoverPanel` llama y que **eco-construyen** un ShiftRecord falso y
muestran "acuse/discrepancia registrada" sin persistir ni auditar el relevo legal
de turno — viola la directiva #13 en (b)(c); mitigado solo porque el panel sigue
huérfano. 🟡 nuevos: (N2) `OperationalChanges.tsx` imprime al prevencionista
"quedará registrado en el audit log (DS 76 + ISO 45001 §8.1.3)" mientras la
acción persiste client-side sin audit alguno — promesa de cumplimiento legal que
el código no honra; (N3) tres superficies hacen read-modify-write sin
`runTransaction` (`projectClosure` initiate/finalize sobre `closure/state`,
`operationalChange` close, y `operationalChangeFirestoreAdapter.addAcknowledgment`
que usa replace en vez de arrayUnion y pierde acks concurrentes) — candidatas a la
lista #19; (N4) `useAutoCalendarEvents` escribe `calendar_events` sin regla
Firestore (default-deny lo bloquea silenciosamente, o sería colección sin las ≥5
rules-tests), y además la page Calendar lee otra colección (`events`) → función
muerta o rota en silencio. 🔵 menores: `Math.random` para IDs en client
(ShiftHandover/commuteSession) inconsistente con el `randomUUID` del server;
`ProcessDetailModal` traga reads denegados de `hallazgos` como "vacío";
`CloseProcessModal` calcula compliance client-side y lo POSTea; `commute /sample`+
`/end` validan autoría pero no re-membership. Confirmado limpio: `auditServerEvent`
es no-throw (los `await` sin try/catch NO pueden 5xx, cumple #14) y los 11 engines
puros del lote (continuity, criticalRoles, faenaState, routeScoring×2, driving×2,
stowage, internalTransit, projectClosure, operationalChangeService) son
determinísticos sin random/stub/Firestore. Doc-only, sin commit.
