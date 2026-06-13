# 📋 INFORME COMPLETO — Guardian Praeventio

## Auditoría Exhaustiva del Código Fuente

**Fecha:** 12 de junio de 2026
**Repositorio:** `mikesandoval10creator/Guardian-Praeventio`
**Commits analizados:** 863+ (historial completo disponible)
**Alcance:** Análisis estático integral de la totalidad del codebase

---

# PARTE I — IDENTIDAD DEL PROYECTO

## 1.1 ¿Qué es?

**Praeventio Guard** es una plataforma digital de **prevención de riesgos laborales** potenciada con inteligencia artificial, diseñada específicamente para industrias críticas en Latinoamérica: minería, construcción y faenas remotas. Su filosofía central está resumida en su lema:

> *"El riesgo se neutraliza en el diseño, no en la reacción."*

No es un simple gestor de checklists. Es un ecosistema completo que integra:
- Evaluación de riesgos con IA predictiva
- Cumplimiento normativo automatizado (legislación chilena y LATAM)
- Monitoreo biométrico on-device (sin enviar datos sensibles al servidor)
- Detección de caídas y emergencias en tiempo real
- Facturación electrónica (DTE) integrada
- Gemelos digitales 3D de faenas industriales
- Funcionamiento offline para zonas sin conectividad

## 1.2 Mercado Objetivo

- Empresas mineras en Chile (reguladas por DS 44/2024, DS 594, Ley 16.744)
- Constructoras con obras remotas
- Faenas industriales con trabajadores en terreno
- PYMEs que necesitan cumplimiento normativo accesible

## 1.3 Estado de Madurez

Según su propio `TODO.md` (que sigue una filosofía de honestidad radical — "Regla #1: no marcar ✅ sin evidencia file:line"):

- **Cobertura E2E real ponderada:** ~70% (recalibrada el 2026-05-15 desde un claim previo optimista de 99%)
- **Tests:** 10,029 pasando / 0 fallidos
- **TypeScript:** typecheck limpio (0 errores)
- **CI/CD:** 14 workflows de GitHub Actions

---

# PARTE II — ARQUITECTURA TÉCNICA

## 2.1 Diagrama de Alto Nivel

```
┌─────────────────────────────────────────────────────────────────┐
│  CLIENTE                                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │ React 19 SPA │  │ IndexedDB +  │  │ MediaPipe + sensores  │  │
│  │ Vite 6       │  │ SQLite       │  │ nativos (Capacitor)   │  │
│  │ Tailwind 4   │  │ (offline KV) │  │ (procesamiento        │  │
│  │ 238 páginas  │  │              │  │  on-device)           │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬────────────┘  │
└─────────┼─────────────────┼──────────────────────┼──────────────┘
          │ HTTPS + IdToken │ syncManager          │ sin red
          ▼                 ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  BACKEND — Express monolith                                      │
│  ┌──────────┐ ┌───────────────┐ ┌──────────┐ ┌───────────────┐  │
│  │verifyAuth│ │ Gemini proxy  │ │ Billing  │ │ Triggers      │  │
│  │(Firebase │ │ (whitelist +  │ │ (Webpay  │ │ (FCM push,    │  │
│  │ Admin)   │ │  circuit brk) │ │  + MP +  │ │  RAG ingest,  │  │
│  │          │ │               │ │  Khipu)  │ │  MQTT bridge) │  │
│  └──────────┘ └───────────────┘ └──────────┘ └───────────────┘  │
│  215 rutas server | 228 dominios de servicio                     │
└─────────────────────────────────────────────────────────────────┘
          │             │              │              │
          ▼             ▼              ▼              ▼
   ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐
   │ Firestore  │ │ Vertex AI  │ │ Transbank  │ │ FCM /      │
   │ (RBAC +    │ │ + Gemini   │ │ MercadoPago│ │ Resend /   │
   │ multi-     │ │ + Pinecone │ │ Khipu      │ │ Sentry /   │
   │ tenant)    │ │ (RAG)      │ │            │ │ MQTT       │
   └────────────┘ └────────────┘ └────────────┘ └────────────┘
```

## 2.2 Stack Tecnológico Completo

### Frontend
| Tecnología | Versión | Propósito |
|---|---|---|
| React | 19 | UI framework |
| Vite | 6.2 | Build tool |
| TypeScript | 5.8 | Type safety |
| Tailwind CSS | 4.1 | Estilos |
| React Router | 7.13 | Navegación (lazy splitting) |
| i18next | 23.16 | Internacionalización (15 idiomas) |
| Three.js + R3F | 10.7 / 9.5 | Gemelo digital 3D, AR |
| Framer Motion | 12.38 | Animaciones |
| Recharts | 3.8 | Gráficos |
| D3 | 7.9 | Visualizaciones avanzadas |
| GSAP | 3.15 | Animaciones complejas |
| MediaPipe | 0.10 | Detección EPP, pose estimation |
| ONNX Runtime | 1.25 | Modelos SLM on-device |
| HuggingFace Transformers | 3.8 | NLP on-device |
| Tesseract.js | 7.0 | OCR on-device |

### Backend
| Tecnología | Versión | Propósito |
|---|---|---|
| Express | 4.21 | HTTP server |
| Firebase Admin | 13.8 | Auth + Firestore SDK |
| Google GenAI | 1.46 | Gemini API |
| Vertex AI | 1.12 | ML en la nube |
| Pinecone | 4.0 | Vector DB para RAG |
| Sentry | 10.51 | Error tracking |
| Resend | 6.12 | Email transaccional |
| MQTT.js | 5.15 | IoT messaging |
| Zod | (bundled) | Validación de esquemas |
| Jose | 5.10 | JWT/WebAuthn |

