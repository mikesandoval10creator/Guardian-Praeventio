# DEEP — B4 Incidentes & Investigación · 2026-06-02

**Archivos revisados:** 103 (ledger `block === "B4-Incidentes"`). Lectura a fondo de los 8 server routes, los 12 services de dominio, el flujo PDCA Zettelkasten, el subsistema CQRS, hooks, pages y `firestore.rules`. Ampliado con grep `incident|rootCause|investigat|lessonsLearned|correctiveAction|cuasi|nearMiss|stoppage|incidentFlow|incidentTrends|incidentBundle`.

---

## 1. Lo que YA HACE (implementado y real)

- **Reporte canónico de incidente** — `POST /api/incidents/report` montado en `server.ts:946`. Stack `verifyAuth → incidentsLimiter (30/15min) → idempotencyKey → validate(zod)`. uid del token, tenantId resuelto desde el project doc (no del body). Persiste en `tenants/{tid}/projects/{pid}/incidents/{id}`, indexa embedding para RAG (best-effort), emite XP positivo y escribe `audit_logs` (root, canónico). `src/server/routes/incidents.ts:87-191`, motor `src/services/incidents/incidentRagService.ts:321-435`. Cierra el TODO histórico "no hay reportIncident()" (línea 3-9).
- **RAG de incidentes** — `indexIncident()` + `searchIncidents()` con aislación multi-tenant estricta por path `incident_vectors/{tid}/items` + filtro defensivo de tenantId (`incidentRagService.ts:106-213`).
- **Flujo PDCA Accidente→Investigación→Lección→Microcapacitación** — 7 endpoints en `src/server/routes/incidentFlow.ts` (montado `server.ts:1044`), orquestador puro en `src/services/zettelkasten/flows/incidentLessonTrainingFlow.ts` (905 LOC, DI testeable, ids deterministas idempotentes). Cada paso materializa un nodo ZK; el GET `/status` reconstruye el estado PDCA con `computePdcaStatus` (`incidentLessonTrainingFlow.ts:850-896`). Audita a **root `audit_logs`** vía `writeAudit` → `incidentFlow.ts:133` (✅ confirmado root, NO tenant-scoped; el header línea 159-161 documenta que el path tenant-scoped previo fue corregido).
- **Árbol de causas real (Ishikawa 6M + 5-Why)** — `src/services/rootCauseInvestigation/investigationMode.ts` (273 LOC): `buildInvestigationTree` con profundidad ≤5, `classifyCategory` a 6M (Machine/Method/Material/Measurement/Man/Environment), `isShallowAnswer` (detecta "error humano" sin profundizar), `extractDeepestChain`. Endpoints stateless en `rootCauseInvestigation.ts`.
- **Clasificador estadístico de causa raíz** — `src/services/rootCause/rootCauseClassifier.ts` (taxonomía ILO+ANSI Z10, 10 factores) + 5-Why en `buildAnalysis`. Endpoints `rootCause.ts` (`build-analysis` con analyzedByUid forzado al caller).
- **Investigación sin culpa** — `noBlameInvestigation.ts` (320 LOC): `analyzePunitiveLanguage` detecta lenguaje acusatorio, banco de preguntas guiadas, cadena de tiempo. Cableado a UI (`PunitiveLanguageWarning.tsx`).
- **Acciones correctivas PDCA** — `correctiveActions.ts` (3 endpoints, tenant-scoped, `auditServerEvent` AWAITED) + `weakActionDetector.ts` (detecta lenguaje débil, jerarquía ISO 45001, desequilibrio 70% training, duplicación, recidiva sistémica; determinístico sin LLM) + `correctiveActionsCenter.ts` (consolida 5 fuentes).
- **Biblioteca de lecciones** — `lessonsLearned.ts` + `lessonsFirestoreAdapter.ts` (`tenants/{tid}/lessons`, tenant-wide, gateado por `assertProjectMember`, audita root via `auditServerEvent`). `lessonsLibrary.ts` motor léxico de adopción.
- **Tendencias** — `incidentTrends.ts` (492 LOC): regresión lineal least-squares con R², leading indicators (nearMissRatio, closureRate, averageDaysOpen), buckets month/week con relleno de gaps, byKind observado (no hardcodeado). Lee top-level Y nested y deduplica (líneas 281-312).
- **Expediente de evidencia** — `incidentBundle.ts` + `incidentEvidenceBundle.ts` (scorer de completitud + gaps).
- **Post-mortem auto-write** — `incidentPostmortem.ts` anclado a normativa vía RAG, consumido por trigger `backgroundTriggers.ts:28` al cerrar incidente crítico (también dispara FCM + email CPHS).
- **Gamificación positiva** — `daysWithoutIncident.ts` (medallas 100/365 días), XP por reportar (positivo-only, nunca castiga al reporter).
- **Reglas Firestore para compliance state-machines** — `stoppages` (✅ `firestore.rules:388-394`: `declaredByUid == request.auth.uid` en create, inmutable en update, `delete:false`) y `operational_changes` (395-401), `root_causes` (402-408). El subtree `tenants/` (944) da read a miembros y `create/update/delete:false` a subcolecciones → B4 es **server-write-only** (Admin SDK), cliente read-only. Top-level `incidents`/`incident_vectors` caen a default-deny (rules:17-19) → solo Admin SDK escribe. Correcto.

