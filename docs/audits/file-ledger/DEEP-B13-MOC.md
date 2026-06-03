# DEEP — B13 Gestión del cambio (MOC) & Operaciones críticas · 2026-06-02

**Archivos revisados:** 58 (ledger `block=="B13-MOC"`), más verificación cruzada de
`server.ts`, `firestore.rules`, `src/routes/*`, `sidebarMenuGroups.ts`,
`moduleGroups.ts`, `createProjectScopedStore.ts`.

---

## 1. Lo que YA HACE (implementado y real)

### MOC persistente + auditado (camino server) — ✅
- `src/server/routes/operationalChange.ts` (395 LOC) — superficie **adapter-backed**
  montada en `/api/sprint-k/:projectId/moc/*` (`server.ts:171,1026`). Persiste vía
  `OperationalChangeAdapter` en `tenants/{tid}/projects/{pid}/operational_changes`:
  - `declare` persiste + `auditServerEvent('moc.declare')` (`operationalChange.ts:146-152`).
  - `acknowledge` fuerza `workerUid=caller`, idempotente, audita (`:241-248`).
  - `close` **guardrail 100 % ack** (HTTP 409 `ACK_COVERAGE_INCOMPLETE`) +
    `auditServerEvent('moc.close')` (`:348-376`).
  - Todos con `verifyAuth` + `assertProjectMember` (`guard()` `:83-103`) +
    `idempotencyKey()` + identidad server-side. Cumple invariantes CLAUDE.md §3/§6.
- `src/services/changeMgmt/operationalChangeService.ts` (552 LOC) — engine puro
  (declareChange / acknowledgeChange / revertChange / summarizeAcknowledgments,
  `APPROVER_ROLES`, `ChangeValidationError`). Cubierto por
  `operationalChangeService.test.ts` (143) + `operationalChangeWorkflow.test.ts` (427).
- `operationalChangeFirestoreAdapter.ts` (63) — save/getById/addAcknowledgment/listRecent.

### Commute (accidente de trayecto) — ✅
- `src/server/routes/commute.ts` (262 LOC) montado en `/api/commute` (`server.ts:933`).
  Persiste `tenants/{tid}/commute_sessions/{id}`, audita (`commute.ts:106,243`),
  `commuteLimiter` (30/15 min), tenantId resuelto del proyecto (no del body). Modelo
  de referencia: cliente escribe local + replay pasa por el server. Engine
  `commuteSession.ts` (298). Consumido por `useManDownDetection.ts` (man-down ⇄ trayecto).

### Cobertura de tests — ✅
- 4 suites supertest grandes: `operationalChange.test.ts` (887),
  `shiftHandover.test.ts` (704), `commute.test.ts` (712), `changeMgmt.test.ts` (621)
  (en `src/__tests__/server/`); más smoke routes `*.test.ts` (31-65 LOC) y engines.

### Engines puros stateless (continuity / criticalRoles / shiftHandover) — ✅ (compute)
- `continuityPlanning.ts` (224): detectSPOFs / simulateOutage / buildPolyvalencePlan.
- `criticalRolesMap.ts` (235): bus-factor para grúa/rigger/electricista SEC/etc.
- `shiftHandoverService.ts` (216) + `shiftHandoverInsights.ts` (147): start/log/note/
  end/acknowledge/summarize. Determinísticos, bien testeados.

### ISO 45001 §8.1.3 — cobertura conceptual
- El dominio MOC (declarar cambio, impacto, afectados, ack, cierre con cobertura)
  mapea §8.1.3 "gestión del cambio". El sidebar lo etiqueta explícitamente
  (`sidebarMenuGroups.ts:190` "MOC ISO 45001 §8.1.3").

### Wiring de UI base — ✅
- `/operational-changes` → `OperationalChanges.tsx` (`ComplianceRoutes.tsx:28,49`,
  sidebar `:193`, dashboard `:239`).
- `/shift-handover` → `ShiftHandover.tsx` (`OperationsRoutes.tsx:37,60`, sidebar `:144`,
  dashboard `:75`).

---

## 2. Lo que está PENDIENTE (deuda de este bloque)

### 🔴 A. La UI viva NO usa el camino auditado — invariante audit-log rota
- `OperationalChanges.tsx` escribe **client-side** vía `operationalChangeStore.ts`
  (`createProjectScopedStore('operational_changes')`) a
  `projects/{projectId}/operational_changes` con `setDoc/updateDoc` directo
  (`OperationalChanges.tsx:169,192,238,267,285`). **No pasa por `operationalChange.ts`
  ni escribe `audit_logs`.** El factory `createProjectScopedStore.ts` no emite
  `auditServerEvent` (sólo escritura Firestore). Resultado: declare/ack/close en
  producción **no dejan rastro en `audit_logs`** → viola CLAUDE.md §3.