### Mobile (Capacitor 8)
| Plugin | Propósito |
|---|---|
| @capacitor/android + ios | Runtime nativo |
| Health Connect / HealthKit | Datos biométricos |
| Bluetooth LE + Mesh | Comunicación peer-to-peer sin red |
| Geolocation + Motion | GPS + acelerómetro |
| Push Notifications | FCM |
| SQLite | Almacenamiento offline |
| Proximity Sensor | Detección de proximidad |
| Keep Awake | Pantalla activa en faena |

### DevOps / Testing
| Herramienta | Propósito |
|---|---|
| Vitest | Unit + integration tests |
| Playwright | E2E tests |
| Stryker | Mutation testing |
| ESLint | Linting |
| GitHub Actions | CI/CD (14 workflows) |
| Firebase Emulator | Tests de reglas Firestore |
| Artillery | Load testing |
| Lighthouse CI | Performance auditing |
| Size Limit | Bundle size monitoring |

## 2.3 Estructura del Código

```
src/                          # 36 MB, 498 directorios, 3,283 archivos
├── pages/                    # 238 páginas React (una por feature)
├── components/               # 176 dominios de componentes UI
│   ├── admin/               ├── adoption/          ├── agenda/
│   ├── ai/                  ├── annualReview/      ├── apprenticeship/
│   ├── ar/                  ├── audit/             ├── billing/
│   ├── coach/               ├── compliance/        ├── dashboard/
│   ├── digital-twin/        ├── driving/           ├── epp/
│   ├── ergonomics/          ├── emergency/         ├── gamification/
│   ├── hazmat/              ├── health/            ├── heatmap/
│   ├── iot/                 ├── knowledge/         ├── maintenance/
│   ├── medical/             ├── predictive/        ├── protocols/
│   ├── risk-network/        ├── safety/            ├── slm/
│   ├── telemetry/           ├── twinPhysics/       └── ... (176 total)
├── services/                 # 228 dominios de lógica de negocio
│   ├── ai/                  ├── billing/           ├── compliance/
│   ├── digitalTwin/         ├── driving/           ├── ergonomics/
│   ├── gemini/              ├── iot/               ├── mesh/
│   ├── protocols/           ├── rag/               ├── safety/
│   ├── slm/                 ├── telemetry/         └── ... (228 total)
├── server/                   # Backend Express
│   ├── routes/              # 215 archivos de rutas HTTP
│   ├── middleware/           # Auth, rate limiting, validation
│   ├── triggers/            # Firestore listeners
│   ├── jobs/                # Tareas programadas
│   ├── mcp/                 # Model Context Protocol
│   ├── sessionStore/        # Session persistente (Firestore)
│   └── rateLimit/           # Rate limiting distribuido
├── hooks/                    # 210 custom hooks
├── contexts/                 # 16 React contexts
├── routes/                   # 7 route groups (lazy loaded)
├── i18n/locales/            # 15 idiomas
├── data/                     # Tablas estáticas (normativa, REBA, RULA)
├── types/                    # Tipos compartidos
├── lib/                      # Utilidades puras
├── utils/                    # Helpers de UI
├── __tests__/                # Tests de integración
└── workers/                  # Web Workers
```

## 2.4 Datos y Persistencia

### Firestore Collections (estructura inferida)
- `users/{uid}` — Perfiles de usuario con claims de rol
- `tenants/{tid}/projects/{pid}/...` — Datos multi-tenant
- `invoices/{id}` — Facturas y pagos
- `processed_webpay/{token_ws}` — Lock de idempotencia Webpay
- `audit_logs/` — Registro de auditoría (append-only)
- `_sessions/` — Sesiones de express-session
- `health_vault/` — Datos biométricos compartidos por QR
- `telemetry_events/` — Eventos de sensores IoT
- `processed_pubsub/{messageId}` — Idempotencia de webhooks

### Modelo de Seguridad
- **Default-deny** en firestore.rules (1,829 líneas)
- **RBAC:** 7 roles (admin, gerente, supervisor, prevencionista, director_obra, medico_ocupacional, worker)
- **Multi-tenant:** Claims de tenant en el token de auth
- **Server-only:** Datos sensibles (invoices, billing) solo accesibles vía Admin SDK

## 2.5 Integraciones Externas

| Servicio | Uso | Estado |
|---|---|---|
| Google Gemini / Vertex AI | IA generativa, embeddings, análisis predictivo | 🟢 Operativo |
| Transbank Webpay | Pagos en CLP | 🟢 Operativo |
| MercadoPago | Pagos LATAM | 🟢 Operativo |
| Khipu | Pagos Chile | 🟢 Operativo |
| Google Play Billing | IAP Android | 🟡 Parcial |
| Apple App Store | IAP iOS | 🟡 Parcial |
| Stripe | Pagos internacionales | 🔴 Scaffold |
| SII (Servicio de Impuestos Internos) | Facturación electrónica DTE | 🟢 Operativo |
| SUSESO | Reportes de accidentes (DIAT/DIEP) | 🟡 Parcial |
| Resend | Email transaccional | 🟢 Operativo |
| Firebase Cloud Messaging | Push notifications | 🟢 Operativo |
| Sentry | Error tracking + APM | 🟢 Operativo |
| Pinecone | Vector search para RAG | 🟢 Operativo |
| MQTT (IoT) | Telemetría de sensores industriales | 🟢 Operativo |
| MediaPipe Vision | Detección de EPP on-device | 🟢 Operativo |
| Health Connect (Android) | Datos biométricos | 🟡 Parcial |
| HealthKit (iOS) | Datos biométricos | 🟡 Parcial |
| BCN (Biblioteca del Congreso) | Corpus normativo offline | 🟢 Operativo |

