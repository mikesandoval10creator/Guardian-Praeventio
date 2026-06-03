# DEEP-EXT-21 — Auditoría exhaustiva de tests (Lote #21)

**Alcance:** `ledger.json` → `category==="I-TEST"`, ordenado por `path`, slice `[1100:1155]` (55 archivos).
**Método:** lectura línea por línea de cada test, cazando falsos-verdes (rules-tests con Admin SDK / silent-pass, datos sintéticos del gate, asserts equivocados, over-mocking / mockear la función bajo prueba, "ID crypto contract" tautológico, reimplementación-disfrazada, "wire-up contract" solo `.stack`, validate→next sin 400, asserts triviales/vacíos, skip/todo/fixme/`it()`-vacío, snapshot-only, tests que pasarían con impl incorrecta).
**Veredicto global:** Lote de **muy alta calidad**. Domina el subsistema SLM/offline (≈21 archivos) más SII/SUSESO/siteBook/sync, casi todos engines puros + adapters con asserts de valor concreto, vectores SHA-256 reales, round-trips de cripto y leyes algebraicas CRDT. **0 hallazgos 🔴.** **5 hallazgos 🟡** (un `it()` sin assert, nombres sobre-vendidos de firma, tautología auto-mock benigna). Varias notas 🔵 de patrones aceptables y honestamente documentados.

**Archivos revisados: 55/55.** Sin `.skip`/`.todo`/`it.only`. Un (1) `it()` efectivamente vacío (cuerpo solo-comentarios, ver 🟡-1). Sin snapshot-only. El único `*.firestore.test.ts` (`siteBookCounter.firestore.test.ts`) es round-trip legítimo contra emulador, NO rules-test con Admin SDK disfrazado.

---

## 🔴 Hallazgos críticos (falso-verde real)

Ninguno.

---

## 🟡 Hallazgos medios (debilidad / cobertura sobre-vendida)

### 🟡-1 `slm/hmac.test.ts:141-150` — `it()` sin ningún `expect` (test vacío)
**Módulo:** `services/slm/hmac`.
El caso `'persists the key across a "page reload" (re-import from sessionStorage)'` arma `tagA`, llama `__resetSessionKeyForTesting()` y **termina sin un solo assert** — el cuerpo restante es solo comentarios (l.146-149) que admiten "we can't test pure reload via that helper alone". Es un test que **siempre pasa** sin verificar nada. El comportamiento de persistencia que pretendía cubrir queda cubierto parcialmente por el caso siguiente (l.152-171, "emits the same tag from a known-good key persisted in sessionStorage"), así que el agujero real es bajo, pero el `it()` debería eliminarse o convertirse en `it.todo`.

### 🟡-2 `sii/dteSigner.test.ts:106-128` — nombre "firma con passkey válida" sobre-vende: NO verifica la firma criptográfica
**Módulo:** `services/sii/dteSigner`.
El test pasa con `signature: 'c2lnLWZha2U='` (literalmente "sig-fake" en base64). Confirmado en el impl (`dteSigner.ts:177-186`): `verifyAndSignDte` hace solo un **chequeo de presencia** de los campos WebAuthn, NO `verifyAuthenticationResponse`. La verificación cripto real está delegada al route handler (documentado en el impl, l.168-176). El test es correcto respecto a lo que el impl hace, pero el nombre "firma con passkey **válida**" da falsa confianza: una firma forjada de longitud no-nula también pasaría. El hash-mismatch (l.169) y payload-incompleto (l.189) sí están bien cubiertos. Renombrar a "embeds the WebAuthn assertion (presence-checked)".

