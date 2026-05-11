// Praeventio Guard — Sprint K: Control de Visitas + Inducción Express QR.
//
// Cierra: Documento usuario "§23-24, §25"
//
// Cuando una visita llega a la faena (mandante, proveedor, fiscalizador,
// inspector independiente) necesita:
//   - Pre-registro o registro al ingreso
//   - Inducción express con QR (video corto + checklist obligatorio)
//   - Asignación de acompañante (un trabajador interno responsable)
//   - Restricciones de zona automáticas
//   - Salida registrada
//
// Determinístico. Sin LLM.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type VisitorKind =
  | 'mandante'
  | 'proveedor'
  | 'fiscalizador'
  | 'mutualidad'
  | 'auditor_externo'
  | 'cliente_comercial'
  | 'prensa'
  | 'familiar_trabajador';

export interface InductionChecklistItem {
  id: string;
  label: string;
}

const STANDARD_INDUCTION: InductionChecklistItem[] = [
  { id: 'i1', label: 'Comprende el protocolo de evacuación' },
  { id: 'i2', label: 'Conoce ubicación de puntos de encuentro' },
  { id: 'i3', label: 'Acepta usar EPP en zonas indicadas' },
  { id: 'i4', label: 'Reconoce señalética y delimitaciones' },
  { id: 'i5', label: 'Compromiso de seguir indicaciones del acompañante' },
  { id: 'i6', label: 'Entiende reglas básicas de tránsito interno' },
];

export interface VisitorAccess {
  id: string;
  fullName: string;
  identityDocument: string;
  organization: string;
  kind: VisitorKind;
  /** Acompañante (trabajador interno responsable). */
  hostUid: string;
  /** ISO-8601 del check-in. */
  checkedInAt: string;
  /** ISO-8601 del check-out (null si aún dentro). */
  checkedOutAt?: string;
  /** Zonas autorizadas. Si vacío → solo zona común. */
  authorizedZones: string[];
  /** Vehículo si aplica. */
  vehicleId?: string;
  inductionCompletedAt?: string;
  inductionItemsAcked: string[];
  /** Si está EPP entregado y registrado. */
  eppHandedOver: boolean;
  /** Notas operacionales. */
  notes?: string;
}

export class VisitorValidationError extends Error {
  constructor(public readonly code: string, msg: string) {
    super(`[${code}] ${msg}`);
    this.name = 'VisitorValidationError';
  }
}

// ────────────────────────────────────────────────────────────────────────
// Induction QR flow
// ────────────────────────────────────────────────────────────────────────

export interface InductionQrPayload {
  /** UUID temporal — válido N minutos. */
  sessionId: string;
  visitorId: string;
  expiresAt: string;
  /** URL del video de inducción. */
  videoUrl?: string;
  /** Checklist a confirmar. */
  checklist: InductionChecklistItem[];
}

export function buildInductionQrPayload(
  visitorId: string,
  ttlMinutes: number = 30,
  nowIso: string = new Date().toISOString(),
): InductionQrPayload {
  return {
    sessionId: `ind-${visitorId}-${Date.parse(nowIso)}`,
    visitorId,
    expiresAt: new Date(Date.parse(nowIso) + ttlMinutes * 60_000).toISOString(),
    checklist: STANDARD_INDUCTION,
  };
}

export function getInductionChecklist(): InductionChecklistItem[] {
  return STANDARD_INDUCTION;
}

export function completeInduction(
  visitor: VisitorAccess,
  ackedItemIds: string[],
  nowIso: string = new Date().toISOString(),
): VisitorAccess {
  const required = STANDARD_INDUCTION.map((i) => i.id);
  const missing = required.filter((id) => !ackedItemIds.includes(id));
  if (missing.length > 0) {
    throw new VisitorValidationError(
      'INDUCTION_INCOMPLETE',
      `Faltan ${missing.length} items de la inducción: ${missing.join(', ')}`,
    );
  }
  return {
    ...visitor,
    inductionItemsAcked: ackedItemIds,
    inductionCompletedAt: nowIso,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Access control
// ────────────────────────────────────────────────────────────────────────

export function canEnterZone(visitor: VisitorAccess, zoneId: string): boolean {
  if (!visitor.inductionCompletedAt) return false;
  if (!visitor.eppHandedOver) return false;
  if (visitor.checkedOutAt) return false;
  return visitor.authorizedZones.includes(zoneId);
}

export interface CheckInValidation {
  passed: boolean;
  blockingIssues: string[];
}

export function validateCheckIn(visitor: Partial<VisitorAccess>): CheckInValidation {
  const issues: string[] = [];
  if (!visitor.fullName || visitor.fullName.length < 3) issues.push('Nombre completo requerido');
  if (!visitor.identityDocument) issues.push('Documento de identidad requerido');
  if (!visitor.hostUid) issues.push('Acompañante (host) interno obligatorio');
  if (!visitor.organization) issues.push('Organización requerida');
  return { passed: issues.length === 0, blockingIssues: issues };
}

// ────────────────────────────────────────────────────────────────────────
// Summary for ops dashboard
// ────────────────────────────────────────────────────────────────────────

export interface VisitorSummary {
  totalActive: number;
  byKind: Record<VisitorKind, number>;
  withoutInduction: number;
  /** Visitas sin checkout > 12h (sospechoso). */
  overdueExits: VisitorAccess[];
}

export function summarizeVisitors(
  visitors: VisitorAccess[],
  nowIso: string = new Date().toISOString(),
): VisitorSummary {
  const active = visitors.filter((v) => !v.checkedOutAt);
  const byKind = {
    mandante: 0,
    proveedor: 0,
    fiscalizador: 0,
    mutualidad: 0,
    auditor_externo: 0,
    cliente_comercial: 0,
    prensa: 0,
    familiar_trabajador: 0,
  } as Record<VisitorKind, number>;
  for (const v of active) byKind[v.kind] += 1;
  const withoutInduction = active.filter((v) => !v.inductionCompletedAt).length;
  const nowMs = Date.parse(nowIso);
  const overdueExits = active.filter(
    (v) => nowMs - Date.parse(v.checkedInAt) > 12 * 3_600_000,
  );
  return { totalActive: active.length, byKind, withoutInduction, overdueExits };
}