---

## 2. Lo que está PENDIENTE (deuda de este bloque)

- 🔴 **El flujo PDCA NO materializa edges en producción.** `flowDepsFor` inyecta solo `writeNodes`, nunca `createEdge` (`incidentFlow.ts:77-84`). El orquestador hace `if (!deps.createEdge) return null` (`incidentLessonTrainingFlow.ts:522`), así que en runtime se crean los 7 tipos de nodo PERO el grafo queda **desconectado** — no hay aristas `causes`/`derived_from`. El "trail auditable conectado ISO 45001 §10.2" prometido en el header (líneas 5-7, 16-23) no existe end-to-end; `serverZkNodeWriter.ts` no exporta `createEdge`. El `/status` igual funciona (query por `metadata.incidentId`), enmascarando el gap.
- 🟡 **Mismatch de path incidents en el bundle.** `incidentBundle.ts:84` lee de la colección **root `incidents`**, pero el reporte canónico escribe en `tenants/{tid}/projects/{pid}/incidents` (`incidentRagService.ts:361`). Un incidente reportado por el flujo canónico NO aparece en su propio expediente salvo que un trigger lo copie a root. `incidentTrends.ts` sí lee ambos paths (281-312) — la inconsistencia es solo del bundle.
- 🟡 **Bundle con feeds vacíos honestos (stub-disfrazado documentado).** `affectedWorkers/evidence/appliedControls/requiredEpp/requiredTrainings/normativeRefs` van como `[]` (`incidentBundle.ts:162-167`); el header (10-14) lo declara honesto y el scorer los marca como gaps reales. No oculto al usuario, pero no registrado en `docs/stubs-inventory.md` (verificar contra convención #13).
- 🟡 **`Math.random()` en generación de ID.** `incidentRagService.ts:299` (`generateIncidentId`). Está en `src/services/` (no `src/server/`), por lo que el lint custom de convención #15 probablemente no lo capture, pero es ID-generation y debería usar `randomId()`.
- 🟡 **CQRS de incidentes es demo in-memory, no persistente.** `incidentSystem.ts:20` usa `InMemoryEventStore` — alimenta la página `<CQRSArchitecture />` con "números reales" del proceso, pero NO es la ruta canónica de persistencia. Coexisten dos modelos de incidente (canónico Firestore vs CQRS demo); riesgo de confusión.
- 🟡 **Mismatch nombre de colección root-cause cliente.** `rootCauseStore.ts:4` escribe client-side a `projects/{pid}/root_cause_analyses/{incidentId}`, pero la regla Firestore se llama `root_causes` (`firestore.rules:402`) → las escrituras cliente a `root_cause_analyses` caen en default-deny. Verificar si el store se usa con Admin SDK o si está roto en cliente.
- 🟡 **Microcapacitación NO se auto-genera desde la lección.** El `moduleId` lo elige el admin y se pasa en el body (`incidentFlow.ts:469-483`); el enlace lección→módulo es solo `derivedFromLessonId` (metadata). No hay derivación AI/automática de contenido de microtraining desde el texto de la lección — el "auto" del nombre es solo el wiring del nodo, no generación de contenido.
- 🟡 **Comentario stale en server.ts:196-198** dice que `incidentFlowRouter` está "orphaned... until mounted", pero sí está montado en línea 1044. Doc drift menor.

---

## 3. Tabla por archivo (selección representativa; los 103 revisados)

| Archivo | LOC | Estado | Cableado | Propósito real + hallazgo file:line |
|---|---|---|---|---|
| `src/server/routes/incidents.ts` | 193 | ✅ | `server.ts:946` `/api/incidents` | Reporte canónico; audita root `audit_logs:144`; tenant del project doc:108 |
| `src/server/routes/incidentFlow.ts` | 747 | 🟡 | `server.ts:1044` | PDCA 7 endpoints; audita root `audit_logs:133` ✅; edges NO inyectados (flowDepsFor:77-84) 🔴 |
| `src/server/routes/incidentTrends.ts` | 492 | ✅ | `server.ts:995` | Regresión lineal+leading indicators; lee top-level+nested+dedup:281-312; read-only |
| `src/server/routes/correctiveActions.ts` | 218 | ✅ | `server.ts:1034` | tenant-scoped; `auditServerEvent` awaited:144,196 |
| `src/server/routes/incidentBundle.ts` | 214 | 🟡 | `server.ts:1042` | Lee root `incidents:84` (mismatch con write canónico); feeds vacíos:162-167 |
| `src/server/routes/lessonsLearned.ts` | 177 | ✅ | `server.ts:1002` | `tenants/{tid}/lessons`; audita root:162 |
| `src/server/routes/rootCause.ts` | 242 | ✅ | `server.ts:1145` | Stateless compute; analyzedByUid forzado:107; sin audit (pure) |
| `src/server/routes/rootCauseInvestigation.ts` | 197 | ✅ | `server.ts:1065` | Árbol 6M+5Why stateless; sin persist (caller persiste) |
| `src/services/incidents/incidentRagService.ts` | 436 | 🟡 | via incidents.ts | reportIncident+RAG; `Math.random()` ID:299; write path:361 |
| `src/services/zettelkasten/flows/incidentLessonTrainingFlow.ts` | 905 | 🟡 | via incidentFlow.ts | Orquestador PDCA puro; edges no-op si !createEdge:522 |
| `src/services/rootCauseInvestigation/investigationMode.ts` | 273 | ✅ | via route | Ishikawa 6M + 5-Why depth≤5 real |
| `src/services/rootCause/rootCauseClassifier.ts` | 153 | ✅ | via route | Taxonomía ILO+ANSI Z10, 10 factores |
| `src/services/rootCause/noBlameInvestigation.ts` | 320 | ✅ | via route + UI | analyzePunitiveLanguage + cadena tiempo |
| `src/services/correctiveActions/weakActionDetector.ts` | ~250 | ✅ | via center | Lenguaje débil + jerarquía ISO45001, determinístico |
| `src/services/correctiveActions/correctiveActionsCenter.ts` | 336 | ✅ | via adapter | Consolida 5 fuentes PDCA |
| `src/services/lessonsLearned/lessonsLibrary.ts` | 170 | ✅ | via adapter | Motor léxico de adopción |
| `src/services/incidentBundle/incidentEvidenceBundle.ts` | 432 | ✅ | via route | Scorer completitud + gaps |
| `src/services/incidentTrends/trendAnalyzer.ts` | 340 | 🔵 | parcial | Motor series; el route reimplementa la regresión inline |
| `src/services/cqrs/incidents/incidentSystem.ts` | 161 | 🟡 | `<CQRSArchitecture/>` | InMemoryEventStore:20 — demo, NO persistente |
| `src/services/cqrs/incidents/incidentCommands.ts` | 464 | ✅ | demo | Command handlers + invariantes (event-sourced in-mem) |
| `src/services/zettelkasten/incidentPostmortem.ts` | ~200 | ✅ | `backgroundTriggers.ts:28` | Auto-write postmortem anclado a normativa |
| `src/services/rootCause/rootCauseStore.ts` | 68 | 🟡 | cliente | Path `root_cause_analyses` vs regla `root_causes`:402 → default-deny |
| `src/services/gamification/daysWithoutIncident.ts` | 150 | ✅ | server.ts | Medallas 100/365 días positivas |
| `src/hooks/useIncidentFlow.ts` | ~210 | ✅ | pages | Mutadores POST + GET status a /api/sprint-k |
| `src/pages/IncidentReport.tsx` | 358 | ✅ | route | `POST /api/incidents/report:130` |
| `src/pages/IncidentTrends.tsx` | 602 | ✅ | route | Consume trends endpoint |
| `firestore.rules` (stoppages/root_causes) | — | ✅ | — | 388-394 declaredByUid+delete:false ✅; tenants subtree server-write-only:944,962 |

Estados restantes (componentes UI `*.tsx`, tests `*.test.ts(x)`, medallas SVG, docs `INCIDENT_RESPONSE.md`/`incident-response.md`): ✅ presentes y cableados a sus services/pages; tests cubren happy+401+validación (13 archivos de test server-side para B4).

---

## 4. Para decisión del usuario (❓/⚠️)

- ⚠️ **[edges PDCA, 🔴]** ¿Inyectar `createEdge` en `flowDepsFor` (requiere exportar un edge writer Admin-SDK en `serverZkNodeWriter.ts`)? Sin esto el grafo de aprendizaje ISO 45001 §10.2 queda como nodos sueltos en producción. Es el hallazgo más severo del bloque.
- ⚠️ **[path bundle]** ¿Unificar el path de incidents? `incidentBundle.ts:84` debería leer `tenants/{tid}/projects/{pid}/incidents` (o ambos+dedup como trends) para que el expediente vea los reportes canónicos.
- ❓ **[root_cause_analyses vs root_causes]** ¿Es un bug de cliente roto, o `rootCauseStore.ts` solo se usa server-side? Renombrar regla o store para que coincidan.
- ❓ **[CQRS demo]** ¿`incidentSystem` (in-memory) es solo showcase de `<CQRSArchitecture/>` o se pretende que sea fuente de verdad? Documentar para evitar que alguien lo trate como persistencia.
- ❓ **[Math.random ID]** ¿Migrar `generateIncidentId:299` a `randomId()` por consistencia con convención #15 aunque viva en `src/services/`?
