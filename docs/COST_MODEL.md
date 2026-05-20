# Modelo de costos Praeventio Guard — análisis honesto de viabilidad

> **Estado:** draft 2026-05-19. Pedido del founder ("luego tengo que saber cuánto me sale y ver cuándo es factible").
> Documento de trabajo, NO compromiso comercial. Validar números contra Google Cloud Pricing Calculator antes de cualquier proyección externa.

## Principio rector (ADR 0019 + correcciones founder 2026-05-19)

**Cero costo variable por operación intensiva**. Todo proceso pesado (photogrammetry, AI inference) corre on-device usando OSS WASM. El cloud cobra solo por almacenamiento y bandwidth predecible.

## Servicios Google usados (canónicos)

### Capa 1 — Infra core (siempre activa)

| Servicio | Plan | Cuota free | Costo más allá del free |
|---|---|---|---|
| Firebase Auth | Spark | 50K MAU | Migrar a Blaze pay-as-you-go: ~$0.0055 por verificación SMS, $0 por Google/email |
| Firestore | Spark | 50K reads/d, 20K writes/d, 1 GB stored | $0.06/100K reads, $0.18/100K writes, $0.18/GB/mes |
| Cloud Storage | Spark | 5 GB stored, 1 GB/d download | $0.026/GB/mes, $0.12/GB transfer |
| Firebase Hosting / CDN | Spark | 10 GB/mes transfer | $0.15/GB transfer |
| Cloud Functions | Spark | 2M invocations/mes, 400K GB-s | $0.40/M invocations, $0.0000025/GB-s |
| FCM (push) | — | Ilimitado siempre | $0 (gratis siempre) |
| Cloud Logging | — | 50 GiB/mes ingest free | $0.50/GiB beyond |
| Cloud KMS | — | $0.06 per key version per mes | Pequeño y fijo per tenant |
| Vertex AI (Gemini) | Pay-per-use | (sin free tier real) | Gemini Flash 1.5: ~$0.075/M input tokens, $0.30/M output tokens |

### Capa 2 — Infra desactivada por costo (ADR 0005 v4)

| Servicio | Estado | Razón |
|---|---|---|
| Cloud Run (photogrammetry COLMAP) | **DESCARTADO** founder 2026-05-19 | Costo variable inaceptable ($0.05-0.10/captura) |
| Modal.run GPU | **DESCARTADO** ADR 0019 | Third-party + GPU externa |

### Capa 3 — Third-party necesarios (no Google, pero requeridos para vender)

| Servicio | Cobro | Justificación |
|---|---|---|
| Webpay (Transbank) | Per transacción 2.95% + IVA | Único procesador serio Chile B2B; sin equivalente Google |
| MercadoPago | Per transacción 3.49% + IVA | Cobertura LatAm; ídem |
| Google Play IAP | 15-30% comisión | Required Android in-app purchases |
| Apple StoreKit | 15-30% comisión | Required iOS in-app purchases |
| Sentry | Plan free 5K events/mes | Pendiente migrar a Cloud Error Reporting Google si cubre (re-evaluación trimestral per ADR 0019) |
| Resend | Plan free 3K emails/mes, 100/día | Pendiente migrar a Gmail API / Google Workspace Send |

## Escenarios de carga

### Escenario A — MVP soft launch (10 empresas / 100 usuarios totales)

Asume cada usuario:
- 5 logins/semana = 20 logins/mes (autenticación Google = $0)
- 50 Firestore reads/d (consultar dashboards, notificaciones)
- 10 Firestore writes/d (inspecciones, audit logs)
- 1 video photogrammetry/mes (~10 MB upload via Drive del proyecto)
- 5 mesh artifacts stored/mes (~8 MB cada)
- 3 push notifications/d via FCM

**Cálculo mensual:**

