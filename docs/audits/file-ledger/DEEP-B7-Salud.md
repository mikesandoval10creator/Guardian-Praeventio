# DEEP — B7 Salud ocupacional & Vigilancia · 2026-06-02

**Archivos revisados:** 183 del bloque B7 (abiertos/leídos los ~95 de producción
a fondo; tests + docs + datos verificados por cabecera/uso). Además se
incorporaron 4 archivos claramente de salud ocupacional que el heurístico dejó
sin bloque: `src/server/routes/returnToWork.ts`, `src/server/routes/workerReadiness.ts`,
`src/components/bio/CompensatoryExercisesModal.tsx`, `src/hooks/useDrivingSafety.ts`.

> **Veredicto global:** núcleo HealthVault + motores de vida (fatiga, circadiano,
> carga mental, higiene) tienen disciplina de privacidad y ADR 0012 ejemplar.
> PERO hay **3 hallazgos críticos**: (1) ausencia total de reglas Firestore para
> `health_vault` / `health_vault_shares` → la pantalla de gestión de shares está
> rota y se viola CLAUDE.md #4; (2) el módulo médico diagnóstico legacy
> (`DifferentialDiagnosis`/`MedicalAnalyzer`/`DrugInteractions`) sigue cableado en
> `Medicine.tsx` pero sus acciones Gemini fueron de-whitelisted → UI muerta que
> además contradice el ADR 0012 que ordenó retirarlas; (3) `Login.tsx` usa el
> helper biométrico débil `utils/biometrics.ts` que confía en una aserción local
> sin verificación server-side.

---

## 1. Lo que YA HACE (implementado y real)

### 1.1 HealthVault — bóveda médica soberana del trabajador (ADR 0012, Ley 20.584) ✅/🔴
Propósito: el trabajador es dueño absoluto; comparte con su médico vía QR temporal.
- **Token de compartición (pure)** — `src/services/health/vaultShare.ts:99` `createShareToken`,
  `:157` `consumeShareToken`, `:210` `revokeShareToken`. Secret de 24 bytes base64url
  (~144 bits), SHA-256 almacenado, `verifySecret` con `timingSafeEqual`
  (`vaultShare.ts:80`). TTL 1–168h, máx consumos default 5. ✅
- **Records (pure + Firestore CRUD)** — `src/services/health/vaultRecord.ts:88`
  `validateHealthRecord`, `:137` `saveHealthRecord` (escribe `users/{uid}/health_vault/{id}`).
  Nunca infiere; `type` incluye `diagnosis_note` sólo como contenedor de doc cargado. ✅
