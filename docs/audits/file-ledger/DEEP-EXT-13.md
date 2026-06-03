# DEEP-EXT-13 — Auditoría exhaustiva de tests (Lote #13)

**Scope:** `ledger.json` filtro `category==="I-TEST"`, orden por `path`, slice `[660:715]` (55 archivos).
**Universo:** cola de `src/server/routes/*.test.ts`, luego `src/server/{services,sessionStore,sync,triggers,utils}/`, y arranque de `src/services/{ai,aiGuardrails,aiQuality,aiToggle,analytics,annualReview,apprenticeship,ar,adminBurden,adoption,agenda}/`.
**Método:** lectura línea por línea + cruce contra impl de cada router/servicio.
**Fecha:** 2026-06-03. Doc-only, sin commit.

Leyenda severidad: 🔴 falso-verde grave (un bug real pasaría) · 🟡 cobertura ilusoria / tautológica / aserción contradictoria · 🔵 menor / nota.

---

## Hallazgo sistémico (🔴) — "wire-up contract" no prueba seguridad ni comportamiento

**12 de 55** archivos (toda la cola `src/server/routes/*.test.ts` del lote) son tests del patrón *"wire-up contract"*: importan el router, hacen cast a `{ stack: Layer[] }` y assertan únicamente que `route.path` existe con el método HTTP esperado. NO arrancan Express, NO hacen requests (`supertest`), NO ejercitan handlers, NO miran middleware.

Verificado contra impl — **todos** estos routers cablean seguridad real por ruta:

```
softBlocking      verifyAuth=5 validate=4 assertProjectMember=2
spacedRepetition  verifyAuth=5 validate=4 assertProjectMember=2
stoppage          verifyAuth=6 validate=5 assertProjectMember=2
suppliers         verifyAuth=6 validate=3 assertProjectMember=2
syncStatus        verifyAuth=6 validate=5 assertProjectMember=2
upsell            verifyAuth=2 validate=1 assertProjectMember=2
vendorOnboarding  verifyAuth=6 validate=5 assertProjectMember=2
vulnerability     verifyAuth=2 validate=0 assertProjectMember=2
waste             verifyAuth=2 validate=0 assertProjectMember=2
workPermits       verifyAuth=6 validate=4 assertProjectMember=2
workerHistory     verifyAuth=4 validate=3 assertProjectMember=2
workerReadiness   verifyAuth=2 validate=0 assertProjectMember=2
```

