<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Praeventio Guard

> Plataforma de prevención de riesgos laborales con IA para industrias críticas en Latinoamérica (minería, construcción, faenas remotas).

![Coverage](https://img.shields.io/badge/end--to--end-~70%25-4db6ac?style=flat-square)
![Tests](https://img.shields.io/badge/tests-10029%20passing-4db6ac?style=flat-square)
![Typecheck](https://img.shields.io/badge/typecheck-clean-4db6ac?style=flat-square)
![Audit](https://img.shields.io/badge/honest--state-2026--05--19-6c5b7b?style=flat-square)

> **Estado honesto**: ~70% E2E ponderado tras auditoría 2026-05-15 + verificación independiente 2026-05-19 (subió desde 62% del 2026-05-05 tras Sprints 39-56 + Wave F + Codex sweep). La cifra previa de 99% era optimista. Fuente única de verdad: [TODO.md](./TODO.md). Auditorías históricas en [docs/audits/](docs/audits/).

**Cumplimiento:** DS 44/2024 (vigente desde 01-02-2025; deroga y unifica DS 40 y DS 54 de 1969), Ley 16.744, DS 594 (Chile) — extensible a otras normativas LATAM.

> "El riesgo se neutraliza en el diseño, no en la reacción." — El Guardián

---

## Soporte

- General: contacto@praeventio.net
- Privacidad: contacto@praeventio.net
- Comercial / Enterprise: contacto@praeventio.net
- Bugs: https://github.com/mikesandoval10creator/Guardian-Praeventio/issues

---

## Quick start for new contributors

Si vas a contribuir código por primera vez, lee estos cuatro documentos
antes de tocar nada:

1. **[`CONTRIBUTING.md`](./CONTRIBUTING.md)** — flujo TDD, convenciones,
   cómo agregar rutas / acciones Gemini / motores de cálculo, checklist
   de PR.
2. **[`ARCHITECTURE.md`](./ARCHITECTURE.md)** — mapa de módulos, data
   flows críticos (Webpay, REBA, curriculum claims), estrategia de split
   de `server.ts` y `geminiBackend.ts`, inventario de colecciones
   Firestore, modelo de tier-gating.
3. **[`RUNBOOK.md`](./RUNBOOK.md)** — procedimientos operacionales:
   emulador Firestore, deploy a Cloud Run, restore de backup, rotación
   KMS, FCM de prueba, triage Sentry.
4. **[`docs/api-routes.md`](./docs/api-routes.md)** — catálogo completo
   de los 43 endpoints HTTP (auth, body, response, errores, audit log,
   tenant isolation).

Para emergencias de producción: [`DR_RUNBOOK.md`](./DR_RUNBOOK.md). Para
reportes de seguridad: [`SECURITY.md`](./SECURITY.md).

Tests al cierre de Round 16: **866 pasando**, `npm run typecheck` con 0
errores. Mantener verde es invariante de proyecto.

---

## Setup

```bash
# 1. Clone + install
git clone https://github.com/mikesandoval10creator/Guardian-Praeventio.git
cd Guardian-Praeventio
npm install

# 2. Copy the env template and fill in real values.
cp .env.example .env.local
$EDITOR .env.local   # see docs/runbooks/SECRETS_RUNBOOK.md for each

# 3. Verify the env shape BEFORE booting.
npm run validate:env

# 4. Run tests + typecheck (must pass).
npm run typecheck
npm test

# 5. Local dev server.
npm run dev
```

Cualquier variable que aparezca como `<...>`, `YOUR_*`, o `MY_*` en
`.env.local` causará que `npm run validate:env` falle e indique
exactamente qué falta y dónde obtenerlo.

## Deploy

- **Producción Cloud Run**: ver [`RUNBOOK.md`](./RUNBOOK.md) +
  [`DR_RUNBOOK.md`](./DR_RUNBOOK.md).
- **Secretos** (qué pegar dónde, formato esperado, cadencia de
  rotación): [`docs/runbooks/SECRETS_RUNBOOK.md`](./docs/runbooks/SECRETS_RUNBOOK.md).
- **KMS rotation 90-day**: [`KMS_ROTATION.md`](./KMS_ROTATION.md).
- **Cloud Build pipeline**: [`docs/runbooks/CLOUD_BUILD_RUNBOOK.md`](./docs/runbooks/CLOUD_BUILD_RUNBOOK.md).
- **Disaster recovery**: [`docs/runbooks/DR_RUNBOOK.md`](./docs/runbooks/DR_RUNBOOK.md).
- **Estado funcional vivo**: [`TODO.md`](./TODO.md) — fuente única de
  verdad (Regla #1: nada se marca ✅ sin file:line). Cobertura E2E
  ponderada **~70%** verificado 2026-05-15 (subió desde 62% el
  2026-05-05 tras Sprints 39-56 + Wave F + Codex sweep). El claim
  histórico "99% end-to-end" del snapshot 2026-05-04 fue rectificado
  por auditoría profunda; el snapshot queda en
  [`docs/archive/2026-05/STATE_OF_FUNCTIONALITY_2026-05-04.md`](./docs/archive/2026-05/STATE_OF_FUNCTIONALITY_2026-05-04.md)
  para referencia histórica.

---

## Características principales

- **El Guardián** — asistente IA con RAG sobre la base normativa chilena (BCN, ISO).
- **Vision Analyzer** — detección de EPP y riesgos por computer vision (Gemini + MediaPipe edge).
- **Knowledge Graph (Zettelkasten)** — red neuronal de riesgos, normativas y controles, navegable en 2D y 3D.
- **Modo Crisis** — chat de emergencia, check-in, detección de "Hombre Caído", rutas de evacuación dinámicas (A*/Dijkstra).
- **Análisis predictivo** — REBA/RULA ergonómicos, fatiga por video, cruces clima-tarea.
- **PWA + Capacitor** — funciona offline en faena, sincroniza al recuperar conexión, deployable a Android/iOS.
- **i18n** — soporte multi-idioma (es-CL por defecto).

Ver [`ROADMAP.md`](./ROADMAP.md) para el detalle de funciones implementadas y planificadas, y [`PRICING.md`](./PRICING.md) para la estrategia de monetización (gratuito para salvaguarda de vida, suscripciones para gestión PYME y Enterprise).

---

## Stack

| Capa | Tecnologías |
|---|---|
| Frontend | React 19, Vite, TypeScript, Tailwind 4, Framer Motion, react-router 7 |
| Backend | Node.js, Express, Firebase Admin SDK |
| Base de datos | Firestore + IndexedDB / SQLite (offline) |
| IA | `@google/genai` (Gemini), MediaPipe Vision, embeddings vectoriales |
| Mobile | Capacitor 8 (Android, iOS) |
| Maps / Geo | React Google Maps, Turf, Leaflet |
| PDF | `pdfkit` (server) + `jspdf` (cliente) |
| Auth | Firebase Auth + custom claims (RBAC) |
| Notificaciones | Firebase Cloud Messaging (FCM) |

---

## Setup local

### Requisitos
- Node.js 20+
- Una cuenta de Firebase con Firestore habilitado
- API key de Gemini (Google AI Studio)

### Instalación

```bash
git clone https://github.com/mikesandoval10creator/Guardian-Praeventio.git
cd Guardian-Praeventio
npm install
```

> El repo incluye `.npmrc` con `legacy-peer-deps=true` para tolerar peer-ranges desactualizados de algunas dependencias upstream.

### Variables de entorno

Copia `.env.example` a `.env.local` y completa los valores:

```bash
cp .env.example .env.local
```

Mínimo para arrancar:
- `GEMINI_API_KEY` — Google AI Studio
- `SESSION_SECRET` — string aleatorio (`openssl rand -hex 32`)

Opcionales pero recomendados:
- `VITE_GOOGLE_MAPS_API_KEY` — para mapas
- `VITE_OPENWEATHER_API_KEY` — para alertas climáticas
- `IOT_WEBHOOK_SECRET` — para ingesta de telemetría IoT
- `RESEND_API_KEY` — para emails transaccionales

Para Firebase Admin local: descargar `firebase-applet-config.json` desde la consola y dejarlo en la raíz (gitignoreado).

### Comandos

| Comando | Descripción |
|---|---|
| `npm run dev` | Servidor Express + Vite con HMR en `http://localhost:3000` |
| `npm run build` | Build de producción del frontend |
| `npm run preview` | Servir el build localmente para verificar |
| `npm run typecheck` | Verificación de tipos TypeScript |
| `npm run lint` | ESLint sobre `src/**/*.{ts,tsx}` + `server.ts` + `firestore.rules` (typescript-eslint + react-hooks, warnings permitidos hasta Fase F) |
| `npm run lint:fix` | Igual que `lint` con `--fix` |
| `npm run lint:rules` | Solo lintea `firestore.rules` (gate Firebase Security) |
| `npm run start` | Servidor en modo producción |
| `npm run cap:android` | Sincronizar y abrir Android Studio |
| `npm run cap:ios` | Sincronizar y abrir Xcode |
| `npm run mutation` | Mutation testing (Stryker) sobre motores de cálculo de seguridad |

---

## Mutation testing

`npm run mutation` corre [Stryker](https://stryker-mutator.io/) sobre los motores
de cálculo de seguridad — donde una regresión silenciosa puede traducirse en
mal cálculo de riesgo y daño físico al trabajador. Es por eso que estos
módulos exigen una cobertura mutacional alta, no sólo line/branch.

- **Ejecución local:** `npm run mutation` (~5 min en hardware moderno;
  hasta 15-30 min en hardware más lento; aún no agregado a CI).
- **Targets** (`stryker.conf.json`): `services/ergonomics/{reba,rula}.ts`,
  `services/protocols/{iper,prexor,tmert}.ts`, `services/safety/{ergonomicAssessments,iperAssessments}.ts`.
- **Umbrales:** `high: 80%`, `low: 60%`, `break: 50%` (R18 baseline —
  ver [`STRYKER_BASELINE.md`](./STRYKER_BASELINE.md)).
- **Reporte HTML:** `reports/mutation/mutation.html` tras la corrida; abrir en
  navegador para inspeccionar mutantes sobrevivientes.

**Línea base R18 (2026-04-28):** score global **67.32%** (828 killed,
356 survived, 46 no-coverage, 0 errors, 0 timeouts sobre 1230 mutantes).
Detalle por archivo y plan de mejora R19 documentado en
[`STRYKER_BASELINE.md`](./STRYKER_BASELINE.md).

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────┐
│  Cliente (PWA + Capacitor)                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ React 19 SPA │  │  IndexedDB   │  │  MediaPipe   │   │
│  │ Vite + Tail. │  │ (offline KV) │  │  edge CV     │   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │
└─────────┼─────────────────┼─────────────────┼───────────┘
          │                 │                 │
          │  HTTPS + token  │  sync           │  on-device
          ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────┐
│  Backend (Express + tsx, server.ts)                     │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐         │
│  │ verifyAuth │  │ Gemini RAG │  │ FCM push   │         │
│  │ (Firebase) │  │ /ask-guard │  │ + triggers │         │
│  └────────────┘  └────────────┘  └────────────┘         │
└─────────────────────────────────────────────────────────┘
          │                 │
          ▼                 ▼
┌──────────────────┐  ┌──────────────────────────┐
│ Firestore        │  │ Google Cloud (Vertex AI, │
│ + reglas RBAC    │  │ Pub/Sub, Play Billing)   │
└──────────────────┘  └──────────────────────────┘
```

- **`server.ts`** — punto de entrada del backend; orquesta autenticación, endpoints API, OAuth con Google Workspace/Calendar/Fit, billing webhook, RAG y triggers en background.
- **`src/`** — frontend SPA: 87 páginas organizadas en grupos de rutas (`src/routes/`) con `lazy()` para code-splitting.
- **`firestore.rules`** — reglas con default-deny, RBAC por roles, validación de schemas y trazabilidad inmutable de `audit_logs`. Especificación de invariantes en [`security_spec.md`](./security_spec.md).
- **`tasks/`** — planes de implementación (EPP vision, PTS grounding) y lessons learned.

---

## Seguridad y privacidad

- 🔒 `GEMINI_API_KEY` y demás secretos viven solo en el backend; nunca llegan al cliente.
- 🔒 Reglas Firestore con default-deny y validación estricta de schemas.
- 🔒 Procesamiento biométrico (fatiga, postura) **100% on-device** vía MediaPipe.
- 🔒 Audit logs inmutables (sin update/delete).
- 🔒 Rate limiting per-user para llamadas a IA (30/15min).
- 🔒 Helmet + CSP en producción.

Ver [`security_spec.md`](./security_spec.md) para la "Dirty Dozen" de payloads esperados a ser rechazados, y [`AUDIT.md`](./AUDIT.md) para hallazgos pendientes.

---

## Despliegue

### Cloud Run (recomendado)

El [`Dockerfile`](./Dockerfile) hace build multi-stage (frontend + servidor) y expone el puerto 3000 con healthcheck en `/api/health`.

Configurar en Cloud Run:
- Secretos como variables de entorno (Secret Manager)
- `firebase-applet-config.json` montado como secreto
- Service account con permisos de Firestore Admin y Vertex AI

### AI Studio

Este proyecto también puede correrse desde Google AI Studio: `https://ai.studio/apps/d2437df8-893e-424f-a15b-f6c3b5f170dc`.

---

## Contribuir

Guía completa en [`CONTRIBUTING.md`](./CONTRIBUTING.md). Resumen:

1. Crear branch desde `main` con prefijo (`feat/`, `fix/`, `audit/`, `claude/`).
2. TDD estricto (RED → GREEN → REFACTOR).
3. `npm run typecheck` y `npm run test` deben pasar antes de PR.
4. Mantener cobertura de las funciones críticas (REBA, A*, IPER, evaluación legal).
5. No introducir secretos en commits — usar `.env.local`.
6. Toda operación de cambio de estado debe escribir en `audit_logs`.

---

## Licencia y filosofía

Praeventio Guard se rige por una filosofía de **democratización del conocimiento preventivo**:

- 🟢 **Gratis para siempre**: funciones de salvaguarda de vida (Monitor Sísmico, SOS, Hazmat GRE, Hombre Caído, base normativa).
- 🔵 **PYME**: gestión documental, multi-proyecto, modelos IA premium.
- 🟣 **Enterprise**: bio-análisis CV, IoT industrial, ERP/HRM, dashboards predictivos.

Ver [`PRICING.md`](./PRICING.md) para el detalle.
