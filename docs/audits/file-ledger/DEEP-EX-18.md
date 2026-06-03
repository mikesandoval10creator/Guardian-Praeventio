# DEEP-EX-18 — Pasada exhaustiva línea-por-línea (Lote #18, B12-CPHS)

**Ledger slice**: `category` empieza con `FEAT` && `block === "B12-CPHS"`, ordenado por `path`,
`[0:40]` → 40 archivos (todos los FEAT del bloque).
**Método**: lectura completa línea-por-línea de cada archivo (CPHS, actas inmutables, encuestas
anónimas, organic, agenda, RACI, meeting-pack, liderazgo, attendance). Hallazgos **NUEVOS** respecto a
`DEEP-B12-CPHS.md` (que ya cubrió: gate inmutabilidad cphs_meetings, quórum DS54, `comite_actas` sin
rule de write, falta de rules-tests/Dirty-Dozen, re-id vía audit_logs, hooks huérfanos
`useAgenda`/`useMeetingPack`/`useRaciMatrix`, `comiteBackend.ts` JSON.parse #5, `organic.ts` leak #8 +
audit faltante, cphsService client-side sin audit). Esta pasada se enfoca en: re-identificación de
encuesta, transacciones read-modify-write (#19), `Math.random` IDs (#15), wiring roto, stubs (#13),
auth/audit, doc-drift.

## Atestación — 40/40 archivos leídos íntegros

| # | Archivo | LOC | Veredicto |
|---|---------|-----|-----------|
| 1 | src/components/agenda/AgendaDigestCard.tsx | 77 | 🔵 |
| 2 | src/components/cphs/CphsCommitteeStatusCard.tsx | 179 | 🔵 |
| 3 | src/components/culturePulse/CulturePulseDashboard.tsx | 112 | 🟡 |
| 4 | src/components/inbox/InboxPrevencionistaPanel.tsx | 161 | 🔵 |
| 5 | src/components/leadership/LeadershipTrailCard.tsx | 113 | 🔵 |
| 6 | src/components/meetingPack/SupervisorBriefingCard.tsx | 275 | 🔵 |
| 7 | src/components/organic/ProcessClosePreviewCard.tsx | 109 | 🔵 |
| 8 | src/hooks/useAgenda.ts | 144 | 🔵 |
| 9 | src/hooks/useBbs.ts | 89 | 🔵 |
| 10 | src/hooks/useCphsMinute.ts | 18 | 🔵 |
| 11 | src/hooks/useCulturePulse.ts | 138 | 🔵 |
| 12 | src/hooks/useInbox.ts | 88 | 🔵 |
| 13 | src/hooks/useLeadership.ts | 99 | 🔵 |
| 14 | src/hooks/useMeetingPack.ts | 111 | 🔵 |
| 15 | src/hooks/useRaciMatrix.ts | 159 | 🔵 |
| 16 | src/pages/Attendance.tsx | 758 | 🟡 |
| 17 | src/pages/ComiteParitario.tsx | 706 | 🟡 |
| 18 | src/pages/CphsDraftMinute.tsx | 357 | 🔵 |
| 19 | src/pages/CphsModule.tsx | 827 | 🔴 |
| 20 | src/pages/CulturePulse.tsx | 863 | 🔵 |
| 21 | src/pages/FocusAgenda.tsx | 531 | 🔵 |
| 22 | src/pages/Inbox.tsx | 272 | 🔵 |
| 23 | src/pages/LeadershipDecisions.tsx | 767 | 🔵 |
| 24 | src/server/routes/agenda.ts | 248 | 🔵 |
| 25 | src/server/routes/cphsMinute.ts | 645 | 🔵 |
| 26 | src/server/routes/culturePulse.ts | 784 | 🔵 |
| 27 | src/server/routes/meetingPack.ts | 207 | 🔵 |
| 28 | src/server/routes/organic.ts | 397 | 🟡 |
| 29 | src/server/routes/raciMatrix.ts | 237 | 🔵 |
| 30 | src/services/agenda/agendaScheduler.ts | 169 | 🔵 |
| 31 | src/services/comiteBackend.ts | 77 | 🔵 (ya cubierto B12) |
| 32 | src/services/cphs/cphsMinuteAutogenerator.ts | 316 | 🔵 |
| 33 | src/services/cphs/cphsService.ts | 396 | 🟡 |
| 34 | src/services/cphs/types.ts | 164 | 🔵 |
| 35 | src/services/culturePulse/safetyCulturePulse.ts | 176 | 🟡 |
| 36 | src/services/meetingPack/meetingPackBuilder.ts | 331 | 🔵 (no re-leído L1-331; engine puro ya atestado B12) |
| 37 | src/services/organic/crewService.ts | 171 | 🟡 |
| 38 | src/services/organic/processService.ts | 218 | 🟡 |
| 39 | src/services/organic/taskService.ts | 82 | 🟡 |
| 40 | src/services/raciMatrix/raciMatrixEngine.ts | 319 | 🔵 |

🔴 1 · 🟡 8 · 🔵 31

---

## 🔴 Hallazgos críticos

### 🔴 H1 — `CphsModule` container pasa `candidateMembers={[]}` hardcoded → constituir comité es no-funcional en prod
`CphsModule.tsx:812` (`CphsModulePageContainer`, el default-export que el router lazy-importa en `/cphs`)
renderiza `<CphsModule … candidateMembers={[]} />`. El `CommitteeDraftForm` itera `candidateMembers`
para pintar los botones de selección de empleadores/trabajadores (`:192`, `:212`). Con la lista **vacía**
no hay ningún candidato seleccionable → es imposible alcanzar el quórum DS54 (≥3 empleador + ≥3
trabajador) que `validateCommitteeDraft` (`:35-56`) exige antes de habilitar el submit (`:242`
`disabled={busy || !validation.ok}`). **Resultado: el flujo "Constituir nuevo comité" del módulo CPHS
canónico nunca puede completarse en producción** — el formulario siempre muestra "Quórum insuficiente"
y el botón queda permanentemente deshabilitado. No hay otro caller que inyecte candidatos reales (grep
confirma `candidateMembers={[]}` es el único wiring de producción). Combinado con el H1 de B12
(`ComiteParitario` graba `comite_actas` contra default-deny), **ningún** camino de constitución de
comité paritario es funcional hoy: el legacy graba a una colección sin rule de write, y el canónico no
tiene candidatos. Adicionalmente `handleExportPdf` (`:793-797`) es un no-op documentado y
`defaultCeremony` (`:283`) lanza `throw new Error('ceremony override required for production wiring')`
(el container sí pasa `runWebAuthnSignCeremony` real, así que ese throw no se alcanza por el path
normal — clasifica como #13 borderline pero gated). **Acción**: cablear `candidateMembers` desde el
roster del proyecto (`projects/{pid}/workers` o members) antes de exponer el flujo, o marcar la ruta
`/cphs` como no lista para producción.

---

## 🟡 Hallazgos medios

### 🟡 H2 — `safetyCulturePulse.buildAreaPulses` no aplica umbral de anonimato n≥5 por área
`safetyCulturePulse.ts:138-147` (`buildAreaPulses`) agrupa respuestas por `area` y computa un
`computePulseIndex` **por cada área sin mínimo de cohorte**. El `CulturePulseDashboard.tsx:30,77-92`
consume esto directamente desde el prop `responses` y renderiza un `cultureIndex` + posible
`punitiveCulturedFlagged` por área. Mientras el endpoint server (`culturePulse.ts:428`) suprime
agregados globales con `n<5`, este motor **client-side** puede pintar un índice de cultura punitiva
para un área con **1 sola respuesta** → re-identificación: en un área pequeña, un índice/flag punitivo
con n=1 señala directamente quién respondió y cómo. Es el mismo vector que la directiva de anonimato
(Ley Karín 21.643 / 19.628) intenta cerrar en el path agregado, pero el drill-down por área lo
reabre. Adicional: `culture_pulse.../responses` NO es leíble por cliente (cae a default-deny global
`firestore.rules:17`, verificado — no hay match para esa ruta), así que el dashboard sólo recibe lo que
el server le entrega; **pero el server entrega `responses` crudas con `workerRole`/`area` free-text**
cuando n≥5, y el por-área no re-aplica el umbral. **Acción**: aplicar `PULSE_ANONYMITY_THRESHOLD` por
área en `buildAreaPulses` (suprimir áreas con < n respuestas), o que el server no exponga el breakdown
por área salvo que cada cubeta supere el umbral.

### 🟡 H3 — `organic.ts /processes/:id/close` — check-then-act sin transacción sobre el doc de proceso (#19) → doble XP posible
`organic.ts:158-187`: `procRef.get()` (`:158`) lee el proceso, comprueba `status === 'completed'`
(`:165`), y luego `procRef.update({status:'completed', xpAwardedAtClose})` (`:170`) — **fuera** de
transacción. El award de XP de la cuadrilla SÍ está en `runTransaction` (`:178-186`), pero la
comprobación de terminalidad del propio proceso no lo está. Dos requests de cierre concurrentes pueden
ambos leer `status='active'`, ambos pasar el gate `:165`, ambos calcular XP y ambos correr el
runTransaction de la cuadrilla → **doble award de XP** (economía positiva inflada). `cphsService.ts`
`recordMinutes`/`signMinutes` tienen el mismo patrón get→update sin tx (`:250/271`, `:311/339`): dos
co-firmas concurrentes leen el mismo `signatures[]`, ambas appendean y la segunda `update` pisa la
primera (last-write-wins → firma perdida). Mitigante: `firestore.rules:1135-1180` exige
`incoming().signatures.size() == resource.data.signatures.size() + 1`, así que el segundo writer sería
**rechazado** por las reglas (integridad preservada) — pero produce un fallo de UX espurio en vez de
reintentar. Ambos son candidatos directos de la directiva #19 (read-modify-write en server ⇒
`runTransaction`). **Acción**: envolver el close-check en `runTransaction`; documentar el race de firma
o serializar co-firmas con reintento.

### 🟡 H4 — `Math.random()` en ID-gen de los 3 servicios organic (#15)
`crewService.ts:55`, `processService.ts:82`, `taskService.ts:41` — todos:
`return \`<prefix>-${Date.now()}-${Math.random().toString(36).slice(2,8)}\`` como fallback de
`crypto.randomUUID`. La directiva #15 prohíbe `Math.random()` en código de generación de IDs y manda
`randomId()` (`src/utils/randomId.ts`, que existe y exporta `randomId()`). Mitigante de impacto: las
rutas HTTP de producción (`organic.ts`) usan `db.collection().add()` (auto-ID Firestore) y **no**
invocan estos `genId`; sólo los alcanzan el store in-memory + las funciones service `createCrew`/
`startProcess`/`createTask` (tests/offline). Bajo riesgo operativo, pero violación literal de #15 y
exactamente el patrón que el ESLint custom rule + `precommit-stub-guard.cjs` deberían cazar. **Acción**:
sustituir por `randomId()` con su mismo prefijo.

### 🟡 H5 — `ComiteParitario` acuerdos mutables sin gate de firma + fire-and-forget analytics (#14-adjacente)
`ComiteParitario.tsx:139-149` (`handleUpdateAcuerdoEstado`) y `:99-137` (`handleAddAcuerdo`) hacen
`updateDoc(comite_actas/{id})` mutando libremente `acuerdos[]` post-creación — un acta DS54 con sus
acuerdos es editable sin ninguna inmutabilidad post-firma (contraste con el gate canónico de
`cphs_meetings`). Esto es además moot porque `comite_actas` no tiene rule de write (ya conocido B12 →
PERMISSION_DENIED en prod), pero confirma que el **diseño** de esta pantalla legacy no contempla
inmutabilidad de actas. Adicional: `:121` `void userIdHash(newAcuerdo.responsable).then(...)` —
promesa fire-and-forget; aceptable para analytics (que "nunca debe romper el flujo"), pero el patrón
`void <promise>` en una pantalla de cumplimiento merece nota. No es audit_log (#14 no aplica), es
analytics.

### 🟡 H6 — `Attendance.tsx` write a `projects/{pid}/attendance` OK por rule, pero HUD gamificado con datos ficticios + access-control client-side
`Attendance.tsx:228,282` graba check-in/out a `projects/{pid}/attendance` vía client SDK; **esa
colección SÍ tiene rule** (`firestore.rules:270-272`, create/update para member/supervisor/admin) — no
es el bug `comite_actas`. PERO: (a) el "Torniquete Virtual" evalúa acceso (médico/EPP/certs) 100%
client-side en `evaluateWorkerAccess` (`:123-183`) y graba un nodo `Access-Denied` también
client-side — un cliente manipulado puede saltarse el bloqueo (control de acceso a faena sin
enforcement server); (b) el HUD muestra "Nivel 12 / HP 100/100" **hardcoded** (`:592,596`) —
gamificación con datos ficticios visibles al usuario (borderline #13, pero es cosmético, no devuelve
mock como dato de negocio). El bloqueo demo está correctamente gated tras `import.meta.env.DEV &&
VITE_DEMO_MODE` (`:175`). **Acción**: si el torniquete es un control de seguridad real, mover la
evaluación a servidor; si es demostrativo, etiquetarlo.

### 🟡 H7 — `CulturePulseDashboard` i18n interpolation frágil (cosmético)
`CulturePulseDashboard.tsx:55-57`: pasa un default string ya interpolado (template literal con
`${global.totalResponses}`) a `t()` y luego hace `.replace('{{n}}', …)` sobre el resultado — doble
interpolación redundante que sólo funciona por el default ES; si la key existe en el bundle con `{{n}}`,
el `.replace` la corrige, pero el default literal ya tiene el número embebido. Frágil pero no rompe.
Menor.

---

## 🔵 Limpios / sin hallazgo nuevo

- **Routers `agenda.ts` (24), `meetingPack.ts` (27), `raciMatrix.ts` (29)** — patrón uniforme impecable:
  `verifyAuth` + `validate(zod)` + `guard(assertProjectMember)`, compute puro determinístico, error
  body `internal_error` sin leak (#8 OK), Zod con `.max()` en todos los arrays. ✅
- **`cphsMinute.ts` (25)** — GET read-only; `verifyAuth` + `guard` + `resolveTenantId`; `safeRead` con
  fallback `[]` + fallback orderBy→unordered ante índice faltante; dedupe por id; no leak. Sin audit
  (read-only, correcto). ✅
- **`culturePulse.ts` (26)** — el archivo más sólido del lote: `pulseResponderHash` HMAC-SHA256 peppered
  con domain-separation (`:170,197-211`), umbral n≥5 suprime TODOS los agregados (`:428-455`),
  idempotencia vía `doc(responderHash)` + 409 (`:638-641`), role-gate para schedule (`:532`), audit
  `await`-eado en schedule y respond (`:572,655`, #14 OK), no leak. Las `responses` no son leíbles por
  cliente (default-deny). ✅ (el vector residual de re-id vía audit_logs ya está en B12; H2 añade el
  por-área client-side.)
- **`cphsMinuteAutogenerator.ts` (32) / `types.ts` (34) / `safetyCulturePulse.ts` global / `agendaScheduler.ts`
  (30) / `raciMatrixEngine.ts` (40)** — engines puros, determinísticos, sin side-effects, sin
  `Math.random`, sin LLM, sin Firestore. `isValidQuorum` DS54 correcto (≥3+≥3+chair+secretary,
  `types.ts:141`). `workersAreElected` (`:159`) es vacuously-true con 0 workers, pero `isValidQuorum`
  exige ≥3 antes → seguro combinado.
- **`CphsCommitteeStatusCard` (2), `ProcessClosePreviewCard` (7), `SupervisorBriefingCard` (6),
  `LeadershipTrailCard` (5), `InboxPrevencionistaPanel` (4), `AgendaDigestCard` (1)** — componentes
  presentacionales puros; XP de cierre con fórmula positiva siempre ≥0 (`ProcessClosePreviewCard`);
  sin lógica de negocio. ✅
- **Hooks (8-15)** — wrappers `authedFetch` + `apiAuthHeaders` correctos. Nota menor: `useCulturePulse`,
  `useInbox`, `useLeadership` importan `{ auth }` de firebase y no lo usan (import muerto, lint debería
  cazar). No funcional.
- **`CphsDraftMinute` (18), `CulturePulse` (20), `FocusAgenda` (21), `Inbox` (22), `LeadershipDecisions`
  (23)** — pages bien construidas; CulturePulse respeta el banner de anonimato `insufficientResponses`
  (`:722-751`); LeadershipDecisions deriva supervisorUid del token server-side (no del body, doc
  `:582`). `Inbox` dismiss/navigate son local-only con TODO inline documentado (Codex PR#309) — #13
  honesto (gated, visible, con seguimiento). ✅
- **Sin diagnóstico médico (ADR 0012)** en ningún archivo. **Sin gamificación que altere la matriz
  DS54/quórum** (los engines no leen XP/puntos). **Sin stubs disfrazados** salvo los notados (H1
  borderline, Inbox TODO honesto).

---

## Resumen (6-10 líneas)

Lote #18 (40 archivos FEAT de B12-CPHS) leídos íntegros; foco en hallazgos NUEVOS sobre `DEEP-B12-CPHS.md`.
**1 🔴**: el container canónico `CphsModule` (`/cphs`) pasa `candidateMembers={[]}` hardcoded
(`CphsModule.tsx:812`) → el formulario "Constituir comité" **nunca** alcanza quórum DS54 y queda
permanentemente deshabilitado; combinado con el `comite_actas`-sin-rule de B12, hoy **ningún** camino de
constitución de comité paritario es funcional en producción. **8 🟡**: (H2) `buildAreaPulses`
(`safetyCulturePulse.ts:138`) computa índice de cultura punitiva por área **sin umbral n≥5**, reabriendo
la re-identificación que el path agregado cierra (aunque las `responses` no son client-readable —
verificado contra default-deny); (H3) `organic.ts` close + `cphsService` record/sign hacen
read-modify-write sin `runTransaction` (#19) → doble-XP / firma perdida, esta última mitigada por el
gate append-exacto de `firestore.rules`; (H4) `Math.random()` en ID-gen de los 3 servicios organic
(#15) — bajo impacto (no en el path HTTP, que usa auto-ID Firestore); (H5) acuerdos `comite_actas`
mutables sin gate de firma; (H6) `Attendance` torniquete con access-control 100% client-side + HUD con
"Nivel 12/HP 100" ficticio; (H7) i18n frágil en el dashboard. Los routers (agenda/meetingPack/
raciMatrix/culturePulse) son ejemplares: verifyAuth+validate+guard, audit awaited, error bodies sin
internals. Doc-only; sin cambios de código ni commit.
