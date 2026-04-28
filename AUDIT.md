# Auditoría — Praeventio Guard

**Fecha:** 2026-04-27
**Branch base:** `claude/setup-github-access-9rYY6` (incluye trabajo móvil pre-existente)
**Alcance:** Revisión exhaustiva del repo + saneamiento aditivo (sin pisar el trabajo móvil que ya estaba en esta rama).

---

## Contexto

Esta auditoría se reconcilió con 10+ commits previos hechos desde Claude Code móvil que aún no estaban mergeados a `main`. Esos commits ya resolvieron varios hallazgos que se identificarían en una auditoría desde `main`:

- ✅ Migración del SDK `@google/genai` (`5941b59`).
- ✅ `googleapis.androidpublisher` corregido a `.purchases.subscriptions` (`8b12fef`).
- ✅ Imports duplicados en `LaborManagementModal` (`4d50605`).
- ✅ Lazy-load de modales pesados (`4d50605`).
- ✅ Reglas Firestore para `ai_feedback` y `wisdomCapsules` (`892dc13`).
- ✅ Cloud Logging estructurado + alertas CPHS (`360a1c4`).
- ✅ ISO 45001 checklist + detección de edición concurrente IPER (`bb693cf`).
- ✅ Code review crítico de seguridad — data integrity, alarmas offline, UX en faena (`f1417f4`).

**Resultado:** la rama llega con **0 errores TypeScript** desde el punto de partida.

---

## ✅ Adiciones de esta auditoría (aditivas, no destructivas)

### Cleanup de archivos muertos

Removidos del raíz porque no eran usados en build ni en runtime y solo causaban confusión:

- `firestore.rules.bak` — versión antigua de las reglas; la actual `firestore.rules` es más completa.
- `DRAFT_firestore.rules` — versión simplificada/legacy. El nombre "DRAFT" era engañoso: la regla canónica está en `firestore.rules`.
- `zettelkasten_mentions.txt` — 22 KB de output de `grep` comiteado por error.
- `fix-settings.js` — codemod de un solo uso (reemplazos de Tailwind dark-mode).
- `fix_gemini.cjs` — codemod que removió el parámetro `userApiKey` (refactor histórico).
- `update_models.cjs` — codemod que migró nombres de modelos Gemini.

### Limpieza de dependencias

- ❌ **Removido `motion`** (v12.23.24) — no importado en ningún archivo. `framer-motion` (180 archivos) es la librería real.
- ❌ **Removido `connect-session-firebase`** (v11.0.0) — declarado pero nunca importado. Su peer-range desactualizado (`firebase-admin <12`) era la causa de que `npm install` fallara con `ERESOLVE` en clones limpios.
- ✔️ **`.npmrc`** con `legacy-peer-deps=true` como cinturón de seguridad para futuras incompatibilidades upstream.

### Procesos y CI

- ✔️ **`package.json` script `lint`** reactivado: era un `echo` que decía "Typechecking bypassed". Ahora ejecuta `tsc --noEmit`.
- ✔️ **Script `typecheck`** explícito agregado.
- ✔️ **`.github/workflows/ci.yml`** — ejecuta `tsc --noEmit` y `vite build` en cada PR y push a `main`. Hace que las regresiones futuras (como el lint deshabilitado) se detecten antes de mergear.

### Seguridad — `server.ts`

- 🔒 **`/api/calendar/sync`** (línea 495) — añadido middleware `verifyAuth`. Antes cualquier IP podía usar el endpoint con tokens propios o robados.
- 🔒 **`/api/fitness/sync`** (línea 539) — añadido `verifyAuth`. Misma razón.
- 🔒 **`session({ saveUninitialized })`** — cambiado de `true` a `false`. Antes se creaba sesión y cookie para cada visitante anónimo.

### Documentación

- ✔️ **`README.md`** reescrito. Era el boilerplate de AI Studio. Ahora documenta stack, arquitectura, comandos, despliegue y filosofía.
- ✔️ **`AUDIT.md`** (este documento) — registro persistente de hallazgos.

### `vite.config.ts`

