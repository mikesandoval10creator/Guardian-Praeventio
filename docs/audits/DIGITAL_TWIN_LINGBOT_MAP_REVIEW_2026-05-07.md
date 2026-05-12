# Digital Twin / LingBot Map review - 2026-05-07

## Veredicto

No hay asimilacion real de LingBot-Map en el codigo actual. La unica referencia directa vive en `src/services/zettelkasten/bernoulli/slamPhotogrammetryNode.ts` y esta marcada como placeholder. Por tanto, el producto no debe prometer "LingBot-Map integrado" ni "SLAM real LingBot" hasta incorporar el motor, su licencia, su pipeline y pruebas de reconstruccion.

## Lo que si quedo real en esta tanda

- La UI de Digital Twin ya no llama endpoints inexistentes `/api/digitalTwin/...`.
- `src/pages/DigitalTwinFaena.tsx` crea jobs contra `/api/photogrammetry/jobs`.
- `src/server/routes/photogrammetry.ts` acepta `videoUrl` ademas de `imageUrls`.
- `cloud-run/photogrammetry-worker/src/index.ts` acepta `videoUrl`, descarga el video `gs://...` y extrae frames con `ffmpeg` antes de correr COLMAP.
- Se agrego `GET /api/photogrammetry/jobs?projectId=...` para que la UI liste jobs reales.
- El modo GPU/Modal en la UI queda marcado como pendiente; no se ofrece como camino operativo.

## Lo que sigue pendiente

- Deploy real del worker Cloud Run con `PHOTOGRAMMETRY_WORKER_URL`, `PHOTOGRAMMETRY_WORKER_TOKEN` y bucket de salida.
- Smoke test con video real: upload a Storage, job queued, worker running, mesh `.ply` subido y UI listando `completed`.
- Conversion o viewer real de `.ply`/`.glb`; hoy la pagina mantiene visualizacion fallback por nube de puntos.
- Definir si se integrara LingBot-Map o si COLMAP sera el motor oficial. Si se integra LingBot-Map, documentar licencia, version, formato de salida, parametros, costos y pruebas.
- El nodo Zettelkasten `slam-mesh` debe seguir con `metadata.placeholder=true` hasta que el mesh real sea consumido por el grafo.

## Lenguaje honesto para ventas/demo

Permitido: "Digital Twin en vista previa con pipeline COLMAP preparado para Cloud Run y job orchestration autenticado".

No permitido todavia: "Digital Twin SLAM LingBot-Map integrado", "GPU operativo", "reconstruccion 3D productiva garantizada" o "mesh real listo sin deploy".
