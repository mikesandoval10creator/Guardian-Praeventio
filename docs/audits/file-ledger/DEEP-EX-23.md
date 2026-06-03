# DEEP — Lote EX-23 · B6-Capacitacion (FEAT) · 2026-06-03

**Atestación: 51/51 archivos leídos línea por línea.**
DERIVA: `ledger.json` filtrado por `category` startsWith `"FEAT"` &&
`block === "B6-Capacitacion"` (106 matches), ordenado por `path`, slice
`[55:106]` (51 archivos). Lista exacta verificada vía Node contra el ledger.

No repito lo ya cubierto en `DEEP-B6-Capacitacion.md` (gamificación
`/api/gamification/points` confía `amount`+`reason` sin cota/whitelist/RANK →
auto-XP; medalla ≥150 pts; certificado PDF cliente con sello "DS54·DS44·L16744"
sin firma/QR/hash verificable; `usePortfolioLessons`/`useVendorOnboarding`
hooks sin consumidores; stack `pymeWizard` duplicado). `DEEP-EX-22.md` no
existe en el repo (último previo es EX-20) — no hay solapamiento que evitar.
Los engines puros server-wired (microtraining/postTraining/skillGap/
spacedRepetition/pyme/portfolioLessons/vendor) se releyeron: confirman patrón
exemplar (guard + assertProjectMember + validate(zod) + compute-only +
`internal_error` sin leak). Aquí solo hallazgos NUEVOS.

---

## Hallazgos NUEVOS

### 🔴 N1 — Co-firma WebAuthn de referee NUNCA verificada criptográficamente
El flujo flagship "currículum portátil" promete co-firma biométrica. En
`RefereeAccept.tsx:80-82` el cliente llama `useBiometricAuth().authenticate()`
**local** y luego fabrica un string opaco `signature = "webauthn:" +
new Date().toISOString()`. Lo envía a `POST /api/curriculum/referee/:token`
(`curriculum.ts:558`), que delega en
`recordRefereeEndorsement(claimId, rawToken, {signature, method}, ...)`
(`claims.ts:266-308`). Ese servicio **guarda `signature` y `method:'webauthn'`
verbatim sin ninguna verificación** — `slot.signature = endorsement.signature`
(`claims.ts:306`). El endpoint real de verificación WebAuthn
(`/api/auth/webauthn/verify`, `curriculum.ts:721` con `@simplewebauthn/server`
+ counter-replay) **jamás se invoca desde el flujo de referee**. Resultado: un
claim "verified" con dos co-firmas `method:'webauthn'` no tiene binding
criptográfico alguno — el "webauthn:" es teatro. El mismo defecto aplica al
`signedByWorker.webauthnAssertion` (`claims.ts:222-223`): se persiste pero
nunca se valida. Cualquiera con el token de 256-bit (o que lo brute-forcee bajo
el `refereeLimiter`) puede co-firmar como "biométrico". La anti-fraude se
reduce al token + email — el sello WebAuthn es decorativo y engañoso.

### 🔴 N2 — `read_receipts`: confirmación de lectura DS44/RIOHS escrita client-side a colección SIN regla → default-deny (feature roto + anti-spoof server moot)
`DocumentReadConfirm.tsx:149,186,193` confirma la lectura obligatoria de
procedimientos/políticas escribiendo **100% client-side** vía
`saveReceipt`/`acknowledgeReceiptInFirestore` (`readReceiptStore.ts:54-80`) a
`projects/{pid}/read_receipts/{documentId__workerUid}` con
`updateDoc({status:'acknowledged'})`. Pero `read_receipts` **NO tiene regla de
write** en `firestore.rules` (grep confirma 0 hits; el único hit es
`documents_for_read:456`). Cae bajo el master-gate `{subCollection=**}/{docId}`
(`firestore.rules:258`) que solo concede `read` → todo write es default-deny en
producción. Es exactamente la clase de bug "client-SDK store sin write rule"
documentada en `TODO.md §17`, pero `read_receipts` **fue omitido** de la lista
de remediación (líneas 385-440 cubren stoppages/site_book/lone_worker/etc., no
este). Doble impacto: (a) la confirmación de lectura — evidencia legal
DS 44/2024 + RIOHS — falla silenciosamente en prod; (b) el server route
`readReceipts.ts:230` SÍ tiene el anti-blame correcto (`receipt.workerUid !==
callerUid → 403`), pero la página no lo usa, así que esa protección es inútil.

