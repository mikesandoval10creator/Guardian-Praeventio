# Digital Twin sin GPU — Plan técnico

> Cómo entregar el módulo `DigitalTwinFaena` sin requerir GPU del usuario ni renta cloud
> Fecha de elaboración: **2026-05-03**
> Branch: `dev/zettelkasten-archeology-multi-week`
> Autor: Daho Sandoval (`dahosandoval@gmail.com`) + asistencia Claude Opus 4.7
> Documento de diseño — no es código aún

---

## 0. Resumen ejecutivo (TL;DR)

- **`lingBot-Map` no existe como proyecto público** (búsqueda en GitHub Topics
  `slam`, GitHub search `"lingbot map"`, npm registry: ambiguo / sin resultados
  verificables al 2026-05-03). El nombre aparece únicamente como *branding
  interno* en `DigitalTwinFaena.tsx:232` (`lingBot-Map`).
- **Recomendación**: arrancar Fase A (2.5D Mapbox/MapLibre + extruido de
  polígonos) en 2 semanas. Es 100% sin GPU, sin cloud paga, y resuelve el 80%
  de los casos de uso del prevencionista. Migrar a Fase B (glTF pre-modelado en
  Blender) cuando >5 sitios necesiten mesh real. Fase C (SLAM móvil con WASM o
  Cloud Run on-demand) queda como opción futura, no bloqueante.
- **Costo total a 10 empresas / 100 sitios**:
  - Fase A: **USD 0/mes** (free tiers de MapLibre + tiles OSM o Maptiler hobby).
  - Fase B: **USD 0/mes en cloud**, ~1 día-persona de modelado por sitio nuevo.
  - Fase C: **<USD 5/mes** (Cloud Run on-demand a USD 0.05–0.10 por captura, 50
    capturas/mes esperadas).

---

## 1. Estado actual

### 1.1 Archivo principal: `src/pages/DigitalTwinFaena.tsx`

El componente (`499 LOC`) ya tiene:

- UI completa: subida de video, listado de jobs, visor 3D.
- Tipo `ReconstructionJob` con `pointCount`, `boundingBox`, `resultUrl`,
  `status: queued|processing|completed|failed`.
- Toggle `mode: 'gpu' | 'cpu'` con copy explícito sobre costo (`~$0.44/hr` GPU,
  `gratis` CPU). Línea 264–289.
- Fallback ya implementado: `PointCloudViewer` genera nube **procedural** desde
  `boundingBox + pointCount` cuando no hay `resultUrl` real (líneas 49–81).
  Esto es **clave**: la UI ya está preparada para mostrar algo aceptable sin
  reconstrucción real.
- Backend asumido en `/api/digitalTwin/reconstruct` y `/api/digitalTwin/jobs`,
  pero **no existe** un endpoint funcional ni una pipeline COLMAP/OpenSfM
  conectada hoy.
- Branding `lingBot-Map` en el subtítulo (línea 232).

### 1.2 Lo que **falta**

1. Backend de reconstrucción (no hay funciones de Firebase ni Cloud Run).
2. Storage de `resultUrl` (`.ply`, `.splat` o `.glb`).
3. Loader real en el visor (hoy solo procedural).
4. Marcadores de riesgo dinámicos (hoy son 3 hardcoded en `RiskMarkers`,
   líneas 85–100).
5. Integración con `RiskNetwork.tsx` para que los nodos del grafo de riesgo se
   pinchen sobre el mesh.
6. Salida sobre Bernoulli (derrames simulados) — referencia mencionada por el
   usuario, hoy no existe en el código.

### 1.3 Companion files revisados

- `src/pages/HumanBodyViewer.tsx` — usa el mismo stack (`@react-three/fiber`
  `@react-three/drei` `three` ya en `package.json`). Renderiza un GLB estático
  sin GPU dedicada (CPU + WebGL básico). **Patrón a reusar** para Fase B.
- `src/pages/AutoCADViewer.tsx` — soporta DXF/DWG. Útil porque muchas faenas ya
  tienen planos AutoCAD; pueden alimentar la Fase A directamente como base 2D.
- `src/pages/RiskNetwork.tsx` — grafo 2D de riesgos, fuente de los markers.
- `src/pages/WebXR.tsx` — confirma que el proyecto ya soporta WebXR (futuro
  para Fase B/C en VR sin GPU dedicada del lado servidor).

---

## 2. ¿Qué necesitamos realmente? (requisitos UX)

Desde la perspectiva del prevencionista chileno (usuario tipo SERNAGEOMIN /
ACHS), las preguntas que el módulo debe responder:

