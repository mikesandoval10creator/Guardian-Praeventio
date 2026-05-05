// Praeventio Guard — SUSESO API client (DIAT / DIEP / ROI submission).
//
// Marco normativo:
//  - Ley N° 16.744 art. 76 — obligación del empleador de denunciar accidentes
//    y enfermedades profesionales.
//  - Circular SUSESO N° 3656/2021 — instrucciones sobre presentación
//    electrónica de DIAT y DIEP.
//
// Esta clase es un cliente fino sobre `fetch` con autenticación por API key +
// RUT del empleador. La URL base por defecto es `https://api.suseso.cl/v1`,
// pero es configurable vía variable de entorno (la URL real debe verificarse
// contra la documentación vigente de SUSESO antes de ir a producción).
//
// `fromEnv()` retorna `null` si las variables no están configuradas para
// permitir UI fallback (botón deshabilitado + mensaje "configurar credenciales").

export interface DiatPayload {
  /** RUT del empleador (con dígito verificador, ej: "76543210-K"). */
  employerRut: string;
  /** Nombre / razón social del empleador. */
  employerName: string;
  /** Mutualidad asociada (ACHS, IST, Mutual CChC, ISL). */
  mutualName: string;

  workerRut: string;
  workerName: string;
  workerJobTitle: string;

  accidentDate: string;
  accidentTime: string;
  accidentLocation: string;
  accidentDescription: string;

  /** ISO yyyy-mm-dd — fecha de la denuncia. */
  reportedAt: string;
}

export interface DiepPayload {
  employerRut: string;
  employerName: string;
  mutualName: string;

  workerRut: string;
  workerName: string;
  workerJobTitle: string;

  diagnosis: string;
  cieCode?: string;
  symptomsOnsetDate: string;
  exposedAgents: string[];

  reportedAt: string;
}

export interface RoiPayload {
  employerRut: string;
  employerName: string;
  mutualName: string;

  /** Año del reporte de siniestralidad. */
  year: number;
  /** Trimestre 1-4 (opcional, si SUSESO lo exige por trimestre). */
  quarter?: 1 | 2 | 3 | 4;

  /** Total de incidentes registrados en el período. */
  totalIncidents: number;
  /** Total de días perdidos. */
  totalLostDays: number;
  /** Tasa de accidentabilidad (% accidentes / trabajadores promedio). */
  accidentRate: number;
  /** Tasa de siniestralidad (días perdidos / trabajadores). */
  severityRate: number;

  reportedAt: string;
}

export type SusesoSubmissionStatus = 'pending' | 'received' | 'rejected';

export interface SusesoSubmissionState {
  status: SusesoSubmissionStatus;
  reason?: string;
}

export class SusesoApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly suseseoCode?: string,
  ) {
    super(message);
    this.name = 'SusesoApiError';
  }
}

interface SusesoApiClientConfig {
  apiKey: string;
  employerRut: string;
  baseUrl?: string;
  /** Allows tests to inject a fetch implementation. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE_URL = 'https://api.suseso.cl/v1';

export class SusesoApiClient {
  private readonly apiKey: string;
  private readonly employerRut: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: SusesoApiClientConfig) {
    if (!config.apiKey || !config.apiKey.trim()) {
      throw new SusesoApiError('SusesoApiClient requires a non-empty apiKey.');
    }
    if (!config.employerRut || !config.employerRut.trim()) {
      throw new SusesoApiError('SusesoApiClient requires a non-empty employerRut.');
    }
    this.apiKey = config.apiKey;
    this.employerRut = config.employerRut;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = config.fetchImpl ?? fetch.bind(globalThis);
  }

  /**
   * Read configuration from environment variables. Returns `null` if either
   * `SUSESO_API_KEY` or `SUSESO_EMPLOYER_RUT` is missing — caller must handle
   * that case (typically by disabling the "Enviar a SUSESO" button in UI).
   *
   * Optional `SUSESO_API_URL` overrides the default endpoint.
   */
  static fromEnv(env: Record<string, string | undefined> = (typeof process !== 'undefined' ? (process.env as Record<string, string | undefined>) : {})): SusesoApiClient | null {
    const apiKey = env.SUSESO_API_KEY;
    const employerRut = env.SUSESO_EMPLOYER_RUT;
    if (!apiKey || !employerRut) return null;
    return new SusesoApiClient({
      apiKey,
      employerRut,
      baseUrl: env.SUSESO_API_URL,
    });
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'X-Employer-Rut': this.employerRut,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      let detail: string | undefined;
      let code: string | undefined;
      try {
        const errBody = await res.json() as { message?: string; code?: string };
        detail = errBody.message;
        code = errBody.code;
      } catch {
        // ignore — body wasn't JSON
      }
      throw new SusesoApiError(
        `SUSESO ${path} failed: HTTP ${res.status}${detail ? ` — ${detail}` : ''}`,
        res.status,
        code,
      );
    }
    return await res.json() as T;
  }

  private async get<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const res = await this.fetchImpl(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'X-Employer-Rut': this.employerRut,
      },
    });
    if (!res.ok) {
      throw new SusesoApiError(
        `SUSESO ${path} GET failed: HTTP ${res.status}`,
        res.status,
      );
    }
    return await res.json() as T;
  }

  async submitDiat(diat: DiatPayload): Promise<{ folio: string; ack: string }> {
    return this.post<{ folio: string; ack: string }>('/diat', diat);
  }

  async submitDiep(diep: DiepPayload): Promise<{ folio: string }> {
    return this.post<{ folio: string }>('/diep', diep);
  }

  async submitRoi(roi: RoiPayload): Promise<{ folio: string }> {
    return this.post<{ folio: string }>('/roi', roi);
  }

  async getStatus(folio: string): Promise<SusesoSubmissionState> {
    if (!folio || !folio.trim()) {
      throw new SusesoApiError('getStatus requires a non-empty folio.');
    }
    return this.get<SusesoSubmissionState>(`/status/${encodeURIComponent(folio)}`);
  }
}
