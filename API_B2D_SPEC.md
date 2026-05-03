# Praeventio Guard — API B2D Spec (OpenAPI 3.1, draft)

> **Status:** draft. Sprint 10 entrega solo la especificación. La
> implementación de endpoints está planificada para Sprint 16. No
> existen rutas vivas todavía — esta página fija el contrato.
>
> **Decisión D4 (2026-05-03):** capa B2D paralela al modelo B2B de 10
> tiers. 3 APIs individuales (A Climate, B Hazmat, C Normativa) + 1
> Suite (D = combo + Gemini AI Coach).
>
> **Frontera inviolable:** el Zettelkasten no se expone (ver §
> "Privacy boundary" más abajo y `PRICING.md §9.3`).

---

## OpenAPI 3.1 declaration

```yaml
openapi: 3.1.0
info:
  title: Praeventio Guard B2D API
  version: 0.1.0-draft
  description: |
    APIs públicas de Praeventio para desarrolladores y agentes de IA.
    Tres APIs individuales (Climate, Hazmat/Bernoulli, Normativa
    CL+LATAM) y una Suite que combina las tres con un AI Coach
    Gemini-backed.

    El Zettelkasten interno (nodos de proyecto, telemetría, IPER, EPP,
    documentos del tenant) NO está disponible en esta API por
    contrato. Ver §"Privacy boundary".
  contact:
    name: Praeventio Guard
    url: https://praeventio.net
servers:
  - url: https://api.praeventio.net/v1
    description: Production
  - url: https://api.staging.praeventio.net/v1
    description: Staging
security:
  - ApiKeyAuth: []
components:
  securitySchemes:
    ApiKeyAuth:
      type: apiKey
      in: header
      name: X-Praeventio-Api-Key
      description: |
        API key estática emitida por el panel B2D Praeventio.
        Formato: `pvtio_live_<32 chars>` o `pvtio_test_<32 chars>`.
        Rotación auto-self-service desde el panel.
```

### Auth

- **Header obligatorio:** `X-Praeventio-Api-Key: pvtio_live_<32 chars>`.
- Una API key viaja vinculada a un tier (de los 8 definidos en
  `aiTier.ts`). El servidor resuelve `tier → cuota → rate limit`.
- Un cliente puede tener varias keys (una por entorno o sub-producto).
  La cuota se agrega por cliente, no por key.

### Rate-limit headers (en cada respuesta)

| Header                  | Significado                                        |
| ----------------------- | -------------------------------------------------- |
| `X-RateLimit-Limit`     | Máximo de requests por la ventana actual           |
| `X-RateLimit-Remaining` | Requests que quedan disponibles                    |
| `X-RateLimit-Reset`     | Epoch UTC en segundos cuando el contador resetea   |
| `X-Praeventio-Quota`    | Requests usados / cuota mensual del tier           |

Cuando la cuota o el rate-limit se exceden, el servidor responde con
`429 Too Many Requests` y un body `application/problem+json` (RFC
7807).

---

## A — Climate & Environmental Intelligence

### `GET /v1/climate/bulletin`

Retorna el boletín climático Praeventio para una coordenada. Wrapper
sobre Open-Meteo + lógica interna (índice de inversión cruzada, tier
por altitud, alertas locales).

**Query params**

| Param | Type   | Required | Notes                                  |
| ----- | ------ | -------- | -------------------------------------- |
| `lat` | number | yes      | Latitud decimal, rango `[-90, 90]`     |
| `lng` | number | yes      | Longitud decimal, rango `[-180, 180]`  |

**Response 200** — `application/json`

```json
{
  "lat": -33.45,
  "lng": -70.66,
  "altitudeTier": "high",
  "bulletin": {
    "tempC": 14.3,
    "windKmh": 22.0,
    "humidityPct": 64,
    "uvIndex": 5,
    "thermalInversion": false
  },
  "themeInversion": "normal",
  "fetchedAt": "2026-05-03T14:00:00Z"
}
```

### `GET /v1/climate/seismic`

Eventos sísmicos USGS recientes filtrados por radio. Útil para apps de
seguro paramétrico o asistentes que monitoreen una faena.

**Query params**

| Param    | Type   | Required | Notes                                |
| -------- | ------ | -------- | ------------------------------------ |
| `lat`    | number | yes      | Centro del radio                     |
| `lng`    | number | yes      | Centro del radio                     |
| `radius` | number | yes      | Radio en km, rango `[1, 1000]`       |
| `since`  | string | no       | ISO 8601; default = últimas 24 h     |

### `GET /v1/climate/solar`

Tracker solar/lunar para una fecha y coordenada (sunrise, sunset, lunar
phase, solar noon, civil/nautical/astronomical twilight).

**Query params**

| Param  | Type   | Required | Notes              |
| ------ | ------ | -------- | ------------------ |
| `lat`  | number | yes      |                    |
| `lng`  | number | yes      |                    |
| `date` | string | no       | ISO 8601 yyyy-mm-dd; default = hoy UTC |

