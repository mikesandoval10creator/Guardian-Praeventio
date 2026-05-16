// Praeventio Guard — ERP Integration adapter (honest implementation).
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
//      mensaje claro: "ERP integration disabled — set ERP_ADAPTER=mock
//      for testing or sap/buk/talana for production".
//
//   2. Si `ERP_ADAPTER=mock` → devuelve respuesta determinística marcada
//      explícitamente con `mode: 'mock'` para que el caller sepa que NO
//      es real. Sin setTimeout. Sin pretender éxito.
//
//   3. Si `ERP_ADAPTER=sap|buk|talana` → intenta la llamada real. Si
//      faltan credenciales → 503 "missing_credentials". Si la llamada
//      falla → propaga el error real (no oculta tras un success genérico).
//
// Implementaciones reales SAP/Buk/Talana son stubs hasta que el cliente
// provea credenciales sandbox. El stub tira `NotImplementedError` con
// un mensaje claro — no simula éxito.

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

export interface ErpSyncPayload {
  /** Tenant context for multi-tenant isolation. */
  tenantId: string;
  /** Optional project scope. */
  projectId?: string;
  /** Tipo de acción solicitada. */
  action: ErpAction;
  /** Datos arbitrarios específicos de la acción. */
  data?: Record<string, unknown>;
}

export interface ErpSyncResult {
  ok: boolean;
  /** Modo de ejecución para que el caller sepa qué pasó realmente. */
  mode: 'real' | 'mock' | 'not_configured' | 'missing_credentials' | 'failed';
  /** Identificador de la sincronización (UUID). */
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

export interface ErpAdapter {
  readonly name: ErpAdapterName;
  sync(payload: ErpSyncPayload): Promise<ErpSyncResult>;
}

// ────────────────────────────────────────────────────────────────────────
// Mock adapter — clearly labeled, NO setTimeout, NO success simulation.
// ────────────────────────────────────────────────────────────────────────

/**
 * Adapter de pruebas. Devuelve respuestas determinísticas con `mode: 'mock'`
 * para que el front sepa que NO es una sync real.
 *
 * No usa `setTimeout` ni hace I/O. No simula éxito — declara explícitamente
 * que es un mock. El front debe mostrar un banner "Modo prueba — no sincronizó
 * con ERP real" cuando reciba `mode: 'mock'`.
 */
export class MockErpAdapter implements ErpAdapter {
  readonly name = 'mock' as const;

  async sync(payload: ErpSyncPayload): Promise<ErpSyncResult> {
    const syncId = `mock-${payload.tenantId}-${Date.now()}`;
    return {
      ok: true,
      mode: 'mock',
      syncId,
      timestamp: new Date().toISOString(),
      message: `[MOCK] Acción "${payload.action}" simulada — NO se conectó a ERP real`,
      reason: 'ERP_ADAPTER=mock — adapter de pruebas, sin I/O',
    };
  }
}

// ────────────────────────────────────────────────────────────────────────
// Real adapters — stubs hasta que el cliente provea credenciales sandbox.
// NO simulan éxito; tiran NotImplementedError con mensaje claro.
// ────────────────────────────────────────────────────────────────────────

export class ErpNotImplementedError extends Error {
  constructor(adapter: ErpAdapterName, action: ErpAction) {
    super(
      `ERP adapter "${adapter}" no tiene implementada la acción "${action}". ` +
        `Requiere credenciales sandbox del cliente para wire real. ` +
        `Mientras tanto, usa ERP_ADAPTER=mock para pruebas.`,
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
  protected abstract readonly requiredKeys: string[];

  constructor(protected readonly credentials: ErpCredentials) {}

  protected validateCredentials(): void {
    const missing: string[] = [];
    if (this.requiredKeys.includes('baseUrl') && !this.credentials.baseUrl) {
      missing.push('baseUrl');
    }
    if (this.requiredKeys.includes('clientId') && !this.credentials.clientId) {
      missing.push('clientId');
    }
    if (this.requiredKeys.includes('clientSecret') && !this.credentials.clientSecret) {
      missing.push('clientSecret');
    }
    if (this.requiredKeys.includes('apiKey') && !this.credentials.apiKey) {
      missing.push('apiKey');
    }
    if (missing.length > 0) {
      throw new ErpMissingCredentialsError(this.name, missing);
    }
  }

  async sync(payload: ErpSyncPayload): Promise<ErpSyncResult> {
    // Validar credenciales primero — falla rápido si faltan
    this.validateCredentials();
    // El stub real tira NotImplemented. NO simula éxito.
    throw new ErpNotImplementedError(this.name, payload.action);
  }
}

export class SapAdapter extends StubAdapter {
  readonly name = 'sap' as const;
  protected readonly requiredKeys = ['baseUrl', 'clientId', 'clientSecret'];
}

export class BukAdapter extends StubAdapter {
  readonly name = 'buk' as const;
  protected readonly requiredKeys = ['baseUrl', 'apiKey'];
}

export class TalanaAdapter extends StubAdapter {
  readonly name = 'talana' as const;
  protected readonly requiredKeys = ['baseUrl', 'apiKey'];
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
