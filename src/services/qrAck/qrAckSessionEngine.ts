// Praeventio Guard — Sprint 43 Fase F.5: Firma Recepción Digital con QR.
//
// Cierra Plan F.5 "Firma de Recepción Digital con QR (EPP, charlas,
// docs, capacitaciones)".
//
// Flujo:
//   1. Supervisor abre modal en su dispositivo:
//      `createSession()` → SessionToken con expiry corto (default 5min)
//   2. Modal renderiza QR con payload `{ sessionId, projectId, itemId, expiresAt }`
//      (caller usa qrcode.react)
//   3. Trabajador escanea con su app autenticada
//   4. App valida `verifySessionToken()` + recolecta consent + biometric/PIN
//   5. Server registra `<Acknowledgement>` permanente
//   6. Server emite event `ATTENDANCE` con edges `signed_by WORKER` +
//      `documents EPP|TRAINING|TALK|DOCUMENT`
//
// Seguridad: cada token es HMAC-SHA-256(secret, sessionId|payload|expiresAt).
// Replay: el servidor mantiene set de `usedSessionIds` (TTL = 24h post-expiry).
//
// Este motor es PURO — no genera el QR ni firma con HMAC real; el caller
// inyecta la `signer`/`verifier` callbacks. Tests usan stub determinístico.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type AckItemKind = 'epp' | 'training' | 'talk' | 'document' | 'protocol';

export interface AckSessionInput {
  projectId: string;
  /** El supervisor que crea la sesión. */
  createdByUid: string;
  /** Item que el trabajador va a confirmar haber recibido / escuchado. */
  itemKind: AckItemKind;
  itemId: string;
  /** Resumen humano-legible para mostrar al trabajador. */
  itemLabel: string;
  /** Timeout opcional (default 5 min). */
  ttlSeconds?: number;
}

export interface AckSession {
  sessionId: string;
  projectId: string;
  createdByUid: string;
  itemKind: AckItemKind;
  itemId: string;
  itemLabel: string;
  createdAt: string;
  expiresAt: string;
  /** Payload firmado que va en el QR (Base64URL del JSON canónico). */
  qrPayload: string;
  /** Firma HMAC del payload. */
  signature: string;
}

export interface AckScanRequest {
  /** Payload recibido (lo que el escáner leyó). */
  qrPayload: string;
  signature: string;
  /** UID del trabajador escaneando (de su token de auth). */
  scannedByUid: string;
  /** Confirmación explícita del trabajador. */
  consent: boolean;
  /** Si la app usó biometric/PIN antes de invocar este endpoint. */
  biometricUsed: boolean;
  /** Coords opcionales para auditoría. */
  scannedAtLocation?: { lat: number; lng: number };
}

export interface Acknowledgement {
  ackId: string;
  sessionId: string;
  projectId: string;
  itemKind: AckItemKind;
  itemId: string;
  workerUid: string;
  signedAt: string;
  biometricUsed: boolean;
  location?: { lat: number; lng: number };
}

export class QrAckValidationError extends Error {
  constructor(public readonly code: string, msg: string) {
    super(`[${code}] ${msg}`);
    this.name = 'QrAckValidationError';
  }
}

// ────────────────────────────────────────────────────────────────────────
// Crypto contracts (injected — no real crypto here)
// ────────────────────────────────────────────────────────────────────────

/** Caller injects an HMAC signer (server-side using Node `crypto` or KMS). */
export type Signer = (payload: string) => string;

/** Caller injects the matching verifier. */
export type Verifier = (payload: string, signature: string) => boolean;

// ────────────────────────────────────────────────────────────────────────
// Session creation
// ────────────────────────────────────────────────────────────────────────

const DEFAULT_TTL_SECONDS = 300; // 5 min

