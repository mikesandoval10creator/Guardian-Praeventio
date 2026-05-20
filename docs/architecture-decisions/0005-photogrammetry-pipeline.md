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

#### C2 — Cloud Run COLMAP CPU — **DESCARTADO** (founder 2026-05-19, segunda corrección)

`infra/photogrammetry-worker/server.py` (Python Flask) + `cloud-run/photogrammetry-worker/src/index.ts` (TypeScript Sprint 38) son scaffold ya construidos, pero **el camino C2 queda descartado del plan** por decisión founder:

> "$5 dolares al mes? Que pasa si falla en subirse el archivo para que Google lo procese, deja el proceso que se haga solo en el celular, y si los dispositivos que tiene el grupo de trabajo no pueden deberán dejar que su celular procese por más tiempo el requerimiento porque no puedo gestionar 5 dolares por video si falla, tengo que considerar y reducir lo máximo posible los gastos para poder hacer rentable la aplicación."

**Razones:**

1. **Costo variable mata rentabilidad** — incluso $0.05-$0.10/captura escala mal: 100 capturas/mes/empresa × 100 empresas = $500-$1000/mes solo en SfM. No es viable sin pricing tier que cubra ese costo, y crear ese tier complica el modelo comercial.
2. **Riesgo de cargo sin entrega** — si el upload a Cloud Run falla a la mitad del transfer, o COLMAP crashea con un video corrupto, **igual se cobró el segundo de CPU consumido**. Cero-tolerancia a este modo de falla.
3. **El reemplazo es viable**: el teléfono del usuario tarda más, pero termina. Si su grupo de trabajo tampoco puede, **el original espera más tiempo (horas) procesando** local — la prevención de riesgos no es real-time; un mesh del sitio puede tomar horas/días sin afectar valor.
4. **Reduce cognitive load del founder** — no hay que monitorear billing Cloud Run, no hay alertas de cuota, no hay sorpresas de mes.

**Estado del código C2:** scaffold queda en repo pero **engine literal `cloud-run` debe rechazarse en runtime** (env var ignorada). Code path muerto, candidato a eliminación junto con Modal post-implementación C1 + C3.

### Decision tree completo Fase C (revisado v4 — sin C2)

```
Usuario inicia captura video 30s
          │
          ▼
   ¿Mi device es capable (capability_score >= 70)?
   │
   ├─ SÍ ─► C1: Procesa local WASM en MI teléfono (15-30 min background)
   │       ─► mesh listo
   │
   └─ NO ─► ¿Hay otros miembros del proyecto con device capable?
            │
            ├─ SÍ ─► C3: Sube video a Google Drive del proyecto
            │       │
            │       └─► Peer del proyecto claima + procesa C1 en SU teléfono
            │           ─► mesh listo
            │
            └─ NO ─► **Mi teléfono procesa igual, sólo más lento (horas)**
                     │
                     └─► C1 en MI teléfono con cargas reducidas
                         (lower-res, menos features, multi-pass overnight)
                         ─► mesh listo (puede tardar 4-8h o overnight)
```

**Principio clarificado founder 2026-05-19:** "todo se procesa on-device". El device del usuario original NUNCA se desconecta del job; sólo lo delega temporalmente a un peer SI hay peer disponible. Si no, sigue siendo trabajo de su mismo teléfono — sólo que más lento.

**Implicación técnica para C1:** el engine WASM debe soportar **modo `low-resource`** que sacrifica calidad/velocidad por viabilidad en hardware débil:
- Sub-sampling de frames del video (5 fps en lugar de 30).
- Resolución downscale a 720p antes de processing.
- Multi-pass con checkpointing (puede reanudar tras reboot del teléfono).
- Service Worker mantiene job vivo en background.
- Notificación al usuario: "Procesando en background. Estimado: 4-8 horas. Te avisamos cuando esté listo."

Este modo es **degradación graceful**, no opt-out. Garantía: el usuario SIEMPRE recibe un mesh — la pregunta es CUÁNDO y a qué calidad.

### Eliminado — Modal.run (third-party GPU rental)

`infra/modal-photogrammetry/app.py` ejecutaba Meshroom 2023.3.0 en Modal.run A10G GPU (~$0.10/job, 180s típico).

**Por qué eliminado** (ADR 0019 + founder directiva 2026-05-19):

1. **Modal NO es Google** — viola ADR 0019 Principio 1.
2. **GPU EXTERNA rental third-party** — viola directiva founder "sin GPU externa".
3. **Vendor lock-in** — Modal podría discontinuar, cambiar precios.
4. **Facturación fuera del Google Cloud Billing** — complica observabilidad.

