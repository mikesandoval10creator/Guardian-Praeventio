# ADR 0005 — Photogrammetry pipeline (COLMAP CPU sobre Cloud Run, Modal DESCARTADO)

* **Status:** Accepted (Sprint 21 Bucket Λ) — corregido 2026-05-19 tras directiva founder ADR 0019.
* **Date:** 2026-05-19 (revisión completa; original Sprint 21-38, primer ADR 2026-05-19 al inicio de sesión local — luego corregido al verificar conflicto con ADR 0019).
* **Deciders:** Sprint 21 backend WG (COLMAP adapter), Sprint 38 Brecha C (Cloud Run worker), founder (decisión 2026-05-19 eliminar Modal).
* **Related:** ADR 0019 (Google ecosystem foundation), ADR 0011 (Digital Twin triple-gate auth), ADR 0008 (DWG converter — mismo patrón HTTP-boundary OSS isolation).

## Context

Praeventio Digital Twin necesita convertir un video del smartphone del trabajador (o secuencia de fotos) de una escena de faena en un mesh 3D para renderizar con `<TwinScene />`. Dos restricciones:

1. **Compute envelope** — Structure-from-Motion (SfM) son cargas de minutos, GPU-friendly, y memoria-intensivas. Correrlo inline en Cloud Run del main app pegaría workers por 5-15 minutos por request, excedería timeouts, y forzaría máquinas GPU-equipadas que no se justifican (la mayoría de requests son REST tiny).
2. **Licensing librerías** — los dos stacks SfM dominantes:
   * **AliceVision / Meshroom** — MPL-2.0 (compatible SaaS proprietary uso, obligaciones file-level).
   * **COLMAP** — BSD-3-Clause (fully permissive).
   Ambos pueden invocarse como subprocess o HTTP service ("mere aggregation" GPL/MPL) sin contaminar el bundle Node.

3. **Restricción adicional ADR 0019 (founder directiva 2026-05-19):** la arquitectura DEBE operar dentro del ecosistema Google + sin GPU externa. Plataformas third-party GPU rental (Modal, RunPod, Replicate, Banana, Beam) están descartadas por violar ambas restricciones.

## Decision

### Pipeline canónica: COLMAP CPU en Cloud Run (Python Flask)

`infra/photogrammetry-worker/server.py` ejecuta COLMAP `automatic_reconstructor` en Cloud Run CPU-only.

* **Software:** COLMAP (BSD-3, código fuente libre). Sin costo de licencia, sin lock-in vendor.
* **Infra:** Google Cloud Run (Google ecosystem, ADR 0019 compliant). Costo ~$0.40 por job típico de 10-15 min CPU.
* **Auth:** `Authorization: Bearer <PHOTOGRAMMETRY_WORKER_TOKEN>` con comparación constant-time (`hmac.compare_digest`).
* **Cliente:** `src/services/digitalTwin/photogrammetry/colmapAdapter.ts`.
* **Trade-off aceptado:** COLMAP CPU es ~4x más lento que el equivalente GPU (180s vs 10-15min), pero:
  - Cumple con la restricción "sin GPU externa".
  - Cumple con Google ecosystem.
  - Costo predecible per-job (~$0.40), sin compromiso mensual.
  - Software OSS = sin negociación de licencia, sin renewal, sin discontinuation risk vendor-lado.

### Alternativa para sites estables: Blender pre-render + glTF

Para sites donde la fotogrametría no se justifica (mismo layout múltiples meses, sin cambios estructurales frecuentes), modelado manual una vez en Blender genera el mesh:

* **Software:** Blender (GPL — corre offline en máquina del modelador, no se linkea al app bundle).
* **Output:** glTF/GLB (MIT format) servido como asset estático desde Cloud Storage.
* **Costo cloud:** $0 (sin SfM corriendo; sólo serving asset).
* **Costo humano:** ~1 día persona por site nuevo.
* **Visor:** three.js + @react-three/fiber (MIT, ya en el bundle). CPU-friendly, sin GPU dedicada del servidor.

Esta es la **Fase B** del análisis en `DIGITAL_TWIN_GPU_FREE_PLAN.md`.

