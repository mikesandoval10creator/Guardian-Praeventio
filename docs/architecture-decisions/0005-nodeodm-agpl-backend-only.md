# ADR-0005 — NodeODM (AGPL) sólo backend para fotogrametría

- Status: accepted
- Date: 2026-05-26
- Supersede: —
- Referenced by: `docs/master-plan-end-to-end.md` T-9.6

## Contexto

Praeventio Guard procesa nubes de puntos a partir de drone footage para
generar mesh GLB y materiales del Digital Twin (`src/services/photogrammetry/`,
plan T-9.x). Hace falta un pipeline de Structure-from-Motion (SfM) + Multi-View
Stereo (MVS) servidor que reciba un dataset de imágenes y emita un GLB
texturizado más metadatos de georeferencia.

Tres opciones consideradas:

| Opción | Licencia | Hosting | Costos | Calidad |
|---|---|---|---|---|
| **NodeODM (OpenDroneMap)** | AGPL-3.0 | self-host Cloud Run + GPU T4 | infra-only | aceptable; mejora con `min-num-features` alto + `mesh-octree-depth` 11 |
| Reality Capture API (Epic) | comercial, royalty/seat | servicio externo | per-scan + per-MP | excelente — referencia industrial |
| PostShot / Gaussian Splatting | comercial (postshot) o MIT (research forks) | self-host | infra + research effort | excelente para escenas; débil para topografía precisa de faena |

## Decisión

Adoptar **NodeODM en Cloud Run, exclusivamente backend**. El binario y los
modelos viven en un contenedor cerrado; el cliente Capacitor / web nunca
descarga ni invoca código AGPL. La salida (GLB + textures + metadata JSON)
viaja por GCS firmado y es totalmente no-AGPL.

Restricciones operativas:

1. **Backend-only**: el binario `NodeODM`, `ODM` y dependencias AGPL viven en
   `infrastructure/photogrammetry-cloud-run/Dockerfile`. Ningún `package.json`
   del frontend lo lista. Lint guard (`scripts/precommit-no-agpl-client.cjs`)
   verifica que ninguna ruta cliente importe módulos AGPL.
2. **Output 100% no-AGPL**: el GLB es un asset de datos, no software derivado.
   El cliente lo consume con three.js (MIT) + viewer propio.
3. **Distribución**: SaaS — Praeventio expone el pipeline como servicio
   gestionado. No se entrega el binario al cliente final, ni siquiera como
   imagen Docker. AGPL §13 "network use is distribution" se cumple
   publicando el código corresponding source vía link en el portal del
   tenant administrator (no en la PWA pública).
4. **Aislamiento**: Cloud Run job dedicado, max-instances=1 por scan
   (single-tenant per execution), GPU T4 attached, scale-to-zero por defecto.

## Consecuencias

- **Positivas:**
  - Costo per-scan = infra only; no royalties.
  - Self-hosted → soberanía de datos para tenants Latam (residencia GCP
    `southamerica-west1`).
  - Stack abierto, auditable, alineado con ADR-0012 (no diagnóstico) y la
    privacidad-by-design.
- **Negativas:**
  - Mantenimiento del fork de NodeODM + actualizaciones manuales (sin
    soporte comercial).
  - Calidad por debajo de Reality Capture en escenas complejas (mitigable
    con tuning + número alto de imágenes).
  - Cumplimiento AGPL requiere portal de source disclosure activo.
- **Mitigaciones:**
  - Pin de versión `opendronemap/nodeodm:<tag>` con rebuild controlado.
  - Lint guard pre-commit + check CI que prohíbe AGPL en client bundles.
  - Documentación en `docs/runbooks/PHOTOGRAMMETRY_RUNBOOK.md` (pendiente
    crear cuando se complete T-9.x).

## Alternativas descartadas

- **Reality Capture API**: costo per-MP elevado y datos atravesando Epic
  servers (US) — incompatible con compromisos de residencia LATAM.
- **PostShot / Gaussian Splatting research**: calidad excelente para
  visualización pero topología no-mesh dificulta downstream (medición de
  taludes, conteo de equipos, integración con BIM).

## Referencias

- OpenDroneMap NodeODM: https://github.com/OpenDroneMap/NodeODM
- AGPL-3.0 §13 (network use): https://www.gnu.org/licenses/agpl-3.0.html
- T-9.x sprint plan: `docs/master-plan-end-to-end.md` § Fase 9
- ADR-0008 (LibreDWG Cloud Function) — patrón análogo de aislamiento de
  bibliotecas con licencias estrictas.
