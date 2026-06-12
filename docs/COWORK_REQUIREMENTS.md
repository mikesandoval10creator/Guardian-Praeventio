# Cowork — qué necesito de ti (Daho) para destrabar el ~15% final

> **Propósito.** Casi todo el roadmap se puede avanzar sin ti (cobertura,
> deuda técnica, wire de features). Pero **~23 ítems están bloqueados por
> secrets/cuentas que solo tú puedes proveer**. Sin ellos, el techo real de la
> plataforma es **~85% E2E** (lo dice `TODO.md §12.5`). Este documento es la
> lista clara y priorizada de lo que necesito en una sesión de **cowork**:
> qué es cada cosa, **cómo obtenerla**, dónde se configura, y qué desbloquea.
>
> Marca con ✅ lo que ya tengas listo. Lo demás lo provisionamos juntos cuando
> me des acceso al cowork.

## Orden de trabajo acordado (2026-05-29)

1. **Ahora (yo, sin ti):** verificar que TODO el código existente funcione —
   cobertura/calidad, cazando bugs (van ~46% líneas, subiendo; 1 bug real ya
   arreglado: Man Down).
2. **Luego (yo, sin ti):** deuda técnica (con la red de tests puesta, reparar
   es seguro).
3. **Luego (yo, sin ti):** features que NO necesitan secrets (wire de
   CalculatorHub UI, mesh consumer, jurisdicciones UI, RAG vectorial…).
4. **Cowork (tú + yo):** los ítems de abajo. Te aviso cuando llegue a esta
   fase; idealmente ya tendrás algunos listos.

---

## 🔴 P0 — Bloquean producción o el lanzamiento en tiendas

| # | Qué necesito | Cómo obtenerlo | Dónde va | Desbloquea |
|---|---|---|---|---|
| **C1** | **KMS key (Cloud KMS)** | GCP Console → Security → Key Management → crear keyring + key. Copia el resource name `projects/.../cryptoKeys/...` | `KMS_KEY_RESOURCE_NAME` + `KMS_ADAPTER=cloud-kms` | **Prod NO bootea sin esto** (fail-fast). Cifrado de PII/médico/tokens. |
| **C2** | **Google Maps API key** | GCP Console → APIs → habilitar Maps JavaScript + restringir por dominio | `VITE_GOOGLE_MAPS_API_KEY` | 4 mapas + Site25D + mapas de evacuación/costero/volcánico (hoy placeholder) |
| **C3** | **Keystore Android (`.jks`)** + SHA-256 | Android Studio → Generate Signed Bundle → crea/expone keystore; o `keytool -genkey`. Dame el SHA-256 | `assetlinks.json` + `signingConfigs` | Firma Android + deep-links + billing RTDN + HealthConnect |
| **C4** | **Apple Developer Program ($99/año)** | developer.apple.com → enrolar; luego provisioning profile + APNS `.p8` | iOS provisioning + `apple-app-site-association` TEAMID | Build iOS + push (APNS) + HealthKit |

> C1 es el más urgente para cualquier deploy productivo. C2 desbloquea la mayor
> cantidad de features visibles. C3/C4 son para el lanzamiento en Play Store / App Store.

## 🟡 P1 — Desbloquean funcionalidad ya programada

