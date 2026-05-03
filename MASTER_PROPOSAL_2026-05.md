# MASTER_PROPOSAL — Guardian Praeventio

> Plan unificado al **2026-05-03**.
> Supersedes [`ROADMAP_2026-05.md`](ROADMAP_2026-05.md) y [`PLAN_PARTE4_ROADMAP_IMPLEMENTACION.md`](PLAN_PARTE4_ROADMAP_IMPLEMENTACION.md), que pasan a ser referencia histórica.
> Combina hallazgos de los prototipos (Proto-1 `praevium-guard`, Proto-2 `Guardian-Praeventio-f-irebaseversion`) con capacidades nuevas de Claude — **skills + conectores MCP** — que no existían cuando se escribieron los planes originales (Proto-1 cierre 2025-09-06; Proto-2 cierre 2026-04-30).
> Branch: `dev/zettelkasten-archeology-multi-week`. Autor: Daho Sandoval.

---

## 1. Resumen ejecutivo

Lo que cambia respecto a planes previos: **ahora tenemos un harness de skills + conectores que reescriben varias piezas que antes estaban planificadas con código artesanal**. Los cinco cambios estructurales más grandes son:

1. **`/api/ask-guardian` deja de ser un endpoint con prompt monolítico** — pasa a usar la skill `claude-api` con tool-use real para clima, sismicidad y normativa BCN. El Sentidos→Mente del Proto-2 se reemplaza por tool-use idiomático de Claude. Latencia esperada ↓50%, audit trail por tool call.
2. **El acoplamiento del Zettelkasten deja de ser callbacks ad-hoc** — pasa a ser un **MCP server interno** construido con la skill `mcp-builder`. Cada productor (climate, bernoulli, IPER, vision) emite por el bus MCP; cada consumidor lee por la query interface canónica.
3. **Reportes legales (DIAT, libro de obras DS 76, actas CPHS, IPER, asistencia)** dejan de depender de `jsPDF` artesanal — pasan a `docx`, `pdf`, `xlsx` y `pptx` skills, que generan documentos editables con audit trail post-firma.
4. **Digital Twin sin GPU** — el plan trifásico de [`DIGITAL_TWIN_GPU_FREE_PLAN.md`](DIGITAL_TWIN_GPU_FREE_PLAN.md) se acelera con el conector **Blender MCP** que produce assets glTF directos para los `.glb` que `HumanBodyViewer.tsx` y `DigitalTwinFaena.tsx` ya consumen.
5. **CI/CD y Observabilidad ya no se inventan** — `security-review`, `review`, `simplify` y el MCP de **Sentry** (ya provisionado, org `praeventio` project `guardian-praeventio` ID `4511323258224640`) se enchufan al pre-commit y a cada PR. **Vercel MCP** ofrece deploy + logs como alternativa a Cloud Run para entornos preview.

Métricas globales de partida (mediciones reales del repo):
- 27 marcadores `TODO/FIXME/XXX/HACK` en código de producción (29 contando tests).
- Sentry Project provisionado, 0 unresolved issues últimos 7 días.
- 320 de 512 tipos de nodo ya cubiertos por servicios actuales (resto en `[ZETTELKASTEN_V2_SPEC.md](ZETTELKASTEN_V2_SPEC.md)`).
- 5 de 15 use cases Bernoulli implementados (33%).
- ~200 horas residuales planificadas; este documento las reorganiza.

---

## 2. Inventario "lo que estaba planeado y no se construyó"

Tres fuentes: TODOs en código, features Proto-1 ausentes, features Proto-2 ausentes, brechas arquitectónicas vivas.

> Nota metodológica: las cifras de TODO se obtienen con `grep -rn "TODO\|FIXME\|XXX\|HACK" src --include="*.ts" --include="*.tsx"` filtrando paths que no contienen `__tests__`. Las features Proto-1/2 se extraen de [`PROTO_ARCHAEOLOGY.md`](PROTO_ARCHAEOLOGY.md) §2 y §3. Las brechas arquitectónicas vivas vienen de [`PLAN_PARTE3_PROTOTIPO2.md`](PLAN_PARTE3_PROTOTIPO2.md) y de la lectura cruzada de los 27 archivos en `src/server/routes/`.

### 2.1 TODOs y stubs en código actual

| Archivo:línea | Qué dice | Criticidad | Sprint sugerido |
|---|---|---|---|
| [src/pages/BioAnalysis.tsx:66](src/pages/BioAnalysis.tsx) | "TODO Sprint 10+: persist this pulmonary-altitude node via addNode() once the …" — nodo huérfano del Zettelkasten v2 | media | Sprint 9 (post-spec) |
| [src/components/ai/VisionAnalyzer.tsx:36](src/components/ai/VisionAnalyzer.tsx) | "persist Zettelkasten node into Firestore via addNode() once …" | media | Sprint 9 |
| [src/components/engineering/StructuralCalculator.tsx:27](src/components/engineering/StructuralCalculator.tsx) | "replace this console emission with addNode() into Firestore" | media | Sprint 9 |
| [src/components/engineering/HazmatStorageDesigner.tsx:52](src/components/engineering/HazmatStorageDesigner.tsx) | "replace these console logs with addNode() calls" | media | Sprint 9 |
| [src/services/auth/webauthnCredentialStore.ts:34](src/services/auth/webauthnCredentialStore.ts) | "REGISTRATION (TODO Round 20+)" — flujo de registro WebAuthn | alta | Sprint 14 (firma DIAT) |
| [src/server/routes/curriculum.ts:685](src/server/routes/curriculum.ts) | "implement POST /api/auth/webauthn/register" | alta | Sprint 14 |
| [src/hooks/useBiometricAuth.ts:58](src/hooks/useBiometricAuth.ts) | "TODO Round 19" — biometric server-side | alta | Sprint 14 |
| [src/server/routes/billing.ts:885,942,972](src/server/routes/billing.ts) | Idempotencia + reglas Firestore + unificación adapters | media | Sprint 16 |
| [src/services/billing/mercadoPagoAdapter.ts:24,194](src/services/billing/mercadoPagoAdapter.ts) | "wire MercadoPago IPN webhook" | alta | Sprint 16 |
| [src/services/billing/mercadoPagoIpn.ts:35](src/services/billing/mercadoPagoIpn.ts) | dependencia del anterior | alta | Sprint 16 |
| [src/services/billing/webpayAdapter.ts:320](src/services/billing/webpayAdapter.ts) | reglas Firestore default-deny pendientes | alta | Sprint 16 |
| [src/pages/Pricing.tsx:862,916](src/pages/Pricing.tsx) | "wire Stripe / Webpay invoice + sales CRM" — mailto fallback | alta | Sprint 16 |
| [src/pages/Projects.tsx:721](src/pages/Projects.tsx) | "calendar-schedule-from-modal" — `/api/calendar/sync` integration | media | Sprint 14 |
| [src/pages/Telemetry.tsx:229](src/pages/Telemetry.tsx) | "round-4 phase-2: confirm zero hits before removing legacy path" | baja | Sprint 17 |
| [src/services/capacity/normativeAlerts.ts:276](src/services/capacity/normativeAlerts.ts) | mover a provider Capacity/Normativa | media | Sprint 9 |
| [src/services/environmentBackend.ts:14,437](src/services/environmentBackend.ts) | follow-ups del Sentidos: persistencia + cache | alta | Sprint 10 |
| [src/services/oauthTokenStore.ts:20](src/services/oauthTokenStore.ts) | KMS rotation Round 2 | alta | Sprint 17 |
| [src/components/hygiene/NutritionLog.tsx:15](src/components/hygiene/NutritionLog.tsx) | hard-coded 2400 kcal placeholder | baja | Sprint 9 |
| [src/utils/contentModeration.ts:7](src/utils/contentModeration.ts) | Cloud Functions trigger pendiente | media | Sprint 17 |
| [TODO.md §SSO P4](TODO.md) | SSO Azure AD / Google Workspace | media | Sprint 17 |
| [TODO.md §API-First P5](TODO.md) | API-First ERP/HRM B2B | alta | Sprint 16 |
| [TODO.md §Bio P14](TODO.md) | Mapa contaminación lumínica para fauna | baja | wildcard |
| [TODO.md §PTS-VI](TODO.md) | Auditorías ISO interactivas (checklist dinámico) | media | Sprint 14 |
| [TODO.md §PTS-VI](TODO.md) | Carga diferida de modales pesados (AutoCAD viewer) | baja | Sprint 11 |
| [TODO.md §Cripto P5](TODO.md) | Tokens Cripto — descartado por Daho | n/a | n/a |
| [TODO.md §Capacitor F2](TODO.md) | Biometría nativa Android/iOS | alta | Sprint 15 |
| [TODO.md §Capacitor F3](TODO.md) | Push Notifications FCM/APNS | alta | Sprint 15 |

