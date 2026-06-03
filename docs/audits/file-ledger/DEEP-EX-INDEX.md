# Pasada exhaustiva línea-por-línea — Índice consolidado (DEEP-EX)

**Fecha:** 2026-06-03 · **Rama:** `claude/technical-debt-review-e2e-87kVX`
**Cobertura:** 41/41 lotes · **1.743 archivos FEAT leídos línea por línea** (~416k LOC)
**Detalle por lote:** `DEEP-EX-01.md` … `DEEP-EX-41.md` (cada uno con atestación N/N + tabla `Archivo:línea`).

> Esta pasada va **más allá de la capa crítica** revisada por bloque: leyó *todo*
> archivo FEAT, no solo el load-bearing. Resultado: **~45 hallazgos nuevos de
> severidad 🔴** que la revisión por bloque no detectó, organizados abajo en **17
> patrones sistémicos**. Los más graves fueron re-verificados por mí contra el
> código (grep). Doc-only.

---

## 0. Patrones sistémicos (la raíz se repite — arreglar la clase, no el síntoma)

### P1 🔴 — Colecciones escritas client-side SIN reglas Firestore → default-deny silencioso
El equipo ya conocía esta clase (`firestore.rules:365-372` documenta el fix de 14
colecciones Sprint-K, `TODO §17`), **pero el fix quedó incompleto**. La pasada
encontró ≥20 colecciones más en la misma trampa (write cliente + `.catch()` mudo →
el dato se pierde sin error). Tests `.firestore.test.ts` usan Admin SDK → **falso verde**.
- **Vida/seguridad:** `pings` (baliza de vida `useSurvivalPing`), `deas`/`inspections`
  (desfibriladores Ley 21.156), `clinical_alerts`, `findings` (Bio-Análisis),
  `control_validations` (controles críticos), `driving_incidents`, `read_receipts`
  (DS44/RIOHS), `calendar_events`, `reconstructions`/`reconstruction_jobs`/`placed_objects`
  (objetos de seguridad del gemelo: extintores/AED), `comite_actas`.
- **Datos sensibles/legal:** `health_vault`, `documents`, `workers/{id}/documents`,
  `personalized_plans`, `morning_checkins`, `slo_metrics`, `photo_evidence`,
  `positive_observations`, `site_book_counters`, `sitebook_crdt_drafts`.
- Refs: EX-02,04,07,11,15,17,20,21,22,23,26,27,38.

### P2 🔴 — Colas offline descartan datos de seguridad tras N reintentos (sin dead-letter)
- `sosOutbox.ts:160` (SOS se pierde tras 6 reintentos), `syncStateMachine.ts:313`
  ("data is being intentionally dropped" — incidentes/evidencia), `genericOutboxEngine.ts:248`
  (purga eventos `critical`). Refs: EX-03, EX-08.

### P3 🔴 — Identidad/rol/tenantId del cliente usados SIN verificar contra el token
- `sif.ts` `reviewedByUid`/`reviewedAt` del body (atestación SIF suplantable+back-date),
  `stoppage.ts:216` `resumedByRole` (reanudar paralización con rol auto-declarado),
  `exceptions.ts` `approvedByRole`, `suseso.ts`/`ds67ds76.ts` `tenantId` (DIAT/DIEP
  cross-empresa), `networkBackend.ts` `authorUid`, `microtraining.ts:187` `workerUid`
  (certificar a cualquiera), `visitors.ts` (sin assertProjectMember), `projects.ts`
  (claim global no project-scoped), `externalAuditPortal`, `Site25DPanel` tenantId 'default'.
- Refs: EX-09,10,12,16,19,22,23,26,31,37; DEEP-B11/B17.

### P4 🔴 — Firmas WebAuthn presence-checked pero NUNCA verificadas criptográficamente
La verificación real (`verifyAuthenticationResponse`) existe pero los consumidores no la llaman.
- DTE (`dte.ts:349` no llama verify), referee co-sign (`RefereeAccept.tsx:82`+`claims.ts:306`),
  biometría login (`utils/biometrics.ts:88`), aptitud médica (`medicalAptitude`),
  `kms-sign-rsa` (suseso). Refs: EX-13,23; DEEP-B6/B7/B17.

### P5 🔴 — Records firmados MUTABLES (gate chequea un campo que el writer no escribe) + tests falso-verde
- `site_book` y `lighting_audits` (DS594): la regla keya en `metadata.signedAt`/`signedAt`
  top-level, el código escribe `signature.signedAt` anidado o `signed` plano → el gate
  nunca dispara; el rules-test siembra el campo sintético. Refs: EX-20; DEEP-B9.
- **Contraste:** `cphs_meetings` SÍ lo hace bien (pivota sobre `signatures.size()`).

### P6 🔴 — Puntos ciegos del guard ADR 0012 (no-diagnóstico) con código de diagnóstico real colándose
`precommit-medical-guard.cjs` solo escanea `health/`+`medicine/`; deja fuera:
- `src/components/hygiene/VitalityMonitor.tsx` (mapea HR/temp a **CIE-10 T67.0 "golpe de calor inminente"**),
  `src/services/medicalAnalysisBackend.ts` (`differentialDiagnosis` con icd10/suggestedTreatment),
  `src/components/occupational-health/`, `psychosocialBackend.ts`, `shiftBackend.ts`. Refs: EX-04,06,28,30.

