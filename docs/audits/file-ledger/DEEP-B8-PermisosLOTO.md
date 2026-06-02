# DEEP — B8 Permisos de trabajo & LOTO · 2026-06-02

**Archivos revisados:** 81 (ledger `block=="B8-PermisosLOTO"`) + cross-refs
(`server.ts`, `firestore.rules`, `src/server/routes/maintenance.ts`,
`src/services/firestore/createProjectScopedStore.ts`,
`src/services/stoppage/stoppageStore.ts`). Lectura a fondo de los 6 dominios:
workPermits, loto, softBlocking, exceptions, engineeringControls, stoppage.

Sub-dominios (🛟):

| Dominio | Route | Service | Hook | Page/Component | Estado global |
|---|---|---|---|---|---|
| Work Permits | ✅ CRUD+audit | ✅ engine+validators | ✅ | ✅ page | ✅ |
| Engineering Controls | ✅ CRUD+audit+txn | ✅ inventory | ✅ | ✅ page | ✅ |
| Stoppage (paralización) | 🟡 compute-only | ✅ engine | ✅ | ✅ page | 🟡 |
| Soft-blocking | 🟡 compute-only | ✅ gate | ✅ | ✅ page | 🟡 |
| Exceptions | 🟡 compute-only | ✅ engine+adapter | ✅ | ✅ page | 🟡 |
| **LOTO** | 🔴 GET-only | ✅ engine (write dead) | 🔴 read-only | 🏚️ panel huérfano | 🔴 |

---

## 1. Lo que YA HACE (implementado y real)

### Work Permits (DS 132 / DS 594) — el dominio más completo
- 4 endpoints reales bajo `/api/sprint-k/:projectId/work-permits*`
  (`src/server/routes/workPermits.ts:173,278,360,408,485`), montados en
  `server.ts:1013`.
- **Persistencia server-side real** vía `WorkPermitAdapter`
  (`workPermitFirestoreAdapter.ts:73`) en
  `tenants/{tid}/projects/{pid}/work_permits/{id}` — colección **sin reglas
  cliente en `firestore.rules` ⇒ default-deny ⇒ escritura sólo Admin SDK**.
  Patrón correcto server-only.
- **Audit-log invariant cumplido**: `await auditServerEvent` en create/sign/close
  (`workPermits.ts:323,457,525`). Cumple CLAUDE.md #3 y #14 (awaited).