El helper `hasPost(path)` (idéntico en todos) descarta los layers de middleware: solo lee `route.methods`. Un PR que **elimine `verifyAuth`** (auth bypass, viola directiva #6 de CLAUDE.md), borre `validate` (viola validate→400) o quite `assertProjectMember` (tenant-isolation bypass) **pasa el 100% de estos tests en verde**. `workPermits` incluye `:permitId/sign` y `:permitId/close` (firma de permiso de trabajo F.15) sin un solo test de comportamiento. `workerHistory` redacta PII (`redact-pii`, `serialize`) y tampoco se ejercita.

| Archivo | Líneas clave | Nota |
|---|---|---|
| `softBlocking.test.ts:9-13,28-32` | `hasPost` solo `route.methods` | gate de bloqueo + override sin test de auth/comportamiento |
| `spacedRepetition.test.ts:9-13,21-35` | `hasPost` | |
| `stoppage.test.ts:9-13,21-29` | `hasPost` (`it.each`) | declare/resume/cancel de detención de faena, nada de comportamiento |
| `suppliers.test.ts:12-27` | inline stack, `methodsByPath` | §90-91; solo presencia GET/POST |
| `syncStatus.test.ts:9-13,21-29` | `hasPost` | |
| `upsell.test.ts:9-13,21-23` | `hasPost` | un solo path |
| `vendorOnboarding.test.ts:9-13,21-47` | `hasPost` | acreditación/escalación sin comportamiento |
| `vulnerability.test.ts:12-22` | inline `find` por `route.path` | F.10; 1 GET |
| `waste.test.ts:12-22` | inline `find` | §229-236; 1 GET |
| `workPermits.test.ts:12-26` | inline `methodsByPath` | **sign/close de permiso F.15** sin test de flujo de firma |
| `workerHistory.test.ts:9-13,27-31` | `hasPost` | **redact-pii** PII sin test |
| `workerReadiness.test.ts:12-21` | inline `find` | F.16; 1 GET |

Es la misma falsa sensación de cobertura señalada en EXT-12: los routers más sensibles del servidor sólo verifican que la ruta "está enchufada", no que esté protegida.

---

## Hallazgos individuales

### 🟡 `src/server/triggers/zettelkastenMaterializer.test.ts:57-71` — aserción contradice el nombre del test

El test se titula `'payload inválido → ok:false sin write'` pero el cuerpo assert lo **opuesto**: `expect(r.ok).toBe(true)` y `expect(writes).toHaveLength(1)`. El propio comentario (`:66-68`) admite que el `title=''` no es capturado por la validación. El test pasa, pero documenta una protección (rechazo de payload inválido) que **no existe**: un materializador que escribe nodos con `title` vacío pasa. El nombre crea una garantía ilusoria. Debería renombrarse a "no valida title vacío (gap conocido)" o, mejor, ejercitar un payload realmente inválido (p. ej. `payload` sin campos requeridos) y exigir `ok:false`.

### 🔵 `src/services/ai/eppDetectorOnDevice.test.ts:80-84` — aserción trivial bajo nombre engañoso

`it('inferenceTimeMs > 0 ...')` assert `toBeGreaterThanOrEqual(0)` — siempre verdadero, incluso si el timing está roto/ausente (0 ms pasa). El nombre promete `>0`. Resto del archivo es sólido (severity, privacy on-device, missing/lowConfidence).

### 🔵 `src/services/ai/resilientAiOrchestrator.test.ts:152-163` — `latencyMs` solo `>=0`

`expect(r.latencyMs).toBeGreaterThanOrEqual(0)` es trivial (inyecta `nowMs` mockeado pero no verifica que el delta refleje el mock). El comportamiento de failover/timeout sí está bien cubierto en el resto.

### 🔵 `src/services/analytics/adapter.test.ts:293-312` — aserción runtime tautológica (aceptable)

`expect(sink.calls.length >= 0).toBe(true)` siempre pasa. El valor real del test está en el pragma `@ts-expect-error` (compile-time), correctamente documentado en el comentario. No es falso-verde porque la garantía es de tipos; sólo se anota para evitar confusión.

### 🔵 `src/server/routes/suseso.test.ts` y `visitors.test.ts` — reimplementación-disfrazada (parcial, mitigada)

Ambos **reconstruyen la app Express completa inline** (`buildApp`/`buildVisitorsApp`): `verifyAuth`, handlers, schemas Zod, bbox Chile, HMAC, resolución de tenant — todo es una copia local, **no** el router de producción. El router real (`suseso.ts`/`visitors.ts`) podría estar roto y estos tests seguirían verdes; lo que prueban es la copia del test, no el código desplegado.
**Mitigante (por eso 🔵 y no 🔴):** ambos archivos **sí importan los engines reales** que concentran el riesgo — `folioGenerator` (`nextFolio`/`parseFolio`), `susesoServerOnlyHelpers` (`canonicalize`/`verifyEmployerSignature`) y `visitorRegistry` (`registerVisitor`/`checkOutVisitor`/`isActive`) — y los ejercitan a fondo (401/403/400/404, secuencia de folio, HMAC mismatch, RUT inválido, host-uid binding, tenant resolution). El comentario de cabecera declara honestamente el patrón "parallel-app porque no se puede bootear firebase-admin". Aun así, la **ruta/middleware de producción no está bajo test** — auth-bypass o pérdida de `assertProjectMember` en `suseso.ts`/`visitors.ts` no se detectaría aquí.

---

## Archivos verificados como GENUINOS (sólidos, sin hallazgo)

Servidor (imports reales, DI, fallos propagados, idempotencia, ordering):
- `projectTokens.test.ts` — excelente: prueba explícita anti-silent-pass (read failure → throw, no cachea fallos), paginación con cursor, regresión "no parar en 500".
- `serverZkNodeWriter.test.ts` — tri-write legacy+canonical+audit, actor server-side, idempotencia por contenido.
- `userLifecycle.test.ts` — revoke+claims atómico (no setea claims si revoke falla), TypeError uid vacío.
- `firestoreSessionStore.test.ts` — TTL Date/ISO/Timestamp backward-compat, fail-soft a null.
- `distributedLock.test.ts` — steal de lock expirado, owner-only release, race "exactamente 1 gana", per-tenant scoping.
- `backgroundTriggers.test.ts` — initial-load skip, FCM solo a supervisor/gerente, mutex per-key (no-overlap / parallel / no-poison).
- `healthCheck.test.ts` — fake timers, error per-proyecto no aborta el loop, db.get() error no mata el timer.
- `systemEngineTrigger.test.ts` — skip initial load, rechazo malformados, absorbe errores de onEvent.
- `fcmMulticast.test.ts` — chunking 500, agregación failure/error, chunk que tira no detiene los siguientes.

Servicios AI / guardrails / analytics / dominio (pure functions y adapters con seam inyectable legítimo):
- `aiAdapter.test.ts`, `vertexAdapter.test.ts` — selección de facade, residency LATAM strict→throw (no fallback silencioso), clasificación TIMEOUT/QUOTA/UPSTREAM, forwarding de request shape.
- `asesorAdaptersFactory.test.ts`, `resilientAiAdapters.test.ts`, `resilientAiOrchestrator.test.ts` — failover entre tiers, emergencia restringida a SLM+ZK (nunca Gemini/Firestore), canned fallback, timeout por tier.
- `colorBasedEppDetector.test.ts`, `contextualAssistant.test.ts`, `zkRagContextBuilder.test.ts`, `zkRagResponseValidator.test.ts` — detección por color con caso negativo, BFS, **multi-tenant isolation bidireccional**, validación PII/diagnóstico/citas inventadas.
- `aiGuardrails.test.ts`, `citationValidator.test.ts`, `hallucinationGuard.test.ts`, `runWithGuardrails.test.ts`, `versionedPrompts.test.ts` — enforcement de citas/fallback, números/leyes sin cita → block, log estructurado, propagación de error del adapter.
- `aiAuditLog.test.ts` — acciones blacklisted gated por decisión humana, override con razón ≥10 chars.
- `aiModeController.test.ts`, `ruleDriftDetector.test.ts` — árbol de decisión por prioridad, thresholds de drift con dirección/severidad, baseline window, edge ratio 0.
- `adapter.test.ts`, `b2dMetrics.test.ts`, `serverAdapter.test.ts` — PII guard, fan-out fault-isolation, offline-queue+flush, overflow drop-oldest, MRR/ARR/churn 30d.
- `adminBurden.test.ts`, `adoptionAnalytics.test.ts`, `agendaScheduler.test.ts` — verdict por peor-worker (no diluido), funnel/churn, DnD/urgent override.
- `annualReviewFirestoreAdapter.test.ts`, `annualSgiReview.test.ts`, `apprenticeshipProgressService.test.ts` — CRUD idempotente, progreso/missed por deadline, gating observer/supervised/autonomous.
- `arAnchorFirestoreAdapter.test.ts`, `arAnchorService.test.ts`, `arHitTest.test.ts` — **tenant+project isolation aseverado**, geometría 3D real (distance, quaternion→surface, EMA smoothing, stability accumulator).

---

## Resumen

55 archivos auditados. El único hallazgo de escala es sistémico: **12 tests "wire-up contract"** de `src/server/routes/*.test.ts` (🔴) que sólo verifican el registro de rutas e ignoran `verifyAuth`/`validate`/`assertProjectMember` — todos confirmados presentes en la impl —, dejando pasar en verde cualquier auth-bypass o pérdida de tenant-isolation (incluye sign/close de permisos F.15 y redact-pii de historial laboral). Dos tests de ruta más grandes (`suseso`, `visitors`) son reimplementación-disfrazada de la app Express (🔵): la ruta de producción no queda bajo test, aunque sí ejercitan los engines reales de riesgo (folio/HMAC/visitorRegistry). Hallazgos puntuales menores: `zettelkastenMaterializer.test.ts:57-71` (🟡, aserción contradice el nombre — "payload inválido" que en realidad assert ok:true), y tres aserciones triviales `>=0` bajo nombres que prometen `>0` (🔵). Los **40 archivos restantes** (server services/triggers/utils + todo el bloque AI/guardrails/analytics/dominio/AR) son genuinos y de alta calidad: DI limpia, propagación de fallos, idempotencia, multi-tenant isolation aseverada y anti-silent-pass explícito (`projectTokens`).