### 🔴 N3 — microtraining: certificado otorgado a `workerUid` ARBITRARIO del body (impersonación de certificación)
`microtraining.ts:151-189` puntúa server-side (correcto, `scoreSession`), pero
persiste el cert vía `adapter.grantCert(body.workerUid, body.moduleId, cert)`
(`:187`) donde `body.workerUid` viene del cliente (`sessionSchema.workerUid`,
`:137`) y **nunca se compara contra `callerUid`**. Cualquier miembro del
proyecto puede emitir un cert de microcapacitación a nombre de OTRO trabajador
(o a un uid inventado dentro del tenant). Contrasta directamente con el peer
`postTraining.ts:144` que fuerza `scoreAssessment(callerUid, ...)` justamente
para no confiar el `workerUid` del cliente. El cert es la evidencia de
competencia ante riesgo (altura/eléctrico/confinado) — falsificarlo es grave.

### 🟡 N4 — `training` (colección raíz): page worker hace client write pero la regla es admin/supervisor-only → write default-deny para operarios
`Training.tsx:142` (`addDoc(collection(db,'training'))`),
`:156` (handleAssignToProject) y `:197` (`updateDoc` para marcar `status:
'completed'` + auto-`attendees:[...,user.uid]`) son writes **client-side**. La
regla `training/{sessionId}` (`firestore.rules:527-533`) es
`allow write: if isAdmin() || isSupervisor()`. Para un operario común esos
writes son denegados → no puede crear sesión, asignarse ni marcarse completado
desde la UI. Si en cambio los usuarios SÍ tienen rol supervisor (común en
PYME), entonces el worker se auto-marca `completed` y auto-agrega su uid a
`attendees` con `points` arbitrarios elegidos por él en el form (`:494-501`),
disparando `awardPoints('training_completed')` (cadena 🔴 de B6). En ambos
extremos hay un problema: o la feature está rota, o la asistencia/puntaje de
capacitación es auto-declarada sin control server. No hay endpoint server para
`training` que fuerce identidad/estado.

### 🟡 N5 — `gamificationBackend.awardPoints`: field-path injection vía `reason`
`gamificationBackend.ts:21` escribe
`transaction.update(userRef, { [\`completedChallenges.${reason}\`]: ... })`.
Como `reason` llega sin sanitizar desde `/api/gamification/points`
(`gamification.ts:36`, sin whitelist — ya marcado 🔴 en B6 por el `amount`),
un `reason` con puntos/`~`/`*`/`[` construye field-paths Firestore anidados o
inválidos → escritura en sub-rutas no previstas del doc `user_stats`, o
excepción que el handler convierte en 500 con `error.message` leakeado
(ver N6). Ángulo NUEVO: B6 pidió whitelist de `reason` por el leaderboard; aquí
el riesgo adicional es corrupción estructural del documento por la
interpolación directa en la clave.

### 🟡 N6 — `gamification.ts`: 5xx filtra `error.message` al cliente (viol. CLAUDE.md #8)
`gamification.ts:53` y `:63` responden `res.status(500).json({ error:
error.message })` sin el guard `NODE_ENV==='production' ? 'Internal server
error' : ...`. Los demás routers del lote usan `internal_error` constante. El
endpoint `/coach/chat` (`:141`) tiene el mismo patrón. Fuga de internals
(mensajes de firebase-admin/stack) en producción.

### 🟡 N7 — `onboarding.ts`: `auditServerEvent` final sin try/catch (viol. CLAUDE.md #14)
`onboarding.ts:268` hace `await auditServerEvent(req, 'onboarding.completed',
...)` **fuera de cualquier try/catch**. Si la escritura del audit lanza
(Firestore transitorio), la excepción escapa sin handler → el handler ya no
puede `res.json` la respuesta de éxito (proyecto/tenant ya creados) → el
usuario ve 500 pese a que su onboarding se completó. El patrón mandado es
`try { await auditServerEvent(...) } catch { logger.error; Sentry }` con la
respuesta del usuario intacta.