- **Endpoints** — `src/server/routes/healthVault.ts`: `POST /api/health-vault/share`
  (`:122`, verifyAuth), `GET /view/:tokenId/:secret` (`:193`, PÚBLICO + `healthVaultViewLimiter`
  30/min, `:69`), `POST /share/:tokenId/revoke` (`:305`). El consume usa
  `runTransaction` para cerrar el TOCTOU del límite de vistas (`:222`, cumple CLAUDE.md #19). ✅
- **Auditoría** — cada create/consume/revoke escribe `audit_logs` con `await`
  (`healthVault.ts:166,247,330`); `buildAuditEntry` no filtra el secret (`vaultShare.ts:228`). ✅
- **UI** — `src/pages/HealthVaultViewer.tsx:71` (médico, lee vía `/api/health-vault/view`,
  con `<MedicalDisclaimer/>`), `src/pages/HealthVaultShare.tsx` (trabajador genera/revoca
  vía server). 🔴 **pero la lista de shares activos se lee DIRECTO de Firestore**
  (`HealthVaultShare.tsx:60` `collection(db,'users',uid,'health_vault_shares')`) → ver §2.
- **Notas vida/privacidad:** secret jamás persistido en claro; IP hasheada SHA-256/16
  (`healthVault.ts:82`); 410 Gone para expired/revoked/max.

### 1.2 Salud nativa on-device — biometría 100% local (CLAUDE.md #12, ADR 0010) ✅
- **Facade selector** — `src/services/health/index.ts` (`getHealthAdapter`): Android→Health
  Connect, iOS→HealthKit, web→noop, legacy→Google Fit.
- **Adapters reales** — `healthConnectAdapter.ts:1` (`@kiwi-health/...`),
  `healthKitAdapter.ts:1` (`@perfood/capacitor-healthkit`). HR/steps/kcal/sleep.
- **Facade trimmed 4-métricas** — `healthFacadeNative.ts` (steps/HR/energy/distance).
- **Guard de turno (ADR 0010)** — `nativeHealthAdapter.ts:32` envuelve el facade y
  descarta toda muestra fuera del `ShiftWindow`; `shiftWindow.ts:36` `assertWithinShift`,
  `:88` `clampToShift`, `:116` `filterSamplesToShift`. "La vida del trabajador fuera
  de faena no es asunto de la empresa." ✅
- **Sin egress nativo:** HealthKit/HealthConnect no hacen `fetch`. **Excepción legacy:**
  `googleFitAdapter.ts:102` envía a `POST /api/fitness/sync` (server-mediado, OAuth en
  server) — está marcado `@deprecated` (sunset 2026), no es la ruta nativa. ✅

### 1.3 Motores de vida — deterministas, nunca bloquean maquinaria (directiva #2) ✅
Todos: ruta `verifyAuth` + `assertProjectMember` + `zod validate` + motor puro.
- **Fatiga** — `services/fatigue/fatigueMonitor.ts:assessFatigue` (DS 594 art.102,
  Ley 20.949), ruta `server/routes/fatigue.ts:64`. Sólo `shouldRestrictCritical`, no bloquea.
- **Circadiano** — `services/circadian/circadianRhythmService.ts` (classify/assess/rotation),
  ruta `server/routes/circadian.ts` (3 endpoints).
- **Carga mental (NASA-TLX)** — `services/mentalLoad/mentalLoadTracker.ts`, ruta
  `server/routes/mentalLoad.ts:79` (workerUid forzado al caller, §258-260).
- **Higiene/metabolismo** — `services/hygiene/metabolicRate.ts` (Mifflin-St Jeor,
  devuelve `null` si faltan datos, no inventa), ruta `server/routes/hygiene.ts`.
- **Higiene documental** — `services/documentHygiene/documentHygieneEngine.ts` (§287-290).
- **Fatiga de respirador** — `services/zettelkasten/bernoulli/respiratorFatigue.ts`
  (NIOSH 42 CFR Part 84, física Bernoulli).

### 1.4 Aptitud médica — la app transcribe, NO decide (ADR 0012) ✅
- **Generador** — `services/medical/aptitudeCertGenerator.ts:41` `fitnessVerdict`
  es `z.enum(['apto','apto_con_restricciones','no_apto'])` provisto por el médico;
  produce PDF (pdfkit) + JSON + SHA-256. **No** calcula aptitud.
- **Firma** — `services/medical/aptitudeCertSigner.ts` (WebAuthn challenge server-bound,
  single-use, embebe firma en JSON; módulo puro DI).
- **Ruta** — `server/routes/medicalAptitude.ts:68` (rol doctor/admin, sin egress a
  mutual/SUSESO — política CRITICAL explícita `:3-8`). Audit con `await` (`:90`).
- **Cliente PDF borrador** — `utils/aptitudeCertificate.ts` (jsPDF local).

### 1.5 Contexto ocupacional para el médico (ADR 0012 §"bibliotecario, no oráculo") ✅
- `services/health/occupationalContext.ts:111` `buildOccupationalContextBundle`:
  función pura, cero I/O, disclaimer literal-type obligatorio
  (`OCCUPATIONAL_BUNDLE_DISCLAIMER:71`), `triggeredByWork:null` preservado (nunca infiere).
- `components/health/OccupationalContextBundleCard.tsx`, `components/health/MedicalDisclaimer.tsx`.

### 1.6 Catálogos médicos estáticos (CC0) ✅
- `data/medical/diagnoses.json` (~70 CIE-10 SST), `drugs.json` (ATC), `anatomy.json`.
  Son catálogos de dominio público, NO motores de inferencia.
- Ruta lookup `server/routes/medicalCatalogs.ts` (sin LLM), hook `hooks/useMedicalCatalogs.ts`,
  rutinas ergonómicas deterministas `services/medical/bodyRoutineGenerator.ts`.

### 1.7 Vigilancia médica vía IA (whitelisted, vivo) 🟡
- `services/medicineBackend.ts`: `mapRisksToSurveillance:28`, `analyzeHealthPatterns:94`,
  `generateCompensatoryExercises:146` — **SÍ** en `ALLOWED_GEMINI_ACTIONS`
  (`gemini.ts:155,197,198`). `analyzeHealthPatterns` instruye "NO atribuyas causalidad
  laboral sin justificar" (`medicineBackend.ts:111`) → bordea ADR 0012 pero se mantiene
  en terreno de vigilancia epidemiológica poblacional, no diagnóstico individual. 🟡 confirmar.

### 1.8 Telemetría / wearables / system-health (heurístico misfiled) 🏚️ pero real
- IoT/telemetría operacional: `services/telemetry/{aggregator,eventCollector}.ts`
  (privacy-preserving, `assertNoPII`), `server/routes/{telemetry,aggregateTelemetry}.ts`
  (HMAC per-tenant). NO es salud ocupacional pero usa señales biométricas del WearablesPanel.
- Salud-de-sistema (infra, NO ocupacional): `server/routes/health.ts` (probe Cloud Run),
  `server/triggers/healthCheck.ts`, `server/jobs/runResilienceHealthAlert.ts`,
  `services/observability/resilienceHealthMonitor.ts`, `pages/SystemHealth.tsx`,
  `components/ProjectHealthCheck.tsx`, `components/observability/ResilienceHealthDashboard.tsx`,
  `components/risk-network/RiskNetworkHealth.tsx`, `components/raciMatrix/RaciHealthCard.tsx`,
  `services/systemEngine/zettelkasten/healthEvent.ts`.

### 1.9 Biometría de autenticación (WebAuthn) 🟡
- `hooks/useBiometricAuth.ts`: ruta robusta — challenge server-issued
  (`/api/auth/webauthn/challenge`), verify server-side `/api/auth/webauthn/verify`,
  fail-closed para `login`, single-use. ✅ Pero TODO pendiente: verificación CBOR de
  firma con `@simplewebauthn/server` aún no integrada (`useBiometricAuth.ts:59`). 🟡

---

## 2. Lo que está PENDIENTE (deuda de este bloque)

- 🔴 **Sin reglas Firestore para `health_vault` y `health_vault_shares`.**
  `vaultRecord.ts:144` escribe `users/{uid}/health_vault/{id}` y `healthVault.ts:162`
  escribe `users/{uid}/health_vault_shares/{id}`, pero `firestore.rules` SOLO define
  `users/{userId}/medical_exams/{examId}` (`firestore.rules:245`). Ambas subcolecciones
  caen al default-deny `match /{document=**} { allow read,write: if false }`
  (`firestore.rules:17`). Viola CLAUDE.md #4 (reglas explícitas + ≥5 rules-tests +
  entry en `security_spec.md` + KMS para colección médica/PII). **No existe ningún
  rules-test ni mención en `security_spec.md`** (grep vacío). Es la colección MÁS
  sensible de la app.
