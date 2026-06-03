# DEEP — B3 Ergonomía & Protocolos MINSAL · 2026-06-02

**Archivos revisados:** 18 (núcleo ergonomía/protocolos del bloque B3; 6 entradas
del ledger marcadas `B3-Ergonomia` son infraestructura Firebase compartida o
composers no-ergonómicos — ver §3 y nota de alcance).

Leyenda de estados: ✅ implementado y cableado · 🟡 implementado, gap/deuda · 🏚️
placeholder/stub · 🔵 tangencial al bloque (mal-etiquetado) · 🔑 invariante de
seguridad/compliance.

---

## 1. Lo que YA HACE (implementado y real)

- **Motores REBA/RULA/TMERT/PREXOR puros y deterministas.** Cero `import`, cero
  `fetch`/Firestore/`Date.now()`/`Math.random()`. Tablas canónicas verbatim del
  paper:
  - `reba.ts` — tablas A (5×3×4), B (6×2×3), C (12×12); `calculateReba` →
    `finalScore` 1..15 + `actionLevel`. Validación de rango ±180° y campos
    requeridos (`reba.ts:287-330`, entry `reba.ts:339`). 54 casos de test.
  - `rula.ts` — tablas A/B/C de McAtamney & Corlett 1993; `calculateRula` →
    1..7 + `actionLevel` 1..4 (`rula.ts:248`). 78 casos de test.
  - `tmert.ts` — Norma Técnica MINSAL TMERT-EESS 2012: 4 factores × 3
    condiciones, riesgo bajo/medio/alto; `requiresMedicalEvaluation` solo cuando
    `alto` (`tmert.ts:91-106`). Comentario documenta remoción de flag muerto
    `enableExposureAmplifier` (`tmert.ts:17-23`). 9 tests.
  - `prexor.ts` — DS 594 art. 75 + Decreto MINSAL 685/2009, dosis con exchange
    rate Q=3 dB chileno; `calculatePrexor` → `dosePercent`, `leqEq8hDbA`,
    `exceedsLegalLimit` (`prexor.ts:102-128`). El header documenta y corrige una
    discrepancia en la spec original (10 dB vs 3 dB) — sigue Q=3 por DS 594
    (`prexor.ts:21-24`). 15 tests.
- **Pipeline biométrico 100% on-device** (Regla #12 cumplida en el path
  primario):
  - `useMediaPipePose.ts` — envuelve `@mediapipe/tasks-vision` PoseLandmarker en
    WASM, lazy-import, `runningMode:'IMAGE'`, `numPoses:1`, cleanup en unmount.
    **Local-first**: HEAD-probe a `/models/mediapipe/` y cae al CDN solo si el
    prebuild no bajó el `.task` (`useMediaPipePose.ts:73-129`). El SDK procesa la
    imagen en el dispositivo; devuelve 33 landmarks normalizados — **no sube la
    imagen** (`analyzeImage` línea 160-191).
  - `landmarksToScore.ts` — matemática 3D pura (sin DOM), convierte landmarks a
    `RebaInput`/`RulaInput`. Conservador: usa el peor lado (asimetría) y exige
    `visibility ≥ 0.5`, lanzando error explícito si hombros/caderas no visibles
    para que el caller decida fallback (`landmarksToScore.ts:159-246`). 12 tests.
- **AIPostureAnalysisModal** — path **primario = MediaPipe local** → REBA+RULA;
  pinta esqueleto en overlay canvas; persiste vía `useRiskEngine.addNode`
  (`AIPostureAnalysisModal.tsx:158-203, 251-298`). Etiqueta fuente
  `mediapipe`/`gemini` en tags y metadata.
- **Persistencia append-only post-firma** (`ergonomicAssessments.ts`):
  `recordErgonomicAssessment` escribe `ergonomic_assessments` con
  `metadata.signedAt:null`, audit log **awaited** `safety.<type>.completed`
  (`ergonomicAssessments.ts:174-179`); `signErgonomicAssessment` rechaza
  re-firma (`:261-263`) y emite `safety.<type>.signed`. 45 + 88(xpHook) tests.
