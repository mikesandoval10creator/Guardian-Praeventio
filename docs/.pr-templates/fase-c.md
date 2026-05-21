# PR Fase C — B2D wires reales (§2.15 + §2.16 + §2.17) + ZK canonical materializer

**Branch:** `fix/fase-c-b2d-wires-2026-05-21` → `main` (stack sobre Fase A)
**Commits únicos (no incluidos en Fase A):** 3
**Diff vs `main`:** 64 archivos, +2505 / −1122 LOC (incluye 10 commits de Fase A + 3 nuevos)
**Diff vs Fase A:** 3 commits = +1180 / −74 LOC

> **Stack note:** este PR depende del merge de `fix/fase-a-cierre-residual-2026-05-21` (PR #N). Cuando Fase A mergee, este PR queda con solo los 3 commits nuevos sobre `main`.

## Resumen

Cierra los hallazgos §2.15, §2.16, §2.17 del TODO.md vivo (descubiertos
2026-05-19 al auditar promesas marketing vs runtime real). Los 3
contradicción común: el marketing prometía adapters reales (Open-Meteo,
USGS, OpenAQ, Gemini) pero el código retornaba responses determinísticas.
Aplicamos Regla #3 del TODO.md inviolable: **PRODUCIR la solución** (wire
real con fallback determinístico), **no etiquetarla** como "no disponible".

## Hallazgos cerrados (3)

### `bcfc1ae0` — §2.17 B2D Coach Gemini wire

`src/server/routes/b2d/suite.ts` (+163 LOC):
- `tryBuildWithGemini(input)` invoca `getAiAdapter().generate(...)` con system instruction (DS 44/2024 + ISO 45001 + Ley 16.744 + directiva 2.6 "no push estatal" + NO accede Zettelkasten/tenant) + prompt JSON-mode + `temperature: 0.3` + `maxOutputTokens: 800` + model `gemini-3-flash-preview`.
- Sanitiza la respuesta: filtra `structuredActions` a shape estricto `{step, action}` con cap 8, citations cap 12. Shape parcial → null → fallback.
- `buildCoachGuidance(input)`: builder determinístico SIN CAMBIOS (idéntico al pre-§2.17, sirve de fallback).
- Citas canónicas SIEMPRE mergeadas con las del modelo: DS 44/2024, DS 594, DS 54, ISO 45001, Ley 16.744. DS 40 derogado nunca aparece.
- Response shape ESTABLE — cliente B2D no se entera del provider. Nuevo campo `source: 'gemini-consumer' | 'vertex-ai' | 'deterministic'` para transparencia auditable.

`src/server/routes/b2d/suite.test.ts` (NEW, 145 LOC): 7 tests cubren input inválido, Gemini happy path, fallback por adapter no disponible, fallback por JSON inválido, fallback por error upstream, fallback por shape parcial, response NUNCA contiene refs a Zettelkasten/tenant_/firestore.

**Privacidad B2D inviolable preservada** — system instruction explícita: "NUNCA accedes a datos del tenant ni al Zettelkasten interno". El coach solo procesa input del request body.

### `90f6ac1b` — §2.16 B2D Climate Open-Meteo + USGS + OpenAQ

`src/services/b2d/externalClimate.ts` (NEW, 297 LOC):
- `fetchOpenMeteoCurrent(lat, lng)` — Open-Meteo `/v1/forecast` current. Sin API key.
- `fetchOpenMeteoForecast(lat, lng, days)` — 1..14 días, temp min/max + precipitación + viento máx.
- `fetchUsgsEarthquakesNearby(lat, lng, radiusKm)` — USGS FDSNWS query últimas 24h, magnitud ≥ 2.5. Sin API key.
- `fetchOpenAqAirQuality(lat, lng, radiusKm)` — OpenAQ v3 locations + sensors lastValue PM2.5/PM10. AQI con breakpoints EPA. Key opcional via `OPENAQ_API_KEY`.
- Cache in-memory por `(lat redondeada a 2 decimales, lng idem, kind)`, TTL 1h.
- Timeout 8s via `AbortController`. Cada función null-safe (devuelve `{data, source}` o `null`).
- Privacidad B2D: NUNCA pasa tenantId/customerId al upstream.