- 🔴 **Pantalla de gestión de shares ROTA en runtime.** `HealthVaultShare.tsx:60`
  lee `health_vault_shares` DIRECTO vía Firestore client SDK (`getDocs`), pero el
  default-deny devuelve permission-denied → el trabajador no puede ver/gestionar sus
  shares activos. Create/revoke funcionan (van por server con Admin SDK); el listado no.
  Fix: o agregar regla `allow read: if isOwner(userId)` o servir el listado vía endpoint server.
- 🔴 **Módulo médico diagnóstico legacy vivo en UI pero muerto en runtime + contra-ADR.**
  `Medicine.tsx:27,134,137,141` cablea `DifferentialDiagnosis`, `MedicalAnalyzer`,
  `DrugInteractions`. Estas llaman `differentialDiagnosis`/`analyzeMedicalInjury`/
  `checkDrugInteractions`/`generateMedicalIllustration` (`geminiService.ts:135-138`),
  exportadas desde `medicalAnalysisBackend.ts` (`differentialDiagnosis:138`,
  `analyzeMedicalInjury:53`) y re-exportadas por `geminiBackend.ts:1458`. **Pero NINGUNA
  está en `ALLOWED_GEMINI_ACTIONS`** → el dispatcher responde 403 (`gemini.ts:398`).
  Resultado: features dead. Además ADR 0012 (`docs/.../0012-...md:5,11,74,350`) ordenó
  explícitamente **retirar/refactorizar** `MedicalAnalyzer→HealthVault` y eliminar prompts
  "diagnose". Hoy el código diagnóstico (prompts "diagnóstico diferencial", "tratamiento
  sugerido", `suggestedTreatment`) sigue presente. TODO.md aún lo lista como feature XL
  futura (`TODO.md:1153,1378`) — contradicción doc-vs-código.
- 🔴 **`Login.tsx` usa el helper biométrico débil.** `Login.tsx:102` llama
  `verifyBiometric` de `utils/biometrics.ts:69`, que genera el challenge en cliente y
  retorna `true` ante cualquier aserción local exitosa, **sin** round-trip server ni
  verificación de firma contra la public key. Es exactamente el downgrade vector que
  `useBiometricAuth.ts` (la ruta endurecida) fue creado para cerrar. Login debería usar
  `useBiometricAuth` para flujos sensibles.
- 🟡 **`medicalAnalysisBackend.ts` / `medicineBackend.ts` fuera del scope del guard
  ADR 0012.** `precommit-medical-guard.cjs:51` `SCOPED_DIRS` cubre `src/services/health/`,
  `src/services/medicine/`, etc., pero NO `src/services/medicalAnalysisBackend.ts` ni
  `src/services/medicineBackend.ts` (viven en la raíz `src/services/`). Sus prompts
  diagnósticos y `suggestedTreatment` no se escanean. El guard tampoco escanea
  `components/medicine/DifferentialDiagnosis.tsx` (sólo `components/medicine/HealthVault.tsx`,
  `VIEW_FILE_PATTERNS:48`).
- 🟡 **WebAuthn sin verificación criptográfica de firma server-side** —
  `useBiometricAuth.ts:59` (TODO declarado): falta `@simplewebauthn/server` CBOR/signature;
  hoy el audit `auth.webauthn.verified` sólo atestigua consumo de challenge, no la firma.
- 🟡 **`analyzeHealthPatterns` (vigilancia epidemiológica IA)** roza el límite ADR 0012
  al pedir "patrones que sugieran brotes de enfermedades profesionales"
  (`medicineBackend.ts:108`). Mitigado por instrucción "NO atribuyas causalidad sin
  justificar tasa"; aún así conviene confirmar que opera sólo a nivel poblacional anonimizado.
- 🏚️ **Salud ocupacional sin bloque (heurístico):** `server/routes/returnToWork.ts`
  (§251-254, sólo trackea restricciones, nunca infiere — confirmado por su test),
  `server/routes/workerReadiness.ts` (906 LOC), `components/bio/CompensatoryExercisesModal.tsx`,
  `hooks/useDrivingSafety.ts`. Deberían reclasificarse a B7.
- 🏚️ **Telemetría/system-health misfiled en B7** (ver §1.8) — ~13 archivos que son
  infra/IoT, no salud ocupacional. Inflan el conteo del bloque.

---

## 3. Tabla por archivo (representativa — producción del bloque; tests/docs/datos agrupados)

| Archivo | LOC | Estado | Cableado | Propósito real + hallazgo file:line |
|---|---|---|---|---|
| src/services/health/vaultShare.ts | 257 | ✅ | server | Tokens QR; secret 144-bit, timingSafeEqual `:80`, audit `:228` |
| src/services/health/vaultRecord.ts | 202 | ✅ | server | CRUD `health_vault`; escribe subcol sin regla Firestore `:144` |
| src/server/routes/healthVault.ts | 344 | ✅ | mounted | share/view/revoke; runTransaction TOCTOU `:222`; limiter `:69` |
| src/pages/HealthVaultViewer.tsx | 244 | ✅ | route | Médico vía `/api/health-vault/view` `:71`; MedicalDisclaimer |
| src/pages/HealthVaultShare.tsx | 303 | 🔴 | route | Listado lee Firestore directo `:60` → default-deny lo bloquea |
| src/services/health/occupationalContext.ts | 888 | ✅ | service | Bundle puro p/ médico; disclaimer literal-type `:71`; no infiere |
| src/services/health/shiftWindow.ts | 125 | ✅ | service | Guard ADR 0010: datos fuera de turno descartados `:36` |
| src/services/health/nativeHealthAdapter.ts | 224 | ✅ | service | Wrapper shift-aware sobre facade; sin egress |
| src/services/health/healthFacadeNative.ts | 427 | ✅ | service | 4-métricas HK/HC on-device |
| src/services/health/healthConnectAdapter.ts | 411 | ✅ | service | Android Health Connect real `:1` |
| src/services/health/healthKitAdapter.ts | 265 | ✅ | service | iOS HealthKit real `:1` |
| src/services/health/googleFitAdapter.ts | 204 | 🟡 | service | DEPRECATED; egress `/api/fitness/sync` `:102` (legacy) |
| src/services/health/index.ts / types.ts | 118/107 | ✅ | service | Facade selector + tipos framework-free |
| src/services/fatigue/fatigueMonitor.ts | 140 | ✅ | route | DS594 art.102; sólo flag, no bloquea |
| src/server/routes/fatigue.ts | 86 | ✅ | mounted | verifyAuth+assertProjectMember+zod `:64` |
| src/services/circadian/circadianRhythmService.ts | 167 | ✅ | route | Ventana de alerta; determinista |
| src/server/routes/circadian.ts | 153 | ✅ | mounted | 3 endpoints, guard completo |
| src/services/mentalLoad/mentalLoadTracker.ts | 155 | ✅ | route | NASA-TLX §258-260 |
| src/server/routes/mentalLoad.ts | 136 | ✅ | mounted | workerUid forzado al caller `:89` |
| src/services/hygiene/metabolicRate.ts | 69 | ✅ | route | Mifflin-St Jeor; null si incompleto |
| src/server/routes/hygiene.ts | 116 | ✅ | mounted | guard completo |
| src/services/documentHygiene/documentHygieneEngine.ts | 267 | ✅ | service | §287-290 higiene documental |
| src/services/medical/aptitudeCertGenerator.ts | 356 | ✅ | route | Transcribe verdict médico `:41`; no decide; sin egress |
| src/services/medical/aptitudeCertSigner.ts | 199 | ✅ | route | WebAuthn challenge bound, single-use |
| src/server/routes/medicalAptitude.ts | 282 | ✅ | mounted | rol doctor/admin; sin push a mutual `:3` |
| src/utils/aptitudeCertificate.ts | 203 | ✅ | client | PDF borrador jsPDF |
| src/services/medical/bodyRoutineGenerator.ts | 370 | ✅ | service | Rutinas ergonómicas deterministas |
| src/services/medicalAnalysisBackend.ts | 284 | 🔴/🟡 | dead | differentialDiagnosis `:138`/analyzeMedicalInjury `:53` NO whitelisted → 403; fuera del guard |
| src/services/medicineBackend.ts | 208 | 🟡 | mounted | mapRisksToSurveillance/analyzeHealthPatterns/compensatory (whitelisted) |
| src/components/medicine/DifferentialDiagnosis.tsx | 348 | 🔴 | Medicine.tsx | Llama acción 403; contra ADR 0012 |
| src/components/occupational-health/MedicalAnalyzer.tsx | 309 | 🔴 | Medicine.tsx | Llama analyzeMedicalInjury (403); ADR ordenó rename→HealthVault |
| src/components/medicine/DrugInteractions.tsx | 347 | 🔴 | Medicine.tsx | Llama checkDrugInteractions (403) |
| src/pages/Medicine.tsx | 282 | 🟡 | route | Renderiza MedicalDisclaimer `:69` pero cablea 3 features muertas `:134-141` |
| src/server/routes/medicalCatalogs.ts | 283 | ✅ | mounted | Lookup CIE-10/ATC/anatomía sin LLM |
| src/data/medical/{diagnoses,drugs,anatomy}.json | 599/488/464 | ✅ | data | Catálogos CC0 estáticos, no inferencia |
| src/hooks/useBiometricAuth.ts | 536 | 🟡 | hook | WebAuthn server-bound; falta verificación CBOR `:59` |
| src/utils/biometrics.ts | 99 | 🔴 | Login.tsx | verifyBiometric local sin verify server `:88`; usado por Login `:102` |
| src/services/zettelkasten/bernoulli/respiratorFatigue.ts | 60 | ✅ | service | NIOSH 42 CFR 84, Bernoulli |
| scripts/precommit-medical-guard.cjs | 172 | 🟡 | husky | No cubre `src/services/*Backend.ts` raíz `:51` |
| src/components/health/MedicalDisclaimer.tsx | 112 | ✅ | shared | Disclaimer ADR 0012 |
| src/components/health/OccupationalContextBundleCard.tsx | 136 | ✅ | component | Bundle al médico |
| src/components/hygiene/* (Breathing/Nutrition/Noise/Vitality/...) | varios | ✅ | Hygiene.tsx | UI bienestar on-device |
| src/components/fatigue/FatigueAssessmentCard.tsx | 141 | ✅ | FatigueMonitor | Card fatiga |
| src/components/circadian/AlertnessGuard.tsx | 90 | ✅ | component | Guard de alerta |
| src/components/mentalLoad/MentalLoadSurveyForm.tsx | 152 | ✅ | component | NASA-TLX form |
| src/components/medical/MedicalIcon*.tsx, services/medical/iconLibrary.ts | varios | ✅ | shared | Bioicons CC0 (ADR 0003/0004) |
| src/pages/Hygiene.tsx / FatigueMonitor.tsx | 231/282 | ✅ | route | Páginas wireadas |
| src/routes/HealthRoutes.tsx | 28 | ✅ | router | hygiene/medicine/.../fatigue rutas |
| src/services/telemetry/{aggregator,eventCollector}.ts | 210/192 | ✅ | mounted | IoT telemetry privacy-preserving (misfiled) |
| src/server/routes/{telemetry,aggregateTelemetry}.ts | 257/178 | ✅ | mounted | Ingesta IoT HMAC (misfiled) |
| src/pages/{Telemetry,WearablesIntegration}.tsx | 735/691 | ✅ | route | Dashboards IoT/wearables (misfiled) |
| src/server/routes/health.ts, triggers/healthCheck.ts, jobs/runResilienceHealthAlert.ts | 344/109/171 | ✅ | mounted | System-health infra (NO ocupacional, misfiled) |
| services/observability/resilienceHealthMonitor.ts | 551 | ✅ | service | Resiliencia subsistemas (misfiled) |
| pages/SystemHealth.tsx, components/ProjectHealthCheck.tsx, observability/ResilienceHealthDashboard.tsx | 116/201/287 | ✅ | route | Infra health UI (misfiled) |
| **fuera de bloque (reclasificar a B7):** | | | | |
| src/server/routes/returnToWork.ts | 243 | ✅ | mounted | §251-254 trackea restricciones; nunca infiere (test ADR 0012) |
| src/server/routes/workerReadiness.ts | 906 | ✅ | mounted | Aptitud operacional pre-turno |
| src/components/bio/CompensatoryExercisesModal.tsx | 165 | ✅ | component | Pausas activas |
| src/hooks/useDrivingSafety.ts | 224 | ✅ | hook | Fatiga al volante |

*(Los ~88 archivos `*.test.ts(x)`, `.telemetry/*.md`, `docs/*`, `HEALTH_CONNECT_MIGRATION.md`,
ADRs 0003/0004/0012, `public/icons/biology/*.svg` y `scripts/generate-medical-icons.mjs`
del bloque fueron verificados; son tests reales, docs y assets — sin hallazgos de seguridad
salvo los ya citados.)*

---

## 4. Para decisión del usuario (❓/⚠️)

1. ⚠️ **`health_vault` / `health_vault_shares` sin reglas Firestore + sin rules-tests
   + sin entry en `security_spec.md`** (`firestore.rules:17,245`, `vaultRecord.ts:144`,
   `healthVault.ts:162`). Es la colección más sensible (Ley 20.584/21.719). Hay que:
   (a) decidir si el listado de shares se sirve por endpoint server o por regla
   `allow read: if isOwner`; (b) añadir las ≥5 rules-tests y la Dirty Dozen exigidas por
   CLAUDE.md #4; (c) confirmar política KMS para los `fileEncryptionKeyId` de records.
   **Decisión:** ¿abrir regla de lectura de owner (arregla `HealthVaultShare.tsx:60`) o
   mover ese listado a server-only?

2. ❓ **Módulo médico diagnóstico legacy (`Medicine.tsx` tab "diagnóstico"/"visor"/"fármacos").**
   El ADR 0012 (accepted, inviolable) ordenó retirarlo; las acciones Gemini ya fueron
   de-whitelisted (UI muerta), pero el código diagnóstico (`medicalAnalysisBackend.ts`,
   `DifferentialDiagnosis.tsx`, `MedicalAnalyzer.tsx`, `DrugInteractions.tsx`) y su
   referencia en `TODO.md:1153,1378` siguen vivos. **Decisión:** ¿borrar definitivamente
   (alinear con ADR) o re-whitelist como herramienta-para-el-médico con disclaimer
   reforzado? Hoy queda en limbo: ni funciona ni se eliminó.

3. ⚠️ **`Login.tsx:102` usa el helper biométrico débil `utils/biometrics.ts`.** Sin
   verificación server-side, un atacante con control del navegador puede forzar `true`.
   **Decisión:** migrar Login a `useBiometricAuth` (fail-closed, server-verify) y deprecar
   `utils/biometrics.ts`.

4. ❓ **Scope del `precommit-medical-guard.cjs`.** No cubre `src/services/medicalAnalysisBackend.ts`,
   `src/services/medicineBackend.ts` (raíz) ni `components/medicine/DifferentialDiagnosis.tsx`.
   **Decisión:** ampliar `SCOPED_DIRS`/`VIEW_FILE_PATTERNS` para cerrar el bypass del ADR 0012.

5. ⚠️ **WebAuthn sin verificación CBOR de firma server-side** (`useBiometricAuth.ts:59`,
   TODO declarado). El audit atestigua consumo de challenge, no criptografía. **Decisión:**
   ¿priorizar integración `@simplewebauthn/server` antes de GA?