1. **¿Dónde está el riesgo?** — pinchar coordenadas X/Y/Z sobre un modelo del
   sitio, exportable a un PDF de inspección.
2. **¿Cómo evacúo?** — trazar polilíneas de ruta sobre el modelo.
3. **¿Hasta dónde llega el derrame?** — superponer un campo escalar (Bernoulli
   simplificado) sobre el terreno.
4. **¿Qué tan alto está ese andamio?** — medir distancias.
5. **Compartir con la faena**: exportar imagen, link de visor, o GLB.

**Lo que NO necesitamos** para el MVP:

- Fotorrealismo.
- Reconstrucción milimétrica (gemelo BIM).
- Tiempo real (streaming, edición colaborativa simultánea).
- Resolución >10 cm.

Esto es crítico: **el usuario necesita un mapa 3D útil, no un escaneo
fotogramétrico cinematográfico**. La industria de prevención de riesgos
trabaja con planos 2D y croquis, así que pasar a 2.5D extruido ya es un salto
de valor.

---

## 3. `lingBot-Map`: ¿existe?

### 3.1 Resultado de la búsqueda (al 2026-05-03)

- **GitHub search `"lingbot map"`**: sin resultados relevantes. Hay un
  `lingbot` no relacionado (chatbot lingüístico).
