# Contrato de despliegue Coolify — Guardian Praeventio

> Slice 0 del plan `PLAN-COOLIFY-HYBRID.md`.
> Este documento inventaría el estado del repositorio; no provisiona infraestructura,
> no contiene credenciales y no autoriza un despliegue.

## Estado verificado

- Workspace: `M:/Guardian Praeventio/repo-live`.
- Rama: `main`.
- `HEAD`: `c11b430889a3dc103a96b4c6ef4a846c1d753b5f`.
- Relación local observada: `main...origin/main` sin divergencia indicada por Git.
- El worktree contiene cambios no comprometidos; no se debe construir un release
  desde todo el worktree sin separar y auditar esos cambios.
- No se han configurado aquí credenciales de Coolify, VPS, Firebase, Google Cloud,
  Analytics ni dominios.

## Inventario de imágenes y comandos

| Artefacto | Build | Runtime / start | Puerto | Health check |
|---|---|---|---:|---|
| `Dockerfile.api` | `npm run build` | `./node_modules/.bin/tsx server.ts` | 3000 | `GET /api/health` dentro del contenedor |
| `Dockerfile.frontend` | `npm run build` | `nginx:alpine` | 8080 | Probe HTTP externo; no agrega `HEALTHCHECK` |
| `Dockerfile` | `npm run build` | `npx tsx server.ts` | 3000 | `GET /api/health` dentro del contenedor |

### Recomendación para el primer despliegue

- No usar todavía el `Dockerfile` monolítico como contrato nuevo: está marcado como
  legado y mezcla frontend/API.
- Mantener `Dockerfile.api` como candidato para el servicio API, sujeto a una
  construcción y smoke test reales.
- Mantener `Dockerfile.frontend` como candidato para una aplicación estática
  separada, sujeto a validar el fallback SPA, headers y deep links.
- No desplegar ambas imágenes hasta decidir si el frontend público y la aplicación
  autenticada comparten imagen, host o servicio. El plan aprobado reserva
  `praeventio.net` para landing y `app.praeventio.net` para la aplicación.

## Pipeline existente

- `.github/workflows/deploy.yml` sigue cableado al Dockerfile monolítico y no debe
  considerarse equivalente al contrato Coolify sin una auditoría del workflow.
- `cloudbuild.yaml` construye y publica imágenes API/frontend en Artifact Registry,
  pero declara explícitamente que no despliega a Cloud Run.
- El pipeline de Cloud Build requiere `ANDROID_CERT_SHA256` para generar App Links
  de forma fail-closed.
- El pipeline ejecuta instalación, typecheck, tests, build y construcción de ambas
  imágenes. La publicación de imágenes no equivale a un despliegue validado.

## Variables y secretos

`.env.example` contiene variables públicas, operacionales y secretos mezclados en
una plantilla. Para Coolify se deben clasificar antes de crear recursos:

- **Build/frontend:** variables `VITE_*`; verificar cuáles terminan realmente en el
  bundle y no poner secretos bajo el prefijo `VITE_`.
- **Runtime API:** `SESSION_SECRET`, secretos HMAC, billing, proveedores externos,
  Sentry backend y adaptadores de infraestructura.
- **Configuración pública:** `APP_URL`, `APP_BASE_URL`, nombre de proyecto y
  configuración Firebase pública, distinguiéndola de credenciales administrativas.
- **Opcionales:** photogrammetry, DWG, USDZ, SII, Pinecone y otros adapters; no deben
  bloquear el servicio base si están explícitamente desactivados.

Reglas del contrato:

1. Ningún valor real se copia a este documento, al repositorio ni a una imagen.
2. Staging y producción usan secretos y proyectos separados.
3. `validate:env` debe ejecutarse en el entorno objetivo antes del arranque de
   producción.
4. Las variables del backend no se exponen al navegador.
5. El origen de `firebase-applet-config.json` debe quedar documentado: el
   `Dockerfile.api` actual lo copia a la imagen porque es configuración pública,
   mientras el `Dockerfile` legado contiene una instrucción histórica que afirma
   montarlo como secreto. Esta contradicción debe resolverse antes del despliegue.

## Bloqueos antes de Slice 1

- Separar y auditar los cambios no comprometidos del worktree.
- Resolver cuál Dockerfile es la fuente de verdad para Coolify.
- Resolver la contradicción sobre `firebase-applet-config.json`.
- Definir servicios separados para landing, aplicación y API, o documentar una
  decisión explícita de servicio único reversible.
- Probar build de imagen y arranque del API en un entorno local representativo.
- Probar frontend servido por nginx, `/api/*` mediante proxy elegido y deep links.
- Definir headers, CORS, TLS, health checks, logs, rollback y aislamiento staging /
  producción.
- Confirmar el VPS separado; este documento no autoriza crear ni modificar uno.

## Criterio de salida de Slice 0

Slice 0 no se considera cerrado hasta que exista una decisión revisada y verificable
sobre los puntos anteriores. En particular, `npm run build` exitoso por sí solo no
prueba que el backend, el proxy o Coolify estén operativos.