- `ShiftHandover.tsx` igual: `shiftHandoverStore.ts` escribe `projects/{projectId}/shifts`
  (`ShiftHandover.tsx:142,160,180,195,209`). Sin audit.

### 🔴 B. shiftHandover.ts es pure-compute — **gap PR #606 NO cerrado**
- `src/server/routes/shiftHandover.ts:30` — "Pure compute — no Firestore writes.
  Persistencia la decide el caller." Los 6 endpoints (start/log-entry/add-note/end/
  acknowledge/summarize) reciben el `ShiftRecord` completo en el body, lo recomputan
  y lo devuelven **sin persistir ni auditar**. No hay `auditServerEvent` en todo el
  archivo. El handover entre turnos (relevo legal) no tiene rastro server-side.

### 🟡 C. Doble path de persistencia + mismatch de schema-path (shift)
- Existe `ShiftHandoverAdapter` (`shiftHandoverFirestoreAdapter.ts:14`) que persiste a
  `tenants/{tid}/projects/{pid}/shifts` — pero está **huérfano** (cero referencias no-test).
  La UI viva escribe a `projects/{projectId}/shifts` (sin `tenants/`). Dos rutas de
  almacenamiento divergentes para el mismo concepto; el adapter del server nunca se
  invoca. Igual para MOC: adapter usa `tenants/.../operational_changes`, la UI usa
  `projects/.../operational_changes`.

### 🟡 D. Componentes/hooks huérfanos (construidos, no renderizados)
Sin referencias fuera de sí mismos / sus tests:
- `MOCStatusPanel.tsx` (277), `AcknowledgmentBanner.tsx` (232),
  `ChangeDeclarationForm.tsx` (451) — los tres importan el hook auditado
  `useOperationalChange.ts` (declareMoc/acknowledgeMoc/closeMoc/useMocList, 237 LOC)
  → el único bridge correcto al server, **pero nadie los monta**.
- `ShiftHandoverPanel.tsx` (611) y `ShiftHandoverHistoryList.tsx` (281) importan
  `useShiftHandover.ts` (242) → ambos huérfanos; la página usa sólo `ShiftQualityCard`.
- `useChangeMgmt.ts` (138) — huérfano (pure-compute, ninguna página lo usa).

### 🔵 E. Continuity / Critical Roles — engines server listos, UI 100 % huérfana
- `SpofPanel.tsx` (115) — **huérfano confirmado** (cero refs). `useContinuity.ts` (101)
  huérfano. `continuity.ts` (195, montado `server.ts:1097`) sólo accesible por API.
- `CriticalRoleCoverageCard.tsx` (111) huérfano; `useCriticalRoles.ts` (117) huérfano;
  `criticalRoles.ts` (208, montado `server.ts:1114`) sin consumidor UI. No hay página
  de continuidad/roles críticos en `src/routes/*`.

### 🟡 F. changeMgmt.ts (camino legacy pure-compute) redundante
- `changeMgmt.ts` (248, `/api/sprint-k/:projectId/change-mgmt/*`, montado `server.ts:1116`)
  es la versión vieja sin persistencia (`:11` "no Firestore writes"). Superada por
  `operationalChange.ts`. Coexisten ambas; candidata a deprecación/consolidación.

---

## 3. Tabla por archivo (TODOS)

