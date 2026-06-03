# DEEP-EXT-02 — Auditoría EXHAUSTIVA de TESTS (Lote #2)

**Deriva:** `ledger.json` → `category==="I-TEST"`, ordenado por `path`, slice **[55:110]**
**Total I-TEST en ledger:** 1247
**Archivos en este lote:** 55 (índices 55–109)
**Atestación de lectura:** 55/55 leídos línea por línea (cada `it()`, cada `expect`, cada `vi.mock`).

Metodología: para cada archivo se verificó (a) si monta el router REAL (`src/server/routes/*`)
o una copia paralela (`buildTestServer` / handler mirror); (b) qué seams se mockean y si el
mock tapa el sujeto bajo prueba; (c) si los `expect` afirman sobre el campo/valor correcto o
son tautológicos respecto al mock; (d) presencia de skip/todo/empty-body/false-green.

---

## Hallazgos — Tests débiles / falsos-verdes / sospechosos

| Test:línea | Módulo-sujeto | Tipo | Por qué |
|---|---|---|---|
| `confidentialReports.test.ts:21-58` (todo el archivo) | `src/server/routes/confidentialReports.ts` | 🔴 FALSO-VERDE — no toca el sujeto | El header dice "verifica que la impl usa `crypto.randomUUID()`", pero NUNCA importa ni llama código de producción. Construye IDs localmente con `randomUUID()` y solo valida regex + unicidad. Pasaría idéntico si producción usara `Math.random()` o un contador. Está testeando el `crypto.randomUUID` de Node, no el módulo. |
| `drivingSafety.test.ts:16-27` (todo el archivo) | `src/server/routes/drivingSafety.ts` | 🔴 FALSO-VERDE — no toca el sujeto | Mismo patrón: "la impl usa `crypto.randomUUID()`", pero construye `route_<ts>_<uuid>` localmente y solo verifica shape + inequidad. No importa producción. No detecta regresión de entropía en el sujeto. |
| `coachChatTenant.test.ts:43-102` (`buildApp`) | `/api/coach/chat` (server.ts) | 🟡 Test de copia paralela | `buildApp()` REIMPLEMENTA el handler (middleware `assertMember`, el 400-missing-projectId y el `audit_logs.add`) en el propio archivo. Comparte solo el helper puro `assertProjectMember`. El comentario afirma "1:1 verdicts" pero el wiring del route real, la rama 400 y el audit-write son re-código del test → una regresión en el route de producción NO se detecta. |
| `confidentialReports.router.test.ts:31-41` | `confidentialReports.ts` | 🟡 Over-mock de gates clave | Mockea `validate` a `next()` (toda la validación Zod bypasseada → 0 cobertura de 400 schema) y `assertProjectMember` a always-pass (membresía nunca ejercida vía este test). La lógica de anonimato/hash/handler-gating SÍ se prueba de verdad; pero schema y membresía quedan sin cubrir. |
| `complianceEmit.test.ts:80-90` | `complianceEmit.ts` | 🟡 Aserción debilitada (auth-gate) | El test "401" acepta `[401,403]` y admite en comentario que el mock de `verifyAuth` NO hace 401 como el real ("the real verifyAuth would return 401 first"). Solo confirma "no devolvió 200" → el comportamiento real del gate de auth no queda verificado. Happy-path usa adapter totalmente stub (`generate` es `vi.fn`), válido pero no prueba generación real. |
| `dataConfidence.test.ts:38-40, 82` | `dataConfidence.ts` | 🟡 Aserción tautológica + validate bypass | Mockea `buildDataConfidenceReport` → `{overallScore:72}` y luego `expect(report.overallScore).toBe(72)` afirma el valor del mock, no el scoring real. Además mockea `validate` (sin cobertura 400 schema). El resto (ensamblaje de dominios, persistencia, dismiss role-gate, doc-id injection guard, recommendations) SÍ es route real. |
| `drivingSafety.router.test.ts:28-30, 39-41, 59` | `drivingSafety.ts` | 🟡 validate bypass + score mockeado | `validate`→`next()` (sin 400 schema). `computeDriverScore` mockeado: los valores de `safetyScore`/`canOperate` son inyectados. La lógica de route (filtro criticality, alert raise/resolve, acumulación de horas, orden de ranking, sanitización de hazards) SÍ es real y bien afirmada. |
| `documentVersioning.test.ts:417-442` | `documentVersioning.ts` | 🟡 Test vacío (skip disfrazado) | `it('409 version_already_exists ... race condition', ...)` tiene **cuerpo vacío** salvo comentarios explicando por qué no es alcanzable. Cero `expect()` → pasa vacuamente. Es un skip encubierto sin `.skip`/`.todo`. |
| `billing.appleSsn.replay.test.ts:258-275` (case 4) | `services/billing/appleSsn.ts` | 🔵 Cobertura parcial (no es falso-verde) | El JWS sin `x5c` se firma con la MISMA clave self-signed; verifica 401 + no-writes pero no prueba el rechazo de cadena Apple (diferida por diseño, documentado en el header). Aceptable. |
| `billing.test.ts` (todo) | `billing.ts` | 🔵 Copia paralela (superseded) | Usa `buildTestServer` (harness paralelo). El propio header reconoce que `billing.router.test.ts` cubre el router real. Útil como doble-check, pero no es cobertura del handler real. |
| `curriculum.test.ts:168-203` | `curriculum.ts` | 🔵 Copia paralela + dep-reassign frágil | `buildTestServer` harness; reasigna `handle.deps.resendSend` DESPUÉS de construir el server (L174). Superseded por `curriculum.router.test.ts` (real-router, excelente). |
| `changeMgmt.test.ts` (acknowledge/revert) | `changeMgmt.ts` | 🔵 Pure-compute por diseño | El `change` viene en el body, no de Firestore → no verifica persistencia (el route es 0-write por diseño, header confirma). Válido pero no prueba durabilidad. |
| `cphsMinute.test.ts:45-47, 65` | `cphsMinute.ts` | 🔵 Builder mockeado (seam legítimo) | `buildMonthlyMinuteDraft` mockeado; el output del draft no se valida aquí. PERO el test afirma sobre los args pasados al builder (la lógica de ensamblaje de ventana mensual = el sujeto real). Buen uso de seam. |