---

# PARTE III — DOMINIOS FUNCIONALES (TODO lo que hace)

## 3.1 Gestión de Riesgos

El corazón de la plataforma. Implementa múltiples metodologías de evaluación:

- **Matriz de Riesgo:** Clasificación de probabilidad × severidad con scoring configurable
- **Risk Ranking:** Priorización automática de riesgos por criticidad
- **Risk Network:** Grafo de relaciones entre riesgos (visualización con react-force-graph)
- **Análisis Residual:** Evaluación de riesgo post-controles
- **Controles Críticos:** Registro, verificación de eficacia y vencimiento de controles
- **Investigación de Causa Raíz:** Metodología estructurada con análisis de 5 porqués
- **Análisis Bow-Tie:** Modelamiento de escenarios de falla
- **Risk Radar:** Dashboard de riesgos con visualización radial
- **IPER (Instrumento de Evaluación de Peligros):** Tabla de datos industriales (937 líneas de datos)
- **Línea de Fire:** Detección de zonas de riesgo por proximidad
- **Riesgos Psicosociales:** Instrumento CEAL-SM/SUSESO con anonimato k≥10

## 3.2 Ergonomía

- **REBA (Rapid Entire Body Assessment):** Evaluación postural con tablas canónicas de Hignett 2000 (1,014 líneas de tests)
- **RULA (Rapid Upper Limb Assessment):** Evaluación de miembros superiores con tablas de McAtamney 1993
- **Carga Mental (NASA-TLX):** Evaluación de carga cognitiva
- **Evaluación Ergonómica Integrada:** Modal unificado para agregar evaluaciones
- **Exposición a Sílice (PLANESI):** Protocolo con grading oficial verificado
- **TMERT:** Evaluación de riesgo por manipulación de cargas
- **PREXOR:** Protocolo de exposición a riesgos ocupacionales

## 3.3 Emergencia y Respuesta

- **SOS:** Botón de emergencia con detección de caídas (acelerómetro + MediaPipe)
- **Detección de Caídas:** Monitoreo continuo con sensor de movimiento del celular
- **Brigadas de Emergencia:** Gestión de brigadistas, roles, capacitación y disponibilidad
- **Evacuación:** Dashboard de evacuación con headcount en tiempo real
- **Primeros Respondientes:** Mapa interactivo de recursos de emergencia
- **Simulación de Contingencia:** Builder de escenarios con modelamiento probabilístico
- **Refugios de Montaña:** Registro de refugios en zonas remotas
- **Mapa de Emergencia Costera:** Visualización de riesgos costeros
- **Erupciones Volcánicas:** Mapa de riesgo volcánico
- **Monitoreo de Trabajador Solitario:** Alertas automáticas por inactividad
- **Geofencing:** Alertas por entrada/salida de zonas de riesgo

## 3.4 Cumplimiento Normativo

### Legislación Chilena
- **DS 44/2024:** Reglamento de prevención de riesgos profesionales (vigente desde 01-02-2025, reemplaza DS 40 y DS 54 de 1969)
- **Ley 16.744:** Accidentes del trabajo y enfermedades profesionales
- **DS 594:** Condiciones sanitarias y ambientales en el trabajo
- **DS 67:** Cotización adicional por siniestralidad (simulador implementado)
- **DS 76:** Sistema de Administración de SST
- **SUSESO:** Formularios DIAT/DIEP con generación de PDF real y folio
- **CPHS:** Comité Paritario de Higiene y Seguridad (actas, minutos, firmas)
- **SII:** Facturación electrónica DTE integrada

### Normas Internacionales
- **ISO 45001:** Sistema de Gestión de SST
- **ISO 14001:** Gestión Ambiental (referenciada)
- **NCh 432:** Cargas de viento (cálculo estructural)

### Jurisdicciones LATAM
- Chile, Argentina, Perú, México, Brasil, Colombia (6 jurisdicciones)
- Pendientes: UK, Canadá, Australia, Japón, Corea, India

## 3.5 Facturación y Suscripciones

Flujo completo de pagos:
1. **Checkout:** Pricing → Webpay/MP/Khipu → redirect a pasarela
2. **Confirmación:** Webhook con idempotencia (doble redirect protegido)
3. **Activación:** Invoice → paid → suscripción activa → DTE emitido
4. **Gestión:** 8 tiers de suscripción con feature flags

Pasarelas implementadas:
- **Webpay (Transbank):** Pagos en CLP con idempotencia por token
- **MercadoPago:** IPN con HMAC SHA-256 verificado
- **Khipu:** Checkout cableado con webhook
- **Google Play Billing:** Receipt validation server-to-server
- **Apple App Store:** Receipt validation server-to-server
- **Stripe:** Solo scaffold (no operativo)

## 3.6 Inteligencia Artificial

### Gemini/Vertex AI (Cloud)
- **Proxy con whitelist:** Solo acciones autorizadas pueden llamar a Gemini
- **Circuit breaker:** Protección contra sobrecosto
- **Per-tenant quota:** Control de uso por cliente
- **PII redaction:** Eliminación de datos personales antes de enviar a la API
- **Funcionalidades:**
  - Análisis predictivo de incidentes
  - Generación de reportes narrativos
  - Quality scoring de datos
  - Research mode (búsqueda profunda)
  - Explicabilidad de decisiones de riesgo
  - Safety coach conversacional
  - Resúmenes multi-rol
  - Wisdom capsules (consejos diarios)