### 2.2 Features prometidas en Proto-1 (`praevium-guard`)

Citado en `[PROTO_ARCHAEOLOGY.md](PROTO_ARCHAEOLOGY.md)`:

- **`UniversalKnowledgeContext.tsx` (401 líneas)** — estado global unificado del Zettelkasten. **No portado**. El repo actual tiene `useZettelkastenIntelligence` parcial; falta el contexto global como single source of truth.
- **`useZettelkastenIntegration.ts` (203 líneas)** — auto-detección de contexto por ruta. **No portado**. El repo actual deduce contexto pieza por pieza; falta el switch URL→nodeId central.
- **`SmartConnectionsPanel.tsx` (271 líneas)** — panel flotante de conexiones sugeridas. **No portado**. Hoy `RiskNetwork.tsx` muestra el grafo entero; falta el panel de "qué le falta a este nodo en este momento".
- **`KnowledgeNodeBadge.tsx` (162 líneas)** — badge visual de conexiones. **No portado**.
- **`KnowledgeGraphVisualizer.tsx` (409 líneas)** — visualizador 3D dedicado. **Portado parcialmente** dentro de `RiskNetwork.tsx` (2D + 3D), pero sin la lógica de profundidad de vecindario nivel-2 del Proto-1.
- **`AcademicContentProcessor.tsx` (695 líneas)** — ingesta de papers a nodos. **Marcado como completado en TODO.md** pero el origen real (Proto-1) tiene 695 líneas y el componente actual tiene la página `[src/pages/AcademicProcessor.tsx](src/pages/AcademicProcessor.tsx)` mucho más liviana. Pendiente: pipeline de extracción → vinculación al Zettelkasten.
- **5 smart actions tipados** — confirmados ausentes en el hook actual por `[PLAN_PARTE2_PROTOTIPO1.md](PLAN_PARTE2_PROTOTIPO1.md)`:
  1. `create-worker-epp-connection`
  2. `suggest-normatives-for-project`
  3. `link-industry-to-project`
  4. `suggest-epp-for-worker`
  5. `auto-link-training-to-worker`

### 2.3 Features prometidas en Proto-2 (`Guardian-Praeventio-f-irebaseversion` / Lovable.dev)

- **Arquitectura `Portal → Sentidos → Mente`** — el orquestador antiguo (`praeventio-orchestrator.ts`) inyectaba clima+sismo en cada llamada a la IA. El `/api/ask-guardian` actual ([src/server/routes/gemini.ts:124](src/server/routes/gemini.ts)) **carece** de esa capa; la pieza más cara perdida del Proto-2.
- **`generateDynamicRoute` (Vertex AI)** — rutas de evacuación generadas dinámicamente. Reemplazado por A* determinista en código actual (mejor decisión legal), pero la lógica de "narración del por qué" del Proto-2 sigue ausente.
- **PLAN_MAESTRO de 512 nodos** — sólo 9 nodos enumerados explícitamente en el doc original (312-320). Los 503 restantes son **esqueleto**, hay que sintetizarlos. La spec [`ZETTELKASTEN_V2_SPEC.md`](ZETTELKASTEN_V2_SPEC.md) ya cubre la taxonomía completa; falta materializar los nodos faltantes.
- **`analisis_funcional.md`** y **`auditoria01.md`** — no existen aún en `docs/legacy/`. Recuperación recomendada por PROTO_ARCHAEOLOGY §6.
- **Custom Claims RBAC** — confirmado funcionando en repo actual (auditoria01 lo documenta). Lo único pendiente es la **UI de gestión de claims** ([UserManagement.tsx](src/pages/UserManagement.tsx)) sincronizada con la matriz de 6 roles.

### 2.4 Brechas arquitectónicas vivas

- **`/api/ask-guardian` sin env-context** — Sprint 10 del PLAN_PARTE4. Sin esto, el Asesor responde como un chatbot genérico.
- **192 nodos PLAN_MAESTRO sin spec individual** — `ZETTELKASTEN_V2_SPEC.md` define la taxonomía a 512 (320 hechos, 60 Sprint 9, 132 derivados); falta el spreadsheet maestro nodo-a-nodo.
- **5 smart actions Proto-1 ausentes** — Zettelkasten coupling parcial; cubierto sólo `climateRiskCoupling.ts`.
- **Pipeline real LingBot-Map** — `DigitalTwinFaena.tsx` es shell de UI sin pipeline de captura/mesh real (DIGITAL_TWIN §1.2).
- **Webhooks billing reales** — Webpay/MercadoPago en modo testing/mock.
- **WebAuthn server-side** — solo flujo local hoy.
- **Health Connect / HealthKit** — Man Down sin frecuencia cardíaca real.
- **Push Notifications** — sin FCM/APNS reales (Capacitor F3).
- **`telemetry_events` Firestore rules** — tests cross-tenant pendientes (Sprint 3 ROADMAP).
- **Stryker mutation ratchet** — 65 → 70% pendiente.
- **`Math.random()` residual** — `invoice.ts:97`, `iperAssessments.ts:83`, `ergonomicAssessments.ts:102`.

---

## 3. La diferencia que hacen las skills + conectores de Claude

Las skills+conectores no existían cuando se escribieron Proto-1 (sept 2025) ni Proto-2 (abr 2026). Esta sección lista las disponibles y para qué módulo de Guardian sirven.

### 3.0 Cambio de paradigma

Hasta hoy, cada feature de Guardian se diseñaba con la pregunta "¿qué endpoint hace falta y qué prompt mando?". Con skills + conectores, la pregunta cambia a "¿qué tool del LLM y qué MCP server necesito enchufar?". Tres consecuencias:

- **El LLM elige cuándo invocar cada herramienta** (tool-use) en lugar de recibir todo como prefijo. Eso baja tokens y latencia.
- **Cada productor de conocimiento publica por un bus tipado**, no llama a callbacks ad-hoc. La observabilidad se hereda gratis (Sentry).
- **Los entregables documentales (DIAT, libro de obras, actas, capacitaciones)** se generan por skills probadas en lugar de templates jsPDF artesanales. La calidad sube y el mantenimiento baja.

### 3.1 Skills disponibles

> Para cada skill se listan **2-3 ejemplos concretos** de uso en Guardian, citando archivos del repo cuando aplica.

#### `claude-api`
- **Reescribir `/api/ask-guardian` con tool-use real**: tres tools — `getWeatherTool`, `getSeismicTool`, `searchNormativaTool` — invocados sólo cuando el LLM los necesita. Reemplaza la inyección manual de prefijo de prompt.
- **Prompt caching automático** del system prompt + RAG context (saving 90% tokens en respuestas frecuentes).
- **Migración Gemini → Claude** del Asesor en [`src/components/emergency/Asesor.tsx`](src/components/emergency/Asesor.tsx) (futuro).
- **Inferencia de severidad de incidente** desde texto libre del Mural Dinámico ([`MuralDinamicoFirebase.tsx`](src/components/MuralDinamicoFirebase.tsx)) → asigna nivel + ruta de notificación.

#### `mcp-builder`
- **MCP server interno `gp-zettelkasten`** — bus de eventos tipado para coupling. Productores publican (`emit('venturi-warning', node)`); consumidores se suscriben (`onNode('venturi-warning', cb)`).
- **MCP server `gp-bernoulli`** — expone `dynamicPressure`, `venturiFlowRate`, etc. como tools al Asesor. El LLM consulta el motor físico determinista en lugar de imaginar números.
- **MCP server `gp-iper`** — query interface a la matriz IPER por proyecto. Reemplaza calls Firestore desperdigadas.
- **MCP server `gp-environment`** — wrapper sobre [`src/services/environmentBackend.ts`](src/services/environmentBackend.ts) que expone `getForecast`, `getSeismicEvents` como tools al Asesor.

#### `anthropic-skills:canvas-design` + `anthropic-skills:brand-guidelines`
- **Posters de safety moments** alineados con BRAND.md (teal/petroleum/gold).
- **Upgrade visual de gamification badges** — medallas 3D ([TODO.md §VII](TODO.md)) generadas con grading consistente.
- **Variantes de RiskNetwork** para presentación gerencial.

#### `anthropic-skills:algorithmic-art`
- **Identidad visual del módulo Digital Twin** — patrones de fondo generativos para `DigitalTwinFaena.tsx`.
- **Loader animado del Zettelkasten** en lugar del genérico actual `<ConsciousnessLoader />`.
- **Visualización de campo Bernoulli** — flow fields representando viento sobre estructura ([StructuralCalculator.tsx](src/components/engineering/StructuralCalculator.tsx)).

