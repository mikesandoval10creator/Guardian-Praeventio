# DEEP-EX-19 — Permisos de trabajo & LOTO (B8), pasada línea-por-línea · Lote #19

**Atestación: 54/54 archivos leídos completos** (ledger `category` empieza con
`FEAT` && `block=="B8-PermisosLOTO"`, ordenados por `path`, slice `[0:54]` = el
universo completo). Cross-refs leídos: `firestore.rules:380-477`, `server.ts`
(mounts `:1013,1019,1035,1045,1134,1150`), `src/pages/SoftBlocks.tsx`,
`src/pages/ExceptionsAudit.tsx`, `src/pages/EngineeringControls.tsx`,
`src/routes/{Risk,Emergency,Compliance}Routes.tsx`, `src/App.tsx`,
`src/server/routes/jsa.ts`.

Esta pasada NO repite los hallazgos de `DEEP-B8-PermisosLOTO.md` (LOTO read-only
sin POST, `LotoStatusPanel`/`useLoto` huérfanos, rutas compute-only sin audit
server, `firestore.rules:466` exceptions sin anti-spoof, adapters tenant-scoped
sin callers, defaults legacy en crons). Se documentan SÓLO hallazgos NUEVOS.

Leyenda: 🔴 grave · 🟡 medio · 🔵 menor/observación.

---

## 1. Hallazgos NUEVOS

### 🔴 N1 — Autorización por rol AUTO-DECLARADO por el cliente (privilege escalation)
En las rutas compute-only la identidad (`uid`) sí se sella server-side, pero el
**rol usado para la decisión de autorización viene del body del cliente**, no del
token verificado:

- `stoppage.ts:216` → `resume(body.stoppage, callerUid, body.resumedByRole)`; el
  engine valida `APPROVER_ROLES.includes(resumedByRole)` (`stoppageEngine.ts:185`)
  pero `resumedByRole` es client-supplied (schema `resumeSchema:203`). Un worker
  envía `resumedByRole: 'gerente'` y pasa el gate.
- `stoppage.ts:144-148` declare: idem con `declaredByRole`.
- `exceptions.ts:126-127` create: `approvedByUid=caller` (bien) pero
  `approvedByRole` es del body (`createSchema:109`) y el engine sólo verifica que
  el string esté en la lista (`exceptionEngine.ts:124`). Cualquier miembro
  "aprueba" una excepción auto-asignándose `approvedByRole:'gerente'`.

Contraste: `workPermits.ts` y `engineeringControls.ts` resuelven el rol desde el
token con `resolveCallerRoleContext(req.user!)` (`workPermits.ts:151,288`) — el
patrón correcto. Las 3 rutas compute-only quedan inconsistentes y débiles.

### 🔴 N2 — `firestore.rules:391` stoppages `update` no protege la transición de estado
La regla preserva `declaredByUid` pero **no valida** `resumedByUid`/`cancelledByUid`
ni rol ni precondiciones. Como la escritura real la hace el cliente vía
`stoppageStore.updateStoppageStatus` (`stoppageStore.ts:43`, path
`projects/{pid}/stoppages`) y NO la ruta server, **cualquier miembro del proyecto
puede `patch({status:'resumed', resumedByUid:<arbitrario>})` directamente**,
saltándose por completo el engine (`resume` exige `pending_resumption` + todas las
preconditions fulfilled + rol aprobador, `stoppageEngine.ts:179-190`). La
máquina de estados de paralización (acto jurídico) sólo existe en el path
compute-only que la UI no usa para escribir. Reanudar una paralización es
trivialmente forjable.

### 🔴 N3 — Soft-blocking server route + hook + panel son CÓDIGO MUERTO; el override crítico no tiene audit server
`SoftBlocks.tsx:21-28,70` importa `evaluateGate` **directo del servicio puro** y
lo corre client-side. NO usa `useSoftBlocking.ts` (0 importers `.tsx`) ni
`RequirementGatePanel.tsx` (0 importers) ni la ruta `softBlocking.ts`. Resultado:
- `softBlocking.ts:207 build-audit-entry` (que inyecta SHA-256 server-side y fuerza
  `authorizingUid=caller`) **nunca se invoca desde la UI real**.