### SLM On-Device (Edge)
- **Modelos:** Phi-3, Qwen 2.5, Gemma (ONNX Runtime Web)
- **Execution providers:** WebGPU (primario) + WASM (fallback)
- **Integridad:** SHA-256 hash verification antes de cargar
- **Offline queue:** Cola de inferencias pendientes para reconciliación
- **Use cases:**
  - Asesor de seguridad offline
  - Evaluación de riesgo sin red
  - Detección de EPP (MediaPipe)

### RAG (Retrieval-Augmented Generation)
- **Corpus:** Normativa chilena + ISO indexada (BCN)
- **Vector DB:** Pinecone con embeddings de Gemini
- **Búsqueda semántica:** Sobre leyes, reglamentos y estándares

## 3.7 IoT y Sensores

- **MQTT Bridge:** Conexión a sensores industriales → `telemetry_events`
- **Sensor Bus:** Abstracción unificada de sensores
- **Edge Filtering:** Filtrado de datos en el borde antes de enviar
- **Proximity Mode Detection:** Modo de porte modula detección de impactos
- **Horómetro:** Seguimiento de horas de uso de maquinaria
- **Driving Safety:** Detección de eventos de conducción (aceleración brusca, frenado)
- **Route Scoring:** Evaluación de seguridad de rutas
- **Wearables:** Health Connect (Android) + HealthKit (iOS) — foundation, parcialmente operativo

## 3.8 Mobile y Offline

- **PWA:** Service Worker con cache de modelos SLM
- **Capacitor 8:** App nativa Android/iOS desde la misma SPA
- **Sync Engine:** `syncManager.ts` (551 líneas) — cola de operaciones offline
- **Offline Inspections:** Inspecciones sin red con reconciliación automática
- **Encrypted Offline Queue:** Cola cifrada para datos sensibles
- **BLE Mesh Networking:** Plugin nativo Kotlin (552 LOC) + Swift para comunicación peer-to-peer sin internet
- **Foreground Service:** Servicio en primer plano para monitoreo continuo

## 3.9 Gemelo Digital (Digital Twin)

- **Modelo 3D:** Three.js + React Three Fiber + Rapier (physics)
- **InstancedMesh:** Renderizado eficiente de múltiples objetos
- **WebXR:** Realidad aumentada en terreno
- **Photogrammetry:** Worker Cloud Run para reconstrucción 3D (DESCARTADO — directiva on-device)
- **Blueprint Viewer:** Visor de planos DXF
- **AutoCAD Viewer:** Visualización de archivos CAD

## 3.10 Capacitación y Gamificación

- **Safety Talks:** Charlas de seguridad con seguimiento de asistencia
- **Microtraining:** Módulos de capacitación cortos
- **Spaced Repetition:** Repetición espaciada para retención de conocimiento
- **Curriculum:** Gestión de planes de capacitación con claims verificables
- **Gamificación:** Puntos, insignias, leaderboards
- **Arcade Games:** Juegos educativos de seguridad (Pool, Claw Machine)
- **Apprenticeship:** Programa de aprendizaje estructurado

## 3.11 Documentos y Evidencia

- **Cadena de Custody:** Registro inmutable de transferencia de evidencia
- **Photo Evidence:** Fotos con metadata GPS + timestamp
- **Firma QR:** Firma de documentos vía QR code
- **Firma WebAuthn:** Firma biométrica (passkey/huella)
- **Generación PDF:** Reportes con jsPDF + PDFKit
- **OCR:** Reconocimiento de texto en documentos (Tesseract.js)
- **Read Receipts:** Confirmación de lectura de documentos
- **Document Versioning:** Control de versiones de documentos

## 3.12 Reportes y Analítica

- **Reportes Automatizados:** Generación programada de reportes
- **Dashboard Ejecutivo:** Vista de alto nivel para gerencia
- **Analytics:** Métricas de uso y adopción
- **Heatmap:** Mapa de calor de incidentes
- **Incident Trends:** Análisis de tendencias de incidentes
- **Cost Calculator:** Calculadora de costos de accidentes
- **ROI Scenario:** Simulación de retorno de inversión en prevención
- **Meeting Pack:** Preparación automática de paquetes de reunión
- **Client Reporting:** Reportes personalizados para clientes

## 3.13 Seguridad y Privacidad

- **MFA:** WebAuthn (passkey) + TOTP (Google Authenticator) — SMS removido por ser inseguro
- **Privacy Shield:** Clasificador de PII + compliance gap detector
- **Retención Automática:** Reaper de datos según política de retención
- **Anonimato k≥10:** Supresión de datos cuando menos de 10 respuestas
- **Ley 19.628 / GDPR:** Compliance de protección de datos
- **Retaliation Protection:** Protección contra represalias en reportes confidenciales
- **Confidential Reports:** Canal seguro para reportar irregularidades

## 3.14 B2D (Business-to-Developer) API

API pública para integradores externos:
- **Climate API:** Datos climáticos para planificación
- **Hazmat API:** Inventario de materiales peligrosos
- **Normativa API:** Consulta de normativa vigente
- **Suite API:** Conjunto completo de herramientas

## 3.15 Gobernanza y Madurez

