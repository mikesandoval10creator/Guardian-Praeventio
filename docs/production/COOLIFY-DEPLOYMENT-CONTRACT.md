# Contrato de despliegue Coolify — Guardian Praeventio

> Slice 0 del plan `PLAN-COOLIFY-HYBRID.md`.
> Este documento inventaría el estado del repositorio; no provisiona infraestructura,
> no contiene credenciales y no autoriza un despliegue.

## Vigencia y dependencia del plan — 2026-10-27

El orden canónico actualizado está en
[`PLAN-COOLIFY-HYBRID.md`](PLAN-COOLIFY-HYBRID.md): bloques A/C para base y contrato,
D para datos/auth, E para gateway/MCP y F para staging. Las referencias a Slice 0/1
de este documento pertenecen a la numeración inicial, no cambian ese orden.

Snapshot documental actual: rama `fix/recover-technical-debt-20261027`,
HEAD `5417fae4d6d61220dca75d6b3ad9d28d9f900ce3`. Antes de esta edición el checkout
de M estaba limpio; eso no resuelve los cinco conflictos del worktree de
integración ni acredita que #1874 esté integrado. Preservar el checkout de C.

El inventario siguiente conserva el resultado de la inspección inicial; sus
comandos y hallazgos requieren revalidación al implementar. Esta actualización no
construyó imágenes, probó backend/proxy, configuró DNS ni provisionó Coolify/VPS.
La evaluación aislada Rust/WASM puede adelantarse sin depender de un servicio
remoto ni obligar a desplegar Rust/Go; sus gates no sustituyen los de este contrato.

## Estado histórico verificado — base inicial `c11b4308`

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

## Decisiones cerradas — 2026-10-28 (Etapa C)

Ejecutadas sobre `main` (`eb2ff95f`) con pruebas reales; los guards ejecutables
viven en `scripts/__tests__/ops-contract.test.cjs` (7 asserts en CI) para que
una regresión documental o de clasificación rompa CI, no el despliegue.

1. **Dockerfile canónico:** `Dockerfile.api` para el servicio API + app
   (Express sirve `dist/` + `/api/*`, puerto 3000, `HEALTHCHECK /api/health`,
   config pública Firebase horneada) y `Dockerfile.frontend` para la landing
   estática (nginx, 8080, SPA fallback). El `Dockerfile` monolítico queda
   **DEPRECADO** (comentario actualizado en el propio archivo; sin borrarlo).
   `deploy.yml` sigue cableado al monolítico: rewire pendiente de autorización
   (decisión Cloud Run vs Coolify es del bloque F del plan).
2. **`firebase-applet-config.json` CLASIFICADO:** configuración PÚBLICA de
   cliente Firebase web (verificado físicamente: `projectId`, `appId`, `apiKey`,
   `authDomain`, `firestoreDatabaseId`, `storageBucket`, `messagingSenderId`,
   `measurementId` — cero campos de credencial admin; el admin real es ADC /
   Workload Identity vía `applicationDefault()`). La nota histórica H3
   («se monta como Secret Manager») era doc-drift y quedó corregida en el
   Dockerfile legado. Guard: allowlist de campos + detector de campos admin.
3. **Servicios:** landing = imagen estática; app + API = `Dockerfile.api`.
   Decisión reversible: volver a servicio único es posible (imagen monolítica
   deprecada), documentado como rollback arquitectónico.
4. **Deep links fail-closed:** probado con el generador real — sin certificado,
   `REQUIRE_ANDROID_CERT=1` aborta con exit 1 y mensaje literal, sin escribir
   archivos (2026-10-28). Builds de prueba usan cert sintético etiquetado
   (formato real validado: 32 pares hex colon-separated; placeholders siempre
   abortan).

## Deuda descubierta por las corridas reales de build — 2026-10-28

Ninguna imagen del repositorio podía construirse; dos defectos transversales,
ambos corregidos con guard de regresión en el contrato ejecutable:

- **`vendor/` ausente antes de `npm ci`** (todas las imágenes, 5 stages):
  `xlsx` es dependencia `file:vendor/xlsx-0.20.3.tgz` y `npm ci` muere con
  ENOENT si el stage no copia `vendor/` primero.
- **Scripts de `postinstall` ausentes** (mismos stages): el hook raíz ejecuta
  `scripts/patch-artillery.mjs` + `scripts/patch-stryker-vitest5.cjs` (ambos
  no-opan sanamente si las herramientas dev no están) y el install muere con
  `Cannot find module '/app/scripts/…'` si no se copian.
- `--ignore-scripts` NO es la salida: rompe módulos nativos que necesitan sus
  install scripts (mejor práctica confirmada).

## Bloqueos antes de Slice 1 — estado