- El único gate no-overrideable de seguridad (`critical_control_verification`,
  `requirementGate.ts:109`) y los overrides con `contentHash` se calculan/persisten
  100% en el cliente, sin `audit_logs` server-side (CLAUDE.md #3). El hash es
  tamper-evident pero no hay nada que ancle el doc persistido al hash ni que
  impida persistir un entry forjado sin pasar por el endpoint.

### 🔴 N4 — Exceptions server route + hook son código muerto; integridad nula
`ExceptionsAudit.tsx:42-45,145` persiste vía `exceptionStore.saveException`
(cliente, `projects/{pid}/exceptions`) y usa `ExceptionsAuditPanel`. NO usa
`useExceptions.ts` (0 importers `.tsx`). Las 6 rutas `exceptions.ts` jamás se
ejecutan desde la UI real. Peor: `recordSchema` (revoke/mark-fulfilled/derive,
`exceptions.ts:74-94`) acepta el `record` COMPLETO del cliente (con cualquier
`approvedByUid`/`status`) y lo re-emite — **no ofrecen ninguna garantía de
integridad aunque se llamaran**. Combinado con `firestore.rules:466` (sin
anti-spoof) y N1, la autoría/aprobación de una excepción a un control de
seguridad es forjable de extremo a extremo.

### 🟡 N5 — Doble validador divergente de izaje/excavación (uno está MUERTO y contradice al cableado)
Coexisten dos motores con umbrales distintos:
- Cableado (advisory, `workPermits.ts:360`): `criticalPermitValidators.ts` —
  viento izaje **bloqueo a 15 m/s** (`:100`), excavación midiendo ángulo desde
  horizontal donde "mayor = más seguro" (`MAX_SLOPE_BY_SOIL`, `:241`).
- **Muerto** (0 callers, confirmado por grep): `liftingPermitExtension.ts`
  (`validateLifting`/`canAuthorizeLifting`) bloquea viento **a 11 m/s**
  (`:57,99`) y `excavationPermitExtension.ts` (`validateExcavation`/
  `canAuthorizeExcavation`) usa modelo inverso `0=vertical`, `MIN_SLOPE_ANGLE`
  donde el ángulo es un **mínimo** (`:76,122`).

Mismo dominio físico, dos umbrales de viento contradictorios (11 vs 15 m/s) y dos
modelos de talud opuestos. El doc previo los marcó "🔵 verificar consumo"; aquí se
confirma que están muertos y que divergen del cableado — riesgo de que alguien los
cablee por error.

### 🟡 N6 — `validate-critical` es fire-and-forget; no se persiste ni gatea la emisión
`workPermits.ts:360` devuelve `result` con blockers (carga sobre capacidad,
fuente de energía sin candado) pero **el resultado no se guarda ni se vincula al
permiso**, y `createPendingPermit`/`attestAndIssuePermit` (`workPermits.ts:300,455`)
nunca lo consultan. Un permiso `loto`/`izaje_critico` se crea y firma sin haber
llamado jamás a la validación crítica. Advisory-by-design (directiva #2), pero ni
siquiera queda **registro auditable** del blocker. Combina con N7.

### 🟡 N7 — `/sign` re-estampa un permiso ya `active` sin re-atestar
`workPermits.ts:452-455`: si `permit.status === 'active'`, el sign **omite**
`attestAndIssuePermit` y sólo re-sella `approvedAt`, guardando sin re-verificar
training/EPP/aptitud/checklist. Una re-firma de un permiso vivo no re-valida las
precondiciones. (El audit sí se escribe, `:457`.)

### 🟡 N8 — `validateLotoApplication` autoriza sin candado por trabajador (group lockout)
`lotoDigitalLight.ts:105`: `authorizesWork` exige sólo "todas las energías con un
lock point" + "todos verificados cero-energía", pero **no** exige que cada
`authorizedWorkerUid` tenga su candado propio (NFPA 70E / DS 132). El validator
cableado `criticalPermitValidators.validateLoto` SÍ exige que el verificador del
try-out tenga lock (`criticalPermitValidators.ts:443`). El motor LOTO que alimenta
el `LotoStatusPanel` autoriza con un único candado de líder para todo el grupo.
(El panel es huérfano per doc previo, pero la lógica de autorización es laxa.)

### 🟡 N9 — Dos modelos incompatibles de "EngineeringControl"
`engineeringControlsInventory.ts:34` modela `kind: physical_barrier|ventilation|…`,
`status: operativo|…`, `maintainedByUid`. La ruta persiste `StoredEngineeringControl`
(`engineeringControls.ts:109`) con `level: elimination|…` + `verifications[]`.
`EngineeringControls.tsx:204` usa `useEngineeringControls` (shape de la ruta), NO
`buildEngineeringInventoryReport`. Sólo `EngineeringInventoryCard` consume el
servicio. Dos esquemas "control de ingeniería" divergentes conviviendo — drift.

### 🟡 N10 — `PTSGenerator` usa audit CLIENTE con identidad auto-reportada (CLAUDE.md #3)
`PTSGenerator.tsx:119,309` llama `logAuditAction` (cliente, `auditService`), no el
`audit_logs` server-stamped. La suspensión registra `suspendedBy:
user?.displayName || user?.email` (`:113`) — identidad del cliente, no del token.
El bloque PDF afirma "validado, encriptado y almacenado de forma inmutable"
(`:506`) sobre un `addDoc` plano con `status:'Vigente'` (`:291`) — claim
sobredimensionado (copy, 🔵).

### 🟡 N11 — Hooks/componentes huérfanos adicionales (anti-stub / superficie muerta)
Confirmados sin importadores `.tsx` (más allá de los del doc previo):
- `usePinSign.ts` → sólo lo usa `PinSignModal.tsx`, que a su vez **no lo importa
  nadie** (0 importers) ⇒ par muerto.
- `useReadReceipts.ts` → 0 importers (aunque `DocumentReadConfirmCard` sí se usa,
  el hook no).
- `useJsa.ts` → 0 importers `.tsx`. El backend JSA existe y está testeado
  (`src/server/routes/jsa.ts` + `services/jsa/jobSafetyAnalysis.ts`), pero ningún
  page cablea el hook: feature backend-completa sin superficie UI.
- `RequirementGatePanel.tsx`, `useSoftBlocking.ts`, `useExceptions.ts` (ver N3/N4).

### 🔵 N12 — Cron auto-expire muta estado sin `audit_logs`
`runWorkPermitAutoExpire.ts:67`/`runExceptionAutoExpire.ts:68` hacen
`set({status:'expired',...},{merge:true})` sin escribir `audit_logs`. Cambio de
estado de cron (actor sistema) que no deja rastro en el trail de compliance.
Aceptable si se considera actor de sistema, pero la invariante #3 no distingue.

### 🔵 N13 — `firestore.rules:463` comentario factualmente incorrecto
El `TODO(review dahosandoval@)` afirma "no creator-uid field confirmed in the
schema" para `exceptions`. Falso: `ExceptionRecord.approvedByUid` existe
(`exceptionEngine.ts:52`) y el cliente lo escribe. El campo para el anti-spoof SÍ
existe; el comentario bloquea innecesariamente el endurecimiento de N4.

---

## 2. Tabla por archivo (54/54)

| Archivo | Estado | Hallazgo NUEVO (file:line) |
|---|---|---|
| src/components/engineering/ConfinedSpacePanel.tsx | ✅ | UI Bernoulli confinado, wired CalculatorHub. Limpio |
| src/components/engineering/HidranteFireNetworkPanel.tsx | ✅ | UI Bernoulli hidrante, wired CalculatorHub. Limpio |
| src/components/engineeringControls/EngineeringInventoryCard.tsx | 🟡 | Único consumidor del modelo divergente N9 |
| src/components/exceptions/ExceptionsAuditPanel.tsx | ✅ | Wired ExceptionsAudit:380. Limpio |
| src/components/loto/LotoStatusPanel.tsx | 🟡 | Huérfano (doc previo) + autoriza group-lockout N8 |
| src/components/pinSign/PinSignModal.tsx | 🔴 | **0 importers** (N11) — modal muerto + usePinSign |
| src/components/readReceipts/DocumentReadConfirmCard.tsx | ✅ | Wired (DocumentReadConfirm + eppFlow). Limpio |
| src/components/softBlocking/RequirementGatePanel.tsx | 🔴 | **0 importers** (N3) — SoftBlocks no lo usa |
| src/components/stoppage/StoppageBanner.tsx | ✅ | Usa useStoppage. Limpio |
| src/components/stoppage/StoppageResumeModal.tsx | 🟡 | Usa useStoppage→endpoint, pero write real es store (N2) |
| src/components/stoppage/StoppageSummaryCard.tsx | ✅ | Render. Limpio |
| src/components/workPermits/PermitChecklistRenderer.tsx | ✅ | Usa permitLifecycleAdvisor (vivo). Limpio |
| src/components/workPermits/WorkPermitCard.tsx | ✅ | Wired WorkPermits. Limpio |
| src/components/zones/ZoneEntryGate.tsx | ✅ | Wired RestrictedZonesMapOverlay; never-block by design. Limpio |
| src/hooks/useEngineeringControls.ts | ✅ | Wired EngineeringControls. Limpio |
| src/hooks/useExceptions.ts | 🔴 | **0 importers** (N4) — ExceptionsAudit usa store |
| src/hooks/useJsa.ts | 🟡 | **0 importers** (N11); backend existe, sin UI |
| src/hooks/useLoto.ts | 🔴 | Read-only + huérfano (doc previo) |
| src/hooks/usePinSign.ts | 🔴 | Sólo PinSignModal (muerto) lo usa (N11) |
| src/hooks/useReadReceipts.ts | 🔴 | **0 importers** (N11) |
| src/hooks/useSoftBlocking.ts | 🔴 | **0 importers** (N3) — SoftBlocks usa servicio puro |
| src/hooks/useStoppage.ts | ✅ | Wired (banner/modal). Limpio |
| src/hooks/useWorkPermits.ts | ✅ | Wired WorkPermits. Limpio |
| src/pages/DocumentReadConfirm.tsx | ✅ | Wired ComplianceRoutes. Limpio |
| src/pages/EngineeringControls.tsx | 🟡 | Usa ruta, no inventory service (N9) |
| src/pages/ExceptionsAudit.tsx | 🔴 | Persiste vía store cliente, bypassa endpoints (N4) |
| src/pages/PTSGenerator.tsx | 🟡 | audit cliente + identidad auto-reportada (N10) |
| src/pages/SoftBlocks.tsx | 🔴 | evaluateGate client-side, bypassa ruta+hook (N3) |
| src/pages/StoppageMonitor.tsx | 🟡 | saveStoppage cliente; resume forjable vía rules (N2) |
| src/pages/WorkPermits.tsx | ✅ | Wired; flujo server real. Limpio |
| src/server/jobs/runExceptionAutoExpire.ts | 🔵 | Muta sin audit_logs (N12) |
| src/server/jobs/runWorkPermitAutoExpire.ts | 🔵 | Muta sin audit_logs (N12) |
| src/server/routes/engineeringControls.ts | ✅ | CRUD+txn+audit+verifierUid server. Sólido (modelo ≠ N9) |
| src/server/routes/exceptions.ts | 🔴 | approvedByRole del body (N1); recordSchema sin integridad (N4) |
| src/server/routes/loto.ts | 🔴 | Sólo GET (doc previo) |
| src/server/routes/softBlocking.ts | 🔴 | Ruta muerta; audit override sólo cliente (N3) |
| src/server/routes/stoppage.ts | 🔴 | resumedByRole/declaredByRole del body (N1) |
| src/server/routes/workPermits.ts | 🟡 | sign re-active sin re-atestar (N7); validate-critical fire-and-forget (N6) |
| src/services/engineeringControls/engineeringControlsInventory.ts | 🟡 | Modelo divergente del de la ruta (N9) |
| src/services/exceptions/exceptionEngine.ts | ✅ | Puro; valida rol pero confía en string (N1 upstream) |
| src/services/exceptions/exceptionFirestoreAdapter.ts | 🟡 | tenant-scoped sin callers de escritura (doc previo); índice cron muerto |
| src/services/exceptions/exceptionStore.ts | 🔴 | Path `projects/{pid}/exceptions`; fuente de verdad real (N4) |
| src/services/loto/lotoDigitalLight.ts | 🟡 | authorizesWork sin candado-por-worker (N8); release dead (doc previo) |
| src/services/loto/lotoFirestoreAdapter.ts | 🏚️ | save/appendAudit sin callers (doc previo) |
| src/services/softBlocking/requirementGate.ts | ✅ | Puro correcto; cableado client-side (N3) |
| src/services/stoppage/stoppageEngine.ts | ✅ | State-machine correcta, pero sólo en path muerto (N2) |
| src/services/stoppage/stoppageFirestoreAdapter.ts | 🔵 | Sin callers de escritura (doc previo) |
| src/services/stoppage/stoppageStore.ts | 🔴 | Write real; rules no protegen status (N2) |
| src/services/workPermits/criticalPermitValidators.ts | ✅ | Cableado advisory; diverge de extensiones muertas (N5) |
| src/services/workPermits/excavationPermitExtension.ts | 🔴 | **0 callers** (muerto) + modelo talud opuesto (N5) |
| src/services/workPermits/liftingPermitExtension.ts | 🔴 | **0 callers** (muerto) + viento 11 vs 15 m/s (N5) |
| src/services/workPermits/permitLifecycleAdvisor.ts | ✅ | Wired PermitChecklistRenderer. Limpio |
| src/services/workPermits/workPermitEngine.ts | ✅ | createPending/attest/issue; checklist anti-forja `:174,193`. Limpio |
| src/services/workPermits/workPermitFirestoreAdapter.ts | ✅ | (no en slice; referenciado) server-only path. Limpio |

> Nota: el slice [0:54] incluye `workPermitFirestoreAdapter.ts` y excluye sus
> `.test.ts` (los tests no están en `category=FEAT`). Conteo de archivos
> productivos del slice = 54, todos leídos.

---

## 3. Archivos LIMPIOS (sin hallazgo nuevo)

ConfinedSpacePanel, HidranteFireNetworkPanel, ExceptionsAuditPanel,
DocumentReadConfirmCard, StoppageBanner, StoppageSummaryCard,
PermitChecklistRenderer, WorkPermitCard, ZoneEntryGate, useEngineeringControls,
useStoppage, useWorkPermits, DocumentReadConfirm, WorkPermits.tsx,
engineeringControls.ts (ruta), exceptionEngine, requirementGate, stoppageEngine,
permitLifecycleAdvisor, workPermitEngine, workPermitFirestoreAdapter.
`Math.random` ausente en todos los server files del bloque (#15 OK).

---

## 4. Para decisión del usuario (⚠️)

- **⚠️ N1/N2 (rol auto-declarado + rules de stoppage laxas):** la autorización de
  reanudar paralizaciones y aprobar excepciones es forjable. ¿Resolver el rol
  desde el token (como workPermits) en stoppage/exceptions, y endurecer
  `firestore.rules:391` para anclar `resumedByUid`/rol? Requiere tests rules
  (resume-deny-non-approver) + Dirty Dozen.
- **⚠️ N3/N4 (rutas server + hooks muertos):** soft-blocking y exceptions tienen
  endpoint+hook completos que la UI NO usa (corre puro client-side + writes
  directos). ¿Cablear la UI a los endpoints server (para audit + integridad) o
  borrar la superficie muerta (anti-stub #13) y aceptar el modelo offline-first
  client-only documentándolo?
- **⚠️ N5 (validadores izaje/excavación duplicados y contradictorios):** 11 vs
  15 m/s, modelos de talud opuestos. ¿Borrar `liftingPermitExtension`/
  `excavationPermitExtension` (muertos) o reconciliarlos con
  `criticalPermitValidators` antes de que alguien cablee el incorrecto?
- **🔵 N9/N13:** unificar el modelo `EngineeringControl` y corregir el comentario
  falso de `firestore.rules:463`.
</content>
</invoke>