### 🟡-3 `slm/slmRuntime.test.ts:451-591` — integrity check tautológico en el split-bundle (digest mockeado a sí mismo)
**Módulo:** `services/slm/slmRuntime`.
En los dos casos de split bundle se hace `vi.spyOn(crypto.subtle,'digest')` devolviendo el hash que el test desea según la URL (`principal`→PHI_PRINCIPAL_SHA, `companion`→PHI_COMPANION_SHA). Es decir, el control de integridad se compara contra un digest fabricado por el propio test → **la comparación SHA-256 no se ejercita** aquí. El propio comentario (l.451-455, 472) lo admite ("isolates the bundle-orchestration logic without coupling to real SHA-256"). Aceptable porque estos casos prueban orquestación (fan-out de fetch, threading de `externalData`, mensaje de error que nombra el companion), y la integridad real SÍ se cubre con vectores reales en `slmIntegrityGuard.test.ts` y en los casos single-file de este mismo archivo (l.88-135). Pero el caso "companion mismatch" (l.536) es self-fulfilling: pasa porque el test elige el hash malo. Riesgo bajo, nota de transparencia.

### 🟡-4 `slm/slmAcquisitionService.test.ts:194-201` — assert near-tautológico sobre `detectNetworkAdvisory`
**Módulo:** `services/slm/slmAcquisitionService`.
`expect([...5 valores...]).toContain(result)` acepta **cualquier** valor del enum. Pasaría aunque la función siempre devolviera `'unknown'` o el valor equivocado para el navigator dado. No hay forzado del estado `navigator.connection`/`onLine` para anclar una salida concreta. Debilidad de cobertura (el resto del archivo es muy sólido: cooldowns, eviction-recovery, per-modelo isolation con fechas concretas).

### 🟡-5 `suseso/diatPdfRenderer.test.ts` — surface-only: valida el envoltorio PDF, no el contenido
**Módulo:** `services/suseso/diatPdfRenderer`.
`assertValidPdf` chequea header `%PDF-`, tamaño 1KB–100KB y trailer `%%EOF`. **No** verifica que el folio/RUT/descripción aparezcan en el cuerpo. Un regression que renderice un PDF válido pero con cuerpo en blanco o campos cruzados pasaría. El header del test es honesto (l.7-13) y difiere la verificación de contenido a un E2E con pdf.js. Limitación conocida y razonada; se documenta por completitud.

---

## 🔵 Notas (patrones aceptables, sin acción)

- **Subsistema SLM/offline — calidad excepcional.**
  - `slmIntegrityGuard.test.ts` usa **vectores SHA-256 canónicos reales** (empty/`hello`/`abc`) verificados contra `sha256sum`; ejercita WebCrypto de verdad, no un stub. ✅
  - `slmRuntime.test.ts` + `slmRuntime.offline.test.ts` — fail-closed en hash null en producción (§2.9), AbortSignal pre/mid-loop, EOS-corta-loop, maxTokens cap, byte-level tokenizer determinístico (65→'A'). ✅
  - `reconciliation.test.ts` / `reconciliationRunner.test.ts` — el tamper-test de HMAC mutila el registro **directamente en IndexedDB** y verifica que `writeFn` NUNCA se llama + Sentry `slm.queue.hmac_mismatch`. Legacy-passthrough con breadcrumb. ✅
  - `orchestrator.test.ts` — matriz 4-cuadrantes mutation-hardened (`=== true` estricto, string-truthy NO override), seams de analytics y `tryGetIdToken` con todos los bordes del guard. ✅
  - `slmRuntimeWorkerCore.test.ts` — protocolo worker completo (load/infer/stream/abort/release/ping), codes de error (`unknown_model`, `integrity_failure`, `handle_not_found`, `infer_failure`), handle removido post-release. ✅
  - `encryptedOfflineQueue.test.ts` — WebCrypto Node real, at-rest = envelope (no plaintext), tamper→throw, KEK borrada→KEK_MISSING, migración legacy idempotente. ✅
  - `sampling.test.ts` — math pura: greedy/nucleus/top-K/top-P, mulberry32 seedable reproducible, repetition-penalty sign-flip + dedup. ✅
  - `modelCache/loader/onnxAdapter/slmAdapter/registry/guardianOffline/reconciliationAutoTrigger` — fake-indexeddb real, fetch streaming por chunks, ciclo de vida del worker, cache-hit/miss, RAG offline con citations. ✅
