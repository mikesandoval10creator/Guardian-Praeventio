# DEEP-EX-17 — Pasada exhaustiva línea-por-línea (Lote #17, B4-Incidentes)

**Ledger slice**: `category` empieza con `FEAT` && `block === "B4-Incidentes"`, ordenado por `path`,
`[55:71]` → 16 archivos.
**Método**: lectura completa línea-por-línea de cada archivo. Hallazgos NUEVOS respecto a
`DEEP-B4-Incidentes.md` (que cubrió wiring de routes, edge-no-materializado del flujo PDCA, bundle
path-mismatch, `Math.random` en `incidentRagService:299`, CQRS demo, mismatch nombre `root_cause_analyses`
como "🟡 verificar") y a los lotes EX previos. Esta pasada se enfoca en confirmar/cerrar los "verificar"
con wiring real (cliente vs Admin SDK), reglas Firestore faltantes, audit-invariant (#3/#14), stubs
disfrazados (#13), `Math.random`/IDs no deterministas (#15), fuga de internals (#8), `JSON.parse` sin
try/catch (#5), RMW sin transacción (#19), promesas sin await, bugs PDCA/causas, y doc-drift.

## Atestación — 16/16 archivos leídos íntegros

| # | Archivo | LOC | Veredicto |
|---|---------|-----|-----------|
| 1 | src/services/incidentBundle/incidentEvidenceBundle.ts | 432 | 🔵 |
| 2 | src/services/incidentTrends/trendAnalyzer.ts | 340 | 🔵 |
| 3 | src/services/incidents/incidentRagService.ts | 435 | 🟡 |
| 4 | src/services/lessonsLearned/lessonsFirestoreAdapter.ts | 66 | 🟡 |
| 5 | src/services/lessonsLearned/lessonsLibrary.ts | 170 | 🔵 |
| 6 | src/services/pdca/pdcaCycle.ts | 198 | 🔵 |
| 7 | src/services/pdca/pdcaCycleEngine.ts | 225 | 🟡 |
| 8 | src/services/rootCause/noBlameInvestigation.ts | 320 | 🔵 |
| 9 | src/services/rootCause/rootCauseClassifier.ts | 153 | 🔵 |
| 10 | src/services/rootCause/rootCauseStore.ts | 68 | 🔴 |
| 11 | src/services/rootCauseInvestigation/investigationMode.ts | 273 | 🔵 |
| 12 | src/services/sif/sifFirestoreAdapter.ts | 101 | 🔵 |
| 13 | src/services/sif/sifPrecursorClassifier.ts | 218 | 🔵 |
| 14 | src/services/zettelkasten/families/eventsIncidentsNodeRegistry.ts | 71 | 🔵 |
| 15 | src/services/zettelkasten/flows/incidentLessonTrainingFlow.ts | 904 | 🔵 |
| 16 | src/services/zettelkasten/incidentPostmortem.ts | 348 | 🟡 |

🔴 1 · 🟡 4 · 🔵 11

---

## 🔴 Hallazgos críticos

### 🔴 H1 — `root_cause_analyses` cliente: la regla existe con OTRO nombre (`root_causes`) → writes default-denegados en prod (#4)
`rootCauseStore.ts` usa el **client SDK** (`import { db, setDoc, onSnapshot } from '../firebase'`) y
escribe vía `setDoc` en `projects/{projectId}/root_cause_analyses/{incidentId}`
(`rootCauseStore.ts:19-35`). Está **cableado en runtime** desde la página
`RootCauseInvestigation.tsx:24-26,85,149` (`saveRootCauseAnalysis(selectedProject.id, analysis)` en el
submit del análisis de causa raíz). En `firestore.rules` **NO existe** `match /root_cause_analyses`:

```
$ grep -c root_cause_analyses firestore.rules → 0
```

El bloque Sprint-K (`firestore.rules:402-408`) sí creó una regla, pero para la colección
`root_causes` —nombre distinto—:
```
match /root_causes/{rcId} {
  allow create: ... && incoming().analyzedByUid == request.auth.uid;
  ...
}
```
Como el store escribe a `root_cause_analyses`, el único matcher aplicable es el master-gate
`match /{subCollection=**}/{docId}` (`firestore.rules:258-259`) que **solo concede `read`**. Por tanto
todo `saveRootCauseAnalysis()` es **default-denegado en producción** (`PERMISSION_DENIED`). Es
**exactamente** el patrón que el comentario del bloque Sprint-K (`firestore.rules:365-382`) dice haber
corregido ("had NO write rule, so the master-gate granted read-only and every client save() was
default-denied in production"), pero quedó con el nombre de colección equivocado → el análisis de causa
raíz de vidas críticas se pierde silenciosamente en terreno.

**Enmascaramiento confirmado**: `rootCauseStore.firestore.test.ts:9,43,67,78` usa
`getEmulatorAdminFirestore` (Admin SDK → **bypassa** las security rules), así que el round-trip pasa y no
detecta el deny. No hay test en `rules-tests/` que ejercite `root_cause_analyses` con cliente autenticado.
Idéntico al patrón H1 de DEEP-EX-15 (`control_validations`).

**Nota**: el payload de `RootCauseAnalysis` SÍ trae `analyzedByUid` (`rootCauseClassifier.ts:40,113`),
así que la regla de `root_causes` sería aplicable casi tal cual —solo hay que (a) renombrar la regla a
`root_cause_analyses` (o alinear el store a `root_causes`), (b) añadir ≥5 rules-tests con cliente
autenticado (directiva #4), (c) entrada Dirty Dozen en `security_spec.md`. DEEP-B4 lo dejó como
🟡 "verificar si el store se usa con Admin SDK o si está roto en cliente"; aquí queda **confirmado roto en
cliente** (es client SDK, cableado a la página, sin regla).

---

## 🟡 Hallazgos medios

### 🟡 H2 — `incidentPostmortem` audita a `tenants/{tid}/audit_log` (no-canónico), fuera del trail de cumplimiento (#3)
`incidentPostmortem.ts:181-183,304-315` escribe su fila de auditoría en
`tenants/${tenantId}/audit_log` (singular, tenant-scoped). El **trail canónico** del producto es la
colección **root `audit_logs`** (`src/server/middleware/auditLog.ts:71`:
`admin.firestore().collection('audit_logs').add(...)`). El disparador real
(`backgroundTriggers.ts:406` al cerrar incidente crítico) materializa nodo ZK + edge —una operación que
muta Firestore— pero la fila de auditoría correspondiente **no** llega a `audit_logs`; queda en una
colección paralela `tenants/{tid}/audit_log` que (a) **no tiene regla** en `firestore.rules` (default-deny;
sólo el Admin SDK la escribe, invisible para cualquier consumidor cliente), y (b) usa
`doc(\`${edgeId}-${Date.now()}\`)` como id (línea 306) → sufijo no determinístico (no rompe idempotencia
del nodo/edge, que sí son deterministas, pero rompe la del audit row: re-cerrar el incidente crea una fila
de audit nueva cada vez). DEEP-B4 afirmó "Audita a **root audit_logs**" para el flujo PDCA de
`incidentFlow.ts`; eso es cierto para ESE router, pero el **postmortem trigger** audita al path
tenant-scoped no-canónico — divergencia no registrada en DEEP-B4. La acción es interna (knowledge graph),
no user-facing, por eso 🟡 y no 🔴, pero contradice la invariante #3 ("every state-changing operation MUST
write to `audit_logs`").
**Acción**: emitir la fila vía `auditServerEvent`/root `audit_logs`, o documentar inline por qué este
sub-trail tenant-scoped es aceptable; usar `randomId()` en vez de `Date.now()` para el id.

### 🟡 H3 — `incidentRagService.generateIncidentId`: `Math.random()` + ternario muerto (#15)
`incidentRagService.ts:291-301`. Dos cosas:
1. `Math.random().toString(36).slice(2,8)` para el sufijo del id (`inc_${ts}_${rand}`). Está en
   `src/services/` (no `src/server/`), así que el lint custom de #15 probablemente no lo capture, pero
   **es ID-generation** y debería usar `randomId()` (`src/utils/randomId.ts`). DEEP-B4 ya lo flagueó 🟡;
   se re-confirma y se añade el matiz del dead-code:
2. El cálculo de `ts` (líneas 293-298) es un **ternario muerto**: ambas ramas devuelven `Date.now()`
   independientemente de si `now()` retorna string u otra cosa:
   ```ts
   const ts = typeof now === 'function'
     ? (typeof now() === 'string' ? Date.now() : Date.now())   // ambas ramas idénticas
     : Date.now();
   ```
   Inofensivo funcionalmente pero confunde: el `id` interno **ignora** el `now` inyectado y usa el reloj
   real, por lo que dos llamadas con el mismo `deps.now` fijo (tests deterministas) producirían ids
   distintos salvo que el caller pase `payload.id`. No es stub-disfrazado, pero es ruido a limpiar.
**Acción**: `const rand = randomId().slice(0,6)` + colapsar el ternario a `Date.now()` (o respetar `now()`
si se quiere id determinista bajo inyección).

### 🟡 H4 — `lessonsFirestoreAdapter.incrementAdoption`: RMW sin transacción (#19) — mitigado por no estar cableado
`lessonsFirestoreAdapter.ts:29-37` hace `get()` → `{...current, adoptionCount: current.adoptionCount+1}`
→ `set()` sobre el **mismo** doc, sin `runTransaction`. Dos adopciones concurrentes pueden leer el mismo
`adoptionCount` y perder un incremento (lost-update). El adapter corre **server-side** vía Admin SDK
(`LessonsAdapter` instanciado en `routes/lessonsLearned.ts:102,156` y `routes/projectClosure.ts:385` con
`admin.firestore()`), por lo que aplica la directiva #19 (≥1 `get` + ≥1 `set` sobre el mismo path ⇒
`runTransaction`). **Mitigante**: `incrementAdoption` **no está expuesto por ninguna ruta** —
`grep` solo encuentra `listTopAdopted`/`save`/`create` en `routes/lessonsLearned.ts`; el contador de
adopción no se incrementa en runtime hoy. Por eso 🟡 y no 🔴: es deuda latente que se volvería bug en
cuanto se cablee un endpoint "adoptar lección". Debería usar `FieldValue.increment(1)` (atómico, ideal
para contadores) o `runTransaction`.
**Acción**: reemplazar el RMW por `update({ adoptionCount: FieldValue.increment(1) })` antes de cablear
cualquier endpoint de adopción.

### 🟡 H5 — `pdcaCycleEngine.summarizeCycle`: agrega TODOS los ciclos, no "el ciclo actual"
`pdcaCycleEngine.ts:195-225`. El JSDoc dice "Returns metrics for the **current cycle**" y el tipo
`CycleSummary.cycleNumber` reporta `project.cycleNumber`, pero el loop itera sobre **`project.stages`
completo** (líneas 201-211), que acumula **todas** las etapas de **todos** los ciclos (cada `advanceStage`
hace `[...updatedStages, newEntry]`, nunca segmenta por ciclo). Resultado: `evidenceCount`,
`avgEfficacyScore` y `daysByStage` mezclan evidencia/eficacia de ciclos anteriores con el actual. En un
proyecto multi-ciclo (el propósito explícito del archivo, líneas 1-9) el "resumen del ciclo actual" infla
las métricas con historia. No hay campo de ciclo en `PDCAEntry` para filtrar (`activityId` codifica el
número de ciclo como string `…-cycle-N-…` línea 140, pero `summarizeCycle` no lo parsea). Determinístico,
no rompe seguridad, pero el dato que pinta el dashboard de mejora continua es engañoso.
**Acción**: filtrar `project.stages` por el ciclo actual (parsear `activityId` o añadir `cycleNumber` a
`PDCAEntry`) antes de agregar.

---

## 🔵 Limpios / sin hallazgo nuevo

- **`incidentEvidenceBundle.ts` (1)** — Scorer de completitud puro, sin I/O; `assertIncidentCore` valida
  fecha; `normalizeSeverity` (Codex P2 PR #122) mapea labels español→canónico en el borde para no saltarse
  `no_root_cause_assigned` en incidentes Alta/Crítica legacy. Pesos suman 100, `Math.max(0, …)`. Un solo
  gap de control-failure por bundle (`break`, :309) para no inflar. Sin Math.random, sin Firestore, sin
  diagnóstico. (El mismatch de path **root `incidents`** vs `tenants/.../incidents` del bundle ya está en
  DEEP-B4 §2 — vive en `incidentBundle.ts` route, no en este service.) ✅
- **`trendAnalyzer.ts` (2)** — Series temporales determinísticas; relleno de buckets vacíos con guard
  `safety<5000` (Codex P2 PR #102), sort por epoch (no lexicográfico), outliers leave-one-out con manejo
  de `otherStd===0`→`Infinity`. `comparePeriods` rango half-open `[a,b)`. Sin Math.random. ✅
- **`lessonsLibrary.ts` (5)** — Motor léxico puro (tokenize sin acentos, Jaccard-ish), scoring de
  sugerencia determinístico, `buildAdoptionReport` inmutable. Sin I/O. ✅
- **`pdcaCycle.ts` (6)** — Máquina PDCA por NC determinística; `effectivenessRate` con guard de
  división-por-cero; `checkLinkageHealth` detecta huérfanas stale >7d; rankings con orden estable
  (critical-first). Puro. ✅
- **`noBlameInvestigation.ts` (8)** — Detector de lenguaje punitivo (regex), banco de preguntas
  sistémicas, versionado de testimonio + diff Jaccard, timeline con detección de gaps. 100%
  determinístico, sin LLM. Enfoque no-punitivo coherente con directiva del producto. Sin diagnóstico
  médico. ✅
- **`rootCauseClassifier.ts` (9)** — Taxonomía ILO+ANSI Z10; `buildAnalysis` valida primary∈factors,
  5-Why ∈ [1,5] con ≥15 chars, ≥1 acción; `computeStats` dedup y top-3. Puro, errores tipados
  (`RootCauseValidationError`), sin fuga de internals. ✅
- **`investigationMode.ts` (11)** — Árbol Ishikawa 6M + 5-Why; profundidad ≤5 con guard
  `TOO_DEEP`, dedup de ids (`DUPLICATE_ID`), `isShallowAnswer`, `classifyCategory` por keywords,
  `extractDeepestChain`. Puro, recursión acotada. ✅
- **`sifFirestoreAdapter.ts` (12)** — Adapter Admin SDK (server-side: `SIFAdapter` instanciado con
  `admin.firestore()` en `routes/sif.ts:68,100`). `recordExecutiveReview`/`recordMandanteNotification`
  son `update()` de un solo write (no RMW). Path tenant+project-scoped. No aplica rule-gap cliente. ✅
- **`sifPrecursorClassifier.ts` (13)** — Clasificador SIF determinístico (umbrales DS 594: altura ≥1.8m,
  voltaje >50V, presión >7bar, etc.); deriva `potential`/`executiveReviewRequired`/`mandanteNotification`
  de magnitud + expuestos. `summarizeSIFPrecursors` puro. Sin Math.random, sin LLM. ✅
- **`eventsIncidentsNodeRegistry.ts` (14)** — Catálogo estático de 60 nodos (datos + hints de
  producer/consumer). Sin lógica, sin I/O. ✅
- **`incidentLessonTrainingFlow.ts` (15)** — NodeFactories puras + orquestador DI con ids deterministas
  idempotentes; `computePdcaStatus` reconstruye estado PDCA por tipos de nodo. El gap conocido
  (`createEdge` no inyectado en runtime → grafo desconectado) **ya está documentado 🔴 en DEEP-B4 §2** —
  no se re-cuenta aquí; el archivo en sí (las factories + orquestador) es correcto y testeable. ✅
- **`reportIncident`/`indexIncident`/`searchIncidents` (3, salvo H3)** — DI Firestore+embedder, aislación
  tenant por path `incident_vectors/{tid}/items` + filtro defensivo de tenantId (`:188-191`), best-effort
  index/XP que no rompen el write, XP positivo-only. Persistencia correcta a
  `tenants/{tid}/projects/{pid}/incidents`. ✅
- **`incidentPostmortem.ts` (16, salvo H2)** — Fire-and-forget robusto (ningún throw escapa, Sentry
  capture), anchor por ragSearch→fallback tabla→DS-594, nodeId/edgeId deterministas idempotentes,
  100% interno (no push a SUSESO/MINSAL). Engine sólido aparte del audit-path no-canónico de H2. ✅
- **Transversal**: **sin diagnóstico médico (ADR 0012)** en ningún archivo del lote. **Sin gamificación
  negativa** (XP positivo-only respetado en `reportIncident` y en el flujo PDCA). **Sin stubs disfrazados
  (#13)** ni `NotImplementedError`. **Sin `JSON.parse` (#5)** — ningún archivo del lote parsea respuestas
  Gemini (los engines son puros, sin LLM). **Sin fuga de internals (#8)** — estos son services, no
  handlers HTTP. **Sin Math.random** salvo `incidentRagService:299` (H3).

---

## Resumen (6-10 líneas)

Lote #17 (16 archivos B4-Incidentes, services) leídos íntegros. Los motores de dominio (bundle de
evidencia, tendencias, clasificador de causa raíz, investigación no-punitiva, árbol Ishikawa 6M,
clasificador SIF, PDCA por NC, NodeFactories del flujo PDCA) son puros, determinísticos y correctos; sin
diagnóstico médico, sin gamificación negativa, sin stubs, sin `JSON.parse` de Gemini. **1 hallazgo 🔴**:
(H1) `rootCauseStore.ts` es client-SDK cableado a la página `RootCauseInvestigation.tsx` y escribe a
`projects/{pid}/root_cause_analyses`, pero la regla del bloque Sprint-K se creó con el nombre equivocado
`root_causes` → el master-gate deja la colección read-only y todos los `setDoc` de causa raíz de vidas
críticas quedan default-denegados en prod; el `.firestore.test.ts` usa Admin SDK y enmascara el deny
(idéntico al patrón H1 de DEEP-EX-15). **4 hallazgos 🟡**: (H2) el postmortem-trigger audita a
`tenants/{tid}/audit_log` no-canónico (no a root `audit_logs`, invariante #3) con id `Date.now()`-based;
(H3) `incidentRagService.generateIncidentId` usa `Math.random()` (#15) y tiene un ternario muerto que
ignora el `now` inyectado; (H4) `lessonsFirestoreAdapter.incrementAdoption` es RMW sin transacción (#19),
mitigado porque ninguna ruta lo cablea hoy; (H5) `pdcaCycleEngine.summarizeCycle` dice "ciclo actual"
pero agrega `project.stages` de todos los ciclos, inflando evidencia/eficacia en proyectos multi-ciclo.
Doc-only; sin cambios de código ni commit.