`src/server/routes/b2d/climate.ts` (reescrito):
- `/current`: las 3 fuentes en paralelo (`Promise.all`) + fallback determinístico **por fuente** (no solo cuando las 3 fallan).
- `/forecast`: Open-Meteo daily + fallback gradient determinístico por latitud.
- `/risk-score`: snapshot real si Open-Meteo responde, stub si no (Regla #3 — score sigue calculándose).
- Response incluye `provenance` auditable: `{weather: 'openmeteo'|'deterministic-fallback', seismic: 'usgs-live'|'unavailable', airQuality: 'openaq-live'|'unavailable'}`.
- Backward compat: campos legacy (`weather`, `seismic`, `airQuality`, `citations`) preservados.

`src/server/routes/b2d/climate.test.ts` (actualizado): `vi.stubGlobal('fetch', ...)` fuerza fallback determinístico → tests determinísticos sin depender de red real + shape verificado igual.

### `ad623a6f` — §2.15 ZK canonical materializer WIREADO

**Hallazgo durante audit:** el `canonical/materializer.ts` (Sprint 39 Fase D.8.c) **YA EXISTÍA** completo como función pura (269 LOC + tests) pero **NUNCA estaba wireado al runtime**. Un nodo creado por Bernoulli aterrizaba en `zettelkasten_nodes` global y nunca aparecía en KG (`nodes`) ni Digital Twin (`tenants/{tid}/zettelkasten_nodes`).

3 cambios concretos:

1. **Server dual-write** — `src/server/routes/zettelkasten.ts:46-60,184-265`:
   - Importa `materializeNode` + `canonicalNodePath` del materializer puro.
   - Resuelve `tenantId` del proyecto una sola vez por batch (Firestore read adicional).
   - Por cada nodo escrito a `zettelkasten_nodes/{id}` (legacy backwards compat), también escribe canonical a `nodes/{tenantId}_{projectId}_{zkNodeId}` con `set({merge:true})`.
   - Try/catch independiente — si canonical falla, NO bloquea POST; warn `zettelkasten_canonical_dual_write_failed`.
   - Audit log incluye `canonicalMaterialized` + `tenantResolved`.

2. **Client RiskNodeMarkers migrado** — `RiskNodeMarkers.tsx:75-120`:
   - Antes leía `tenants/{tid}/zettelkasten_nodes` (subcolección que el server NUNCA escribía → twin mostraba 0 markers).
   - Ahora lee `collection(db, 'nodes')` con `where('tenantId','==',tid)` + `where('projectId','==',pid)` + `orderBy('createdAt','desc')` + `limit(100)`.
   - `UniversalKnowledgeContext.tsx:108` (lee `nodes` por projectId) y `useRiskEngine.ts:44` (lee `nodes` por projectId) reciben los canonicals automáticamente sin más cambios.

3. **Índice compuesto Firestore** — `firestore.indexes.json`:
   - Nuevo `nodes (tenantId ASC, projectId ASC, createdAt DESC)` requerido por la query de RiskNodeMarkers.

**Contract test NEW** (`src/__tests__/contracts/zkMaterializerWired.test.ts`, 86 LOC): verifica imports en server route + dual-write pattern + try/catch defensivo + RiskNodeMarkers lee `nodes` con filtros correctos + índice declarado + materializer permanece función pura (sin imports `firebase`/`firebase-admin`).

**Resultado:** un nodo creado por calculadora Bernoulli ahora aparece automáticamente en RiskNetwork + useRiskEngine + Digital Twin RiskNodeMarkers. La inconsistencia denunciada por `AUDIT_TRUTH_MATRIX_2026-05-07.md:193-207` queda resuelta.

## Test plan

- [ ] CI workflows verdes (build, test, lint, typecheck, e2e, mutation, perf)
- [ ] `npm test src/server/routes/b2d/suite.test.ts` → 7 tests verdes (Gemini happy + 4 fallbacks + privacy)
- [ ] `npm test src/server/routes/b2d/climate.test.ts` → tests existentes verdes con mock fetch
- [ ] `npm test src/__tests__/contracts/zkMaterializerWired.test.ts` → 5 asserts verdes
- [ ] Manual `/api/b2d/v1/suite/coach` con `GEMINI_API_KEY` setteado → `source: 'gemini-consumer'`; sin key → `source: 'deterministic'`
- [ ] Manual `/api/b2d/v1/climate/current?lat=-33.45&lng=-70.66` → `provenance.weather: 'openmeteo'` si red disponible
- [ ] Manual: crear nodo Bernoulli desde `StructuralCalculator` → verificar aparece en `nodes` collection (Firestore console) + en Digital Twin si proyecto tiene coordenadas

## Notas para reviewer

- **Stack-aware**: este PR depende de Fase A; tras merge de Fase A, este queda con 3 commits limpios sobre `main`.
- **Sin breaking changes**: shape de responses estable, campos nuevos agregados (`source`, `provenance`).
- **Privacidad inviolable preservada**: B2D Coach NUNCA accede Zettelkasten/tenant data; B2D Climate NUNCA pasa tenantId al upstream.
- **Regla #3 aplicada**: 3 servicios externos (Gemini, Open-Meteo+USGS+OpenAQ) tienen fallback determinístico real (no etiqueta "no disponible").
- **Directiva 2.6 reforzada**: B2D Coach system instruction prohíbe explícitamente recomendaciones de push automático estatal.
- **Índice Firestore requerido**: `nodes (tenantId, projectId, createdAt DESC)` — Firebase auto-prompt al primer query si no existe (vía console link).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