---

## Tests SÓLIDOS (real-router, aserciones no-triviales, seams legítimos)

Conteo: **43 / 55** archivos clasificados como sólidos (real-router con asserts de fondo,
cobertura de 401/400/403/404/409/200, side-effects de Firestore verificados, identidad
server-stamped comprobada, e invariantes de seguridad/anonimato afirmadas sobre código real).

Destacados:
- `auditPortal.test.ts`, `b2dAdmin.test.ts` (invariante: keyHash/Zettelkasten nunca expuestos; rawKey hasheado en Firestore — afirmado con `hashApiKey` real).
- `bcn.router.test.ts` (cache TTL real, partial-failure, 502/500, sin red).
- `billing.router.test.ts`, `billing.webhookReplay.test.ts`, `billing.appleSsn.test.ts` (idempotencia/replay verificada por call-count de adapters + sentinel; firmas JWS reales con fixture P-256).
- `bowtie.test.ts`, `changeMgmt.test.ts`, `checklistBuilder.test.ts`, `comms.test.ts`, `contingencySimulation.test.ts`, `criticalControls.test.ts`, `deduplication.test.ts` (motores puros REALES, sin mock; branches de negocio exactos).
- `commute.test.ts` (collectionGroup real, ownership 403, audit identity desde token).
- `compliance.test.ts` (side-effects Firestore reales, aislamiento por uid).
- `correctiveActions.router.test.ts` (audit_logs Rule #3 verificado).
- `culturePulse.router.test.ts` + `culturePulse.test.ts` (anonimato real: `pulseResponderHash` importado del módulo de producción; pepper-rotation, HMAC vs unkeyed, dedup por hash — propiedades de seguridad afirmadas sobre código real).
- `curriculum.router.test.ts` (rotación de token, replay-protection, lazy-expiry, audit — ejemplar).
- `documentVersioning.test.ts` (immutability append-only verificada; approverUid server-stamped; salvo el test vacío L417).
- `drillsManager.test.ts` (motor `evaluateDrillResult` real; niveles excellent/good/critical exactos).

---

## Patrones sistémicos observados

1. **Patrón "ID crypto contract" = falso-verde recurrente (🔴).** Dos archivos
   (`confidentialReports.test.ts`, `drivingSafety.test.ts`) afirman una propiedad del
   código de producción pero solo ejercen `crypto.randomUUID()` de Node localmente. No
   importan el sujeto. Recomendación: importar el generador real del route, o eliminar
   (la cobertura útil ya está en los `.router.test.ts` hermanos).

2. **`validate`→`next()` bypass (🟡).** Varios real-router tests
   (`confidentialReports.router`, `dataConfidence`, `drivingSafety.router`) mockean el
   middleware `validate`, eliminando toda la cobertura de 400-schema. Otros lotes usan el
   `validate` real y SÍ cubren 400 — la inconsistencia es la señal.

3. **Copias paralelas `buildTestServer` (🔵).** `billing.test.ts`, `curriculum.test.ts`,
   `coachChatTenant.test.ts` corren contra un harness re-codeado. Donde existe el hermano
   `.router.test.ts` (billing, curriculum) quedan superseded; `coachChatTenant` NO tiene
   hermano real → su gate cross-tenant solo se prueba en una reimplementación (🟡).

4. **Mock-tautología puntual (🟡).** `dataConfidence` afirma el valor literal del mock
   (`overallScore:72`). Patrón a vigilar: `expect(x).toBe(<valor exacto del mock>)`.

---

## Severidad agregada (este lote)

- 🔴 Falsos-verdes que no tocan el sujeto: **2** (`confidentialReports.test.ts`, `drivingSafety.test.ts`).
- 🟡 Débiles (over-mock de gate / aserción debilitada / test vacío / copia sin hermano): **6**
  (`coachChatTenant`, `confidentialReports.router`, `complianceEmit`, `dataConfidence`,
  `drivingSafety.router`, `documentVersioning` test-vacío).
- 🔵 Notas menores (copia paralela superseded / pure-compute por diseño / seam legítimo): **5**.
- ✅ Sólidos: **43 / 55**.

> Doc-only. NO commit.