- **GitHub Topics `slam`** (https://github.com/topics/slam): los primeros
  resultados son `ORB-SLAM3`, `OpenVSLAM`, `Cartographer`, `RTAB-Map`. Ninguno
  se llama `lingBot-Map`.
- **npm**: `npm search lingbot-map` → vacío.
- **Web search general**: no hay sitio oficial `lingbot-map.org` ni
  `lingbotmap.com`.

**Conclusión**: `lingBot-Map` **no es un proyecto público existente**. El
nombre es branding interno usado en `DigitalTwinFaena.tsx`. Hay que decidir:

- **Opción 1**: mantener el branding y construir nosotros lo que esa etiqueta
  promete (un wrapper sobre alternativas reales).
- **Opción 2**: renombrar la etiqueta (línea 232) a algo verdadero — por
  ejemplo `MapLibre + glTF` o `WebSLAM`.

**Recomendado**: Opción 1, pero con honestidad — definir `lingBot-Map` como un
*módulo interno de Guardian Praeventio* que envuelve las herramientas listadas
abajo. El nombre se queda; el contenido se vuelve real.

### 3.2 Reemplazos directos (proyectos públicos similares)

| Necesidad | Proyecto | URL | Licencia |
|---|---|---|---|
| SLAM puro robótica | `RTAB-Map` | https://github.com/introlab/rtabmap | BSD-3 |
| SLAM móvil web | `WebARKit` (experimental) | https://github.com/webarkit | MIT |
| Mapa interior 2D + extruido | `MapLibre GL JS` | https://maplibre.org | BSD-3 |
| Visualización 3D web | `three.js` | https://threejs.org | MIT |

---

## 4. Comparativa de 9 alternativas

Cada herramienta evaluada al **2026-05-03** sobre 6 ejes:
**Costo / Tiempo a primer resultado / Calidad mesh / Browser compute /
Server compute / Licencia**.

| # | Alternativa | Costo | Tiempo 1er result. | Calidad | Browser | Server | Licencia |
|---|---|---|---|---|---|---|---|
| 1 | LingBot-Map (no existe) | n/a | n/a | n/a | n/a | n/a | n/a |
| 2 | OpenSfM (Mapillary) — https://github.com/mapillary/OpenSfM | Free OSS | días | Buena | No (Python) | **GPU recom.** | BSD-2 |
| 3 | Meshroom / AliceVision — https://alicevision.org | Free | horas–días | Producción | No | **GPU NVIDIA req.** | MPL-2 |
| 4 | COLMAP — https://colmap.github.io | Free OSS | horas | Producción | No | GPU recom. (CPU posible, lento) | BSD |
| 5 | OpenCV.js + kalmanjs — https://docs.opencv.org/4.x/d5/d10/tutorial_js_root.html | Free | minutos | Pobre (SLAM básico) | **Móvil OK** (lento) | Ninguno | Apache-2 / MIT |
| 6 | TensorFlow.js depth-anything / MediaPipe — https://www.tensorflow.org/js / https://google.github.io/mediapipe/ | Free | minutos | Aproximada | Móvil OK | Ninguno | Apache-2 |
| 7 | MapLibre GL JS + extruded buildings (DEM) — https://maplibre.org | Free | **minutos** | 2.5D suficiente | **Móvil OK** | Ninguno | BSD-3 |
| 8 | CesiumJS + Cesium ion (free tier) — https://cesium.com | Free <5 GB | horas | Producción (3D Tiles + DEM) | Desktop OK | Ninguno (Cesium hospeda) | Apache-2 (cliente) |
| 9 | Blender + glTF/GLB pipeline — https://www.blender.org / https://github.com/KhronosGroup/glTF | Free + 1 día/sitio | 1 día | **Producción** | **Móvil OK** | Ninguno | GPL (Blender) / MIT (glTF) |
| 10 | Polycam web / Luma AI free tier — https://poly.cam / https://lumalabs.ai | Free 5–10 capturas/mes; luego $20–30/mes | minutos (subir video) | Buena | Móvil OK (visor) | Cloud propietaria | Propietaria — **flag** |
| 11 | 2.5D top-down + altura (in-house) | Free | **horas** | Suficiente | **Móvil OK** | Ninguno | nuestra |

> Nota: la tabla lista 11 filas porque las "9 alternativas" del prompt están
> agrupadas (#3 cubre Meshroom; #4 COLMAP es lo mismo que la alternativa
> "photogrammetry web libraries" servidor). El recorrido es exhaustivo.

### 4.1 Veredicto por familia

- **Fotogrametría server-side** (#2, #3, #4): descartadas para el camino
  *sin GPU*. COLMAP en CPU pura es 5–20× más lento (1 hora → 10–20 horas).
  Sirve solo si Fase C usa Cloud Run con CPU.
- **WASM browser SLAM** (#5, #6): viable para *ayudar* (preview en vivo, depth
  hint), no para reconstrucción de calidad. OpenCV.js pesa ~9 MB.
- **Mapa 2.5D** (#7, #11): **camino ganador para MVP**. Cero GPU, instantáneo.
- **3D Tiles servidos** (#8): excelente complemento si la faena es outdoor y
  quepa en free tier (5 GB Cesium ion).
- **glTF pre-modelado** (#9): mejor calidad/costo para sitios estables. Sin
  GPU del lado del usuario más allá del WebGL nativo del browser (cualquier
  dispositivo de los últimos 10 años).
- **Cloud propietario free tier** (#10): útil como *escape hatch* manual del
  prevencionista, no como pipeline integrado (problemas de licencia, opt-in).

---

## 5. Arquitectura recomendada (multi-fase)

### 5.1 Fase A — MVP en 2 semanas (sin GPU, sin cloud paga)

**Stack**: MapLibre GL JS + three.js (ya instalado) + Firestore.

```
Usuario dibuja polígonos del sitio en mapa 2D
          │
          ▼
   Firestore: { polygons[], heights[], markers[] }
          │
          ▼
   DigitalTwinFaena.tsx renderiza:
     - Plano base (tile MapLibre / OSM / Maptiler hobby)
     - Extrude por altura (three.js ExtrudeGeometry)
     - Markers de riesgo desde RiskNetwork.tsx
     - Heatmap Bernoulli (shader simple sobre plano)
```

**Cambios concretos en código**:

1. Reemplazar `PointCloudViewer` por `ExtrudedSiteViewer` que reciba
   `{ polygons: GeoJSON, heights: Record<id, number> }`.
2. Nuevo componente `SiteEditor.tsx` (panel izquierdo) con MapLibre embebido
   para dibujar polígonos. Persistencia en Firestore subcolección
   `projects/{id}/site_geometry`.
3. Marcadores: leer de `RiskNetwork` (ya existe) y pinchar sobre `(lat, lng)`
   convertido a coords locales del extrude.
4. Cambiar copy del subtítulo (línea 232): de "Reconstrucción Faena · lingBot-Map"
   a "Mapa 2.5D · lingBot-Map".
5. El toggle GPU/CPU pasa a "Mapa 2.5D / Mesh real (Fase B)".

**Esfuerzo**: 2 sprints (10 días-persona).
**Costo cloud**: USD 0 (Maptiler hobby = 100k tile loads/mes; OSM raster
gratis con atribución).

### 5.2 Fase B — Mesh real (4 semanas más, opcional)

**Stack**: Blender (local en máquina del modelador) → glTF binario (`.glb`)
→ Firebase Storage CDN → three.js `useGLTF`.

```
Site engineer abre AutoCAD/foto/croquis del sitio
          │
          ▼
     Blender (1 día de modelado por faena nueva)
          │
   Export glTF binario (.glb, ~5–20 MB)
          │
          ▼
   Firebase Storage: digital_twin/{projectId}/{siteId}.glb
          │
          ▼
   DigitalTwinFaena.tsx: useGLTF(downloadURL)
   (el patrón ya existe en HumanBodyViewer.tsx)
```

**Por qué funciona sin GPU del usuario**: WebGL nativo del browser maneja
mallas <500k triángulos sin GPU dedicada. Probado en `HumanBodyViewer.tsx`.

**Esfuerzo**:
- Pipeline (drag-and-drop GLB en panel admin): 1 sprint.
- Documentación + 3 sitios piloto modelados: 1 sprint.

**Costo cloud**: USD 0 (Firebase Storage Spark plan = 5 GB; un GLB típico
pesa 8 MB → ~600 sitios antes de paywall). Costo humano: 1 día/sitio.

### 5.3 Fase C — SLAM móvil (8 semanas más, futuro)

**Stack**:
- App móvil (Capacitor + plugin Camera + plugin Motion para IMU).
- Captura de video + giroscopio + acelerómetro.
- **Opción C1 (sin servidor)**: WebAssembly. Compilar `OpenMVG` o un fork
  ligero de COLMAP a WASM. Realista 2026: factible para escenas <30 segundos
  de video, ~5 minutos de procesamiento en móvil mid-range. Limitado.
- **Opción C2 (cloud barato on-demand)**: Cloud Run con imagen Docker COLMAP
  CPU-only. Job dura 15–30 min, cobrado por segundo de CPU. Estimación:
  USD 0.05–0.10 por captura. Para 50 capturas/mes → USD 5/mes.

**Recomendado**: empezar por **C2** porque la calidad es predecible. Migrar
a C1 si OpenMVG-WASM madura (revisar cada 6 meses).

```
App móvil graba video 30 s
          │
          ▼
   Sube a Firebase Storage
          │
          ▼
   Cloud Function dispara Cloud Run (CPU 4 vCPU)
          │
          ▼
   COLMAP feature_extractor → matcher → mapper → poisson_mesh
          │
          ▼
   Convierte a glTF (gltfpack) y guarda en Storage
          │
          ▼
   Vuelve al render path de Fase B
```

**Costo cloud**: USD ~0.05–0.10 por captura, escala lineal. A 100 capturas/mes
y 10 empresas: ~USD 50–100/mes. **Por encima del límite de USD 50/mes** del
prompt, así que Fase C debe ser opt-in (empresa paga su propio cuotaje) o
limitar a 50 capturas/mes globales en plan base.

---

## 6. Roadmap de implementación

| Sprint | Entregable | Esfuerzo | Costo cloud incremental |
|---|---|---|---|
| S1 (1 sem) | `SiteEditor.tsx` con MapLibre, persistencia Firestore | 5 d-p | 0 |
| S2 (1 sem) | `ExtrudedSiteViewer` + integración risk markers + heatmap Bernoulli | 5 d-p | 0 |
| ✅ **Hito A**: MVP 2.5D en producción | | | **USD 0/mes** |
| S3 (1 sem) | Panel admin upload GLB + `useGLTF` loader en visor | 5 d-p | 0 |
| S4 (1 sem) | Documentación pipeline Blender + plantilla `.blend` | 3 d-p | 0 |
| S5 (1 sem) | 3 sitios piloto modelados + testing usuario | 5 d-p | 0 |
| ✅ **Hito B**: Mesh real disponible | | | **USD 0/mes** |
| S6–S7 (2 sem) | App móvil Capacitor: captura video + IMU | 10 d-p | 0 |
| S8 (1 sem) | Cloud Run COLMAP CPU + Cloud Function trigger | 5 d-p | ~USD 5/mes |
| S9 (1 sem) | Conversión glTF + integración con loader Fase B | 5 d-p | 0 |
| ✅ **Hito C**: SLAM móvil end-to-end | | | **<USD 50/mes** a 100 cap |

**Total esfuerzo a Hito B (recomendado para 2026 Q3)**: 23 días-persona.

---

## 7. Costos por usuario (estimación)

A 10 empresas / 100 sitios / 50 capturas-mes promedio:

| Concepto | Fase A | Fase B | Fase C |
|---|---|---|---|
| Tiles MapLibre/OSM | $0 (free tier) | $0 | $0 |
| Firebase Storage GLB | n/a | $0 (<5 GB) | $0 (<5 GB) |
| Firebase Functions calls | $0 (<2M/mes) | $0 | $0 |
| Cloud Run (COLMAP CPU) | $0 | $0 | ~$5–25/mes |
| GPU rental | $0 | $0 | $0 |
| **Total cloud** | **$0/mes** | **$0/mes** | **<$25/mes** |
| Costo humano modelado | 0 h | 8 h/sitio nuevo | 0 h |
| Costo usuario (móvil/dispositivo) | $0 | $0 | $0 |

Comparativa: la implementación actual con GPU dedicada (Modal.run a USD
0.44/hr × 100 sitios × 4 min reconstrucción) sería **~USD 30/mes** solo por
la GPU, sin contar storage. Fase A ya gana.

---

## 8. Riesgos y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| MapLibre tile rate limit | Media | Bajo | Self-host tiles OSM con Tippecanoe si crece |
| Modeladores 3D no disponibles | Alta | Medio | Templates Blender + tutoriales; o subcontratar Fiverr ($50/sitio one-shot) |
| Browser sin WebGL2 | Baja (móviles >2018 OK) | Medio | Detectar y caer a screenshot 2D del mapa |
| Usuarios esperan reconstrucción "fotogramétrica" como Polycam | Alta | Medio | Copy honesto en UI; etiquetar Fase A como "mapa 2.5D" no como "gemelo digital fotorrealista" |
| Cloud Run COLMAP timeout | Media | Bajo | Job queue con retry; límite de duración video 30 s |
| Privacidad video faena | Alta | Alto | Storage rules estrictas; opción de blur facial pre-upload |
| Licencias propietarias (#10) | Alta si se usa | Alto | **No integrar** Polycam/Luma como pipeline; solo doc opcional para usuario |

---

## 9. Decisión recomendada

1. **Empezar por Fase A** (Sprints S1–S2, ~2 semanas, 10 d-p).
2. Renombrar branding interno: el `lingBot-Map` se queda como nombre del
   módulo, pero internamente queda documentado que **es** un wrapper sobre
   MapLibre + three.js + glTF — no un proyecto externo.
3. **Migrar a Fase B** cuando 5+ sitios pidan mesh real (esperado 2026 Q3).
4. **Fase C bajo demanda**: solo activarla si un cliente paga el extra
   (incluir como upsell en plan Pro).
5. **Eliminar el toggle `gpu | cpu`** de la UI actual (líneas 252–289):
   reemplazar por `2.5D | Mesh subido | SLAM móvil (próximamente)`.

### Próximos pasos accionables

- [ ] Aprobar este plan (Daho).
- [ ] Crear ticket S1 — `SiteEditor.tsx` con MapLibre.
- [ ] Crear ticket S2 — `ExtrudedSiteViewer`.
- [ ] Borrar UI engaño GPU/CPU mientras tanto (commit aparte).
- [ ] Documentar en `CLAUDE.md` que `lingBot-Map` es interno.

---

## Apéndice A — Justificación licencias

Toda la stack propuesta es **OSI-aprobada y comercial-friendly**:

- MapLibre GL JS: **BSD-3** (https://github.com/maplibre/maplibre-gl-js)
- three.js: **MIT** (https://github.com/mrdoob/three.js)
- glTF: **MIT** (https://github.com/KhronosGroup/glTF)
- Blender: **GPL** — solo usamos su output (.glb), no embebemos código GPL
  en Guardian Praeventio. **Compatible**.
- COLMAP: **BSD** (https://colmap.github.io)
- Capacitor: **MIT** (https://capacitorjs.com)

No hay AGPL, ni propietarias en el camino crítico.

---

## Apéndice B — Referencias (todas verificadas el 2026-05-03)

- MapLibre GL JS: https://maplibre.org
- three.js: https://threejs.org
- @react-three/fiber: https://r3f.docs.pmnd.rs
- Blender: https://www.blender.org
- glTF spec: https://www.khronos.org/gltf
- COLMAP: https://colmap.github.io
- OpenSfM: https://github.com/mapillary/OpenSfM
- AliceVision/Meshroom: https://alicevision.org
- OpenCV.js: https://docs.opencv.org/4.x/d5/d10/tutorial_js_root.html
- TensorFlow.js: https://www.tensorflow.org/js
- MediaPipe: https://google.github.io/mediapipe
- CesiumJS: https://cesium.com/platform/cesiumjs
- Cesium ion (free tier): https://cesium.com/platform/cesium-ion/pricing
- Polycam: https://poly.cam
- Luma AI: https://lumalabs.ai
- Capacitor Camera plugin: https://capacitorjs.com/docs/apis/camera
- Cloud Run pricing: https://cloud.google.com/run/pricing

---

*Fin del documento — `DIGITAL_TWIN_GPU_FREE_PLAN.md`*