| # | Qué necesito | Cómo obtenerlo | Variable | Desbloquea |
|---|---|---|---|---|
| **F1** | Firebase VAPID key | Firebase Console → Cloud Messaging → Web Push certificates | `VITE_FIREBASE_VAPID_KEY` | Push web real (hoy cae a polling) |
| **F2** | Google OAuth client | GCP → Credentials → OAuth client ID (web) | `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | Google Calendar + Fit + object-lifecycle calendar wire |
| **F3** | MercadoPago prod token | mercadopago.cl → Tus integraciones → credenciales de producción | `MP_ACCESS_TOKEN` + `MP_ENV=production` | Checkout MercadoPago productivo (LATAM) |
| **F4** | Google Play billing keys | Play Console → Monetization setup → RTDN + service account | `GOOGLE_PLAY_*` (3) | Verificación de compras Android + RTDN |
| **F5** | Sentry DSN prod | sentry.io → proyecto praeventio → Settings → Client Keys; **rotar el leak previo** | `SENTRY_DSN` | Error-tracking real en prod |
| **F6** | Scheduler shared secret | Generar `openssl rand -hex 32` y registrarlo en Cloud Scheduler | `SCHEDULER_SHARED_SECRET` | Gate del reaper de mantenimiento + crons admin |
| **F7** | IoT webhook secret | Generar `openssl rand -hex 32` | `IOT_WEBHOOK_SECRET` | Verificación HMAC de telemetría IoT |
| **F8** | Vertex AI project + región | GCP → habilitar Vertex AI; proyecto + `southamerica-west1` | `VERTEX_PROJECT_ID` + `VERTEX_LOCATION` | Residencia de datos IA en Latam |

## 🟢 P2 — Deep-tech / ops (decides cuándo activar)

| # | Qué necesito | Notas | Desbloquea |
|---|---|---|---|
| **D1** | Deploy COLMAP worker (Cloud Run) + `PHOTOGRAMMETRY_WORKER_TOKEN` | El worker ya existe en `cloud-run/photogrammetry-worker/` (325 LOC reales); falta deployarlo | Fotogrametría → Digital Twin de faena |
| **D2** | LibreDWG converter (Cloud Run) | `DWG_CONVERTER_URL` + `_TOKEN` + `CAD_OUTPUT_BUCKET` | Importar planos DWG/CAD |
| **D3** | MQTT broker prod (emqx/cloud-iot) | Decides el adapter; `IOT_BROKER_ADAPTER=cloud\|emqx` | Telemetría IoT en tiempo real (hoy InMemory) |
| **D4** | SHA-256 del modelo Gemma 2 2B | DevOps computa el hash del modelo descargado | Completa el SLM offline (Phi-3 + Qwen ya tienen SHA reales) |

## ⚪ P3 — Externos / proceso comercial (no técnicos)

| # | Qué necesito | Notas |
|---|---|---|
| **E1** | Apple Root CA G3 PEM (full-chain) | Descarga oficial de Apple — para verificar Apple SSN |
| **E2** | Traducciones humanas profesionales | fr/de/it/ja/zh-CN/ar/ko/hi/ru (hoy shells ~1-2%). es-CL/en/pt-BR ya están |
| **E3** | Acuerdos con mutualidades (ACHS/IST/Mutual) | Proceso comercial — opcional para Day-1 |

---

## Cómo trabajaremos el cowork
Cuando llegue a la Fase 4 (o cuando tengas los P0 listos), avísame. Idealmente:
1. Provisionas **C1 (KMS)** y **C2 (Maps)** primero — máximo impacto.
2. En cowork, me das acceso/valores y yo: configuro los `.env`, valido con
   `npm run validate:env`, activo los wire que dependían de cada secret, y
   corro la verificación E2E de cada feature desbloqueada.
3. Cada secret provisto sube el % E2E real y lo dejamos comprobado con tests.

**Importante:** nunca commiteo secrets reales — van solo a Secret Manager /
`.env.local` (gitignored). Este doc solo lista *qué* se necesita, nunca el valor.

---

## 📍 Sesión cowork local 2026-06-11 — bitácora y directivas nuevas del fundador

> Primera sesión cowork real (Claude en el PC de Daho, con skills + Chrome +
> computer-use). Repo local `D:\Guardian Praeventio\repo` sincronizado
> `726f9942 → d7d70cbf` (44 commits). Esta sección registra lo hecho y las
> directivas que las sesiones cloud deben incorporar a TODO.md.

### Directivas nuevas del fundador (2026-06-11, verbatim resumido)

0. **"Español puro en el frontend por defecto, con posibilidad de cambiar
   idioma."** (post-primera-vista de la app local) → El idioma activo YA es
   español; lo que se ve en inglés son los ~2.222 strings hardcodeados del
   ratchet i18n (`docs/i18n-coverage.md`, ola 3 migró 477). SUBIR PRIORIDAD de
   la migración y empezar por lo MÁS VISIBLE: shell/sidebar del Command
   Center ("Home", "Inbox", "Work Crews", "Safety Feed", "SURVIVAL MODE",
   botones "FAST CHECK/PLANNER/EMERGENCY/LIVE MAP", "WEATHER BULLETIN",
   "COMPLIANCE", "PPE REQUIRED", "ACTIVE PROJECT"…), que hoy mezclan EN en la
   primera pantalla. El selector de idioma existe (LocalePicker) — verificar
   que esté accesible en el header para usuarios finales.

1. **"Todo lo que esté sin UI debe ser conectado; todo lo que se pueda hacer
   wire, se hace."** → Ratifica y acelera la Ola 4 (108 hooks + 146 componentes
   huérfanos, `docs/audits/file-ledger/audit-2026-06/orphan-hooks-components.txt`).
   Vida/cumplimiento primero.
2. **Deduplicación inteligente repo-wide:** ante familias de módulos repetidos
   (caso driving ×4), NO asumir duplicado: clasificar en (a) duplicado real →
   fusionar, (b) soluciones distintas al mismo problema → elegir/fusionar la
   mejor, (c) problemas distintos → mantener y *relacionar* ("el sistema
   evoluciona de los módulos interconectados"). Borrar solo con aprobación.
3. **Independencia de cuotas Gemini:** propuesta MiMo formalizada en
   **ADR 0023** (`docs/architecture-decisions/0023-mimo-segundo-cerebro-cloud.md`)
   — segundo cerebro cloud vía la capa `AI_SELFHOSTED_*` (#857), 3 fases,
   canary `getSafetyAdvice`. Pendiente decisión del fundador para Accepted +
   ítem cowork nuevo **F9** (abajo).
4. **Skills en el PC:** instaladas para sesiones locales: `find-skills`,
   `agent-browser`, `web-design-guidelines` (Vercel), `frontend-design`
   (Anthropic); ya existían docx/xlsx/pptx/pdf/mcp-builder/canvas-design entre
   otras. Uso previsto: frontend-design + web-design-guidelines al cablear
   huérfanos de UI; agent-browser para verificación visual E2E local; xlsx/docx
   para reportes de auditoría al fundador; mcp-builder si materializamos los
   MCP internos `gp-*` (§16.1.5).

### Veredicto análisis driving ×4 (hecho en esta sesión, evidencia en transcript)

| Módulo | Veredicto | Razón |
|---|---|---|
| `src/pages/Driving.tsx` (+`useDriving`, telemetría GPS/velocímetro/SOS) | **MANTENER** — canónico telemetría en ruta | Problema: conducción en tiempo real |
| `src/pages/DrivingSafety.tsx` (+`drivingSafetyService`, rutas críticas/scoring/flota) | **MANTENER + EXPANDIR** — canónico logística | Problema distinto: gestión de flota; recibió el endpoint auditado D2 slice 2 (#852, `drivingSafety.ts:647-771`) |
| `src/pages/SafeDriving.tsx` | **DEPRECAR** — ✅ **APROBADO por el fundador 2026-06-11 en esta sesión** | Duplica logística de DrivingSafety con endpoint legacy sin audit |
| `src/pages/SafeDrivingMode.tsx` | **REUBICAR como componente** | No es página: es modo manos-libres/fallback de emergencia |

Son **2 problemas distintos** (telemetría vs logística) + 1 duplicado real + 1
mal ubicado. Plan de fusión en 3 pasos en el transcript de la sesión; pendiente
PR de las sesiones cloud o de la próxima sesión local.

### Trabajo de código hecho EN LOCAL (2026-06-11/12) — pendiente commit+PR

| Cambio | Archivos | Estado |
|---|---|---|
| **P0 informe #2 — catches silenciados en billing** | 9 call-sites en `src/server/routes/billing/{webpay,mercadopago,khipu,googleplay,appstore}.ts` → patrón dte.ts (`.then(ok => !ok && logger.error('billing_audit_write_failed',…))`) | ✅ hecho, typecheck local en curso |
| **Hotfix CSP dev** (bug 🔴 hallazgo 5) | `src/server/middleware/securityHeaders.ts` — override dev-only de `script-src-elem` | ✅ hecho y verificado (la app monta) |
| **Paridad i18n es 100%** | `src/i18n/locales/es/common.json` + `evacuation.aria.{active,idle}` (3.415/3.415) | ✅ hecho |
| **Spec tier-gating server-side** (P0 informe #1) | `docs/security/TIER-GATING-SERVER-SIDE-SPEC.md` — diseño completo para ~0.5 sprint cloud | ✅ spec lista |
| Tooling dev Windows | `reiniciar-servidor.bat`, `verificar.bat` (typecheck+lint con logs) | ✅ operativos |

> ⚠️ El idioma mixto que vio el fundador NO era falta de traducciones (es tenía
> 3.413/3.415 claves): era `praeventio_locale=en` persistido en SU navegador.
> Los defaults del código ya son correctos (es). Falsa alarma — pero dejó la
> paridad al 100% y la directiva #0 de arriba sigue válida para los ~2.222
> hardcodes del ratchet en páginas no-shell.

### Ítem cowork nuevo

| # | Qué necesito | Cómo obtenerlo | Variable | Desbloquea |
|---|---|---|---|---|
| **F9** | **Cuenta + Token Plan API Xiaomi MiMo** | platform.xiaomimimo.com → registro → Token Plan (compra única, oferta lanzamiento) → API key | `AI_SELFHOSTED_BASE_URL` + `AI_SELFHOSTED_MODEL` + `AI_SELFHOSTED_API_KEY` | ADR 0023 Fase 1: respaldo cloud barato ante cuotas Gemini (capa #857 ya construida — es solo config) |

### Estado de verificación local (esta sesión)

- ✅ Pull 44 commits + working tree limpio (`git status` porcelain vacío post-reset a origin/main).
- ⏳ `npm install` + typecheck: **debe correrse en PowerShell nativo** (el
  filesystem montado del sandbox es demasiado lento para node_modules).
  Comandos: `cd "D:\Guardian Praeventio\repo" && npm install && npm run typecheck`.
- ℹ️ `package.json`/`package-lock.json` cambiaron en el pull (deps bumpeadas) —
  install obligatorio antes de `npm run dev`.

### ✅ RESUELTO 2026-06-11 23:5x — la app CORRE en local

Tras el hotfix CSP (hallazgo 5 abajo) + exclusión Defender + `.env` correcto, la
landing renderiza en el navegador del fundador (`#root` montado, título e
i18n vivos). El flujo dev-local Windows queda operativo con
`reiniciar-servidor.bat` (doble clic). Pendientes de seguimiento:
- El hero de la landing dice "COMPLIANT WITH **DS 54** . DS 44/2024 . LAW
  16.744" — mismo drift que el informe externo marcó en el README: DS 54 está
  DEROGADO por DS 44/2024 desde 2025-02-01. Para un producto de compliance es
  un error visible en el primer pantallazo. Corregir copy + i18n keys.