| Bloqueo | Estado 2026-10-28 |
|---|---|
| Separar y auditar los cambios no comprometidos del worktree | RESUELTO en Etapa A (trabajo local recuperado/público; main reconciliado) |
| Resolver cuál Dockerfile es la fuente de verdad | RESUELTO (decisión 1 + guard) |
| Resolver la contradicción sobre `firebase-applet-config.json` | RESUELTO (decisión 2 + guard) |
| Definir servicios separados landing/app/API | RESUELTO (decisión 3, reversible) |
| Probar build de imagen y arranque del API | RESUELTO con evidencia en CI: workflow `ops-contract` (build real de `Dockerfile.api` + probes de runtime en cada PR que toca el contrato). Ver «Evidencia de contenedores» |
| Probar frontend nginx, `/api/*` y deep links | RESUELTO con evidencia en CI: workflow `ops-contract` (build real de `Dockerfile.frontend` + probes SPA/headers/deep links). Ver «Evidencia de contenedores» |
| Definir headers, CORS, TLS, health checks, logs, rollback, aislamiento | PARCIAL: headers/CSP y CORS definidos en middleware y verificados por probe; TLS/DNS/aislamiento staging requieren infra (bloque F) |
| Confirmar el VPS separado | PENDIENTE EXTERNO (no provisionar sin autorización; bloque F) |

## Evidencia de contenedores — 2026-10-28

Hogar de la evidencia: **CI, no el Docker Desktop local** (3 muertes del daemon
en builds pesados, 2026-10-28/29 — regla del «Marco de flujo y colocación de
cómputo» del plan). El workflow `.github/workflows/ops-contract.yml` ejecuta en
cada PR que toca el contrato:

1. `contract-asserts`: guards ejecables (`scripts/__tests__/ops-contract.test.cjs`
   + `download-mediapipe-guard.test.mjs`) y fail-closed del generador de deep
   links (sin cert → exit ≠ 0, sin escrituras).
2. `image-probes`: builds REALES de `Dockerfile.api` y `Dockerfile.frontend`
   con fingerprint Android **sintético** etiquetado, más probes de runtime
   (`scripts/ops-contract-probe.sh`): `/api/health` con coherencia estricta
   status↔checks↔HTTP, CSP (`frame-ancestors 'none'` + `wasm-unsafe-eval`),
   CORS positivo y negativo (fail-closed), deep link SPA, `assetlinks.json`
   (nunca vacío) y AASA. La evidencia literal (logs + JSON) se publica como
   artifact del run.

### Semántica observada de los probes (verificada 2026-10-29, server real vía tsx)

| Probe | Comportamiento observado |
|---|---|
| `GET /api/health` sin credenciales GCP | **503** `{"status":"degraded","checks":{"firestore":"fail"}}` — fail-closed honesto (la dependencia real manda; un 200 sin Firestore sería mentira) |
| CSP | header completo con `frame-ancestors 'none'` y `wasm-unsafe-eval` |
| CORS preflight `Origin: https://app.praeventio.net` | 204 + `Access-Control-Allow-Origin` + `Allow-Credentials: true` |
| CORS negativo `Origin: https://evil.example.com` | 204 SIN `Access-Control-Allow-Origin` (fail-closed) |
| Deep link `/panel/incidentes/abc-123` | 200 `text/html` (SPA fallback) |
| `/.well-known/assetlinks.json` | 200, 340 bytes, `com.praeventio.guard` + fingerprint |
| `/.well-known/apple-app-site-association` | 200 con bloque `applinks` (placeholder honesto `TEAMID`) |

### Contrato de arranque en producción (fail-closed verificado 2026-10-29)

El server **no arranca** en `NODE_ENV=production` sin estas variables; cada
gate aborta con exit ≠ 0 y mensaje literal (probado secuencialmente contra el
server real). Es la lista que el despliegue (bloque F) DEBE satisfacer:

| Variable | Exigencia observada |
|---|---|
| `SESSION_SECRET` | requerida en producción (sin ella: `FATAL ERROR: SESSION_SECRET is not defined`) |
| `APP_BASE_URL` (o `APP_URL`) | requerida: WebAuthn no puede derivar `expectedOrigin` (`Refusing to load`) |
| `WEBAUTHN_RP_ID` | requerida (ej. `app.praeventio.net`) para verificar passkeys contra el RP real |
| `KMS_ADAPTER=cloud-kms` + `KMS_KEY_RESOURCE_NAME` | requeridos en producción (`in-memory-dev` prohibido) |
| `COMPLIANCE_EVIDENCE_ATTESTATION_CURRENT_KEY_ID` + `COMPLIANCE_EVIDENCE_ATTESTATION_KEYS` | keyring JSON requerido (keyId `[A-Za-z0-9._-]{1,64}`, secreto ≥ 32 bytes) |
| `WEBPAY_COMMERCE_CODE` + `WEBPAY_API_KEY` | requeridos en producción (sin ellos se caería silenciosamente a sandbox de Transbank) |
| `E2E_MODE=1` | **PROHIBIDO** en producción (`must NEVER be enabled in production`, exit 1) |
| ADC (`GOOGLE_APPLICATION_CREDENTIALS` / Workload Identity) | **REQUERIDO en runtime.** Sin ADC el server ARRANCA y luego muere con un `unhandled rejection` (`NO_ADC_FOUND` de google-auth vía las suscripciones de fondo — hallazgo de la primera corrida de CI, 2026-10-29). Con ADC presente (aunque sin autorización real) el proceso sobrevive y sirve el contrato completo. Pendiente de producto: fail-fast de ADC en el boot, mismo patrón que `kmsPreflight`/`webpayPreflight` |