| Línea | Cantidad | Costo |
|---|---|---|
| Firebase Auth | 100 MAU | $0 (bajo 50K free) |
| Firestore reads | 100 × 50 × 30 = 150K reads/mes | $0 (bajo 50K/d × 30 = 1.5M free) |
| Firestore writes | 100 × 10 × 30 = 30K writes/mes | $0 (bajo 20K/d × 30 = 600K free) |
| Cloud Storage | 100 × 5 × 8 MB = 4 GB | $0 (bajo 5 GB free) |
| Storage egress | 4 GB × 1.5 (downloads) | $0 (bajo 1 GB/d free aprox 30 GB/mes) |
| Cloud Functions | ~5K invocations/mes (notifications, triggers) | $0 (bajo 2M free) |
| FCM | 100 × 3 × 30 = 9K push | $0 (gratis) |
| Logging | ~5 GiB/mes | $0 (bajo 50 GiB) |
| KMS | 10 tenants × 1 key × $0.06 | **$0.60/mes** |
| Vertex AI (Gemini) | ~100 queries/d × 2K tokens promedio × 30d = 6M tokens/mes | ~**$0.45/mes** ($0.075 × 6 = $0.45) |
| **TOTAL Google infra** | | **~$1.05/mes** |
| Webpay | 10 empresas × $50/mes promedio (tier) × 2.95% comisión | **~$15/mes** (esto se descuenta del revenue) |
| Sentry | <5K events/mes free | $0 |
| Resend | <3K emails/mes free | $0 |
| **TOTAL operacional (sin comisiones que se descuentan revenue)** | | **~$1.05/mes** |

**Revenue esperado a 10 empresas × $50/mes** (plan PYME mediano): **$500/mes**.
**Margen bruto: ~$485/mes (97%)**. Viable trivialmente al MVP.

### Escenario B — Crecimiento (100 empresas / 2.000 usuarios)

Escalado lineal aproximado:

| Línea | Cantidad escalada | Costo |
|---|---|---|
| Firebase Auth | 2K MAU | $0 (bajo 50K) |
| Firestore reads | 3M/mes | $0 (bajo 1.5M/d free aprox 45M/mes) — **espera, recalcular**: 50K/d × 30 = 1.5M/mes free. 3M/mes excede → ~$0.90/mes ($0.06 × 15 unidades de 100K) |
| Firestore writes | 600K/mes | $0 (justo en límite free 600K/mes) |
| Cloud Storage | 80 GB | (80 - 5) × $0.026 = **$1.95/mes** |
| Storage egress | 120 GB | (120 - 30 free) × $0.12 = **$10.80/mes** |
| Cloud Functions | ~100K invocations/mes | $0 (bajo 2M) |
| FCM | 180K push/mes | $0 |
| Logging | ~50 GiB/mes | ~$0 (en el límite) |
| KMS | 100 tenants × $0.06 | **$6/mes** |
| Vertex AI Gemini | ~50M tokens/mes input + ~10M output | $0.075 × 50 + $0.30 × 10 = **$6.75/mes** |
| **TOTAL Google infra** | | **~$26.40/mes** |
| Webpay comisiones | $500/mes promedio × 2.95% × 100 empresas | descontado del revenue |
| Sentry | likely >5K events → plan team $26/mes | **$26/mes** |
| Resend | likely >3K emails → plan starter $20/mes | **$20/mes** |
| **TOTAL operacional** | | **~$72/mes** |

**Revenue esperado a 100 empresas × $80/mes promedio** (mix tiers): **$8.000/mes**.
**Margen bruto: ~$7.928/mes (~99%)**. Sobra para R&D, sales, soporte.

### Escenario C — Escala (2.500 empresas / 50.000 usuarios — meta 2026 KPI)

| Línea | Cantidad | Costo aproximado |
|---|---|---|
| Firebase Auth | 50K MAU | $0 (en el límite del Spark; migrar a Blaze recomendado igual) |
| Firestore reads | 75M/mes | (75M - 1.5M free)/100K × $0.06 = **~$44/mes** |
| Firestore writes | 15M/mes | (15M - 600K free)/100K × $0.18 = **~$26/mes** |
| Cloud Storage | 2 TB | (2000 - 5) × $0.026 = **~$52/mes** |
| Storage egress | 3 TB | (3000 - 30) × $0.12 = **~$356/mes** |
| Cloud Functions | ~2.5M invocations/mes | (2.5M - 2M)/M × $0.40 = **~$0.20/mes** |
| FCM | 4.5M push/mes | $0 |
| Logging | ~1.25 TiB/mes | (1280 - 50) × $0.50 = **~$615/mes** ⚠️ |
| KMS | 2500 tenants × $0.06 | **~$150/mes** |
| Vertex AI Gemini | ~1.250M tokens input + 250M output | $93.75 + $75 = **~$169/mes** |
| **TOTAL Google infra** | | **~$1.412/mes** ⚠️ |
| Sentry Team plan o Self-host GlitchTip on Cloud Run... | | **~$80-200/mes** |
| Resend Pro | | **~$50/mes** |
| **TOTAL operacional** | | **~$1.500-1.700/mes** |

