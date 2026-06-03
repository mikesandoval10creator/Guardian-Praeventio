# DEEP-EX-22 — Pasada exhaustiva línea-por-línea · Lote #22

**Bloque:** `B6-Capacitacion` · **Filtro:** `category` empieza con `FEAT` (FEAT-components / FEAT-hooks / FEAT-pages) · orden por `path` · slice **[0:55]**.
**Fecha:** 2026-06-03 · **Atestación:** 55/55 archivos leídos completos, línea por línea.

Este lote es casi todo UI (25 components + 14 hooks + 15 pages + 1 helper puro).
Complementa `DEEP-B6-Capacitacion.md` (que cubrió los server-routes + services).
**No se repiten** sus hallazgos ya documentados (gamificación `/api/gamification/points`
confía amount cliente, referee co-sign sin cripto, trainingCertificate sobre-afirma legal,
hooks UI-huérfanos). Aquí se buscan hallazgos **nuevos**.

---

## 1. Hallazgos NUEVOS

### 🔴 Auto-otorgamiento de puntos por escritura DIRECTA a Firestore (2 colecciones nuevas, distintas del route ya documentado)

El audit previo documentó el bypass vía `/api/gamification/points` (route → `gamificationBackend.awardPoints`).
Este lote revela que **la mayoría de la gamificación ni siquiera pasa por el server** — escribe Firestore directo desde el cliente, y las reglas solo restringen *qué* keys cambian, **no el valor**:

- **`user_stats/{uid}`** — `src/hooks/useGamification.ts:92-100` (`addPoints`), `:137-155` (`completeChallenge`), `:102-135` (`unlockMedal`) hacen `updateDoc(doc(db,'user_stats',uid), { points: increment(amount), medals, completedChallenges })` **directo**. Regla `firestore.rules:498-503`: `allow update: if isOwner(userId) && affectedKeys().hasOnly(['points','medals',...])` — **sin cota ni monotonía**. Un trabajador puede `updateDoc(...,{points:999999})` o auto-asignarse cualquier `medals[]` desde devtools. Falsea leaderboard + medallas.
- **`gamification_scores/{uid}_{gameId}`** — `src/pages/ClawMachine.tsx:129-138`, `src/pages/PoolGame.tsx:163-173`, escritos vía `mergeScoreDoc` (cliente). Regla `firestore.rules:758-764`: `allow update` solo valida `affectedKeys().hasOnly([...])` → owner puede setear `bestScore:999999`. El `Math.max(...)` monotónico de `gameScore.ts:78` es **solo cliente**, trivialmente bypasseable.
- **Cadena cliente que alimenta esto:** los juegos `ExtinguisherSimulator` (`onComplete(150)` hard-coded :107), `NormativeQuiz` (`Math.round(score/total*200)` :135 — además `correctIndex` viene del LLM Gemini, no autoritativo), `ReflexBuzzer` (:62-67), `FindTheGuardian` (puntos por item) llaman `onComplete(points)` → `Gamification.tsx:652-672` → `addPoints(points,...)` → escritura directa. Todo el cálculo de puntaje es client-side.

**Net:** existen ≥3 superficies de auto-award independientes (`user_stats`, `gamification_scores`, y el `/api/gamification/points` ya documentado), **ninguna con validación server-side autoritativa del monto**. Viola el espíritu del chokepoint `positiveXp.awardXp` (`XpReason` cerrado), que queda completamente bypasseado.

### 🟡 `OnboardingWizard.defaultSubmit` no envía `Authorization` → el flujo de onboarding por defecto siempre da 401

`src/components/onboarding/OnboardingWizard.tsx:205-215` (`defaultSubmit`) hace `fetch('/api/onboarding/complete', { headers: {'Content-Type':'application/json'} })` — **sin header de auth**. El route exige `verifyAuth` (`src/server/routes/onboarding.ts:107`). `Onboarding.tsx:14-23` monta el wizard **sin pasar `submitFn`**, así que producción usa `defaultSubmit`. Resultado: el onboarding self-service de tenant siempre rechaza con 401 a menos que algún proxy inyecte el token. Otros forms del mismo lote (ClaimForm, ClaimStatus, NlQueryPanel, todos los hooks Sprint-K) sí usan `apiAuthHeader()`/`apiAuthHeaders()` — éste es la excepción olvidada.

