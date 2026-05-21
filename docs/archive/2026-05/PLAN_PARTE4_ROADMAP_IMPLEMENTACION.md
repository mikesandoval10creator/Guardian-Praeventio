# PLAN PARTE 4 — Roadmap de Implementación Unificado

> ⚠️ **SUPERSEDED (Sprint 31 RR · 2026-05-05)** — sustituido por
> [`MASTER_PROPOSAL_2026-05.md`](MASTER_PROPOSAL_2026-05.md) y, para el
> estado real, por
> [`docs/audits/PRAEVENTIO_HONEST_STATE_2026-05-05.md`](docs/audits/PRAEVENTIO_HONEST_STATE_2026-05-05.md).
> Backlog vivo: [`docs/audits/AUDIT_BACKLOG.md`](docs/audits/AUDIT_BACKLOG.md).

> Documento actualizado: 2026-05-03 | Alineado con [`ROADMAP_2026-05.md`](ROADMAP_2026-05.md) (fuente de verdad)
> Integra hallazgos de GP actual + Prototipo 1 + Prototipo 2 + Sprint 5 (Bernoulli expandido)

---

## PRINCIPIOS DE ESTA IMPLEMENTACIÓN

1. **Mejorar, no solo portar** — cada feature se implementa con mejor diseño que el prototipo.
2. **Real sobre stub** — si existe en código pero no funciona end-to-end, no cuenta.
3. **Seguridad primero** — las brechas letales BRECHA-00 a 04 ya están **todas cerradas**.
4. **Zettelkasten como columna vertebral** — las conexiones entre módulos son el valor diferencial.
5. **El Gran Maestro siempre con contexto ambiental** — AI nunca responde sin datos del campo (pendiente Sprint 10).
6. **Bernoulli como motor físico transversal** — el motor `bernoulliEngine.ts` alimenta 4 módulos hoy y 15 use cases planificados.

---

## 1. BRECHAS LETALES — TODAS CERRADAS ✅

| Brecha | Descripción | Estado | Evidencia |
|--------|-------------|--------|-----------|
| BRECHA-00 | Inmutabilidad post-firma Ley 16.744 | ✅ cerrada | `firestore.rules:425-450` |
| BRECHA-01 | Audit logs ISO 45001 | ✅ cerrada | rules + colección `audit_log` activa |
| BRECHA-02 | HMAC telemetry | ✅ cerrada | commit `9ea820f` |
| BRECHA-03 | Cross-tenant write `accept-invitation` | ✅ cerrada | commit `caef640` |
| BRECHA-04 | RBAC 6 roles | ✅ cerrada | dual-capa rules + custom claims |

**Implicación:** las pruebas de campo están desbloqueadas en cuanto a seguridad letal.

---

## 2. ITEMS COMPLETADOS NO DOCUMENTADOS PREVIAMENTE

Trabajo entregado en Sprint 2-5 que el roadmap previo no mencionaba:

| Item | Commit |
|------|--------|
| 4-mode UX system (normal-light, normal-dark, driving, emergency) | `9a76556` |
| `BRAND.md` con teoría de color | `96d40f4` |
| `AppModeContext` con persistencia + auto-expiry de emergency | `f9cba6d` |
| `ModeSwitcher` flotante en RootLayout | `09e3317` |
| Bernoulli expansión a Hazmat/Vision/Bio (3 módulos) | `9cbb4e8`, `afa8c08`, `5178149` |
| Semantic CSS tokens + scales 50-900 teal/petroleum/gold | `7c87869` |
| ErrorBoundary categorizado + Sentry capture | `8b0e7b3` |
| Landing redesign alineado con praeventio.net | `ade4a54` |
| Lime → teal migration (~80 archivos) | `8a0a0df` |
| Manual chunks Vite (4 vendors) | `a3c8cd4` |
| Lighthouse threshold 0.5 → 0.65 | `14ff0ed` |

**Sentry status:** 0 unresolved issues últimos 7 días — saludable o tráfico bajo en producción. Confirmar con métrica de pageviews una vez landing reciba tráfico orgánico.

---

## 3. ROADMAP RE-PRIORIZADO — 17 SPRINTS

> El plan de 8 fases del roadmap previo se subsume en este plan de 17 sprints, alineado con `ROADMAP_2026-05.md`.

### Sprint 6 — Lime re-integration como acento de éxito ⏳
**Esfuerzo:** ~4h. **Por qué:** la migración lime → teal fue total; queda jerarquía de 3 colores incompleta.

- 3-color hierarchy: **teal=trust** (primario), **lime=energy** (success/CTA crítico), **gold=prestige** (badges, premium).
- Variants: `success-default` ahora teal, añadir `success-emphasis` lime para CTAs de acción exitosa.
- Snapshot test en Storybook: 0 lime en utility classes excepto en componentes whitelisted.
- Documentar en `BRAND.md` cuándo usar cada color.

### Sprint 7 — Driving UI real con Maps SDK + speed-trigger ⏳
**Esfuerzo:** ~12h.

