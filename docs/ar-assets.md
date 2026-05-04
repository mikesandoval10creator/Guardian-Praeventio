# AR assets — `.glb` y `.usdz` para PlacedObjectKind

Sprint 21 Ola 4 Bucket M.2.

Este documento explica cómo Praeventio genera y entrega los assets 3D que
alimentan las dos rutas de realidad aumentada del producto:

- **WebXR** (Android Chrome, Edge Mobile, Quest Browser, Samsung Internet) →
  consume `.glb` directamente vía Three.js / `<model-viewer>` (Bucket L).
- **AR Quick Look** (iPhone / iPad — iOS Safari y iOS Chrome) → requiere
  `.usdz` invocado con `<a rel="ar" href="...usdz">` (Bucket M).

## ¿Por qué dos formatos?

iOS Safari **no soporta WebXR** (Apple impulsa su propio stack: ARKit + AR
Quick Look + USDZ). Para no dejar a la mitad de los usuarios sin AR,
servimos el mismo objeto en ambos formatos: el navegador elige el que sabe
mostrar.

## Generación de los `.glb`

Fuente única:

```bash
cd "D:/Guardian Praeventio/repo"
node scripts/generate-ar-models.mjs
```

Genera 17 archivos en `public/models/ar/{kind}.glb` — uno por
`PlacedObjectKind`. Cada archivo es un cilindro coloreado (matchea el
`KIND_COLOR` de `PlacedObjectsLayer.tsx`). El detalle estético se mejora en
sprints futuros con `frontend-design` skill o pipeline Blender MCP →
Sketchfab.

## Conversión `.glb` → `.usdz`

iOS Quick Look acepta solo `.usdz` (USD comprimido en zip; Apple-defined
binary format). Hay 4 caminos posibles:

### 1. Apple `usdzconvert` (Reality Composer toolkit)

- **Plataforma**: solo macOS.
- **Costo**: gratis (parte de Reality Composer Pro / Xcode).
- **Calidad**: máxima — pipeline oficial de Apple.
- **Comando**: `usdzconvert input.glb output.usdz`.
- **Cuándo usarlo**: si tienes una Mac de desarrollador disponible y
  generas pocos assets manualmente.

### 2. `xcrun usdz_converter` (Xcode Command Line Tools)

- **Plataforma**: solo macOS.
- **Costo**: gratis (Xcode).
- **Calidad**: alta, pero deprecado en favor de `usdzconvert` (path 1).
- **Comando**:
  `xcrun usdz_converter input.obj output.usdz -color_map albedo.png`.
- **Cuándo usarlo**: solo si trabajas con OBJ legacy y no tienes Reality
  Composer instalado.

### 3. `gltf2usd` (Apple open-source, fork-y)

- **Plataforma**: cross-platform Python.
- **Costo**: gratis (MIT-like).
- **Calidad**: variable — el repo upstream está medio abandonado y los
  forks divergen.
- **Comando**: `python gltf2usd.py -i input.glb -o output.usdz`.
- **Cuándo usarlo**: dev en Linux/Windows sin acceso a macOS y los costos
  de path 4 son prohibitivos.

### 4. Cloud Function server-side (recomendado para producción)

- **Plataforma**: cualquier cliente (sube `.glb` y recibe `.usdz`).
- **Costo**: variable — hosting Cloud Run + storage (~USD $5/mes para volumen
  Praeventio actual).
- **Calidad**: máxima si la imagen Docker base usa `usdzconvert` real (path 1)
  bajo Rosetta o macOS runner; alta con `gltf2usd` (path 3).
- **Cuándo usarlo**: pipeline de producción con CI/CD.
- **Diseño**:
  1. Cliente sube `.glb` a Cloud Storage (signed URL).
  2. Cloud Function se dispara on-finalize → ejecuta `usdzconvert` o
     `gltf2usd` → escribe `.usdz` al mismo bucket.
  3. Cliente descarga `.usdz` por signed URL.

**Recomendación Praeventio**: usar **path 4** por defecto en producción
(no requiere Mac de developer en el laptop). Para quick iteration en dev,
quien tenga macOS puede usar path 1 y commitear el `.usdz`.

## ¿Qué pasa si el `.usdz` no existe?

El componente `ArQuickLookButton.tsx` (Bucket M.3) detecta la capability
`relList.supports('ar')`. Cuando el `.usdz` es un 404, iOS Safari abre la
URL como descarga fallida en vez de Quick Look — UX feo pero no crashea.

Para evitar 404s en dev sin generar `.usdz` reales:

- El componente ya esconde el botón si `relList.supports('ar')` falla — los
  navegadores desktop no muestran nada.
- iOS Safari **sin** `.usdz` correspondiente cae al fallback 2D (`WebXR.tsx`
  legacy) que muestra el modelo con `<model-viewer>` o screenshot estático.
- **No commiteamos `.usdz` placeholders vacíos**: causarían descargas rotas.
  Mejor 404 que un archivo de 0 bytes.

## MIME type

El servidor (`server.ts`, Bucket M.5) etiqueta los `.usdz` con
`Content-Type: model/vnd.usdz+zip` — IANA-registered MIME que iOS Safari
exige para invocar Quick Look. Sin esto, el navegador trata el archivo
como descarga genérica.

## Verificación end-to-end

```bash
# 1. Generar GLBs
node scripts/generate-ar-models.mjs

# 2. (Opcional, si hay Mac) Convertir a USDZ
for f in public/models/ar/*.glb; do
  name=$(basename "$f" .glb)
  usdzconvert "$f" "public/models/ar/${name}.usdz"
done

# 3. Servir y abrir en iPhone Safari
npm run dev
# luego: http://<lan-ip>:3000/digital-twin → seleccionar objeto → "Ver en AR"
```