| Archivo | LOC | Estado | Cableado | Propósito + hallazgo file:line |
|---|---|---|---|---|
| src/server/routes/operationalChange.ts | 395 | ✅ | server.ts:171,1026 | MOC persistente+auditado; guardrail 100% ack `:348-376`. Camino correcto pero la UI no lo usa. |
| src/server/routes/shiftHandover.ts | 319 | 🔴 | server.ts:172,1027 | Pure-compute, sin persist ni audit `:30`. Gap PR #606 abierto. |
| src/server/routes/commute.ts | 262 | ✅ | server.ts:107,933 | Persist+audit+rate-limit; tenantId del proyecto `:106,243`. |
| src/server/routes/continuity.ts | 195 | 🔵 | server.ts:299,1097 | detect-spofs/simulate/polyvalence; sin consumidor UI. |
| src/server/routes/criticalRoles.ts | 208 | 🔵 | server.ts:332,1114 | bus-factor roles críticos; sin consumidor UI. |
| src/server/routes/changeMgmt.ts | 248 | 🟡 | server.ts:336,1116 | MOC legacy pure-compute `:11`; redundante vs operationalChange.ts. |
| src/services/changeMgmt/operationalChangeService.ts | 552 | ✅ | route+page | Engine MOC puro; APPROVER_ROLES, validaciones. |
| src/services/changeMgmt/operationalChangeFirestoreAdapter.ts | 63 | ✅ | operationalChange.ts:56 | save/ack/listRecent en tenants/.../operational_changes. |
| src/services/changeMgmt/operationalChangeStore.ts | 28 | 🟡 | OperationalChanges.tsx:43 | Store client-side a projects/.../operational_changes; SIN audit. |
| src/services/shiftHandover/shiftHandoverService.ts | 216 | ✅ | route+page | Engine turno puro. |
| src/services/shiftHandover/shiftHandoverFirestoreAdapter.ts | 49 | 🏚️ | (ninguno) | Adapter a tenants/.../shifts; HUÉRFANO, path divergente del store. |
| src/services/shiftHandover/shiftHandoverInsights.ts | 147 | ✅ | service | Cálculo calidad/insights del turno. |
| src/services/shiftHandover/shiftHandoverStore.ts | 32 | 🟡 | ShiftHandover.tsx:42 | Store client-side a projects/.../shifts; SIN audit. |
| src/services/continuity/continuityPlanning.ts | 224 | ✅(compute) | continuity.ts | SPOF/outage/polyvalencia; determinístico. |
| src/services/criticalRoles/criticalRolesMap.ts | 235 | ✅(compute) | criticalRoles.ts | Mapa roles críticos + cobertura. |
| src/services/driving/commuteSession.ts | 298 | ✅ | useManDownDetection | Engine sesión de trayecto. |
| src/hooks/useOperationalChange.ts | 237 | 🟡 | (sólo comps huérfanos) | Bridge correcto a operationalChange.ts; consumido sólo por comps no montados. |
| src/hooks/useChangeMgmt.ts | 138 | 🏚️ | (ninguno) | Pure-compute MOC; huérfano. |
| src/hooks/useShiftHandover.ts | 242 | 🟡 | (comps huérfanos) | Bridge a shiftHandover.ts; consumido por panels no montados. |
| src/hooks/useContinuity.ts | 101 | 🏚️ | (ninguno) | Huérfano. |
| src/hooks/useCriticalRoles.ts | 117 | 🏚️ | (ninguno) | Huérfano. |
| src/pages/OperationalChanges.tsx | 551 | 🟡 | route+sidebar+dash | Live; persiste client-side SIN audit `:169,192,238`. |
| src/pages/ShiftHandover.tsx | 471 | 🟡 | route+sidebar+dash | Live; persiste client-side SIN audit `:142,160,180`. |
| src/components/changeMgmt/OperationalChangeCard.tsx | 105 | ✅ | OperationalChanges.tsx:25 | Card render; montada. |
| src/components/changeMgmt/ChangeWorkflowActions.tsx | 237 | ✅ | OperationalChanges.tsx:26 | Acciones flujo; montada. |
| src/components/changeMgmt/ReasonModal.tsx | 180 | ✅ | OperationalChanges.tsx:27 | Modal motivo; montada. |
| src/components/changeMgmt/MOCStatusPanel.tsx | 277 | 🏚️ | (ninguno) | Huérfano; usa useOperationalChange. |
| src/components/changeMgmt/AcknowledgmentBanner.tsx | 232 | 🏚️ | (ninguno) | Huérfano; usa acknowledgeMoc. |
| src/components/changeMgmt/ChangeDeclarationForm.tsx | 451 | 🏚️ | (ninguno) | Huérfano; usa declareMoc. |
| src/components/shiftHandover/ShiftQualityCard.tsx | 92 | ✅ | ShiftHandover.tsx:30 | Card calidad; montada. |
| src/components/shiftHandover/ShiftHandoverPanel.tsx | 611 | 🏚️ | (ninguno) | Huérfano; usa useShiftHandover. |
| src/components/shiftHandover/ShiftHandoverHistoryList.tsx | 281 | 🏚️ | (ninguno) | Huérfano. |
| src/components/continuity/SpofPanel.tsx | 115 | 🏚️ | (ninguno) | Huérfano (flag del prompt confirmado). |
| src/components/criticalRoles/CriticalRoleCoverageCard.tsx | 111 | 🏚️ | (ninguno) | Huérfano. |
| src/__tests__/server/operationalChange.test.ts | 887 | ✅ | supertest | Cobertura ruta MOC persistente. |
| src/__tests__/server/shiftHandover.test.ts | 704 | ✅ | supertest | Cobertura ruta turno (pure-compute). |
| src/__tests__/server/commute.test.ts | 712 | ✅ | supertest | Cobertura commute. |
| src/__tests__/server/changeMgmt.test.ts | 621 | ✅ | supertest | Cobertura MOC legacy. |
| src/services/changeMgmt/operationalChangeService.test.ts | 143 | ✅ | vitest | Engine MOC. |
| src/services/changeMgmt/operationalChangeWorkflow.test.ts | 427 | ✅ | vitest | Workflow MOC. |
| src/services/changeMgmt/operationalChangeFirestoreAdapter.test.ts | 81 | ✅ | vitest | Adapter MOC. |
| src/services/shiftHandover/shiftHandoverService.test.ts | 240 | ✅ | vitest | Engine turno. |
| src/services/shiftHandover/shiftHandoverInsights.test.ts | 112 | ✅ | vitest | Insights turno. |
| src/services/shiftHandover/shiftHandoverFirestoreAdapter.test.ts | 80 | ✅ | vitest | Adapter turno (testeado pese a huérfano). |
| src/services/continuity/continuityPlanning.test.ts | 109 | ✅ | vitest | Engine continuidad. |
| src/services/criticalRoles/criticalRolesMap.test.ts | 136 | ✅ | vitest | Engine roles críticos. |
| src/services/driving/commuteSession.test.ts | 111 | ✅ | vitest | Engine trayecto. |
| src/hooks/useShiftHandover.test.ts | 193 | ✅ | vitest | Hook turno. |
| src/components/changeMgmt/ChangeWorkflowActions.test.tsx | 329 | ✅ | vitest/jsdom | Comp montado. |
| src/components/changeMgmt/OperationalChangeCard.test.tsx | 62 | ✅ | vitest/jsdom | Comp montado. |
| src/components/shiftHandover/ShiftQualityCard.test.tsx | 49 | ✅ | vitest/jsdom | Comp montado. |
| src/components/continuity/SpofPanel.test.tsx | 61 | 🏚️ | vitest/jsdom | Testea comp huérfano. |
| src/components/criticalRoles/CriticalRoleCoverageCard.test.tsx | 73 | 🏚️ | vitest/jsdom | Testea comp huérfano. |
| src/server/routes/operationalChange.test.ts | 65 | ✅ | vitest | Smoke ruta. |
| src/server/routes/shiftHandover.test.ts | 31 | ✅ | vitest | Smoke ruta. |
| src/server/routes/continuity.test.ts | 32 | ✅ | vitest | Smoke ruta. |
| src/server/routes/criticalRoles.test.ts | 33 | ✅ | vitest | Smoke ruta. |
| src/server/routes/changeMgmt.test.ts | 33 | ✅ | vitest | Smoke ruta. |

