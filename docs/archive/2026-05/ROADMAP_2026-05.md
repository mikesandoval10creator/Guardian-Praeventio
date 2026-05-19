> ⚠️ **SUPERSEDED (Sprint 31 RR · 2026-05-05)** — sustituido oficialmente
> por [`MASTER_PROPOSAL_2026-05.md`](MASTER_PROPOSAL_2026-05.md) y, para
> métricas vivas, por
> [`docs/audits/PRAEVENTIO_HONEST_STATE_2026-05-05.md`](docs/audits/PRAEVENTIO_HONEST_STATE_2026-05-05.md).
> Backlog operacional vivo:
> [`docs/audits/AUDIT_BACKLOG.md`](docs/audits/AUDIT_BACKLOG.md).
> Conservado como histórico del Sprint 2.

# Roadmap Guardian Praeventio — actualizado 2026-05-02

Este documento sustituye al "Plan Maestro 10 Fases" anterior. La Fase 1, parte de Fase 2 y parte de Fase 3 ya están implementadas en la rama `dev/multiagent-bernoulli-sweep` (13 commits). Lo que sigue está re-priorizado por valor y dependencia.

---

## Sprint 2 — completado (rama `dev/multiagent-bernoulli-sweep`)

### Seguridad backend (Fase 1 del plan original)
- [x] Cross-tenant write en `accept-invitation` cerrado con transacción Firestore — `projects.ts:424` → commit `caef640`.
- [x] Rate-limit del webhook Google Play — `billing.ts:276` → `4ccc17f`.
- [x] ERP sync con Zod + whitelist + rate-limit — `misc.ts:60` → `42b6700`.
- [x] APP_BASE_URL fail-fast en `http://` + producción — `curriculum.ts:97` → `30d220d`.
- [x] `Math.random()` → `crypto.randomUUID()` en invoice + toast — `4621b9b`.

### UX
- [x] 40 `alert()` → `useToast` en 28 archivos — `7a0506f` + `adde942`.

### Observabilidad (parte de Fase 3 original)
- [x] Sentry: org `praeventio` + project `guardian-praeventio` (ID `4511323258224640`) provisionados via MCP. DSN documentado para backend (`SENTRY_DSN`) y frontend (`VITE_SENTRY_DSN`) → `b13cfe8` + `d5e7a8e`.

### Tests (parte de Fase 2 original)
- [x] `oauthGoogle.test.ts` (5 casos) — `9ea820f`.
- [x] Telemetry HMAC depth (+2 casos) — `9ea820f`.
- [x] Bernoulli engine tests — `e063c08`.

### Bernoulli — semilla (nuevo, fuera del plan original)
- [x] `src/services/physics/bernoulliEngine.ts` con 6 funciones puras SI: `dynamicPressure`, `staticPressureDelta`, `venturiFlowRate`, `windLoadOnSurface`, `respiratorPressureDrop`, `windSpeedKmhToMs` — `e063c08`.
- [x] Wire-up de carga de viento en `StructuralCalculator` (NCh 432, Cp=0.8) — `71a87a8`.
- [x] Hardening post-review (negative deltaP guard, NaN input guard) — `bad629f`.

**Total: 13 commits, 41 archivos, +784/-65. Reviews automáticas: ship-as-is + ship-with-followups (todos los followups ya aplicados).**

---

## Pendiente — orden re-priorizado

### Sprint 3 — completar Fases 1+2+3 antes de feature work
**Esfuerzo:** ~10h. **Por qué primero:** cierra deuda técnica de seguridad y observabilidad que beneficia a TODO lo que viene después.

1. **Mergear `dev/multiagent-bernoulli-sweep`** (acción del usuario).
2. **Configurar Sentry en producción**:
   - `SENTRY_DSN` y `VITE_SENTRY_DSN` en Secret Manager de Cloud Run.
   - `SENTRY_TRACES_SAMPLE_RATE=0.1` y `SENTRY_ENVIRONMENT=production`.
   - Validar que el primer error de prod aparece en https://praeventio.sentry.io.
3. **Test coverage profunda** (Fase 2 que quedó pendiente):
   - `audit.ts` cross-project membership.
   - `gemini.ts` allowlist + args validation.
   - `reports.ts`, `gamification.ts`, `subscription.ts` — al menos un happy-path + un cross-tenant.
   - Reglas Firestore: `telemetry_events` (create:false), `isValidProject(hasOnly)`.
4. **Math.random() residual** (follow-up del security review):
   - `src/services/billing/invoice.ts:97`
   - `src/services/safety/iperAssessments.ts:83`
   - `src/services/safety/ergonomicAssessments.ts:102`
5. **Smoke tests post-deploy** en `deploy.yml` (curl al health endpoint + un endpoint crítico autenticado).
6. **Stryker mutation ratchet** 65% → 70%.

### Sprint 4 — Bundle & performance (Fase 4 original)
**Esfuerzo:** ~8h. **Por qué ahora:** después del hardening hay margen para optimizar sin riesgo.

- `manualChunks` real en Vite (`vendor-react`, `vendor-firebase`, `vendor-three`, `vendor-mediapipe`).
- Corregir `size-limit` para validar los chunks reales generados.
- Verificar `script-src 'blob:'` en CSP para MediaPipe.
- Lazy-loading de páginas pesadas (Three.js, D3, MediaPipe).
- Lighthouse CI threshold progresivo: 0.5 → 0.65 → 0.8 en 3 sprints.