- **Trigger legal DS-594 art. 110** (`ergonomicLegalTrigger.ts`): REBA≥11 /
  RULA≥7 → folio DIEP pre-asignado + nodo Zettelkasten derivado + audit
  `ergonomic.legal_threshold_crossed`. Fire-and-forget que NUNCA lanza
  (`:97-166`); no rompe el save técnico (record-of-truth).
- **HTTP surface** `ergonomics.ts` — `POST /api/sprint-k/:projectId/ergonomics/
  calculate-{reba,rula}` con `verifyAuth` + `assertProjectMember` (guard
  `:39-54`) + validación Zod + 500 genérico `internal_error`. Compute puro, sin
  escrituras. Cliente: `useErgonomics.ts` (prefijo coincide con mount
  `server.ts:1138`).
- **PoseEdgeFilter** (`poseEdgeFilter.ts`) — política mesh de 2 fases: fase 1
  payload mínimo + cita normativa, fase 2 (30 s) solo **landmarks, jamás la
  imagen** (`:50-54, 192-232`); `blockOperation:false` siempre (`:255`); solo a
  supervisor por mesh, no a organismos.
- **Firestore rules** `ergonomic_assessments` (`firestore.rules:698-715`):
  default-deny + create exige `signedAt==null` y `type in [REBA,RULA]`; update
  exige `existing().metadata.signedAt==null` y `hasOnly([metadata,inputs,score,
  actionLevel])`; **delete:false** (Ley 16.744 Art. 76 + ISO 45001 §7.5.3).

---

## 2. Lo que está PENDIENTE (deuda de este bloque)

- **🟡 Regla #12 — el fallback Gemini Vision sube la imagen del trabajador.**
  `AIPostureAnalysisModal.tsx:206-210` (`analyzeWithGemini`) envía el `base64`
  de la foto al backend, que llama a `analyzePostureWithAI`
  (`gemini/vision.ts:24-65`) → `inlineData` a `gemini-3.1-pro-preview` de Google.
  El propio header de `vision.ts:13-17` afirma que estas funciones "SOLO se usan
  en modos servidor explícitos... NO en el flow operativo del trabajador", pero
  el modal SÍ las invoca como fallback en el flujo operativo. **Matiz**: es una
  foto estática que el usuario sube manualmente (`<input type=file>`,
  `:588-594`), no un frame de cámara en vivo; aun así es una imagen del
  trabajador saliendo del dispositivo. Deuda histórica documentada — decisión
  de usuario abajo.
- **🟡 `analyzePostureWithAI` ignora el resultado tipado de Gemini sin schema
  estricto en el cliente.** El modal asume `{score, findings, recommendations,
  bodyParts}` (`AIPostureAnalysisModal.tsx:211-217`) pero `bodyParts` NO está en
  el `responseSchema` server-side (`vision.ts:52-60` solo pide score/findings/
  recommendations) → `bodyParts` puede llegar `undefined` y romper el render
  segmentado del fallback.
- **🟡 `landmarksToScore.ts` no está en el scope de mutation testing.**
  `stryker.config.json:29-35` cubre reba/rula/tmert/prexor/ergonomicAssessments
  pero NO `landmarksToScore.ts` (el adapter que decide ángulos articulares
  conservadores) ni `poseEdgeFilter.ts`. Es matemática safety-critical sin gate
  de mutación.
- **🟡 Muñeca siempre neutra desde landmarks.** `landmarksToScore.ts:281,296`
  fija `wrist.flexionDeg:0` porque MediaPipe Pose no da flexión fina de muñeca —
  subestima REBA/RULA en tareas con desviación de muñeca. Documentado inline,
  pero es un sesgo a la baja en scoring legal.