- Removidas referencias a `connect-session-firebase` en `external` y `optimizeDeps.exclude` (consecuencia de quitar la dep).

---

## 🔴 ~~Pendientes críticos~~ — todos resueltos

### 1. ~~OAuth tokens enviados al cliente vía `postMessage`~~ ✅ RESUELTO

Antes:
- `/auth/google/callback` (server.ts:469-475) y `/api/drive/auth/callback` (line 632) enviaban el objeto `tokens` completo (incluyendo `refresh_token`) al popup vía `window.opener.postMessage`.
- El cliente almacenaba los tokens en estado de React y los enviaba en el body de `/api/fitness/sync`.
- Riesgo: XSS, extensiones maliciosas o caching del DOM = persistencia indefinida en la cuenta Google del usuario.

Resolución:
- **`src/services/oauthTokenStore.ts`** — helper server-only sobre Firestore Admin con `saveTokens`, `getValidAccessToken` (auto-refresh con bufer de 60s) y `revokeTokens`. Tokens viven en `oauth_tokens/{uid}_{provider}`.
- **`firestore.rules`** — match explícito para `oauth_tokens/*` con `allow read, write: if false` (además del default-deny).
- **`/api/auth/google/url`** y **`/api/drive/auth/url`** ahora requieren `verifyAuth`. Guardan el UID en la sesión Express (`oauthInitiator`) para que el callback sepa a qué usuario asociar los tokens.
- **`/auth/google/callback`** y **`/api/drive/auth/callback`** intercambian el `code` por tokens, los persisten vía `saveTokens`, limpian la sesión y envían `{ type, linked: true }` al popup. **No se envía ningún token al navegador.**
- **`/api/calendar/sync`** y **`/api/fitness/sync`** ya no aceptan `tokens` en el body — buscan los tokens del usuario autenticado vía `getValidAccessToken` (con auto-refresh) y proxean.
- **Cliente** (`Telemetry.tsx`, `GoogleDriveIntegrationManager.tsx`) actualizado: agrega Bearer auth a las llamadas que ahora la requieren, y los handlers de `postMessage` esperan `event.data.linked` en vez de `event.data.tokens`.

Hardening pendiente para prod:
- Cifrar los tokens almacenados con AES-256-GCM usando una key de KMS o `SESSION_SECRET`. Hoy se confía en el cifrado-en-reposo por defecto de Firestore + las reglas server-only.

---

## 🟠 Alto

### 2. ~~Roles inconsistentes entre `server.ts` y `firestore.rules`~~ ✅ RESUELTO

Antes:
- `server.ts:227` declaraba `['gerente', 'prevencionista', 'supervisor', 'trabajador', 'medico']`
- `firestore.rules` esperaba 16 roles incluyendo `'medico_ocupacional'`, `'worker'`, y 9 oficios.
- Resultado: un admin podía asignar `'medico'` desde `/api/admin/set-role` pero las rules lo rechazaban silenciosamente porque esperaban `'medico_ocupacional'`.

Resolución:
- **`src/types/roles.ts`** — fuente única de verdad con `ADMIN_ROLES`, `SUPERVISOR_ROLES`, `DOCTOR_ROLES`, `WORKER_ROLES` y los type guards `isAdminRole/isSupervisorRole/isDoctorRole/isWorkerRole/isValidRole`.
- **`server.ts`** ahora importa `isValidRole` del módulo central; el `VALID_ROLES` hardcoded fue eliminado.
- **`firestore.rules`** lleva un comentario en cabecera apuntando al source of truth.
- **`scripts/verify-roles-sync.cjs`** verifica que ambos archivos declaren los mismos identificadores. Falla con un diff visible si divergen.
- **CI** corre el verificador en cada PR como job dedicado (`verify-roles`), separado del typecheck para que falle rápido y barato.

### 3. Sin tests

No hay vitest/jest ni script `test`. Para una app que toma decisiones de seguridad humana, los cálculos críticos deberían tener cobertura:
- REBA / RULA (`safetyEngineBackend.ts`)
- A* de evacuación (`pathfinding`)
- IPER / matriz de riesgos
- TMERT / PREXOR (cálculo de exposición)
- Reglas Firestore con `@firebase/rules-unit-testing`

