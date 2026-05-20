// Praeventio Guard — structured logger.
//
// Sprint 22 Bucket AA — added per-request `request_id` auto-tagging via
// AsyncLocalStorage. Anything logged inside a request handler picks up
// the request_id automatically without callers having to thread it
// through every helper. Outside a request (boot, intervals, jobs) the
// request_id field is simply absent.

// `AsyncLocalStorage` is a Node-only API. The logger is bundled into BOTH
// the server and the browser bundle, so we feature-detect at module load
// and fall back to a no-op store on the client. The browser code path
// uses `console.*` so request-scoped fields are not meaningful there
// anyway — no functionality is lost.

type Severity = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

interface LogEntry {
  severity: Severity;
  message: string;
  [key: string]: unknown;
}

interface RequestLogContext {
  requestId?: string;
  traceId?: string;
  // Optional caller-set fields. Routes can attach uid/projectId here
  // and any nested log call will inherit them automatically.
  uid?: string;
  projectId?: string;
}

interface AsyncStoreLike<T> {
  getStore(): T | undefined;
  run<R>(store: T, fn: () => R): R;
}

const isNode = typeof process !== 'undefined' && !!(process as any)?.versions?.node && typeof window === 'undefined';

let requestStore: AsyncStoreLike<RequestLogContext>;
if (isNode) {
  // Use `eval('require')` so Vite's static analysis doesn't try to bundle
  // node:async_hooks for the browser build. Server boot resolves it via
  // CommonJS interop on first import.
  try {
     
    const { AsyncLocalStorage } = (0, eval)('require')('node:async_hooks') as typeof import('node:async_hooks');
    requestStore = new AsyncLocalStorage<RequestLogContext>();
  } catch {
    requestStore = createNoopStore();
  }
} else {
  requestStore = createNoopStore();
}

function createNoopStore(): AsyncStoreLike<RequestLogContext> {
  return {
    getStore: () => undefined,
    run: <R>(_store: RequestLogContext, fn: () => R) => fn(),
  };
}

const isProduction = typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';

function log(severity: Severity, message: string, meta?: Record<string, unknown>) {
  const ctx = requestStore.getStore();
  const requestId = ctx?.requestId;
  const traceId = ctx?.traceId;
  const ctxMeta: Record<string, unknown> = {};
  if (requestId) ctxMeta.request_id = requestId;
  if (traceId) ctxMeta.trace_id = traceId;
  if (ctx?.uid) ctxMeta.uid = ctx.uid;
  if (ctx?.projectId) ctxMeta.project_id = ctx.projectId;

  if (isProduction) {
    // Cloud Run: JSON to stdout → auto-ingested by Cloud Logging
    const entry: LogEntry = {
      severity,
      message,
      timestamp: new Date().toISOString(),
      ...ctxMeta,
      ...meta,
    };
    process.stdout?.write(JSON.stringify(entry) + '\n');
  } else {
    const label = `[${severity}]`;
    const combinedMeta = Object.keys(ctxMeta).length || meta
      ? { ...ctxMeta, ...meta }
      : '';
    if (severity === 'ERROR' || severity === 'CRITICAL') {
      console.error(label, message, combinedMeta);
    } else if (severity === 'WARNING') {
      console.warn(label, message, combinedMeta);
    } else {
      console.log(label, message, combinedMeta);
    }
  }
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => log('DEBUG', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => log('INFO', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => log('WARNING', message, meta),
  error: (message: string, error?: unknown, meta?: Record<string, unknown>) => {
    const errorMeta = error instanceof Error
      ? { errorMessage: error.message, stack: error.stack }
      : error != null ? { error: String(error) } : {};
    log('ERROR', message, { ...errorMeta, ...meta });
  },
  critical: (message: string, error?: unknown, meta?: Record<string, unknown>) => {
    const errorMeta = error instanceof Error
      ? { errorMessage: error.message, stack: error.stack }
      : error != null ? { error: String(error) } : {};
    log('CRITICAL', message, { ...errorMeta, ...meta });
  },
};

/**
 * Run `fn` with a request-scoped log context. Every `logger.*` call made
 * synchronously OR asynchronously inside `fn` will be tagged with the
 * fields in `ctx`. Used by the request-id middleware in `server.ts`.
 */
export function runWithRequestContext<T>(ctx: RequestLogContext, fn: () => T): T {
  return requestStore.run(ctx, fn);
}

/** Read (and optionally mutate) the active request log context. Returns
 *  `undefined` when called outside a request scope. */
export function getRequestContext(): RequestLogContext | undefined {
  return requestStore.getStore();
}
