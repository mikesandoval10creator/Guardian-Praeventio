// Praeventio Guard — Sprint 22 Bucket AA.
//
// OpenTelemetry tracing helper.
//
// Goal: provide a single `tracedAsync(spanName, attributes, fn)` API so
// critical request handlers (gemini, zettelkasten, emergency, billing)
// can be wrapped without leaking OTel boilerplate at every call site.
//
// Behavior:
//   • If `@opentelemetry/api` resolves at runtime, real spans are created
//     and attributes/error status/baggage are propagated. The actual
//     exporter (OTLP → Cloud Trace, Jaeger, etc.) is configured at boot
//     by `initTracing()`. If the SDK packages are missing the bootstrap
//     becomes a no-op and `tracedAsync` falls back to STRUCTURED LOGS —
//     same surface, lower fidelity. This matches Bucket AA's tone:
//     "if OTel SDK setup is complex, the wraps `tracedAsync` may be stubs
//     that only emit structured logs — the real trace with exporter is
//     a TODO, but the pattern is in code".
//
//   • A failure inside `fn` is recorded on the active span (status =
//     ERROR + recordException) and re-thrown so the caller's control
//     flow is unchanged. Observability layer must NEVER mask the real
//     error.
//
//   • A failure inside the OTel SDK ITSELF (init, span creation, etc.)
//     is swallowed; the function still runs and the error path still
//     re-throws the business error.
//
// PII NOTE: Attributes go to the trace backend. Do NOT pass raw user
// input, prompts, or tokens — pass tenantId, projectId, action enum,
// counts. Same contract as `withSentryScope`.

import { logger } from '../../utils/logger.js';

/** Attributes forwarded to the span. Stay primitive — booleans, numbers,
 *  strings. No nested objects (OTel rejects them silently). */
export type TraceAttributes = Record<string, string | number | boolean | undefined | null>;

/** Lazy-loaded OTel API surface. We resolve once and cache `null` if the
 *  package is missing so the hot path is a single `if (!cached)` check. */
type OtelApi = typeof import('@opentelemetry/api');

let _otel: OtelApi | null | undefined;

async function loadOtel(): Promise<OtelApi | null> {
  if (_otel !== undefined) return _otel;
  try {
    _otel = await import('@opentelemetry/api');
  } catch {
    _otel = null;
  }
  return _otel;
}

/**
 * Best-effort synchronous lookup. Used inside `tracedAsync` so we don't
 * await an `import()` on every invocation. We rely on `initTracing()`
 * (or the first `tracedAsync` call) to populate `_otel`; until then the
 * fallback path runs.
 */
function getOtelSync(): OtelApi | null {
  return _otel ?? null;
}

/**
 * Boot-time initialization. Called from `server.ts` on startup.
 *
 * The real wiring (NodeSDK + OTLPTraceExporter + auto-instrumentations)
 * lives behind a try/catch — if the SDK packages aren't installed or
 * any init step throws, we degrade to "API only" mode (structured logs
 * still get a request_id but no real trace export). `serviceName` is
 * stored on the resource so traces are filterable in Cloud Trace.
 */
