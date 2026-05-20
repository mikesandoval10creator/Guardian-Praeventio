# ADR 0005 — Photogrammetry pipeline (Fase A 2.5D ✅ + Fase B Blender + Fase C1 on-device WASM como meta)

* **Status:** Accepted — codifica `DIGITAL_TWIN_GPU_FREE_PLAN.md` (2026-05-03) bajo el marco ADR 0019 (2026-05-19). Versión 3.
* **Date:** 2026-05-19 (corrección final tras founder explicó que C1 on-device WASM es el patrón objetivo, no C2 Cloud Run COLMAP).
* **Deciders:** Sprint 21 backend WG (COLMAP scaffold), founder (decisión 2026-05-19 sobre on-device como meta + descartar Modal).
* **Related:** ADR 0019 (Google ecosystem foundation), ADR 0011 (Digital Twin triple-gate auth), ADR 0008 (DWG converter — mismo patrón HTTP-boundary OSS isolation).

## Context

Praeventio Digital Twin necesita modelo 3D del sitio para que el prevencionista pueda:
1. Pinchar coordenadas X/Y/Z sobre un modelo del sitio (markers de riesgo).
2. Trazar polilíneas de ruta de evacuación.
3. Superponer campo escalar (Bernoulli) para derrames.
4. Medir distancias (¿qué tan alto está ese andamio?).
5. Exportar imagen/link/GLB compartible.

**Lo que NO necesita** (decisión `DIGITAL_TWIN_GPU_FREE_PLAN.md` §2):
- Fotorrealismo.
- Reconstrucción milimétrica (gemelo BIM).
- Tiempo real (streaming, edición colaborativa).
- Resolución >10 cm.

**Restricciones inviolables (ADR 0019):**
- Google ecosystem es la fundación (Firebase, Cloud Run, Cloud Storage).
- OSS sólo en puntos críticos (offline, no-GPU externa, sin equivalente Google).
- Plataformas third-party tipo Modal/RunPod/Replicate = REJECT automático.
- "Funciones duplicadas" online/offline son DISEÑO (siblings, no waste).

## Decision

Arquitectura **multi-fase** de `DIGITAL_TWIN_GPU_FREE_PLAN.md` §5, con ajustes para ADR 0019:

### Fase A — Mapa 2.5D MapLibre/Google Maps (✅ IMPLEMENTADA al 2026-05-03)

Per `DIGITAL_TWIN_GPU_FREE_PLAN.md` §5.1, esta fase está en producción:

- `src/services/digitalTwin/siteGeometry.ts` — modelo GeoJSON + paleta + centroide.
- `src/services/digitalTwin/siteGeometryStore.ts` — `savePolygon` + `subscribeSiteGeometry`.
- `src/components/digital-twin/Site25DPanel.tsx` — panel "Mapa 2.5D del sitio".
- `src/components/digital-twin/HazmatWindOverlay.tsx` — halo downwind por polígono.
- `src/components/digital-twin/RiskNodeMarkers.tsx` — pines por severidad.
- `src/pages/DigitalTwinFaena.tsx` — extendido con tab "Mapa 2.5D".

**Stack final:** `@react-google-maps/api` (ya instalado vía SiteMap) + Firestore + Bernoulli engine. El componente `GoogleMap` con `tilt={45}` + `mapTypeId="hybrid"` da el efecto 2.5D sin sumar dependencia nueva.

**Costo cloud:** $0/mes. Google Maps API ya tiene la `VITE_GOOGLE_MAPS_API_KEY` del proyecto.

**Cumplimiento ADR 0019:** ✅ Google ecosystem (`@react-google-maps/api`) + Firestore + Bernoulli engine OSS local.

**Cubre ~80% de los casos de uso** del prevencionista per `DIGITAL_TWIN_GPU_FREE_PLAN.md` §4.1.

### Fase B — Blender → glTF pre-modelado (planeada, pipeline pendiente)

Per `DIGITAL_TWIN_GPU_FREE_PLAN.md` §5.2:

