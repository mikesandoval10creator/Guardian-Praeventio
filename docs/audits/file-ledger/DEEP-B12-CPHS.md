# DEEP — B12 CPHS & Comités · 2026-06-02

**Archivos revisados:** 55 (ledger `block==="B12-CPHS"`) + 5 colaterales no-ledger
relevantes (`firestore.rules` §1085-1182 / §886-918, `src/pages/CphsModule.tsx`,
`src/server/routes/cphsMinute.ts`, `src/server/middleware/auditLog.ts`,
`src/rules-tests/firestore.rules.test.ts`).

Cobertura: server routes (cphsMinute, organic, culturePulse, agenda, meetingPack,
raciMatrix), services (cphsService, comiteBackend, agendaScheduler,
safetyCulturePulse, meetingPackBuilder, raciMatrixEngine, organic/*,
cphsMinuteAutogenerator), hooks, components, pages, ADR, i18n parity.

---

## 1. Lo que YA HACE (implementado y real)

- **Gate de inmutabilidad de actas CPHS — CORRECTO (no replica el bug site_book).**
  `firestore.rules:1154-1178`: el caso B (append-only post-firma) y el caso A
  (edición pre-firma) ambos pivotan sobre `resource.data.signatures.size()`
  (dato **almacenado**), NO sobre `incoming().signatures.size()`. Un cliente no
  puede declarar `signatures:[]` en el payload para reabrir un acta firmada. El
  append exige `incoming().signatures.size() == resource.data.signatures.size() + 1`
  y congela bit-a-bit `committeeId/scheduledAt/agenda/minutes/resolutions/`
  `attendees/status`. `delete: if false` (`:1179`). Espejo correcto del patrón
  audit_logs.
- **Quórum ≥6 + DS54 art.66.** `firestore.rules:1123-1124` (`members.size() >= 6`)
  reforzado server-side por `isValidQuorum()` en `src/services/cphs/types.ts:141-151`
  (≥3 empleador + ≥3 trabajador + chair + secretary). `workersAreElected()`
  (`:159-163`) valida sufragio del lado trabajador → `iso45001Compliance`
  (`cphsService.ts:147-148`).
- **cphsService inmutabilidad en capa servicio.** `recordMinutes()` lanza
  `CphsImmutableMinutesError` si `signatures.length > 0` (`cphsService.ts:256-260`);
  `signMinutes()` exige `status==='held'`, uid en attendees, e idempotencia
  anti-doble-firma (`:315-330`).
- **cphsMinute.ts (F.7 borrador mensual)** — solidísimo: `verifyAuth` +
  `assertProjectMember` + `resolveTenantId`, GET read-only, `safeRead` con
  fallback `[]`, fallback orderBy→unordered ante índice faltante, dedupe por id,
  5xx = `internal_error` sin leak (`cphsMinute.ts:102-642`). Pure service
  `buildMonthlyMinuteDraft` sin LLM ni firestore.
- **culturePulse — privacidad Ley Karín 21.643 / 19.628 bien diseñada.**
  `responderHash` = HMAC-SHA256 keyed por pepper server-only con domain-separation
  (`culturePulse.ts:197-211`); umbral de anonimato n≥5 suprime todos los agregados
  (`:222`, `:450-452`); idempotencia vía `doc(responderHash)` + 409
  (`:633-640`); role-gate para agendar (`:99-135`, 403 en `:532`);
  `auditServerEvent` en schedule y respond (`:572`, `:655`); 5xx = `internal_error`.
- **agenda / meetingPack / raciMatrix routers** — patrón uniforme y limpio:
  `verifyAuth` + `validate(zod)` + `guard(assertProjectMember)`, compute puro,
  5xx = `internal_error` sin leak. Engines sin firestore / sin `Math.random` /
  sin async (verificado).
- **organic (crews/processes/tasks)** — writes server-only por reglas
  (`firestore.rules:895-903` `create,update,delete:if false`); XP de cierre y ack
  predictivo en `runTransaction` (`organic.ts:178-186`, `:324-331`); audit en
  status-change y ack (`:230-237`, `:355-362`).
- Todos los routers montados: organic `server.ts:899`, cphsMinute `:1015`,
  culturePulse `:1020`, raci `:1112`, agenda `:1121`, meetingPack `:1140`.
- Sin stubs / NotImplementedError / mocks de producción en todo el bloque.

---

## 2. Lo que está PENDIENTE (deuda de este bloque)

- 🔴 **CERO rules-tests para `cphs_meetings` / `cphs_committees`.** `grep -c cphs`
  en los 4 archivos `src/rules-tests/*.ts` = **0**. El gate 🔐 de inmutabilidad
  post-firma (lo más sensible del bloque) NO está cubierto por ningún test de
  reglas. CLAUDE.md #4 exige ≥5 tests (owner-allow, non-member-deny,
  schema-deny, post-sign-update-deny, server-field-spoof-deny). Las colecciones
  organic SÍ los tienen (16 refs en `firestore.rules.test.ts`).
- 🔴 **CPHS no está en `security_spec.md` (Dirty Dozen).** `grep cphs|comite|
  signatures` en `security_spec.md` y `src/rules-tests/dirtyDozen.test.ts` = 0
  hits. Requerido por CLAUDE.md #4 para una colección 🔐.
- 🔴 **`projects/{projectId}/comite_actas` sin reglas de escritura → writes
  rotos.** `ComiteParitario.tsx:73,111` hace `addDoc`/`updateDoc` (Web SDK
  cliente) a `comite_actas`, pero esa subcolección sólo está cubierta por el
  master-gate `firestore.rules:258-260` que concede **read** a miembros; no hay
  `create/update` → cae al default-deny global (`:17`). En producción esas
  escrituras quedarían **PERMISSION_DENIED**. Ruta `comite-paritario` montada
  (`ComplianceRoutes.tsx:41`).
- ⚠️ **Doble implementación divergente del mismo feature DS54.** `ComiteParitario`
  (`/comite-paritario` → `comite_actas` subcol, write roto) y `CphsModule`
  (`/cphs` → `cphs_committees`/`cphs_meetings`, canónico) coexisten y están ambas
  ruteadas (`ComplianceRoutes.tsx:41-42`). Confusión de fuente-de-verdad +
  duplicación de actas DS54.
- ⚠️ **Re-identificación residual de encuesta vía audit_logs.** La respuesta es
  anónima (sin `responderUid`) pero `auditServerEvent(req,'culturePulse.
  respondSurvey',...,{projectId,surveyId})` (`culturePulse.ts:655-660`) escribe
  en audit_logs el `userId`/`userEmail` del token (`auditLog.ts:65-89`) junto al
  `surveyId`. Un insider con read de audit_logs correlaciona quién respondió qué
  ola — el comentario inline (`:651-654`) sólo protege el doc de respuesta, no
  cierra este vector.
- 🟡 **`useAgenda`, `useMeetingPack`, `useRaciMatrix` SIN consumidores.** Hooks +
  routers + engines + tests existen y pasan, pero ningún page/component los
  importa (grep en `src/pages`/`src/components` = 0). Features "wired backend→hook"
  pero huérfanos de UI. (`useCulturePulse` SÍ se consume en `CulturePulse.tsx`.)
- 🟡 **`comiteBackend.ts` viola convención #5 (JSON.parse sin try/catch).**
  `comiteBackend.ts:37,75` `JSON.parse(response.text)` sin guard ni fallback
  502. Acciones whitelisted OK (`gemini.ts:195-196`) + exportadas
  (`geminiBackend.ts:1452`).
- 🟡 **organic.ts filtra `err?.message` en 5xx (viola #8).** Handlers `/crews`,
  `/processes`, `/crews/:id/members`, `/processes/:id/close`, `/tasks/:id/done`
  devuelven `{ error: err?.message ?? 'internal' }` (`organic.ts:81,107,144,192,
  258,293,372,391`) sin gate `NODE_ENV==='production'`. `/crews`, `/processes`,
  `/processes/:id/tasks`, `/tasks/:id/done` además NO escriben audit_log (sólo
  status-change y ack lo hacen) — posible brecha #3.
- 🟡 **cphsService no tiene ruta HTTP — corre 100% client-side.** `cphsService`
  sólo lo importa `CphsModule.tsx:582-589` contra un adaptador Web SDK
  (`makeWebSdkCphsDb`, `:601-641`). No hay endpoint servidor que llame
  `createCommittee/scheduleMeeting/recordMinutes/signMinutes`. Consecuencias:
  (a) la verificación criptográfica WebAuthn vive en `/api/auth/webauthn/verify`
  pero la **escritura** de la firma a Firestore la hace el cliente (el doc del
  service `cphsService.ts:19-25` asume un "handler HTTP" que no existe); (b)
  ninguna de estas operaciones (constituir comité, firmar acta) escribe
  audit_logs → brecha de invariante #3 para un feature 🔐 legal. La integridad
  depende EXCLUSIVAMENTE de `firestore.rules` (que sí está bien, ver §1) y de la
  honestidad del payload del cliente respecto al contenido del acta.

---

## 3. Tabla por archivo (TODOS)

| Archivo | LOC | Estado | Cableado | Propósito + hallazgo file:line |
|---|---|---|---|---|
| docs/architecture-decisions/0001-organic-collections-top-level.md | 89 | ✅ | doc | ADR colecciones organic top-level |
| scripts/i18n-parity-baseline.json | 68 | ✅ | build | baseline ratchet i18n |
| src/__tests__/scripts/i18nParity.test.ts | 81 | ✅ | CI | gate parity es/en/pt-BR |
| src/__tests__/server/culturePulse.router.test.ts | 753 | ✅ | test | contrato router pulse (401/403/409/n<5) |
| src/__tests__/server/culturePulse.test.ts | 315 | ✅ | test | hash + suppression asserts |
| src/__tests__/server/organic.router.test.ts | 178 | ✅ | test | contrato organic |
| src/components/agenda/AgendaDigestCard.tsx | 76 | 🟡 | huérfano | card digest — sin page consumidora |
| src/components/agenda/AgendaDigestCard.test.tsx | 61 | ✅ | test | — |
| src/components/cphs/CphsCommitteeStatusCard.tsx | 178 | ✅ | CphsModule | badge quórum/ISO45001 |
| src/components/cphs/CphsCommitteeStatusCard.test.tsx | 130 | ✅ | test | — |
| src/components/culturePulse/CulturePulseDashboard.tsx | 111 | ✅ | CulturePulse.tsx | dashboard pulse |
| src/components/culturePulse/CulturePulseDashboard.test.tsx | 87 | ✅ | test | — |
| src/components/meetingPack/SupervisorBriefingCard.tsx | 274 | 🟡 | huérfano | briefing — sin page consumidora |
| src/components/meetingPack/SupervisorBriefingCard.test.tsx | 171 | ✅ | test | — |
| src/components/organic/ProcessClosePreviewCard.tsx | 108 | ✅ | organic UI | preview XP cierre |
| src/components/organic/ProcessClosePreviewCard.test.tsx | 56 | ✅ | test | — |
| src/hooks/useAgenda.ts | 143 | 🟡 | huérfano | hook agenda — 0 consumidores |
| src/hooks/useCulturePulse.ts | 137 | ✅ | CulturePulse.tsx | hook pulse |
| src/hooks/useMeetingPack.ts | 110 | 🟡 | huérfano | hook meetingPack — 0 consumidores |
| src/hooks/useRaciMatrix.ts | 158 | 🟡 | huérfano | hook RACI — 0 consumidores |
| src/pages/ComiteParitario.tsx | 705 | 🔴 | ruteada | write a `comite_actas`:73,111 SIN rule write → PERMISSION_DENIED; duplica CphsModule |
| src/pages/CulturePulse.tsx | 862 | ✅ | ruteada | page pulse (App.tsx:294,480) |
| src/pages/CulturePulse.test.tsx | 317 | ✅ | test | — |
| src/pages/FocusAgenda.tsx | 530 | 🟡 | ruteada | page agenda (OperationsRoutes:58); ¿usa useAgenda? no lo importa |
| src/server/routes/agenda.ts | 247 | ✅ | server.ts:1121 | 5 endpoints compute puro |
| src/server/routes/agenda.test.ts | 34 | 🟡 | test | sólo smoke de shape |
| src/server/routes/culturePulse.ts | 783 | ✅ | server.ts:1020 | pulse; ver ⚠️ audit re-id :655 |
| src/server/routes/culturePulse.test.ts | 27 | 🟡 | test | smoke shape |
| src/server/routes/meetingPack.ts | 206 | ✅ | server.ts:1140 | 3 endpoints compute puro |
| src/server/routes/meetingPack.test.ts | 32 | 🟡 | test | smoke shape |
| src/server/routes/organic.ts | 396 | 🟡 | server.ts:899 | leak err.message :81+; audit faltante en crews/process/tasks |
| src/server/routes/raciMatrix.ts | 236 | ✅ | server.ts:1112 | 6 endpoints compute puro |
| src/server/routes/raciMatrix.test.ts | 35 | 🟡 | test | smoke shape |
| src/services/agenda/agendaScheduler.ts | 168 | ✅ | route+hook | engine puro |
| src/services/agenda/agendaScheduler.test.ts | 138 | ✅ | test | — |
| src/services/comiteBackend.ts | 76 | 🟡 | gemini.ts:195-196 | JSON.parse sin try/catch :37,75 |
| src/services/cphs/cphsMinuteAutogenerator.ts | 315 | ✅ | cphsMinute.ts:108 | engine puro borrador mensual |
| src/services/cphs/cphsMinuteAutogenerator.test.ts | 210 | ✅ | test | — |
| src/services/cphs/cphsService.ts | 395 | 🔑 | CphsModule (client) | quórum+inmutab. en service; SIN ruta HTTP, sin audit_log |
| src/services/cphs/cphsService.test.ts | 365 | ✅ | test | cubre quórum/inmutab./firma |
| src/services/cphs/cphsService.xpHook.test.ts | 146 | ✅ | test | awardXp fire-and-forget |
| src/services/cphs/types.ts | 163 | ✅ | service | isValidQuorum DS54 :141 |
| src/services/culturePulse/safetyCulturePulse.ts | 175 | ✅ | route+hook | computePulseIndex puro |
| src/services/culturePulse/safetyCulturePulse.test.ts | 130 | ✅ | test | — |
| src/services/meetingPack/meetingPackBuilder.ts | 330 | ✅ | route+hook | engine puro |
| src/services/meetingPack/meetingPackBuilder.test.ts | 242 | ✅ | test | — |
| src/services/organic/crewService.ts | 170 | ✅ | organic.ts | helpers crew |
| src/services/organic/crewService.test.ts | 59 | ✅ | test | — |
| src/services/organic/processService.ts | 217 | ✅ | organic.ts | XP/transición puros |
| src/services/organic/processService.test.ts | 136 | ✅ | test | — |
| src/services/organic/taskService.ts | 81 | ✅ | organic.ts | helpers task |
| src/services/organic/taskService.test.ts | 53 | ✅ | test | — |
| src/services/raciMatrix/raciMatrixEngine.ts | 318 | ✅ | route+hook | engine puro RACI |
| src/services/raciMatrix/raciMatrix.test.ts | 436 | ✅ | test | — |
| src/types/organic.ts | 149 | ✅ | shared | tipos organic |

Colaterales 🔑: `firestore.rules:1085-1182` gate CPHS (correcto pero **sin
rules-tests**); `src/pages/CphsModule.tsx` (no-ledger) container Web-SDK del flujo
firma.

---

## 4. Para decisión del usuario (❓/⚠️)

1. ⚠️ **🔴 Falta total de rules-tests + Dirty Dozen para `cphs_meetings`/
   `cphs_committees`.** El gate de inmutabilidad 🔐 está bien escrito pero
   completamente sin verificar a nivel reglas. ¿Crear los ≥5 rules-tests
   (post-sign-update-deny, server-field-spoof-deny, etc.) + entrada en
   `security_spec.md`? Es el riesgo #1 del bloque.
2. ⚠️ **¿`ComiteParitario` vs `CphsModule` — cuál es canónico?** `comite_actas`
   no tiene rule de escritura → `ComiteParitario` graba contra default-deny
   (roto en prod). Decidir: deprecar/retirar la ruta `comite-paritario`, o
   escribirle reglas propias. Hoy hay dos features DS54 paralelos.
3. ⚠️ **Re-identificación de encuesta vía audit_logs** (`culturePulse.ts:655`):
   ¿aceptar el riesgo (modelo de amenaza = insider con read de audit_logs), u
   omitir el `userId` para esta acción específica / usar `responderHash` en el
   audit en vez del uid?
4. ⚠️ **cphsService sin ruta servidor**: constituir comité y firmar acta no
   pasan por servidor → **sin audit_log** (invariante #3) y la escritura de la
   firma la hace el cliente. ¿Migrar a `src/server/routes/cphs.ts` (writer
   único + audit), o aceptar el modelo client-side+rules?
5. ❓ **Hooks/engines huérfanos** (`useAgenda`, `useMeetingPack`, `useRaciMatrix`
   + sus cards): backend completo y testeado, sin UI consumidora. ¿Wire a
   página, o marcar como deuda de UI pendiente?
6. 🟡 Limpieza menor: `organic.ts` leak `err.message` (#8) + audit faltante en
   crews/processes/tasks; `comiteBackend.ts` `JSON.parse` sin try/catch (#5).