### Sprint 5 — Bernoulli expandido a Hazmat + Vision + Bio (nuevo, antes era Fase 5)
**Esfuerzo:** ~12h. **Por qué antes que MaestrIA:** la semilla del motor físico ya está; capitalizar antes de que se enfríe.

- **HazmatStorageDesigner** — usar `venturiFlowRate` para ductos de ventilación de almacenamiento, alertar si v > umbral causa caída de presión que riesga cavitación en válvulas.
- **VisionAnalyzer** — al detectar un respirador, calcular `respiratorPressureDrop` con datos del filtro reportado y alertar si la fatiga estimada excede el turno.
- **BioAnalysis** — registrar capacidad pulmonar y comparar con `respiratorPressureDrop` esperada para detectar fatiga temprana en altitud.
- **Zettelkasten Neuronal** — añadir nodos `venturi` y `windload` que se acoplen con `climateRiskCoupling.ts` para alertas automáticas cuando la API meteorológica detecte vientos > umbral.
- Tests unitarios en cada uno.

### Sprint 6 — MaestrIA: Hallazgos fotográficos con IA (Fase 5 original)
**Esfuerzo:** ~16h. **Inspirado en ganador hackathon Ancud Chile.**

Pipeline 4 agentes encadenados:
1. **Detector** — Gemini Vision marca zonas de peligro con bounding boxes.
2. **Evaluador** — clasifica DS 594 / Art / severidad ISTAS21.
3. **Estimador** — cotiza remediación (web search local).
4. **Redactor** — genera el hallazgo formal con todos los campos en Firestore.
- UI con barra de progreso "PIPELINE PROGRESS".
- Output: documento Hallazgo pre-llenado listo para firma.

### Sprint 7 — ARIA: Multi-agente de mantenimiento (Fase 6 original)
**Esfuerzo:** ~20h. Stack Google-first per decisión D1.

5 agentes ejecutados en **Vertex AI Agent Builder** + MCP server interno:
- **Sentinel** detecta anomalía (ManDown/Geofence) → MCP →
- **KB Builder** lee manuales + historial → MCP →
- **Investigator** analiza causa raíz, busca fix histórico → MCP →
- **Q&A Agent** pregunta supervisor si faltan datos → MCP →
- **Work Order Writer** genera orden + asigna técnico.
- Bus de mensajes: Firestore.

### Sprint 8 — Compliance ISO 45001 + SUSESO (Fase 7 original)
**Esfuerzo:** ~20h.

- **DIAT** automático desde Firestore → PDF firmable.
- **Libro de obras digital** (DS 76) generado desde datos de proyecto.
- **CPHS** automatización de actas, recordatorios, envío Resend.
- **Historial capacitaciones** export SERNAC/SUSESO.
- **Firma digital** SimpleWebAuthn para declaraciones juradas check-in.

### Sprint 9 — App nativa Capacitor (Fase 8 original)
**Esfuerzo:** ~24h.

- CI/CD real para `cap:android` + `cap:ios`.
- WebAuthn server-side (no solo local).
- Health Connect (Android) + HealthKit (iOS) → frecuencia cardíaca real para Man Down.
- Background geolocation (modo conducción).
- Offline-first SQLite → Firestore con UI de cola.
- APNS para iOS.

### Sprint 10 — Pagos reales (Fase 9 original)
**Esfuerzo:** ~16h. **Cuando haya cuentas reales.**

- Transbank/Webpay testing → producción.
- MercadoPago SDK con OIDC.
- Google Play Billing `WEBHOOK_SECRET` real.
- Planes Básico/Pro/Enterprise con feature flags.
- Boletas/facturas SII via Acepta o Defontana.
- Dashboard MRR/churn/conversión trial.

### Sprint 11 — Scale + WAF + ISO 27001 (Fase 10 original)
**Esfuerzo:** ~20h. **Antes de >100 empresas.**

- Cloud Armor + WAF L7.
- SBOM con Syft + image signing Cosign.
- Secret rotation automática (Cloud Scheduler, 90 días).
- Multi-region: us-central1 + southamerica-west1.
- Audit logs inmutables a Cloud Logging (retención 7 años, Ley 16.744 exige 5).
- Pentest externo + bug bounty.
- Documentación ISO 27001.

---

## Resumen de dependencias

```
Sprint 3 (cierre Fase 1+2+3) ─┬─→ Sprint 4 (perf)        ─→ Sprint 9 (nativo)
                              ├─→ Sprint 5 (Bernoulli++) ─→ Sprint 6 (MaestrIA)
                              └─→ Sprint 8 (compliance)  ─→ Sprint 10 (pagos)
                                                          └─→ Sprint 11 (scale)
                                                              ↑
                              Sprint 7 (ARIA) ──────────────┘
```

**Crítico:** Sprint 3 desbloquea todo. Hasta que no esté mergeada y verificada en prod la rama actual + Sentry capturando errores reales, no tiene sentido invertir en MaestrIA o ARIA — ahí es donde van a aparecer los bugs que Sentry necesita ver.

## Estimación total restante

~146 horas de trabajo desde aquí hasta Sprint 11 completo. Repartido en sprints de 1-3 semanas cada uno = ~6 meses calendario asumiendo dedicación parcial.