* **Software:** Blender (GPL — corre offline en máquina del modelador, no se linkea al app bundle = OK por mere aggregation).
* **Output:** glTF/GLB binario (MIT format).
* **Storage:** Firebase Storage (Google ecosystem = OK).
* **Visor:** `useGLTF` con `@react-three/fiber` + `three.js` (MIT, ya en bundle). El patrón existe en `src/pages/HumanBodyViewer.tsx`.
* **Costo cloud:** $0 (Firebase Spark plan 5 GB; GLB típico 8 MB → ~600 sitios antes paywall).
* **Costo humano:** ~1 día persona/site.
* **Sin GPU dedicada:** WebGL nativo del browser maneja mallas <500k triángulos.

**Esfuerzo restante:** S3-S5 del roadmap §6 — panel admin upload GLB + 3 sitios piloto modelados.

### Fase C — SLAM móvil (objetivo, parcialmente implementada)

Per `DIGITAL_TWIN_GPU_FREE_PLAN.md` §5.3, **dos sub-opciones**:

#### C1 — On-device WebAssembly (META PRINCIPAL, NO IMPLEMENTADA)

> "App móvil graba video 30 s → procesamiento ON-DEVICE (mismo dispositivo que capturó) → mesh listo en 15-30 min en background."

* **Stack:** Capacitor (MIT, ya en proyecto) + plugin Camera + plugin Motion para IMU.
* **Engine:** **OpenMVG o COLMAP compilado a WebAssembly** (research pendiente — qué fork OSS está realmente listo en 2026).
* **Costo cloud:** **$0** (zero — todo corre en el teléfono del trabajador).
* **Costo del usuario:** $0 (su mismo dispositivo).
* **Latencia:** 15-30 min en móvil mid-range, en background.
* **Cumplimiento ADR 0019:** ✅ **DOBLE** — OSS software + ejecución en device del usuario (no infra Google ni third-party). Cumple "sin GPU externa" literal.
* **Privacy:** ✅ video nunca sale del dispositivo.
* **Offline:** ✅ funciona sin red disponible.

**Estado actual:** **NO IMPLEMENTADO.** El plan §5.3 lo lista como C1 "limitado" en 2026; founder 2026-05-19 explicitó que es el camino correcto AUN cuando sea lento (15-30 min OK como background).

**Trabajo pendiente para implementar C1:**

