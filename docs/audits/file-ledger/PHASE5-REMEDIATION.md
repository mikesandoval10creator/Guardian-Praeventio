# Fase 5: Remediación de deuda técnica de Praeventio Guard (checklist por bloque)

> **Roadmap durable de ejecución.** Sintetiza la auditoría exhaustiva (cada
> archivo del repo leído línea por línea) en un plan accionable, un PR por
> bloque, vida/privacidad primero. Verdad de referencia: `TODO.md`
> §2.32/§2.33/§2.34 + los `DEEP-*.md` de este mismo directorio.

## Progreso ejecutado (actualizado 2026-06-04)

**Cimientos compartidos:** F1 harness rules-tests ✅ #657 · F2 parseGeminiJson ✅ #658 ·
F5-p1 governance ✅ #659 · **F3 identidad-desde-token ✅ #678** (`IDENTITY_STAMPED_ACTIONS`
estampa `req.user.uid` sobre `authorUid` antes del spread; + hardening args no-array/payload).
**F4 = bloque grande PENDIENTE** (firma = huella WebAuthn universal; la infra está completa
—verifier + challenge/credential store + helper cliente `webauthnComplianceSign`—; los gaps son
por-consumidor: CPHS (client-side, B12+F4), co-firmas currículum, medical-aptitude. Cada uno es
refactor cliente+server, alto riesgo → con foco fresco + `/cso-praeventio`).

**B1 Emergencia 🛟:** sosOutbox dead-letter + routing hazard-clearing ✅ #656 · ManDown push ✅ #671 ·
**EmergencySquadManager roster real ✅ #672** · **DynamicEvacuationMap → A\* real ✅ #673** (core puro
`src/services/routing/evacuationGrid.ts` = twin→grilla→A\* + `EvacuationGridMap` + cableado
`subscribeSiteGeometry`/`useGeolocationTracking`; reemplaza la narrativa Gemini) · **sensor leaks ✅ #675**
(useAccelerometer listener, SurvivalMode torch interval, useAcousticSOS flanco+histéresis). Reglas:
declare-emergency #660, DEA #661, pings #662. PENDIENTE B1: AlertScheduler probes reales,
FirstResponderDispatchPanel montar, Asesor.tsx prompt-injection.

**B7 Salud 🛟🔐 (ADR 0012):** VitalityMonitor sin CIE-10 ✅ #668 · clinical_alerts rule ✅ #669 ·
medical-guard ext (hygiene) ✅ #670 · **Medicine TRÍADA reconvertida ✅:** visor→`SymptomDocumenter`
#674 (documenta síntomas para el médico, no diagnostica) · diagnóstico→referencia CIE-10 #676 ·
fármacos→Vademécum #677 · medical-guard ext (occupational-health) #674. PENDIENTE B7: health_vault
(KMS), VigilanciaScheduler exámenes reales, medical aptitude (F4; hoy fail-closed 503).

**Reglas additive ✅:** control_validations #663 (B2) · documents #667 (B5) · read_receipts +
driving_incidents #664 (B6/B11) · personalized_plans/morning_checkins #665 (B7) · findings/placed_objects
#666 (B3/B-DigitalTwin).

**B14 IA/Gemini 🔐:** **networkBackend cross-tenant CERRADO ✅ #679** (`assertProjectMember` en
sync+delete, audit #3/#14, bloqueo de backlink cross-project, normalización projectId). RESIDUAL:
score-gate de nodos 'global'/comunidad (follow-up).

**Infra CI:** flaky hang **root-caused ✅ #680** (`anyRatchet` escaneaba `src/` 2-3× → fork
force-kill bajo carga → pool hang de 30min; ahora 1 scan a module-load + `testTimeout` alineado a CI).

**Método:** un PR por ítem, CI verde → merge (vigilante auto-merge), revisión adversarial
(`/cso-praeventio` vía subagente security-reviewer) en seguridad. Marcar acá + en `TODO.md` al cerrar.
**Recta final:** lo nuevo que salga se aborda de inmediato.

## Contexto
Praeventio Guard es una PWA de **prevención de riesgos para salvar vidas** en
industrias críticas, protegiendo la **privacidad** (Ley 19.628, biometría on-device,
audit trail). Una auditoría **exhaustiva línea por línea de todo el repo** (3.545
archivos; 103 docs en `docs/audits/file-ledger/`) confirmó que la app es
mayoritariamente **real y bien construida**, pero esconde **~45 hallazgos P0/P1 + 17
patrones sistémicos**. Esta fase **resuelve esa deuda, un PR por bloque**, en el orden
de la auditoría (vida y privacidad primero).

**Verdad de referencia** (en repo): `TODO.md` §2.32/§2.33/§2.34 · `DEEP-EX-INDEX.md`
· `DEEP-EXT-INDEX.md` · `INDEX-CONSOLIDADO.md` · `PHASE3-RECONCILIATION.md` · `DEEP-<bloque>.md`.
**Decisiones (usuario):** un PR por bloque · emulador Firestore disponible (verificar
rules-tests reales) · cimientos compartidos primero.

## ⭐ Principio rector — HACER REAL, no eliminar
**El objetivo es hacer real la aplicación de prevención: cada función del código se
considera y se CABLEA donde corresponde.** Reglas:
- **Huérfanos** (componentes/hooks/servicios sin consumidor) → **dárles hogar**: montar
  la página/menú/ruta, cablear al engine/endpoint real. NO borrar.
- **Mocks / datos hardcodeados / "demo"** → **cablear a datos reales**. NO borrar la pieza;
  reemplazar el dato falso por el real.
- **Stubs / NotImplemented** → **implementar y cablear**. NO borrar.
- **Duplicados** → **consolidar preservando TODAS las capacidades** (fusionar en el canónico,
  migrar lo que aporte el otro). NO borrar funcionalidad.