---

## B — Hazmat & Engineering Calculations (Bernoulli)

Funciones puras del módulo `bernoulliEngine` + 15 casos de uso
extendidos. Todos los endpoints son `POST` con body JSON; se diseñan
para ser idempotentes (mismo input → mismo output) y libres de side
effects.

### `POST /v1/hazmat/bernoulli/dynamic-pressure`

Calcula presión dinámica `q = ½ ρ v²`.

**Request body**

```json
{
  "velocity": 12.5,
  "density": 1.225
}
```

**Response 200**

```json
{
  "dynamicPressurePa": 95.7,
  "inputs": { "velocity": 12.5, "density": 1.225 }
}
```

### `POST /v1/hazmat/bernoulli/venturi-flow`

Flujo en una constricción Venturi: dados los diámetros, retorna
velocidad y presión en la garganta.

### `POST /v1/hazmat/wind-load`

Carga de viento sobre estructura plana. Body incluye `velocity`,
`area`, `dragCoefficient`.

### `POST /v1/hazmat/respirator-fatigue`

Estima fatiga respiratoria por tiempo de uso, FRR (Filter Resistance
Rating) y tasa metabólica del trabajador (input genérico — no se
referencia ningún trabajador real del Zettelkasten).

### `POST /v1/hazmat/calculate/{useCaseId}`

Endpoint genérico que despacha sobre los 15 casos de uso
`BERNOULLI_EXTENSIONS`. `useCaseId` es uno de:

```
dew-point, vapor-pressure, terminal-velocity, drag-coefficient,
reynolds-number, mach-number, stagnation-pressure, cavitation-index,
weber-number, froude-number, knudsen-number, peclet-number,
schmidt-number, prandtl-number, grashof-number
```

**Path param** `useCaseId`. **Body** depende del caso (ver schema
runtime devuelto por `GET /v1/hazmat/use-cases/{useCaseId}/schema`).

---

## C — Normativa Chilena & LATAM Compliance

### `GET /v1/normativa/chile/{ds}`

Texto, alcance, sanciones y referencias cruzadas de una normativa CL.
`{ds}` es uno de los 15 documentos cubiertos: `ds-54`, `ds-40`,
`ds-594`, `ley-16744`, `nch-1411`, `nch-1258`, `nch-2245`, `dto-67`,
`dto-101`, etc.

**Response 200**

```json
{
  "id": "ds-594",
  "fullName": "DS 594 — Condiciones sanitarias y ambientales básicas",
  "scope": "Lugares de trabajo en Chile.",
  "lastUpdated": "2024-09-12",
  "fallback": "iso-45001",
  "articles": [/* lista de artículos resumidos */]
}
```

### `GET /v1/normativa/iso/45001/{section}`

ISO 45001 actúa como fallback global cuando un país no tiene pack
local. `{section}` ∈ `4`, `5`, `6`, `7`, `8`, `9`, `10` (cláusulas
estándar).

### `GET /v1/normativa/latam/{country}/{topic}`

Roadmap LATAM. `{country}` ∈ `peru`, `colombia`, `mexico`, `argentina`,
`brasil`, `ecuador`. `{topic}` ∈ `general`, `psicosocial`, `quimicos`,
`alturas`, `comites-paritarios`, etc.

### `POST /v1/normativa/applies-to`

Dado un contexto de proyecto (genérico, sin datos del tenant), retorna
qué normativas aplican. Útil para asistentes legales y check-lists
verticales.

**Request body**

```json
{
  "country": "CL",
  "industryCode": "construction",
  "tasks": ["working-at-height", "hot-work"],
  "workforceSize": 120
}
```

**Response 200**

```json
{
  "applicable": [
    { "id": "ds-594", "reason": "Aplica a todos los lugares de trabajo CL" },
    { "id": "ds-40",  "reason": "Construcción + hot work" }
  ],
  "fallbacks": ["iso-45001"]
}
```

---

## D — Praeventio Intelligence Suite

Endpoints de A+B+C accesibles bajo el mismo prefijo `/v1/suite/...`,
más el AI Coach.

### `POST /v1/suite/ai-coach`

Pregunta de prevención respondida por Gemini con contexto Praeventio
(catálogo normativo + motores Bernoulli + datos climáticos públicos).

**Request body**

```json
{
  "question": "¿Qué EPP exige DS 594 para trabajos en altura?",
  "context": {
    "country": "CL",
    "industry": "construction"
  }
}
```

**Response 200**

```json
{
  "answer": "DS 594 art. ... exige ... [respuesta del Coach]",
  "citations": [
    { "type": "normativa", "id": "ds-594", "article": "53" }
  ],
  "model": "gemini-2.5-pro",
  "tokensUsed": 1284
}
```

