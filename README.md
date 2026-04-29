<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Praeventio Guard

> Plataforma de prevención de riesgos laborales con IA para industrias críticas en Latinoamérica (minería, construcción, faenas remotas).

**Cumplimiento:** DS 54, DS 40, Ley 16.744 (Chile) — extensible a otras normativas LATAM.

> "El riesgo se neutraliza en el diseño, no en la reacción." — El Guardián

---

## Soporte

- General: soporte@praeventio.net
- Privacidad: privacidad@praeventio.net
- Comercial / Enterprise: ventas@praeventio.net
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
| `npm run lint` | Alias de typecheck (ESLint pendiente) |
| `npm run start` | Servidor en modo producción |
| `npm run cap:android` | Sincronizar y abrir Android Studio |
| `npm run cap:ios` | Sincronizar y abrir Xcode |

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