- Capacitor Maps SDK con vista turn-by-turn.
- Speed trigger: si `geolocation.speed > 5 m/s` durante ≥30s → activar `appMode = 'driving'` automáticamente.
- Botón SOS dimensionado para uso con guantes (target 80×80px, alto contraste).
- Cancelación de driving mode al detectar parada >5 min.

### Sprint 8 — Emergency UI real con DeviceMotion sismo ⏳
**Esfuerzo:** ~10h.

- `DeviceMotion` hook + filtro pasa-banda 0.1-10 Hz para detectar PGA local.
- Si magnitud estimada >M3.5 + USGS confirma sismo en zona <50km en últimos 60s → activar `appMode = 'emergency'`.
- UI Emergency: rojo crítico, contador de tiempo desde sismo, botón "Estoy bien" (heartbeat) y "Necesito ayuda" (SOS).

### Sprint 9 — Bernoulli extensions (15 use cases) ⏳
**Esfuerzo:** ~30h en total, fraccionado por categoría.

Ver detalles en [`BERNOULLI_EXTENSIONS.md`](BERNOULLI_EXTENSIONS.md). Se ejecuta en bloques:
- 9.1 — 5 use cases operativos nuevos (~12h)
- 9.2 — UI alerts para los 5 ya integrados (~5h)
- 9.3 — 5 wildcards con feasibility study (~13h)

### Sprint 10 — Env context injection en `/api/ask-guardian` ⏳
**Esfuerzo:** ~4h. **Crítico — desbloquea valor del Asesor.**

- Llamar `fetchEnvironmentContext(lat, lng)` antes de `searchRelevantContext`.
- Inyectar bloque `[CONTEXTO AMBIENTAL]` con temperatura, viento, UV, sismicidad.
- Forzar output JSON estructurado del Gran Maestro: `{causa_raiz, riesgos[], plan_accion}`.
- Tarjeta BCN link a leychile.cl en respuestas normativas.
- Detalle en `[PLAN_PARTE3_PROTOTIPO2.md](PLAN_PARTE3_PROTOTIPO2.md)` §3.

### Sprint 11 — Blender 3D pipeline (HumanBodyViewer / DigitalTwinFaena / EPP) ⏳
**Esfuerzo:** ~24h.

- Pipeline Blender → glTF optimizado para Three.js.
- 3 assets iniciales: cuerpo humano segmentado por D.S. 594 (7 regiones), faena minera tipo (digital twin base), EPP modular (casco, chaleco, arnés intercambiables).
- Compresión Draco + KTX2 textures.

### Sprint 12 — MaestrIA: pipeline IA fotos hallazgos ⏳
**Esfuerzo:** ~16h. **Inspirado en ganador hackathon Ancud Chile.**

Pipeline 4 agentes encadenados (ver ROADMAP_2026-05 Sprint 6 original):
1. **Detector** — Gemini Vision con bounding boxes.
2. **Evaluador** — clasifica DS 594 / Art / severidad ISTAS21.
3. **Estimador** — cotiza remediación (web search local).
4. **Redactor** — hallazgo formal pre-llenado en Firestore.

UI con barra "PIPELINE PROGRESS". Output: documento listo para firma.

### Sprint 13 — ARIA multi-agente con **Vertex AI Agent Builder** + MCP server interno ⏳
**Esfuerzo:** ~20h. Stack Google-first per decisión D1 (compatibilidad Workspace).

5 agentes ejecutados en **Vertex AI Agent Builder** (no Claude Agent SDK — runtime productivo en Google):
- **Sentinel** detecta anomalía (ManDown/Geofence) → MCP →
- **KB Builder** lee manuales + historial → MCP →
- **Investigator** analiza causa raíz → MCP →
- **Q&A Agent** pregunta supervisor si faltan datos → MCP →
- **Work Order Writer** genera orden + asigna técnico.

Bus de mensajes: MCP server interno `gp-iper` (preferido) o Firestore custom.

> **Diseño de prompts**: en este lado de Claude Code usamos la skill `claude-api` para diseñar/optimizar/cachear prompts. **Runtime productivo**: Gemini en Vertex AI Agent Builder.

### Sprint 14 — Compliance ISO 45001 + SUSESO ⏳
**Esfuerzo:** ~20h.

- **DIAT** automático desde Firestore → PDF firmable.
- **Libro de obras digital** (DS 76).
- **CPHS** automatización actas + recordatorios + Resend.
- **Historial capacitaciones** export SERNAC/SUSESO.
- **Firma digital** SimpleWebAuthn para declaraciones juradas check-in.

### Sprint 15 — App nativa Capacitor + Health Connect/Kit + APNS ⏳
**Esfuerzo:** ~24h.

- CI/CD real para `cap:android` + `cap:ios`.
- WebAuthn server-side.
- Health Connect (Android) + HealthKit (iOS) → frecuencia cardíaca real para Man Down.
- Background geolocation (modo conducción).
- Offline-first SQLite → Firestore con UI de cola.
- APNS para iOS.