- **Excepciones (2, manejar con cuidado):**
  1. **Directiva legal/ética dura (ADR 0012 — no diagnóstico médico):** lo que infiere
     diagnóstico se **RECONVIERTE a función conforme** (transcribir el veredicto del médico,
     catálogos de referencia con `MedicalDisclaimer`, señales no-diagnósticas) y se cablea.
     **Nunca** se habilita inferencia diagnóstica; **nunca** se borra la pieza sin reconvertir.
     Marcar ❓ decisión de producto si el destino conforme no es obvio.
  2. **Decisión de arquitectura ya tomada (p.ej. COLMAP server-side → on-device §2.28):** el
     **reemplazo ES la función real**; se **documenta** la supersesión (no re-cablear lo
     contradicho, no borrar a ciegas — consultar antes de tocar `infra/` muerto).
- **Datos legales fabricados** (RUT falso, métricas inventadas) → exigir/cablear el dato
  **real**; jamás fabricar (esto SÍ es quitar el dato falso, no la función).

**Severidad:** 🔴 P0/P1 (vida/seguridad/legal) · 🟡 P2 (integridad) · 🔵 P3 (limpieza/cableado).
**Test:** `vitest`=lógica · `rules`=emulador `authenticatedContext` · `comp`=componente jsdom · `super`=supertest router real.

---

## Paso 0 (primer commit nueva sesión)
- [x] Copiar este plan a **`docs/audits/file-ledger/PHASE5-REMEDIATION.md`** (roadmap durable).
- [x] Añadir a **`CLAUDE.md`** la sección "Active work — Phase 5" (texto al final).
- [x] Commit `docs(phase5): remediation roadmap + CLAUDE.md pointer`.

## Fase 5.0 — Cimientos compartidos (hacer primero; reutilizables)
- [ ] **F1 Harness rules-tests REAL** — helper en `src/rules-tests/` con **solo
  `authenticatedContext`** (jamás Admin SDK), **falla si el emulador no arranca** (sin
  `if(!testEnv) return`), cubre los 5 casos Regla #4 (owner-allow/non-member-deny/
  schema-violation/post-sign-update-deny/server-field-spoof-deny). Arreglar
  `projectScopedStores.rules.test.ts` (silent-pass + siembra sintética de `signedAt`). (rules)
- [ ] **F2 `parseGeminiJson` + codemod (P11)** — `src/services/gemini/parseGeminiJson.ts`
  (try/catch + fallback tipado/502); aplicar a los `*Backend.ts` (medicine/psychosocial/
  suseso/legal/safetyEngine/shift/prediction/network). Reusar patrón de `medicalAnalysisBackend.ts`. (vitest)
- [ ] **F3 Identidad-desde-token (P3)** — endurecer dispatcher `/api/gemini`
  (`src/server/routes/gemini.ts:~430`): las acciones con identidad no confían `authorUid`/
  `projectId` del cliente; estampar `req.user.uid`+tenant; helper `assertCallerIdentity`. (super)
- [ ] **F4 Verify WebAuthn real (P4)** — consumidores llaman `verifyAuthenticationResponse`:
  `dte.ts:349`, referee (`claims.ts:306`/`RefereeAccept.tsx`), `Login.tsx`→`useBiometricAuth`,
  `medicalAptitude`, suseso `kms-sign-rsa`. (super/vitest)