### P7 🔴 — Imágenes de cámara/trabajador a Gemini cloud pese a la directiva #12 (on-device)
- `BioAnalysis.tsx:411` (frame de cámara VIVA), `AIPostureAnalysisModal` (foto), `EPPVerificationModal.tsx:63`/`AIEPPScannerModal` (foto EPP). El detector on-device real existe pero no lo usan. Refs: EX-07, EX-24; DEEP-B3.

### P8 🔴 — Envenenamiento de RAG (tu core Zettelkasten): escritura de nodos globales sin gate
- `KnowledgeIngestion.tsx:60` (nodos `projectId:'global', isMasterNode:true`, regla solo exige authorId==uid),
  `networkBackend.ts:77` (whitelisted, `projectId||'global'` a `vector_store`),
  `ragService.queryCommunityKnowledge` (cachea salidas crudas de Gemini como autoritativas). Refs: EX-22,31,32.

### P9 🔴 — Auto-otorgamiento de gamificación por escritura directa (reglas restringen keys, no valores)
- `user_stats` (`firestore.rules:500`), `gamification_scores` (`:758`): `hasOnly([...])` no acota
  el valor → `points:999999`/`medals[]` desde devtools. `useGamification`, `ClawMachine`, `PoolGame`. Ref: EX-22.

### P10 🟡 — Datos falsos/estimados mostrados como reales
- `SloErrorBudget` (SLO sintético), `WeatherBulletin` (UV/AQI estimados como seguridad factual),
  `CQRSArchitecture` (demo in-memory como "live"), `dataConfidence.ts:302` (`inconsistenciesCount:0`
  → score 100 en el panel que advierte sobre datos malos), `Hygiene.tsx` (métricas hardcodeadas),
  `EmergencySquadManager` (escuadrón mock), `BlueprintViewer` (riesgos falsos ruteados). Refs: EX-01,05,22,34,37.

### P11 🟡 — `JSON.parse(response.text)` sin try/catch sistémico en los `*Backend.ts` (#5)
- medicine, psychosocial, suseso, legal, safetyEngine, shift, prediction, network. **Candidato a un solo codemod** (`parseGeminiJson`). Refs: EX-06,12,13,15,28,31,36.

### P12 🟡 — `Math.random()` en IDs en muchos componentes cliente (#15, fuera del scope del guard que solo cubre `src/server/`)
- ~15 superficies (incidentCommands, EquipmentAdminPanel, PreUseChecklist, GuardianVoiceAssistant, CostSimulator…). Refs: múltiples.

### P13 🟡 — Modelos SLM cargados desde CDN sin verificar integridad (sha256)
- Path vivo `loader.ts`/`slmAdapter` ejecuta pesos de HuggingFace sin `expectedSha256`, mientras `slmRuntime.ts` sí es fail-closed. Ref: EX-32.

### P14 🔴 — Job de réplica DR replica CERO filas en silencio (audit_logs + invoices)
- `firestoreCriticalReplicate.ts:154` filtra `createdAt` pero `auditServerEvent` escribe `timestamp`; invoices compara Timestamp vs epoch-ms → RPO incumplido; test congela el bug. Ref: EX-39.

### P15 🟡 — El cap global de gasto IA usa MemoryStore por-pod (cap real = réplicas × cap) → **relevante a ADR 0019**
- `geminiGlobalDailyLimiter` y los ~12 limiters de `limiters.ts` no reciben el store Firestore. Ref: EX-40.

### P16 🟡 — Stubs disfrazados que llegan al usuario (#13)
- `useShiftHandover` (acuse falso), `BlueprintViewer` (ruteado), `VigilanciaScheduler` (DEMO_EXAMS), `MockEppDetector` (prod), `EmergencySquadManager`. Refs: EX-01,04,22,24,27,37.

### P17 🟡 — Copy de cumplimiento mentiroso (promete audit/legal que no ocurre)
- `OperationalChanges.tsx:522` ("quedará en el audit log DS76+ISO45001" sin auditar), `TacticalOnboardingModal` (5 docs legales `signed` sin server). Refs: EX-22, EX-27.

---

## 1. Notas operacionales nuevas (no-patrón, pero importantes)
- 🟡 **Push de incidente CRÍTICO al CPHS no llega a dispositivos modernos** — `backgroundTriggers.ts:213` lee `fcmToken` singular legacy; el registro canónico escribe `fcmTokens` plural (regresión del bug H7). Ref: EX-40.
- 🟡 **`reportsAutomation` declara reportes "inmutables" con `contentHash` que nunca computa** (no-repudio incumplido). Ref: EX-36.
- 🟡 **`dataResidencyRequired` (CN/RU) es solo badge UI**, sin enforcement server. Ref: EX-41.
- 🟡 **`predictionBackend` usa `gemini-3.1-pro-preview` facturado a precio Flash** (sub-metering de costo; relevante a ADR 0019). Ref: EX-36.

## 2. Lo que aguantó el escrutinio línea-por-línea (sólido)
- **Billing/pagos** (EX-29): rails Webpay/MP/Khipu/IAP limpios. **Clúster cripto** (EX-41): AES-256-GCM, CloudKMS sin fallback, distributedLease con runTransaction. **Zettelkasten v2 core** (EX-33): writeNode delega al server con auth/audit. **Motores puros** (IPER/REBA/RULA/analítica): deterministas, sin I/O. **Aislamiento server** systemEvents/firestoreBridge/MCP. **observability** scaffolding honesto.

## 3. Para `TODO.md`
Estos patrones se elevan a **§2.33** (deuda de la pasada exhaustiva). Prioridad de
remediación: P1 (colecciones sin reglas) y P2 (colas que pierden datos) son las de
mayor impacto vida/cumplimiento y comparten causa raíz con el §17 ya conocido.