- **🟡 Modelo MediaPipe puede caer al CDN público de Google.** Si el dev/CI no
  corrió `npm run prebuild`, `useMediaPipePose.ts:122-129` sirve WASM+modelo
  desde jsdelivr/storage.googleapis.com — egress que el propio comentario marca
  como evitable por Ley 19.628/GDPR. No sube datos del trabajador, pero sí
  contacta CDNs de terceros.
- **🔵 TMERT/PREXOR sin superficie HTTP ni persistencia propia.** A diferencia
  de REBA/RULA (route + writer + rules), `tmert.ts`/`prexor.ts` son solo motores
  puros; no hay endpoint, colección Firestore, ni modal que los cablee (grep sin
  callsites de UI). Funcionan pero no están expuestos al usuario final.
- **🟡 Doc drift en firestore.rules.** El comentario `firestore.rules:696`
  referencia `src/services/protocols/ergonomic.ts` que no existe (el writer real
  es `src/services/safety/ergonomicAssessments.ts`). Cosmético.
- **PLAESI: NO existe en `src/`.** Grep `plaesi` en todo el repo = 7 matches,
  todos en `docs/audits/CONTEXT_AUDIT_2026-06.md`; cero en código/tests/i18n. El
  protocolo PLAESI (Planilla de Evaluación de Esfuerzo Físico / levantamiento de
  carga MAC-MINSAL) **no está implementado**.

---

## 3. Tabla por archivo (TODOS)