- [ ] **F5 Gobernanza/CI** — cablear `precommit-stub-guard.cjs`(#13) y
  `precommit-allowbackup-guard.cjs`(#17) en `.husky/pre-commit`; **job CI** con `lint` +
  ratchets (no bypaseables con `--no-verify`); **reactivar e2e** `sos-button`/
  `process-lifecycle`/`offline-resilience` (quitar `describe.fixme`). (CI)

---

## Fase 5.1 — Bloques (un PR por bloque, en este orden)

### B1 — Emergencia & Respuesta 🛟  · ref `DEEP-B1` + `DEEP-EX-01/02/03`
- [x] `sosOutbox` dead-letter (HECHO).
- [x] `routingBackend.clearPointFromHazards` (HECHO).
- [ ] 🔴 `EmergencySquadManager.tsx:28` escuadrón mock → **cablear** a `useEmergencyBrigade(projectId)` real + estado vacío honesto (datos reales, no ficticios). (comp)
- [ ] 🔴 Declarar-emergencia falla en silencio: añadir `isEmergencyActive`/`activeEmergencyProtocol`/`emergencyStartTime` al `hasOnly` de `isValidProject` (o subcolección con reglas) — `EmergencyCheckIn.tsx:115`. (rules)
- [ ] 🔴 `pings` (baliza vida, `useSurvivalPing`) sin regla → reglas+tests+security_spec. (rules)
- [ ] 🔴 `deas`/`inspections` (DEA Ley 21.156) sin regla → reglas+tests. (rules)
- [ ] 🔴 ManDown sin push: **cablear** `useManDownDetection`→`triggerEmergency`+FCM + trigger server `mandown_events` (como FallDetection). (vitest/super)
- [ ] 🟡 `AlertScheduler` `probes={[]}` (`RootLayout.tsx:467`) → **cablear** probes reales (Bernoulli predictivo). (comp)
- [ ] 🟡 `DynamicEvacuationMap` usa Gemini no A* → **cablear** a `gridAStar`. (vitest)
- [ ] 🟡 `useAccelerometer.ts:47,90` leak listener; SurvivalMode torch `setInterval` sin clear (`:158`); `useAcousticSOS.ts:27` falsos positivos; `Asesor.tsx:25,32` prompt-injection. (comp/vitest)
- [ ] 🟡 `manDownTimer` un stage/tick; `buildPostmortem` >100%; training fecha-NaN vigente; `gemini/emergency.ts:185` JSON.parse (F2); `emergencyContextAdapter` void emit+Date.now → await+randomId. (vitest)
- [ ] 🔵 `FirstResponderDispatchPanel` huérfano → **montar/cablear** a datos reales.

### B7 — Salud ocupacional & Vigilancia 🛟🔐  · ref `DEEP-B7` + `DEEP-EX-04/05/06`
- [ ] 🔴 `VitalityMonitor.tsx:29-62,131` inferencia CIE-10 (ADR 0012) → **reconvertir** a alerta NO-diagnóstica conforme (señales HR/ambiente como recomendación de pausa/hidratación, **sin código CIE-10**) + `MedicalDisclaimer` + cablear a `clinical_alerts` con reglas. (comp)
- [ ] 🔴 Extender `precommit-medical-guard.cjs` SCOPED_DIRS a `hygiene/`+`occupational-health/`+`*Backend.ts` raíz. (vitest)
- [ ] 🔴 `clinical_alerts` (client-write) sin regla → reglas+tests. (rules)
- [ ] 🔴 `Medicine.tsx:134,137,141` MedicalAnalyzer/DifferentialDiagnosis/DrugInteractions → **reconvertir a función conforme ADR 0012** (transcripción del veredicto médico + catálogos CIE-10/ATC de referencia con disclaimer, NUNCA inferencia) y cablear acción Gemini whitelisted conforme. ❓ decisión de producto sobre el alcance. (comp)
- [ ] 🔴 `health_vault`/`health_vault_shares` sin reglas → reglas + ≥5 rules-tests + security_spec + KMS; `HealthVaultShare.tsx:60` listado → endpoint server. (rules)
- [ ] 🟡 `personalized_plans`(`PersonalizedSafetyPlan.tsx:60`) y `users/{uid}/morning_checkins`(`MorningRoutine.tsx:60`) sin reglas. (rules)
- [ ] 🟡 `VigilanciaScheduler` DEMO_EXAMS (`Medicine.tsx:140`) → **cablear a exámenes reales**; `Hygiene.tsx` métricas hardcoded → **cablear a métricas reales**. (comp)
- [ ] 🟡 `Login.tsx:10` biometría débil → `useBiometricAuth` (F4); `AptitudeCertificateForm.tsx:59` egress geo → on-device; `medicalAptitude` stub → implementar (F4). (super/vitest)
- [ ] 🔵 `AnnualReview.tsx:220` Math.random→randomId; `Ds109/Ds67` RUT en claro en nodo ZK→hash; `HealthVaultViewer.tsx:215` fileUri post-revocación; `telemetry_events`/`uv_exposures` scope; `medicineBackend.ts:81,139,202`+`psychosocialBackend.ts:68` JSON.parse (F2).

### B3 — Ergonomía & Protocolos MINSAL 🛟🔐  · ref `DEEP-B3` + `DEEP-EX-07`
- [x] 🔴 `BioAnalysis.tsx:411` frame de cámara VIVA a Gemini (#12) → **cableado al path on-device** (`ColorBasedEppDetector` + `inspectImage`; `src/services/bio/onDeviceBioReport.ts` puro + 7 tests). La imagen ya NO sale del equipo; `analyzeBioImage` de-whitelisted en `gemini.ts`. (Fase 5, 2026-06-05)
- [ ] 🔴 `BioAnalysis.tsx:465` `findings` sin regla + sin audit → reglas+audit. (rules)
- [x] 🟡 `AIPostureAnalysisModal.tsx` → análisis postural **100% on-device** (MediaPipe→REBA/RULA): se **retiró el fallback Gemini** que subía la foto del trabajador (decisión usuario: a la nube va el RESULTADO, no la imagen — privacidad). `analyzePostureWithAI` de-whitelisted. El crash de `bodyParts` desaparece (siempre lo llena MediaPipe). (Fase 5, 2026-06-05)
- [ ] 🔵 `prexor.ts:35` comentario 10dB stale; reba/rula 500→400; `pulmonaryErgonomics` escribe en render→effect; **corregir DEEP-B3** (protocols.ts SÍ expone tmert/prexor).

### B16 — Offline / PWA / Mesh / Sensores 🛟🔐  · ref `DEEP-B16` + `DEEP-EX-08`
- [x] 🔴 `syncStateMachine.ts:313` y `genericOutboxEngine.ts:248` descartaban datos de seguridad en silencio (give-up/TTL/maxRetries → `delete`) → **dead-letter (patrón sosOutbox B1)**: se retienen marcados `deadLettered`, dejan de reintentarse, se excluyen de `pending` y se exponen vía `deadLetters()` / `clearDeadLetter()`. Capacidad nunca evicta un dead-letter; el scheduler no hace busy-loop con dead-letters. +13 tests (40 en ambas suites). (Fase 5, 2026-06-05)
- [ ] 🟡 `conflictQueue.ts` (real, sin consumidor/reglas) → **cablear** (consumidor + reglas+tests). (rules/vitest)
- [ ] 🟡 `meshPacket.ts:237` firma `'unsigned-dev'` → firmar+verificar; `offlineStorage.ts` `encryptData` base64 → **cifrado real** (no llamarlo cifrado si no lo es). (vitest)
- [ ] 🔵 `useSyncStatus`/`SyncQueueBadge` huérfanos → **montar** (badge de cola en UI).

### B2 — Riesgo & IPER 🛟  · ref `DEEP-B2` + `DEEP-EX-14/15`
- [x] 🔴 `Matrix.tsx` banding ad-hoc P×S (4 sitios) → **cableado a `calculateIper` (DS44)**
  vía adapter canónico `iperCriticidad.ts` que preserva el contrato `criticidad` de 4 bandas
  (leído por ~10 módulos). `RiskMatrix5x5.severityForCell` (tercer esquema inline) →
  promovido a motor puro `iso31000Band.ts` (re-export delgado, back-compat). **Refinamiento
  del plan original** (decisión usuario 2026-06-05): DS44 e ISO 31000 **coexisten** como
  estándares de primera clase (no se colapsa ISO en DS44) — toggle por régimen vía
  `TenantRegulatoryContext` como follow-up. Documentado en **ADR 0020**. +14 tests puros.
  (Fase 5, 2026-06-05)
- [x] 🔴 `control_validations` (controles críticos) → **YA resuelto en #663** (doc-drift en esta línea):
  regla en `firestore.rules:505` (create con `validatedByUid==auth.uid`, update inmutable, delete admin/supervisor),
  6 rules-tests reales (`src/rules-tests/controlValidations.rules.test.ts`), Dirty Dozen `security_spec.md:152`. (Fase 5)
- [x] 🟡 `lineOfFireChecker.ts:124` match **por primera palabra → exacto** (frase completa normalizada;
  fail-closed para gate de bloqueo): "guardarropa" ya **no** limpia "guarda física en partes móviles".
  +regresión. · `safetyEngineBackend.ts:129` JSON.parse → **YA usa `parseGeminiJson`** (F2, doc-drift). ·
  `residualRisk.ts` `safeRead` → **surface error** (rethrow → 500; antes enmascaraba lectura fallida como
  lista vacía = falso "sin riesgos residuales"). +2 tests `_failReads`. (Fase 5, 2026-06-05)
- [x] 🔵 `useRiskRanking` 3 idle stubs → **implementar+cablear COMPLETO** (fuente canónica = Zettelkasten, ADR 0020 ext). Los 3 hooks son pull-hooks reales montados en `Risks.tsx`:
  - [x] **top-risks (backend)**: motor puro `riskNodeRanking.ts` (rankea `NodeType.RISK` por IPER DS44) + endpoint
    real `GET /api/insights/:projectId/top-risks` (lee `tenants/{tid}/zettelkasten_nodes`, no las colecciones planas
    vacías) + 12 tests. Hallazgo: el endpoint legacy leía colecciones que ningún writer puebla (dashboards vacíos).
  - [x] **top-risks (UI)**: `useTopRisks` cableado al endpoint real (`useEndpoint` con abort/refetch); `TopRisksWidget`
    reformado a `RankedRiskNode[]` (sin re-rank por contadores; dot por criticidad + score IPER); `TopRisksDashboardCard`
    pasa-through; **montado en `Risks.tsx`**. typecheck 0, lint 0, tests verdes. (Fase 5, 2026-06-05)
  - [x] **weak-controls (backend)**: motor puro `controlValidationAggregation.ts` (agrupa `control_validations` por
    controlId → verificaciones/fallas/overdue → `rankWeakControls`) + endpoint `GET /api/insights/:projectId/weak-controls`
    (lee `projects/{pid}/control_validations`, labels desde la biblioteca) + 12 tests. UI (hook+widget+montar) pendiente.
  - [x] **weak-controls (UI)**: `useWeakControls` cableado al endpoint real; `WeakControlsWidget` reformado a
    `ControlWeakness[]` (sin round-trip a ControlRecord; % falla + ícono de verificación vencida);
    `WeakControlsDashboardCard` pass-through; **montado en `Risks.tsx`** junto a top-risks.
  - [x] **timeseries (backend #693)**: motor puro `findingsTimeseries.ts` (agrupa `NodeType.FINDING` por día UTC,
    ventana móvil con gaps en 0, total+críticos) + endpoint `GET /api/insights/:projectId/risk-timeseries` + 9 tests.
  - [x] **timeseries (UI)**: `useRiskTimeseries` cableado al endpoint real; `RiskTimeseriesChart` **montado en `Risks.tsx`**;
    removidos `idleResult`/`NOOP` (ya no hay stubs). Los 3 rankings quedan reales end-to-end. (Fase 5, 2026-06-05)
  - [ ] `shiftRiskPanel` → **consolidar** con `preShiftRisk`: HALLAZGO — ya están consolidados a nivel de motor
    (ambos usan `composeShiftRiskPanel`); son complementarios (push `shift-risk-panel/compose` vs pull
    `pre-shift-risk` server-agregado, usado por `PreShiftRisk.tsx`). Residual = decisión de producto sobre el hook
    huérfano `useShiftRiskPanel` (pendiente input usuario).

### B17 — Admin / Auth / RBAC / Privacidad 🔐  · ref `DEEP-B17` + `DEEP-EX-09/10`
- [x] 🔴 `externalAuditPortal.ts` 4 endpoints admin (create/list/revoke/access-log) **sin gate de rol** (cualquier
  usuario autenticado del tenant podía crear/revocar portales de auditor externo = escalada de privilegios) →
  **`assertAdminCaller`** (`isAdminRole(customClaims.role)`, server-authoritative, espeja `admin.ts`). `resolveTenantIdForAdmin`
  ya acotaba al tenant propio (sin riesgo cross-tenant); el gap era puramente el rol. +7 supertests sobre el **router real**
  (403 no-admin en los 4, 200/201 admin). El test previo reimplementaba los handlers (anti-patrón wire-up). (Fase 5, 2026-06-05)
- [x] 🔴 `auditPortalStore.savePortal` token EN CLARO → **eliminado el path roto** (mejor que hashearlo): la investigación
  (pedida por usuario) probó que el path cliente estaba MUERTO — `findPortalByPublicToken` busca por `accessTokenHash` y
  rechaza rutas que no sean `tenants/…`, así que los portales escritos por `savePortal` (token en claro, `projects/{pid}/
  audit_portals`) eran **inutilizables** por el auditor. Fix: la página routeada `/audit-portals` ahora monta el manager
  CANÓNICO server-wired `PortalManager` (huérfano hasta hoy) que crea/lista/revoca vía `/api/audit-portal/*`
  (`useExternalAuditPortal`) — hashea el token + ruta verificable + gate de rol (#695). Se **retiró** `auditPortalStore.ts`
  (sin consumidores, footgun de token en claro). Supersesión documentada en `AuditPortals.tsx`. typecheck/lint 0.
  RESIDUAL: master-gate read (`firestore.rules:257`) que no exponga — sub-ítem de reglas, follow-up. (Fase 5, 2026-06-05)
- [x] 🔴 `projects.ts` claim global `gerente/admin` → membresía por-proyecto. **HECHO**: helpers `callerCanManageProject`/`callerIsProjectMember` (`src/server/routes/projects.ts:101-128`) consolidan los **4** bloques de auth duplicados (invite/list/remove/cancel); el privilegio de gestión deriva de `memberRoles[uid]` de ESTE proyecto + creador, **nunca de un claim global** — cierra el IDOR donde un `gerente` de cualquier proyecto gestionaba TODOS. Self-leave preservado. Reimplementación-disfrazada `test-server.ts:1031` sincronizada al mismo modelo. Tests reales `projects.router.test.ts`: gerente per-proyecto invita/remueve 200 · global-admin no-miembro 403 (regresión IDOR) · miembro sin rol 403 (45/45 verde). (super, 2026-06-06 · PR #700)
- [x] 🔴 `WebAuthnKeysSection.tsx:73` borrado MFA client-side → **RECONVERTIDO por directriz de producto/seguridad del usuario (2026-06-06): NO borrado self-serve**. Hallazgo al investigar: la UI leía/borraba `users/{uid}/webauthn_credentials` (subcolección fantasma) mientras el store canónico que gatea el login es el top-level `webauthn_credentials` (server-only) — sin regla Firestore → la lista Y el borrado ya estaban **muertos** (default-deny). Decisión del usuario: en una app de prevención, si roban el teléfono un ladrón NO debe poder borrar las llaves y dejar a la persona sin acceso/recuperación; el usuario puede **cambiar/rotar** (registrar nueva) o **recuperar**, nunca eliminar. Fix: (a) nuevo `GET /api/auth/webauthn/credentials` read-only (server, uid del token, sin `publicKey`) en `webauthnChallengeRouter` reusando `getCredentialsByUid`; (b) `WebAuthnKeysSection` reconectado al endpoint real + **botón Eliminar removido** + nota de protección anti-robo + se mantiene "Registrar nueva llave" (rotación); (c) tests: real-router `webauthnCredentials.router.test.ts` (401/uid-scope/no-publicKey/empty) + comp test "no self-delete affordance". (comp/super, 2026-06-06 · PR #701)
- [x] 🔴 WebAuthn **recuperación admin-asistida** (cierra el "recuperar" de la directriz anti-robo): `POST /api/admin/webauthn/revoke {targetUid, credentialId?}` admin-gated (`assertAdminCaller`) + audit (#3/#14) + revoca refresh tokens — un operador autorizado revoca la(s) llave(s) de un dispositivo perdido/robado en nombre del trabajador (un ladrón no es admin). `deleteCredentialById` agregado al store (única ruta de borrado, server-only). Razón de NO permitir self-delete con step-up: un teléfono robado DESBLOQUEADO pasa el step-up con su propia llave. Tests: store unit + `admin.router.test.ts` (401/403/400/200-una/404-cross-user/200-todas). (super, 2026-06-06 · PR #704)
- [~] 🔴 Reglas #650 (lote, parcial): ~~`documents_for_read` authorUid~~ **✅ ya tenía anti-spoof** (`firestore.rules:559-565`: create/update gatean `authorUid==auth.uid`/inmutable — resuelto en PRs additive previos); ~~`lone_worker_sessions`/`lone_worker_events` update sin owner-check~~ **✅ HECHO** (update ahora exige `existing().workerUid==auth.uid || isAdmin/Supervisor` — antes cualquier miembro del proyecto podía mutar la sesión de OTRO trabajador, p.ej. marcar a un trabajador en peligro como "safe"; +3 rules-tests por colección en `projectScopedStores.rules.test.ts`: otro-miembro→deny, dueño→allow, supervisor-rescate→allow; verificado por el job CI "Firestore rules tests" — el emulador no corre localmente, sin `firebase` CLI). PENDIENTE (sub-ítems, requieren investigación/decisión): `site_book_counters` sin regla (folios DS76); `root_cause_analyses` vs regla `root_causes` (mismatch de nombre — `rootCauseStore.ts`); `exceptions/legal_obligations/shifts` laxos (sin campo owner-uid confirmado — decisión de esquema, TODO `dahosandoval@` en `firestore.rules:566`). (rules, 2026-06-06 · PR #702)
- [ ] 🟡 ~~`pinSign` PinCredential del body→Firestore~~ **✅ hecho** (el surface era "stateless" y recibía la `PinCredential` COMPLETA en el body → un atacante fabricaba un hash para un PIN elegido y "verificaba", y reseteaba `consecutiveFailures:0` anulando el lockout. Ahora la credencial se persiste **server-side** en la colección top-level `pin_credentials/{projectId}__{workerUid}` (server-only, default-deny — NO subcolección de `projects/` para evitar el master-gate read que filtraría el hash a los miembros); `register` la escribe + audita; `verify`/`sign-item` la LEEN de Firestore (404 si no registrada) y persisten el contador en una `runTransaction`; el cliente ya no envía ni recibe la credencial (`usePinSign`/`PinSignModal` actualizados); `deleteCredentialById`-equivalente N/A. +audit `pinSign.register`/`pinSign.signItem` (#3/#14). 38 tests reescritos al modelo persistido, typecheck/lint 0, 2026-06-06 · PR #705); ~~`import.ts` assertProjectMember~~ **✅ hecho** (commit endpoint gateado con `assertProjectMember` — antes cualquier user escribía a cualquier projectId; +2 tests miembro/no-miembro. OBSERVACIÓN: `import.ts:338 tenantId = uid` escribe al namespace personal del caller — posible legacy/bug separado, no tocado); ~~OAuth refresh_token envelope default-ON~~ **✅ hecho** (`oauthTokenStore.envelopeEnabled()` ahora default-ON: el refresh_token se cifra con envelope salvo `OAUTH_ENVELOPE_ENABLED=false`; el read-path ya aceptaba plaintext-legacy + envelope → sin migración. Degradación elegante: si el adapter KMS no está disponible —p.ej. `cloud-kms` sin `KMS_KEY_RESOURCE_NAME`— loguea `oauth_envelope_adapter_unavailable` y cae a plaintext en vez de romper el flujo OAuth. +6 tests `oauthTokenStore.test.ts` (default-ON cifra, opt-out plaintext, degradación, round-trip unwrap, legacy plaintext); KMS_ROTATION.md actualizado, 2026-06-06 · PR #706); ~~`webauthnAssertion.ts:204` clone-detection~~ **✅ hecho** (bypass de anti-clon: la guarda `newCounter !== 0` permitía que un atacante con counter reportado 0 pasara aunque el counter almacenado fuera >0; corregido a `stored.counter > 0 && newCounter <= stored.counter` — alineado con el gate canónico de `curriculum.ts:866`; +4 vitest RED→GREEN, incluye el caso bypass; consumidores —suseso/sitebookSign/ds67ds76/medicalAptitude/aptitudeCertSigner— 91 tests verde, 2026-06-06 · PR #703); ~~`admin.ts:124,199` audit sin try/catch (#14)~~ **✅ hecho** (helper `safeAudit` aplicado a los **7** writes de `audit_logs` de admin.ts → fallo de auditoría no rompe la operación ya completada; +1 test directive-#14, 2026-06-05); ~~Math.random IDs (`PortalManager.tsx:521`)~~ **✅ hecho** (id de portal → `randomId()` crypto, #15, 2026-06-05). (super/vitest)

### B5 — Cumplimiento & SUSESO 🔐  · ref `DEEP-B5` + `DEEP-EX-11/12/13`
- [ ] 🔴 DTE firma WebAuthn nunca verificada (`dte.ts:349`) (F4). (super)
- [x] 🔴 `suseso.ts`/`ds67ds76.ts` tenantId del body → token (F3). **suseso.ts ✅ hecho** (helper compartido `src/server/auth/callerTenant.ts` `resolveCallerTenant`/`callerTenantOr403`: el tenantId ahora es autoritativo desde `req.user.tenantId` —estampado por `verifyAuth` del claim verificado—; si el body/query trae tenantId DEBE coincidir, si no 403 `tenant_mismatch`; sin claim → 403 `no_tenant_binding`. Antes un usuario del tenant A pasaba `tenantId:B` y creaba/firmaba/mutaba DIAT/DIEP del tenant B. Aplicado a los 4 endpoints autenticados —create/sign/submit/mark-submitted—. +tests cross-tenant 403 + token-stamped, 52 verde, typecheck/lint 0, 2026-06-06 · PR #707). **`ds67ds76.ts` ✅ hecho** (mismo helper `callerTenantOr403` aplicado a los **6** endpoints —ds67/ds76 create, pdf, sign—; tenantId del token, no del body/query; +4 tests cross-tenant/no-binding 403, 19 verde, 2026-06-06 · PR #708). (super)
- [ ] 🔴 `SusesoReports.tsx:419` RUT falso `12.345.678-9` → exigir RUT real (no fabricar dato legal). (comp)
- [ ] 🔴 `documents` y `workers/{wid}/documents` sin reglas → reglas+tests; `SusesoReports.tsx:143` "Guardado en Drive" falso → fix try/catch. (rules/comp)
- [ ] 🟡 `siiPreflightCheck` env names; `profiles.ts` régimen privacidad; `noopSiiAdapter` guard NODE_ENV; `mark-paid` → **activar tier**; **adapters SII LibreDTE/OpenFactura/SimpleAPI + `dteIssueQueue` → implementar+cablear** (no dejar stub). (super/vitest)
- [ ] 🟡 `generateSusesoFormMetadata` validar catálogo; legal-calendar "Marcar cumplida" → server+audit (#3); kms-sign-rsa verify (F4); thresholds CPHS≥25/Depto≥100. (vitest)
- [ ] 🔵 `susesoBackend`/`legalBackend` JSON.parse (F2); `committee_minutes`/`training_record` /emit stubs → **implementar generación PDF real** (#13); dte audit (#14)/err.message 5xx (#8).

### B12 — CPHS & Comités 🔐  · ref `DEEP-B12` + `DEEP-EX-18`
- [ ] 🔴 `comite_actas` sin regla de write (`ComiteParitario.tsx:73`) → regla; **consolidar** con `cphs_meetings` (un solo canónico, preservar capacidades). (rules)
- [ ] 🔴 `cphs_meetings:1175` append-only no preserva prefijo del array de firmas → preservar + ≥5 rules-tests + security_spec. (rules)
- [ ] 🟡 `cphsService` client-side sin audit (#3) → ruta server; `culturePulse.respondSurvey:657` audita userId → anonimizar/hash. (super/vitest)
- [ ] 🔵 `organic.ts` err.message (#8); `comiteBackend.ts:37,75` JSON.parse (F2); `useAgenda`/`useMeetingPack`/`useRaciMatrix` huérfanos → **montar**.

### B4 — Incidentes & Investigación 🛟  · ref `DEEP-B4` + `DEEP-EX-16/17`
- [x] 🔴 `sif.ts` `reviewedByUid`/`reviewedAt` del body → token (F3). **HECHO**: el endpoint `executive-review` de precursores SIF (lesión grave/fatalidad) estampaba el revisor y la fecha desde el BODY → un caller podía atribuir la revisión a otro ejecutivo y antedatarla. Ahora `reviewedByUid = req.user.uid` (token) y `reviewedAt = new Date().toISOString()` (reloj server); el schema solo acepta `reviewNotes`. +test real-router `sif.router.test.ts` (401/403-no-miembro/204-estampa-caller-ignora-body-forjado/404-sin-tenant), typecheck/lint 0, 2026-06-06 · PR #709. (super)
- [ ] 🟡 `incidentFlow.ts:77` `flowDepsFor` sin `createEdge` → grafo PDCA conectado; writeAudit shape → canónico. (vitest)
- [ ] 🟡 `root_cause_analyses` vs regla `root_causes`; `incidentPostmortem` audita a `tenants/{tid}/audit_log`→root; incidents path mismatch; `pdca.ts` /advance sin runTransaction (#19); `lessonsLearned` adoptionCount del body→server. (rules/super)
- [ ] 🔵 `incidentRagService.ts:299`/`incidentCommands` Math.random→randomId; custody appendEvent doc-id colisión; **CQRS in-memory → persistente** (cablear).

### B8 — Permisos de trabajo & LOTO 🛟  · ref `DEEP-B8` + `DEEP-EX-19`
- [ ] 🔴 LOTO write-path: `loto.ts:55` solo GET → **implementar+cablear** endpoints apply-lock/verify-zero-energy/release + adapter + audit + **montar** `LotoStatusPanel`. (super/comp)
- [ ] 🟡 `exceptions/legal_obligations/shifts` laxos (con B17); stoppage/softBlocking compute-only → persist+audit. (rules/super)
- [ ] 🔵 `exceptionFirestoreAdapter`/`stoppageFirestoreAdapter` (real, sin caller) → **cablear** al flujo.

### B9 — Inspecciones, Checklists & Observaciones  · ref `DEEP-B9` + `DEEP-EX-20/21`
- [ ] 🔴 `site_book` firmado mutable (gate `signedAt` top-level vs `signature.signedAt`, `siteBookSigning.ts:247`) → fix gate + **fix test falso-verde** (`projectScopedStores.rules.test.ts:181`). (rules)
- [ ] 🔴 `lighting_audits` mutable post-firma (`LightPollutionAudit.tsx:123`) → fix gate + `auditorUid==auth.uid`; SiteBook 3 paths disjuntos → unificar. (rules/super)
- [ ] 🟡 `photoEvidenceFirestoreAdapter.save` nunca escribe `linkageKeys` (queried) → fix; `photo_evidence`/`positive_observations`/`quota_usage`/`sitebook_crdt_drafts` sin reglas; `siteBookStore.nextSequenceForYear` no transaccional (folios DS76). (rules/vitest)
- [ ] 🔵 `iso_documents`/`iso_improvements` schema/audit+owner bug; qrSignature 500→503; `sitebookSignRoutes` assertProjectMember.

### B6 — Capacitación & Currículum  · ref `DEEP-B6` + `DEEP-EX-22/23`
- [ ] 🔴 `gamification.ts:35` auto-otorga puntos (amount del cliente) → whitelist/cota server. (super)
- [ ] 🔴 Referee co-sign WebAuthn nunca verificada (`RefereeAccept.tsx:82`/`claims.ts:306`) (F4). (super)
- [ ] 🔴 `read_receipts` (DS44/RIOHS) sin regla → reglas+tests; `microtraining.ts:187` `grantCert(body.workerUid)` → callerUid (F3). (rules/super)
- [ ] 🟡 `trainingCertificate` sobre-afirma legal → **añadir firma/QR/hash verificable**; training root client-write; `gamificationBackend` field-path injection; `onboarding.ts:268` audit (#14). (vitest)
- [ ] 🔵 `PublicNodeView` colección `zettelkasten` huérfana → cablear; **7 hooks + 5 componentes huérfanos → montar** (microtraining/spacedRep/skillGap…); duplicación pyme → **consolidar**.

### B10 — EPP, Activos & Mantenimiento  · ref `DEEP-B10` + `DEEP-EX-24/25`
- [ ] 🟡 `horometerEngine.ts:69,117` lógica de bloqueo contradice directiva #2 → **reconvertir a ADVERTENCIA** (no bloqueo) y cablear su consumidor honestamente. (vitest)
- [ ] 🟡 `eppFlow.ts:240` órdenes en Map volátil → store durable; order-pdf sin `signedNodeId`; `EPPVerificationModal.tsx:63` foto a Gemini (#12) → on-device; eppFlow WebAuthn TODO server (F4). (vitest/comp)
- [ ] 🔵 `maintenanceScheduler.completeMaintenanceTask` RMW sin runTransaction (#19); montar UIs admin EPP huérfanas.

### B11 — Contratistas, Visitas & Acreditación  · ref `DEEP-B11` + `DEEP-EX-26`
- [ ] 🔴 `visitors.ts:112` sin `assertProjectMember` → añadir (F3); `driving_incidents` (`SafeDriving.tsx:94`) sin regla → reglas. (super/rules)
- [ ] 🟡 colisión ruta `safe-driving` → resolver (ambos componentes cableados a su ruta); `ClimateRoutes:215` botón "Calcular Ruta" → **cablear** al cálculo real. (comp)
- [ ] 🔵 `resolveObservation` → **exponer/cablear UI**; DS76 duplicado → **consolidar**; stack `visitor_accesses` → **cablear o consolidar** en el canónico.

### B13 — MOC & Operaciones críticas  · ref `DEEP-B13` + `DEEP-EX-27/28`
- [ ] 🔴 UI MOC/handover escribe por store cliente sin audit (`OperationalChanges.tsx:46`) → **re-cablear a endpoints auditados** (o trigger server) (#3). (super)
- [ ] 🟡 `shiftHandover` compute-only + adapter huérfano (#606) → **cablear** persist+audit; acuse mutable (rules:475) → post-sign deny; `shiftBackend.ts:66` JSON.parse (F2). (super/rules)
- [ ] 🔵 `changeMgmt` → **consolidar** en `operationalChange` (preservar capacidades); `continuity`/`criticalRoles` UI huérfana → **montar** (SpofPanel, CriticalRoleCoverageCard).

### B14 — IA / Gemini / SLM & Copilots 🔐  · ref `DEEP-B14` + `DEEP-EX-30/31/32/33`
- [ ] 🔴 `networkBackend.ts:41,77` RAG-poisoning + cross-tenant → F3 + scope (`vector_store` por tenant). (super)
- [ ] 🔴 `KnowledgeIngestion.tsx:60` nodos global/master sin gate; `ragService.queryCommunityKnowledge` self-poisoning → score-gate+audit. (super/vitest)
- [ ] 🟡 SLM integridad: `loader.ts` pesos CDN sin sha256 → verificar como `slmRuntime.ts`; `onnxAdapter` tinyllama → **corregir registry**; `searchRelevantContext` fallback hardcoded → **cablear** a `safeNormativeQuery` real. (vitest)
- [ ] 🟡 SLM offline OFF + Phi-3/Gemma CDN → **bundlear** modelos; `resilientAiOrchestrator` flag OFF → **encender** (ADR 0019); `designHazmatStorage` export collision → cablear versión RAG; 6 JSON.parse (F2). (vitest)

### B15 — Facturación, Suscripciones & Tier-gating 🔐  · ref `DEEP-B15` + `DEEP-EX-29`
- [ ] 🔴 Tier-gating por-feature solo client-side (`SubscriptionContext.tsx:64`) → middleware server (#11). (super)
- [ ] 🟡 `mark-paid` → **activar** `users/{uid}.subscription`; Khipu sin checkout → **implementar endpoint**; Apple SSN leaf-only → chain verify; `BILLING_TIER_FALLBACK` añadir `global-titanio`. (super/vitest)
- [ ] 🔵 `runB2dMrrSnapshot` job huérfano → **cablear** (scheduler/endpoint).

### B18 — Analítica / Reportes / Dashboards  · ref `DEEP-B18` + `DEEP-EX-34/35/36`
- [ ] 🟡 `dataConfidence.ts:302` `inconsistenciesCount:0` → **cablear cómputo real**; `SloErrorBudget`/`WeatherBulletin`/`CQRSArchitecture` dato falso → **cablear a datos reales**. (comp/vitest)
- [ ] 🟡 `insights.ts` colecciones top-level sin tenantId/regla → scope; `portableHistory.ts:231` fallback PII cross-tenant; `environmentBackend.client` API key en navegador → **proxy server**. (super/rules)
- [ ] 🔵 `reportsAutomation` `contentHash` → **computar**; `predictionBackend` metering Pro/Flash; `assertNoPII` → **cablear**; AlertScheduler probes (con B1).

### B-DigitalTwin (bloque nuevo)  · ref `DEEP-NH-services-infra` + `DEEP-EX-37/38`
- [ ] 🔴 `reconstructions` storage default-deny (`storage.rules:159`); `reconstruction_jobs` sin regla (vs `digital_twin_jobs` fantasma); `placed_objects` sin regla (objetos de seguridad no persisten) → reglas+tests. (rules)
- [ ] 🔴 `pages/BlueprintViewer.tsx` mock ruteado (#13) → **cablear la ruta a la versión real** (upload+Firestore de AIHub); `verifyTwinStepUp.ts` no cableado (ADR 0011) → **cablear**. (comp/super)
- [ ] 🔵 COLMAP infra: **NO eliminar a ciegas** — documentar como superseded por on-device (§2.28, que es la función real); consultar antes de tocar `infra/`.

---

## Fase 5.2 — Cross-cutting config/seguridad (bajo riesgo, intercalable temprano)
- [ ] 🔴 **Dominio/WebAuthn**: unificar `praeventio.app` (manifest/AASA/assetlinks) vs `app.praeventio.net` (server/WebAuthn) + `WEBAUTHN_RP_ID`/`WEBAUTHN_RPID` → un dominio canónico (passkeys+deep-links).
- [ ] 🔴 **iOS mesh `CBUUID` inválido** (`packages/capacitor-mesh/ios/.../Plugin.swift:34`) → replicar mapeo no-hex→hex de Android (interop BLE).
- [ ] 🔴 **`render-well-known.mjs:31`** cert Play hardcodeado → exigir `ANDROID_CERT_SHA256` fail-closed.
- [ ] 🔴 **DR replication** (`firestoreCriticalReplicate.ts:154` `createdAt`→`timestamp`; invoices Timestamp) + fix test falso-verde. (vitest)
- [ ] 🔴 **voseo es-AR en `es/common.json`** (`Reintentá`/`Seleccioná`/`vos sos`) → "tú" chileno (Regla #2).
- [ ] 🟡 **Cap de gasto IA por-pod** (`limiters.ts` MemoryStore) → store Firestore (ADR 0019).
- [ ] 🟡 **Gemini ADR 0019** (track): Vertex paga + orquestador resiliente ON + ruteo Flash + RAG-first + budget por tier.

## Fase 5.3 — Doc-drift sweep (bajo riesgo, intercalable)
- [ ] Actualizar: `ARCHITECTURE.md` (LOC/refs #20), `stubs-inventory.md` (mesh real + SystemEngine montado), `CLAUDE.md` (#13/#17), runbooks photogrammetry (superseded), `TRACKING_PLAN.md` (analytics impl), `BERNOULLI_EXTENSIONS.md` (16 motores), `gemini-split-plan.md`, `ADR 0013` (UUID mesh), `ADR 0005/0006` superseded, links rotos terraform/README.

## Track transversal — Calidad de tests (intercalar con cada bloque)  · ref `DEEP-EXT-INDEX`
- [ ] **Reescribir** los 144 tests "wire-up contract" de `src/server/routes/*.test.ts` para que ejerciten el router real (supertest), o asegurar companion en `__tests__/server/`.
- [ ] **Reescribir** la reimplementación-disfrazada (auditCoverage/mercadoPagoIpn/telemetry/webauthnVerify/externalAuditPortal/suseso/visitors…) para importar la ruta real.
- [ ] **Reescribir** tautologías "ID crypto contract" y mock-the-SUT (ragService/MorningRoutine). (No borrar tests; corregir que prueben código real.)

---

## Convenciones (no violar)
- **TDD estricto** RED→GREEN→REFACTOR; tests que ejercitan **código real** — prohibido: Admin-SDK en rules-tests, sembrar el campo del gate, reimplementar el handler en el test, tests "wire-up" solo `router.stack` (catálogo en `DEEP-EXT-INDEX.md`).
- **Hacer REAL, no eliminar** (ver Principio rector): huérfanos→montar, mocks→datos reales, stubs→implementar, duplicados→consolidar; ADR 0012→reconvertir; nada se borra sin consultar.
- Cada cambio de estado escribe `audit_logs`; el servidor estampa uid/tenant del token.
- Nueva colección = reglas explícitas + ≥5 rules-tests (`authenticatedContext`) + Dirty Dozen en `security_spec.md`.
- **Actualizar `TODO.md`** (resuelto con `file:line`) al cerrar cada ítem. **Un PR por bloque**; reusar utilidades existentes.

## Verificación (cada fix, antes de PR)
- `npx vitest run <test>` verde y que **falle sobre la impl vieja** (RED real).
- `npm run test:rules` (emulador, `authenticatedContext`) verde · `npm run typecheck` → 0 · `npm run lint` limpio · pre-commit PASS · copy es-CL "tú" · sin secretos.