- **Maturity Model:** Evaluación de madurez del sistema de prevención
- **PDCA:** Ciclo Plan-Do-Check-Act para mejora continua
- **Matriz RACI:** Asignación de responsabilidades
- **Revisión Anual:** Snapshot anual del SGI (ISO 45001 §9.3)
- **Annual Review:** Revisión de objetivos preventivos
- **Lessons Learned:** Base de conocimiento de lecciones
- **Portfolio Lessons:** Lecciones transferibles entre proyectos

---

# PARTE IV — MÉTRICAS CUANTITATIVAS

## 4.1 Volumen de Código

| Métrica | Cantidad |
|---|---|
| **Archivos totales en src/** | 3,283 |
| **Líneas totales en src/** | ~620,662 |
| **Archivos TS/TSX (producción)** | 1,280 |
| **Archivos de test** | 1,374 |
| **Líneas de código TS/TSX** | ~94,970 (netas, sin tests) |
| **Líneas de tests** | ~346,668 |
| **Directorios en src/** | 498 |
| **Páginas React** | 238 |
| **Componentes UI (dominios)** | 176 |
| **Servicios backend (dominios)** | 228 |
| **Rutas server** | 215 archivos |
| **Custom hooks** | 210 |
| **React contexts** | 16 |
| **Exports totales** | 3,804 |
| **Variables de entorno** | 262 referencias |

## 4.2 Tests

| Métrica | Cantidad |
|---|---|
| **Tests pasando** | 10,029 |
| **Tests fallidos** | 0 |
| **Bloques describe** | 3,509 |
| **Archivos de test** | 1,374 |
| **Cobertura E2E real** | ~70% |
| **Cobertura co-located** | ~54% |
| **Tests skip/fixme** | ~20 |
| **Mutation testing (Stryker)** | 72% global |
| **Test cases (it blocks)** | ~16,160 |

## 4.3 Dependencias

| Categoría | Cantidad |
|---|---|
| **Dependencias de producción** | 102 |
| **Dependencias de desarrollo** | 47 |
| **Total** | 149 |

### Dependencias más pesadas (impacto en bundle):
- `three` + `@react-three/fiber` + `@react-three/drei` + `@react-three/rapier` — 3D engine
- `playcanvas` + `@playcanvas/react` — Motor 3D alternativo
- `d3` — Visualizaciones
- `gsap` + `@gsap/react` — Animaciones
- `tesseract.js` — OCR
- `onnxruntime-web` — ML inference
- `@huggingface/transformers` — NLP
- `@mediapipe/tasks-vision` — Computer vision
- `firebase` — SDK completo del cliente
- `googleapis` — SDK completo de Google (debería importar sub-módulos)
- `recharts` — Gráficos
- `react-force-graph-2d` + `react-force-graph-3d` — Grafos
- `jspdf` + `pdfkit` — Generación PDF
- `mercadopago` — SDK de MercadoPago

## 4.4 Code Quality Indicators

| Indicador | Valor | Evaluación |
|---|---|---|
| **Supresiones `as any`** | ~434 usos | 🟡 Alto |
| **Supresiones `@ts-ignore/@ts-expect-error`** | 47 | 🟡 |
| **Supresiones `eslint-disable`** | 55 | 🟡 |
| **Total supresiones type-safety** | ~611 | 🔴 Alto |
| **TODOs/FIXMEs/HACKs/WORKAROUNDs** | 226 | 🟡 Acumulado |
| **`console.log/warn/error` en producción** | 97 | 🟡 Deberían usar logger |
| **Bloques catch vacíos** | 373 | 🔴 Silencian errores |
| **`.catch(() => {})` (swallowed promises)** | ~15 en billing | 🔴 Crítico en pagos |
| **`import type` (type-only imports)** | 580 | 🟢 Buen uso |
| **Archivos con `any`** | 889 (~66%) | 🔴 Amplio |
| **God-files (>500 LOC)** | ~15 archivos | 🟡 Deberían dividirse |

## 4.5 CI/CD Pipeline

14 workflows de GitHub Actions:

| Workflow | Propósito | Estado |
|---|---|---|
| `ci.yml` | Lint + Typecheck + Tests | 🟢 |
| `deploy.yml` | Deploy a Cloud Run | 🟢 |
| `e2e.yml` | End-to-end tests (Playwright) | 🟢 |
| `mutation.yml` | Mutation testing (Stryker) | 🟡 Limiters crash en Windows |
| `smoke.yml` | Smoke tests | 🟢 |
| `perf.yml` | Performance (size-limit + Lighthouse) | 🟢 |
| `loadtest.yml` | Load testing (Artillery) | 🟢 |
| `mobile-build-check.yml` | Verificar build mobile | 🟢 |
| `mobile-release.yml` | Release mobile (Play Store / TestFlight) | 🟢 |
| `check-mobile-signing.yml` | Verificar firmas mobile | 🟢 |
| `prepackage-slm.yml` | Pre-empaquetar modelos SLM | 🟢 |
| `firestore-backup.yml` | Backup de Firestore | 🟢 |
| `dr-dryrun.yml` | Disaster recovery dry-run | 🟢 |
| `ossar.yml` | Security scanning | 🟢 |

---

# PARTE V — ANÁLISIS DE CÓDIGO ESPECÍFICO

## 5.1 `server.ts` — El Monolito (1,542 líneas)

El entry point del backend. Contiene:
- Boot de Express + middleware (helmet, rate limit, session, cookies)
- Montaje de ~40 routers
- Lógica de billing inline (aunque ya parcialmente extraída)
- IoT rotate-secret endpoint
- Health checks
- Sentry initialization
- Vite dev middleware

**Problema:** A pesar de múltiples rounds de split (R16, R17, R18, R19), aún contiene lógica de negocio que debería estar en routers.

## 5.2 `geminiBackend.ts` — El God-File de IA (748 líneas)

Proxy central a Google Gemini/Vertex AI. Contiene:
- Inicialización del cliente GenAI
- PII redaction (ya movida a `gemini/pii.ts`)
- Parsing helpers (ya movidos a `gemini/parsing.ts`)
- Governance (ya movida a `gemini/governance.ts`)
- Embeddings (ya movidos a `gemini/embeddings.ts`)
- Re-exports para backwards compat

**Estado:** Está en proceso de split activo (§12.5.1 del plan). Los pasos 1-4 están hechos, pero el archivo sigue siendo el punto de importación principal.

## 5.3 `slmRuntime.ts` — SLM On-Device (1,083 líneas)

El runtime de modelos de lenguaje pequeños que corren en el celular del usuario:
- Registry-aware: carga modelos por ID desde un registro
- Integrity-first: SHA-256 verification antes de cargar
- WebGPU primary / WASM fallback
- Byte-level tokenizer fallback para smoke tests
- Cache en IndexedDB

**Calidad:** Bien diseñado. Documentación extensa. Problema menor: Gemma model tiene SHA-256 `null`.

## 5.4 Firestore Rules (1,829 líneas)

Reglas de seguridad de la base de datos:
- Default-deny global
- Helper functions: `isSignedIn()`, `isEmailVerified()`, `isAdmin()`, `isSupervisor()`
- Tenant-scoped supervisor check
- Reglas por colección con validación de tipos
- Comentarios detallados explicando cada decisión

**Calidad:** Excelente. Las reglas son el último bastión de seguridad — están bien pensadas.

## 5.5 `App.tsx` (565 líneas)

El componente raíz de la SPA:
- 238 páginas, la mayoría lazy-loaded
- 7 route groups (Emergency, Training, Operations, Risk, Health, Compliance, AI)
- Providers anidados (Firebase, Language, Project, Subscription, etc.)
- Error boundaries
- Code splitting agresivo (Sprint 54 redujo el cold-start chunk)

**Calidad:** Buen code splitting. Los imports lazy están bien organizados.

---

# PARTE VI — DEUDA TÉCNICA DETALLADA

## 6.1 Deuda Crítica (P0 — Atacar Inmediatamente)

### 6.1.1 Tier-Gating Solo Client-Side
**Archivo:** `src/contexts/SubscriptionContext.tsx` + rutas server
**Problema:** La verificación de si un usuario tiene acceso a features premium solo se hace en el frontend. Un request directo al backend (curl, Postman) bypass el paywall.
**Impacto:** Pérdida de ingresos — cualquiera puede usar features premium gratis.
**Esfuerzo:** 0.5 sprint
**Solución:** Agregar middleware `requireTier('premium')` en rutas protegidas.

### 6.1.2 `.catch(() => {})` en Billing — ✅ RESUELTO (PR #865)
**Archivos:** `billing/googleplay.ts`, `billing/appstore.ts`, `billing/webpay.ts`, `billing/mercadopago.ts`, `billing/khipu.ts`, `dte.ts`
**Estado:** Cerrado. Los call-sites de billing reemplazaron el `.catch(() => {})` silencioso por el patrón no-throw de dte.ts (`auditServerEvent` devuelve boolean, nunca lanza → `.then(ok => !ok && logger.error('billing_audit_write_failed', …))`); un fallo de auditoría queda registrado sin romper el pago. Ref: webpay.ts:306-307, dte.ts:461-465; confirmado en COWORK_REQUIREMENTS.md:143 y TIER-GATING-SERVER-SIDE-SPEC.md:53.
**Problema:** Promesas de auditoría y logging son silenciadas con `.catch(() => {})`. Si el logging de un pago falla, no hay registro.
**Impacto:** Pérdida de trazabilidad en pagos — un pago podría procesarse sin audit log.
**Esfuerzo:** 0.5 sprint
**Solución:** Reemplazar con `.catch(err => logger.error('billing audit failed', err))`.

### 6.1.3 Mesh Packets sin Firma
**Archivo:** `src/services/mesh/meshPacket.ts:237`
**Problema:** Los paquetes BLE mesh están marcados como `unsigned-dev` — no tienen firma criptográfica.
**Impacto:** Un atacante en la red mesh podría inyectar paquetes falsos (alertas de emergencia falsas, datos de sensor manipulados).
**Esfuerzo:** 1 sprint
**Solución:** Implementar HMAC-SHA256 con clave compartida derivada del pairing.

### 6.1.4 Gemma Model sin Hash
**Archivo:** `src/services/slm/registry.ts`
**Problema:** Los modelos Phi-3 y Qwen tienen SHA-256 hash verificado, pero Gemma tiene `expectedSha256: null`.
**Impacto:** Un modelo Gemma comprometido podría cargarse sin verificación de integridad.
**Esfuerzo:** 0.25 sprint
**Solución:** Calcular y registrar el SHA-256 del modelo Gemma publicado.

## 6.2 Deuda Alta (P1 — Próximo Sprint)

### 6.2.1 Supresiones de Type-Safety (611 total)
**Distribución:**
- `as any`: ~434 usos en archivos de producción
- `@ts-ignore` / `@ts-expect-error`: 47
- `eslint-disable`: 55
- Archivos con al menos un `any`: 889 (66% de los archivos TS/TSX)

**Los más problemáticos:**
- `dataQuality.ts:177-183`: 7 `as any` consecutivos al pasar datos a funciones
- `curriculum.ts:357,414,652`: Firestore cast como `as any`
- `billing/shared.ts:19`, `billing/appstore.ts:108`: Contexto de billing como `as any`
- `admin.ts:556,588`: Datos de Firestore sin tipar

**Impacto:** Cada `as any` es un punto ciego donde TypeScript no verifica nada. En un sistema de prevención de riesgos, un typo en un campo de datos podría pasar inadvertido.
**Esfuerzo:** 3-4 sprints para eliminar el 80%
**Solución:** Tipar progresivamente, empezando por billing y compliance.

### 6.2.2 God-Files (>500 LOC de lógica)
| Archivo | Líneas | Contenido |
|---|---|---|
| `slmRuntime.ts` | 1,083 | SLM lifecycle |
| `curriculum.ts` (route) | 1,148 | Claims + WebAuthn |
| `workPermits.ts` (route) | 1,011 | Permisos de trabajo |
| `workerReadiness.ts` (route) | 906 | Disponibilidad de trabajadores |
| `admin.ts` (route) | 881 | Admin endpoints |
| `gemini.ts` (route) | 868 | Gemini dispatch |
| `culturePulse.ts` (route) | 783 | Encuestas de cultura |
| `incidentFlow.ts` (route) | 776 | Flujo de incidentes |
| `drivingSafety.ts` (route) | 773 | Seguridad vial |
| `maintenance.ts` (route) | 768 | Mantención |
| `mercadoPagoIpn.ts` | 758 | Webhook MercadoPago |
| `geminiBackend.ts` | 748 | Gemini proxy |

**Impacto:** Archivos grandes son difíciles de testear, revisar y mantener. Cambios en un área afectan otras.
**Esfuerzo:** 2 sprints
**Solución:** Dividir por responsabilidad única (ya hay un plan activo para algunos).

### 6.2.3 373 Bloques Catch Vacíos
**Problema:** `catch {}` o `catch (e) { /* empty */ }` en ~373 puntos del código.
**Impacto:** Errores silenciados que podrían indicar fallas de seguridad, datos corruptos, o lógica rota.
**Esfuerzo:** 2 sprints
**Solución:** Al menos logging en cada catch. Para errores esperados, commentar el porqué se ignora.

### 6.2.4 97 `console.log/warn/error` en Producción
**Problema:** Deberían usar el logger centralizado (`src/utils/logger.ts`) para consistencia y filtrado.
**Esfuerzo:** 0.5 sprint
**Solución:** Find-and-replace con `logger.info/warn/error`.

## 6.3 Deuda Media (P2 — Planificación)

### 6.3.1 Sobre-Granularidad de Directorios
**Problema:** 498 directorios en `src/`, muchos con 1-2 archivos.
**Impacto:** Ruido cognitivo al navegar el codebase.
**Esfuerzo:** 1 sprint
**Solución:** Consolidar directorios con <5 archivos en sus padres.

### 6.3.2 226 TODOs/FIXMEs Acumulados
**Problema:** Decisiones técnicas pendientes que se acumulan sprint tras sprint.
**Impacto:** Deuda que crece — algunos TODOs llevan meses.
**Esfuerzo:** 2-3 sprints
**Solución:** Triage: cerrar los que ya no aplican, priorizar los críticos, crear issues para los grandes.

### 6.3.3 Dependencias Pesadas
**Problema:** 102 dependencias de producción. `googleapis` importa TODO el SDK cuando solo se necesitan sub-módulos. `firebase` importa todo el SDK del cliente.
**Impacto:** Bundle size inflado, tiempos de carga más lentos.
**Esfuerzo:** 1 sprint
**Solución:** Importaciones granulares, tree-shaking audit, posiblemente remplazar `googleapis` con llamadas HTTP directas.

### 6.3.4 Páginas sin i18n (10 restantes)
**Problema:** 10 de 238 páginas no usan `useTranslation()`. Para un producto LATAM multilingüe, esto es inconsistente.
**Esfuerzo:** 1 sprint
**Solución:** Migrar las 10 páginas restantes.

### 6.3.5 ARCHITECTURE.md Desactualizado
**Problema:** Última revisión en Round 16 (2026-04-28). El proyecto va en Round 56+.
**Impacto:** Los nuevos contributors leen documentación que no refleja la realidad.
**Esfuerzo:** 0.5 sprint
**Solución:** Actualizar con la estructura actual.

## 6.4 Deuda Baja (P3 — Mejoras)

### 6.4.1 Sin Storybook
**Problema:** 176 dominios de componentes sin documentación visual.
**Impacto:** Onboarding de contributors más lento.
**Esfuerzo:** 2 sprints

### 6.4.2 Sin Web Vitals Monitoring
**Problema:** Sentry captura errores, pero no métricas de performance del usuario (LCP, FID, CLS).
**Esfuerzo:** 0.5 sprint

### 6.4.3 Error Boundaries Inconsistentes
**Problema:** No hay evidencia de error boundaries por dominio en toda la SPA.
**Esfuerzo:** 1 sprint

### 6.4.4 Mutation Testing Limiters en 3%
**Problema:** `limiters.ts` tiene solo 3% de mutation coverage debido a un crash de Windows en Stryker.
**Impacto:** Los rate limiters no están verificados por mutation testing.
**Esfuerzo:** Ya documentado como issue de plataforma (Windows-only).

---

# PARTE VII — COSAS QUE ESTÁN BIEN

No todo es deuda. Hay muchas cosas bien hechas:

1. **Filosofía de honestidad radical:** El `TODO.md` con "Regla #1: no marcar ✅ sin file:line" es excepcional. Rara vez se ve este nivel de disciplina.

2. **Default-deny en Firestore:** La seguridad por defecto es denegar todo. Esto es el patrón correcto.

3. **10,029 tests pasando:** Un test suite de este tamaño con 0 fallos es un logro significativo.

4. **Code splitting agresivo:** El uso de `React.lazy()` en `App.tsx` está bien ejecutado. Los componentes pesados (3D, AI, PDF) solo se cargan cuando se necesitan.

5. **Procesamiento biométrico on-device:** Los frames de cámara y datos de salud nunca salen del celular. Esto es una decisión de privacidad excelente.

6. **Documentación interna extensiva:** Los comentarios en el código explican el *porqué*, no solo el *qué*. Los ADRs (Architecture Decision Records) están presentes.

7. **Multi-idioma real:** 15 idiomas soportados con i18next. No es solo español.

8. **Offline-first architecture:** El sync engine con cola cifrada para zonas sin conectividad es una feature real para el mercado objetivo (minería, faenas remotas).

9. **CI/CD completo:** 14 workflows cubren lint, typecheck, tests, mutation testing, E2E, load testing, mobile builds, y disaster recovery.

10. **Modelo de seguridad por capas:** Firebase Auth → verifyAuth middleware → Firestore rules → server-side validation. Defensa en profundidad.

11. **SLM runtime bien diseñado:** Integrity-first, registry-aware, con fallback graceful. Es un diseño profesional.

12. **Split en progreso activo:** El proyecto tiene un plan documentado para dividir los god-files y está ejecutándolo (geminiBackend.ts ya tiene 4 pasos completados).

---

# PARTE VIII — RIESGOS DEL PROYECTO

## 8.1 Riesgos Técnicos

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| **Bundle size impide carga rápida en celular** | Alta | Alto | Audit de bundle, code splitting más agresivo |
| **Supresiones `as any` esconden bugs en billing** | Media | Crítico | Tipar billing y compliance primero |
| **God-files causan regression al modificar** | Alta | Medio | Continuar split activo |
| **Dependencias pesadas agotan memoria en celular gama baja** | Media | Alto | Lazy loading de 3D/ML, pruebas en dispositivos reales |
| **Mesh sin firma permite inyección de datos** | Baja | Crítico | Implementar HMAC en paquetes |

## 8.2 Riesgos de Negocio

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| **Tier-gating bypassable** | Alta | Alto | Implementar verificación server-side |
| **~30% features son shells** | Confirmado | Medio | Priorizar wiring de features críticos |
| **Complejidad ahuyenta contributors** | Media | Medio | Mejorar documentación de arquitectura |
| **Deuda técnica acumulada ralentiza desarrollo** | Alta | Alto | Sprints dedicados a deuda técnica |

---

# PARTE IX — RECOMENDACIONES PRIORIZADAS

## Inmediato (esta semana)
1. ✅ Implementar tier-gating server-side (0.5 sprint)
2. ✅ Reemplazar `.catch(() => {})` en billing con logging real (0.5 sprint)
3. ✅ Registrar SHA-256 de Gemma model (0.25 sprint)

## Corto plazo (próximo mes)
4. Firmar mesh packets con HMAC (1 sprint)
5. Eliminar `as any` en rutas de billing y compliance (1 sprint)
6. Reemplazar `console.log` con logger centralizado (0.5 sprint)
7. Migrar 10 páginas restantes a i18n (1 sprint)

## Medio plazo (próximo trimestre)
8. Completar split de `server.ts` a <200 líneas (2 sprints)
9. Completar split de `geminiBackend.ts` (1 sprint)
10. Triangulación de TODOs/FIXMEs — cerrar obsoletos, priorizar críticos (1 sprint)
11. Audit de bundle size + optimización de dependencias pesadas (1 sprint)
12. Actualizar ARCHITECTURE.md (0.5 sprint)

## Largo plazo (próximos 6 meses)
13. Tipar el 80% de las 611 supresiones restantes (3-4 sprints)
14. Consolidar directorios con <5 archivos (1 sprint)
15. Implementar error boundaries por dominio (1 sprint)
16. Storybook para componentes (2 sprints)
17. Web Vitals monitoring (0.5 sprint)
18. Completar wiring de ~30% features que son shells (4-6 sprints)

---

# PARTE X — CONCLUSIÓN

**Guardian Praeventio es un proyecto de escala industrial ambicioso y técnicamente sólido.** Con ~620K líneas de código, 10,029 tests pasando, 15 idiomas, y cobertura de 228 dominios de servicio, es uno de los codebases de prevención de riesgos laborales más completos que existen.

**Fortalezas principales:**
- Arquitectura bien pensada con defensa en profundidad
- Filosofía de honestidad radical en el tracking de progreso
- Offline-first diseñado para el mercado real (faenas sin conectividad)
- Procesamiento biométrico on-device (privacidad por diseño)
- Test suite extensivo con 0 fallos

**Debilidades principales:**
- Supresiones de type-safety acumuladas (611)
- Tier-gating solo client-side (riesgo de negocio)
- God-files residuales del split en progreso
- ~30% de features son shells sin backing completo
- Dependencias pesadas que impactan bundle size

**Veredicto:** Un proyecto con fundamentos sólidos que está en la fase de maduración. La deuda técnica es manejable y el equipo (¿solo?) tiene un plan claro para resolverla. Los riesgos más urgentes (tier-gating, billing catches, mesh sin firma) son atacables en días, no meses.
