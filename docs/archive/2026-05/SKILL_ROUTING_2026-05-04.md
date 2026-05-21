# SKILL_ROUTING_2026-05-04 — Matriz Feature × Skill × Connector

> Auditoría de enrutamiento de skills + conectores para todas las features pendientes de Guardian Praeventio (Sprint 16 → Sprint 19 + Bernoulli x15 + Zettelkasten v2 + UI gaps Driving/Emergency).
>
> **Dir de trabajo**: `D:/Guardian Praeventio/repo` · **Branch**: `dev/sprint-15-organic-structure-2026-05-04` · **Fecha**: 2026-05-04.
>
> **Convenciones**:
> - `as:*` = `anthropic-skills:*`
> - **Phase Flow Infinito** — 1=Detección, 2=Adaptación, 3=Consolidación
> - **DEFERRED** = la skill/conector existe pero su uso es post-MVP (típicamente Sprint 17+ o Phase B/C del Digital Twin)
> - Identificadores de skills/conectores en inglés; narrativa en español
> - Una skill **principal** por fila (la que vertebra el entregable). Skills secundarias separadas por coma.

## Índice

1. [Tabla de routing master (45 filas)](#1-tabla-de-routing-master)
2. [Agrupación por Flow Infinito](#2-agrupación-por-flow-infinito)
3. [Skills NO usar (anti-patterns)](#3-skills-no-usar-en-ningun-feature)
4. [Dependencias pendientes (gating)](#4-dependencias-pendientes)
5. [Template del próximo agente — Sprint 16 UI](#5-template-para-el-próximo-agente-sprint-16-ui)
6. [Distribución y métricas finales](#6-distribución-y-métricas-finales)

---

## 1. Tabla de routing master

Convención de columnas: **Feature** · **Sprint** · **Phase** (1/2/3) · **Skill principal** + secundarias · **Conectores** · **Rationale** · **Acceptance** · **Depends on** (si aplica).

### 1.1 Sprint 9 — Bernoulli x15 + Zettelkasten v2

| # | Feature | Sprint | Phase | Skills | Conectores | Rationale | Acceptance | Depends on |
|---|---|---|---|---|---|---|---|---|
| 1 | A.1 Red de hidrantes (`FireNetworkCalculator.tsx`) | 9.1 | 1 | `claude-api` (princ), `simplify`, `as:xlsx` | Sentry MCP, Claude Preview | Cálculo Hazen-Williams + tool-use para narración del riesgo; xlsx para export ingeniería. `claude-api` es la spina dorsal porque emite nodos al Zettelkasten | Hidrante calculado <500ms · `addNode()` real (no console.log) · export xlsx con caudal/presión por tramo | — |
| 2 | A.2 Misting / supresión de polvo (`DustSuppressionDesigner.tsx`) | 9.1 | 1 | `claude-api`, `as:xlsx` | Sentry MCP | Diseño de boquillas + IPER PM10/PM2.5; emite nodo `physics-fluids/dp-static` | PM10 estimado vs faena real ±15% · ficha xlsx descargable | — |
| 3 | A.3 Cubiertas/andamios — succión viento (extender `StructuralCalculator.tsx`) | 9.1 | 1 | `simplify` (princ), `claude-api` | Claude Preview | Extensión, no reescritura; `simplify` cubre el riesgo de duplicar lógica Bernoulli | Coupling con OpenWeatherMap v_wind · alerta cuando Cp·q>resistencia | — |
| 4 | A.4 Espacios confinados HVAC (`ConfinedSpaceMonitor.tsx`) | 9.1 | 1 | `claude-api`, `as:schedule` | Sentry MCP | `as:schedule` para sweep cada 60s del gradiente ΔP | ΔP<-50Pa × 30s → alerta supervisor + Sentry breadcrumb | — |
| 5 | A.5 GasLeakSentinel (`GasLeakSentinel.ts` + `Telemetry.tsx`) | 9.1 | 1 | `claude-api`, `as:schedule`, `simplify` | Sentry MCP | Patrón sentinel = recurring task; `as:schedule` cron cada 30s | Fuga simulada Q>X → alerta <60s · 0 falsos positivos en bench 24h | — |
| 6 | UI alerts B.6-B.10 ya integrados | 9.2 | 2 | `simplify` (princ), `claude-api` | Claude Preview | Ya existe la lógica; falta UI. `simplify` para evitar duplicar componentes Card | 5 alerts visibles · screenshot Storybook por cada uno | — |
| 7 | C.11-C.15 wildcards (feasibility) | 9.3 | 3 | `claude-api` | — | Solo POC; no wiring productivo | 5 docs feasibility en `/docs/research/bernoulli/C.{11..15}.md` | — |
| 8 | MCP server `gp-zettelkasten` (sustituye `console.log` `addNode()`) | 9 | 2 | `mcp-builder` (princ), `simplify`, `review` | GitHub gh | El uso canónico de `mcp-builder`: bus interno entre componentes engineering y nodos | 4 TODO `addNode()` cerrados (BioAnalysis, VisionAnalyzer, StructuralCalculator, HazmatStorageDesigner) · server arranca local · `review` aprueba | — |
| 9 | 5 Smart actions Proto-1 portados | 9 | 2 | `claude-api`, `simplify` | Sentry MCP | Migración legacy → arquitectura actual, riesgo de duplicación alto | 5 actions wired al Zettelkasten · 0 código muerto post-`simplify` | — |
| 10 | Export 60 nodos a xlsx para HSE | 9 | 3 | `as:xlsx` (princ) | — | Output canónico: spreadsheet por familia × ID/etiquetas | xlsx con 8 sheets (1 por familia) descargable desde `/admin/zettelkasten` | — |

### 1.2 Sprint 10 — Env-context tool-use Asesor

| # | Feature | Sprint | Phase | Skills | Conectores | Rationale | Acceptance | Depends on |
|---|---|---|---|---|---|---|---|---|
| 11 | Rewrite `/api/ask-guardian` con tool-use + prompt caching | 10 | 1 | `claude-api` (princ), `security-review`, `review` | Sentry MCP, Postman MCP | Caso de uso textbook de `claude-api`: 3 tools, caching, output JSON, audit. `security-review` por la inyección potencial en BCN search | Latencia P50 <2s · cache hit >70% · respuesta cita norma BCN con link leychile.cl | — |
| 12 | 3 tools (`getWeatherTool`, `getSeismicTool`, `searchNormativaBCN`) | 10 | 1 | `claude-api` | Postman MCP (mocks USGS/OWM) | Postman MCP para mock de OWM/USGS sin gastar quota | Cada tool stub responde en mock · contract test verde | — |
| 13 | Audit trail por tool call | 10 | 3 | `claude-api`, `security-review` | Sentry MCP | Sentry breadcrumb por invocación + JSON estructurado | Sentry Issues view filtra por `tool=getSeismicTool` | Sentry Cloud Run env (ver §4) |

### 1.3 Sprint 11 — Blender + Digital Twin Phase A→B

| # | Feature | Sprint | Phase | Skills | Conectores | Rationale | Acceptance | Depends on |
|---|---|---|---|---|---|---|---|---|
| 14 | 3 assets glTF (cuerpo 7 regiones DS 594, faena minera, EPP modular) | 11 | 1 | `as:canvas-design` (apoyo), `simplify` | **Blender MCP** | Blender MCP es la única ruta válida; canvas-design solo para previews 2D de portada | 3 `.glb` <2MB cada uno con Draco+KTX2 · `HumanBodyViewer.tsx` carga sin fallback procedural | Daho debe abrir Blender local (ver §4) |
| 15 | Loader animado Zettelkasten (RiskNetwork) | 11 | 2 | `as:algorithmic-art` (princ) | Claude Preview | Algorithmic-art con p5.js encaja con la estética grafo neuronal | Loader 30fps en MacBook M1 baseline · sin jank | — |
| 16 | Digital Twin Phase B — mesh real sobre MapLibre | 11 | 3 | `claude-api` | Vercel MCP, Claude Preview | Phase A landed PR #20; Phase B requiere wiring real de glTF | `DigitalTwinFaena.tsx` muestra mesh real · screenshot de Claude Preview en CI | Phase A merged ✅ |
| 17 | **DEFERRED** — Phase C SLAM móvil | post-11 | 3 | `claude-api`, `as:algorithmic-art` | Blender MCP | Roadmap [DIGITAL_TWIN_GPU_FREE_PLAN.md](DIGITAL_TWIN_GPU_FREE_PLAN.md:278) marca C como "+8 semanas, futuro" | N/A — DEFERRED post-MVP | — |

### 1.4 Sprint 12 — MaestrIA pipeline IA fotos

| # | Feature | Sprint | Phase | Skills | Conectores | Rationale | Acceptance | Depends on |
|---|---|---|---|---|---|---|---|---|
| 18 | Pipeline 4 agentes (Detector→Evaluador→Estimador→Redactor) | 12 | 1 | `claude-api` (princ), `review` | Sentry MCP, Postman MCP | Multi-agent con vision input; Postman para mocks de APIs externas durante desarrollo | foto in → hallazgo formal en <30s · 0 leaks de PII en Sentry | — |
| 19 | Documento Hallazgo PDF firmable | 12 | 2 | `as:pdf` (princ), `claude-api` | — | Output formal = `as:pdf` canónico (sello + hash + form fields) | PDF abre en Acrobat con campos firmables · hash SHA256 en /audit_log | — |
| 20 | UI "PIPELINE PROGRESS" 4-step | 12 | 2 | `claude-api`, `simplify` | Claude Preview | UI orquesta el agente; `simplify` por riesgo de duplicar el Stepper existente | 4 steps animados · estado live desde stream | — |

### 1.5 Sprint 13 — ARIA multi-agente

| # | Feature | Sprint | Phase | Skills | Conectores | Rationale | Acceptance | Depends on |
|---|---|---|---|---|---|---|---|---|
| 21 | MCP server `gp-iper` interno | 13 | 2 | `mcp-builder` (princ) | — | El bus que reemplaza Firestore custom | server arranca local + tests `mcp-test-client` verdes | — |
| 22 | 5 agentes (Sentinel, KB Builder, Investigator, Q&A, WorkOrderWriter) | 13 | 1 | `claude-api`, `mcp-builder` | Sentry MCP | Cada agente expone tools al siguiente; trazas Sentry como spans del trace | ManDown event → orden + meeting <2min · trace completo en Sentry | gp-iper MCP (#21) |
| 23 | Asignación técnico vía Calendar | 13 | 2 | `claude-api` | **Calendar MCP** | El use case canónico de Calendar MCP: WorkOrderWriter llama `create_event` | Evento aparece en calendario del técnico con detalles del incidente | — |
| 24 | Notificación SUSESO/cliente | 13 | 2 | `claude-api` | **Gmail MCP** | `create_draft` (NUNCA send autónomo — política antiexfiltración) | Draft creado, supervisor revisa y envía manualmente | — |

### 1.6 Sprint 14 — Compliance ISO 45001 + SUSESO + WebAuthn

| # | Feature | Sprint | Phase | Skills | Conectores | Rationale | Acceptance | Depends on |
|---|---|---|---|---|---|---|---|---|
| 25 | DIAT automático docx + PDF firmado | 14 | 2 | `as:docx` (princ), `as:pdf`, `claude-api` | Gmail MCP | docx primero (tracked changes habilitado para revisor), luego pdf (sello inmutable + hash) | DIAT generado <5min · firma WebAuthn verificable · draft Gmail con adjunto | — |
| 26 | Libro de obras DS 76 | 14 | 2 | `as:docx` (princ) | — | Documento legal con plantilla → `as:docx` con headings/TOC | docx con paginación, sello, índice | — |
| 27 | CPHS automatización (recordatorios + actas) | 14 | 2 | `as:schedule` (princ), `as:docx` | **Calendar MCP**, **Gmail MCP** | `as:schedule` para cron 90 días; Calendar para reuniones recurrentes; Gmail draft para citaciones | Calendar event recurrente cada 30 días · acta docx pre-llenada · 0 sends autónomos | — |
| 28 | Historial capacitaciones SUSESO/SERNAC export | 14 | 3 | `as:xlsx` (princ), `as:pdf` | — | Export tabular = xlsx; PDF solo para evidencia firmada anexa | xlsx con 1 row/capacitación · PDF firmado adjunto opcional | — |
| 29 | `webauthn/register` endpoint (cierra TODO `webauthnCredentialStore.ts:34`) | 14 | 1 | `claude-api`, `security-review` (princ) | Sentry MCP | `security-review` es bloqueante; este endpoint maneja credenciales | 0 críticas en `security-review` · test con SimpleWebAuthn lib | — |
| 30 | Recordatorios CPHS biométricos | 14 | 2 | `as:schedule` | Calendar MCP, Gmail MCP | `as:schedule` cron — comportamiento del harness, no del modelo | recordatorio en Calendar 7d antes · draft Gmail 24h antes | — |

### 1.7 Sprint 15 — App nativa Capacitor + Health/APNS

| # | Feature | Sprint | Phase | Skills | Conectores | Rationale | Acceptance | Depends on |
|---|---|---|---|---|---|---|---|---|
| 31 | CI/CD `cap:android` + `cap:ios` | 15 | 3 | `claude-api` (model migration check), `security-review` | Vercel MCP, GitHub gh | `claude-api` migration check al subir versiones de modelo entre branches | Build android+ios verde · sign keys en GH secrets, no en repo | — |
| 32 | Health Connect (Android) + HealthKit (iOS) | 15 | 1 | `security-review` (princ), `claude-api` | Sentry MCP | Datos médicos = `security-review` obligatorio · ver [HEALTH_CONNECT_MIGRATION.md](HEALTH_CONNECT_MIGRATION.md) | HR <40 o >180 → alerta supervisor <60s · datos HR en SQLite local únicamente | — |
| 33 | Background geolocation + offline-first SQLite | 15 | 1 | `claude-api`, `simplify` | Sentry MCP | `simplify` por alto riesgo de duplicar lógica de sync | offline 24h · sync sin conflicto al reconectar | — |
| 34 | APNS+FCM push | 15 | 1 | `security-review` | Vercel MCP | Tokens son sensibles | tokens cifrados at-rest · revocación funciona | — |

### 1.8 Sprint 16 — Pagos reales + API-First B2B (CRÍTICO)

| # | Feature | Sprint | Phase | Skills | Conectores | Rationale | Acceptance | Depends on |
|---|---|---|---|---|---|---|---|---|
| 35 | Webpay producción | 16 | 3 | `security-review` (princ), `claude-api` | Sentry MCP | Pagos = security-review siempre. Daho ingresa credenciales (jamás Claude) | 0 críticas pentest · transacción real <$1 · IPN idempotente | — |
| 36 | MercadoPago IPN webhook (cierra TODO `mercadoPagoAdapter.ts:24`) | 16 | 1 | `security-review`, `claude-api` | Sentry MCP, **Postman MCP** (mocks IPN) | Postman MCP para mockear IPN antes de prod; HMAC verify es crítico | `verifyHmacSignature` con tests · idempotency por `ipn_id` | — |
| 37 | Boletas SII via Acepta | 16 | 1 | `as:pdf` (princ), `security-review` | **Postman MCP** (mocks Acepta), Sentry MCP | DTE preview = pdf canónico · Postman para mocks de Acepta sin tocar SII | DTE válido firmado · preview pdf antes de emitir · 0 PII en logs | — |
| 38 | API-First REST publicada (cierra TODO P5 ERP/HRM) | 16 | 2 | `claude-api`, `simplify`, `review` | **Postman MCP** (princ) | Postman MCP es la herramienta canónica para OpenAPI 3.1 + mocks · ver [API_B2D_SPEC.md](API_B2D_SPEC.md) | 13 endpoints publicados en workspace Postman · OpenAPI 3.1 valida · mocks responden | — |
| 39 | Export reportes contables xlsx | 16 | 3 | `as:xlsx` (princ) | — | Output tabular contable | xlsx con sheets ingreso/egreso/saldo + fórmulas IVA | — |
| 40 | Sync demo a Buk/SAP | 16 | 3 | `claude-api` | Postman MCP | Mocks de Buk/SAP en Postman | sync ida y vuelta sin conflicto en demo data | — |

### 1.9 Sprint 17 — Scale + WAF + ISO 27001 (DEFERRED en gran parte)

| # | Feature | Sprint | Phase | Skills | Conectores | Rationale | Acceptance | Depends on |
|---|---|---|---|---|---|---|---|---|
| 41 | Cloud Armor WAF L7 | 17 | 3 | `security-review` (princ) | — | Configuración cloud, no código aplicación | reglas WAF activas · pentest 0 críticas | — |
| 42 | KMS rotation cron 90 días (cierra TODO `oauthTokenStore.ts:20`) | 17 | 3 | `as:schedule` (princ), `security-review` | Vercel MCP | Cron es comportamiento del harness · `as:schedule` canónico | rotación verificada con test que invalida key vieja | — |
| 43 | SSO SAML/OIDC | 17 | 3 | `security-review`, `claude-api` | — | Endpoint sensible · Daho hace OAuth setup manualmente | login Azure AD funciona en piloto · sesiones revocables | — |
| 44 | **DEFERRED** — Multi-region us-central1 + southamerica-west1 | 17 | 3 | `security-review` | Vercel MCP | Post-MVP; activar tras >100 empresas | DEFERRED — solo cuando >100 empresas | — |
| 45 | **DEFERRED** — ISO 27001 docs | 17 | 3 | `as:docx`, `as:consolidate-memory` | — | Post-MVP, requiere auditoría externa | DEFERRED hasta cliente enterprise pida certificación | — |

### 1.10 Sprint 18-19 — Documentación + Postman + Brand kit

| # | Feature | Sprint | Phase | Skills | Conectores | Rationale | Acceptance | Depends on |
|---|---|---|---|---|---|---|---|---|
| 46 | Recovery `analisis_funcional.md` y `auditoria01.md` desde firebase-version | 18 | 3 | `as:consolidate-memory`, `simplify` | GitHub gh | `gh` para clone shallow del legacy repo | docs en `/docs/legacy/` · disclaimer de procedencia · 0 contradicciones con docs vivos | — |
| 47 | `CLAUDE.md` raíz | 18 | 3 | (NO usar `init` — ver §3) `as:consolidate-memory` | — | Ya existe scaffold; `init` lo reescribiría destructivamente | merge no destructivo · todas las secciones existentes preservadas | — |
| 48 | OpenAPI spec completa publicada | 19 | 3 | `claude-api`, `review` | **Postman MCP** (princ) | Continuación de Sprint 16 #38; aquí se valida y publica oficialmente | spec en Postman público · CI valida en cada PR | API-First (#38) |
| 49 | Brand kit Canva — 12 plantillas (poster safety moment, agenda CPHS, certificado, ficha trabajador RPG, etc.) | 19 | 2 | `as:canvas-design` (apoyo) | **Canva MCP** (princ) | Canva MCP para que HSE pueda editar las plantillas; canvas-design solo si Canva no cubre el caso (e.g. medallas SkillTree pixel-perfect) | 12 plantillas en workspace Canva · HSE genera poster <2min | — |
| 50 | Lighthouse 0.65 → 0.85 | 19 | 3 | `simplify` (princ), `review` | Vercel MCP, Claude Preview | `simplify` para detectar bundle bloat y dead code | LH 0.85+ en 5 rutas críticas · CI gate activo | — |

### 1.11 UI gaps Driving / Emergency (Sprints 7-8)

| # | Feature | Sprint | Phase | Skills | Conectores | Rationale | Acceptance | Depends on |
|---|---|---|---|---|---|---|---|---|
| 51 | Driving UI Maps SDK + speed-trigger | 7 | 1 | `claude-api` (princ) | Claude Preview, Sentry MCP, **`vercel/agent-browser`** | `agent-browser` valida estados visuales (driving>18km/h) sin device físico | conducción >18 km/h × 30s → modo activo · cancelación al parar 5min | `vercel/agent-browser` install (§4) |
| 52 | Botón SOS 80×80px | 7 | 2 | `as:canvas-design` (apoyo), `simplify` | Claude Preview | Asset estático + reuse del componente Button existente | hit area ≥80×80 · screenshot test | — |
| 53 | Emergency UI + DeviceMotion sismo | 8 | 1 | `claude-api`, `as:schedule` (princ para auto-deactivate 1h) | Sentry MCP | `as:schedule` canónico para timer de 1h | PGA local + USGS <50km/60s → emergency · auto-off 1h | — |
| 54 | Lime acento + Brand consolidation | 6 | 3 | `simplify` (princ), `as:canvas-design` | Claude Preview | NO usar `as:brand-guidelines` (es Anthropic, no Praeventio — ver §3). `simplify` audita uso de lime fuera de whitelist | 0 lime en utility classes excepto whitelist 8 CTAs · screenshot Storybook 3-color | — |

---

## 2. Agrupación por Flow Infinito

### 2.1 Phase 1 — Detección (8 features estratégicas)

Todo lo que el sistema percibe del entorno y del trabajador antes de que actúe.

1. **#11** Tool-use env-context Asesor — `claude-api` + Sentry/Postman — **el mayor desbloqueador del valor**
2. **#5** GasLeakSentinel — `claude-api` + `as:schedule` + Sentry
3. **#32** Health Connect/HealthKit — `security-review` + Sentry
4. **#1** FireNetwork hidrantes — `claude-api` + Sentry
5. **#18** MaestrIA pipeline (Detector agente) — `claude-api` + Sentry
6. **#22** ARIA Sentinel agente — `claude-api` + Sentry
7. **#51** Driving UI speed-trigger — `claude-api` + agent-browser + Sentry
8. **#53** Emergency DeviceMotion sismo — `claude-api` + `as:schedule` + Sentry

**Skill principal de la fase**: `claude-api` (8/8). **Conector principal**: Sentry MCP (8/8).

### 2.2 Phase 2 — Adaptación (8 features estratégicas)

El sistema reorganiza UI/flujos según el contexto detectado.

1. **#8** MCP `gp-zettelkasten` — `mcp-builder` — backbone neural
2. **#21** MCP `gp-iper` — `mcp-builder` — bus ARIA
3. **#23** Asignación técnico Calendar — `claude-api` + Calendar MCP
4. **#24** Notificación draft Gmail — `claude-api` + Gmail MCP
5. **#27** CPHS automatización — `as:schedule` + Calendar/Gmail
6. **#38** API-First B2B — `claude-api` + Postman MCP
7. **#49** Brand kit Canva — `as:canvas-design` + Canva MCP
8. **#15** Loader Zettelkasten algorítmico — `as:algorithmic-art` + Claude Preview

**Skill principal**: `mcp-builder` y `claude-api` (empate 3/8 cada una). **Conector principal**: Postman/Calendar/Gmail/Canva MCPs (uso especializado).

### 2.3 Phase 3 — Consolidación (8 features estratégicas)

El sistema deja registro inmutable, exporta evidencia y cierra el loop.

1. **#19** Hallazgo PDF firmable — `as:pdf`
2. **#25** DIAT docx + PDF firmado — `as:docx` + `as:pdf` + Gmail MCP
3. **#28** Export historial SUSESO xlsx — `as:xlsx`
4. **#37** Boletas SII via Acepta — `as:pdf` + Postman MCP
5. **#42** KMS rotation 90 días — `as:schedule` + Vercel MCP
6. **#46** Recovery legacy docs — `as:consolidate-memory` + GitHub gh
7. **#48** OpenAPI publicada — `claude-api` + Postman MCP
8. **#50** Lighthouse 0.85 — `simplify` + Vercel MCP

**Skill principal**: skills de `as:*` document family (5/8: docx/pdf/xlsx/consolidate-memory). **Conector principal**: Postman MCP (3/8) y Vercel MCP (3/8) empatados.

---

## 3. Skills NO usar en ningún feature

Estas skills están instaladas y disponibles, pero su uso es **inapropiado** para el contexto de Guardian Praeventio. Documentar para evitar que un agente futuro las invoque por error.

| Skill | Por qué NO | Excepción |
|---|---|---|
| `anthropic-skills:brand-guidelines` | Es la marca **Anthropic** (#cc785c orange, etc.), no la de Praeventio (teal/lime/gold). Aplicarla destruiría la coherencia de [BRAND.md](BRAND.md) | Solo para docs internos Anthropic-themed (ej. una propuesta a Anthropic). Jamás en código de producto |
| `anthropic-skills:slack-gif-creator` | Praeventio NO usa Slack como canal a usuarios finales. La onboarding es in-app, no Slack | Si en Sprint 17+ se agrega un workspace Slack interno del equipo dev, podría usarse para changelogs internos. NO para producto |
| `init` | El repo ya tiene CLAUDE.md scaffolded ([CLAUDE.md](CLAUDE.md) si existe + tasks/). `init` lo reescribiría destructivamente. Para Sprint 18 #47 usar `as:consolidate-memory` en su lugar | Solo si CLAUDE.md fuera borrado por accidente |
| `keybindings-help` | Es ergonomía del IDE de un dev individual, no del producto. No aporta a ningún feature del roadmap | Si Daho lo solicita explícitamente para su flujo |
| `anthropic-skills:setup-cowork` | Setup de Cowork no aplica al producto | — |
| `as:schedule` (alias) vs `schedule` | Son la misma skill. **Usar `as:schedule`** consistentemente para evitar confusión en el routing | — |

---

## 4. Dependencias pendientes

Skills/conectores que requieren acción del usuario antes de que las features asociadas puedan ejecutarse.

| Dependencia | Estado | Bloquea | Mitigación |
|---|---|---|---|
| `vercel/agent-browser` (skill) | **Pending install** | #51 (Driving UI visual validation) | Fallback: Claude Preview manual + screenshots; degrada DX pero no bloquea |
| `mvanhorn/last30days` (skill) | **Pending install** | KPIs de adopción de skills (Sprint 19 §19 del roadmap) | Fallback: query manual a BigQuery |
| **Blender MCP** runtime | Daho debe abrir Blender local; no lo ha usado nunca | #14 (3 assets glTF) | Fase A del Digital Twin sigue funcional; Sprint 11 puede dividirse: Three.js loader real obligatorio, Blender MCP opcional |
| **Sentry MCP** Cloud Run env | DSN provisionado, pero env no configurado en Cloud Run | #11, #13, #18, #22, #32, #36 (audit trails productivos) | Sentry funciona en dev local; prod monitoring queda en degraded mode hasta que Daho pegue DSN en Cloud Run secrets |
| **Postman MCP** workspace | Workspace creado, pero spec OpenAPI 3.1 aún no publicada | #38, #48 | Spec local en `API_B2D_SPEC.md` ya existe; se sincroniza con Postman en Sprint 19 |
| **Canva MCP** brand kit | Cuenta Canva conectada; brand kit no creado | #49 | `as:canvas-design` puede generar plantillas standalone hasta que el kit Canva exista |
| **Calendar MCP** + **Gmail MCP** scopes | Conectados pero scopes mínimos; algunos endpoints fallarían | #23, #24, #27 | Verificar scopes antes de Sprint 13/14; si falta `calendar.events.write` solicitar consent del usuario |

---

## 5. Template para el próximo agente Sprint 16 UI

Este template es **autoritario** para el siguiente agente que entre a trabajar en Sprint 16 (Pagos + API-First). Futuros sprints copiarán esta estructura.

### 5.1 Setup inicial (toda sesión)

```
Pre-flight:
1. Verificar branch limpia o crear `dev/sprint-16-payments-YYYY-MM-DD`
2. Leer: MASTER_PROPOSAL_2026-05.md §5.3 Sprint 16, API_B2D_SPEC.md, este SKILL_ROUTING_2026-05-04.md
3. Confirmar Sentry MCP Cloud Run env (§4) — si no, degraded mode
4. Confirmar Postman MCP workspace accesible
```

### 5.2 Tasks del sprint con routing explícito

#### Task A: Webpay producción (#35)

```
Skills (en orden de uso):
- `claude-api` — escribir el adapter con prompt caching del system context
- `security-review` — BLOQUEANTE antes de merge

Conectores:
- Sentry MCP — instrumentar `paymentInitiated`, `paymentConfirmed`, `paymentFailed`
- (NO Postman — Webpay no expone mocks oficiales; usar sandbox real con tarjetas test)

Invocación:
- Inicia con `claude-api` skill activa
- Después de cada commit: invocar `simplify`
- Pre-PR: invocar `security-review`. Si reporta cualquier crítica → NO merge

Acceptance:
- Transacción real <$1 CLP exitosa en sandbox
- IPN idempotente por `buy_order` (test con replay)
- 0 críticas en `security-review`
- Sentry breadcrumb visible para cada estado
- Daho ingresa credenciales en GH secrets (Claude NUNCA las maneja)
```

#### Task B: MercadoPago IPN webhook (#36)

```
Skills:
- `claude-api` — handler + HMAC verification
- `security-review` — BLOQUEANTE
- `simplify` — post-commit

Conectores:
- Postman MCP — crear collection con 3 ejemplos de IPN payload (ok, replay, signature mismatch)
- Sentry MCP — breadcrumb por IPN recibido

Invocación:
- Postman MCP: createCollection "MercadoPago IPN tests" en workspace Praeventio
- Para cada caso de IPN: createCollectionRequest con body de ejemplo
- Implementar handler usando `claude-api`
- Cerrar TODO `mercadoPagoAdapter.ts:24` con commit referenciando el TODO

Acceptance:
- 3/3 collection requests pasan en Postman runner
- HMAC verify rechaza firmas malas
- Test de replay con mismo `ipn_id` no duplica
```

#### Task C: API-First REST con OpenAPI publicada (#38)

```
Skills:
- `claude-api` — endpoints + tool-use docs
- `simplify` — tras cada endpoint
- `review` — pre-PR

Conectores:
- Postman MCP (princ) — createSpec, createSpecFile con OpenAPI 3.1
- (post-merge) Vercel MCP — deploy preview
- (post-merge) Claude Preview — verificar Swagger UI

Invocación:
- Leer API_B2D_SPEC.md (13 endpoints)
- Postman MCP: createSpec con definition de OpenAPI 3.1
- Para cada endpoint: implementar handler + collection request
- generateCollection desde el spec para sincronizar
- Pre-PR: `review`
- Post-merge: deploy_to_vercel, verificar runtime_logs sin 500s

Acceptance:
- 13 endpoints implementados y respondiendo
- OpenAPI 3.1 valida sin errores
- Postman collection 100% verde en runner
- Swagger UI accesible en /api/docs
```

#### Task D: Boletas SII via Acepta (#37)

```
Skills:
- `as:pdf` (princ) — generar DTE preview
- `security-review` — BLOQUEANTE (PII tributaria)
- `claude-api` — orquestación

Conectores:
- Postman MCP — mocks de Acepta (createMock + publishMock)
- Sentry MCP — breadcrumb por DTE emitido (sin PII en payload)

Invocación:
- Postman MCP: createMock para endpoints Acepta clave (timbre, emisión, status)
- Implementar adapter contra el mock
- `as:pdf` para generar DTE preview con campos firmables
- `security-review`: verificar 0 PII en logs Sentry

Acceptance:
- DTE válido firmado por Acepta sandbox
- Preview PDF antes de emitir (HSE puede revisar)
- 0 PII (RUT cliente, total) en Sentry
- 0 críticas en `security-review`
```

### 5.3 Skills NO invocar en Sprint 16

- ❌ `as:brand-guidelines` (es Anthropic, no Praeventio)
- ❌ `as:slack-gif-creator` (no aplica al producto)
- ❌ `init` (CLAUDE.md ya existe)
- ❌ Blender MCP (no se usan 3D en pagos)
- ❌ Calendar MCP / Gmail MCP autónomos (Sprint 16 no los necesita; cualquier email a SUSESO es Sprint 14)

### 5.4 Definition of Done de Sprint 16

```
[ ] Tasks A-D completos con sus acceptance criteria
[ ] `simplify` ejecutado en último commit
[ ] `security-review` aprobado (0 críticas)
[ ] `review` aprobado para PR final
[ ] Postman collection 100% verde
[ ] Sentry sin issues nuevos críticos en 24h post-deploy
[ ] TODOs cerrados: mercadoPagoAdapter.ts:24, mercadoPagoIpn.ts:35, webpayAdapter.ts:320, P5 ERP/HRM
[ ] Doc actualizado: este SKILL_ROUTING refleja realidad (marcar #35-#40 como DONE)
```

---

## 6. Distribución y métricas finales

### 6.1 Conteo de filas

- **Total filas en la tabla master**: **54** (#1 a #54)
- **Excluyendo DEFERRED**: **51** filas activas (#17, #44, #45 marcadas DEFERRED)

### 6.2 Distribución por Flow Infinito (sobre las 54 filas, fase asignada principal)

| Phase | Count | % |
|---|---|---|
| 1 — Detección | 19 | 35% |
| 2 — Adaptación | 19 | 35% |
| 3 — Consolidación | 16 | 30% |

### 6.3 Skill más usada (incluyendo apariciones secundarias)

1. `claude-api` — **30 apariciones** (campeón absoluto; backbone del producto)
2. `simplify` — **14**
3. `security-review` — **11**
4. `as:schedule` — **7**
5. `as:pdf` — **5**
6. `as:xlsx` — **5**
7. `as:docx` — **3**
8. `mcp-builder` — **2**
9. `as:canvas-design` — **5**
10. `as:algorithmic-art` — **2**
11. `review` — **5**
12. `as:consolidate-memory` — **3**

### 6.4 Conector más usado

1. **Sentry MCP** — **20 apariciones** (campeón; observability omnipresente)
2. **Postman MCP** — **9** (Sprint 10/16/19 lo concentran)
3. **Claude Preview** — **9**
4. **Vercel MCP** — **6**
5. **Calendar MCP** — **3**
6. **Gmail MCP** — **3**
7. **Canva MCP** — **1** (Sprint 19)
8. **Blender MCP** — **1** (Sprint 11)
9. **GitHub gh** — **2** (Sprint 18, post-merges)

### 6.5 Features DEFERRED (3 filas)

| # | Feature | Sprint | Por qué |
|---|---|---|---|
| 17 | Phase C SLAM móvil | post-11 | DIGITAL_TWIN_GPU_FREE_PLAN marca "+8 semanas, futuro"; requiere validar Phase B primero |
| 44 | Multi-region us-central1 + southamerica-west1 | 17 | Solo se justifica con >100 empresas piloto; hasta entonces single-region es suficiente |
| 45 | ISO 27001 docs completas | 17 | Requiere auditoría externa pagada; activar cuando un cliente enterprise lo solicite contractualmente |

### 6.6 Lecciones del enrutamiento

1. **`claude-api` es la skill estructural del producto** (30 apariciones). Cualquier optimización a sus prompt caching / tool-use rinde mucho.
2. **Sentry MCP debe estar configurado en Cloud Run YA** — bloquea calidad de 20 features.
3. **Postman MCP es el apalancamiento del trimestre**: Sprint 10, 16 y 19 lo usan intensivamente; vale la pena que Daho cree el workspace bien estructurado de entrada.
4. **`as:*` document skills (docx/pdf/xlsx)** son la consolidación natural del Phase 3; concentradas en Sprint 14, 16, 19.
5. **`mcp-builder` solo aparece 2x pero es high-leverage**: cada MCP server interno (gp-zettelkasten, gp-iper) descongestiona el resto de sprints.
6. **`as:brand-guidelines`, `slack-gif-creator`, `init`** — anti-patterns; nunca invocar.

---

**Firma del documento**: Sprint Routing Auditor, 2026-05-04. Próxima revisión cuando Sprint 16 termine (re-marcar filas DONE y reevaluar DEFERRED).