### 🟡 Inyección de "Nodos Maestros" globales sin gate de rol/tier — superficie de envenenamiento de RAG cross-tenant

`src/pages/KnowledgeIngestion.tsx:54-64` permite a **cualquier usuario autenticado** crear nodos con `projectId:'global'`, `metadata:{source:'manual-ingestion', isMasterNode:true}`. La regla `nodes` (`firestore.rules` match `/nodes/{nodeId}`) `allow create: if isEmailVerified() && incoming().metadata.authorId == request.auth.uid` — **sin chequeo de admin/supervisor ni de scope global**. La propia UI describe estos nodos como "base **inquebrantable** para responder dudas y generar PTS" (`:207`) y los marca como "Red Neuronal Global, disponibles para todos los proyectos" (`:203`). Un usuario malicioso (o ingenuo) puede contaminar el corpus RAG que la IA trata como autoritativo para todos los tenants.

### 🟡 `TacticalOnboardingModal` genera 5 documentos legales `status:'signed'` con firma de canvas, sin audit_log ni verificación server

`src/components/workers/TacticalOnboardingModal.tsx:98-154` produce ODI / Inducción L16.744 / EPP / RIOHS / Pacto Horas Extra como PDFs, sella una firma dibujada en canvas (PNG + SVG geométrico) y los encola con `status:'signed'` (`:148`) vía `saveForSync` → colección `documents`. No hay `auditServerEvent`/`logAuditAction` (viola invariante audit-log #3/#14 para una operación de estado legal), ni hash/timestamp confiable, ni co-firma verificable. La firma es una imagen, no un binding criptográfico. Mismo patrón de sobre-afirmación legal que `trainingCertificate.ts` (ya documentado) pero en archivo NUEVO y con más peso (documentos obligatorios DS 44/L16.744).

### 🔵 Doc-drift dentro del código: `gameScore.ts` afirma que la regla no existe (sí existe)

`src/components/games/gameScore.ts:22-25` (y eco en `ClawMachine.tsx:7`, `PoolGame.tsx`): comentario *"this collection still needs firestore.rules… Until then, writes are gated behind tier flags in the UI"*. Falso: la regla `gamification_scores` existe desde Round 16 (`firestore.rules:744-767`). El comentario stale puede inducir a creer que el tier-gate UI es la única barrera (y de hecho la regla que sí existe es débil — ver 🔴 arriba).

### 🔵 `FindTheGuardian` usa imagen de escena desde Unsplash hot-linked (CSP / disponibilidad / privacidad)

`src/components/gamification/FindTheGuardian.tsx:81` — `imageUrl = "https://images.unsplash.com/photo-...."`. Dependencia de CDN externo en un PWA para faenas remotas/offline; además el hit a unsplash.com filtra que el usuario juega. Menor, pero no-determinista para tests y rompe offline.

### 🔵 Imports muertos `auth` (no usados)

`src/hooks/useApprenticeship.ts:6` y `src/hooks/useKnowledgeBase.ts:6` importan `auth` de firebase pero nunca lo usan (todo va por `apiAuthHeader()`). Trivial, lint-level.

### 🔵 Botones cosméticos sin handler (stubs UI no registrados)

`src/pages/AcademicProcessor.tsx:54-56` ("Subir PDF") y `:122-126` ("Guardar en Zettelkasten") no tienen `onClick` — no hacen nada. `MuralDinamico.tsx:206-208` (botón imagen) y `:295` ("comentarios… Próximamente") idem. No cumplen #13 (sin `// TODO(sprint-N)`, sin feature-flag, sin registro en `stubs-inventory.md`) pero son UI inerte sin promesa de dato falso.

---

## 2. Notas de cumplimiento (lo que SÍ está bien)

- **Todos los hooks Sprint-K** (`useMicrotraining`, `useSkillGap`, `useSpacedRepetition`, `usePostTraining`, `usePortfolioLessons`, `useVendorOnboarding`, `usePymeOnboarding`, `useSafetyTalks`, `useKnowledgeBase`, `useApprenticeship`) envían `apiAuthHeaders()`/`apiAuthHeader()` y hacen project-scoping vía `/api/sprint-k/{projectId}/...`. Limpios.
- **`LightningTrainingPlayer`** calcula score solo para display; la autoridad es server (`microtraining.ts:scoreSession`, ya documentado). `submitMicrotrainingSession` re-puntúa server-side.
- **`DevPosterSeeder`** tiene gate REAL `isAdmin` (custom claim) + fail-fast, documentado (`:281-322`). Bien.
- **`ClaimForm`/`ClaimStatus`** usan `apiAuthHeader()`; WebAuthn es proof-of-presence local declarado honestamente como opaco (`:13-17`).
- **`MorningCheckIn`** escribe la declaración jurada vía `logAuditAction` server-side (no escribe `audit_logs` directo), copy legal en es-CL correcto (#2).
- **`useProjectCapacity`, `DailyTalkSuggestion`, `GlossarySearchPanel`, `KnowledgeBaseSearch`, `SpacedRepetitionReviewQueue`, `OnboardingTrackProgressPanel`, `PymeOnboardingPlanPanel`, `ApprenticeshipBoard`** son wires puros de engines deterministas. Limpios.
- **`ARPosterScanner`** procesa frames 100% on-device (MediaPipe, #12), persiste anchors con dedupe transaccional-ish (query→update|create), GPS con timeout fail-safe. Bien.
- **`PortableCurriculum`** read-only, degradación independiente por fuente. Limpio.
- `Math.random()` en `ReflexBuzzer:28`, `ClawMachine:65`, `PoolGame`, `useGamification:116-132` es **client/UI** → fuera del scope de #15 (que aplica a `src/server/` e ID-gen).

---

## 3. Tabla por archivo (55/55)

| # | Archivo | Tipo | Estado | Hallazgo file:line |
|---|---|---|---|---|
| 0 | components/apprenticeship/ApprenticeshipBoard.tsx | comp | ✅ | Wire puro de `proposeLevelUp`. Limpio |
| 1 | components/ar/ARPosterScanner.tsx | comp | ✅ | On-device (#12); anchor dedupe; GPS fail-safe (:704). Limpio |
| 2 | components/curriculum/ClaimForm.tsx | comp | ✅ | apiAuthHeader; WebAuthn opaco declarado (:13). Limpio |
| 3 | components/curriculum/ClaimStatus.tsx | comp | ✅ | apiAuthHeader; cooldown 30s UI. Limpio |
| 4 | components/games/gameScore.ts | helper | 🔵 | Pure merge; **comentario doc-drift "needs rules" — sí existen** (:22-25) |
| 5 | components/gamification/ExtinguisherSimulator.tsx | comp | 🔴 | `onComplete(150)` hard-coded (:107) → addPoints directo |
| 6 | components/gamification/FindTheGuardian.tsx | comp | 🔵 | Unsplash hot-link (:81); puntaje solo-cliente |
| 7 | components/gamification/Medal3DViewer.tsx | comp | ✅ | R3F puro, geometrías nativas. Limpio |
| 8 | components/gamification/MorningCheckIn.tsx | comp | ✅ | DDJJ vía logAuditAction server; copy es-CL ok |
| 9 | components/gamification/NormativeQuiz.tsx | comp | 🟡 | puntaje cliente (:135); `correctIndex` del LLM, no autoritativo |
| 10 | components/gamification/ReflexBuzzer.tsx | comp | 🔴 | `onComplete(points)` cliente (:62) → addPoints directo |
| 11 | components/glossary/GlossarySearchPanel.tsx | comp | ✅ | Wire puro de glossaryEngine. Limpio |
| 12 | components/knowledge/SmartConnectionsPanel.tsx | comp | 🔵 | onClick smart-action vacío (:119) — pendiente, inerte |
| 13 | components/knowledgeBase/KnowledgeBaseSearch.tsx | comp | ✅ | Wire puro searchArticles. Limpio |
| 14 | components/microtraining/LightningTrainingPlayer.tsx | comp | ✅ | score solo display; server re-puntúa. Limpio |
| 15 | components/onboarding/OnboardingWizard.tsx | comp | 🟡 | `defaultSubmit` SIN auth header (:205) → 401 en prod |
| 16 | components/onboarding/useOnboardingStatus.ts | hook | ✅ | lee users/{uid}.onboarded; fail-open documentado. Limpio |
| 17 | components/pymeWizard/PymeOnboardingPlanPanel.tsx | comp | ✅ | Wire puro de buildOnboardingPlan. Limpio |
| 18 | components/roleOnboarding/OnboardingTrackProgressPanel.tsx | comp | ✅ | Controlado, idempotencia en engine. Limpio |
| 19 | components/safety/SafetyCapsules.tsx | comp | 🔵 | Gemini cápsula; botones "Escuchar"/"historial" sin handler |
| 20 | components/safetyTalks/DailyTalkSuggestion.tsx | comp | ✅ | Wire puro suggestTalks (no LLM). Limpio |
| 21 | components/shared/PostTrainingAdModal.tsx | comp | ✅ | AdMob/AdSense gate free-plan; copy es-CL. Limpio |
| 22 | components/spacedRepetition/SpacedRepetitionReviewQueue.tsx | comp | ✅ | Wire puro SM-2. Limpio |
| 23 | components/workers/TacticalOnboardingModal.tsx | comp | 🟡 | 5 docs legales `status:signed` firma-canvas, **sin audit_log ni verify** (:98-154) |
| 24 | components/workers/TrainingRecommendations.tsx | comp | ✅ | Gemini recs; escribe `projects/{pid}/trainings` (scoped). Ok |
| 25 | components/zettelkasten/NlQueryPanel.tsx | comp | ✅ | apiAuthHeader + projectId scoping. Limpio |
| 26 | hooks/useApprenticeship.ts | hook | 🔵 | import `auth` muerto (:6); resto authed. Limpio |
| 27 | hooks/useGamification.ts | hook | 🔴 | **addPoints/unlockMedal/completeChallenge escriben user_stats directo sin cota** (:92,:102,:137) |
| 28 | hooks/useKnowledgeBase.ts | hook | 🔵 | import `auth` muerto (:6); resto authed. Limpio |
| 29 | hooks/useMicrotraining.ts | hook | ✅ | authedFetch; server re-puntúa. Limpio |
| 30 | hooks/usePortfolioLessons.ts | hook | ✅ | authedFetch project-scoped. Limpio |
| 31 | hooks/usePostTraining.ts | hook | ✅ | authedFetch project-scoped. Limpio |
| 32 | hooks/useProjectCapacity.ts | hook | ✅ | Wrapper puro de capacity engine. Limpio |
| 33 | hooks/usePymeOnboarding.ts | hook | ✅ | authedFetch project-scoped. Limpio |
| 34 | hooks/useSafetyTalks.ts | hook | ✅ | authedFetch project-scoped. Limpio |
| 35 | hooks/useSkillGap.ts | hook | ✅ | authedFetch project-scoped. Limpio |
| 36 | hooks/useSpacedRepetition.ts | hook | ✅ | authedFetch project-scoped. Limpio |
| 37 | hooks/useVendorOnboarding.ts | hook | ✅ | authedFetch project-scoped. Limpio |
| 38 | hooks/useWisdomCapsules.ts | hook | ✅ | lee `wisdomCapsules` (tiene regla :667); GPS proximity. Limpio |
| 39 | hooks/useZettelkastenIntelligence.ts | hook | ✅ | dedupe-antes-de-crear notifs; escribe `projects/{pid}/notifications`. Ok |
| 40 | pages/AcademicProcessor.tsx | page | 🔵 | Botones "Subir PDF"/"Guardar Zettel" sin onClick (:54,:122) |
| 41 | pages/AfichesSeguridad.tsx | page | ✅ | Generador PDF cliente; QR a public-node. Limpio |
| 42 | pages/Apprenticeship.tsx | page | ✅ | (ya en DEEP-B6) §244-250 completa |
| 43 | pages/ArcadeGames.tsx | page | ✅ | Hub PremiumFeatureGuard; reflex/find/quiz enrutan a /training. Limpio |
| 44 | pages/ClawMachine.tsx | page | 🔴 | score cliente → `gamification_scores` directo (:129); audit ok |
| 45 | pages/DevPosterSeeder.tsx | page | ✅ | Gate isAdmin real + all-or-nothing download. Limpio |
| 46 | pages/Gamification.tsx | page | 🔴 | (ya en DEEP-B6) onComplete→addPoints client points (:652-672) |
| 47 | pages/Glossary.tsx | page | ✅ | Parse + Fuse client-side de constante. Limpio |
| 48 | pages/KnowledgeBase.tsx | page | ✅ | Consumer de hooks authed Sprint-K. Limpio |
| 49 | pages/KnowledgeIngestion.tsx | page | 🟡 | crea nodos `projectId:'global'` sin gate rol/tier (:54) — RAG-poison |
| 50 | pages/MuralDinamico.tsx | page | 🔵 | moderación solo-cliente (:77); botón imagen + comentarios stub |
| 51 | pages/Onboarding.tsx | page | 🟡 | monta wizard sin submitFn → usa defaultSubmit sin auth (#15 OnboardingWizard) |
| 52 | pages/Pizarra.tsx | page | ✅ | addNode project-scoped; lazy graph. Limpio |
| 53 | pages/PoolGame.tsx | page | 🔴 | score cliente → `gamification_scores` directo (:163); audit ok |
| 54 | pages/PortableCurriculum.tsx | page | ✅ | Read-only, degradación por fuente. Limpio |

**Conteo:** 🔴 5 archivos · 🟡 4 · 🔵 7 · ✅ 39.
(🔴 reales = useGamification + 4 superficies juego que dependen de él; 🟡 = onboarding-auth, tactical-docs, RAG-global, Onboarding-page.)

---

## 4. Resumen ejecutivo

Lote dominado por UI de capacitación/gamificación. El hallazgo **más severo y nuevo** es que la
gamificación principal **no usa el server**: `useGamification.addPoints/unlockMedal/completeChallenge`
escriben `user_stats/{uid}` **directo** a Firestore, y los juegos serios escriben
`gamification_scores/{uid}_{gameId}` directo — y **ambas reglas solo restringen qué keys cambian, no
el valor**, así que cualquier owner se auto-asigna puntos/medallas/bestScore arbitrarios desde devtools
(≥3 superficies de auto-award independientes, ninguna validada server-side). Segundo, el wizard de
onboarding por defecto (`OnboardingWizard.defaultSubmit`) **no manda el header de auth** y la página lo
monta sin `submitFn`, por lo que el flujo siempre da 401 contra un route con `verifyAuth`. Tercero,
`KnowledgeIngestion` deja a cualquier usuario inyectar "Nodos Maestros" `projectId:'global'` que la IA
trata como base inquebrantable cross-tenant (envenenamiento de RAG sin gate de rol). Cuarto,
`TacticalOnboardingModal` emite 5 documentos legales obligatorios con `status:'signed'` (firma de canvas)
**sin audit_log ni verificación** — sobre-afirmación legal en archivo nuevo. El resto (los 10 hooks
Sprint-K, los wires de engines puros, ARPosterScanner on-device, DevPosterSeeder con gate admin real)
está limpio y consistente con las directivas. Doc-only, sin commit.