### Sprint 16 — Pagos reales (Webpay, MercadoPago, SII boletas) ⏳
**Esfuerzo:** ~16h. **Cuando haya cuentas reales.**

- Transbank/Webpay testing → producción.
- MercadoPago SDK con OIDC.
- Google Play Billing `WEBHOOK_SECRET` real.
- Planes Básico/Pro/Enterprise con feature flags.
- Boletas/facturas SII vía Acepta o Defontana.
- Dashboard MRR/churn/conversión trial.

### Sprint 17 — Scale + WAF multi-region + ISO 27001 ⏳
**Esfuerzo:** ~20h. **Antes de >100 empresas.**

- Cloud Armor + WAF L7.
- SBOM con Syft + image signing Cosign.
- Secret rotation automática (Cloud Scheduler, 90 días).
- Multi-region: us-central1 + southamerica-west1.
- Audit logs inmutables a Cloud Logging (retención 7 años, Ley 16.744 exige 5).
- Pentest externo + bug bounty.
- Documentación ISO 27001.

---

## 4. RESUMEN EJECUTIVO 2026-05-03

```
ESTA SEMANA (Sprints 6 + 10):
├── Lime re-integration como acento (4h)
└── Env context en /api/ask-guardian (4h) ← desbloquea valor Asesor

PRÓXIMAS 2 SEMANAS (Sprints 7 + 8):
├── Driving UI con Maps SDK + speed trigger
└── Emergency UI con DeviceMotion sismo

MES 1 (Sprint 9):
└── Bernoulli extensions: 15 use cases físicos

MES 2 (Sprints 11 + 12):
├── Blender 3D pipeline
└── MaestrIA: hallazgos por foto

MES 3 (Sprints 13 + 14):
├── ARIA multi-agente
└── Compliance ISO 45001 / SUSESO

MES 4-6 (Sprints 15 + 16 + 17):
├── Capacitor nativa + Health Connect/Kit
├── Pagos reales SII
└── Scale + WAF + ISO 27001
```

Total estimado restante: **~200 horas** (Sprints 6-17). Repartido en sprints de 1-3 semanas = ~6 meses calendario con dedicación parcial.

---

## 5. DEPENDENCIAS CRÍTICAS

```
Sprint 10 (env context) ─────────┬─→ Sprint 12 (MaestrIA con env)
                                 └─→ Sprint 13 (ARIA con env)
Sprint 6 (lime acento)
Sprint 7 (driving) ──────────────┐
Sprint 8 (emergency) ────────────┴─→ Sprint 15 (Capacitor nativa)
Sprint 9 (Bernoulli ext) ────────┬─→ todos los módulos físicos
Sprint 11 (Blender) ─────────────┴─→ Sprint 12 (overlay 3D en hallazgos)
Sprint 14 (compliance) ──────────────→ Sprint 16 (pagos con boleta SII)
Sprint 17 (scale) ───────────────────→ pre-requisito >100 empresas
```

**Crítico:** Sprint 10 desbloquea más valor que el resto sumado. Es prioridad #1 para próxima semana.

---

## 6. HERRAMIENTAS DE DISEÑO (no requieren instalación)

| Área | Herramienta | Estado |
|------|-------------|--------|
| Componentes UI | shadcn/ui | ✅ instalado |
| Animaciones | Framer Motion | ✅ instalado |
| Gráficos | Recharts | ✅ instalado |
| Node graph | @xyflow/react | ⏳ instalar para Sprint 12 visual |
| PDF export | html2canvas + jsPDF | ✅ instalado |
| AI para UI | Claude AI vía /api/ask-guardian | ✅ activo |
| 3D | Three.js + Draco + KTX2 | ✅ instalado, optimización Sprint 11 |
| Bernoulli engine | `[bernoulliEngine.ts](src/services/physics/bernoulliEngine.ts)` | ✅ 6 funciones SI |

---

## 7. VERIFICACIÓN END-TO-END (próximos 30 días)

| Test | Sprint | Condición de éxito |
|------|--------|-------------------|
| `/api/ask-guardian` con env context | 10 | Respuesta menciona temp+sismicidad activa |
| Lime acento solo en CTAs success | 6 | Snapshot test pasa con whitelist |
| Driving auto-trigger por velocidad | 7 | Conducción >18 km/h por 30s → modo activo |
| Emergency por DeviceMotion | 8 | PGA detectada + USGS confirma → modo activo |
| 5 use cases Bernoulli operativos | 9 | Hidrantes, misting, andamios, HVAC, fugas gas con UI |
| MaestrIA pipeline 4 agentes | 12 | Foto in → hallazgo formal pre-llenado out |
| ARIA Sentinel → Work Order | 13 | ManDown → orden de trabajo asignada en Firestore |
| Health Connect HR para Man Down | 15 | HR <40 o >180 → alerta supervisor |
| Webpay producción cobro real | 16 | Plan Pro mensual cobrado correctamente |

---

> Próxima revisión: 2026-05-17 tras Sprints 6 + 10 (alta prioridad).