- Nuevo informe externo del fundador archivado en
  `docs/audits/INFORME-EXTERNO-2026-06-12.md` (auditoría estática integral).
  Críticos que eleva y NO estaban priorizados así: (1) **tier-gating solo
  client-side** — paywall bypasseable por curl directo (riesgo de ingresos);
  (2) **`.catch(() => {})` en billing** (~15) — pagos sin traza si falla el
  audit; (3) mesh packets sin firma (ya trackeado B-mesh); (4) Gemma SHA null
  (ya trackeado). Recomendación local: tratar (1) y (2) como P0 de la próxima
  ola cloud.

### 🐛 Hallazgos dev-local para las sesiones cloud (primera corrida real en Windows, 2026-06-11)

1. **Drift doc/código `.env.local`:** `server.ts:455` usa `dotenv.config()` (solo
   lee `.env`), pero `docs/runbooks/SELFHOSTED_AI.md` y `.env.example` instruyen
   poner secrets de server en `.env.local` (convención Vite, solo client-side).
   Resultado: el server arrancó con `injecting env (0)`. FIX sugerido:
   `dotenv.config({ path: ['.env.local', '.env'] })` (dotenv ≥16.3 acepta array)
   o documentar `.env` para server. Workaround local aplicado: copia a `.env`.