### 🔵 N8 — `PublicNodeView.tsx` lee colección `zettelkasten` huérfana (sin regla, sin writer) → vista pública muerta
`PublicNodeView.tsx:36,52` hace `getDoc(doc(db,'zettelkasten', nodeId))` sobre
una ruta pública (`/n/:nodeId`). `firestore.rules` solo define `nodes:480`,
`zettelkasten_nodes:522` (server-only) — `zettelkasten` a secas **no existe** →
default-deny `{document=**}:17`. Además ningún writer escribe jamás a
`zettelkasten` (los nodos van a `nodes` vía `useRiskEngine:44`). La página de
verificación pública de QR/credencial siempre cae en "Acceso Denegado". Bug de
ruta (probablemente debía ser `nodes` con `isPublic==true`). Cosmético extra:
`:231-232` incrusta sellos `picsum.photos` aleatorios como "Seal 1/2".

### 🔵 N9 — `SafetyFeed.tsx`: nodo de Red creado con `metadata.author` (displayName) en vez de `metadata.authorId` que exige la regla
`SafetyFeed.tsx:101-105` setea `metadata:{criticidad,source,author:
user.displayName}` al `addNode`. La regla `nodes` create
(`firestore.rules:488`) exige `incoming().metadata.authorId ==
request.auth.uid`. Si `useRiskEngine.addNode` (matrixSyncManager) no inyecta
`authorId`, el create del nodo derivado del post es denegado y el `riskNodeId`
queda nulo silenciosamente (el post se guarda igual). Además `:146` hace
`updateDoc(doc(db,'nodes', riskNodeId))` — depende de que el nodo exista.
Inconsistencia author/authorId a verificar.