- **Identidad nunca del body** (CLAUDE.md #6/Codex P1): `approverUid=callerUid`
  (`:304`), `workerUid` por defecto al caller (`:295`); rol vía
  `resolveCallerRoleContext` (`:151`) y gate `canIssuePermits` con
  `PERMIT_ISSUER_ROLES` (`:139`, 403 en `:289/371/420`).
- **Anti-forja del checklist** (Codex P1 #1): create re-siembra el checklist
  canónico siempre con `checked:false` (`createPendingPermit`
  `workPermitEngine.ts:174,193`); la atestación ocurre en `/sign`
  (`attestAndIssuePermit` `:244`), que exige training+EPP+fitness+checklist
  completo o lanza `WorkPermitValidationError`.
- **`create` no sobreescribe** permisos terminales: `adapter.create` rechaza id
  duplicado → 409 (`workPermitFirestoreAdapter.ts:87`; route `:330`).
- **Permisos expirados no se cierran** (Codex P1): `deriveStatus` → 422
  `permit_already_expired` / `permit_already_terminal`
  (`workPermits.ts:506,512`).
- **Validadores críticos profundos cableados** (2026-05-29): endpoint
  `POST .../validate-critical` (`workPermits.ts:360`) expone
  `validateCriticalPermit` (`criticalPermitValidators.ts:470`) para
  izaje/excavación/LOTO con tablas reales (ratio carga/capacidad 0.85/1.0,
  viento 11/15 m/s ISO 12480-1, talud por suelo NCh 349, O₂ 19.5–23.5%,
  LEL ≥10%, NFPA 70E try-out). **Advisory-only** por diseño (no bloquea).
- **Auto-expire cron real**: `runWorkPermitAutoExpire`
  (`runWorkPermitAutoExpire.ts:31`) invocado por `maintenance.ts:578` con path
  **tenant-scoped correcto** `tenants/{tid}/projects/{pid}/work_permits`
  (`maintenance.ts:580`; guard de tenantId vacío `:570-575`).
- UI: `WorkPermits.tsx` lee vía `useWorkPermits` y muta vía
  `createWorkPermit`/`signWorkPermit`/`closeWorkPermit`
  (`useWorkPermits.ts:19,59,80,105`).

### Engineering Controls (§42-44, jerarquía ISO 31000/45001)
- 3 endpoints reales (`engineeringControls.ts:139,231,310`), montados
  `server.ts:1019`.
- **Único dominio (junto a workPermits) con escritura server real + audit +
  transacción**: create usa `db.runTransaction` con detección de duplicado
  (`:265-271`, 409) — cumple CLAUDE.md #19. `await auditServerEvent` en
  create/verify (`:288,351`).
- `verifierUid=callerUid` nunca del body (`:336`); `lastVerifiedAt` sólo avanza
  en `pass` (`:347`). `partial_read_failure` warning gracioso (`:148-160`).
- Path server-only `tenants/{tid}/projects/{pid}/engineering_controls` (sin
  regla cliente → default-deny).

### Stoppage / Paralización (DS — declarar→reanudar)
- Engine real con state-machine: `declareStoppage`→`markPreconditionFulfilled`→
  (`pending_resumption` cuando todas fulfilled `stoppageEngine.ts:165`)→`resume`
  (exige `pending_resumption` + rol aprobador `:179,185`) / `cancelStoppage`.
- 5 endpoints (`stoppage.ts:134,170,206,237,267`), `declaredByUid=callerUid`
  (`:147`), verifier/resumer/canceller también del caller.
- Regla Firestore con anti-spoof correcto: `stoppages` exige
  `declaredByUid==request.auth.uid`, update preserva declarer, `delete:if false`
  (`firestore.rules:388-395`).
- Persistencia **offline-first cliente** vía `stoppageStore`
  (`createProjectScopedStore<Stoppage>('stoppages')`, `setDoc`+`onSnapshot`,
  `stoppageStore.ts:18`). `StoppageMonitor.tsx:165` llama `saveStoppage`.

### Soft-blocking (F.17 — "nunca bloqueo duro", directiva #2)
- Engine puro determinístico (`requirementGate.ts:118`): `evaluateGate` →
  `pass`/`soft_block`/`cannot_override`; `critical_control_verification` es el
  único kind no-overrideable (`:109`). Override exige reason ≥20, uid, fecha
  (`validateOverride:166`) y produce entry con `contentHash` SHA-256
  (`buildOverrideAuditEntry:203`, hash inyectado por route `softBlocking.ts:67`).
- 4 endpoints **compute-only** (`softBlocking.ts:135,170,207,256`),
  `authorizingUid`/`actorUid` forzados al caller (`:182,225`).

### Exceptions (G.2 — registrar desviaciones controladas)
- Engine puro: `createException` (reason/mitigation ≥20, dur ≤168h, rol válido
  `exceptionEngine.ts:102`), `revoke`/`markFulfilled`/`deriveStatus`/`summarize`.
- 6 endpoints **compute-only** (`exceptions.ts:116,157,188,225,262,283`),
  `approvedByUid`/`revokedByUid` forzados al caller (`:127,199`).
- Auto-expire cron real (`runExceptionAutoExpire.ts:34`) vía `maintenance.ts:545`
  (path cliente `projects/{pid}/exceptions`).
- UI offline-first vía `exceptionStore` (`createProjectScopedStore`,
  `exceptionStore.ts:15`); `ExceptionsAudit.tsx:145` llama `saveException`.

### LOTO — lógica de dominio sí existe (aunque no cableada para escritura)
- `lotoDigitalLight.ts`: `validateLotoApplication` (todas las energías con
  candado + try-out cero-energía → `authorizesWork` `:105`),
  `validateRelease` (sólo líder/autorizado libera `:132`), `applyFullRelease`
  (`:156`). `criticalPermitValidators.validateLoto` (`:386`) replica la lógica
  para el endpoint advisory de work-permits.

---

## 2. Lo que está PENDIENTE (deuda de este bloque)

1. **🔴 LOTO no tiene escritura — "previene energización" es sólo teoría.**
   El router LOTO expone **únicamente `GET`** (`loto.ts:55`); no hay
   `POST` para crear aplicación, aplicar lock point, verificar cero-energía
   ni liberar. `LotoAdapter.save`/`appendAudit` (`lotoFirestoreAdapter.ts:46,55`)
   y `applyFullRelease`/`validateRelease` (`lotoDigitalLight.ts:156,132`) son
   **código muerto** — `grep` confirma cero callers fuera de su propio archivo.
   La colección `loto_applications` **no tiene reglas en `firestore.rules`**
   (default-deny) y **ningún path de escritura existe** ⇒ no se pueden crear
   aplicaciones LOTO por ninguna vía. El sistema LOTO es read-only de punta a
   punta sobre datos que nada escribe.

2. **🏚️ `LotoStatusPanel.tsx` es un componente huérfano.** Renderiza botones
   "Aplicar lock point" / "Liberar todo" (`LotoStatusPanel.tsx:128,138`,
   `data-testid="loto-release"`) vía props `onApplyLockPoint`/`onRelease`, pero
   **ningún componente/página lo importa** (`grep` solo lo encuentra en su
   propio archivo y su test). No hay página LOTO. UI de escritura inexistente.

3. **🟡 Stoppage / Soft-blocking / Exceptions: routes compute-only sin audit
   server-side.** Calculan y devuelven objetos pero **no persisten ni escriben
   `audit_logs`**. La persistencia depende del cliente (`createProjectScopedStore`
   → IndexedDB/Firestore SDK) gobernada por `firestore.rules`. La invariante de
   CLAUDE.md #3 (toda operación que cambia estado escribe `audit_logs` con
   identidad sellada server-side) **no aplica** porque la escritura nunca pasa
   por el servidor para estos 3 dominios. Para `stoppages` la regla de cliente
   sí ancla `declaredByUid` (mitigación parcial); para `exceptions` **no** (ver
   #4).

4. **⚠️ Regla Firestore laxa de `exceptions` (firestore.rules:466).** Confirmado:
   `allow create, update: if isValidId(projectId) && isProjectMember(projectId)`
   — **sin** comprobación anti-spoof `incoming().approvedByUid==request.auth.uid`
   (a diferencia de `stoppages:389`, `safety_talks_given`, `audit_portals`,
   `documents_for_read` que sí la tienen). El propio comentario lo reconoce
   (`firestore.rules:463 TODO(review dahosandoval@)`). Aunque el endpoint
   `exceptions/create` fuerza `approvedByUid=caller` (`exceptions.ts:127`), la
   **escritura real la hace el cliente** vía `exceptionStore.saveException`
   (path `projects/{pid}/exceptions`), que **no pasa por ese endpoint** —
   cualquier miembro puede escribir un `ExceptionRecord` con
   `approvedByUid`/`approvedByRole` arbitrarios y forjar quién autorizó la
   excepción. Misma laxitud en `legal_obligations:470` y `shifts:474`.

5. **🟡 Doble path/modelo de persistencia para exceptions.** El
   `ExceptionAdapter` (`exceptionFirestoreAdapter.ts:40`) usa
   `tenants/{tid}/projects/{pid}/exceptions` (server-side, sin callers de
   escritura), mientras `exceptionStore` (cliente, `:15`) y el cron
   (`maintenance.ts:547`) usan `projects/{pid}/exceptions`. El adapter
   server-side está implementado, testeado y **no se usa**. Riesgo de drift /
   confusión sobre cuál es la fuente de verdad.

6. **🟡 Compatibilidad legacy en crons.** `runWorkPermitAutoExpire` /
   `runExceptionAutoExpire` tienen `collectionPath` default a la global legacy
   `work_permits`/`exceptions` (`runWorkPermitAutoExpire.ts:44`,
   `runExceptionAutoExpire.ts:47`); el caller real ya pasa el path correcto,
   pero el default queda como trampa si se invoca sin path.

---

## 3. Tabla por archivo (TODOS)

| Archivo | LOC | Estado | Cableado | Propósito + hallazgo file:line |
|---|---|---|---|---|
| src/server/routes/workPermits.ts | 547 | ✅ | server.ts:1013 | CRUD permisos DS132+594, audit+identity-server. validate-critical advisory `:360` |
| src/server/routes/workPermits.test.ts | — | ✅ | — | 401/200/400/403/409/422 cubiertos |
| src/server/routes/loto.ts | 79 | 🔴 | server.ts:1035 | **Sólo GET** `:55`; sin escritura/release. "Previene energización" no cableado |
| src/server/routes/loto.test.ts | — | 🟡 | — | Cubre sólo el GET (no hay write que cubrir) |
| src/server/routes/softBlocking.ts | 277 | 🟡 | server.ts:1150 | 4 endpoints compute-only `:135,170,207,256`; sin persistencia/audit |
| src/server/routes/softBlocking.test.ts | — | ✅ | — | Override + cannot_override cubiertos |
| src/server/routes/exceptions.ts | 304 | 🟡 | server.ts:1134 | 6 endpoints compute-only; approvedByUid=caller `:127` (pero escritura real es cliente) |
| src/server/routes/exceptions.test.ts | — | ✅ | — | create/revoke/fulfilled |
| src/server/routes/engineeringControls.ts | 365 | ✅ | server.ts:1019 | CRUD+verify, txn `:265`, audit `:288,351`, verifierUid server `:336` |
| src/server/routes/engineeringControls.test.ts | — | ✅ | — | dup-409, verify pass/fail |
| src/server/routes/stoppage.ts | 287 | 🟡 | server.ts:1045 | 5 endpoints compute-only; declaredByUid=caller `:147`; sin persistencia/audit server |
| src/server/routes/stoppage.test.ts | — | ✅ | — | declare/resume/cancel |
| src/server/jobs/runWorkPermitAutoExpire.ts | 94 | ✅ | maintenance.ts:578 | Cron expira active+validUntil< now; default legacy path `:44` |
| src/server/jobs/runWorkPermitAutoExpire.test.ts | — | ✅ | — | scan/expire/error |
| src/server/jobs/runExceptionAutoExpire.ts | 97 | ✅ | maintenance.ts:545 | Cron materializa expired; path cliente `:47` |
| src/server/jobs/runExceptionAutoExpire.test.ts | — | ✅ | — | scan/expire/error |
| src/services/workPermits/workPermitEngine.ts | 440 | ✅ | route | createPending/attest/issue/cancel/fulfill; checklist canónico `:116`; deriveStatus `:374` |
| src/services/workPermits/workPermitEngine.test.ts | — | ✅ | — | pure |
| src/services/workPermits/criticalPermitValidators.ts | 481 | ✅ | workPermits.ts:360 | izaje/excavación/LOTO con tablas DS132/ISO12480/NCh349/NFPA70E `:106,251,386` |
| src/services/workPermits/criticalPermitValidators.test.ts | — | ✅ | — | pure |
| src/services/workPermits/excavationPermitExtension.ts | 218 | 🔵 | — | Extensión excavación; verificar callers (no en route principal) |
| src/services/workPermits/excavationPermitExtension.test.ts | — | ✅ | — | pure |
| src/services/workPermits/liftingPermitExtension.ts | 164 | 🔵 | — | Extensión izaje; verificar callers |
| src/services/workPermits/liftingPermitExtension.test.ts | — | ✅ | — | pure |
| src/services/workPermits/permitLifecycleAdvisor.ts | 193 | 🔵 | — | Advisor ciclo de vida; verificar consumo en UI/route |
| src/services/workPermits/permitLifecycleAdvisor.test.ts | — | ✅ | — | pure |
| src/services/workPermits/workPermitFirestoreAdapter.ts | 246 | ✅ | route | create anti-overwrite `:87`; updateStatus inmutables `:105`; path tenant-scoped `:49` |
| src/services/workPermits/workPermitFirestoreAdapter.test.ts | — | ✅ | — | dup/list |
| src/services/loto/lotoDigitalLight.ts | 170 | 🟡 | parcial | validate `:78` usado en panel huérfano; applyFullRelease `:156`/validateRelease `:132` **muertos** |
| src/services/loto/lotoDigitalLight.test.ts | — | ✅ | — | pure |
| src/services/loto/lotoFirestoreAdapter.ts | 86 | 🏚️ | sólo listActive/listForEquipment desde loto.ts | save/appendAudit `:46,55` **sin callers** |
| src/services/loto/lotoFirestoreAdapter.test.ts | — | ✅ | — | adapter |
| src/services/softBlocking/requirementGate.ts | 249 | ✅ | route | evaluateGate `:118`; cannot_override `:109`; audit entry hash `:203` |
| src/services/softBlocking/requirementGate.test.ts | — | ✅ | — | pure |
| src/services/exceptions/exceptionEngine.ts | 243 | ✅ | route+store | create/revoke/fulfilled/summarize; guards reason≥20/dur≤168h `:105,117` |
| src/services/exceptions/exceptionEngine.test.ts | — | ✅ | — | pure |
| src/services/exceptions/exceptionFirestoreAdapter.ts | 131 | 🏚️ | — | Adapter tenant-scoped `:40` **sin callers de escritura** (store cliente usa otro path) |
| src/services/exceptions/exceptionFirestoreAdapter.test.ts | — | ✅ | — | adapter |
| src/services/exceptions/exceptionStore.ts | 37 | ✅ | ExceptionsAudit.tsx:145 | Store cliente offline-first `projects/{pid}/exceptions` `:15` |
| src/services/engineeringControls/engineeringControlsInventory.ts | 272 | 🔵 | verificar | Inventario+jerarquía; route usa shape propio, confirmar consumo |
| src/services/engineeringControls/engineeringControlsInventory.test.ts | — | ✅ | — | pure |
| src/services/stoppage/stoppageEngine.ts | 269 | ✅ | route+store | state-machine declare→resume; allFulfilled `:165`; rol resumer `:185` |
| src/services/stoppage/stoppageEngine.test.ts | — | ✅ | — | pure |
| src/services/stoppage/stoppageFirestoreAdapter.ts | 68 | 🔵 | verificar | Adapter; store cliente usa createProjectScopedStore en su lugar |
| src/services/stoppage/stoppageFirestoreAdapter.test.ts | — | ✅ | — | adapter |
| src/services/stoppage/stoppageStore.ts | 81 | ✅ | StoppageMonitor.tsx:165 | Store cliente offline-first `projects/{pid}/stoppages` `:18` |
| src/hooks/useWorkPermits.ts | 129 | ✅ | WorkPermits.tsx | GET + create/sign/close (fetch online, no offline-queue) `:19,59,80,105` |
| src/hooks/useLoto.ts | 91 | 🔴 | — | **Read-only**; sin mutadores. GET `:79` |
| src/hooks/useSoftBlocking.ts | 123 | ✅ | SoftBlocks.tsx | fetch endpoints compute |
| src/hooks/useExceptions.ts | 165 | ✅ | ExceptionsAudit.tsx | fetch compute |
| src/hooks/useEngineeringControls.ts | 139 | ✅ | EngineeringControls.tsx | GET + create/verify `:67,86,120` |
| src/hooks/useStoppage.ts | 140 | ✅ | StoppageMonitor.tsx | fetch compute |
| src/pages/WorkPermits.tsx | 469 | ✅ | route | Lista+crea+firma permisos `:76,120` |
| src/pages/WorkPermits.test.tsx | — | ✅ | — | jsdom |
| src/pages/EngineeringControls.tsx | 919 | ✅ | route | Inventario+verify |
| src/pages/EngineeringControls.test.tsx | — | ✅ | — | jsdom |
| src/pages/SoftBlocks.tsx | 327 | ✅ | route | evaluateGate cliente `:70` |
| src/pages/SoftBlocks.test.tsx | — | ✅ | — | jsdom |
| src/pages/ExceptionsAudit.tsx | 433 | ✅ | route | saveException `:145` |
| src/pages/StoppageMonitor.tsx | 461 | ✅ | route | saveStoppage `:165` |
| src/components/workPermits/WorkPermitCard.tsx | 186 | ✅ | WorkPermits | render permiso |
| src/components/workPermits/WorkPermitCard.test.tsx | — | ✅ | — | — |
| src/components/workPermits/PermitChecklistRenderer.tsx | 98 | ✅ | WorkPermits | checklist |
| src/components/workPermits/PermitChecklistRenderer.test.tsx | — | ✅ | — | — |
| src/components/loto/LotoStatusPanel.tsx | 152 | 🏚️ | **NINGUNO** | Panel + botones release/add-point `:128,138` huérfanos (sin importador) |
| src/components/loto/LotoStatusPanel.test.tsx | — | 🟡 | — | Testea componente que nada renderiza |
| src/components/softBlocking/RequirementGatePanel.tsx | 97 | ✅ | SoftBlocks | render gate |
| src/components/softBlocking/RequirementGatePanel.test.tsx | — | ✅ | — | — |
| src/components/exceptions/ExceptionsAuditPanel.tsx | 173 | ✅ | ExceptionsAudit | panel |
| src/components/exceptions/ExceptionsAuditPanel.test.tsx | — | ✅ | — | — |
| src/components/engineeringControls/EngineeringInventoryCard.tsx | 142 | ✅ | EngineeringControls | card |
| src/components/engineeringControls/EngineeringInventoryCard.test.tsx | — | ✅ | — | — |
| src/components/stoppage/StoppageBanner.tsx | 194 | ✅ | StoppageMonitor | banner |
| src/components/stoppage/StoppageResumeModal.tsx | 369 | ✅ | StoppageMonitor | modal reanudación |
| src/components/stoppage/StoppageSummaryCard.tsx | 104 | ✅ | StoppageMonitor | resumen |
| src/components/stoppage/StoppageSummaryCard.test.tsx | — | ✅ | — | — |
| src/__tests__/server/workPermits.router.test.ts | — | ✅ | — | router supertest |
| src/__tests__/server/workPermits.criticalValidate.test.ts | — | ✅ | — | validate-critical |
| src/__tests__/server/engineeringControls.test.ts | — | ✅ | — | router |
| src/__tests__/server/exceptions.router.test.ts | — | ✅ | — | router |
| src/__tests__/server/softBlocking.test.ts | — | ✅ | — | router |
| src/__tests__/server/stoppage.router.test.ts | — | ✅ | — | router |

(Estados: ✅ real+cableado · 🟡 parcial/compute-only · 🏚️ implementado pero
huérfano/muerto · 🔵 implementado, cableado a verificar · 🔑 secreto/cripto ·
🔴 ausente/roto. `criticalControls` pertenece a B2-RiesgoIPER, no a B8.)

---

## 4. Para decisión del usuario (❓/⚠️)

- **⚠️ LOTO es read-only — riesgo de seguridad/compliance grave.** El módulo que
  "previene energización" (DS 132) no puede registrar ni una sola aplicación
  LOTO: no hay `POST`, el adapter `save`/`appendAudit` y `applyFullRelease`/
  `validateRelease` son código muerto, y `LotoStatusPanel` (con botones de
  liberar/aplicar candado) **no lo renderiza nadie**. ¿Decisión: (a) construir
  los endpoints de escritura LOTO + página + audit, o (b) marcar LOTO como
  no-disponible (feature flag/503 + `docs/stubs-inventory.md`) para no exponer
  un read-only sobre datos vacíos? Hoy viola el espíritu de CLAUDE.md #13
  (anti-stub-disfrazado): UI de escritura visible sin backend.

- **⚠️ `firestore.rules:466` (exceptions) — anti-spoof faltante, confirmado.**
  La escritura real de excepciones la hace el cliente (`exceptionStore`), no el
  endpoint server. Sin `incoming().approvedByUid==request.auth.uid` un miembro
  puede forjar quién autorizó una excepción a un control de seguridad. Misma
  laxitud en `legal_obligations:470` y `shifts:474`. ¿Añadir el guard de
  creator-uid (y un test rules owner-allow/spoof-deny) o confirmar que el campo
  no existe en el esquema? El `TODO(review dahosandoval@)` en `:463` lleva
  pendiente. Requiere además entrada Dirty-Dozen en `security_spec.md`.

- **❓ stoppage/soft-blocking/exceptions: ¿el audit-log debe ser server-side?**
  Hoy estas 3 operaciones que cambian estado se persisten desde el cliente y
  **no escriben `audit_logs`** con identidad sellada por el servidor (CLAUDE.md
  #3). ¿Aceptable por diseño offline-first, o se requiere un endpoint de
  escritura server-side con audit para paralizaciones/excepciones (eventos de
  alto valor legal)?

- **❓ Adapters server-side huérfanos.** `exceptionFirestoreAdapter` (tenant-
  scoped) y `stoppageFirestoreAdapter` están implementados+testeados pero sin
  callers de escritura (el flujo real usa stores cliente con otro path). ¿Borrar,
  o eran el plan de migración a escritura server? Decidir antes de que el drift
  crezca.

- **🔵 Verificar consumo real** de `excavationPermitExtension`,
  `liftingPermitExtension`, `permitLifecycleAdvisor` y
  `engineeringControlsInventory`: implementados y testeados como puros, pero su
  cableado a route/UI no quedó confirmado en esta pasada.
