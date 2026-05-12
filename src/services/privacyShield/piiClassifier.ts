// Praeventio Guard — Sprint K: Privacidad PII + Datos Médicos Separados + Retención.
//
// Cierra: Documento usuario "§121-128"
//
// Clasifica los datos del proyecto en niveles de sensibilidad y aplica
// reglas de retención + acceso:
//
//   - PII básico (nombre, email, teléfono)
//   - Datos médicos (separados, acceso restringido a personal de salud)
//   - Datos financieros
//   - Datos sensibles legales (denuncias, investigaciones internas)
//
// Determinístico, sin LLM. Combina con Ley 19.628 + GDPR + LGPD.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type PiiCategory =
  | 'identity'         // nombre, rut, doc
  | 'contact'          // email, teléfono, dirección
  | 'health'           // datos médicos
  | 'biometric'        // huellas, rostro, voz
  | 'financial'        // cuenta bancaria, tarjeta
  | 'judicial'         // denuncias, antecedentes
  | 'location'         // GPS, geo-coordenadas precisas
  | 'observation';     // observaciones de comportamiento

export type SensitivityLevel = 'low' | 'medium' | 'high' | 'special_category';

const CATEGORY_SENSITIVITY: Record<PiiCategory, SensitivityLevel> = {
  identity: 'medium',
  contact: 'medium',
  health: 'special_category', // GDPR Art. 9
  biometric: 'special_category',
  financial: 'high',
  judicial: 'special_category',
  location: 'high',
  observation: 'low',
};

const DEFAULT_RETENTION_DAYS: Record<SensitivityLevel, number> = {
  low: 365,
  medium: 365 * 2,
  high: 365 * 5, // ej. Ley 16.744 art. 76 — 5 años incidentes
  special_category: 365 * 10, // ej. registros médicos — 10 años Decreto 466
};

export interface DataField {
  /** Path del campo en el documento. */
  fieldPath: string;
  /** Categoría detectada. */
  category: PiiCategory;
  /** Si el valor está cifrado en reposo. */
  encrypted: boolean;
  /** Roles autorizados a leer (vacío = todos los miembros). */
  authorizedRoles?: string[];
}

// ────────────────────────────────────────────────────────────────────────
// Classification
// ────────────────────────────────────────────────────────────────────────

export interface ClassificationReport {
  fieldPath: string;
  category: PiiCategory;
  sensitivity: SensitivityLevel;
  retentionDays: number;
  /** True si requiere consentimiento explícito según Ley 19.628 + GDPR. */
  requiresExplicitConsent: boolean;
  /** True si DEBE cifrarse en reposo. */
  mustEncryptAtRest: boolean;
  /** True si DEBE aplicarse mascarado en logs. */
  mustMaskInLogs: boolean;
}

export function classifyField(field: DataField): ClassificationReport {
  const sensitivity = CATEGORY_SENSITIVITY[field.category];
  const retentionDays = DEFAULT_RETENTION_DAYS[sensitivity];
  return {
    fieldPath: field.fieldPath,
    category: field.category,
    sensitivity,
    retentionDays,
    requiresExplicitConsent:
      sensitivity === 'special_category' || sensitivity === 'high',
    mustEncryptAtRest:
      sensitivity === 'special_category' || sensitivity === 'high',
    mustMaskInLogs: field.category !== 'observation',
  };
}

// ────────────────────────────────────────────────────────────────────────
// Compliance gap detector
// ────────────────────────────────────────────────────────────────────────

export interface ComplianceGap {
  fieldPath: string;
  gap:
    | 'unencrypted_special_category'
    | 'unencrypted_high'
    | 'missing_role_restriction_on_health'
    | 'missing_role_restriction_on_judicial';
  remediation: string;
}

export function detectGaps(fields: DataField[]): ComplianceGap[] {
  const gaps: ComplianceGap[] = [];

  for (const f of fields) {
    const sens = CATEGORY_SENSITIVITY[f.category];
    if (sens === 'special_category' && !f.encrypted) {
      gaps.push({
        fieldPath: f.fieldPath,
        gap: 'unencrypted_special_category',
        remediation: 'Cifrar en reposo (KMS envelope encryption) ANTES de release.',
      });
    } else if (sens === 'high' && !f.encrypted) {
      gaps.push({
        fieldPath: f.fieldPath,
        gap: 'unencrypted_high',
        remediation: 'Cifrar en reposo según política.',
      });
    }

    if (f.category === 'health' && (!f.authorizedRoles || f.authorizedRoles.length === 0)) {
      gaps.push({
        fieldPath: f.fieldPath,
        gap: 'missing_role_restriction_on_health',
        remediation: 'Limitar acceso a roles: medical_staff, prevention_lead.',
      });
    }
    if (f.category === 'judicial' && (!f.authorizedRoles || f.authorizedRoles.length === 0)) {
      gaps.push({
        fieldPath: f.fieldPath,
        gap: 'missing_role_restriction_on_judicial',
        remediation: 'Limitar acceso a roles: legal_counsel, admin.',
      });
    }
  }
  return gaps;
}

// ────────────────────────────────────────────────────────────────────────
// Retention reaper (§125)
// ────────────────────────────────────────────────────────────────────────

export interface ExpirableRecord {
  id: string;
  category: PiiCategory;
  /** ISO-8601. */
  createdAt: string;
}

export interface RetentionReaperResult {
  toReap: string[];
  /** Por categoría. */
  countsByCategory: Record<PiiCategory, number>;
}

export function reapExpiredRecords(
  records: ExpirableRecord[],
  nowIso: string = new Date().toISOString(),
): RetentionReaperResult {
  const nowMs = Date.parse(nowIso);
  const toReap: string[] = [];
  const countsByCategory: Record<PiiCategory, number> = {
    identity: 0,
    contact: 0,
    health: 0,
    biometric: 0,
    financial: 0,
    judicial: 0,
    location: 0,
    observation: 0,
  };

  for (const r of records) {
    const sens = CATEGORY_SENSITIVITY[r.category];
    const retentionMs = DEFAULT_RETENTION_DAYS[sens] * 86_400_000;
    if (nowMs - Date.parse(r.createdAt) > retentionMs) {
      toReap.push(r.id);
      countsByCategory[r.category] += 1;
    }
  }

  return { toReap, countsByCategory };
}
