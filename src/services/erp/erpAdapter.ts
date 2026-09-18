// Praeventio Guard — ERP Integration adapter (honest typed stub).
//
// El audit report (2026-05-15) flagged que `/api/erp/sync` simulaba éxito
// con `setTimeout(1500)` + `success: true`. Esto es exactamente "falsa
// sensación de completitud" — el peor caso para una app de prevención de
// riesgos: una empresa cree que sincronizó su nómina con SAP y resulta
// que no fue nada.
//
// Esta capa reemplaza la simulación con un adapter pattern HONESTO:
//
//   1. Si `ERP_ADAPTER` no está configurado → 503 "not_configured" con
//      mensaje claro: "ERP integration disabled — configure ERP_ADAPTER".
//
//   2. Si `ERP_ADAPTER=mock` → devuelve respuesta determinística marcada
//      explícitamente con `mode: 'mock'` para que el caller sepa que NO
//      es real. Sin setTimeout. Sin pretender conexión ERP.
//
//   3. Si `ERP_ADAPTER=sap|buk|talana` → valida credenciales y expone la
//      interfaz completa tipada. Cada método real sigue siendo stub honesto:
//      lanza `ErpNotImplementedError` con mensaje claro. Nunca devuelve
//      empleados, organigramas, estados o capacitaciones inventadas.
//
// Implementaciones reales SAP/Buk/Talana quedan pendientes hasta que el
// cliente provea credenciales sandbox + contratos API confirmados.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type ErpAdapterName = 'mock' | 'sap' | 'buk' | 'talana';

export type ErpAction =
  | 'manual_sync'
  | 'fetch_employees'
  | 'fetch_org_chart'
  | 'push_worker_status'
  | 'push_training_record';

export interface ErpRequestContext {
  /** Tenant context for multi-tenant isolation. */
  tenantId: string;
  /** Optional project scope. */
  projectId?: string;
}

export interface ErpSyncPayload extends ErpRequestContext {
  /** Tipo de acción solicitada. */
  action: ErpAction;
  /** Datos arbitrarios específicos de la acción. */
  data?: Record<string, unknown>;
}

export interface ErpSyncResult {
  ok: boolean;
  /** Modo de ejecución para que el caller sepa qué pasó realmente. */
  mode:
    | 'real'
    | 'mock'
    | 'not_configured'
    | 'missing_credentials'
    | 'not_implemented'
    | 'failed';
  /** Identificador de la sincronización (UUID o id local del intento). */
  syncId: string;
  /** ISO timestamp del intento. */
  timestamp: string;
  /** Mensaje human-readable. */
  message: string;
  /** Cuando `mode === 'real'`, métricas de la sync (registros leídos/escritos). */
  stats?: {
    recordsRead: number;
    recordsWritten: number;
    recordsSkipped: number;
  };
  /** Cuando `mode !== 'real'`, razón del modo degradado. */
  reason?: string;
}

export interface ErpCredentials {
  baseUrl?: string;
  clientId?: string;
  clientSecret?: string;
  apiKey?: string;
}

type ErpCredentialKey = keyof ErpCredentials;
type ErpAdapterMethod =
  | 'manualSync'
  | 'fetchEmployees'
  | 'fetchOrgChart'
  | 'pushWorkerStatus'
  | 'pushTrainingRecord';

export interface ErpManualSyncRequest extends ErpRequestContext {
  data?: Record<string, unknown>;
}

export interface ErpFetchEmployeesRequest extends ErpRequestContext {
  data?: Record<string, unknown>;
}

export interface ErpEmployeeRecord {
  /** ERP-side immutable employee id. */
  externalId: string;
  /** Display name as supplied by the ERP. */
  displayName?: string;
  /** Work email; callers must treat as PII. */
  email?: string;
  /** Status normalized by a real adapter, never guessed by this stub. */
  status?: 'active' | 'inactive' | 'unknown';
  /** Raw ERP payload for server-side audit only; never expose to browser. */
  raw?: unknown;
}

export interface ErpFetchOrgChartRequest extends ErpRequestContext {
  data?: Record<string, unknown>;
}