**Revenue esperado a 2.500 empresas × $80/mes promedio**: **$200.000/mes** (ARR $2.4M).
**Margen bruto: ~$198K/mes (~99%)**.

⚠️ **Items a vigilar en escala** (>500 tenants):
- **Cloud Logging $615/mes** — log volume crece linealmente. Mitigación: log sampling, exportar logs viejos a BigQuery archive (más barato), retention 30d en vez de default.
- **Storage egress $356/mes** — bandwidth descargando mesh + audit logs. Mitigación: Cloud CDN para assets estáticos, comprimir glb con Draco.
- **Firestore reads $44/mes** — bajo, pero crece con dashboards activos. Mitigación: caching agresivo en cliente.

## Comparativa CON vs SIN Cloud Run COLMAP

**Para validar la decisión founder 2026-05-19** de eliminar C2:

A 2.500 empresas × 5 capturas SfM/mes = 12.500 capturas/mes. Si usáramos Cloud Run COLMAP ($0.05-0.10/captura):

- **Min:** 12.500 × $0.05 = **$625/mes adicional** (sobre los $1.412 base = +44%)
- **Max:** 12.500 × $0.10 = **$1.250/mes adicional** (+88%)

A escala C, eliminar C2 **ahorra $625-1.250/mes**. Justificación matemática de la directiva.

Pero también: el costo es muy bajo cuando la base es 100 empresas ($30-60/mes). El problema NO es el costo absoluto a MVP, es:
1. Variabilidad — picos inesperados destruyen pronósticos.
2. Falla cobrada — Cloud Run cobra el tiempo de CPU aunque COLMAP crashee con el video.
3. Compromiso UX — si C2 está como fallback "always on", los usuarios débiles lo usarán siempre, y el costo escala.

**La directiva no es solo costo; es PREDECIBILIDAD del costo.**

## Punto de viabilidad

Praeventio es viable comercialmente desde **el primer cliente que paga $50/mes**, dado el modelo on-device. Los costos Google son sub-lineales con el crecimiento de usuarios porque:

- Auth es free hasta 50K MAU.
- Firestore reads/writes crecen con actividad, pero la mayoría está en el free tier hasta ~200 empresas.
- Storage crece con datos almacenados, no con compute.
- Compute (SfM, AI inference) está OFFLOADED al device del usuario.

**Break-even**: 1 cliente que pague algo arriba de los $1.05/mes de infra base = $50/mes plan PYME → margen 97% desde día 1.

## Pendientes para refinar este modelo

1. **Validar números contra Google Cloud Pricing Calculator** con configuración exacta del proyecto (region southamerica-west1, tier de Firestore, etc.).
2. **Medir Vertex AI Gemini tokens reales** post-launch — el promedio de 2K tokens/query es estimate.
3. **Decidir migración Sentry → Cloud Error Reporting + Logging** (re-evaluación trimestral per ADR 0019).
4. **Decidir migración Resend → Gmail API** (idem).
5. **Trackear Webpay comisión real** (% efectivo varía según tier merchant).
6. **Modelar el caso "spike viral"** — qué pasa si 10K usuarios crean cuenta en 24h tras un evento de prevención de alto perfil.

## Referencias

* ADR 0019 — Google ecosystem foundation + OSS critical complement.
* ADR 0005 v4 — Photogrammetry pipeline (justifica eliminar C2).
* ADR 0020 — Peer-to-peer intra-tenant photogrammetry (alternativa $0 a C2).
* `DIGITAL_TWIN_GPU_FREE_PLAN.md` — análisis original photogrammetry sin GPU.
* Google Cloud Pricing Calculator: https://cloud.google.com/products/calculator
* Firebase pricing: https://firebase.google.com/pricing

## Changelog

* **2026-05-19 v1:** Draft inicial. Modelo construido sobre escenarios A/B/C y la directiva founder de cero costo variable (ADR 0005 v4). Pendiente validación contra Google Cloud Pricing Calculator real.