### 4. `geminiBackend.ts` god-file

`src/services/geminiBackend.ts` tiene ~2664 líneas. Concentra demasiada lógica. Recomendación: dividir por dominio (vision, embeddings, RAG, ergonomics, etc.) — alineado con la separación que ya existe (`legalBackend`, `chemicalBackend`, etc.).

### 5. Cinco páginas > 700 líneas

`PTSGenerator.tsx` (972), `Telemetry.tsx` (924), `Dashboard.tsx` (911), `Training.tsx` (868), `KnowledgeGraph.tsx` (821), `BioAnalysis.tsx` (798), `Gamification.tsx` (794), `Matrix.tsx` (766), `SiteMap.tsx` (746), `Evacuation.tsx` (661).

Cada vez que se toca una hay que cargar mucho contexto. Candidatas a extracción de subcomponentes — especialmente las que ya están en `lazy()`, donde el subcomponente puede deferirse aún más.

---

## 🟡 Medio

### 6. `helmet` CSP solo en producción (`server.ts:91`)

```ts
helmet({ contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false })
```

Si una CSP rompe en producción y nadie la testeó en dev, se descubre solo cuando llega ahí. Considera tener una CSP explícita y testeable en ambos entornos.

### 7. `SESSION_SECRET` con fallback (`server.ts:124`)

```ts
secret: sessionSecret || "fallback-secret-do-not-use-in-production"
```

En dev el fallback funciona y nadie nota que falta el secret. Mejor: si la env var no está, generar un secret aleatorio con `crypto.randomBytes(32).toString('hex')` al arranque y avisar por consola.

### 8. `package.json` — duplicación de `vite`

Aparece en `dependencies` (porque `server.ts` usa `createViteServer`) y en `devDependencies`. Verificar si en build de producción Vite se necesita en runtime; si solo en dev, debe quedar solo en dev-deps.

### 9. `@types/react-window@1.8.8` vs `react-window@2.2.7`

Mismatch de mayor versión entre los tipos y la lib runtime. Si el código nuevo migró a la API v2, los `@types` v1 podrían ocultar bugs de tipo.

---

## 🟢 Observaciones positivas

- ✨ Excelente uso de `lazy()` para code-splitting de las 87 páginas — `src/routes/*.tsx` y `App.tsx`. La capa móvil añadió más lazy en modales pesados.
- ✨ Reglas Firestore con default-deny, validadores de schema, audit_logs inmutables, doctor-scoped medical_exams. Nivel production-ready.
- ✨ Rate limiting global + per-user (Gemini) configurado correctamente.
- ✨ Helmet, cookieParser, sessions seguros en prod (`secure`, `httpOnly`, `sameSite: 'lax'`).
- ✨ PWA setup correcto (Workbox, runtime caching, manifest, lang `es-CL`).
- ✨ Webhook IoT y Pub/Sub validan secret compartido.
- ✨ `.gitignore` correctamente excluye `firebase-applet-config.json`.
- ✨ i18n configurado (`i18next` + detector de browser).
- ✨ Firebase Auth + custom claims para RBAC.
- ✨ MediaPipe edge processing para biometría — privacidad por diseño.
- ✨ Cloud Logging estructurado (`360a1c4`).
- ✨ Detección de edición concurrente en IPER (`bb693cf`).

---

## Recomendaciones de roadmap inmediato

1. **Mover `refresh_token` OAuth fuera del navegador.**
2. **Centralizar definición de roles** RBAC en un módulo TS compartido.
3. **Añadir vitest** y cubrir REBA/RULA/A*/IPER + reglas Firestore con `rules-unit-testing`.
4. **Refactor `geminiBackend.ts`** por dominio.
5. **Romper páginas > 700 líneas** en subcomponentes lazy.
6. **CSP explícita** testeable en dev también.

---

## Cómo seguir trabajando

- `npm run typecheck` ya corre y debería pasar (0 errores actualmente).
- El CI workflow lo va a bloquear automáticamente en PRs futuros.
- Los hallazgos están priorizados — escoge uno y abre un issue/PR específico contra `main`.
