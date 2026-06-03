# DEEP-EXT #1 — I-TEST [0:55] · 2026-06-03

**Atestación:** leídos 55/55 línea por línea. (Lote derivado de
`ledger.json` filtrando `category==="I-TEST"`, ordenado por `path`, slice
`[0:55]`. Total I-TEST en ledger: 1247.)

Nota de método: distingo dos clases de "test paralelo":
- **Reimplementación-disfrazada** (🔴/🟡): el test re-escribe la lógica
  bajo prueba dentro del propio archivo y testea la copia → pasaría aunque
  la implementación real esté rota. No es line-coverage real.
- **Static/text-grep contract** (🔵): no toca el emulador pero lo
  documenta y delega a otra suite (rules-tests). Aceptable por diseño.

## Falsos-verdes / tests débiles

| Test:línea | Módulo-sujeto | Tipo | Por qué no prueba lo que dice |
|---|---|---|---|
| `src/__tests__/server/apprenticeship.test.ts:16-27` | `src/server/routes/apprenticeship.ts` (exposure-ID crypto) | 🔴 reimplementación-disfrazada | "exposure ID crypto-secure contract" NO importa ni ejecuta nada de `apprenticeship.ts`. Construye `exp_${Date.now()}_${randomUUID()}` dentro del propio test y se asserta a sí mismo. Pasaría idéntico si la ruta real usara `Math.random()` o un contador. Es un test de `node:crypto`, no del producto. (CLAUDE.md #15 es exactamente lo que NO se está verificando.) |
| `src/__tests__/server/auditCoverage.test.ts:43-234` | `src/server/middleware/auditLog.ts` + 7 rutas (oauth/unlink, google/callback, calendar/sync, coach/chat, gamification/points, check-medals, reports/generate-pdf) | 🔴 reimplementación-disfrazada | Re-implementa `auditServerEvent` (l.43-71) y **mira de nuevo los 7 handlers de producción** dentro de `buildApp` (l.102-234). Las rutas reales y `auditLog.ts` nunca se importan. El propio comentario admite "Drift between this harness and production is intentional". La invariante crítica de CLAUDE.md #3 (cada endpoint emite `audit_logs`) queda verificada sobre copias, no sobre el código que corre en prod. |
| `src/__tests__/server/askGuardian.test.ts:97-279` | `src/server/middleware/limiters.ts` (`geminiLimiter`) + wiring en `server.ts` | 🟡 reimplementación-disfrazada | El 2º describe (per-uid rate limiter) construye `buildLimitedAskGuardianApp` que **re-crea** verifyAuth + `rateLimit({...})` a mano ("Mirror src/server/middleware/limiters.ts"). No importa el limiter real ni verifica el orden de montaje en `server.ts`. Si en prod el limiter tuviera `max` errado, keyGenerator distinto, o estuviera montado antes de verifyAuth, estos 6 tests seguirían verdes. (El 1er describe sí usa `buildTestServer` real → ese sí es válido.) |
| `src/__tests__/server/annualReview.test.ts:37-44` | `src/server/routes/annualReview.ts` (validación Zod) | 🟡 mock que anula la lógica | `validate` se mockea como pass-through. No existe ningún test de 400/`invalid_payload` para objectives/evidence/conclude → toda la capa de validación de payload de esos 3 endpoints queda sin probar. El comentario dice "validation 400s are tested via the real route schema guards inside the handler", pero no hay tal test en el archivo. Un payload basura llegaría al handler sin que la suite lo note. |
| `src/__tests__/scripts/prepackageSlmRegistryParser.test.ts:29-91` | `scripts/prepackage-slm-models.mjs` (parser del registry) | 🟡 reimplementación-disfrazada | El test **re-implementa el parser** (`parseRegistry`/`parseModelLiteral`) "para que vitest lo valide sin cargar el .mjs". Testea la copia contra `registry.ts`, no el parser real del script. Si el parser de producción divergiera del de aquí, la suite pasaría igual. El propio archivo lo declara, pero el riesgo de drift es real. |
| `src/__tests__/contracts/ds44Migration.test.ts:35,42` · `ds40Annotation.test.ts:79` · `contactEmailConsistency.test.ts:55-57` | contracts de docs/legal | 🔵 skip-silencioso | `if (!existsSync) return;` / `it.skip` cuando el archivo crítico no existe → el contrato pasa en verde si el archivo desaparece (borrado accidental no se detecta). Débil pero documentado; cae si el archivo está presente, que es el caso normal en CI. |
| `firestore.test.rules:17-23` | (no es test) reglas TEST-ONLY `allow read,write: if true` | 🔵 nota | No es un falso-verde en sí, pero es el patrón de la directiva: el job `firestore-stores` usa reglas ABIERTAS (sembrado vía Admin SDK) → esa suite NO prueba `firestore.rules`. Correcto por diseño (las rules tienen job propio), pero conviene tenerlo presente al revisar otros lotes rules. |

## Tests sólidos (conteo) y notas

**Sólidos: 48/55.** Destacan como ejemplares de coverage real:
- `admin.router.test.ts`, `adminBurden.test.ts`, `aiFeedback.router.test.ts`,
  `aiGuardrails.test.ts`, `aiQuality.test.ts`, `annualReview.test.ts`
  (salvo el gap de validación), `apprenticeship.router.test.ts`,
  `audit.router.test.ts`, `auditLog.test.ts`: montan el **router real** vía
  `fakeFirestore`/`adminMock`, verifican efectos en el store
  (`H.db!._store.get(...)`, audit rows, `userId` server-stamped vs spoof del
  body), 401/400/403/404/409/500 con `_failReads` para fail-closed, y
  asserts sobre el campo correcto (`timestamp`, `action`, `actor`). Verifican
  `runTransaction` con spy (annualReview/apprenticeship) y la directiva
  human-in-the-loop (aiQuality: blacklisted kinds bloqueadas sin
  `humanDecision`).
- Ratchets `anyRatchet`/`conventionGuard`/`i18nParity`: importan el guard CJS
  real (`createRequire`), corren `scan()` en vivo contra baseline, y testean
  staleness en ambos sentidos. Gates genuinos.
- `routerMountCoverage.test.ts`: cierra una clase real de bug (routers
  implementados pero no montados → 404 en prod) leyendo `server.ts` como texto
  y cruzando con el dir de rutas. Fuerte.
- Scripts self-tests (`download-mediapipe-models`, `precommit-allowbackup-guard`,
  `precommit-stub-guard`, `fill-android-assetlinks`, `fill-ios-aasa`,
  `medicalGuard`, `validateEnv`): inyectan fs/keytool, cubren exit codes,
  idempotencia, no-mutación, case-insensitivity. Bien hechos.
- Smokes (`safety-calc`, `normativa-flow`, `billing-flow`, `health-adapter`,
  `critical-paths`): pinnean constantes legales/precios reales y branches de
  selección de adapter. Correctos.

**No-tests (infra, contados aparte pero leídos):** `ExampleUnitTest.java`
(scaffold Android `2+2==4`), `loadtest/*` (helpers seed/assert REST,
`sos-processor.cjs`), `validate-env.test.cjs` (pointer file → apunta a la suite
TS real), `helpers/fakeFirestore.ts` y `__smoke__/setup.ts` (fixtures).
Ninguno es falso-verde; son utilería.

---

## Resumen (6-10 líneas)

Leídos **55/55** línea por línea. Falsos-verdes/débiles: **6** (más 1 nota de
reglas). Por severidad: **🔴 2** · **🟡 3** · **🔵 1**.

Top 3:
1. 🔴 `apprenticeship.test.ts` — "crypto-secure exposure ID contract" que no
   toca el código de producción; testea `node:crypto`. Pasaría con
   `Math.random()`. Da confianza falsa sobre la invariante CLAUDE.md #15.
2. 🔴 `auditCoverage.test.ts` — reimplementa `auditServerEvent` + 7 handlers
   dentro del test; las rutas reales nunca se importan. La invariante de
   compliance (CLAUDE.md #3: todo endpoint emite `audit_logs`) se verifica
   sobre copias, con drift admitido explícitamente.
3. 🟡 `askGuardian.test.ts` (limiter) — re-crea `geminiLimiter` y verifyAuth a
   mano en vez de importar el real; un mis-montaje en `server.ts` no se
   detectaría.

Patrón dominante del lote: la mayoría de los server-tests SÍ montan el router
real vía `fakeFirestore` y verifican efectos (excelente). Los falsos-verdes se
concentran donde el autor optó por "reimplementar para no cargar el módulo"
(crypto, audit handlers, limiter, parser SLM) — clase **reimplementación-
disfrazada**, recomendada para reescritura importando el código real. Gap
secundario: `annualReview` mockea `validate` y deja sin probar los 400 de
payload.