### 🔵 N10 — `wallEngine.ts`: engine de reconocimiento social sin adapter/route/UI (XP no canalizada por el chokepoint)
`socialRecognition/wallEngine.ts` calcula `xpAwarded` por tipo de kudos
(`XP_BY_KIND:58-64`) pero el comentario `:80` admite que no hay
`wallFirestoreAdapter.ts`. Grep confirma **0 consumidores** salvo su test. Es
un engine muerto. Riesgo latente: si un día un cliente persiste el record con
`xpAwarded` self-computado, sería OTRA vía de XP cliente-confiable que bypasea
`positiveXp.awardXp` (el chokepoint `XpReason`-cerrado). Registrar como
stub/no-wired (no figura en `docs/stubs-inventory.md` per directiva #13).

### 🔵 N11 — `trainingBackend.ts`: símbolos duplicados shadow-eados por `geminiBackend.ts`
`geminiBackend.ts:1462` hace `export * from './trainingBackend.js'`
(`generateTrainingQuiz`, `generateCustomSafetyTraining`) PERO `geminiBackend.ts`
**también define localmente** `generateTrainingQuiz` (`:536`). En un re-export
de barril, la declaración local gana → la versión de `trainingBackend.ts` queda
muerta. Ambas usan `model:"gemini-3-flash-preview"`. Doc-drift / dead-code:
dos fuentes de verdad para la misma acción whitelisted (`gemini.ts:164,180`).

---

## Tabla

| # | Archivo | LOC | Sev | Nota |
|---|---|---|---|---|
| 0 | pages/PublicNodeView.tsx | 252 | 🔵 | N8 lee `zettelkasten` huérfano `:36`; sellos picsum `:231` |
| 1 | pages/RefereeAccept.tsx | 252 | 🔴 | N1 fabrica `webauthn:<iso>` local `:82` sin verificación |
| 2 | pages/SafetyFeed.tsx | 673 | 🔵 | N9 metadata.author≠authorId `:104`; update `nodes` `:146` |
| 3 | pages/SafetyTalks.tsx | 356 | ✅ | saveTalk→`safety_talks_given` (regla OK :442); givenByUid |
| 4 | pages/Training.tsx | 932 | 🟡 | N4 client write a `training` (rule admin/sup-only); points form |
| 5 | pages/Zettelkasten.tsx | 34 | ✅ | Wrapper de NlQueryPanel |
| 6 | routes/TrainingRoutes.tsx | 19 | ✅ | Lazy routes |
| 7 | server/routes/apprenticeship.ts | 505 | ✅ | txn (#19), assertProjectMember, signer=mentor `:270` |
| 8 | server/routes/curriculum.ts | 1090 | 🔴 | N1 endorse guarda signature verbatim; webauthn/verify desconectado |
| 9 | server/routes/gamification.ts | 147 | 🟡 | N6 leak error.message `:53,63`; (B6 amount/reason) |
| 10 | server/routes/knowledgeBase.ts | 395 | ✅ | txn, authorUid forzado, audit, internal_error |
| 11 | server/routes/microtraining.ts | 237 | 🔴 | N3 grantCert(body.workerUid) sin == callerUid `:187` |
| 12 | server/routes/onboarding.ts | 295 | 🟡 | N7 auditServerEvent sin try/catch `:268` |
| 13 | server/routes/portfolioLessons.ts | 162 | ✅ | compute puro, guard, validate |
| 14 | server/routes/postTraining.ts | 263 | ✅ | Ejemplar: workerUid=callerUid forzado `:144` |
| 15 | server/routes/pymeOnboarding.ts | 145 | ✅ | compute puro, guard |
| 16 | server/routes/readReceipts.ts | 279 | ✅ | Anti-blame 403 `:230` (pero la page no lo usa — ver N2) |
| 17 | server/routes/safetyTalks.ts | 92 | ✅ | compute puro, guard |
| 18 | server/routes/skillGap.ts | 219 | ✅ | compute puro, fix z.unknown→array `:76` |
| 19 | server/routes/spacedRepetition.ts | 211 | ✅ | compute puro SM-2 |
| 20 | server/routes/vendorOnboarding.ts | 301 | ✅ | compute puro, guard |
| 21 | services/apprenticeship/apprenticeshipProgressService.ts | 249 | ✅ | engine puro determinístico |
| 22 | services/coachBackend.ts | 38 | 🔵 | model gemini-3-flash-preview; response.text sin guard |
| 23 | services/curriculum/claims.ts | 373 | 🔴 | N1 recordRefereeEndorsement guarda signature sin verificar `:306` |
| 24 | services/curriculum/historyAggregator.ts | 172 | 🔵 | completedTrainings lee `training\..+\.completed` que nada emite |
| 25 | services/curriculum/refereeTokens.ts | 46 | ✅ | sha256 token, raw nunca en Firestore |
| 26 | services/focusBlocks/focusBlocks.ts | 313 | ✅ | randomId, users/{uid}/focus_blocks, validación pura |
| 27 | services/gamification/positiveXp.ts | 108 | ✅ | chokepoint XP positivo, XpReason cerrado |
| 28 | services/gamificationBackend.ts | 74 | 🟡 | N5 field-path injection via reason `:21`; (B6 amount) |
| 29 | services/gamificationService.ts | 54 | ✅ | (B6) wrapper; overrideAmount es el vector ya documentado |
| 30 | services/glossary/glossaryEngine.ts | 324 | ✅ | engine búsqueda puro |
| 31 | services/knowledgeBase/knowledgeBaseService.ts | 180 | ✅ | engine búsqueda/obsolescencia puro |
| 32 | services/microtraining/lightningTrainingService.ts | 350 | ✅ | catálogo + scoring puro |
| 33 | services/microtraining/microtrainingFirestoreAdapter.ts | 132 | 🔵 | grantCert idempotente; workerUid del caller (ver N3 en route) |
| 34 | services/onboarding/faenaOnboardingBundle.ts | 178 | ✅ | engine deriveStatus puro |
| 35 | services/onboarding/faenaOnboardingFirestoreAdapter.ts | 75 | ✅ | adapter tenant-scoped |
| 36 | services/portfolioLessons/portfolioLessonsEngine.ts | ~300 | ✅ | engine transferencia puro |
| 37 | services/postTraining/postTrainingAssessmentEngine.ts | ~400 | ✅ | engine assessment puro, gate safety_critical |
| 38 | services/pymeOnboarding/pymeWizard.ts | ~200 | ✅ | engine madurez puro |
| 39 | services/pymeWizard/pymeOnboardingWizard.ts | ~250 | 🔵 | (B6) stack duplicado de pymeOnboarding |
| 40 | services/readReceipts/readReceiptService.ts | ~250 | ✅ | engine puro audience/deadline |
| 41 | services/readReceipts/readReceiptStore.ts | 116 | 🔴 | N2 client write a `read_receipts` sin regla → default-deny |
| 42 | services/roleOnboarding/roleOnboardingTracks.ts | ~300 | ✅ | engine tracks por rol puro |
| 43 | services/safetyTalks/safetyTalksStore.ts | 36 | ✅ | factory → safety_talks_given (regla :442) |
| 44 | services/safetyTalks/talkTopicSuggester.ts | ~250 | ✅ | engine sugeridor puro |
| 45 | services/skillGap/skillGapAnalyzer.ts | ~400 | ✅ | engine brecha/polivalencia puro |
| 46 | services/socialRecognition/wallEngine.ts | 241 | 🔵 | N10 engine sin adapter/route/UI; XP fuera del chokepoint |
| 47 | services/spacedRepetition/spacedRepetitionScheduler.ts | ~200 | ✅ | engine SM-2 puro |
| 48 | services/trainingBackend.ts | 98 | 🔵 | N11 dup shadow-eado por geminiBackend.ts:536 |
| 49 | services/vendorOnboarding/vendorAccreditationTracker.ts | ~200 | ✅ | engine acreditación puro |
| 50 | services/vendorOnboarding/vendorOnboardingFlow.ts | ~250 | ✅ | engine onboarding empresa puro |

## Archivos limpios (sin hallazgo nuevo): 3,5,6,7,10,13,14,15,16,17,18,19,20,21,25,26,27,29,30,31,32,34,35,36,37,38,40,42,43,44,45,47,49,50 (34/51).

---

## Resumen (6-10 líneas)

Lote EX-23 — 51/51 leídos. Tres 🔴 NUEVOS de peso: (N1) la co-firma "WebAuthn"
del currículum portátil — el diferenciador flagship — NUNCA se verifica:
`RefereeAccept.tsx` fabrica un string `"webauthn:<iso>"` local y
`claims.recordRefereeEndorsement` lo persiste verbatim; el endpoint real
`@simplewebauthn/server` (`/api/auth/webauthn/verify`) está completamente
desconectado del flujo de referee → un claim "verified" no tiene binding
criptográfico, el sello biométrico es teatro. (N2) la confirmación de lectura
obligatoria (DS44/RIOHS) se escribe 100% client-side a `read_receipts`, una
colección SIN regla de write → default-deny en prod (clase de bug TODO §17 que
omitió esta colección); el anti-blame del server route existe pero la página no
lo usa. (N3) microtraining otorga el certificado a `body.workerUid` arbitrario
sin compararlo con `callerUid` → impersonación de certificación, al revés del
peer `postTraining` que fuerza la identidad. 🟡: `training` (root) escrito
client-side bajo una regla admin/supervisor-only → o roto o asistencia/puntaje
auto-declarado (N4); field-path injection vía `reason` en gamificationBackend
(N5); `gamification.ts` filtra `error.message` en 5xx (#8, N6); `auditServerEvent`
de onboarding sin try/catch (#14, N7). 🔵: `PublicNodeView` lee colección
`zettelkasten` huérfana (vista pública muerta, N8); `wallEngine` y
`trainingBackend` son dead/duplicate code (N10/N11). Los 34 engines puros
server-wired del set (postTraining/skillGap/pyme/spacedRepetition/vendor/
microtraining-svc) son ejemplares. Doc-only, sin commit.