Leyenda: ✅ ok · 🟡 deuda/parcial · 🏚️ huérfano · 🔵 backend listo, sin UI · 🔑 secreto/seguridad · 🔴 invariante rota.

---

## 4. Para decisión del usuario (❓/⚠️)

- ⚠️ **(A+B) Brecha de auditoría real en producción.** Las acciones MOC y de relevo de
  turno (declare/ack/close, start/end/ack) que ve el usuario NO escriben `audit_logs`
  porque la UI escribe directo a Firestore vía `createProjectScopedStore`, saltándose
  `operationalChange.ts`/`shiftHandover.ts`. Para un dominio de cumplimiento (ISO 45001
  §8.1.3, relevo legal de turno) esto rompe CLAUDE.md §3. Decisión: ¿re-cablear la UI a
  los hooks auditados (`useOperationalChange`, `useShiftHandover` + persistir en
  `shiftHandover.ts`), o emitir `auditServerEvent` desde el store/un trigger Firestore?
- ⚠️ **(B) Gap PR #606 sigue abierto.** `shiftHandover.ts` no persiste; el `ShiftHandoverAdapter`
  existe y está testeado pero huérfano. Decisión: ¿wirear el adapter en la ruta (como
  operationalChange.ts) y cerrar el gap, o aceptar persistencia client-side como diseño?
- ❓ **(C) Mismatch de path de almacenamiento.** Adapters server usan
  `tenants/{tid}/projects/{pid}/...`; stores UI usan `projects/{pid}/...`. Hay que
  decidir el path canónico (las reglas Firestore sólo cubren `projects/.../operational_changes`
  L395 y `projects/.../shifts` L474 — el path `tenants/...` de los adapters podría no
  tener reglas alineadas).
- ❓ **(D+E) ~2.500 LOC de UI huérfana** (MOCStatusPanel, AcknowledgmentBanner,
  ChangeDeclarationForm, ShiftHandoverPanel, ShiftHandoverHistoryList, SpofPanel,
  CriticalRoleCoverageCard + 4 hooks). ¿Montar (cierran A/B/E de paso) o borrar?
- ❓ **(F) changeMgmt.ts duplica operationalChange.ts.** ¿Deprecar el legacy pure-compute?