export interface ErpOrgUnitRecord {
  /** ERP-side immutable org-unit id. */
  externalId: string;
  name: string;
  parentExternalId?: string;
  raw?: unknown;
}

export interface ErpPushWorkerStatusRequest extends ErpRequestContext {
  workerExternalId?: string;
  status?: 'active' | 'inactive' | 'suspended' | 'on_leave';
  data?: Record<string, unknown>;
}

export interface ErpPushTrainingRecordRequest extends ErpRequestContext {
  workerExternalId?: string;
  trainingExternalId?: string;
  completedAt?: string;
  data?: Record<string, unknown>;
}

export interface ErpPushResult {
  ok: boolean;
  externalId?: string;
  raw?: unknown;
}

export interface ErpAdapter {
  readonly name: ErpAdapterName;
  isConfigured(): boolean;
  sync(payload: ErpSyncPayload): Promise<ErpSyncResult>;
  manualSync(request: ErpManualSyncRequest): Promise<ErpSyncResult>;
  fetchEmployees(request: ErpFetchEmployeesRequest): Promise<readonly ErpEmployeeRecord[]>;
  fetchOrgChart(request: ErpFetchOrgChartRequest): Promise<readonly ErpOrgUnitRecord[]>;
  pushWorkerStatus(request: ErpPushWorkerStatusRequest): Promise<ErpPushResult>;
  pushTrainingRecord(request: ErpPushTrainingRecordRequest): Promise<ErpPushResult>;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled ERP action: ${String(value)}`);
}

function buildRealSyncResult(
  payload: ErpSyncPayload,
  message: string,
  stats: ErpSyncResult['stats'],
): ErpSyncResult {
  return {
    ok: true,
    mode: 'real',
    syncId: `${payload.action}-${payload.tenantId}-${Date.now()}`,
    timestamp: new Date().toISOString(),
    message,
    stats,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Mock adapter — clearly labeled, NO setTimeout, NO real-data fabrication.
// ────────────────────────────────────────────────────────────────────────

/**
 * Adapter de pruebas. Devuelve una respuesta determinística con `mode: 'mock'`
 * para que el front sepa que NO es una sync real.
 *
 * No usa `setTimeout` ni hace I/O. No devuelve empleados/organigramas/estados
 * inventados. Los métodos typed que requerirían datos ERP reales lanzan
 * `ErpNotImplementedError`; `sync()` queda para smoke/manual tests legacy y
 * siempre se identifica explícitamente como mock.
 */
export class MockErpAdapter implements ErpAdapter {
  readonly name = 'mock' as const;

  isConfigured(): boolean {
    return true;
  }

  async sync(payload: ErpSyncPayload): Promise<ErpSyncResult> {
    const syncId = `mock-${payload.tenantId}-${Date.now()}`;
    return {
      ok: true,
      mode: 'mock',
      syncId,
      timestamp: new Date().toISOString(),
      message: `[MOCK] Acción "${payload.action}" marcada como prueba — NO se conectó a ERP real`,
      reason: 'ERP_ADAPTER=mock — adapter de pruebas, sin I/O ni datos ERP reales',
    };
  }

  async manualSync(request: ErpManualSyncRequest): Promise<ErpSyncResult> {
    return this.sync({
      tenantId: request.tenantId,
      projectId: request.projectId,
      action: 'manual_sync',
      data: request.data,
    });
  }

  async fetchEmployees(_request: ErpFetchEmployeesRequest): Promise<readonly ErpEmployeeRecord[]> {
    throw new ErpNotImplementedError(this.name, 'fetch_employees', 'fetchEmployees');
  }

  async fetchOrgChart(_request: ErpFetchOrgChartRequest): Promise<readonly ErpOrgUnitRecord[]> {
    throw new ErpNotImplementedError(this.name, 'fetch_org_chart', 'fetchOrgChart');
  }

  async pushWorkerStatus(_request: ErpPushWorkerStatusRequest): Promise<ErpPushResult> {
    throw new ErpNotImplementedError(this.name, 'push_worker_status', 'pushWorkerStatus');
  }

  async pushTrainingRecord(_request: ErpPushTrainingRecordRequest): Promise<ErpPushResult> {
    throw new ErpNotImplementedError(this.name, 'push_training_record', 'pushTrainingRecord');
  }
}

// ────────────────────────────────────────────────────────────────────────
// Real adapters — typed stubs hasta que el cliente provea sandbox/API docs.
// NO simulan éxito; cada método tira NotImplementedError con mensaje claro.
// ────────────────────────────────────────────────────────────────────────

export class ErpNotImplementedError extends Error {
  constructor(adapter: ErpAdapterName, action: ErpAction, method?: ErpAdapterMethod) {
    super(
      `ERP adapter "${adapter}" method "${method ?? action}" is not implemented for action "${action}". ` +
        `No fallback data was produced. Wire the real ${adapter.toUpperCase()} API with client sandbox credentials before calling this method.`,
    );
    this.name = 'ErpNotImplementedError';
  }
}

export class ErpMissingCredentialsError extends Error {
  constructor(adapter: ErpAdapterName, missingKeys: string[]) {
    super(
      `ERP adapter "${adapter}" requiere credenciales faltantes: ${missingKeys.join(', ')}. ` +
        `Configúralas en env vars (ERP_${adapter.toUpperCase()}_*) antes de usar este adapter.`,
    );
    this.name = 'ErpMissingCredentialsError';
  }
}

abstract class StubAdapter implements ErpAdapter {
  abstract readonly name: ErpAdapterName;
  protected abstract readonly requiredKeys: readonly ErpCredentialKey[];

  constructor(protected readonly credentials: ErpCredentials) {}

  private missingCredentialKeys(): string[] {
    return this.requiredKeys.filter((key) => !this.credentials[key]);
  }

  isConfigured(): boolean {
    return this.missingCredentialKeys().length === 0;
  }

  protected validateCredentials(): void {
    const missing = this.missingCredentialKeys();
    if (missing.length > 0) {
      throw new ErpMissingCredentialsError(this.name, missing);
    }
  }

  protected notImplemented(action: ErpAction, method: ErpAdapterMethod): never {
    // Validar credenciales primero — falla rápido si faltan y evita esconder
    // problemas de configuración detrás de un 501 de implementación futura.
    this.validateCredentials();
    throw new ErpNotImplementedError(this.name, action, method);
  }

  async sync(payload: ErpSyncPayload): Promise<ErpSyncResult> {
    const context = {
      tenantId: payload.tenantId,
      projectId: payload.projectId,
      data: payload.data,
    };

    switch (payload.action) {
      case 'manual_sync':
        return this.manualSync(context);
      case 'fetch_employees': {
        const employees = await this.fetchEmployees(context);
        return buildRealSyncResult(payload, `ERP adapter "${this.name}" fetched employees.`, {
          recordsRead: employees.length,
          recordsWritten: 0,
          recordsSkipped: 0,
        });
      }
      case 'fetch_org_chart': {
        const orgUnits = await this.fetchOrgChart(context);
        return buildRealSyncResult(payload, `ERP adapter "${this.name}" fetched org chart.`, {
          recordsRead: orgUnits.length,
          recordsWritten: 0,
          recordsSkipped: 0,
        });
      }
      case 'push_worker_status': {
        const result = await this.pushWorkerStatus(context);
        return buildRealSyncResult(payload, `ERP adapter "${this.name}" pushed worker status.`, {
          recordsRead: 0,
          recordsWritten: result.ok ? 1 : 0,
          recordsSkipped: result.ok ? 0 : 1,
        });
      }
      case 'push_training_record': {
        const result = await this.pushTrainingRecord(context);
        return buildRealSyncResult(payload, `ERP adapter "${this.name}" pushed training record.`, {
          recordsRead: 0,
          recordsWritten: result.ok ? 1 : 0,
          recordsSkipped: result.ok ? 0 : 1,
        });
      }
      default:
        return assertNever(payload.action);
    }
  }

  async manualSync(_request: ErpManualSyncRequest): Promise<ErpSyncResult> {
    return this.notImplemented('manual_sync', 'manualSync');
  }

  async fetchEmployees(_request: ErpFetchEmployeesRequest): Promise<readonly ErpEmployeeRecord[]> {
    return this.notImplemented('fetch_employees', 'fetchEmployees');
  }

  async fetchOrgChart(_request: ErpFetchOrgChartRequest): Promise<readonly ErpOrgUnitRecord[]> {
    return this.notImplemented('fetch_org_chart', 'fetchOrgChart');
  }

  async pushWorkerStatus(_request: ErpPushWorkerStatusRequest): Promise<ErpPushResult> {
    return this.notImplemented('push_worker_status', 'pushWorkerStatus');
  }

  async pushTrainingRecord(_request: ErpPushTrainingRecordRequest): Promise<ErpPushResult> {
    return this.notImplemented('push_training_record', 'pushTrainingRecord');
  }
}

export class SapAdapter extends StubAdapter {
  readonly name = 'sap' as const;
  protected readonly requiredKeys: readonly ErpCredentialKey[] = ['baseUrl', 'clientId', 'clientSecret'];
}

export class BukAdapter extends StubAdapter {
  readonly name = 'buk' as const;
  protected readonly requiredKeys: readonly ErpCredentialKey[] = ['baseUrl', 'apiKey'];
}

export class TalanaAdapter extends StubAdapter {
  readonly name = 'talana' as const;
  protected readonly requiredKeys: readonly ErpCredentialKey[] = ['baseUrl', 'apiKey'];
}

// ────────────────────────────────────────────────────────────────────────
// Factory — picks adapter based on env, returns null when not configured.
// ────────────────────────────────────────────────────────────────────────

export interface SelectAdapterOptions {
  /** Override del env var (útil en tests). */
  adapterName?: ErpAdapterName;
  /** Override credentials (útil en tests). */
  credentials?: ErpCredentials;
  /** Env getter (default `process.env`, override para tests). */
  env?: Record<string, string | undefined>;
}

/**
 * Devuelve el adapter activo basado en config, o `null` si ERP integration
 * no está habilitada. El caller usa el `null` para devolver un 503
 * "not_configured" honesto en lugar de simular éxito.
 */
export function selectErpAdapter(opts: SelectAdapterOptions = {}): ErpAdapter | null {
  const env = opts.env ?? process.env;
  const adapterName = (opts.adapterName ?? env.ERP_ADAPTER) as
    | ErpAdapterName
    | undefined;

  if (!adapterName) return null;

  if (adapterName === 'mock') return new MockErpAdapter();

  const creds: ErpCredentials = opts.credentials ?? {
    baseUrl: env[`ERP_${adapterName.toUpperCase()}_BASE_URL`],
    clientId: env[`ERP_${adapterName.toUpperCase()}_CLIENT_ID`],
    clientSecret: env[`ERP_${adapterName.toUpperCase()}_CLIENT_SECRET`],
    apiKey: env[`ERP_${adapterName.toUpperCase()}_API_KEY`],
  };

  switch (adapterName) {
    case 'sap':
      return new SapAdapter(creds);
    case 'buk':
      return new BukAdapter(creds);
    case 'talana':
      return new TalanaAdapter(creds);
    default:
      return null;
  }
}

/**
 * Construye una respuesta honesta de "not_configured" cuando no hay
 * ERP_ADAPTER seteado. El front muestra este mensaje al usuario en lugar
 * de pretender que la sync fue exitosa.
 */
export function buildNotConfiguredResult(_payload: ErpSyncPayload): ErpSyncResult {
  return {
    ok: false,
    mode: 'not_configured',
    syncId: `not-configured-${Date.now()}`,
    timestamp: new Date().toISOString(),
    message:
      'ERP integration no está configurada en este servidor. ' +
      'Contacta al administrador para habilitar el adapter (SAP/Buk/Talana).',
    reason: 'ERP_ADAPTER env var no está seteada',
  };
}