2. **Vite watcher recarga por `coverage/`:** correr la app con un reporte de
   cobertura presente (147 MB de HTML) dispara tormenta de `page reload
   coverage/...` que rompe el primer load. FIX sugerido: `server.watch.ignored:
   ['**/coverage/**']` en `vite.config.ts`. Workaround local: `rm -rf coverage`.
3. **`POST /api/csp-report` → 500 "stream is not readable":** el body llega ya
   consumido al `body-parser` (probable doble-parse con el limiter delante, o
   `report-to` con content-type `application/csp-report` no manejado). Genera
   ruido de `express_unhandled_error` en cada load del frontend.
4. **ADC de gcloud expirado en la máquina del fundador** (`invalid_rapt`):
   Firestore Admin server-side degradado hasta `gcloud auth application-default
   login`. No es bug del repo; anotado como paso de setup Windows.
5. **🔴 BUG REAL — CSP `script-src-elem` bloquea el preámbulo de React en dev**
   (`src/server/middleware/securityHeaders.ts:156`): el mapa estático define
   `script-src-elem` SIN `'unsafe-inline'` (dev) y SIN nonce (prod). Per spec,
   `script-src-elem` override-a a `script-src` para `<script>`, así que el
   preámbulo inline de `@vitejs/plugin-react` queda bloqueado → **React nunca
   monta en `npm run dev`** (#root vacío, sin error de consola, violaciones a
   `/api/csp-report`). Nadie lo vio porque las sesiones cloud no abren dev en
   navegador. HOTFIX local aplicado (override dev-only en `buildCspString`,
   marcado con comentario). FIX raíz sugerido: eliminar `script-src-elem` del
   mapa estático (al no existir, `script-src` — que SÍ tiene los branches
   dev/nonce correctos — gobierna los elementos) o espejarle las directivas
   dinámicas. Verificar también el caso prod si el index.html buildeado lleva
   `<script>` inline con nonce. Evidencia del diagnóstico: preámbulo
   `window.__vite_plugin_react_preamble_installed__` ausente con módulos 100%
   cargados (1.071 warm, 0 errores, readyState complete, root vacío).
6. **Transform de Vite a 15,8 s/módulo en Windows** (medido: `fetch('/src/main.tsx')`
   → 200 OK en 15.777 ms, 22,8 KB). Con el grafo de entrada completo, el primer
   paint tarda decenas de minutos. Causa principal: Windows Defender escaneando
   cada lectura/escritura de Vite+esbuild (mitigación usuario: exclusión de la
   carpeta). FIX repo sugerido: (a) `server.warmup.clientFiles:
   ['./src/main.tsx']` en `vite.config.ts` para pre-transformar el grafo al
   arrancar; (b) revisar imports EAGER en main.tsx/App.tsx — con 224 páginas,
   todo lo que no sea ruta inicial debería ser `React.lazy` (verificar cuántas
   páginas entran al grafo inicial); (c) documentar la exclusión de Defender en
   `CHECKLIST_CONFIGURACION_WINDOWS.md`.