1. Research repos OSS reales (2026): qué fork de OpenMVG/COLMAP/OpenSfM tiene build WASM funcional. Candidatos a evaluar:
   - OpenMVG (https://github.com/openMVG/openMVG) — C++, hay forks WASM experimentales.
   - COLMAP-WASM forks comunidad.
   - WebARKit (https://github.com/webarkit) — más SLAM-AR que SfM, pero relevante para captura.
   - Brush splat (gaussian splat WebGPU) — alternativa moderna que usa la GPU del NAVEGADOR (no externa).
2. Integration con Capacitor: plugin Camera + plugin Motion para captura + IMU.
3. Web Worker para no bloquear UI durante los 15-30 min de procesamiento.
4. Service Worker + IndexedDB para resume en background si el usuario cierra la app.
5. UI explícita: "Tu reconstrucción 3D del sitio se está procesando en tu teléfono. Te avisamos cuando esté lista (15-30 min)."

**ADR 0005 v3 — meta objetivo C1 como path canónico cuando esté implementado.**

#### C3 — Peer-to-peer intra-tenant vía Google Drive (NUEVA, idea founder 2026-05-19)

**Ver ADR 0020 completo.** Resumen:

Si el dispositivo del trabajador NO es capaz de procesar C1, pero el proyecto tiene OTROS miembros con teléfonos capaces:

1. User A graba video → sube a Google Drive del proyecto (folder restringido a miembros).
2. Cloud Function publica notification FCM al topic project-photogrammetry-capable.
3. User B (mismo proyecto, device capable) recibe notify, claima el job (Firestore transaction), descarga video, procesa con C1 WASM local, sube mesh a Firebase Storage.
4. User A recibe notification: "Tu reconstrucción 3D del sitio X está lista, generada por [User B]".

**Cumplimiento ADR 0019:** ✅ **TRIPLE** — OSS WASM en device de User B + Google Drive (Workspace) + Firebase + FCM, todo Google ecosystem.

**Costo cloud:** $0 (zero — Drive ya está en plan Workspace, mesh ~8 MB cabe en Spark plan Firebase Storage 5GB).

**Gate intra-tenant:** Firestore rules + Drive ACL + Storage rules enforzan que solo miembros del proyecto pueden claimar/procesar. Usuario externo no puede.

**Dependencia:** requiere C1 implementada primero (no tiene sentido peer-to-peer si nadie puede procesar).

#### C2 — Cloud Run COLMAP CPU (ESCAPE HATCH, parcialmente implementada)

Per `DIGITAL_TWIN_GPU_FREE_PLAN.md` §5.3:

* **Software:** COLMAP `automatic_reconstructor` (BSD-3).
* **Infra:** Google Cloud Run CPU-only (Google ecosystem = OK).
* **Costo cloud:** ~$0.05-0.10/captura, ~$5/mes a 50 capturas. **Por debajo del threshold $50/mes** del plan §7.
* **Latencia:** 15-30 min Cloud Run CPU (sin GPU).
* **Cumplimiento ADR 0019:** ✅ OSS software (COLMAP BSD-3) + Google infra (Cloud Run) + sin GPU externa.

**Estado actual:** parcialmente implementada — `infra/photogrammetry-worker/server.py` (Python Flask) + duplicado `cloud-run/photogrammetry-worker/src/index.ts` (TypeScript, Sprint 38) existen como scaffold. Auth bypass hardened en Bloque 1.6 (`df5cb9e7`).

**Cuándo usar C2 (NO C3 ni C1):**

- C1 fallaría (dispositivo débil) **Y** C3 no aplica (proyecto sin miembros capaces ni red para coordinar) **Y** el usuario tiene red para subir a Cloud Run.
- El usuario tiene red disponible y prefiere turnaround predecible "ahora" (vs esperar peer disponible).
- Esquema de fallback final cuando ninguna ruta on-device/peer es viable.

**C2 es el escape hatch último, NO el camino canónico.** Orden de preferencia: **C1 (mi device) → C3 (peer del proyecto) → C2 (Cloud Run)**.

### Decision tree completo Fase C

```
Usuario inicia captura video 30s
          │
          ▼
   ¿Mi device es capable (capability_score >= 70)?
   │
   ├─ SÍ ─► C1: Procesa local WASM (15-30 min background) ─► mesh
   │
   └─ NO ─► ¿Hay otros miembros del proyecto con device capable?
            │
            ├─ SÍ ─► C3: Sube video a Google Drive del proyecto
            │       │
            │       └─► Peer claima + procesa C1 ─► mesh
            │
            └─ NO ─► ¿Online?
                     │
                     ├─ SÍ ─► C2: Cloud Run COLMAP (~$5/mes, escape hatch)
                     │
                     └─ NO ─► UI: "Tu equipo no puede procesar esto offline.
                              Conéctate a red para usar Cloud Run." (degrade gracefully)
```

### Eliminado — Modal.run (third-party GPU rental)

`infra/modal-photogrammetry/app.py` ejecutaba Meshroom 2023.3.0 en Modal.run A10G GPU (~$0.10/job, 180s típico).

**Por qué eliminado** (ADR 0019 + founder directiva 2026-05-19):

1. **Modal NO es Google** — viola ADR 0019 Principio 1.
2. **GPU EXTERNA rental third-party** — viola directiva founder "sin GPU externa".
3. **Vendor lock-in** — Modal podría discontinuar, cambiar precios.
4. **Facturación fuera del Google Cloud Billing** — complica observabilidad.

**Importante:** la decisión de retirar Modal del CÓDIGO se difiere a follow-up PR **post-investigación C1**. No removemos sin tener el reemplazo claro:

- C2 Cloud Run COLMAP cubre el caso "necesito reconstrucción ahora con red" — ya existe.
- C1 on-device WASM cubre el caso "offlineworks + sin costo cloud" — pendiente investigación.

Mientras tanto, Modal queda en código pero **no se invoca**. El switch `PHOTOGRAMMETRY_ENGINE=modal` debe rechazarse en código (env var ignorada o error explícito).

### Selection logic actual

`src/services/digitalTwin/photogrammetry/index.ts` debe operar así (post-ADR 0005 v3):

1. **Default:** NO ejecutar SfM. El usuario indica explícitamente "necesito reconstrucción 3D del sitio".
2. **Para 80% de casos:** Fase A (Mapa 2.5D Google Maps + Bernoulli) ya cubre.
3. **Para sitios estables:** Fase B (Blender pre-render glTF subido por admin) cubre.
4. **Si C1 implementada:** prioridad on-device WASM (engine cargado en Web Worker + IMU del teléfono).
5. **Si C1 no disponible** (dispositivo no soportado o aún no implementada): fallback C2 Cloud Run COLMAP.
6. **Nunca:** Modal (engine literal rechazada en código).

### Boundary

* El main app NUNCA importa COLMAP, OpenCV, ni librerías SfM nativas en el bundle web/server principal.
* WASM SfM (C1 futura): cargado dinámicamente en Web Worker — main bundle no engorda hasta que el usuario active la feature.
* Cloud Run worker (C2): HTTPS sólo con `videoUri` (gs://) in y `meshUri` (gs://) out.
* Job records: Firestore `tenants/{tenantId}/photogrammetry_jobs/{jobId}`. Main app polled Firestore.

## Plan de retiro Modal (diferido)

Acción retiro Modal queda **bloqueada hasta** que:

1. C1 on-device WASM esté investigada (3 candidatos OSS evaluados, prototipo funcional con 1 video real).
2. C2 Cloud Run COLMAP esté operativa end-to-end (smoke test con video real → mesh `.ply` → visor).

Una vez ambos cumplidos, abrir PR `chore(photogrammetry): retirar Modal — C1 on-device + C2 Cloud Run cubren el caso`:

| Item | Acción |
|---|---|
| `infra/modal-photogrammetry/` | Eliminar el directorio. |
| `src/services/digitalTwin/photogrammetry/modalAdapter.ts` | Eliminar. |
| `MODAL_TOKEN`, `MODAL_SUBMIT_URL`, `MODAL_STATUS_URL` | Quitar de `.env.example` + rotar/desactivar tokens reales en Modal dashboard. |
| `docs/photogrammetry-modal.md` | Archivar a `docs/archive/2026-05/RETIRED-photogrammetry-modal.md`. |
| `PHOTOGRAMMETRY_ENGINE=modal` switch | Eliminar o rechazar explícitamente en runtime. |
| Tests E2E que asumen Modal | Re-mock contra colmapAdapter o wasmAdapter. |

## Open question — duplicado interno COLMAP Python vs TypeScript

Existen DOS implementaciones de Cloud Run worker COLMAP:

* `infra/photogrammetry-worker/server.py` — Python Flask + gunicorn.
* `cloud-run/photogrammetry-worker/src/index.ts` — TypeScript + Express (Sprint 38).

Ambas ejecutan la misma binary COLMAP. Decisión pendiente Bloque 8.1 (master plan):

* **Opción A** — Python canónica. Eliminar TypeScript. Justificación: image Docker más pequeña, mirror exacto docs CLI COLMAP.
* **Opción B** — TypeScript canónica. Eliminar Python. Justificación: parity de lenguaje con main app.

Bench cost/latency + cron audit pendientes antes de decidir.

## Consequences

**Positive:**

- Main app sigue MIT-only sin CUDA/native CV deps.
- Cuando C1 esté implementada: zero costo cloud, zero dependencia third-party, privacy total (video nunca sale del device).
- Mientras tanto: C2 Cloud Run COLMAP da turnaround predecible para casos urgentes (~$5/mes a 50 capturas).
- Aliñeado con ADR 0019 estrictamente.
- Sin lock-in vendor.

**Negative:**

- C1 está **NO IMPLEMENTADA** — research pendiente sobre qué fork OSS de OpenMVG/COLMAP/etc. funciona en WASM en 2026.
- 15-30 min de cómputo en el teléfono drena batería; UX debe ser explícita ("background, te avisamos").
- C2 Cloud Run COLMAP CPU es ~4x más lento que GPU (10-15 min vs 3 min Modal histórico). El UI debe ser explícito sobre el tiempo.

**Operational:**

- Runbooks: `cloud-run/photogrammetry-worker/README.md` (TS), `infra/photogrammetry-worker/README.md` (Python).
- Job timeout: 30 min.
- Jobs >30 min marcados stale por orchestrator.
- C1 research debe agendarse como sprint propio (estimación: 2-3 sprints — research + prototype + integration).

## Alternatives considered (reaffirm)

* **Modal.run** — descartado (ADR 0019 third-party + GPU externa, doble violación).
* **Polycam / Luma AI free tier** — descartado en `DIGITAL_TWIN_GPU_FREE_PLAN.md` §4.1 (licencia propietaria, opt-in del usuario máximo).
* **RunPod / Replicate / Banana / Beam** — descartados en ADR 0019 (third-party GPU rental).
* **Meshroom server-side GPU** — descartado por requerir GPU NVIDIA + lentitud CPU 5-20×.
* **AliceVision** — descartado mismo motivo.
* **Cesium ion 3D Tiles** — interesante para outdoor sites pero quitra el control del visor a un servicio externo. Descartado por defecto, evaluable como opcional futuro.

## References

* ADR 0019 — Google ecosystem foundation + OSS critical complement (decisión raíz).
* `DIGITAL_TWIN_GPU_FREE_PLAN.md` (2026-05-03) — análisis exhaustivo de 11 alternativas SfM + roadmap multi-fase. Fuente canónica del plan.
* `infra/photogrammetry-worker/server.py` — Cloud Run COLMAP Python (C2 partial).
* `cloud-run/photogrammetry-worker/src/index.ts` — Cloud Run COLMAP TypeScript (C2 partial duplicate).
* `src/components/digital-twin/Site25DPanel.tsx` — Fase A implementada.
* `src/components/digital-twin/RiskNodeMarkers.tsx` — Fase A markers.
* `src/services/digitalTwin/siteGeometry.ts` — Fase A geometry model.
* `src/pages/DigitalTwinFaena.tsx` — entrypoint UI Digital Twin.
* `src/pages/HumanBodyViewer.tsx` — patrón useGLTF para Fase B reusable.
* ADR 0008 — DWG converter (mismo patrón HTTP-boundary OSS isolation).
* ADR 0011 — Digital Twin triple-gate auth.

## Changelog

* **v3.1 2026-05-19 (commit follow-up):** Founder agregó patrón peer-to-peer intra-tenant vía Google Drive (Fase C3 nueva). Order de preferencia: C1 (mi device) → C3 (peer) → C2 (Cloud Run). Ver ADR 0020 completo. Decision tree actualizado.
* **v3 2026-05-19:** Founder explicó que C1 on-device WASM es el camino correcto (no C2 Cloud Run COLMAP como "primary"). C1 es meta principal aunque NO IMPLEMENTADA. C2 es escape hatch. Modal eliminado de plan pero retiro de código DIFERIDO hasta C1 investigada + C2 operativa.
* **v2 2026-05-19 (commit `2200214a`):** Modal descartado. COLMAP Cloud Run pasaba a canónica única. (INCORRECTO — saltó C1 on-device que es el objetivo real.)
* **v1 2026-05-19 (commit `657e1299`):** Modal primary + COLMAP fallback. (INCORRECTO — violaba ADR 0019.)
* **Original 2026-04-29 → 2026-05-04 (Sprint 21-38):** Implementación con Modal primary.
