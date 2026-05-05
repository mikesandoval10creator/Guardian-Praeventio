# Backlog Vivo — Auditoría 2026-05-05 + Visión Global

Este doc es la **fuente única de verdad** del progreso vs el informe de auditoría 2026-05-05 + las decisiones del usuario sobre lanzamiento global. Se actualiza cada sprint que toque audit items.

**Métrica honesta de cobertura E2E:** ~60% al inicio del Sprint 27. Meta: 99% antes de Day-1 Play Store/iOS mundial.

**Filosofía operacional:**
- ISO 45001 como baseline universal; cada país añade requisitos más estrictos cuando aplican.
- "Crear soluciones donde otros ven problemas, nosotros vemos desafíos."
- La app no solo cumple — enseña mejor calidad de vida al trabajador y la empresa.

---

## Estado por hallazgo

Leyenda: ✅ cerrado · 🔄 en sprint actual · ⏸ bloqueado por usuario · 📅 sprint planeado · ⬜ pendiente sin sprint

### P0 (8 ítems — 29 SP)

| ID | Hallazgo | Estado | Sprint | Nota |
|---|---|---|---|---|
| H2 | IAP Apple sin webhook | ✅ | S27 | SSN v2 con verify JWS leaf-cert + idempotencia. Full Apple Root G3 chain = follow-up S29. |
| H6 | FallDetection no escala | ✅ | S27 | Wire a `useEmergency().triggerEmergency('fall', projectId)`. |
| H7 | FCM mismatch fcmToken/fcmTokens | ✅ | S27 | Cross-collection lookup `users/{uid}.fcmTokens` + cache 5min + fallback legacy. |
| H8 | tenants/* sin firestore rules | ✅ | S27 | Matcher con `request.auth.token.tenantId == tenantId`. |
| H9 | Composite indexes | ✅ | S27 | Verificado falso positivo (queries single-field). |
| H14 | /api/maintenance sin auth | ✅ | S27 | `verifySchedulerToken` middleware + `SCHEDULER_SHARED_SECRET` env. |
| H15 | /api/environment/forecast sin auth | ✅ | S27 | `verifyAuth` + `erpSyncLimiter`. |
| H20 | maintenance.ts no montado | ✅ | S27 | Mounted detrás del scheduler gate. |

### P1 (12 ítems — 57 SP)

| ID | Hallazgo | Estado | Sprint | Nota |
|---|---|---|---|---|
| H4 | Vertex AI hardcoded false | ✅ | S27 | Adapter real con `@google-cloud/vertexai 1.12` + `getAiAdapterFor({dataResidency, strict})`. |
| H10 | setInterval sin clearInterval | ✅ | S27 | `environmentalPollingHandle` + clear en SIGTERM. |
| H12 | AsesorChat fallback Santiago | ✅ | S27 | Sin coords → no fetcha clima/sismo. |
| H17 | Validación Zod transversal | ✅ | S28 B3 | `validate(schema)` middleware + 5 endpoints críticos. Legacy typeof guards quedan como defense-in-depth (TODO S29 limpieza). |
| H18 | Audit en webhooks billing | 🔄 | S28 B4 | `billing.webhook.replay` + `billing.webhook.success` events. |
| H21 | Locales Latam al 10% | ✅ | S28 B2 | Fallback chain `es-MX/AR/PE → es → en` + 47 keys críticos por locale. |
| H25 | Tier downgrade UI | 🔄 | S28 B4 | Modal con archivar/exportar antes de downgrade. |
| H26 | EPP expiry job | 🔄 | S28 B4 | `checkExpiredPpe()` wired a maintenance reaper. |
| H28 | DIAT/DIEP PDF real | 🔄 | S28 B6 | **Scope clarificado**: generamos PDF + recordamos a la empresa; NO enviamos a SUSESO (la empresa lo sube por portal mutualidad). |
| H29 | CPHS module | 🔄 | S28 B5 | Constitución + actas firmadas WebAuthn + export PDF. ISO 45001 §5.4 + DS 54 art.66. |
| H31 | Stryker en CI Linux | 📅 | S29 | Crash STATUS_STACK_BUFFER_OVERRUN bloquea Windows; mover a Ubuntu runner. |
| H33 | Tests unitarios 184 componentes | 📅 | S29-S30 | Triage por criticidad. Priorizar emergency + billing + compliance. |

### P2 (10 ítems — 22 SP) — Sprint 29 candidates

| ID | Hallazgo | Estado | Nota |
|---|---|---|---|
| H1 | Doc DWG desfasada | ⬜ | Limpieza menor. |
| H3 | Stripe pre-flight | ⬜ | Mensajes claros cuando flag off. |
| H5 | SII pre-flight | ⬜ | Idem para 3 adapters stub. |
| H11 | Geofence in-place edit | ⬜ | `geometryHash` en deps. |
| H19 | KnowledgeGraph `as any` x18 | ⬜ | Type cleanup. |
| H22 | KnowledgeGraph virtualización + worker | ⬜ | Para tenants >1k nodos. |
| H23 | backgroundTriggers concurrency | ⬜ | `Promise.all` con concurrency 10. |
| H24 | Code splitting eager | ⬜ | KG/Site25D/PortableCurriculum a `React.lazy`. |
| H27 | Geofence permission UX | ⬜ | Toast cuando navegador deniega. |
| H32 | Seeds determinísticos en tests | ⬜ | 8 archivos con `Math.random` sin seed. |

### P3 (2 ítems)

| ID | Hallazgo | Estado |
|---|---|---|
| H16 | CSP nonce regex frágil | ⬜ |
| H30 | /processing-activities verify no fugue | ⬜ |

---

## Roadmap features (48 SP)

| ID | Feature | Estado | Cierra |
|---|---|---|---|
| F-A | CalculatorHub — 12 generadores Bernoulli sin UI | ⬜ | — |
| F-B | RAG NL sobre incidentes históricos del tenant | ⬜ | — |
| F-C | Auto-fill DIAT desde audit_logs | 🔄 parcial | H28 (en S28 B6) |
| F-D | Gamification × salud | ⬜ | — |
| F-E | Predictive Alerts × Calendar | ⬜ | — |
| F-F | WebAuthn Settings UI | ⬜ | — |
| F-G | CPHS Module | 🔄 | H29 (en S28 B5) |

---

## Lanzamiento global — backlog específico

**Visión:** lanzamiento Play Store + iOS mundial; arquitectura regulatoria multi-país + ISO 45001 baseline + i18n expandido. Documentado en `docs/architecture-decisions/0014-regulatory-framework-abstraction.md` (Sprint 28 B1).

| Tarea | Estado | Sprint |
|---|---|---|
| ADR 0014 Regulatory Framework Abstraction | ✅ | S28 B1 |
| Catálogos ISO 45001 + Chile + US-OSHA + EU + México + Brasil | ✅ | S28 B1 |
| Catálogos UK + Canadá + Australia + Japón + Korea + India | 📅 | S29-S30 |
| i18n fallback chain + 12 locales (incl. RTL ar/he) | ✅ | S28 B2 |
| Traducciones reales fr/de/ja/zh/ar (hoy son stubs ~40 keys) | ⏸ | bloqueado por traductor humano |
| Wire features → registry regulatorio (citaciones dinámicas en UI) | 📅 | S29 |
| Compliance gap audit por jurisdicción (GDPR vs CCPA vs LGPD vs Ley 19.628) | 📅 | S29 |
| Tier "Global" en pricing (multi-jurisdicción simultáneo) | 📅 | S30 |
| Demo project sintético funcional sin login (Day-1) | ✅ parcial | S26 YY (`demo-faena-praeventio`) — falta para Day-1 que abra sin auth |
| Mobile signing pipeline GHA + Fastlane | 📅 | S30 |
| Apple Developer Program + Play Console keystore | ⏸ | bloqueado por usuario (cuentas) |

---

## Secrets/credenciales bloqueantes (10)

Documentados en `docs/runbooks/SECRETS_RUNBOOK.md` cuando exista (Sprint 30). El código está listo para consumirlos cuando lleguen:

- `VITE_GOOGLE_MAPS_API_KEY` — 4 mapas + Site25DPanel
- `VITE_FIREBASE_VAPID_KEY` — FCM web push
- `GOOGLE_CLIENT_ID/SECRET` — Calendar + Fit OAuth
- `IOT_WEBHOOK_SECRET` — Telemetry HMAC
- `MP_IPN_SECRET` — MercadoPago IPN
- `GOOGLE_PLAY_PACKAGE_NAME` + `_SERVICE_ACCOUNT_JSON` + `_RTDN_TOPIC` — Android billing
- `SENTRY_DSN` — error tracking + rotar key del leak histórico
- `KMS_KEY_RESOURCE_NAME` — KEK source prod
- Khipu credentials — si se confirma como pasarela
- `SCHEDULER_SHARED_SECRET` — Cloud Scheduler gate (S27)
- `VERTEX_PROJECT_ID` + `VERTEX_LOCATION` — Vertex AI residencia Latam (S27)
- Apple Root CA G3 PEM — para SSN full-chain verify (S29)

---

## Convenciones de actualización

1. Al completar un hallazgo, mover a ✅ con sprint donde se cerró + nota una línea con qué archivo.
2. Hallazgos nuevos descubiertos durante un sprint → agregar al final con ID `Hxx-S{N}`.
3. Re-priorización (P0→P1, etc.) → mover a la tabla correspondiente, dejar fila tachada en la original con razón.
4. Cada PR del sprint debe incluir línea en el body apuntando a este doc: `Cierra hallazgos: [H##, H##]`.
5. Cuando coverage real llegue ≥95%, abrir issue "Day-1 readiness checklist" cruzando este backlog con el plan de marketing/QA pre-lanzamiento.
