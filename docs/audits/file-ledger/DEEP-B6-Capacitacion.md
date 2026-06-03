# DEEP — B6 Capacitación & Currículum · 2026-06-02

**Archivos revisados:** 122 (todos los del bloque `B6-Capacitacion` en `ledger.json`; ~27.952 LOC). Lectura a fondo de los 14 server-routes + 18 servicios/engines + utils, y verificación de cableado (mounting + consumidores de hooks/componentes) por grep.

---

## 1. Lo que YA HACE (implementado y real)

- **Currículum portátil con co-firma de referees (flagship).** `src/server/routes/curriculum.ts` + `src/services/curriculum/claims.ts`. Worker crea claim firmado → 2 referees reciben magic-link (token 256-bit, solo `sha256(token)` en Firestore — `refereeTokens.ts:34-45`), co-firman dentro de 14 días, claim pasa a `verified` cuando ambos firman (`claims.ts:310-318`). Audit en cada transición. Lazy-expiry, rotación de token en `/resend`, dedupe de emails de referee, rate-limit por token. Montado en `server.ts:1312`.
- **WebAuthn REAL (registro + verificación criptográfica).** `curriculum.ts:721-1089` usa `@simplewebauthn/server`: `/webauthn/register/options|verify` (atestación real, persiste public key vía `registerCredential`), `/webauthn/verify` valida firma contra la public key registrada (`verifyAuthenticationResponse`, `curriculum.ts:822-846`), enforce `requireUserVerification`, **replay-prevention de doble capa** (challenge single-use + contador monotónico `curriculum.ts:866`), y `expectedOrigin` resuelto en boot con fail-fast en prod si no es https (`curriculum.ts:90-117`). Esto es WebAuthn de verdad, no teatro.
- **Microcapacitación relámpago.** `lightningTrainingService.ts` catálogo determinístico de 6 módulos (altura, eléctrico, hazmat, ergo, líneas de fuego, confinado) con quizzes y umbral 80%. Route `microtraining.ts` **puntúa server-side** (`scoreSession`, nunca confía score del cliente — `microtraining.ts:166-177`), certifica al aprobar, persiste vía adapter DI, audita.
- **Engines puros, bien gateados (verifyAuth + assertProjectMember + zod validate + audit):** postTraining (Ebbinghaus + case-study match), skillGap (brechas/plan/polivalencia/sustitutos), spacedRepetition (SM-2), safetyTalks (suggester por señales de contexto), portfolioLessons (transferencia entre proyectos), vendorOnboarding (acreditación/escalamiento), pymeOnboarding (madurez + plan 30 días). Los 13 services verificados son **puros** (DI, sin IO directo).
- **Aprendices + mentoría (§244-250).** `apprenticeship.ts` con cap mentor=3 fail-closed (`:171-184`), `runTransaction` en authorize/expose (CLAUDE.md #19, `:262`/`:409`), nivel global derivado del MÁXIMO de autorizaciones, audit-trail en subcolección. Page `Apprenticeship.tsx` cableada (App.tsx:310).
- **Onboarding self-service de tenant.** `onboarding.ts` transaccional-ish, idempotencyKey, valida industry/country/tier contra sets cerrados, mantiene pago pendiente para tiers pagos (no auto-upsell), audita.
- **Bundle de ingreso a faena (ODI/DDR/RIOHS).** `faenaOnboardingBundle.ts` con plantilla estándar (contrato, examen, inducción, DDR, EPP, RIOHS, política) y derivación de status + conversión observación→acción correctiva.
- **Gemini de capacitación whitelisted.** `generateTrainingQuiz` y `generateCustomSafetyTraining` están en `ALLOWED_GEMINI_ACTIONS` (`gemini.ts:164,180`) y exportados desde `geminiBackend.ts`; consumidos por `NormativeQuiz.tsx` y `Training.tsx`.
- **Gamificación solo-positiva (a nivel de tipos).** `positiveXp.ts` es el chokepoint con `XpReason` cerrado y sin `decrementXp`; medallas como condiciones puras.

## 2. Lo que está PENDIENTE (deuda de este bloque)

- **🔴 `/api/gamification/points` confía en `amount` y `reason` del cliente sin validación.** `gamification.ts:35-50` pasa `amount`/`reason` directo a `gamificationBackend.awardPoints` (`gamificationBackend.ts:3,11,20`) — **sin cota, sin whitelist de reason, sin RANK**. El cliente (`gamificationService.ts:27-35`) envía `overrideAmount` verbatim. Un worker puede auto-otorgarse puntos arbitrarios → falsea leaderboard y desbloquea medallas (`checkMedalEligibility` ≥150 pts). El chokepoint `positiveXp.awardXp` (con `XpReason` cerrado) **se bypassa por completo** en esta ruta.
- **🟡 XP de capacitación nunca cableado.** `training_module_completed` (25 XP) registrado en `organic.ts:127,146` pero **sin emisor**. TODO explícito en `claims.ts:1-10`: no existe `completeTrainingModule(uid,moduleId)`. `microtraining.ts` emite solo `auditServerEvent`, no XP. El curriculum agrega `training.*.completed` desde audit_logs (`historyAggregator.ts:81`) pero solo `WebXR.tsx:132` emite ese evento.
- **🟡 6+ features backend-completas pero UI-huérfanas.** Hooks con **cero consumidores** en pages/componentes: `useMicrotraining`, `useSpacedRepetition`, `useSkillGap`, `usePostTraining`, `useVendorOnboarding`, `usePymeOnboarding`, `usePortfolioLessons`. Componentes sin montar: `PymeOnboardingPlanPanel`, `OnboardingTrackProgressPanel`, `SpacedRepetitionReviewQueue`, `ApprenticeshipBoard`, `AssignedMicrotrainingCard` (auto-referencia, no montado → `LightningTrainingPlayer` queda inalcanzable). Engines+routes+tests existen; falta la última milla de UI.
- **🟡 Duplicación pyme.** Dos stacks paralelos: `pymeOnboarding/*` (route `pymeOnboarding.ts`, hook `usePymeOnboarding`, panel `pymeWizard/PymeOnboardingPlanPanel`) **y** `pymeWizard/*` (route `pymeWizard.ts`, hook `usePymeWizard`, `pymeOnboarding/PymeMaturityWizard`). Naming cruzado y competidor — riesgo de drift.
- **⚠️ Co-firma de referee NO verifica criptográficamente la firma.** `curriculum.ts:558-637` acepta `signature` (≤1024 chars) y `method:'webauthn'|'standard'` pero los **almacena opacos** (`claims.ts:306`) sin validarlos. La barrera real es el token de 256-bit; `method:'webauthn'` da falsa impresión de verificación cripto del lado del referee (el referee es anónimo/no-auth por diseño).
- **⚠️ `apprenticeship` authorize: `signedByUid` es check de autorización, no firma.** `apprenticeship.ts:270` compara `signedByUid` contra `mentorUid` registrado — anti-impersonation, pero cualquier miembro del proyecto puede enviar el `signedByUid` del mentor; no hay firma del mentor.

## 3. Tabla por archivo (TODOS)

| Archivo | LOC | Estado | Cableado | Propósito + hallazgo file:line |
|---|---|---|---|---|
| src/server/routes/curriculum.ts | 1090 | ✅🔑 | server.ts:1312-1313 | Claims+referee cosign + WebAuthn real. Firma referee NO verificada cripto (:558-637); WebAuthn register/verify SÍ (:822,1017) |
| src/services/curriculum/claims.ts | 373 | ✅ | curriculum.ts | Engine claims. `signature` referee opaco, sin verify (:306). TODO XP sin wire (:1-10) |
| src/services/curriculum/refereeTokens.ts | 46 | ✅🔑 | claims.ts | 32-byte hex + sha256, raw nunca persistido (:34,43) |
| src/services/curriculum/historyAggregator.ts | 172 | ✅ | PortableCurriculum.tsx | Agrega audit_logs→CV. Pure. completedTrainings via /training\..+\.completed/ (:81) |
| src/server/routes/microtraining.ts | 237 | ✅ | server.ts:1054 | Score server-side (:166), certifica al pasar, audita |
| src/services/microtraining/lightningTrainingService.ts | 350 | ✅ | microtraining.ts | Catálogo determinístico 6 módulos (NO LLM-generado) (:70) |
| src/services/microtraining/microtrainingFirestoreAdapter.ts | 132 | ✅ | microtraining.ts | Adapter DI persist sesiones+certs |
| src/server/routes/postTraining.ts | 263 | ✅ | server.ts:1074 | 4 endpoints engine Ebbinghaus, workerUid=callerUid forzado (:27) |
| src/services/postTraining/postTrainingAssessmentEngine.ts | 255 | ✅ | postTraining.ts | Pure: scoring + review delay + case-study match |
| src/server/routes/skillGap.ts | 219 | ✅ | server.ts:1066 | 4 endpoints brecha/plan/polivalencia/sustituto, compute-only |
| src/services/skillGap/skillGapAnalyzer.ts | 326 | ✅ | skillGap.ts | Pure engine |
| src/server/routes/spacedRepetition.ts | 211 | ✅ | server.ts:1096 | SM-2, compute-only |
| src/services/spacedRepetition/spacedRepetitionScheduler.ts | 140 | ✅ | spacedRepetition.ts | Pure SM-2 |
| src/server/routes/safetyTalks.ts | 92 | ✅ | server.ts:1152 | suggestTalks por señales, compute-only |
| src/services/safetyTalks/talkTopicSuggester.ts | 249 | ✅ | safetyTalks.ts, SafetyTalks.tsx | Pure ranking determinístico |
| src/services/safetyTalks/safetyTalksStore.ts | 36 | ✅ | SafetyTalks.tsx | Persistencia charlas dadas (factory project-scoped) |
| src/server/routes/apprenticeship.ts | 505 | ✅ | server.ts:1001 | Cap mentor=3 fail-closed (:175), runTransaction (:262,:409). signedByUid=authz, no firma (:270) |
| src/services/apprenticeship/apprenticeshipProgressService.ts | 249 | ✅ | Apprenticeship.tsx | Pure: niveles+rotación |
| src/server/routes/portfolioLessons.ts | 162 | 🟡 | server.ts:1072 / hook sin UI | 2 endpoints OK; `usePortfolioLessons` 0 consumidores |
| src/services/portfolioLessons/portfolioLessonsEngine.ts | 299 | ✅ | portfolioLessons.ts | Pure |
| src/server/routes/onboarding.ts | 295 | ✅ | server.ts:984 | Tenant onboarding transaccional, idempotencyKey, tier-set cerrado (:84) |
| src/server/routes/vendorOnboarding.ts | 301 | 🟡 | server.ts:1052 / hook sin UI | 5 endpoints OK; `useVendorOnboarding` 0 consumidores |
| src/services/vendorOnboarding/vendorOnboardingFlow.ts | 267 | ✅ | vendorOnboarding.ts | Pure |
| src/services/vendorOnboarding/vendorAccreditationTracker.ts | 160 | ✅ | vendorOnboarding.ts | Pure escalamiento |
| src/server/routes/pymeOnboarding.ts | 145 | 🟡 | server.ts:1119 / dup pymeWizard | 2 endpoints OK; stack duplicado |
| src/services/pymeOnboarding/pymeWizard.ts | 196 | 🟡 | pymeOnboarding.ts | Pure; duplica pymeWizard/pymeOnboardingWizard |
| src/services/pymeWizard/pymeOnboardingWizard.ts | 257 | 🟡 | route pymeWizard.ts | Stack paralelo competidor |
| src/services/roleOnboarding/roleOnboardingTracks.ts | 305 | ✅ | OnboardingTrackProgressPanel | Pure; track DS44/DS594/L16744 (:120) |
| src/services/onboarding/faenaOnboardingBundle.ts | 178 | ✅ | (servicio) | Bundle ODI/DDR/RIOHS, deriveStatus pure |
| src/services/onboarding/faenaOnboardingFirestoreAdapter.ts | 75 | ✅ | bundle | Adapter DI |
| src/server/routes/gamification.ts | 147 | 🔴 | server.ts:916 | `/points` confía amount+reason cliente sin validar (:35-50) |
| src/services/gamificationBackend.ts | 74 | 🔴 | gamification.ts | awardPoints sin cota/whitelist (:3-33); medal ≥150 (:57) |
| src/services/gamification/positiveXp.ts | 108 | ✅🔑 | (engine) | Chokepoint positivo, XpReason cerrado; bypasseado por gamificationBackend |
| src/services/gamificationService.ts | 54 | 🔴 | Training/Gamification pages | Cliente envía overrideAmount verbatim (:27-35) |
| src/services/trainingBackend.ts | 98 | ✅ | geminiBackend.ts:1462 | Gemini micro-curso+quiz; correctIndex del LLM (no autoritativo) |
| src/utils/trainingCertificate.ts | 112 | ⚠️ | Training.tsx | PDF cert. Overclaim legal "DS54·DS44·L16744" sin firma/QR/hash verificable (:107) |
| src/hooks/useApprenticeship.ts | 157 | ✅ | Apprenticeship.tsx | Único hook B6 con consumidor real |
| src/hooks/useMicrotraining.ts | 160 | 🟡 | sin UI | 0 consumidores |
| src/hooks/useSpacedRepetition.ts | 117 | 🟡 | sin UI | 0 consumidores |
| src/hooks/useSkillGap.ts | 129 | 🟡 | sin UI | 0 consumidores |
| src/hooks/usePostTraining.ts | 132 | 🟡 | sin UI | 0 consumidores |
| src/hooks/useSafetyTalks.ts | 47 | 🟡 | useInsights.ts (no page) | 1 consumidor indirecto |
| src/hooks/useVendorOnboarding.ts | 152 | 🟡 | sin UI | 0 consumidores |
| src/hooks/usePymeOnboarding.ts | 58 | 🟡 | sin UI | 0 consumidores; dup usePymeWizard |
| src/hooks/useGamification.ts | 159 | ✅ | Gamification.tsx | Cableado |
| src/hooks/usePortfolioLessons.ts | 78 | 🟡 | sin UI | 0 consumidores |
| src/pages/Apprenticeship.tsx | 1194 | ✅ | App.tsx:310,496 | Page §244-250 completa |
| src/pages/Training.tsx | 932 | ✅ | TrainingRoutes.tsx | Hub capacitación; usa awardPoints (cadena 🔴) + cert |
| src/pages/Gamification.tsx | 804 | ✅ | TrainingRoutes.tsx | Leaderboard+juegos+medallas |
| src/pages/PortableCurriculum.tsx | 514 | ✅ | TrainingRoutes.tsx | CV portátil, empty-states honestos (:20) |
| src/pages/SafetyTalks.tsx | 356 | ✅ | ComplianceRoutes.tsx:50 | Charlas diarias |
| src/pages/ArcadeGames.tsx | 155 | ✅ | TrainingRoutes.tsx | Hub serious-games, tier Diamante+ |
| src/pages/ClawMachine.tsx | 245 | ✅ | TrainingRoutes.tsx | Drill EPP gamificado, append-only scores |
| src/pages/Onboarding.tsx | 27 | ✅ | App.tsx:421 | Wrapper de OnboardingWizard |
| src/routes/TrainingRoutes.tsx | 19 | ✅ | App.tsx | 6 rutas lazy |
| src/components/curriculum/ClaimForm.tsx | 270 | ✅ | PortableCurriculum.tsx | Form claim |
| src/components/curriculum/ClaimStatus.tsx | 185 | ✅ | PortableCurriculum.tsx | Estado claim |
| src/components/onboarding/OnboardingWizard.tsx | 628 | ✅ | Onboarding.tsx | Wizard |
| src/components/onboarding/useOnboardingStatus.ts | 52 | ✅ | wizard | Hook estado |
| src/components/microtraining/LightningTrainingPlayer.tsx | 224 | 🟡 | AssignedMicrotrainingCard (no montado) | Player OK pero alcanzable solo vía card huérfana |
| src/components/incidentFlow/AssignedMicrotrainingCard.tsx | (B5?) | 🟡 | 0 consumidores | Único punto de montaje del player, no montado |
| src/components/spacedRepetition/SpacedRepetitionReviewQueue.tsx | 150 | 🟡 | 0 consumidores | Componente sin montar |
| src/components/pymeWizard/PymeOnboardingPlanPanel.tsx | 301 | 🟡 | 0 consumidores | Sin montar; dup |
| src/components/roleOnboarding/OnboardingTrackProgressPanel.tsx | 263 | 🟡 | 0 consumidores | Sin montar |
| src/components/apprenticeship/ApprenticeshipBoard.tsx | 124 | 🟡 | 0 consumidores | Sin montar (Apprenticeship.tsx no lo usa) |
| src/components/safetyTalks/DailyTalkSuggestion.tsx | 106 | ✅ | SafetyTalks.tsx | Cableado |
| src/components/workers/TrainingRecommendations.tsx | 214 | ✅ | Workers.tsx | Cableado |
| src/components/workers/TacticalOnboardingModal.tsx | 301 | ✅ | AddWorkerModal.tsx | Cableado |
| src/components/shared/PostTrainingAdModal.tsx | 150 | ✅ | Training.tsx | Cableado |
| src/components/gamification/MorningCheckIn.tsx | 275 | ✅ | Dashboard.tsx | Cableado |
| src/components/gamification/FindTheGuardian.tsx | 383 | ✅ | Training.tsx | Cableado |
| src/components/gamification/NormativeQuiz.tsx | 332 | ✅ | Gamification.tsx | Usa Gemini quiz |
| src/components/gamification/ExtinguisherSimulator.tsx | 310 | ✅ | Gamification.tsx | Cableado |
| src/components/gamification/ReflexBuzzer.tsx | 203 | ✅ | Gamification.tsx | Cableado |
| src/components/gamification/Medal3DViewer.tsx | 187 | ✅ | gamification UI | Visor medalla |
| src/pages/PortableCurriculum/* tests, *.test.*, I-TEST (≈40 archivos) | — | ✅ | — | Supertest real-router (curriculum.router 995 LOC, apprenticeship 719), engine unit-tests; hasTest mayormente cubierto |
| tasks/lessons.md | 21 | 🔵 | doc | Notas |

(Estados ✅ implementado-real · 🟡 parcial/UI-huérfana/dup · 🏚️ obsoleto · 🔵 doc/infra · 🔑 superficie de seguridad · 🔴 defecto de integridad)

## 4. Para decisión del usuario (❓/⚠️)

- **🔴⚠️ Gamificación auto-servible:** ¿Aceptable que cualquier worker pueda POST `/api/gamification/points` con `amount` arbitrario? Si las medallas/leaderboard tienen valor reputacional o alimentan el currículum portátil (`historyAggregator` suma `gamification` XP), esto es manipulable. Fix sugerido: server deriva `amount` de un `reason` whitelisted (server-side `POINT_VALUES`), ignora override del cliente.
- **⚠️ Certificado con sello normativo sin verificación:** `trainingCertificate.ts:107` estampa "Cumplimiento DS 54 · DS 44/2024 · Ley 16.744" en un PDF generado en cliente sin firma/QR/hash. ¿Se requiere certificado verificable (firma digital + verificación online) para valor legal, o es solo decorativo?
- **❓ Última milla de UI:** 7 features backend-completas (microtraining, spacedRep, skillGap, postTraining, vendorOnboarding, pymeOnboarding, portfolioLessons) + 5 componentes están huérfanos de navegación. ¿Priorizar cablearlos o congelarlos como API-only hasta que haya demanda?
- **❓ Duplicación pyme:** elegir un stack (`pymeOnboarding` vs `pymeWizard`) y deprecar el otro para evitar drift.
- **⚠️ Co-firma referee `method:'webauthn'`:** el campo sugiere verificación cripto que no ocurre (token es la barrera). ¿Renombrar/documentar para no inducir a error en auditorías externas?