**Importante:** la decisión de retirar Modal + C2 Cloud Run del CÓDIGO se difiere a follow-up PR **post-investigación C1**. No removemos sin tener el reemplazo claro:

- C1 on-device WASM cubre TODOS los casos (slow path + low-resource mode + peer-to-peer delegation via C3).
- Pero C1 requiere research previo (task #12).

Mientras tanto, Modal Y Cloud Run COLMAP quedan en código pero **NO se invocan**. Los switches `PHOTOGRAMMETRY_ENGINE=modal` y `PHOTOGRAMMETRY_ENGINE=cloud-run` deben rechazarse en runtime (env var ignorada o error explícito).

### Selection logic actual

`src/services/digitalTwin/photogrammetry/index.ts` debe operar así (post-ADR 0005 v4):

1. **Default:** NO ejecutar SfM. El usuario indica explícitamente "necesito reconstrucción 3D del sitio".
2. **Para 80% de casos:** Fase A (Mapa 2.5D Google Maps + Bernoulli) ya cubre.
3. **Para sitios estables:** Fase B (Blender pre-render glTF subido por admin) cubre.
4. **C1 device capable:** on-device WASM (engine cargado en Web Worker + IMU del teléfono).
5. **C3 device débil + peer capable:** delegación intra-tenant via Drive (ADR 0020).
6. **C1 low-resource:** device débil sin peer → on-device modo lento (4-8h overnight).
7. **Nunca:** Modal NI Cloud Run COLMAP (engines literales rechazadas en código).

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
- **$0 costo variable por captura** — sin sorpresas de billing. Total predecible: $0 + Firebase Storage (~$0/mo bajo 5GB).
- Privacy total (video nunca sale del device del usuario o del proyecto).
- Aliñeado con ADR 0019 estrictamente.
- Sin lock-in vendor.
- Modelo comercial simple: no hay que cobrar "$X por captura SfM" extra al usuario; está incluido.

**Negative:**

- C1 está **NO IMPLEMENTADA** — research pendiente sobre qué fork OSS de OpenMVG/COLMAP/etc. funciona en WASM en 2026 con modo low-resource.
- 15-30 min (capable) a 4-8h overnight (low-resource) drena batería; UX debe ser explícita.
- Usuario con dispositivo MUY débil y sin peer capable enfrenta espera larga. Mitigación: copy claro "esto puede tomar horas — la app sigue corriendo en background, te avisamos cuando esté listo".
- Si C1 nunca se vuelve viable en hardware ultra-débil, esos usuarios quedan sin la feature SfM. Se aceptan — la app sigue siendo útil sin SfM (Fase A 2.5D cubre 80% casos).

**Operational:**

- Runbooks Cloud Run COLMAP quedan archivados como referencia histórica, NO operativos.
- C1 research debe agendarse como sprint propio (estimación: 2-3 sprints — research + prototype + integration + modo low-resource).
- Service Worker estrategia para resume background tras kill del browser/app.

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

* **v4 2026-05-19 (este commit):** Founder descarta C2 Cloud Run COLMAP también. Cero costo variable. Decision tree final: C1 (capable) → C3 (peer capable) → C1 low-resource modo lento (4-8h overnight). Si dispositivo MUY débil sin peer, **el mismo teléfono sigue procesando, sólo más lento** — nunca Cloud Run pago. C1 debe soportar modo `low-resource` (sub-sample frames, downscale 720p, multi-pass checkpointing).
* **v3.1 2026-05-19:** Founder agregó patrón peer-to-peer intra-tenant vía Google Drive (Fase C3 nueva). Decision tree v3: C1 → C3 → C2.
* **v3 2026-05-19:** Founder explicó que C1 on-device WASM es el camino correcto (no C2 Cloud Run COLMAP como "primary"). C1 es meta principal aunque NO IMPLEMENTADA. C2 es escape hatch.
* **v2 2026-05-19 (commit `2200214a`):** Modal descartado. COLMAP Cloud Run pasaba a canónica única. (INCORRECTO — saltó C1 on-device que es el objetivo real.)
* **v1 2026-05-19 (commit `657e1299`):** Modal primary + COLMAP fallback. (INCORRECTO — violaba ADR 0019.)
* **Original 2026-04-29 → 2026-05-04 (Sprint 21-38):** Implementación con Modal primary.