export async function initTracing(serviceName: string): Promise<void> {
  await loadOtel();
  // Real SDK wiring is gated — keep boot quiet when @opentelemetry/sdk-node
  // isn't available (current state). When the ops team installs the SDK
  // packages, this block boots OTLP export to Cloud Trace.
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT && !process.env.OTEL_TRACES_EXPORTER) {
    logger.info('tracing_initialized', {
      serviceName,
      mode: 'api-only',
      note: 'OTLP exporter not configured. Set OTEL_EXPORTER_OTLP_ENDPOINT to enable real trace export.',
    });
    return;
  }
  try {
    // Dynamic import keeps this off the cold-boot path and lets the
    // bundler tree-shake when none of the SDK pieces are present.
    // @ts-ignore — these packages are optional / may not be installed.
    const sdkNode = await import('@opentelemetry/sdk-node').catch(() => null);
    // @ts-ignore — optional dep
    const otlpHttp = await import('@opentelemetry/exporter-trace-otlp-http').catch(() => null);
    // @ts-ignore — optional dep
    const resources = await import('@opentelemetry/resources').catch(() => null);
    // @ts-ignore — optional dep
    const semconv = await import('@opentelemetry/semantic-conventions').catch(() => null);

    if (!sdkNode || !otlpHttp || !resources || !semconv) {
      logger.warn('tracing_sdk_unavailable', {
        serviceName,
        reason: 'OTel SDK packages not installed; staying in api-only mode',
      });
      return;
    }
    const NodeSDK = (sdkNode as any).NodeSDK;
    const OTLPTraceExporter = (otlpHttp as any).OTLPTraceExporter;
    const Resource = (resources as any).Resource;
    const SemAttrs = (semconv as any).SemanticResourceAttributes ?? {};
    const sdk = new NodeSDK({
      resource: new Resource({
        [SemAttrs.SERVICE_NAME ?? 'service.name']: serviceName,
        [SemAttrs.SERVICE_VERSION ?? 'service.version']: process.env.APP_VERSION ?? 'dev',
        [SemAttrs.DEPLOYMENT_ENVIRONMENT ?? 'deployment.environment']: process.env.NODE_ENV ?? 'development',
      }),
      traceExporter: new OTLPTraceExporter({
        url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
      }),
    });
    sdk.start();
    logger.info('tracing_initialized', { serviceName, mode: 'otlp-http' });
  } catch (err) {
    logger.warn('tracing_init_failed', {
      serviceName,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Wrap an async function in a tracer span. Drop-in replacement for
 * directly calling the function: same return type, same throw behavior.
 *
 *   return tracedAsync('ask-guardian', { tenantId, projectId }, async () => {
 *     // existing logic
 *   });
 */
export async function tracedAsync<T>(
  spanName: string,
  attributes: TraceAttributes,
  fn: () => Promise<T>,
): Promise<T> {
  const otel = getOtelSync();
  if (!otel) {
    // Cold path on the very first call — try to load the API. Subsequent
    // calls hit the cached value.
    await loadOtel();
  }
  const api = getOtelSync();
  if (!api) {
    return runWithLogFallback(spanName, attributes, fn);
  }
  try {
    const tracer = api.trace.getTracer('praeventio');
    return await tracer.startActiveSpan(spanName, async (span) => {
      try {
        for (const [k, v] of Object.entries(attributes)) {
          if (v === undefined || v === null) continue;
          try {
            span.setAttribute(k, v as string | number | boolean);
          } catch {
            /* attribute set failure must not change control flow */
          }
        }
      } catch {
        /* swallow */
      }
      try {
        const result = await fn();
        try {
          span.setStatus({ code: api.SpanStatusCode.OK });
        } catch {
          /* swallow */
        }
        return result;
      } catch (err) {
        try {
          span.setStatus({
            code: api.SpanStatusCode.ERROR,
            message: err instanceof Error ? err.message : String(err),
          });
          if (err instanceof Error) {
            span.recordException(err);
          }
        } catch {
          /* observability faults must not mask the real error */
        }
        throw err;
      } finally {
        try {
          span.end();
        } catch {
          /* swallow */
        }
      }
    });
  } catch (err) {
    // OTel API itself faulted (unlikely once `loadOtel` succeeded). Fall
    // back to log-only mode so the business call still runs.
    if (isObservabilitySetupError(err)) {
      return runWithLogFallback(spanName, attributes, fn);
    }
    throw err;
  }
}

/**
 * Fallback when no OTel API is available — emit a structured log with the
 * span name + attributes + duration. Same surface as the traced path so
 * call sites don't care which one fired.
 */
async function runWithLogFallback<T>(
  spanName: string,
  attributes: TraceAttributes,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    logger.debug('trace_span', {
      span: spanName,
      ok: true,
      durationMs: Date.now() - start,
      ...attributes,
    });
    return result;
  } catch (err) {
    logger.warn('trace_span', {
      span: spanName,
      ok: false,
      durationMs: Date.now() - start,
      errorMessage: err instanceof Error ? err.message : String(err),
      ...attributes,
    });
    throw err;
  }
}

function isObservabilitySetupError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('opentelemetry') ||
    msg.includes('otel') ||
    msg.includes('tracer') ||
    msg.includes('not initialized')
  );
}

/**
 * Read the active trace ID (when one exists). Used by request-id
 * middleware so logs and `X-Request-ID` echo the trace context the
 * client should reference in support tickets.
 */
export function getActiveTraceId(): string | null {
  const api = getOtelSync();
  if (!api) return null;
  try {
    const span = api.trace.getActiveSpan();
    if (!span) return null;
    const ctx = span.spanContext();
    return ctx?.traceId ?? null;
  } catch {
    return null;
  }
}
