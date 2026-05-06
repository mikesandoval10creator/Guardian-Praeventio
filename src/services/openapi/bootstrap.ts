// SPDX-License-Identifier: MIT
// Sprint 36 — OpenAPI registry bootstrap.
//
// Centralised place where every public-facing route registers its
// OpenAPI metadata. Keeping registrations in one file (rather than
// scattered through routes/*.ts) means:
//   - The `validate(schema)` middleware in each route is untouched.
//   - One can audit the public surface area at a glance.
//   - Internal-only routes (admin, scheduler) simply aren't listed here.
//
// Imported once from `src/server/routes/openapi.ts` before the spec is
// served. Idempotent (`registerRoute` appends; `registerComponent` is
// keyed and de-duplicated).

import { z } from 'zod';
import { registerComponent, registerRoute } from './registry.js';

let bootstrapped = false;

export function bootstrapOpenApiRegistry(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  // ─────────────────────────── Common error envelope ──
  const ErrorEnvelope = z.object({
    error: z.string(),
    issue: z.unknown().optional(),
    issues: z.unknown().optional(),
    message: z.string().optional(),
  });
  registerComponent('ErrorEnvelope', ErrorEnvelope);

  // =====================================================================
  // B2D / Climate
  // =====================================================================
  const ClimateCurrentResp = z.object({
    coordinates: z.object({ lat: z.number(), lng: z.number() }),
    weather: z.object({
      tempC: z.number(),
      humidityPct: z.number(),
      windKmh: z.number(),
      windDirectionDeg: z.number(),
      pressureHpa: z.number(),
      uvIndex: z.number(),
      cloudCoverPct: z.number(),
    }),
    seismic: z.object({
      last24hMaxMagnitude: z.number().nullable(),
      nearbyEventCount: z.number(),
      source: z.string(),
    }),
    airQuality: z.object({
      pm25UgM3: z.number().nullable(),
      pm10UgM3: z.number().nullable(),
      aqi: z.number().nullable(),
      source: z.string(),
    }),
    citations: z.array(z.string()),
    provenance: z.string(),
    computedAt: z.string(),
  });
  registerComponent('ClimateCurrentResponse', ClimateCurrentResp);

  registerRoute({
    path: '/api/b2d/v1/climate/current',
    method: 'get',
    summary: 'Current weather + seismic + air-quality snapshot',
    description: 'Returns climate snapshot for given coordinates. Scope `climate.read`.',
    tags: ['B2D / Climate'],
    parameters: [
      { name: 'lat', in: 'query', required: true, description: 'Latitude (-90 to 90)', schema: z.number().min(-90).max(90) },
      { name: 'lng', in: 'query', required: true, description: 'Longitude (-180 to 180)', schema: z.number().min(-180).max(180) },
    ],
    responses: {
      '200': { description: 'Climate snapshot', schema: ClimateCurrentResp },
      '400': { description: 'Invalid coordinates', schema: ErrorEnvelope },
      '401': { description: 'Missing or invalid B2D API key', schema: ErrorEnvelope },
      '403': { description: 'Scope `climate.read` not granted', schema: ErrorEnvelope },
      '429': { description: 'Quota or rate limit exceeded', schema: ErrorEnvelope },
    },
    security: ['b2dApiKey'],
    b2dScopes: ['climate.read'],
  });

  registerRoute({
    path: '/api/b2d/v1/climate/forecast',
    method: 'get',
    summary: '7-day weather forecast',
    description: 'Forecast for given coordinates. Scope `climate.forecast` (climate-pro tier).',
    tags: ['B2D / Climate'],
    parameters: [
      { name: 'lat', in: 'query', required: true, schema: z.number() },
      { name: 'lng', in: 'query', required: true, schema: z.number() },
      { name: 'days', in: 'query', required: false, description: '1..14, default 7', schema: z.number().int().min(1).max(14) },
    ],
    responses: {
      '200': { description: 'Forecast' },
      '400': { description: 'Invalid input', schema: ErrorEnvelope },
      '403': { description: 'Scope `climate.forecast` not granted', schema: ErrorEnvelope },
    },
    security: ['b2dApiKey'],
    b2dScopes: ['climate.forecast'],
  });

  registerRoute({
    path: '/api/b2d/v1/climate/risk-score',
    method: 'get',
    summary: 'Composite industry risk score',
    tags: ['B2D / Climate'],
    parameters: [
      { name: 'lat', in: 'query', required: true, schema: z.number() },
      { name: 'lng', in: 'query', required: true, schema: z.number() },
      { name: 'industry', in: 'query', required: false, schema: z.enum(['general', 'mining', 'construction', 'agriculture', 'logistics']) },
    ],
    responses: {
      '200': { description: 'Risk score 0..100 + band' },
      '400': { description: 'Invalid input', schema: ErrorEnvelope },
    },
    security: ['b2dApiKey'],
    b2dScopes: ['climate.read'],
  });

  // =====================================================================
  // B2D / Hazmat (engineering calcs)
  // =====================================================================
  const PipePressureSchema = z.object({
    pipe: z.object({
      id: z.string().min(1),
      velocityInMs: z.number().positive(),
      velocityOutMs: z.number().positive(),
      heightDeltaM: z.number().finite(),
    }),
    fluid: z.object({
      id: z.string().min(1),
      densityKgM3: z.number().positive(),
      vaporPressurePa: z.number().nonnegative(),
    }),
    pumpHead: z.object({ upstreamPressurePa: z.number().finite() }),
  });
  registerComponent('PipePressureRequest', PipePressureSchema);

  registerRoute({
    path: '/api/b2d/v1/hazmat/pipe-pressure',
    method: 'post',
    summary: 'Bernoulli pipe-pressure check',
    tags: ['B2D / Hazmat'],
    requestBody: { schema: PipePressureSchema, description: 'Pipe + fluid + pump-head inputs' },
    responses: {
      '200': { description: 'Pressure node + citations' },
      '400': { description: 'Invalid input', schema: ErrorEnvelope },
    },
    security: ['b2dApiKey'],
    b2dScopes: ['hazmat.calculate'],
  });

  const GasDispersionSchema = z.object({
    leak: z.object({
      id: z.string().min(1),
      releaseRateKgS: z.number().positive(),
      idlhMgM3: z.number().positive(),
      relativeDensity: z.number().positive(),
    }),
    weather: z.object({
      windKmh: z.number().positive(),
      pasquillStability: z.enum(['A', 'B', 'C', 'D', 'E', 'F']),
    }),
    terrain: z.object({ id: z.string().min(1), roughnessM: z.number().positive() }),
  });
  registerComponent('GasDispersionRequest', GasDispersionSchema);

  registerRoute({
    path: '/api/b2d/v1/hazmat/gas-dispersion',
    method: 'post',
    summary: 'Pasquill-Gifford gas dispersion exclusion zone',
    tags: ['B2D / Hazmat'],
    requestBody: { schema: GasDispersionSchema },
    responses: {
      '200': { description: 'Exclusion zone result' },
      '400': { description: 'Invalid input', schema: ErrorEnvelope },
    },
    security: ['b2dApiKey'],
    b2dScopes: ['hazmat.calculate'],
  });

  const ScaffoldUpliftSchema = z.object({
    scaffold: z.object({ id: z.string(), areaM2: z.number().positive(), pressureCoefficient: z.number() }),
    weather: z.object({ windKmh: z.number().positive() }),
    anchorage: z.object({ ratedCapacityN: z.number().positive(), anchorCount: z.number().int().positive() }),
  });
  registerComponent('ScaffoldUpliftRequest', ScaffoldUpliftSchema);

  registerRoute({
    path: '/api/b2d/v1/hazmat/scaffold-uplift',
    method: 'post',
    summary: 'Scaffold wind-uplift anchorage check',
    tags: ['B2D / Hazmat'],
    requestBody: { schema: ScaffoldUpliftSchema },
    responses: { '200': { description: 'Anchorage sufficiency result' }, '400': { description: 'Invalid input', schema: ErrorEnvelope } },
    security: ['b2dApiKey'],
    b2dScopes: ['hazmat.calculate'],
  });

  const ExtinguisherCoverageSchema = z.object({
    workstations: z.array(z.object({ id: z.string(), position: z.object({ x: z.number(), y: z.number(), z: z.number() }) })).min(1),
    extinguishers: z.array(
      z.object({
        id: z.string(),
        kind: z.enum(['extinguisher_pqs', 'extinguisher_co2', 'extinguisher_water']),
        position: z.object({ x: z.number(), y: z.number(), z: z.number() }),
        lifecycle: z.enum(['active', 'installed', 'planning', 'retired']).optional(),
      }),
    ),
  });
  registerComponent('ExtinguisherCoverageRequest', ExtinguisherCoverageSchema);

  registerRoute({
    path: '/api/b2d/v1/hazmat/extinguisher-coverage',
    method: 'post',
    summary: 'DS 594 art. 47 extinguisher coverage check',
    tags: ['B2D / Hazmat'],
    requestBody: { schema: ExtinguisherCoverageSchema },
    responses: { '200': { description: 'Compliance + violations list' }, '400': { description: 'Invalid input', schema: ErrorEnvelope } },
    security: ['b2dApiKey'],
    b2dScopes: ['hazmat.calculate'],
  });

  // =====================================================================
  // B2D / Normativa
  // =====================================================================
  registerRoute({
    path: '/api/b2d/v1/normativa/search',
    method: 'get',
    summary: 'Full-text search of regulation pack',
    tags: ['B2D / Normativa'],
    parameters: [
      { name: 'q', in: 'query', required: true, schema: z.string().min(1) },
      { name: 'country', in: 'query', required: false, schema: z.enum(['CL', 'PE', 'CO', 'MX', 'AR', 'BR', 'ISO']) },
      { name: 'type', in: 'query', required: false, schema: z.string() },
    ],
    responses: { '200': { description: 'Matches' }, '400': { description: 'Bad input', schema: ErrorEnvelope } },
    security: ['b2dApiKey'],
    b2dScopes: ['normativa.search'],
  });

  registerRoute({
    path: '/api/b2d/v1/normativa/by-id/:id',
    method: 'get',
    summary: 'Fetch regulation by id',
    tags: ['B2D / Normativa'],
    parameters: [{ name: 'id', in: 'path', required: true, schema: z.string() }],
    responses: { '200': { description: 'Regulation entry' }, '404': { description: 'Not found', schema: ErrorEnvelope } },
    security: ['b2dApiKey'],
    b2dScopes: ['normativa.search'],
  });

  const NormativaValidateSchema = z.object({
    industry: z.string().min(1),
    country: z.enum(['CL', 'PE', 'CO', 'MX', 'AR', 'BR', 'ISO']).default('CL'),
    riskCategory: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
    mitigations: z.array(z.string()).default([]),
  });
  registerComponent('NormativaValidateRequest', NormativaValidateSchema);

  registerRoute({
    path: '/api/b2d/v1/normativa/validate',
    method: 'post',
    summary: 'Compliance gap check',
    tags: ['B2D / Normativa'],
    requestBody: { schema: NormativaValidateSchema },
    responses: { '200': { description: 'Compliance + gaps' }, '400': { description: 'Bad input', schema: ErrorEnvelope } },
    security: ['b2dApiKey'],
    b2dScopes: ['normativa.validate'],
  });

  // =====================================================================
  // B2D / Suite
  // =====================================================================
  const CoachSchema = z.object({
    industry: z.string().min(1).max(64),
    scenario: z.string().min(1).max(2000),
    riskCategory: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
    language: z.enum(['es', 'en', 'pt']).default('es'),
    mitigations: z.array(z.string()).default([]),
  });
  registerComponent('CoachRequest', CoachSchema);

  registerRoute({
    path: '/api/b2d/v1/suite/coach',
    method: 'post',
    summary: 'AI safety coach (deterministic; no Zettelkasten access)',
    description:
      'The coach NEVER reads tenant Zettelkasten. Pure function over the request body.',
    tags: ['B2D / Suite'],
    requestBody: { schema: CoachSchema },
    responses: { '200': { description: 'Guidance + citations' }, '400': { description: 'Invalid input', schema: ErrorEnvelope } },
    security: ['b2dApiKey'],
    b2dScopes: ['suite.all'],
  });

  // =====================================================================
  // In-app: DTE
  // =====================================================================
  const DteCustomer = z.object({
    rut: z.string().min(1),
    razonSocial: z.string().min(1),
    direccion: z.string(),
    comuna: z.string(),
    ciudad: z.string(),
  });
  const DteItem = z.object({
    description: z.string().min(1),
    quantity: z.number().positive(),
    unitPriceClp: z.number().nonnegative(),
    taxable: z.boolean(),
  });
  const DteCreateSchema = z.object({
    type: z.enum(['factura_electronica', 'boleta_electronica', 'boleta_exenta', 'nota_credito', 'nota_debito']),
    customer: DteCustomer,
    items: z.array(DteItem).min(1),
  });
  registerComponent('DteCreateRequest', DteCreateSchema);

  registerRoute({
    path: '/api/dte/create',
    method: 'post',
    summary: 'Manual DTE emission (admin-only)',
    description: 'Wraps Bsale adapter. Admin role required. Praeventio NEVER pushes to SII.',
    tags: ['DTE / SII'],
    requestBody: { schema: DteCreateSchema },
    responses: {
      '200': { description: 'DTE created in Bsale' },
      '401': { description: 'Auth missing', schema: ErrorEnvelope },
      '403': { description: 'Admin role required', schema: ErrorEnvelope },
      '503': { description: 'DTE not configured (BSALE_* env missing)', schema: ErrorEnvelope },
    },
    security: ['bearerAuth'],
  });

  registerRoute({
    path: '/api/dte/:folio',
    method: 'get',
    summary: 'Fetch DTE status by folio',
    tags: ['DTE / SII'],
    parameters: [{ name: 'folio', in: 'path', required: true, schema: z.string() }],
    responses: {
      '200': { description: 'Live status from Bsale' },
      '404': { description: 'Folio not found', schema: ErrorEnvelope },
    },
    security: ['bearerAuth'],
  });

  registerRoute({
    path: '/api/dte/:folio/cancel',
    method: 'post',
    summary: 'Cancel DTE via Nota de Crédito',
    tags: ['DTE / SII'],
    parameters: [{ name: 'folio', in: 'path', required: true, schema: z.string() }],
    responses: { '200': { description: 'Cancellation accepted' }, '404': { description: 'Folio not found', schema: ErrorEnvelope } },
    security: ['bearerAuth'],
  });

  // =====================================================================
  // In-app: IoT
  // =====================================================================
  const IOT_DEVICE_TYPES = [
    'gas_sensor',
    'wind_anemometer',
    'vibration_accel',
    'co_meter',
    'pressure_gauge',
    'flow_meter',
    'temperature',
    'humidity',
    'other',
  ] as const;

  const RegisterDeviceSchema = z.object({
    deviceId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_\-:.]+$/),
    projectId: z.string().min(1).max(128),
    type: z.enum(IOT_DEVICE_TYPES),
    secret: z.string().min(8).max(512).optional(),
  });
  registerComponent('IotRegisterDeviceRequest', RegisterDeviceSchema);

  registerRoute({
    path: '/api/iot/devices/register',
    method: 'post',
    summary: 'Enrol an IoT device into a tenant',
    description: 'Admin or supervisor-tier role required. Worker tokens are rejected.',
    tags: ['IoT'],
    requestBody: { schema: RegisterDeviceSchema },
    responses: {
      '200': { description: '`{ ok, deviceId, tenantId }`' },
      '400': { description: 'invalid_payload', schema: ErrorEnvelope },
      '403': { description: 'Insufficient role', schema: ErrorEnvelope },
    },
    security: ['bearerAuth'],
  });

  // =====================================================================
  // In-app: AI feedback (RLHF loop)
  // =====================================================================
  const FeedbackBodySchema = z.object({
    messageId: z.string().min(1).max(128),
    vote: z.enum(['up', 'down']),
    rationale: z.string().max(2000).optional(),
    response: z.string().max(8000),
    domain: z.string().max(64).optional(),
    sessionLengthMs: z.number().int().nonnegative().optional(),
  });
  registerComponent('AiFeedbackRequest', FeedbackBodySchema);

  registerRoute({
    path: '/api/ai/feedback',
    method: 'post',
    summary: 'Submit RLHF feedback on an AI message',
    tags: ['AI / Feedback'],
    requestBody: { schema: FeedbackBodySchema },
    responses: {
      '200': { description: 'Feedback recorded' },
      '400': { description: 'invalid_payload', schema: ErrorEnvelope },
      '409': { description: 'Replay detected (use ?force=1 to override)', schema: ErrorEnvelope },
    },
    security: ['bearerAuth'],
  });

  registerRoute({
    path: '/api/ai/feedback/summary',
    method: 'get',
    summary: 'Aggregated feedback over the last 7 days',
    tags: ['AI / Feedback'],
    responses: { '200': { description: 'Summary buckets' } },
    security: ['bearerAuth'],
  });

  // =====================================================================
  // Public: OpenAPI itself (so it's listed in its own spec)
  // =====================================================================
  registerRoute({
    path: '/api/openapi.json',
    method: 'get',
    summary: 'OpenAPI 3.1 spec for this API (auto-generated from Zod)',
    tags: ['Meta'],
    responses: { '200': { description: 'OpenAPI 3.1 document' } },
    security: [],
  });

  registerRoute({
    path: '/api/openapi.html',
    method: 'get',
    summary: 'Swagger UI for the OpenAPI spec',
    tags: ['Meta'],
    responses: { '200': { description: 'Swagger UI HTML page' } },
    security: [],
  });
}