- **siteBook.**
  - `siteBookCrdt.test.ts` — leyes algebraicas CRDT (LWW conmutativo, OR-Set add/remove/resurrect, status-lattice, merge conmutativo/idempotente/asociativo, post-firma inmutable). Excelente. ✅
  - `siteBookFirestoreAdapter.test.ts` / `siteBookCounter.firestore.test.ts` — adapter sobre fake-firestore + counter round-trip real contra emulador (por-año/por-proyecto). El fake `runTransaction` no aísla, así que la seguridad concurrente del counter no se prueba en el adapter; el firestore.test cubre el path real. ✅
  - `siteBookService.test.ts` / `siteBookSigning.test.ts` / `siteBookSigningClient.test.ts` — folio padding, no-doble-firma, corrección solo-signed; hash payload determinístico+avalanche+ignora campos volátiles; orquestador WebAuthn con `navigator.credentials.get` mockeado, NotAllowedError→SignCancelledError. `buildSignatureRecord` arma el record sin verificar la firma cripto (igual patrón que dteSigner, pero scope honesto de "pure helper"). ✅
- **SII / SUSESO.**
  - `siiAdapter.test.ts` — IVA con ceil cruzado contra `pricing/tiers.withIVA` (drift trips both), exento/mixto, rechazo de fraccionales/negativos, stubs PSE lanzan `SiiNotImplementedError` con docs URL. ✅
  - `siiPreflightCheck.test.ts` — RUT mod-11 (5 válidos/5 inválidos), acumulación multi-falla, anti-tampering ISSUER_RUT_MISMATCH, boleta-sin-receptor permitida. ✅
  - `susesoApiClient.test.ts` — fetch inyectado, asserts de URL/method/headers/body, error-por-status. ✅
  - `folioGenerator.test.ts` — simula retry OCC con "ghost write" mid-transaction; contadores por tenant/año/kind independientes, sin gaps. ✅
  - `susesoServerOnlyHelpers.test.ts` — HMAC SHA-256 **real** (firma/tamper/wrong-key), canonicalize determinístico, token débil rechazado. ✅
  - `cumplimientoCalculator.test.ts` — fórmulas oficiales SUSESO/OIT (TA/TF/TG/Walsh, penalty fatal 6000 días) con valores numéricos exactos. ✅
  - `reminders.test.ts` — deadlines DS 109, escalationLevel por umbral, idempotency key UTC-rollover. ✅
- **sync.** `conflictResolver.test.ts` (LWW vs critical-field manual, deletion conflict, additive merge), `monotonicSync.test.ts` (push apply/conflict, pull watermark+limit+hasMore, prefetch plan), `syncStateMachine.test.ts` (idb-keyval in-memory), `encryptedOutboxAdapter.test.ts` (round-trip cifrado real). ✅
- **Otros engines puros.** `skillGapAnalyzer` (gaps/training-plan/polyvalence/substitutes), `spacedRepetitionScheduler` (SM-2: ease 2.5, intervalos 1→6, reset<3, mín 1.3), `supplierScoring` (math de breakdown exacta + tiebreak), `wallEngine` (XP por kind, self-recognition forbidden), `requirementGate` (pass/soft_block/cannot_override, override). Determinismo + rejection-paths consistentes. ✅
- **Patrón honesto recurrente:** varios tests de firma (dteSigner, siteBookSigning) verifican **presencia/forma** de la assertion WebAuthn y delegan la verificación cripto al route handler, documentándolo inline. No es falso-verde mientras el route handler tenga su propio test (fuera de este slice) — solo el *nombre* en dteSigner sobre-vende (🟡-2).

---

## Conteo

| Severidad | Cantidad |
|---|---|
| 🔴 Críticos (falso-verde real) | 0 |
| 🟡 Medios (debilidad / sobre-venta) | 5 |
| 🔵 Notas (aceptable) | — (agrupadas) |
| **Archivos revisados** | **55 / 55** |

**Falsos-verdes accionables:** 1 (`hmac.test.ts:141` — `it()` sin assert → borrar o `it.todo`).
**Nombres a renombrar:** 1 (`dteSigner.test.ts:106` — "firma con passkey válida" → "presence-checked").
**Sin acción, transparencia:** 3 (🟡-3 digest auto-mock, 🟡-4 advisory near-tautológico, 🟡-5 PDF surface-only).
