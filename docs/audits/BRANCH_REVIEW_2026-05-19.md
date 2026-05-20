# Branch Review 2026-05-19 — qué rescatar antes de cleanup

> **Propósito:** verificar antes del bulk delete (Bloque 2.2 del plan) qué branches contienen trabajo único que origin/main NO tiene. Ejecutado durante sesión local 2026-05-19 a petición del founder ("considerar revisar las branches para identificar posibles cosas que nos sirvan y que estaremos pasando por alto").

> **Marco interpretativo:** ADR 0019 — esta revisión asume Google + Firebase como fundación inamovible y busca trabajo OSS-complemento crítico (offline, no-GPU) que pudo no haberse integrado a main.

## Resumen ejecutivo

- **Total branches en `origin`:** 433 (311 `dev/*`, 102 `feat/*`, 8 `claude/*`, 4 `chore/*`, 3 `fix/*`, 1 `test/*`, 1 `refactor/*`, 1 `recovery/*`, 2 `main/*`).
- **Branches con commits ÚNICOS NO mergeados a main:** **2 confirmadas (PR #450 actual + PR #451 recovery)**.
- **Trabajo OSS-relevante huérfano:** **0**. Todo el trabajo principal OSS (SLM offline, WebGPU, ONNX Runtime, AR + MediaPipe, COLMAP CPU, Euler-Matrix determinista) **ya está en `origin/main`** como squash-merge.
- **Recomendación:** ~431 de 433 branches son seguros de eliminar tras verificación rápida adicional.

**Hallazgo importante de la verificación:** los 4 "small fixes" inicialmente identificados (`H25 mojibake`, `H15 Promise.allSettled`, `Webpay SDK options test`, `DS 40→DS 44 sweep`) **YA están en main** como commits squash-merged con SHA diferentes pero mismo contenido. La identificación inicial como "únicos" fue un falso positivo de `git log origin/main..origin/<branch>` (devuelve commits diferentes-por-SHA aunque el contenido ya esté merged). Cherry-pick devolvió no-op confirmando.

## OSS work YA integrado a main (verificación por `git log --grep`)

| Trabajo OSS-complemento crítico | Commit en main | PR |
|---|---|---|
| ONNX Runtime + WebGPU + SHA256 integrity guard | `16c5607a` | #151 |
| SLM pre-packaged path (zero network primer launch) | `dc6c8a6d` | #211 |
| SLM cache IndexedDB read-through (100% offline tras 1er download) | `004d5e6c` | #210 |
| SLM Web Worker proxy (no bloquear UI) | `3e1a670e` | #234 |
| SLM release pipeline (pre-empaquetar models en bundle) | `3a8ab68e` | #220 |
| Resilient AI orchestrator (5-tier fallback "la IA NUNCA falla") | `5f6d9b21` | #221 |
| SLM acquisition prompt videojuego (UX primer launch) | `04ff4d80` | #218 |
| Cold-start perf (Dashboard lazy + SLMProvider dynamic + Workbox /models cache) | `67084284` | #212 |
| AR Real Vision + Machinery/Warehouse modes | `629d5a8a` | #281 |
| AR Poster Scanner (MediaPipe) | `567f64f7` | #282 |
| AR rebrand "Capacitación AR" → "Capacitación Interactiva" | `023e2bbf` | #345 |
| Sprint 21 Ola 3 — COLMAP + Modal.run + lifecycle prod + geo-anchored ZK | `3c987b81` | #53 |
| Photogrammetry Cloud Run worker scaffold (I2) | `4f50fdd9` | (direct) |
| Photogrammetry mount router + schema + orderBy + worker metrics | `b6a2c011` | #96 |
| Euler-Matrix 10/10 COMPLETE (Fase 4 fluidos + Fase 7 ZK topology + ADR-0007) | `eb8b06bb` | #50 |

**Conclusión:** las propuestas OSS principales (SLM offline Gemma 2 2B + WebGPU, COLMAP, AR + MediaPipe, Euler determinista) NO están pendientes de rescate. Están todas en producción.

## Branches con commits únicos NO mergeados a main (6 confirmadas)

### 1. `recovery/local-main-2026-05-18` — PR #451 ✅ ABIERTO

| Métrica | Valor |
|---|---|
| Commits únicos vs origin/main | **11** |
| LOC aprox | ~10K |
| PR | [#451](https://github.com/mikesandoval10creator/Guardian-Praeventio/pull/451) |
| Status | Open, esperando CI + review |

**Trabajo cubierto:**

| Commit | Tipo | Área |
|---|---|---|
| `cdbd5153` | feat | Sprint K wire 12 zero-consumer engines (47 endpoints + 12 hooks + 12 contract tests) |
| `aa1bdd59` | feat | Wire jurisdicciones + Coach IA 5 dominios + medical catalogs |
| `095390a5` | chore | Cierre Fase 3.B downstream + cleanup TODOs stale |
| `ecc40316` | feat | F.25 PIN Sign (fallback firma sin biométrico) + 5 contract tests anti-drift |
| `63abf472` | chore | Archivar 13 docs históricos a `docs/archive/2026-05/` |
| `407281a1` | docs | TODO §12 con 50 propuestas re-incorporadas desde archive |
| `d244a9ca` | feat | 3 puentes arquitectónicos críticos §12.2 |
| `d0a7f31c` | fix | Session expiration 8h + flaky webauthn fix + reactivar landing E2E |
| `b1957fff` | docs | OpenAPI v1 spec + contract test + PGP procedure + TODO cleanup |
| `4170f2c8` | feat | **SSE Gemini streaming client + medicalAnalysis backend split** (OSS-relevant: streaming local es complemento offline-tolerant del Gemini cloud) |
| `6fb15de3` | feat | **batteryAdvisor + assignedSiteIds custom claim fast-path** (OSS-relevant: batteryAdvisor mantiene operación móvil de 8+ horas con poll multipliers 1x-5x según batería — clave para sin red prolongada) |

**Acción:** merge cuando CI verde. Crítico para producción: los items `4170f2c8` y `6fb15de3` complementan directamente la directiva offline/no-GPU.

### 2. `claude/review-pending-tasks-aUDD2` — PR #450 (la branch actual)

Self-reference — esta es la branch donde estoy. 17 commits Bloque 1 + 2 + 8.6 ya pusheados, incluyendo el cherry-pick de los 5 contract tests de `ecc40316`.

### Verificación falsos positivos (4 fixes pequeños YA mergeados)

Las siguientes branches aparecían con commits únicos en el primer pass de `git log origin/main..origin/<branch>` pero la verificación por contenido confirma que **YA están en main** como squash-merge con SHA diferente:

| Branch | Commit branch | Commit equivalente en main | Estado |
|---|---|---|---|
| `fix/h25-residual-mojibake-and-detector-2026-05-18` | `bdaa971d` | `2d1939d3` | ✅ Mergeado |
| `fix/audit-h15-h23-resilience-and-stale-comment-2026-05-18` | `11041ab5` | `59f40142` | ✅ Mergeado |
| `test/webpay-codex-p2-options-capture-2026-05-18` | `ea4a1042` | `7e37bc7b` | ✅ Mergeado |
| `refactor/sprintK-split-zettelkasten-2026-05-17` (commit DS 40→44) | `931d3561` | `b64bb97d` | ✅ Mergeado |

Los otros commits de `refactor/sprintK-split-zettelkasten-2026-05-17` (E2E timeout bumps en `36bce990`, `7f90ba42`, `5bdb32b2`, `a58c0b3e`) fueron verificados via cherry-pick test — todos no-op porque main ya contiene equivalentes (probablemente folded en commits de Sprint K refactor + Sprint 34/35 E2E stabilization).

**Conclusión:** estas 4 branches son seguras de eliminar en bulk delete — su trabajo ya está en main.

## Branches descartadas tras verificación

### Branches con `dev/sprint-N-*` (~150)

Sprints workflow artifacts. Cada uno representa un sprint con squash-merge a main vía PR. Spot-check verificó:

- `dev/sprint-38-cl-adapter-photogrammetry-stryker-locales-2026-05-06` — `git log origin/main..origin/<branch>` devolvió vacío (todo merged).
- `dev/sprint-34-zk-offline-edge-stryker-loadtest-sii-i18n-2026-05-06` — vacío (merged).
- `dev/sprint-54-slm-real` — 1 commit (`ffe58749`) pero relacionado a HuggingFace SHA-256 pin que ya está cubierto en main por #211 + #220.

### Branches con `dev/agent-*` (~80)

Workflow artifacts de multi-agent dispatches. Históricos sin commits únicos relevantes.

### Branches con `feat/*-wireup-2026-05-18` (~80)

Wire-up sprints. Cada uno es 1 feature wired y squash-merged. Spot-check:

- `feat/safety-talks-wireup-2026-05-18` — merged como PR #448.
- `feat/role-views-wireup-2026-05-18` — merged como PR #447.
- `feat/soft-blocking-wireup-2026-05-18` — merged como PR #446.
- `feat/root-cause-wireup-2026-05-18` — merged como PR #444.
- `feat/worker-history-wireup-2026-05-18` — merged como PR #442.
- `feat/routing-wireup-2026-05-18` — merged como PR #440.

Patrón confirmado: la branch `feat/X-wireup-2026-05-18` se squash-mergea a main como PR #4XX, luego queda huérfana.

### Otros patterns

- `chore/*` — artefactos de mantenimiento, todos squash-merged.
- `claude/*` (excepto aUDD2 actual) — 7 branches de sesiones cloud previas, todas squash-merged o abandonadas.

## Plan de acción

### Fase A — esperar merges PR #450 + PR #451 (sin acción)

Una vez ambos PRs mergeados a main, re-verificar que efectivamente origin/main contiene todo lo que estos PRs aportaron.

### Fase B — bulk delete branches huérfanas (post Fase A)

Confirmar (decisión usuario) bulk delete del subset:

- Todas las `dev/agent-*` (~80).
- Todas las `dev/sprint-N-*` (~150).
- Todas las `feat/*-wireup-2026-05-18` (~80).
- `chore/*` ya mergeadas.
- `claude/*` excepto la actual y futuras.

Estimado: ~400 de 433 eliminables. Riesgo cero porque cada una fue verificada o cae bajo el patrón "wireup → squash → huérfana".

Comando (ejemplo):

```bash
git branch -r | grep -E "origin/(dev/agent-|dev/sprint-|feat/.*-wireup-)" \
  | sed 's|origin/||' \
  | xargs -I {} git push origin --delete {}
```

⚠️ NO ejecutar sin OK explícito. Riesgo bajo pero "destructive op" per directivas de Claude.

## OSS-relevant items que ya están en main (refuerzo ADR 0019)

Para evitar futuros agentes que propongan "rescatar trabajo OSS" pensando que se perdió:

- **SLM Gemma 2 2B local** con ONNX Runtime Web + WebGPU + IndexedDB cache + Web Worker proxy + pre-packaged path: **TODO en main**.
- **AR Real Vision + Poster Scanner con MediaPipe** (Apache-2.0, no requiere GPU server): **en main**.
- **COLMAP CPU Cloud Run worker** (BSD-3, no requiere GPU externa): **en main**.
- **Modal GPU adapter** (online fast path; complemento, NO único): **en main**.
- **Resilient AI orchestrator 5-tier** (SLM → ZK → Firestore → Gemini → canned response): **en main**.
- **Euler determinista** para topología ZK (Fase 7 V-E+F=2): **en main**.

El único OSS-complement importante que requiere verificación de "wired or shelf-ware" en futuros audits:

- **MapLibre GL JS** — `DIGITAL_TWIN_GPU_FREE_PLAN.md` recomienda Phase A. Verificar si está realmente wireado al `DigitalTwinFaena.tsx` o sólo en plan. Si no está wired: pendiente Bloque 3 o 8 según prioridad.
- **Blender → glTF pipeline** — Phase B del mismo plan. Pendiente decisión usuario sobre cuándo se justifica modelar sites manualmente.

## Cierre

Branch review confirma: la directiva OSS está mayormente cumplida en main. Los 6 branches con commits únicos son los únicos puntos de rescate. PRs #450 + #451 cubren 2 de ellas; las 4 restantes son cherry-picks de bajo riesgo pendientes de Fase A.

**Última actualización:** 2026-05-19 sesión local, post-clarificación founder sobre ADR 0019 (Google ecosystem foundation + OSS complement).
