# DEEP-EX #7 — B3-Ergonomia [0:29] · 2026-06-02

**Atestación:** leídos 29/29 línea por línea (lote derivado de
`ledger.json` → `category` empieza con "FEAT" && `block==="B3-Ergonomia"`,
ordenado por `path`, slice [0:29] = todos). No se repiten hallazgos de
`DEEP-B3-Ergonomia.md`; abajo solo lo NUEVO.

## Hallazgos NUEVOS

| Archivo:línea | Severidad | Hallazgo | Evidencia |
|---|---|---|---|
| `src/pages/BioAnalysis.tsx:411-415` | 🔴 | **Regla #12 — frame de cámara EN VIVO sale del dispositivo.** `captureAndAnalyze` toma un frame del `<video>` en directo, **solo difumina el rostro** (15px blur de la bounding-box facial, `:404-405`) y envía el JPEG base64 completo (cuerpo + entorno + EPP) a Gemini Vision (`analyzeBioImage`, whitelisted en `gemini.ts:156`). Regla #12 dice literal "No camera frames … leave the device". Face-blur ≠ on-device. A diferencia del fallback del modal IA (foto estática subida a mano), aquí es captura de cámara viva. | `:364-415`; egress vía `geminiService.ts:92` → server proxy |
| `src/pages/BioAnalysis.tsx:465-487` | 🔴 | **Escritura Firestore sin regla + sin audit (Regla #3 + #4).** `saveToRiskNetwork` hace `addDoc(collection(db, 'projects/{id}/findings'))` pero `findings` NO tiene regla en `firestore.rules` (el master gate `:258-260` solo da **read**; `grep findings firestore.rules` = 0). Default-deny ⇒ el write se rechaza en runtime (cae al `catch :489`, toast genérico) — bug funcional silencioso. Además es op state-changing sin `logAuditAction` (viola invariante audit-log). | `firestore.rules:258-260` (read-only gate); sin `match /findings` |
| `src/pages/BioAnalysis.tsx:64-90` | 🟡 | **Side-effect Firestore dentro del render.** El IIFE `pulmonaryErgonomics` se evalúa en cuerpo del componente y llama `writeNodesDebounced([node], …)` (`:82`) en cada render con PEF válido — escritura a Firestore durante render de React (anti-patrón; puede disparar en cada keystroke del input PEF/altitud). | `:64,73-83` |
| `src/pages/BioAnalysis.tsx:130-164` | 🟡 | **MediaPipe hard-wired al CDN público de Google (sin local-first).** WASM + 3 modelos (`face`, `pose`, `object`) cargan siempre desde `cdn.jsdelivr.net` / `storage.googleapis.com` (tasks-vision **0.10.3**, versión vieja). No usa el patrón local-first de `useMediaPipePose.ts`. Egress a CDN de terceros evitable (Ley 19.628). | `:135,140,150,159` |
| `src/components/ergonomics/AIPostureAnalysisModal.tsx:277` | 🔴 | **Crash en `handleSave` por `bodyParts` ausente en fallback Gemini.** `handleSave` lee incondicionalmente `analysisResult.bodyParts.neck/.trunk/.arms/.legs` (`:277`). El path Gemini (`analyzeWithGemini :216`) propaga `result.bodyParts` que el `responseSchema` server NO garantiza (ya notado por DEEP-B3 solo para el render). En el save ⇒ `TypeError: reading 'neck' of undefined` y la evaluación NO se guarda. | `:206-217` (fallback) vs `:277` (save) |
| `src/services/protocols/protocols.ts`→`src/server/routes/protocols.ts:103-167` | 🔵 | **Doc-drift: DEEP-B3 afirma "TMERT/PREXOR sin route ni persistencia".** FALSO. `src/server/routes/protocols.ts` expone `POST /:projectId/protocols/{iper,prexor,tmert}` con `verifyAuth` + `assertProjectMember`, montado en `server.ts:1142` (`/api/sprint-k`), con cliente `useProtocols.ts`. El §2 de `DEEP-B3-Ergonomia.md:106-109` quedó desactualizado. | `server.ts:1142`; `useProtocols.ts:48,64,80` |
| `src/server/routes/ergonomics.ts:115-119` | 🟡 | **Errores de validación del motor REBA/RULA → 500 en vez de 400.** A diferencia de `protocols.ts` (que mapea `IPER:`/`PREXOR:`/`TMERT:` a 400, `:82-84`), las rutas reba/rula capturan TODO como `internal_error` 500. Un input que pasa Zod pero falla `validate()` del engine (ej. coupling inválido) devuelve 500 — UX/clasificación incorrecta. | cf. `protocols.ts:82,116,159` |
| `src/services/protocols/prexor.ts:35` | 🔵 | **Doc-drift en motor (ejemplo trabajado con fórmula 10 dB).** El header corrigió 10→3 dB (header `:21-24`), pero el ejemplo trabajado `:35` aún escribe `(10/log10(2))*log10(3.175)` y afirma "≈ 90 dB(A)". Verificado: la fórmula del comentario da **101.67 dB**; el CÓDIGO (3 dB, `:117`) da exactamente 90.0. El comentario es residual e incorrecto (el código es correcto). | `:35` vs `:117` |
| `src/services/ergonomics/landmarksToScore.ts:154-156` | 🔵 | **Dead helper `elbowJointToFlexion`.** Definido pero nunca invocado; el adapter pasa el ángulo articular crudo (`:214,280,295`). Código muerto safety-adjacent (confunde el contrato 60-100°). | `:154-156` no callsites |
| `src/hooks/useMediaPipePose.ts:9-10` | 🔵 | **Doc-drift intra-archivo.** El docstring dice "El modelo `.task` se sirve actualmente desde el CDN público de Google. Bundlearlo localmente queda para Ola 5 Bucket O." — pero el código YA implementa local-first con probe (`:59-129`). El comentario contradice la implementación. | `:9-10` vs `:73-129` |
| `src/hooks/useAmbientNoise.ts:41` | 🟡 | **"noiseLevel" NO es dB(A) calibrado.** Devuelve un promedio FFT 0-255 → 0-100 con multiplicador arbitrario `*1.5` ("more sensitive"). Si alguna vez se alimenta como `levelDbA` a PREXOR sería acústicamente inválido (no hay calibración SPL). Documentar que es indicativo visual, no medición legal. | `:41` `* 100 * 1.5` |
| `src/services/systemEngine/adapters/firebaseContextAdapter.ts:11-13` | 🔵 | **Stub sin registrar (Regla #13).** `useFirebaseContextAdapter` cuerpo vacío ("Intentionally empty"), exportado (`adapters/index.ts:20`) pero 0 callsites reales; sin `// TODO(sprint-N): <owner>` ni entrada en `docs/stubs-inventory.md`. Invisible a usuarios, pero incumple el contrato anti-stub-disfrazado. | `:11-13`; `grep` inventory = 0 |
| `src/pages/BioAnalysis.tsx:52,96,108` | 🔵 | Tipado laxo: `history: any[]` (`:52`), `(navigator as any).bluetooth` (`:96`), `(e: any)` parse temp BLE (`:108`). Sin impacto runtime directo pero pierde type-safety en path biométrico. | `:52,96,108` |

## Notas de validación (NO hallazgos)

- **REBA/RULA tablas:** re-verificadas verbatim; clamps `reba.ts:350-351` /
  `rula.ts:213-225` recortan ajustes que exceden el tamaño de tabla (neck→3,
  trunk→5, etc.) — comportamiento estándar del worksheet, no off-by-one.
- **`awardXp` (ergonomicAssessments.ts:216)** es **síncrono** (retorna
  `AwardXpResult`, no promesa) → el try/catch sin `await` es correcto; NO hay
  unhandled rejection. (Descartado tras leer `positiveXp.ts:30`.)
- **`Math.random()`:** ausente en los 29 archivos; el writer usa `randomId()`
  (`ergonomicAssessments.ts:34,115`). Regla #15 OK.
- **AddErgonomicsModal / ergonomicAssessments / ergonomicLegalTrigger:** save
  path limpio (writer con audit awaited + addNode mirror); legal-trigger
  fire-and-forget que nunca lanza. Sin hallazgos nuevos.
- **`roleSummaryComposer.ts` / `preShiftRiskComposer.ts`:** confirmados puros y
  sin contenido ergonómico (mal-etiquetados en ledger, ya notado por DEEP-B3).
- **`zkFirebaseReadAdapter.ts`:** read-only por contrato, tenant-gated
  (`assertTenantAllowed`), caps BFS/list. Sin write. Limpio.
- **CargoCogPanel / HeatStressCard / BucklingCalculatorCard:** presentacionales
  sobre motores puros. Limpios.
- **HumanBodyViewer.tsx:** registra "Lesión" (severidad elegida por el usuario,
  no IA) → no viola ADR 0012; fuera de los paths escaneados por
  `precommit-medical-guard.cjs`. No renderiza `<MedicalDisclaimer/>` pero no
  está en el set guardado.

## Archivos limpios: 11

`reba.ts`, `rula.ts`, `tmert.ts`, `ergonomicAssessments.ts`,
`ergonomicLegalTrigger.ts`, `useErgonomics.ts`, `useProtocols.ts`,
`useFrequencyAnalysis.ts`, `roleSummaryComposer.ts`,
`preShiftRiskComposer.ts`, `firebase.ts`.
(El resto tiene ≥1 hallazgo nuevo o doc-drift listado arriba.)
