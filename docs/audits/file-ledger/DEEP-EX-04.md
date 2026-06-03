# DEEP-EX #4 — B7-Salud [0:55] · 2026-06-02

**Atestación:** leídos 55/55 línea por línea. (Ninguno sin leer.)

Lote derivado: `ledger.json` filtrado `category` startsWith "FEAT" && `block=="B7-Salud"`,
ordenado por `path`, slice [0:55]. Va desde `src/components/ProjectHealthCheck.tsx`
hasta `src/hooks/useHygiene.ts` (componentes A–W + 7 hooks).

> **Veredicto del lote:** la mayoría son UI/cards presentacionales o hooks-cliente
> sobre endpoints server ya endurecidos (fatigue/circadian/hygiene/mentalLoad) →
> limpios. PERO aparecen **hallazgos NUEVOS no presentes en DEEP-B7**:
> (1) `VitalityMonitor` infiere diagnósticos CIE-10 ("agotamiento por calor probable",
> "golpe de calor inminente", "taquicardia") desde HR+ambiente y los persiste — roza
> ADR 0012 y está FUERA del scope del guard; (2) tres colecciones cliente-SDK
> (`clinical_alerts`, `personalized_plans`, `users/{uid}/morning_checkins`) sin reglas
> Firestore → escrituras default-deny rotas en runtime (misma clase que health_vault);
> (3) `VigilanciaScheduler` es un stub-disfrazado (DEMO_EXAMS hardcodeados con RUTs)
> cableado en producción sin flag/503/inventario; (4) `AptitudeCertificateForm` envía
> geolocalización del dispositivo a `api.open-elevation.com` (3rd-party); (5) la dead-UI
> diagnóstica de DEEP-B7 se amplía a `AnatomyLibrary` + `MedicalAnalyzer`
> (`generateMedicalIllustration`/`analyzeMedicalInjury` tampoco whitelisted).

## Hallazgos NUEVOS (no en DEEP-B7)