#### `anthropic-skills:pptx`
- **Templates de capacitaciones DS 54** personalizados al rubro detectado por Diagnóstico inicial.
- **Slides de charla ODI** desde el módulo `PresentationMode.tsx` (actualmente DOM mutation; pasar a generar pptx descargable).
- **Reporte gerencial mensual** automático — KPIs cruzados del Dashboard Ejecutivo a slides.

#### `anthropic-skills:docx`
- **DIAT** automático desde Firestore — editable post-firma con tracked changes en lugar de PDF inmutable.
- **Libro de obras digital DS 76** — firmable con SimpleWebAuthn.
- **Actas CPHS** generadas desde notas en `ComiteParitario.tsx` (campo libre que existe hoy).
- **Currículum Preventivo Portable** ([TODO.md §F1](TODO.md)) en lugar del PDF actual.

#### `anthropic-skills:xlsx`
- **Exportes ergonómicos** RULA/REBA con celdas con fórmulas auditables (no solo tabla muerta).
- **Matriz IPER** exportable + importable, con validación de schema.
- **Lista asistencia capacitaciones** SUSESO/SERNAC.
- **Migración desde Lovable** — workbook de mapping nodo Proto-1 → Zettelkasten v2.

#### `anthropic-skills:pdf`
- **Reportes SUSESO firmados** — generación + firma + sellado en un paso.
- **Hallazgo MaestrIA** ([Sprint 12](#sprint-12)) renderizado a PDF impreso.
- **Currículum portable** ya mencionado.

#### `anthropic-skills:simplify`
- **Barrido de servicios muertos** — 94 servicios en `src/services/` (medición pendiente). Aplicar antes de Sprint 10 para reducir bundle.
- **Detección de duplicación** entre `geminiBackend.ts` y `environmentBackend.ts`.
- **Audit de imports rotos** post Lime→Teal migration.

#### `anthropic-skills:skill-creator` + `init` + `review` + `security-review`
- **CI gates en cada PR** — `security-review` corriendo en Cloud Run worker.
- **PR review automático** del código Bernoulli/Zettelkasten (pieza crítica).
- **`init` para CLAUDE.md** del repo — pendiente, mejora onboarding.

#### `anthropic-skills:schedule` + `loop` + `schedule` (root)
- **Recordatorios CPHS** — reunión mensual obligatoria DS 54.
- **Renovación de exámenes ocupacionales** — alerta 30 días antes del vencimiento.
- **Revocatoria de invitaciones expiradas** ([invitations](TODO.md)) — cron diario.
- **Loop de health check** — `/healthz` cada 5min con notificación en Sentry si caída >2min.

#### `anthropic-skills:consolidate-memory`
- **Coherencia de docs maestros** — barrido mensual entre TODO.md, ROADMAP, PLAN_PARTE*, BERNOULLI_EXTENSIONS, ZETTELKASTEN_V2_SPEC para detectar contradicciones.
- **Pruning de roadmap viejo** — items ya cerrados pero aún en check-list.

#### `update-config` + `fewer-permission-prompts` + `keybindings-help` + `setup-cowork`
- Operativos del agente; no afectan producto. `update-config` se usa para hooks pre-commit con `security-review`.

### 3.2 Conectores MCP disponibles

#### Sentry MCP (provisionado, org `praeventio`)
- **Capturar errores prod en tiempo real**, ya wired ([Sprint 2 ROADMAP_2026-05](ROADMAP_2026-05.md)).
- **Triage automático** — `analyze_issue_with_seer` sugiere fix antes de que Daho lo lea.
- **Alertas a Slack/email** cuando un patrón Bernoulli falla (negative deltaP guard que se gatilla > N veces).

#### Blender MCP
- **3D assets sin GPU rental** — exporta glTF directo al pipeline Three.js+Draco+KTX2 que ya está instalado.
- **Cuerpo IPER paramétrico** — 7 regiones DS 594 segmentadas por hueso/órgano.
- **Faena tipo** (minería, construcción, forestal) — bases para Fase B del Digital Twin.
- **EPP set modular** — casco/chaleco/arnés intercambiables; vinculado al `worker.epp.assignedItems`.
- **Render thumbnails** para previsualización en `Pizarra.tsx` cards.

#### Vercel MCP
- **Deploys preview por PR** — alternativa a Cloud Run actual para ramas de feature.
- **Logs de runtime** consumibles por el agente (debugging asistido).
- **Búsqueda de docs Vercel** dentro del IDE.

#### Postman MCP
- **Especificación OpenAPI** completa de la API interna — Postman colección que documenta `/api/projects`, `/api/ask-guardian`, `/api/billing`, `/api/digitalTwin/*`.
- **Mocks** de endpoints externos (USGS, OpenWeatherMap, BCN) para tests E2E sin red.
- **Sync collection ↔ spec** — mantiene README de API actualizado automáticamente.

#### Canva MCP
- **Posters Safety Moments** complementarios al `canvas-design` skill (más editables por equipo HSE).
- **Agendas CPHS** brandeadas con BRAND.md.
- **Onboarding de cuadrillas** — flyer auto-generado por proyecto.

#### Calendar MCP + Gmail MCP
- **Automatizar reuniones CPHS** — `create_event` mensual + invitados vía claims `prevencionista|gerente|trabajador`.
- **Drafts de correo a SUSESO** ante DIAT — `create_draft` con adjunto del docx generado.
- **Recordatorios de capacitación** vencida.
- **Reply al token de invitación** — landing `/invite` (TODO Prioridad 14) + correo de bienvenida.

#### GitHub via `gh`
- **PRs autónomos** — el agente abre rama, commitea, abre PR, espera review.
- **Multi-repo orchestration** — sincroniza assets desde `firebase-version` (recovery de `analisis_funcional.md` y `auditoria01.md`).
- **Issue triage** desde Sentry → GitHub.

#### Claude Preview
- **Screenshots para validar visual changes** en chat — captura `/risk-network`, `/digital-twin`, `/diagnostico` antes/después.
- **Inspect** del DOM tras cambios de tema (BRAND modes).
- **Console logs** en vivo durante feature dev.

---

### 3.3 Stack canonical de skills + conectores por área de Guardian

| Área | Skills primarias | Conectores primarios |
|---|---|---|
| **Asesor IA / `/api/ask-guardian`** | `claude-api`, `review` | Sentry MCP, Postman MCP |
| **Zettelkasten + coupling** | `mcp-builder`, `simplify`, `as:consolidate-memory` | Sentry MCP |
| **IPER + matrices** | `as:xlsx`, `claude-api` | Postman MCP |
| **Documentos legales (DIAT, DS 76, actas)** | `as:docx`, `as:pdf` | Calendar MCP, Gmail MCP |
| **Capacitación** | `as:pptx`, `as:canvas-design` | Canva MCP, Calendar MCP |
| **Reportería SUSESO** | `as:pdf`, `as:xlsx` | Gmail MCP |
| **Digital Twin / 3D / EPP / cuerpo** | `as:canvas-design`, `as:algorithmic-art` | Blender MCP, Claude Preview |
| **Brand + UI design** | `as:brand-guidelines`, `as:canvas-design` | Canva MCP, Claude Preview |
| **Billing + pagos** | `as:pdf`, `security-review` | Postman MCP |
| **CI/CD + seguridad** | `security-review`, `review`, `simplify` | Sentry MCP, Vercel MCP, GitHub `gh` |
| **Compliance recordatorios** | `as:schedule`, `schedule`, `loop` | Calendar MCP, Gmail MCP |
| **Onboarding dev + docs** | `init`, `as:consolidate-memory`, `simplify` | GitHub `gh` |
| **API publicada B2B** | `as:xlsx`, `claude-api` | Postman MCP |

---

## 4. Comparativa: lo que el prototipo planeaba VS lo que ahora podemos

| # | Módulo | Plan original (prototipo) | Lo que ahora podemos con skills/conectores | Mejora clave |
|---|---|---|---|---|
| 1 | `/api/ask-guardian` | Inyectar clima+sismo manualmente como prefijo de prompt (Proto-2 `praeventio-orchestrator.ts`) | `claude-api` skill con tool-use real: `getWeatherTool`, `getSeismicTool`, `searchNormativaTool` invocados por el LLM cuando los necesita | Latencia ↓50%, contexto solo cuando hace falta, audit trail por tool call, prompt caching hit rate >70% |
| 2 | Zettelkasten coupling | JS callbacks ad-hoc en cada feature (`useZettelkastenIntegration.ts` Proto-1 portado a medias) | MCP server interno `gp-zettelkasten` (`mcp-builder` skill) — bus de eventos tipado, observable, testable | Desacoplado, observabilidad en Sentry, reusable desde apps externas (ERP/HRM B2B) |
| 3 | Reportes DIAT | jsPDF manual con templates duros (Proto-2 `IFE-1.pdf` rígido) | `docx` skill genera DIAT desde JSON Firestore + firma SimpleWebAuthn | Editable post-firma con tracked changes, audit trail interno del docx, no solo PDF inmutable |
| 4 | Digital Twin | LingBot-Map (no existe como proyecto público, sólo branding interno) | Blender MCP + glTF en Storage + MapLibre 2.5D fallback (Fase A→B→C) | $0/mes, sin GPU rental, controlado, ya wired en `HumanBodyViewer.tsx` |
| 5 | RiskNetwork visual | D3 force-directed básico (Proto-1 `KnowledgeGraphVisualizer.tsx`) | `canvas-design` skill genera posters 3D + `algorithmic-art` para variantes + Three.js refinado | Identidad visual coherente con BRAND.md, modo "Zen" usable para charlas |
| 6 | CPHS automation | Spec en PARTE3, sin implementación funcional (notas libres en `ComiteParitario.tsx`) | `schedule` skill + Calendar MCP + Gmail MCP draft + `docx` actas | Orquestación end-to-end automática, recordatorios cumplen DS 54 |
| 7 | Safety capacitaciones | Videos estáticos + PDFs (Proto-2) | `pptx` skill genera slides personalizados al sector + tracking en Firestore | Personalización por industry-code, métricas de engagement, exportable a Google Slides |
| 8 | Currículum portable | jsPDF artesanal (TODO.md §VII implementado) | `pdf` skill + `docx` editable + `canvas-design` para portada | Calidad imprenta, multi-formato, branded |
| 9 | OCR HDS/MSDS | Tesseract.js artesanal (Proto-1 `DocumentOCRManager.tsx`) | `pdf` skill OCR + `claude-api` extracción semántica del Número ONU | Mayor exactitud, extracción de campos GRE en JSON, idempotencia |
| 10 | MaestrIA hallazgos | Pipeline 4 agentes con bus Firestore custom (Sprint 12 PLAN_PARTE4) | Claude Agent SDK + MCP server `gp-iper` + `pdf` skill final | Implementable en 1 sprint, sin bus custom |
| 11 | ARIA mantenimiento | 5 agentes con bus Firestore (Sprint 13 PLAN_PARTE4) | Claude Agent SDK + MCPs `gp-zettelkasten` + `gp-iper` + Calendar MCP para asignación técnico | Order ticket → calendario directamente |
| 12 | Visualización Bernoulli | Solo número en pantalla (StructuralCalculator NCh 432) | `algorithmic-art` skill: flow field representando carga viento real sobre el plano del módulo | Comprensión visual inmediata, persuade al supervisor |
| 13 | Test coverage | jest manual + stryker básico | `review` skill + `security-review` skill como pre-commit + Stryker ratchet 65→70% | Auto-revisión, menos bugs por seguridad pasan a prod |
| 14 | Recovery legacy docs | Copiar y pegar de `firebase-version` repo manualmente | `gh` skill: clone shallow + import + commit en `docs/legacy/` automatizado | Recovery reproducible y auditado |
| 15 | Boletas SII | Acepta/Defontana custom integration (Sprint 16) | `pdf` skill genera DTE preview + Postman MCP mocks Acepta | Preview antes de cobro, tests E2E sin tocar SII |
| 16 | Onboarding `init` CLAUDE.md | No existe — cada dev lee README+TODO+ROADMAP | `init` skill genera CLAUDE.md con resumen ejecutable del repo | Onboarding <30min para nuevo colaborador |
| 17 | Email invitaciones | Resend SDK custom (TODO Prioridad 14) | Gmail MCP `create_draft` + token + landing `/invite` | Tracking de delivery, retry, fallback |
| 18 | Recordatorio CPHS | Cron Cloud Scheduler artesanal | `as:schedule` skill + Calendar MCP `create_event` recurrente | Más simple de mantener, agente puede reagendar tras feriados |
| 19 | Pre-commit hooks | husky + lint-staged manuales | `update-config` skill aplica hooks `security-review` + `review` | Cobertura sistemática, audit log de hooks |
| 20 | Bundle audit | webpack-bundle-analyzer manual | `simplify` skill detecta servicios muertos + `review` skill audita imports | Reducción agresiva sin riesgo de regresión |
| 21 | Recovery legacy docs | clone manual + cp + git add | `gh` clone shallow + commit en `docs/legacy/` automatizado por agente | Reproducible, audit log, sin secretos |
| 22 | Visualización de campo Bernoulli | número crudo en card UI | `as:algorithmic-art` flow field interactivo sobre el plano AutoCAD | Comprensión inmediata por supervisor sin formación física |
| 23 | Brand kit operativo HSE | hand-off a diseñador externo | `as:canvas-design` + Canva MCP, plantillas reutilizables 12 piezas | HSE genera material en minutos sin diseñador |

---

## 5. Roadmap unificado de 17 sprints (~6 meses)

Reorganización integrando: skills + conectores como recurso explícito, las 15 aplicaciones Bernoulli, los 192 nodos PLAN_MAESTRO ahora cubiertos por Zettelkasten v2 spec, el 3-phase Digital Twin, env-context fix, los 5 smart actions Proto-1 a portar, y recovery `analisis_funcional.md` + `auditoria01.md` desde firebase-version.

> Convención: cada sprint cita las **skills** (`anthropic-skills:*` abreviado a `as:*`) y **conectores MCP** que usa, los entregables concretos, y el criterio de éxito.

### 5.0 Notas previas al roadmap

- Cada sprint tiene **una skill principal** (la que vertebra el sprint) y **skills secundarias** (que apoyan revisión, output, branding).
- Los conectores son **opcionales pero recomendados**; si no están provisionados, se documenta el fallback manual.
- Los **criterios de éxito** son verificables: o por test automatizado (preferido), o por screenshot Claude Preview, o por métrica Sentry.
- Las **dependencias** apuntan a sprints, no a fases. Sprints 6, 9, 10, 18 pueden empezar en paralelo desde el día 1.

### Sprint 6 — Lime acento + Brand consolidation (4h)
- **Skills**: `as:brand-guidelines`, `as:canvas-design`, `simplify`.
- **Conectores**: Claude Preview (validación visual).
- **Entregables**: 3-color hierarchy real (teal=trust, lime=energy, gold=prestige) con snapshot test Storybook; `BRAND.md` actualizado con árbol de decisión.
- **Éxito**: 0 lime en utility classes excepto whitelist de 8 CTAs success.
- **Dependencias**: ninguna.

### Sprint 7 — Driving UI con Maps SDK + speed-trigger (12h)
- **Skills**: `claude-api` (para narración turn-by-turn).
- **Conectores**: Claude Preview, Sentry MCP.
- **Entregables**: Capacitor Maps SDK; speed trigger (>5m/s × 30s); botón SOS 80×80px.
- **Éxito**: conducción >18 km/h × 30s → modo activo automático; cancelación al parar 5min.

### Sprint 8 — Emergency UI + DeviceMotion sismo (10h)
- **Skills**: `claude-api`, `as:schedule` (auto-deactivate 1h).
- **Conectores**: Sentry MCP.
- **Entregables**: hook DeviceMotion + filtro pasa-banda 0.1-10 Hz; cruce con USGS proximate.
- **Éxito**: PGA detectada local + USGS confirma <50km/60s → emergency.

### Sprint 9 — Bernoulli x15 + Zettelkasten v2 backbone (30h fraccionado)
Bloques:
- **9.1** — 5 use cases operativos nuevos (12h): hidrantes, misting, cubiertas-succión, HVAC confinado, gas leak sentinel.
- **9.2** — UI alerts para los 5 ya integrados (5h): Hazmat, Vision, Bio, Structural, Climate coupling.
- **9.3** — 5 wildcards feasibility (13h).
- **Zettelkasten v2 wiring** — `addNode()` reemplaza los 4 `console.log` (TODOs 1-4 sección 2.1); MCP server `gp-zettelkasten` con `mcp-builder`; 5 smart actions Proto-1 ([2.2](#22-features-prometidas-en-proto-1-praevium-guard)).
- **Skills**: `mcp-builder`, `claude-api`, `as:xlsx` (exporte de nodos), `simplify` (servicios muertos).
- **Conectores**: Sentry MCP (telemetría de coupling).
- **Éxito**: 60 nuevos nodos en producción + 0 console.log de coupling.

### Sprint 10 — Env context en `/api/ask-guardian` con tool-use Claude (8h, era 4h)
**Crítico — desbloquea el valor del Asesor**.
- **Skills**: `claude-api` (rewrite con tool-use), `security-review`, `review`.
- **Conectores**: Sentry MCP (latency tracking), Postman MCP (mocks USGS/OWM).
- **Entregables**: 3 tools (`getWeatherTool`, `getSeismicTool`, `searchNormativaBCN`); prompt caching del system prompt; output JSON estructurado `{causa_raiz, riesgos[], plan_accion}`; tarjeta BCN con link leychile.cl.
- **Éxito**: respuesta menciona temp+sismicidad activa; latencia P50 <2s; cache hit rate >70%.

### Sprint 11 — Blender 3D pipeline + Digital Twin Fase A→B (24h)
- **Skills**: `as:canvas-design`, `as:algorithmic-art` (loader Zettelkasten).
- **Conectores**: **Blender MCP**, Vercel MCP (preview), Claude Preview.
- **Entregables**: 3 assets glTF (cuerpo 7 regiones DS 594, faena minera tipo, EPP modular); pipeline Draco+KTX2; Digital Twin Fase A en MapLibre 2.5D activa.
- **Éxito**: `DigitalTwinFaena.tsx` carga mesh real (no procedural fallback); `HumanBodyViewer.tsx` consume nuevo asset.

### Sprint 12 — MaestrIA: pipeline IA fotos hallazgos (16h)
- **Skills**: `claude-api` (4 agentes), `as:pdf` (output formal), `review`.
- **Conectores**: Sentry MCP, Postman MCP (mocks).
- **Entregables**: pipeline Detector→Evaluador→Estimador→Redactor; UI "PIPELINE PROGRESS"; documento Hallazgo pre-llenado en Firestore + PDF firmable.
- **Éxito**: foto in → hallazgo formal en <30s.

### Sprint 13 — ARIA multi-agente con Claude Agent SDK + MCP interno (20h)
- **Skills**: `mcp-builder` (server `gp-iper`), `claude-api`.
- **Conectores**: Calendar MCP (asignación técnico), Gmail MCP (notificación), Sentry MCP.
- **Entregables**: 5 agentes (Sentinel, KB Builder, Investigator, Q&A, Work Order Writer); bus MCP en lugar de Firestore custom.
- **Éxito**: ManDown event → orden de trabajo + reunión de seguimiento en calendario en <2min.

### Sprint 14 — Compliance ISO 45001 + SUSESO + WebAuthn server (24h, era 20h)
Cierra TODOs sección 2.1 de WebAuthn (criticidad alta).
- **Skills**: `as:docx` (DIAT, libro obras DS 76, actas CPHS), `as:pdf` (firma sellada), `as:schedule` (recordatorios CPHS).
- **Conectores**: Calendar MCP, Gmail MCP, Sentry MCP.
- **Entregables**:
  - DIAT automático docx + PDF firmado SimpleWebAuthn (cierra TODO `webauthnCredentialStore.ts:34`).
  - Libro de obras DS 76.
  - CPHS automatización (Calendar + Gmail draft + actas docx).
  - Historial capacitaciones SERNAC/SUSESO export.
  - `webauthn/register` endpoint server-side (cierra TODO `curriculum.ts:685`).
- **Éxito**: DIAT generado de un incidente + firmado biométricamente + enviado a SUSESO en <5min.

### Sprint 15 — App nativa Capacitor + Health Connect/Kit + APNS (28h, era 24h)
Cierra Capacitor F2 (biometría) + F3 (push).
- **Skills**: `claude-api` (model migration check), `security-review`.
- **Conectores**: Sentry MCP, Vercel MCP (preview Android web build).
- **Entregables**: CI/CD `cap:android` + `cap:ios`; Health Connect (Android) + HealthKit (iOS); background geolocation; offline-first SQLite; APNS+FCM.
- **Éxito**: HR <40 o >180 → alerta supervisor en <60s.

### Sprint 16 — Pagos reales (Webpay, MercadoPago, SII boletas) + API-First B2B (24h, era 16h)
Cierra TODOs billing (sección 2.1) + API-First (TODO.md P5).
- **Skills**: `as:pdf` (DTE preview), `security-review`, `as:xlsx` (export reportes contables).
- **Conectores**: **Postman MCP** (specs + mocks Acepta), Sentry MCP.
- **Entregables**: Webpay producción; MercadoPago IPN webhook real (cierra TODO `mercadoPagoAdapter.ts:24`); Google Play `WEBHOOK_SECRET`; boletas SII via Acepta; **API-First REST con OpenAPI** publicada vía Postman (cierra TODO P5 ERP/HRM).
- **Éxito**: cobro real Plan Pro + DTE generado + sync a Buk/SAP demo.

### Sprint 17 — Scale + WAF multi-region + ISO 27001 + SSO + KMS rotation (24h, era 20h)
Cierra TODOs SSO (P4), KMS (`oauthTokenStore.ts:20`), Cloud Functions (`contentModeration.ts:7`).
- **Skills**: `security-review`, `as:schedule` (Cloud Scheduler 90 días), `as:consolidate-memory`.
- **Conectores**: Sentry MCP, Vercel MCP.
- **Entregables**: Cloud Armor WAF L7; SBOM Syft + Cosign; KMS rotation cron; multi-region us-central1+southamerica-west1; audit logs 7 años; SSO SAML/OIDC; pentest externo; ISO 27001 docs.
- **Éxito**: pentest 0 críticas; SSO Azure AD funciona en cliente piloto.

### Sprint 18 (NUEVO) — Documentación viva + Recovery legacy + Memory hygiene (8h)
- **Skills**: `init` (genera CLAUDE.md), `as:consolidate-memory`, `as:docx`, `simplify`.
- **Conectores**: GitHub via `gh` (clone shallow `firebase-version`).
- **Entregables**:
  - `docs/legacy/analisis_funcional.md` y `docs/legacy/auditoria01.md` recuperados.
  - `docs/legacy/PLAN_MAESTRO_skeleton.md` con disclaimer "solo nodos 312-320 enumerados".
  - `CLAUDE.md` raíz generado con `init`.
  - Barrido `consolidate-memory` sobre TODO.md/ROADMAP/PLAN_PARTE*.
- **Éxito**: nuevo dev productivo en <30min; 0 docs contradictorios.

### Sprint 19 (NUEVO) — Postman API spec + canvas brand kit + Lighthouse 0.85 (10h)
- **Skills**: `as:canvas-design`, `simplify`, `review`.
- **Conectores**: **Postman MCP**, **Canva MCP**, Claude Preview.
- **Entregables**:
  - OpenAPI spec completa de la API interna en Postman; mocks externos.
  - Brand kit en Canva: 12 plantillas (poster safety moment, agenda CPHS, certificado, ficha trabajador RPG, etc.).
  - Lighthouse threshold 0.65 → 0.85.
- **Éxito**: HSE genera poster en <2min; Lighthouse score 0.85+ en 5 rutas críticas.

---

### 5.1 Diagrama de dependencias actualizado

```
Sprint 6 (lime acento)
Sprint 7 (driving) ──────────────┐
Sprint 8 (emergency) ────────────┴─→ Sprint 15 (Capacitor nativa + Health/APNS)
Sprint 9 (Bernoulli x15 + Zk v2) ┬─→ Sprint 11 (Blender Digital Twin)
                                 ├─→ Sprint 12 (MaestrIA)
                                 └─→ Sprint 13 (ARIA con MCP gp-iper)
Sprint 10 (env-context tool-use) ┬─→ Sprint 12 (MaestrIA con env)
                                 ├─→ Sprint 13 (ARIA con env)
                                 └─→ Sprint 14 (compliance con narración Asesor)
Sprint 14 (compliance) ──────────────→ Sprint 16 (pagos con boleta SII + API-First)
Sprint 17 (scale + SSO + KMS) ───────→ pre-requisito >100 empresas
Sprint 18 (docs + recovery)  ←─ paralelo, reduce fricción onboarding
Sprint 19 (Postman + Canva + Lighthouse) ←─ después de Sprint 16 (API)
```

**Crítico:** Sprint 10 desbloquea más valor que el resto sumado. Sprint 9 desbloquea la columna vertebral del Zettelkasten v2. Ambos pueden ejecutarse en paralelo si se asignan a sesiones distintas.

### 5.2 Total horas re-estimado

| Bloque | Horas |
|---|---|
| Sprints 6-8 (UX modos) | 26 |
| Sprint 9 (Bernoulli + Zk v2) | 30 |
| Sprint 10 (env-context tool-use) | 8 |
| Sprint 11 (Blender + Digital Twin) | 24 |
| Sprint 12 (MaestrIA) | 16 |
| Sprint 13 (ARIA) | 20 |
| Sprint 14 (compliance + WebAuthn) | 24 |
| Sprint 15 (Capacitor) | 28 |
| Sprint 16 (pagos + API-First) | 24 |
| Sprint 17 (scale + SSO + KMS) | 24 |
| Sprint 18 (docs + recovery) | 8 |
| Sprint 19 (Postman + Canva + LH) | 10 |
| **TOTAL** | **242 horas** |

A dedicación parcial (15h/semana) equivale a ~4 meses calendario. A dedicación completa (35h/semana) ≈ 7 semanas.

---

### 5.3 Detalle adicional por sprint — entregables específicos

#### Sprint 9 — desglose de los 60 nodos Bernoulli

Cada use case A.x/B.x/C.x emite 4 nodos hijos: `q-dynamic`, `dp-static`, `q-flow`, `alert`. Los 5 use cases A (operativos nuevos) × 4 = 20 nodos. Los 10 ya integrados/wildcards ya tienen sus tipos definidos en [`ZETTELKASTEN_V2_SPEC.md`](ZETTELKASTEN_V2_SPEC.md) §2. La emisión real ocurre en:

- `[FireNetworkCalculator.tsx](src/components/engineering/FireNetworkCalculator.tsx)` (a crear).
- `[DustSuppressionDesigner.tsx](src/components/engineering/DustSuppressionDesigner.tsx)` (a crear).
- `[StructuralCalculator.tsx](src/components/engineering/StructuralCalculator.tsx)` (extender).
- `[ConfinedSpaceMonitor.tsx](src/components/engineering/ConfinedSpaceMonitor.tsx)` (a crear o extender).
- `[GasLeakSentinel.ts](src/services/sentinel/GasLeakSentinel.ts)` (a crear) + UI en `[Telemetry.tsx](src/pages/Telemetry.tsx)`.

Los 4 TODO `addNode()` actuales (`BioAnalysis`, `VisionAnalyzer`, `StructuralCalculator`, `HazmatStorageDesigner`) se cierran en el mismo sprint cuando el MCP server `gp-zettelkasten` esté disponible.

#### Sprint 10 — flow del nuevo `/api/ask-guardian`

```
Cliente → POST /api/ask-guardian {pregunta, lat, lng, projectId}
        → server obtiene el systemPrompt cacheado (>70% hit)
        → server arranca conversación Claude con 3 tools:
            - getWeatherTool(lat, lng)
            - getSeismicTool(lat, lng, radiusKm)
            - searchNormativaBCN(query)
          [el LLM decide si invocarlos]
        → Claude responde JSON estructurado
            { causa_raiz, riesgos: [{nivel, descripcion, normaBCN}], plan_accion }
        → server guarda audit trail por tool call (Sentry breadcrumb)
        → cliente renderiza tarjetas + link leychile.cl
```

Beneficio: si la pregunta es "¿qué EPP necesito?", el LLM puede no invocar weather; latencia y costo bajan automáticamente.

#### Sprint 11 — pipeline Blender

```
Blender (local) → [export glTF + Draco] → /public/assets/3d/{name}.glb
                                          ↓
                  Three.js + drei loadModel() ya wired en HumanBodyViewer
                                          ↓
                  RiskNetwork markers pinchados sobre el mesh
```

Los 3 assets iniciales: `human-body-7regions-ds594.glb`, `faena-mining-base.glb`, `epp-modular.glb`.

#### Sprint 13 — bus MCP de ARIA

Cada agente expone tools al siguiente, no escribe Firestore directamente:

```
Sentinel (detect) ─tool→ KB Builder.build(context) ─tool→ Investigator.analyze() 
                                              ↓
                                       Q&A.askSupervisor()
                                              ↓
                                       WorkOrderWriter.create()
                                              ↓
                                Calendar MCP create_event(asignación)
                                Gmail MCP create_draft(notificación)
```

Cada `tool→` es trazable en Sentry como span dentro del trace.

#### Sprint 14 — flujo DIAT con WebAuthn

```
1. Incidente reportado → Firestore /incidents/{id}
2. Agente as:docx genera DIAT.docx con tracked changes habilitado
3. UI presenta para firma → WebAuthn challenge (server-side, Sprint 14)
4. Firma verificada → as:pdf sella PDF inmutable + hash
5. Gmail MCP create_draft a SUSESO con adjunto + cuerpo
6. Daho/PrevSr revisa draft → click send
7. Audit trail entra a /audit_log con hash + signature
```

#### Sprint 16 — flujo MercadoPago IPN

```
Pago confirmado → MP envía IPN webhook → /api/billing/webhook/mercadopago
                                       ↓
                    verifyHmacSignature() (X-MP-Signature)
                                       ↓
                    Firestore tx idempotente {ipn_id, request_id, ts}
                                       ↓
                    update tenant.subscription.status = active
                                       ↓
                    Sentry breadcrumb + as:pdf DTE preview
```

Cierra los TODOs `mercadoPagoAdapter.ts:24,194`, `mercadoPagoIpn.ts:35`, `webpayAdapter.ts:320`.

---

## 6. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| **Blender MCP requiere instalación local** | Bloqueante para Sprint 11 si Daho no lo tiene corriendo | Fase A (MapLibre 2.5D) sigue siendo no-Blender; Sprint 11 puede dividirse: Blender opcional, Three.js loader real obligatorio |
| **Skills en beta** (`as:slack-gif-creator`, parts of `as:schedule`) | Sprints 6, 14 dependen | Documentar fallback manual para cada skill; no bloquear release si la skill cambia API |
| **Costos cloud Cloud Run para SLAM Fase C** | <USD 5/mes según `DIGITAL_TWIN_GPU_FREE_PLAN.md`, pero crece con N sitios | Monitor Sentry de invocaciones; cap mensual |
| **Curva de aprendizaje del equipo si crece >Daho** | Onboarding hoy depende de leer 8 docs | Sprint 18 entrega `CLAUDE.md` + `init` skill estandariza |
| **Tool-use Claude en `/api/ask-guardian`** puede fallar tools y degradar respuesta | Sprint 10 crítico | Fallback al flujo Gemini actual; flag de feature `ENABLE_CLAUDE_TOOLUSE` |
| **Recovery legacy docs** desde `firebase-version` puede traer secretos | Riesgo seguridad | `security-review` skill obligatorio antes del commit; `.gitignore` reforzado |
| **MCP servers internos crecen sin disciplina** | Acoplamiento se vuelve nuevo monolito | ADRs obligatorios para cada nuevo MCP server; spec en `ZETTELKASTEN_V2_SPEC.md` §5 query interface |
| **Vercel preview vs Cloud Run prod divergen** | Bugs solo en prod | Smoke tests post-deploy en ambos targets (Sprint 3 ROADMAP) |
| **Stryker mutation 65→70%** puede tomar más tiempo del planificado | Sprint 17 retrasa | Subir incrementalmente cada sprint (~+1% por sprint) |

---

## 7. Métricas de éxito por sprint

| Sprint | KPI principal | Meta |
|---|---|---|
| 6 | Lighthouse contraste WCAG AA | 0 violaciones en 4 modos |
| 7 | Driving auto-trigger latency | <500ms desde `geolocation.speed` event |
| 8 | Emergency auto-trigger precision | <5% falsos positivos en 100 eventos |
| 9 | Nodos Zettelkasten v2 vivos | 380/512 (320 base + 60 Bernoulli) |
| 10 | `/api/ask-guardian` P50 latency | <2s con env-context activo |
| 10 | Prompt cache hit rate | >70% |
| 11 | DigitalTwinFaena.tsx mesh real | 1 sitio piloto sin procedural fallback |
| 12 | MaestrIA pipeline E2E | foto→hallazgo <30s |
| 13 | ARIA Sentinel→Order Ticket | <2min |
| 14 | DIAT firmado SUSESO | <5min |
| 14 | WebAuthn server-side coverage | 100% del flujo register/verify |
| 15 | Health Connect HR alert | <60s desde anomalía |
| 16 | MercadoPago IPN webhook reliability | 99.9% deliveries |
| 17 | Pentest críticas | 0 |
| 18 | Onboarding nuevo dev | <30min hasta primer commit |
| 19 | Lighthouse score | 0.85+ en 5 rutas críticas |
| Continuo | Bundle size main chunk | <500KB gzipped |
| Continuo | Test coverage | >80% lines, >75% branches |
| Continuo | Stryker mutation score | 65 → 70 → 75% |
| Continuo | Sentry unresolved issues | <5 prod / >0 staging |

---

## 8. Decisiones que necesitan al usuario (Daho)

1. **¿Migrar `/api/ask-guardian` de Gemini a Claude o convivencia?** — Sprint 10 implica reemplazo total con tool-use. Convivencia es factible (flag) pero duplica mantenimiento. Recomendación: convivencia 1 sprint, Claude permanente desde Sprint 11.
2. **Blender MCP local: ¿lo tienes operativo?** — Sprint 11 lo necesita; si no, dividir el sprint y posponer assets físicos a Sprint 11b.
3. **Stripe vs solo Webpay/MercadoPago para internacional** — Sprint 16 menciona Stripe TODO en `Pricing.tsx:862`. ¿Activamos Stripe ahora o esperamos rollout international?
4. **SSO con qué proveedor primero** — Azure AD o Google Workspace en Sprint 17. ¿Hay cliente piloto definido?
5. **Recovery `analisis_funcional.md` y `auditoria01.md` a `docs/legacy/`** — confirma que es ok importarlos tal cual del repo `firebase-version` (sin secretos), o necesitan sanitización previa.
6. **PLAN_MAESTRO 503 nodos faltantes**: ¿síntesis automática (genera 503 nodos en una sesión Claude) o manual con criterio HSE? Recomendación: 60 Bernoulli (Sprint 9) + 132 derivados automáticos por familia OHS, dejando el resto para sprint dedicado o "drip" continuo.
7. **API-First B2B (Sprint 16)**: ¿cliente piloto que requiera ERP/HRM (SAP/Buk/Workday) ya identificado? Define schema de la primera versión de la API.

---

## 9. Apéndice — Mapeo de TODOs a sprints

| TODO (archivo:línea) | Sprint | Skill principal |
|---|---|---|
| BioAnalysis.tsx:66 | 9 | `mcp-builder` |
| VisionAnalyzer.tsx:36 | 9 | `mcp-builder` |
| StructuralCalculator.tsx:27 | 9 | `mcp-builder` |
| HazmatStorageDesigner.tsx:52 | 9 | `mcp-builder` |
| webauthnCredentialStore.ts:34 | 14 | `as:docx`, `security-review` |
| curriculum.ts:685 | 14 | `claude-api` |
| useBiometricAuth.ts:58 | 14 | `security-review` |
| billing.ts:885,942,972 | 16 | `security-review` |
| mercadoPagoAdapter.ts:24,194 | 16 | `claude-api`, Postman MCP |
| mercadoPagoIpn.ts:35 | 16 | Postman MCP |
| webpayAdapter.ts:320 | 16 | `security-review` |
| Pricing.tsx:862,916 | 16 | `claude-api` |
| Projects.tsx:721 | 14 | Calendar MCP |
| Telemetry.tsx:229 | 17 | `simplify` |
| normativeAlerts.ts:276 | 9 | `mcp-builder` |
| environmentBackend.ts:14,437 | 10 | `claude-api` |
| oauthTokenStore.ts:20 | 17 | `as:schedule` |
| NutritionLog.tsx:15 | 9 | `claude-api` |
| contentModeration.ts:7 | 17 | `claude-api` |
| TODO.md SSO P4 | 17 | `security-review` |
| TODO.md API-First P5 | 16 | Postman MCP |
| TODO.md Capacitor F2 biometría | 15 | `security-review` |
| TODO.md Capacitor F3 push | 15 | `claude-api` |
| TODO.md Mapa contaminación lumínica | wildcard | `as:algorithmic-art` |
| TODO.md Auditorías ISO interactivas | 14 | `as:docx` |
| TODO.md Lazy modals AutoCAD | 11 | `simplify` |
| TODO.md Math.random() residual ×3 | 3 (cierre) | `security-review` |

---

## 10. Apéndice — Conversión Proto-1/Proto-2 → Sprints

| Origen | Item | Sprint |
|---|---|---|
| Proto-1 `praevium-guard` | `UniversalKnowledgeContext.tsx` | 9 |
| Proto-1 | `useZettelkastenIntegration.ts` (5 smart actions) | 9 |
| Proto-1 | `SmartConnectionsPanel.tsx` | 11 |
| Proto-1 | `KnowledgeNodeBadge.tsx` | 11 |
| Proto-1 | `KnowledgeGraphVisualizer.tsx` (depth-2 neighborhood) | 11 |
| Proto-1 | `AcademicContentProcessor.tsx` (pipeline real) | 9 |
| Proto-2 `firebase-version` | Arq. Portal→Sentidos→Mente | 10 |
| Proto-2 | `analisis_funcional.md` recovery | 18 |
| Proto-2 | `auditoria01.md` recovery | 18 |
| Proto-2 | PLAN_MAESTRO 503 nodos restantes | 9 + drip |
| Proto-2 | Custom Claims UI (UserManagement) | 17 |
| Proto-2 | `generateDynamicRoute` narración | 13 |

---

## 11. Apéndice — 15 use cases Bernoulli vs sprints

| # | Use case | Categoría | Sprint | Skill/Conector que ayuda |
|---|---|---|---|---|
| A.1 | Hidrantes (FireNetworkCalculator) | operativo | 9.1 | `mcp-builder` para nodes |
| A.2 | DustSuppressionDesigner (PM10/PM2.5) | operativo | 9.1 | `mcp-builder` |
| A.3 | Cubiertas/andamios succión (extiende Structural) | operativo | 9.1 | `as:algorithmic-art` flow field |
| A.4 | HVAC confinado (ConfinedSpaceMonitor) | operativo | 9.1 | `mcp-builder` |
| A.5 | GasLeakSentinel (Telemetry) | operativo | 9.1 | Sentry MCP alerting |
| B.6 | Venturi mina ✅ | operativo | hecho Sprint 5 | — |
| B.7 | Hazmat piping ✅ | operativo | hecho Sprint 5 | — |
| B.8 | Wind load NCh 432 ✅ | operativo | hecho Sprint 5 | — |
| B.9 | Respirador NIOSH ✅ | operativo | hecho Sprint 5 | — |
| B.10 | Pulmonar altitud ✅ | operativo | hecho Sprint 5 | — |
| C.11 | Micro-eólica viabilidad | wildcard | 9.3 | `as:xlsx` para reporte |
| C.12 | Suelos hidrostática evacuación | wildcard | 9.3 | Blender MCP terreno |
| C.13 | SLAM digital twin | wildcard | 11 | Blender MCP |
| C.14 | (placeholder spec) | wildcard | 9.3 | — |
| C.15 | (placeholder spec) | wildcard | 9.3 | — |

## 12. Apéndice — Métricas observadas vs objetivo

| Métrica | Hoy | Objetivo Sprint 19 |
|---|---|---|
| TODO en código prod | 27 | <10 |
| Bundle main chunk gzipped | TBD | <500KB |
| Lighthouse score | 0.65 | 0.85 |
| Stryker mutation score | 65% | 75% |
| Test line coverage | TBD | >80% |
| Sentry unresolved (prod) | 0 | <5 |
| Sentry unresolved (staging) | TBD | <30 |
| Nodos Zk vivos | 320/512 | 480/512 |
| Use cases Bernoulli | 5/15 | 15/15 |
| Latencia P50 ask-guardian | TBD | <2s |
| Cache hit rate Claude API | n/a | >70% |

## 13. Apéndice — Glosario operativo

| Término | Significado en este plan |
|---|---|
| **Skill** | Capacidad encapsulada del harness Claude Code (lista canonical en sección 3.1) — se invoca por Skill tool. |
| **Conector MCP** | Servidor MCP externo conectado al harness — expone tools que Claude puede invocar (Sentry, Blender, Vercel, Postman, Canva, Calendar, Gmail, Claude Preview). |
| **Tool-use** | Mecanismo por el que el LLM decide invocar funciones tipadas en su mismo turno; reemplaza al "prefijo de prompt" del Proto-2. |
| **Productor (Zk)** | Módulo que emite nodos al Zettelkasten (climateRiskCoupling, bernoulli, IPER, Vision, Bio). |
| **Consumidor (Zk)** | Módulo que lee del Zettelkasten via query interface (RiskNetwork, ask-guardian, Emergencia). |
| **MCP server interno** | MCP server desplegado como parte del backend Guardian, no externo (`gp-zettelkasten`, `gp-iper`, `gp-bernoulli`, `gp-environment`). |
| **Sentidos→Mente** | Patrón Proto-2 de orquestación que enriquece contexto antes de invocar IA. Renace en Sprint 10 como tool-use. |
| **Smart action** | Regla de auto-acoplamiento del Zettelkasten Proto-1 (5 patrones canónicos). |
| **Zettelkasten v2** | Schema de 512 tipos en 8 familias, definido en [`ZETTELKASTEN_V2_SPEC.md`](ZETTELKASTEN_V2_SPEC.md). |
| **Bernoulli engine** | [`src/services/physics/bernoulliEngine.ts`](src/services/physics/bernoulliEngine.ts) — 6 funciones puras SI base para 15 use cases. |
| **Modo (BRAND)** | Uno de los 4 perfiles cognitivos: `normal-light`, `normal-dark`, `driving`, `emergency`. |
| **Brecha letal** | Vulnerabilidad de seguridad/cumplimiento bloqueante para operación en cliente real (BRECHA-00 a 04, todas cerradas hoy). |
| **Sprint 18/19** | Sprints añadidos por este Master Proposal — no estaban en PLAN_PARTE4. Cubren docs/recovery/Postman/Canva/Lighthouse. |

## 14. Apéndice — Comandos canónicos para verificar el plan

```bash
# Inventario TODO de producción
grep -rn "TODO\|FIXME\|XXX\|HACK" src --include="*.ts" --include="*.tsx" \
  | grep -v "__tests__" | wc -l
# Esperado: 27 hoy, <10 al cierre Sprint 19

# Test coverage actual
npm run test:coverage

# Stryker mutation
npm run test:mutation

# Bundle size
npm run build && du -sh dist/assets/*.js | sort -h | tail -10

# Lighthouse local
npx lhci autorun

# Sentry unresolved
gh api -X GET '/repos/.../sentry-issues' || \
  curl -s "https://praeventio.sentry.io/api/0/projects/praeventio/guardian-praeventio/issues/?statsPeriod=7d&query=is:unresolved" \
    -H "Authorization: Bearer $SENTRY_TOKEN"

# Validar nodos Zettelkasten v2 vivos
node scripts/count-zettelkasten-nodes.cjs
```

## 15. Apéndice — Tabla de archivos críticos por sprint

| Sprint | Archivos críticos a crear o modificar |
|---|---|
| 6 | `BRAND.md`, `tailwind.config.ts`, snapshot tests |
| 7 | `src/contexts/AppModeContext.tsx`, `src/hooks/useDrivingTrigger.ts` (a crear) |
| 8 | `src/hooks/useDeviceMotion.ts` (a crear), `src/services/seismic/seismicCoupling.ts` |
| 9 | `src/services/zettelkasten/*` (mcp server), `src/components/engineering/{FireNetworkCalculator,DustSuppressionDesigner,ConfinedSpaceMonitor}.tsx`, `src/services/sentinel/GasLeakSentinel.ts` |
| 10 | `src/server/routes/gemini.ts:124` (rewrite), `src/server/services/claudeApi.ts` (a crear), `src/server/tools/{weather,seismic,bcn}.ts` |
| 11 | `public/assets/3d/*.glb`, `src/pages/{HumanBodyViewer,DigitalTwinFaena}.tsx`, `src/components/3d/AssetLoader.tsx` |
| 12 | `src/services/maestria/{detector,evaluador,estimador,redactor}.ts`, `src/pages/MaestrIA.tsx` |
| 13 | `src/services/aria/agents/*.ts`, MCP `gp-iper` |
| 14 | `src/server/routes/webauthn.ts` (cierre TODO 685), `src/services/auth/webauthnCredentialStore.ts` (cierre 34), `src/services/reports/{diat,libroObras,actasCphs}.ts` |
| 15 | `android/`, `ios/`, `src/services/health/{healthConnect,healthKit}.ts`, `src/services/push/{fcm,apns}.ts` |
| 16 | `src/services/billing/{webpayAdapter,mercadoPagoAdapter,mercadoPagoIpn}.ts`, `src/server/routes/billing.ts`, OpenAPI spec en `docs/api/openapi.yaml` |
| 17 | `infrastructure/cloud-armor.tf`, `scripts/secret-rotation.cjs`, `src/server/middleware/sso.ts` |
| 18 | `docs/legacy/{analisis_funcional,auditoria01,PLAN_MAESTRO_skeleton}.md`, `CLAUDE.md` |
| 19 | `postman/collections/*.json`, `canva/templates/*.json`, `lighthouserc.json` |

## 16. Apéndice — Mapeo Sprints PLAN_PARTE4 vs Master Proposal

| Sprint PLAN_PARTE4 | Sprint Master Proposal | Cambio principal |
|---|---|---|
| 6 (Lime acento) | 6 | sin cambio mayor; añade `simplify` + Claude Preview |
| 7 (Driving) | 7 | sin cambio; añade Sentry MCP |
| 8 (Emergency) | 8 | sin cambio; añade `as:schedule` para auto-deactivate |
| 9 (Bernoulli x15) | 9 | **fusiona Zettelkasten v2 backbone**; cierra 4 TODOs `addNode()` |
| 10 (env-context) | 10 | **rewrite con `claude-api` tool-use**, era inyección manual; pasa de 4h a 8h |
| 11 (Blender 3D) | 11 | añade Blender MCP como conector primario |
| 12 (MaestrIA) | 12 | sin cambio; añade `as:pdf` para output |
| 13 (ARIA) | 13 | bus pasa de Firestore custom a MCP server `gp-iper` |
| 14 (compliance) | 14 | **fusiona WebAuthn server-side**; pasa de 20h a 24h |
| 15 (Capacitor) | 15 | añade biometría + push (cierra TODOs Capacitor F2 F3); pasa a 28h |
| 16 (pagos) | 16 | **fusiona API-First B2B**; pasa de 16h a 24h |
| 17 (scale) | 17 | **añade SSO + KMS rotation + Cloud Function content-mod**; pasa a 24h |
| — | 18 (NUEVO) | docs viva + recovery legacy + memory hygiene |
| — | 19 (NUEVO) | Postman API + Canva brand kit + Lighthouse 0.85 |

## 17. Apéndice — Reading list operativa para nuevo dev

Orden de lectura sugerido para alguien nuevo (objetivo: <30min al primer commit, criterio Sprint 18):

1. `README.md` (visión).
2. `CLAUDE.md` (a generar Sprint 18 — resumen del repo).
3. `MASTER_PROPOSAL_2026-05.md` (este documento — plan).
4. `BRAND.md` (sistema de modos).
5. `ZETTELKASTEN_V2_SPEC.md` (arquitectura del grafo).
6. `BERNOULLI_EXTENSIONS.md` (motor físico).
7. `DIGITAL_TWIN_GPU_FREE_PLAN.md` (3D sin GPU).
8. `PROTO_ARCHAEOLOGY.md` (contexto histórico Proto-1/Proto-2).
9. `docs/legacy/analisis_funcional.md` y `auditoria01.md` (decisiones arquitectónicas heredadas).
10. `SECURITY.md`, `MONITORING.md`, `OBSERVABILITY.md` (operación).

## 18. Apéndice — Check-list pre-merge para PR de feature

Una checklist viva — cada PR de feature debería aprobar estos puntos antes de merge a `main`:

- [ ] `security-review` skill ejecutado, 0 críticas.
- [ ] `review` skill ejecutado, comments resueltos.
- [ ] `simplify` skill ejecutado si tocó >5 archivos.
- [ ] Tests nuevos cubriendo happy path + 1 cross-tenant si aplica.
- [ ] Coverage no baja del baseline.
- [ ] Stryker no baja del baseline.
- [ ] Sentry breadcrumbs o spans añadidos para flujos críticos.
- [ ] Si tocó nodo Zettelkasten: `addNode()` real (no console.log).
- [ ] Si tocó UI: screenshot Claude Preview en los 4 modos.
- [ ] Si tocó API: spec Postman actualizada.
- [ ] Si tocó docs maestros: `as:consolidate-memory` para detectar contradicciones.

## 19. Apéndice — KPIs de adopción de skills+conectores

Pasados 3 sprints desde la adopción de este plan, deberíamos medir:

| KPI | Meta a 3 sprints |
|---|---|
| % de PRs con `security-review` corrido | 100% |
| % de PRs con `review` corrido | 100% |
| Tools del Asesor invocados por LLM (Sprint 10) | >2 invocaciones promedio por sesión |
| Cache hit rate Claude API | >70% |
| Documentos generados por skills (`docx/pdf/pptx/xlsx`) | >50/mes |
| Eventos Sentry triados con `analyze_issue_with_seer` | >80% |
| Tareas Calendar/Gmail MCP creadas vs manuales | >70% MCP |
| Assets 3D generados vía Blender MCP | 3 (assets iniciales) |
| OpenAPI spec sincronizada con código | sí (con diff CI) |

## 20. Cierre

Este documento es la **fuente de verdad operativa hasta Sprint 19**. Las revisiones se ejecutan cada 2 sprints (próxima 2026-05-17, post Sprints 6 + 10). Los documentos `ROADMAP_2026-05.md` y `PLAN_PARTE4_ROADMAP_IMPLEMENTACION.md` quedan como referencia histórica — sus contenidos están integrados aquí.

**Próxima acción inmediata:** ejecutar Sprint 6 (lime acento, 4h) en paralelo con Sprint 10 (env-context con tool-use, 8h). Sprint 10 desbloquea más valor que cualquier otra pieza individual del roadmap.

> Este plan fue producido considerando que cuando se hicieron los prototipos no teníamos las skills + conectores de Claude. La diferencia es estructural: lo que antes era un endpoint con prompt monolítico ahora es tool-use; lo que era callbacks ad-hoc ahora es MCP server tipado; lo que era jsPDF artesanal ahora es `docx` editable con audit trail. Esa es la mejora que pide la consigna.

— Daho Sandoval (`dahosandoval@gmail.com`) + Claude Opus 4.7 (1M context), 2026-05-03.