> **Consentimiento explícito requerido para integraciones de
> tutoring** que involucren a usuarios finales identificables. El
> integrador es responsable de obtener ese consentimiento. El Coach
> **NO consulta** datos de tenants Praeventio: opera solo sobre el
> input del integrador y la base de conocimiento pública. Esta regla
> es contractual (PRICING.md §9.3).

---

## Error model — RFC 7807 problem details

Todas las respuestas 4xx/5xx usan `Content-Type: application/problem+json`.

**Shape**

```json
{
  "type": "https://api.praeventio.net/problems/<slug>",
  "title": "Short human title",
  "status": 429,
  "detail": "Mensaje específico al request",
  "instance": "/v1/climate/bulletin",
  "praeventioCode": "RATE_LIMIT_EXCEEDED"
}
```

**Mapping**

| HTTP | `praeventioCode`              | Cuándo                                                         |
| ---- | ----------------------------- | -------------------------------------------------------------- |
| 400  | `INVALID_REQUEST`             | Body / query param mal formado o fuera de rango                |
| 401  | `MISSING_API_KEY`             | Header `X-Praeventio-Api-Key` ausente                          |
| 403  | `API_KEY_INVALID`             | Key revocada o no encontrada                                   |
| 403  | `TIER_DOES_NOT_INCLUDE`       | El tier no cubre la API solicitada (p.ej. climate-base llamando hazmat) |
| 404  | `RESOURCE_NOT_FOUND`          | Normativa, caso de uso o coordenada inexistente                |
| 409  | `IDEMPOTENCY_CONFLICT`        | Replay con mismo `Idempotency-Key` y body distinto             |
| 422  | `SCHEMA_VALIDATION_FAILED`    | Body válido JSON pero no cumple el schema del endpoint         |
| 429  | `RATE_LIMIT_EXCEEDED`         | Excede `perSecond` o `perDay`                                  |
| 429  | `MONTHLY_QUOTA_EXCEEDED`      | Excede `requestsPerMonth` (suele acompañarse de overage charge) |
| 500  | `INTERNAL_ERROR`              | Bug del servidor                                               |
| 502  | `UPSTREAM_ERROR`              | Open-Meteo / USGS / Gemini caído o respondió mal               |
| 503  | `SERVICE_UNAVAILABLE`         | Mantenimiento o circuit-breaker abierto                        |
| 504  | `UPSTREAM_TIMEOUT`            | Upstream no respondió a tiempo                                 |

---

## Privacy boundary — qué NO está disponible

Esta API **no expone** y nunca expondrá los siguientes datos, sin
importar el tier contratado:

| Categoría                     | Origen interno (referencia)                |
| ----------------------------- | ------------------------------------------ |
| Nodos del Zettelkasten        | `tenants/{tenantId}/zettelkasten/...`      |
| Proyectos / faenas del tenant | `tenants/{tenantId}/projects/...`          |
| Hallazgos IPER                | `tenants/{tenantId}/iper/...`              |
| Telemetría de campo           | `tenants/{tenantId}/telemetry/...`         |
| EPP por trabajador            | `tenants/{tenantId}/epp/...`               |
| Evaluaciones psicosociales    | `tenants/{tenantId}/psychosocial/...`      |
| Documentos legales firmados   | `tenants/{tenantId}/documents/...`         |
| Members / roles del tenant    | `tenants/{tenantId}/members/...`           |
| Auditoría / logs internos     | `audit_logs/...`                           |
| Datos de facturación          | `invoices/...`, `processed_webpay/...`     |
| Caches privadas               | `*_cache/...` (excepto datos públicos derivados) |

Si una request demuestra intentar acceder a estas rutas (por
inferencia, por ejemplo, mandando un `tenantId` esperando un join), el
servidor responde `403 SCOPE_OUT_OF_API` y registra el intento en una
tabla interna anti-abuse.

**Recíprocamente, lo que SÍ está disponible:**

- Datos climáticos / sísmicos públicos enriquecidos con la lógica
  Praeventio.
- Funciones puras del motor Bernoulli y sus 15 casos de uso (toman
  inputs genéricos, no leen estado).
- Catálogo normativo CL + LATAM + ISO 45001 fallback.
- AI Coach respondiendo sobre el input del integrador y la base
  pública (jamás consulta tenants).

---

## Idempotencia

Endpoints `POST` aceptan header opcional `Idempotency-Key: <uuid>`. El
servidor cachea la respuesta por 24h y replays con la misma key
retornan el mismo body. Replays con misma key y body distinto retornan
`409 IDEMPOTENCY_CONFLICT`.

## Versionado

Prefijo `/v1`. Cambios breaking se publican como `/v2` con 12 meses de
deprecation overlap. Cambios non-breaking se anuncian via
`X-Praeventio-Api-Deprecation` en respuestas afectadas.

---

*Praeventio Guard B2D · Draft Sprint 10 · Implementación Sprint 16.*