function base64UrlEncode(s: string): string {
  // node-safe + browser-safe (no Buffer dependency for portability)
  if (typeof btoa === 'function') {
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  // Fallback (Node)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (Buffer as any).from(s, 'utf-8').toString('base64url');
}

function base64UrlDecode(s: string): string {
  if (typeof atob === 'function') {
    const pad = '='.repeat((4 - (s.length % 4)) % 4);
    return atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (Buffer as any).from(s, 'base64url').toString('utf-8');
}

interface SessionInner {
  v: 1;
  sid: string;
  pid: string;
  cby: string;
  ik: AckItemKind;
  iid: string;
  il: string;
  exp: number;
  iat: number;
}

export interface CreateSessionOptions {
  now?: Date;
  /** Para tests determinísticos. */
  sessionIdGenerator?: () => string;
}

function defaultSessionId(): string {
  // 16 bytes hex random
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Last-resort (Node without webcrypto — shouldn't hit in modern runtimes).
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createAckSession(
  input: AckSessionInput,
  signer: Signer,
  options: CreateSessionOptions = {},
): AckSession {
  if (!input.projectId) throw new QrAckValidationError('missing_project', 'projectId required');
  if (!input.createdByUid) throw new QrAckValidationError('missing_creator', 'createdByUid required');
  if (!input.itemId) throw new QrAckValidationError('missing_item', 'itemId required');
  if (!input.itemLabel.trim()) throw new QrAckValidationError('missing_label', 'itemLabel required');

  const now = options.now ?? new Date();
  const ttl = Math.max(60, Math.min(input.ttlSeconds ?? DEFAULT_TTL_SECONDS, 1800));
  const expiresAt = new Date(now.getTime() + ttl * 1000);
  const sessionId = (options.sessionIdGenerator ?? defaultSessionId)();

  const inner: SessionInner = {
    v: 1,
    sid: sessionId,
    pid: input.projectId,
    cby: input.createdByUid,
    ik: input.itemKind,
    iid: input.itemId,
    il: input.itemLabel,
    iat: Math.floor(now.getTime() / 1000),
    exp: Math.floor(expiresAt.getTime() / 1000),
  };

  const canonical = JSON.stringify(inner);
  const payload = base64UrlEncode(canonical);
  const signature = signer(payload);

  return {
    sessionId,
    projectId: input.projectId,
    createdByUid: input.createdByUid,
    itemKind: input.itemKind,
    itemId: input.itemId,
    itemLabel: input.itemLabel,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    qrPayload: payload,
    signature,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Scan validation
// ────────────────────────────────────────────────────────────────────────

export interface ValidateScanOptions {
  now?: Date;
  /** Set of session ids ya consumidos (replay defense). */
  usedSessionIds?: ReadonlySet<string>;
}

export interface ValidScanResult {
  ok: true;
  inner: SessionInner;
  ack: Acknowledgement;
}

export interface InvalidScanResult {
  ok: false;
  code:
    | 'bad_payload'
    | 'bad_signature'
    | 'expired'
    | 'no_consent'
    | 'replay'
    | 'creator_cannot_self_sign';
  detail: string;
}

export type ScanResult = ValidScanResult | InvalidScanResult;

export function validateAckScan(
  req: AckScanRequest,
  verifier: Verifier,
  options: ValidateScanOptions = {},
): ScanResult {
  let inner: SessionInner;
  try {
    const canonical = base64UrlDecode(req.qrPayload);
    inner = JSON.parse(canonical) as SessionInner;
    if (inner.v !== 1 || !inner.sid || !inner.pid) {
      return { ok: false, code: 'bad_payload', detail: 'estructura de payload inválida' };
    }
  } catch (e) {
    return { ok: false, code: 'bad_payload', detail: `payload no parseable: ${(e as Error).message}` };
  }

  if (!verifier(req.qrPayload, req.signature)) {
    return { ok: false, code: 'bad_signature', detail: 'firma HMAC no coincide' };
  }

  const now = options.now ?? new Date();
  if (Math.floor(now.getTime() / 1000) > inner.exp) {
    return { ok: false, code: 'expired', detail: 'sesión expirada — supervisor debe regenerar QR' };
  }

  if (!req.consent) {
    return { ok: false, code: 'no_consent', detail: 'trabajador no marcó consentimiento explícito' };
  }

  if (options.usedSessionIds?.has(inner.sid)) {
    return { ok: false, code: 'replay', detail: `sessionId ${inner.sid} ya fue consumido` };
  }

  if (req.scannedByUid === inner.cby) {
    return {
      ok: false,
      code: 'creator_cannot_self_sign',
      detail: 'el supervisor que creó la sesión no puede firmar la recepción',
    };
  }

  const ack: Acknowledgement = {
    ackId: `ack-${inner.sid}-${req.scannedByUid}`,
    sessionId: inner.sid,
    projectId: inner.pid,
    itemKind: inner.ik,
    itemId: inner.iid,
    workerUid: req.scannedByUid,
    signedAt: now.toISOString(),
    biometricUsed: req.biometricUsed,
    location: req.scannedAtLocation,
  };

  return { ok: true, inner, ack };
}

// ────────────────────────────────────────────────────────────────────────
// Batch helpers
// ────────────────────────────────────────────────────────────────────────

/**
 * Para un mismo item (ej: charla diaria), N trabajadores escanean el mismo
 * QR. El servidor debe permitir N firmas distintas pero rechazar dobles
 * del mismo uid. Helper agrega esa lógica.
 */
export function rejectDuplicateAck(
  acks: ReadonlyArray<Acknowledgement>,
  sessionId: string,
  workerUid: string,
): boolean {
  return acks.some((a) => a.sessionId === sessionId && a.workerUid === workerUid);
}