| Archivo | LOC | Estado | Cableado | Propósito real + hallazgo file:line |
|---|---|---|---|---|
| `src/services/ergonomics/reba.ts` | 379 | ✅🔑 | route + modales + writer | Motor REBA puro determinista. Tablas verbatim, 0 side-effects. `reba.ts:339` |
| `src/services/ergonomics/rula.ts` | 285 | ✅🔑 | route + modales + writer | Motor RULA puro. Tablas A/B/C McAtamney 1993. `rula.ts:248` |
| `src/services/protocols/tmert.ts` | 107 | ✅ / 🔵 | sin route/UI (solo motor) | TMERT-EESS MINSAL 2012, 4 factores. Sin endpoint ni modal. `tmert.ts:91` |
| `src/services/protocols/prexor.ts` | 129 | ✅ / 🔵 | sin route/UI (solo motor) | PREXOR ruido DS594 art.75, Q=3 dB. Corrige spec 10dB→3dB `prexor.ts:21-24` |
| `src/services/ergonomics/landmarksToScore.ts` | 315 | ✅🟡 | usado por modal MediaPipe | 33 landmarks→REBA/RULA, peor-lado conservador. Muñeca fija a 0 `:281,296`. Fuera de mutation `stryker:29-35` |
| `src/services/ergonomics/poseEdgeFilter.ts` | 283 | ✅ | mesh (uso edge) | Mesh 2 fases; fase 2 solo landmarks, jamás imagen `:50-54`. blockOperation:false `:255` |
| `src/hooks/useMediaPipePose.ts` | 195 | ✅🔑🟡 | modal IA | PoseLandmarker WASM on-device. Local-first con fallback a CDN Google `:122-129` |
| `src/components/ergonomics/AIPostureAnalysisModal.tsx` | 599 | 🟡 | página Ergonomics | Primario=MediaPipe local; **fallback Gemini sube foto** `:206-210` (Regla #12) |
| `src/components/ergonomics/AddErgonomicsModal.tsx` | 1012 | ✅ | página Ergonomics | Wizard manual REBA/RULA → `recordErgonomicAssessment` `:333` + addNode `:348` |
| `src/pages/Ergonomics.tsx` | 238 | ✅ | router lazy | Lista assessments, 2 CTAs (IA + manual), stats. `:60-237` |
| `src/hooks/useErgonomics.ts` | 61 | ✅ | client de route | Wrapper HTTP calculate-reba/rula, prefijo `/api/sprint-k` `:41,56` (=mount `server.ts:1138`) |
| `src/server/routes/ergonomics.ts` | 189 | ✅🔑 | montado server.ts:1138 | POST calc-reba/rula, verifyAuth+assertProjectMember `:39-54`, Zod, compute puro |
| `src/services/safety/ergonomicAssessments.ts` | 280 | ✅🔑 | AddErgonomicsModal | Writer Firestore append-only; audit awaited `:174`; refuse re-sign `:261` |
| `src/services/safety/ergonomicLegalTrigger.ts` | 167 | ✅🔑 | recordErgonomicAssessment | REBA≥11/RULA≥7→DIEP+audit. Fire-and-forget nunca lanza `:97-166` |
| `src/services/gemini/vision.ts` | 162 | 🟡 | fallback del modal IA | `analyzePostureWithAI` sube imagen a Gemini `:24-65`; header niega uso operativo `:13-17` |
| `firestore.rules` (bloque ergo) | — | ✅🔑 | rules engine | `ergonomic_assessments` append-only post-firma `:710-714`, delete:false `:714` |
| `src/services/multiRoleSummary/roleSummaryComposer.ts` | 431 | 🔵 | — | Sin contenido ergonómico (grep 0). Mal-etiquetado en ledger como B3 |
| `src/services/shiftRiskPanel/preShiftRiskComposer.ts` | 337 | 🔵 | — | Sin contenido ergonómico (grep 0). Mal-etiquetado en ledger como B3 |

> Nota de alcance: el filtro `block==="B3-Ergonomia"` también incluye 6 entradas
> de infraestructura Firebase compartida (`firebase*.json`,
> `firebase-messaging-sw.js`, `FirebaseContext.tsx`, `services/firebase.ts`,
> `firebaseContextAdapter.ts`, `zkFirebaseReadAdapter.ts`) y 2 composers
> no-ergonómicos. No son del dominio ergonomía/protocolos MINSAL y se excluyen
> de la revisión a fondo (cubiertos por su bloque real de Firebase/sistema).

---

## 4. Para decisión del usuario (❓/⚠️)

- **⚠️ Regla #12 vs fallback Gemini Vision.** ¿Se acepta que la foto estática
  que el prevencionista sube manualmente salga del dispositivo hacia
  `gemini-3.1-pro-preview` cuando MediaPipe no detecta pose
  (`AIPostureAnalysisModal.tsx:206-210` → `vision.ts:24-65`)? Opciones: (a)
  retirar el fallback y forzar recaptura on-device; (b) mantenerlo con
  consentimiento explícito + entrada en `security_spec.md`; (c) blur/anonimizar
  rostro antes de enviar. Hoy el header de `vision.ts:13-17` ya documenta que el
  uso operativo NO debería ocurrir — el código contradice su propio comentario.
- **❓ ¿Implementar PLAESI?** No existe en `src/` (solo citado en docs). Si es
  requisito de compliance MINSAL (manejo manual de carga MAC), es un motor puro
  faltante en el patrón de reba/rula.
- **❓ Mutation gate para `landmarksToScore.ts` y `poseEdgeFilter.ts`.** Ambos
  son safety-critical y quedan fuera de `stryker.config.json:29-35`. ¿Ratchet
  R21 los incorpora?
- **❓ Exponer TMERT/PREXOR.** Los motores existen y están testeados pero no
  tienen route/UI/persistencia. ¿Cablearlos al patrón ergonomics (endpoint +
  colección append-only + wizard) o quedan como librería interna?
- **⚠️ `bodyParts` ausente del schema Gemini.** El render del fallback
  (`AIPostureAnalysisModal.tsx:211-217`) consume `result.bodyParts` que el
  `responseSchema` server (`vision.ts:52-60`) no garantiza → riesgo de
  `undefined` en runtime.