Env de prueba 100% sintético (sin secretos reales) documentado en el workflow
`ops-contract.yml`. Las credenciales reales viven en Coolify/GCP, jamás en el
repositorio.

### Registro de la primera corrida de CI (2026-10-29, PR #1883)

- `Dockerfile.api` construye en CI real (`EXIT=0`) — primera imagen del repo
  construida con éxito, tras el fix de `vendor/` + scripts de postinstall.
- Fail-closed de arranque #1 (sin `APP_BASE_URL`) y #2 (`E2E_MODE=1` en
  producción): `exit 1` con mensaje literal, verificados dentro del contenedor.
- Los probes de runtime descubrieron el crash sin ADC documentado arriba. La
  corrección del probe (ADC sintético montado en el contenedor) fue verificada
  contra el server real localmente: 8/8 PASS y proceso vivo tras los errores de
  credenciales. Los probes CI usan esa misma postura.

## Nota VPS/contenedores en la nube (investigación FAZT/FAZTCode, 2026-10-29)

Autorizada por Daniel para integrar al flujo. Fuentes: canal FaztCode
(`GczDJqKI58M` «VPS + AI to Deploy Projects Automatically» — transcripción
completa analizada) y FaztTech (`v8lpw8zrD_0` contenedores vs VMs). Lo que
se integra y lo que no:

1. **Checklist de endurecimiento del VPS** (a incorporar en el bloque F del
   plan al provisionar): usuario no-root + llaves SSH (desactivar login
   root y password), firewall UFW, TLS con Certbot, Docker + Docker Compose,
   puertos explícitos por servicio. Coincide con los gates de seguridad del
   plan; se usa como checklist operativa, no como fuente nueva de verdad.
2. **Política de datos confirma el plan**: el propio FAZT recomienda
   «desplegar las bases de datos por aparte, en un servicio confiable con
   backups» — Guardian ya lo hace: **Firestore/GCP sigue siendo la autoridad
   de datos y auth** (restricción crítica del plan, «no borrar Firestore ni
   sus adapters»); en el VPS solo van contenedores stateless (landing, app,
   API, workers Go/Rust según gates).
3. **Docker Compose como runtime de contenedores en el VPS** (Coolify orquesta
   sobre compose): consistente con `Dockerfile.api` / `Dockerfile.frontend`.
4. **NO se integra**: el patrón de agente-IA-deployando-en-VPS del video (el
   CI/CD de Guardian ya es GitHub Actions → imágenes → despliegue), ni
   PM2 (redundante con contenedores), ni ningún proveedor nuevo sin
   comparación (el VPS y Coolify siguen sujetos al bloque F: confirmar VPS
   separado y alcance autorizado antes de provisionar).

## Nota dev-workflow: Context7 + Upstash Box (FaztTech `QJUbGV3oMQw`, 2026-10-29)

Transcripción completa analizada («3 agents in parallel… without consuming
your machine»). Dos herramientas para el flujo de DESARROLLO (distinto del
VPS de staging del bloque F):

1. **Context7** (context7.com): CLI/MCP que da al agente documentación y
   **versiones al día** de cualquier biblioteca del proyecto — el código
   generado usa APIs actuales (caso del video: consultar novedades de Zod;
   el agente puede detectar releases nuevas en GitHub y actualizar). Se
   integra como MCP en Hermes (coincide con el bloque E del plan, MCP como
   herramienta — no con el gateway LLM). Valor directo para Guardian:
   previene drift de dependencias (p. ej. el ticket «firebase-admin 14.3.0
   rompe typecheck» es la clase de daño que evita).
2. **Upstash Box** (upstash.com/docs/box): **un contenedor/sandbox Linux en
   la nube por agente** — CLI `upstash box` + variable de entorno con token;
   instala CLIs de agentes dentro, ejecuta código/comandos en entorno
   aislado y controlado **sin consumir la máquina local** (dashboard por box:
   CPU, tiempo, tokens, costo). El demo = 3 agentes en paralelo (seguridad,
   tests, docs) cada uno en su box.
   Valor directo para Guardian: los bucles multi-PR, builds y benchmarks
   pueden correr en boxes en vez de la máquina local de 15 GB (la que se
   congeló el 2026-10-28 bajo carga sostenida). Pendiente: cuenta/token
   Upstash y revisión de precios antes de provisionar.
3. **No confundir con el bloque F**: Upstash Box es cómputo de desarrollo
   (agentes), no el hosting del producto; el staging del producto sigue
   siendo VPS + Coolify con las decisiones de arriba.

## Criterio de salida de Slice 0

Slice 0 no se considera cerrado hasta que exista una decisión revisada y verificable
sobre los puntos anteriores. En particular, `npm run build` exitoso por sí solo no
prueba que el backend, el proxy o Coolify estén operativos.