| Archivo:línea | Severidad | Hallazgo | Evidencia |
|---|---|---|---|
| `src/components/hygiene/VitalityMonitor.tsx:29-62,131` | 🔴 | **Inferencia diagnóstica prohibida (ADR 0012) + fuera del scope del guard.** `evaluateClinicalAlerts()` mapea HR sostenido/irregular + ambiente a códigos CIE-10 con rationale clínico tipo "Agotamiento por calor **probable** (T67.5)", "golpe de calor **inminente** (T67.0)", "Taquicardia sinusal o irregular (R00.0)" — es exactamente `assessClinicalRisk`/`inferDiagnosis` que ADR 0012 prohíbe. El componente vive en `src/components/hygiene/`, que NO está en `SCOPED_DIRS` del guard (`precommit-medical-guard.cjs:51-59` sólo cubre `health/`+`medicine/`) → el guard nunca lo escanea. Además NO renderiza `<MedicalDisclaimer/>`. | `VitalityMonitor.tsx:38-59` rationales "probable/inminente"; `precommit-medical-guard.cjs:51-59` SCOPED_DIRS |
| `src/components/hygiene/VitalityMonitor.tsx:131` | 🔴 | **Escritura de PII médica a colección sin reglas Firestore → default-deny (write roto) + sin audit.** `addDoc(collection(db,'projects/{pid}/clinical_alerts'), {cieCode, heartRateBpm, ...})` persiste biometría + código diagnóstico, pero `clinical_alerts` NO existe en `firestore.rules` (grep vacío). El master-gate `{subCollection=**}` sólo concede READ; el write cae a default-deny → silenciosamente falla (`logger.warn` lo traga). Misma clase de bug que rules.ts §365-372 documenta como "HALLAZGO CRÍTICO" pero esta colección quedó fuera. Viola CLAUDE.md #4 (sin reglas, sin rules-tests, sin Dirty Dozen, sin KMS) y #14 (no escribe `audit_logs`). | `VitalityMonitor.tsx:129-148`; `firestore.rules` sin `clinical_alerts` |
| `src/components/workers/PersonalizedSafetyPlan.tsx:60` | 🟡 | **Escritura cliente-SDK a `projects/{pid}/personalized_plans` sin regla Firestore → write default-deny roto.** `addDoc(collection(db,'projects/{pid}/personalized_plans'), {...})`. La colección no aparece en `firestore.rules`. El `try/catch` con `logger.error` enmascara el permission-denied → el botón "Guardar Plan" parece funcionar pero no persiste (el `addNode` posterior sí va por otra ruta). Mismo patrón del bloque "14 colecciones" §365 que ya se remedió, pero esta quedó fuera. | `PersonalizedSafetyPlan.tsx:55-90`; `firestore.rules` sin `personalized_plans` |
| `src/components/hygiene/MorningRoutine.tsx:60` | 🟡 | **`users/{uid}/morning_checkins` sin regla → write (y probe getDoc) rotos en runtime.** `persistMorningCheckIn` hace `setDoc(doc(db,'users',uid,'morning_checkins',date))`, pero bajo `match /users/{userId}` (`firestore.rules:228`) la ÚNICA subcolección con regla es `medical_exams`. El master-gate `{subCollection=**}` está dentro de `projects/`, NO de `users/` → `users/*/morning_checkins` cae al default-deny global (`:17`). El check-in nunca se guarda y el probe duplicado (`:142`) siempre falla silencioso. (Existe una regla `projects/{pid}/morning_checkins` en `:357`, pero el código escribe en `users/`, no en `projects/`.) Misma clase que health_vault en DEEP-B7. | `MorningRoutine.tsx:54-66,142`; `firestore.rules:228-249` vs `:357` |
| `src/components/medicine/VigilanciaScheduler.tsx:37-46` | 🟡 | **Stub-disfrazado en producción (viola CLAUDE.md #13).** `DEMO_EXAMS` son 8 trabajadores hardcodeados con RUTs y exámenes ficticios; el componente NUNCA recibe datos reales (no props, no fetch). Está cableado vivo en `Medicine.tsx:140` (`{activeTab==='vigilancia' && <VigilanciaScheduler/>}`) → el prevencionista ve un calendario de vigilancia médica FALSO sin saberlo. Sin `// TODO(sprint-N)`, sin feature-flag/503, sin entry en `docs/stubs-inventory.md` (grep vacío). | `VigilanciaScheduler.tsx:37-46`; `Medicine.tsx:140` |
| `src/components/medicine/AptitudeCertificateForm.tsx:59-67` | 🟡 | **Egress de geolocalización del trabajador a 3rd-party `api.open-elevation.com`.** `Geolocation.getCurrentPosition()` → `fetch('https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lng}')` envía coordenadas precisas del dispositivo a un servicio externo no controlado, client-side, sin consentimiento explícito ni proxy server. PII de ubicación sale del dispositivo (roza la directiva de soberanía de datos). | `AptitudeCertificateForm.tsx:59-67` |
| `src/components/medicine/AnatomyLibrary.tsx:127` · `src/components/occupational-health/MedicalAnalyzer.tsx:52,75` | 🟡 | **Amplía la "dead-UI diagnóstica" de DEEP-B7.** DEEP-B7 listó DifferentialDiagnosis/DrugInteractions como muertas (403). También lo están `AnatomyLibrary` (`generateMedicalIllustration`) y `MedicalAnalyzer` (`analyzeMedicalInjury` + `generateMedicalIllustration`): **ninguna** de esas 2 acciones está en `ALLOWED_GEMINI_ACTIONS` (`gemini.ts:119-204`) → 403. `MedicalAnalyzer` además produce salida diagnóstica ("requiresHospitalization", "specialistRequired", "estimatedRecovery") y vive en `src/components/occupational-health/` que tampoco está en el scope del guard. | `gemini.ts:119-204` sin `generateMedicalIllustration`/`analyzeMedicalInjury`; `MedicalAnalyzer.tsx:11-21` |
| `src/components/medicine/Ds109Modal.tsx:250` · `src/components/medicine/Ds67Modal.tsx:216` | 🔵 | **RUT plano en metadata del nodo Zettelkasten** (mientras el audit log sí lo hashea). `addNode({metadata:{workerRut: data.workerRut, ...}})` guarda el RUT en claro en el nodo de proyecto; el `logAuditAction` adyacente usa `hashRut()` correctamente (`:268`/`:231`). Inconsistencia: el audit protege el RUT pero el nodo persistido no. PII médica (diagnóstico + RUT) en claro en `nodes`. | `Ds109Modal.tsx:250,268`; `Ds67Modal.tsx:216,231` |
| `src/components/medicine/DifferentialDiagnosis.tsx` · `MedicalAnalyzer.tsx` | 🔵 | **Vistas diagnósticas sin `<MedicalDisclaimer/>`** (sólo `<p italic>` inline). ADR 0012 exige el componente. No las cubre el guard porque DifferentialDiagnosis vive en `medicine/` pero `VIEW_FILE_PATTERNS` del guard sólo matchea HealthVault (ya notado parcialmente por DEEP-B7), y MedicalAnalyzer vive en `occupational-health/` fuera de scope. | `DifferentialDiagnosis.tsx:338`; `MedicalAnalyzer.tsx` (sin import de MedicalDisclaimer) |
| `src/components/SunTrackerContainer.tsx:123-163` | 🔵 | **`Math.random()` en UI cliente decorativa** (posición de estrellas/glow). NO viola CLAUDE.md #15 (no es `src/server/` ni ID-generation), pero se anota: es no-determinista en SSR/tests. Cosmético, sin impacto de seguridad. | `SunTrackerContainer.tsx:118-167` |

## Confirmaciones relevantes (breve)

- **Guard-scope gap (ADR 0012) se confirma y AMPLÍA.** DEEP-B7 ya notó que el guard no
  cubre `*Backend.ts` raíz. Aquí se confirma que tampoco cubre `src/components/hygiene/`
  (VitalityMonitor) ni `src/components/occupational-health/` (MedicalAnalyzer) — ambos con
  contenido diagnóstico. `SCOPED_DIRS` sólo lista `health/`+`medicine/` (`:51-59`).
- **Dead-UI diagnóstica (Medicine.tsx):** confirmado que `generateMedicalIllustration`,
  `analyzeMedicalInjury`, `differentialDiagnosis`, `checkDrugInteractions` NO están en
  `ALLOWED_GEMINI_ACTIONS` → todas 403. (DEEP-B7 §2 ya lo marcó para Differential/Drug.)
- **Motores de vida (cards limminpias):** FatigueAssessmentCard, AlertnessGuard,
  MentalLoadSurveyForm, DocConfidenceCard, DocumentHygienePanel, OccupationalContextBundleCard,
  WorkerReadinessCard → todos presentacionales puros sobre motores deterministas, con
  disclaimer "asiste, no bloquea" donde corresponde (✅).
- **Biometría on-device (CLAUDE.md #12):** `useHealthMetrics`/`WearablesPanel` no hacen
  egress de frames/HR — leen de HealthKit/HealthConnect facade y el handshake BLE/Fit vive
  en Telemetry.tsx. NoiseMonitor/SensoryFatigueMonitor procesan audio 100% local (con aviso
  de privacidad explícito `NoiseMonitor.tsx:160`). ✅
- **Hooks-cliente (useCircadian/useFatigue/useHygiene/useAnnualReview/useAggregateTelemetry):**
  todos vía `apiAuthHeaders()` + endpoints server endurecidos; sin escritura directa Firestore;
  manejo de error sin filtrar internals. ✅
- **Telemetría/infra misfiled:** DigitalTwin/IoTEventsFeed/Wearables/Weather/Gamified/Webhook/
  twinStateMapper + RaciHealthCard/RiskNetworkHealth/ResilienceHealthDashboard/ProjectHealthCheck
  son IoT/system-health, no salud ocupacional (confirmado misfiled como dijo DEEP-B7).
- **DigitalTwin (R4):** buen ejemplo de remediación anti-stub — ya NO fabrica workers mock,
  muestra estado loading/empty/error honesto (`DigitalTwin.tsx:204-260`). ✅

## Archivos limpios: 43

(De 55: limpios los 43 presentacionales/hooks sin hallazgo propio. Con hallazgo NUEVO o
confirmación material: VitalityMonitor, MorningRoutine, PersonalizedSafetyPlan,
VigilanciaScheduler, AptitudeCertificateForm, AnatomyLibrary, MedicalAnalyzer, Ds109Modal,
Ds67Modal, DifferentialDiagnosis, SunTrackerContainer, + el guard `precommit-medical-guard.cjs`
referenciado.)
