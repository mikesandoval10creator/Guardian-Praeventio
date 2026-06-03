# DEEP-EX-28 — Lote #28 · ShiftHandover (services) · 2026-06-03

**Deriva:** `ledger.json` filtrado `category` empieza con `"FEAT"` && `block=="B13-MOC"`,
ordenado por `path`, slice **[55:60]** (los últimos 5 de 60). Todos son
`FEAT-services` del subdominio *Cambio de Turno / Bitácora de Supervisor*.

**Atestación: 5/5 archivos leídos completos, línea por línea.**

| # | Archivo | LOC | Leído |
|---|---|---|---|
| 1 | `src/services/shiftBackend.ts` | 87 | ✅ 1-87 |
| 2 | `src/services/shiftHandover/shiftHandoverFirestoreAdapter.ts` | 50 | ✅ 1-49 |
| 3 | `src/services/shiftHandover/shiftHandoverInsights.ts` | 148 | ✅ 1-147 |
| 4 | `src/services/shiftHandover/shiftHandoverService.ts` | 217 | ✅ 1-216 |
| 5 | `src/services/shiftHandover/shiftHandoverStore.ts` | 33 | ✅ 1-32 |

Verificación cruzada: `firestore.rules:474-477`, `src/server/routes/gemini.ts`
(whitelist `:178-179` + dispatch `:404-470`), `geminiBackend.ts:1461`,
`createProjectScopedStore.ts`, `scripts/precommit-medical-guard.cjs`,
`src/pages/ShiftHandover.tsx:136-137`. **No se repiten** los hallazgos ya
registrados en `DEEP-B13-MOC.md` (orfandad del adapter, doble path
`tenants/` vs `projects/`, store sin audit, ruta `shiftHandover.ts`
pure-compute / gap PR #606).

---

## Hallazgos NUEVOS

### 🔴 1. `JSON.parse(response.text)` sin try/catch en `shiftBackend.ts:66` — viola CLAUDE.md §5
- `generateShiftHandoverInsights` hace `return JSON.parse(response.text)` (`:66`)
  sin `try/catch` ni fallback tipado ni 502. La convención §5 lo exige
  textualmente. Una respuesta Gemini malformada lanza `SyntaxError` crudo que
  cae al `catch` genérico del dispatcher (`gemini.ts:448`) y se devuelve como
  HTTP 500 con `error.message` en no-prod (fuga de internals controlada por §8,
  pero el cliente recibe 500 en vez del 502 semántico que pide §5).
- **Nota de alcance:** el patrón se repite en hermanos (`comiteBackend.ts:37/75`,
  `inventoryBackend.ts:78`, `trainingBackend.ts:59/96`, `psychosocialBackend.ts:68`,
  etc.) → es **sistémico**, no exclusivo de este archivo. Se marca 🔴 aquí porque
  esta acción SÍ está whitelisted y es alcanzable (`gemini.ts:178`,
  `geminiBackend.ts:1461`). Candidato a un solo codemod transversal.

### 🟡 2. `analyzeShiftFatiguePatterns` devuelve texto libre sin esquema y roza ADR-0012 — `shiftBackend.ts:69-86`
- A diferencia de su gemela, **no** usa `responseSchema` ni `responseMimeType`;
  hace `return response.text` crudo (`:85`). Sin validación de forma, sin
  fallback. El prompt pide *"Identifica trabajadores o equipos con alto riesgo de
  accidente por fatiga"* (`:77`) — esto es **inferencia de riesgo a nivel de
  trabajador individual** a partir de datos de asistencia/horas extra.
- **ADR-0012 / §10:** `scripts/precommit-medical-guard.cjs` solo escanea
  `src/services/{health,medicine}/`, `src/pages/Health*`, `MyData`, `Medicine`
  (`medical-guard.cjs:52-58`). `src/services/shiftBackend.ts` **queda fuera del
  scope del guard**, de modo que una salida con tono de evaluación de riesgo
  clínico/aptitud por fatiga no dispara el hook. Frontera difusa: la "fatiga
  laboral acumulada" como factor de riesgo operacional es legítima, pero la
  redacción "trabajadores con alto riesgo de accidente" puede derivar a
  calificación de aptitud individual sin `<MedicalDisclaimer/>`. Recomendación:
  acotar el prompt a agregados de equipo/turno (no nominar trabajadores) o
  incluir el archivo en el scope del guard.

### 🟡 3. Handover acusado (`acknowledgedAt`) es mutable post-acuse — gap MOC §4 (post-sign update-deny)
- Cadena: `shiftHandoverStore.patchShift` (`:23-29`) → `store.patch` →
  `updateDoc` sobre `projects/{projectId}/shifts/{id}`. La regla
  `firestore.rules:475` permite `update: if isValidId(projectId) &&
  isProjectMember(projectId)` — **sin `diff().hasOnly(...)` ni guard de
  inmutabilidad post-acuse**. Cualquier miembro del proyecto puede reescribir
  `handoverNotes`, `acknowledgmentNotes` o incluso `acknowledgedByUid` de un
  turno YA cerrado y acusado.
- El engine puro hace lo correcto en memoria (`acknowledgeHandover` bloquea
  doble-acuse `ALREADY_ACKNOWLEDGED` `:167-172` y self-ack `SAME_SUPERVISOR`
  `:173-178`), pero esas invariantes **no se proyectan a Firestore**: el store
  client-side escribe directo, así que la integridad del acuse depende solo de
  la regla, que es permisiva. Equivalente al patrón "post-sign update-deny" que
  §4 exige para colecciones de cumplimiento. `DEEP-B13-MOC` señaló "store sin
  audit" pero **no** la mutabilidad post-acuse del documento firmado — hallazgo
  nuevo.

### 🔵 4. Import muerto `firebase-admin` en `shiftBackend.ts:2`
- `import admin from "firebase-admin";` (`:2`) — `admin` no se usa en ninguna
  parte del archivo (verificado: única ocurrencia es la línea del import). Ruido
  / superficie de dependencia innecesaria en un módulo que solo llama a Gemini.

### 🔵 5. Tipado `any[]` en la frontera Gemini whitelisted — `shiftBackend.ts:6,69`
- `generateShiftHandoverInsights(previousShiftEvents: any[], currentRisks: any[])`
  (`:6`) y `analyzeShiftFatiguePatterns(attendanceData: any[])` (`:69`) reciben
  `any[]` que se serializa directo al prompt (`JSON.stringify` `:15,18,75`). Los
  args llegan crudos del body del cliente vía `gemini.ts:430`
  (`...args` sin esquema). No es inyección de prompt explotable per se (el modelo
  recibe datos, no instrucciones del sistema), pero sin tipos ni `validate`
  middleware la superficie de coste/abuso depende solo del `geminiLimiter`.
  Recomendación: tipar (`ShiftLogEntry[]` ya existe en el service) o validar.

### 🔵 6. (Contexto adyacente, fuera de slice) ID de turno con `Math.random` — `ShiftHandover.tsx:137`
- `startShift({ id: \`shift_${Date.now()}_${Math.random().toString(36).slice(2,8)}\` })`.
  `StartShiftInput.id` (`shiftHandoverService.ts:86`) acepta el id del cliente
  sin validar. La convención §15 prohíbe `Math.random()` en "código de
  generación de IDs"; aquí es client-side (fuera del scope ESLint `src/server/`),
  pero el origen del id (predecible + colisionable con `slice(2,8)` = solo 6
  chars base36) entra al documento Firestore. Se anota como contexto del consumer
  inmediato del service auditado; el archivo en sí está fuera del slice [55:60].

---

## Limpios / sin hallazgo nuevo

- **`shiftHandoverFirestoreAdapter.ts`** — adapter puro a
  `tenants/{tid}/projects/{pid}/shifts`. `save/getById/listForSupervisor/
  listUnacknowledged` correctos; `listUnacknowledged` filtra en memoria
  (`!endedAt → endedAt && !acknowledgedAt`, `:47`) sin índice — aceptable por
  volumen de turnos. **Orfandad y divergencia de path ya registradas en
  `DEEP-B13-MOC` §C / tabla `:124`** — no se repite. Testeado
  (`shiftHandoverFirestoreAdapter.test.ts`, 80 LOC).
- **`shiftHandoverInsights.ts`** — engine determinístico sin LLM, sin efectos
  secundarios, sin Firestore. `computeHandoverQuality` / `detectContinuityIssues` /
  `extractUrgentForIncoming` son funciones puras correctas (scoring clamp a
  [0,100] `:50`, categorías críticas bien definidas). Cumple §9. Testeado
  (`shiftHandoverInsights.test.ts`, 112 LOC). Sin hallazgo nuevo.
- **`shiftHandoverService.ts`** — engine puro de turno con invariantes sólidas
  (`SHIFT_ENDED`, `ENTRY_TOO_SHORT`, `NOTE_TOO_SHORT`, `ALREADY_ACKNOWLEDGED`,
  `SAME_SUPERVISOR`, `SHIFT_NOT_ENDED`). Inmutable (spread copies). Cumple §9.
  Testeado (`shiftHandoverService.test.ts`, 240 LOC). Única observación → ya
  cubierta en hallazgo §3 (las invariantes no se proyectan a la regla Firestore)
  y §6 (id de entrada no validado).

---

## Resumen (6-10 líneas)

Slice [55:60] = los 5 servicios del subdominio Cambio de Turno. Tres engines
puros (`shiftHandoverService`, `shiftHandoverInsights`, adapter) están limpios
y testeados; la orfandad del adapter y el doble-path ya constaban en
`DEEP-B13-MOC`, no se repiten. **Hallazgos NUEVOS:** 🔴 `shiftBackend.ts:66`
hace `JSON.parse(response.text)` sin try/catch → viola §5 (patrón sistémico en
los demás `*Backend.ts`, candidato a codemod). 🟡 `analyzeShiftFatiguePatterns`
(`:69-86`) devuelve texto libre sin esquema y pide nominar "trabajadores con
alto riesgo de accidente por fatiga", rozando ADR-0012/§10 — y
`shiftBackend.ts` **no** está en el scope del medical-guard. 🟡 El handover ya
acusado es mutable: `patchShift`→`updateDoc` + regla `firestore.rules:475`
permisiva sin post-sign update-deny (§4) → un miembro puede reescribir un acuse
firmado. 🔵 import muerto `firebase-admin` (`:2`), args `any[]` en frontera
Gemini whitelisted (`:6,69`), e id de turno con `Math.random` en el consumer
`ShiftHandover.tsx:137` (fuera de slice, contexto §15). Sin secretos, sin
`void` de audit en estos archivos (el store cliente sencillamente no audita —
gap ya registrado).