### Phase A — 2.5D MapLibre extruded (preferencia primaria UX)

Antes de hacer fotogrametría real, para muchas faenas basta un mapa 2.5D extruido:

* **Software:** MapLibre GL JS (BSD-3).
* **Tiles:** OpenStreetMap (ODbL).
* **Costo:** $0.
* **Cubre 80%** de casos según `DIGITAL_TWIN_GPU_FREE_PLAN.md` (markers de riesgo, rutas evacuación, mediciones).

La fotogrametría (COLMAP) es **Fase C** — sólo cuando MapLibre + Blender no alcanzan.

### Selection logic

`src/services/digitalTwin/photogrammetry/index.ts` debe:

1. Por defecto NO ejecutar SfM. El usuario indica explícitamente "necesito reconstrucción 3D del sitio" antes de gastar cómputo.
2. Si se pide reconstrucción y hay video/fotos: encolar job a `colmapAdapter.ts` → Cloud Run worker.
3. La UI del Digital Twin debe poder mostrar (a) mapa 2.5D MapLibre default, (b) glTF pre-render si está disponible, (c) mesh COLMAP cuando complete.

### Boundary

* El main app NUNCA importa COLMAP, OpenCV, ni librerías SfM nativas. Comunicación HTTPS sólo con `videoUri` (gs://) in y `meshUri` (gs://) out.
* COLMAP corre en su propio Cloud Run service, redeployable sin tocar main app.
* Job records (`tenants/{tenantId}/photogrammetry_jobs/{jobId}`) en Firestore. Main app polled Firestore (no el worker directo) para que cancelled/failed estados lleguen a UI aunque container sea recycled.

## DESCARTADO — Modal.run (2026-05-19)

**Lo que existía:** `infra/modal-photogrammetry/app.py` ejecutaba Meshroom 2023.3.0 en Modal.run A10G GPU como ruta primaria (~$0.10/job, 180s).

**Por qué se descarta:**

1. **Modal NO es Google** — violación directa de ADR 0019 Principio 1 ("Google ecosystem es la fundación inamovible").
2. **GPU EXTERNA** — la directiva del founder 2026-05-19 exige "sin GPU externa". A10G es GPU rental third-party.
3. **Vendor lock-in adicional** — Modal-the-vendor podría discontinuar el servicio, cambiar precios, o restringir el endpoint. Cloud Run + COLMAP nos blinda de eso.
4. **Costo no-Google se mezcla** — facturación Modal aparte de la consolidada en Google Cloud Billing, complica observabilidad y consolidación.

**Plan de retiro:**

| Item | Estado | Acción |
|---|---|---|
| `infra/modal-photogrammetry/app.py` | Existe | Eliminar el directorio en commit aparte (pendiente PR follow-up tras merge PR #450). Documentar en CHANGELOG. |
| `src/services/digitalTwin/photogrammetry/modalAdapter.ts` | Existe (cliente) | Eliminar. Cualquier call site debe migrar a `colmapAdapter.ts`. |
| `MODAL_TOKEN`, `MODAL_SUBMIT_URL`, `MODAL_STATUS_URL` en `.env.example` y secrets | Listadas | Eliminar de `.env.example` + rotar/desactivar tokens reales en Modal dashboard. |
| `docs/photogrammetry-modal.md` | Doc operativo Modal | Archivar a `docs/archive/2026-05/` con prefix `RETIRED-`. |
| `PHOTOGRAMMETRY_ENGINE=modal` switch en código | Configurable | Hard-code a `colmap` o eliminar el switch entero. |
| Tests E2E que asumen Modal | Pueden existir | Re-mock contra colmapAdapter. |

**Ventana de migración:** una vez merge PR #450 + PR #451, abrir PR follow-up `chore(photogrammetry): retirar Modal — COLMAP es la única ruta canónica (ADR 0005 v2 + ADR 0019)`.

## Open question — duplicado interno COLMAP Python vs TypeScript

Existen DOS implementaciones de Cloud Run worker COLMAP:

* **`infra/photogrammetry-worker/server.py`** — Python Flask + gunicorn. Wireada como fallback en arquitectura previa.
* **`cloud-run/photogrammetry-worker/src/index.ts`** — TypeScript + Express. Variante Sprint 38 Brecha C.

Ambas ejecutan la misma binary COLMAP. La auth bypass fix commit `df5cb9e7` (Bloque 1.6) endureció la variante TypeScript; la Python ya tenía `hmac.compare_digest`.

**Decisión pendiente Bloque 8.1 (master plan):**

* **Opción A** — Python canónica (`infra/`). Eliminar TypeScript. Justificación: imagen Docker más pequeña, sin runtime Node, mirror exacto de docs CLI COLMAP.
* **Opción B** — TypeScript canónica (`cloud-run/`). Eliminar Python. Justificación: parity de lenguaje con main app, structured logs aliñeados con otros Cloud Run services, hardened en Bloque 1.6.

Bench cost/latency + cron audit pendientes antes de decidir.

## Consequences

**Positive:**

- Main app sigue MIT-only sin CUDA/native CV deps.
- Google Cloud Run maneja autoscaling worker sin manejar GPU pool.
- Costo predecible per-job, sin compromiso GPU rental.
- Aliñeado con ADR 0019 (Google + OSS critical).
- Sin vendor third-party single-point-of-failure.

**Negative:**

- COLMAP CPU es ~4x más lento que GPU (10-15 min vs 3 min). El UI debe ser explícito sobre el tiempo de proceso para no frustrar al usuario.
- Cloud Run costos suben con volumen alto. Mitigación: Phase A MapLibre + Phase B Blender absorben mayoría de casos; SfM sólo cuando se justifica.

**Operational:**

- Runbook activo: `cloud-run/photogrammetry-worker/README.md` (la versión Python tiene `infra/photogrammetry-worker/`).
- Job timeout: 30 min.
- Jobs >30 min marcados como stale por orchestrator.
- Modal-related docs (`docs/photogrammetry-modal.md`) marcados como RETIRED.

## Alternatives considered (reaffirm)

* **Modal.run** — descartado (este ADR §"DESCARTADO" arriba).
* **Run COLMAP inside main app Cloud Run** — rechazado por contaminación de request timeout + GPU pricing.
* **Google Vertex AI Vision SfM** — sin API GA Praeventio-compatible al momento de decisión. Re-evaluar cuando Google lo publique como GA.
* **Reality Capture (Epic Games)** — proprietary, per-seat licensing, no compatible B2B SaaS.
* **Lambda layer Meshroom** — image size excede límite 250 MB unzipped Lambda.
* **RunPod / Replicate / Banana / Beam** — todas third-party GPU rental, mismo problema que Modal — descartado por ADR 0019.

## References

* ADR 0019 — Google ecosystem foundation + OSS critical complement (decisión raíz).
* `infra/photogrammetry-worker/server.py` — Cloud Run COLMAP canonical (Python).
* `cloud-run/photogrammetry-worker/src/index.ts` — Cloud Run COLMAP duplicate (TypeScript, Sprint 38).
* `src/services/digitalTwin/photogrammetry/` — TS adapters consumidos por main app.
* `DIGITAL_TWIN_GPU_FREE_PLAN.md` — análisis de 11 alternativas SfM (2026-05-03).
* `docs/audits/AUDIT_EXHAUSTIVA_2026-05-19.md` §8.1 — dedup Python vs TypeScript.
* ADR 0008 — DWG converter (mismo patrón HTTP-boundary).
* ADR 0011 — Digital Twin triple-gate auth.

## Changelog

* **2026-05-19 (founder directiva via ADR 0019):** Descartado Modal. COLMAP Cloud Run pasa de fallback a canónico único. Phase A MapLibre como preferencia primaria UX, Phase B Blender, Phase C COLMAP.
* **2026-05-19 (primera versión):** Documentaba Modal como primary + COLMAP como fallback — incorrecta por conflicto con ADR 0019 (no detectado en primera redacción).
* **2026-04-29 → 2026-05-04 (Sprint 21-38):** Implementación original con Modal primary.
