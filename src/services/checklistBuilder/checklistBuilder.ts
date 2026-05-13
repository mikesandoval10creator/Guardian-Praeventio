// Praeventio Guard — Sprint 49 §261-270: Constructor de Checklists con
// conditional fields + scoring + multi-signature + rectificaciones +
// export legal.
//
// 100% determinístico. El builder NO renderiza UI (caller lo hace) —
// produce schemas serializables JSON que la UI consume + el engine que
// valida respuestas + el firmador multi-rol + el export PDF (caller usa
// pdfkit/jspdf).

// ────────────────────────────────────────────────────────────────────────
// Schema types
// ────────────────────────────────────────────────────────────────────────

export type FieldKind =
  | 'text'
  | 'multiline'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'single_choice'
  | 'multi_choice'
  | 'date'
  | 'datetime'
  | 'signature'         // base64 PNG signature
  | 'photo_evidence'    // foto requerida — sha256 + storage uri
  | 'measurement'       // valor numérico + unidad + instrumentId
  | 'gps_location';

export interface FieldOption {
  value: string;
  label: string;
  /** Si esta opción dispara fields condicionales. */
  unlocksFields?: string[];
  /** Si esta opción suma a un risk score. */
  riskWeight?: number;
}

export interface FieldDef {
  /** ID estable del field (stable key). */
  id: string;
  kind: FieldKind;
  label: string;
  required: boolean;
  /** Solo para kinds choice. */
  options?: FieldOption[];
  /** Si el field aparece solo cuando otro field tiene cierto valor. */
  conditionalOn?: {
    fieldId: string;
    /** Lista de valores que activan este field. */
    requiredValues: string[];
  };
  /** Para measurement: unidad esperada. */
  expectedUnit?: string;
  /** Para number/integer: rango válido. */
  minValue?: number;
  maxValue?: number;
  /** Texto de ayuda visible al usuario. */
  helpText?: string;
  /** Peso para scoring (default 1). */
  scoreWeight?: number;
}

export interface ChecklistSection {
  id: string;
  title: string;
  description?: string;
  fields: FieldDef[];
  /** Min de fields que deben completarse para considerar la sección OK. */
  minCompletedFields?: number;
}

export type SignatureRole = 'worker' | 'supervisor' | 'prevencionista' | 'cphs_rep' | 'company_doctor' | 'external_auditor';

export interface SignatureRequirement {
  role: SignatureRole;
  /** Si es opcional (puede saltarse con override audit). */
  optional?: boolean;
  /** Texto que el firmante ve antes de firmar. */
  attestationText: string;
}

export interface ChecklistTemplate {
  id: string;
  /** Versión semver — bump cuando cambias campos. */
  version: string;
  /** Industry/use-case. */
  category: 'inspection' | 'permit_pre_check' | 'incident_investigation' | 'audit' | 'training_eval' | 'other';
  title: string;
  description?: string;
  sections: ChecklistSection[];
  requiredSignatures: SignatureRequirement[];
  /** Si exporta a PDF de cumplimiento legal (boletas, DIAT, etc.). */
  legalExportRequired?: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// Response types
// ────────────────────────────────────────────────────────────────────────

export type FieldValue = string | number | boolean | string[] | null;

export interface FieldResponse {
  fieldId: string;
  value: FieldValue;
  /** Si la respuesta es una rectificación, ref al valor previo + razón. */
  rectifiedFrom?: { previousValue: FieldValue; reason: string; rectifiedByUid: string; rectifiedAt: string };
  /** Para photo_evidence / measurement: hash adjunto. */
  evidenceHash?: string;
  /** Para signature: ts + role. */
  signatureMeta?: { role: SignatureRole; signedAt: string; signedByUid: string };
}

export interface ChecklistResponse {
  templateId: string;
  templateVersion: string;
  /** ID estable del fill. */
  responseId: string;
  startedAt: string;
  completedAt?: string;
  responses: FieldResponse[];
  /** Si se cierra el fill — bloquea ediciones excepto rectificaciones audit-tracked. */
  locked: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────────

export type ValidationViolation =
  | 'missing_required_field'
  | 'value_out_of_range'
  | 'unknown_field_id'
  | 'unknown_template'
  | 'invalid_choice_value'
  | 'missing_signature_role'
  | 'evidence_required_but_missing'
  | 'conditional_unmet'
  | 'section_min_not_met';

export interface ValidationFinding {
  kind: ValidationViolation;
  fieldId?: string;
  sectionId?: string;
  detail: string;
}

export interface ChecklistValidationResult {
  valid: boolean;
  findings: ValidationFinding[];
  /** Score 0..100 calculado de respuestas válidas. */
  completionScore: number;
  /** Risk score derivado de options con riskWeight. */
  riskScore: number;
}

function isFieldActive(field: FieldDef, responses: FieldResponse[]): boolean {
  if (!field.conditionalOn) return true;
  const trigger = responses.find((r) => r.fieldId === field.conditionalOn!.fieldId);
  if (!trigger) return false;
  const value = trigger.value;
  if (Array.isArray(value)) {
    return value.some((v) => field.conditionalOn!.requiredValues.includes(String(v)));
  }
  return field.conditionalOn.requiredValues.includes(String(value));
}

export function validateResponse(
  template: ChecklistTemplate,
  response: ChecklistResponse,
): ChecklistValidationResult {
  const findings: ValidationFinding[] = [];
  if (response.templateId !== template.id) {
    findings.push({
      kind: 'unknown_template',
      detail: `templateId ${response.templateId} no matchea ${template.id}`,
    });
  }

  const allFields = template.sections.flatMap((s) => s.fields);
  const responseByFieldId = new Map(response.responses.map((r) => [r.fieldId, r] as const));

  // Validate each field
  let totalScoreableFields = 0;
  let totalScored = 0;
  let riskScore = 0;

  for (const field of allFields) {
    const active = isFieldActive(field, response.responses);
    if (!active) continue;

    const r = responseByFieldId.get(field.id);
    const weight = field.scoreWeight ?? 1;
    // Required fields siempre cuentan al denominator. Optional NO cuenta
    // si no se completa (completionScore mide "qué tan completo está lo
    // mínimo", no qué tan completo está lo opcional).
    if (field.required) totalScoreableFields += weight;

    if (!r || r.value === null || r.value === '' || (Array.isArray(r.value) && r.value.length === 0)) {
      if (field.required) {
        findings.push({
          kind: 'missing_required_field',
          fieldId: field.id,
          detail: `Campo requerido '${field.label}' sin completar.`,
        });
      }
      continue;
    }
    // Optional field con respuesta válida → cuenta al numerator pero no
    // al denominator (no bonus cap; sí contribuye a riskScore vía options).
    if (!field.required) totalScoreableFields += weight;

    // Range check
    if ((field.kind === 'number' || field.kind === 'integer') && typeof r.value === 'number') {
      if (field.minValue !== undefined && r.value < field.minValue) {
        findings.push({
          kind: 'value_out_of_range',
          fieldId: field.id,
          detail: `Valor ${r.value} < min ${field.minValue}`,
        });
        continue;
      }
      if (field.maxValue !== undefined && r.value > field.maxValue) {
        findings.push({
          kind: 'value_out_of_range',
          fieldId: field.id,
          detail: `Valor ${r.value} > max ${field.maxValue}`,
        });
        continue;
      }
    }

    // Choice validity
    if (field.options && (field.kind === 'single_choice' || field.kind === 'multi_choice')) {
      const valid = field.options.map((o) => o.value);
      if (Array.isArray(r.value)) {
        const invalid = r.value.filter((v) => !valid.includes(String(v)));
        if (invalid.length > 0) {
          findings.push({
            kind: 'invalid_choice_value',
            fieldId: field.id,
            detail: `Choices inválidas: ${invalid.join(', ')}`,
          });
          continue;
        }
        // Risk weight aggregation
        for (const v of r.value) {
          const opt = field.options.find((o) => o.value === v);
          if (opt?.riskWeight) riskScore += opt.riskWeight;
        }
      } else {
        if (!valid.includes(String(r.value))) {
          findings.push({
            kind: 'invalid_choice_value',
            fieldId: field.id,
            detail: `Choice '${r.value}' no válida.`,
          });
          continue;
        }
        const opt = field.options.find((o) => o.value === r.value);
        if (opt?.riskWeight) riskScore += opt.riskWeight;
      }
    }

    // Evidence required
    if ((field.kind === 'photo_evidence' || field.kind === 'measurement') && !r.evidenceHash) {
      findings.push({
        kind: 'evidence_required_but_missing',
        fieldId: field.id,
        detail: `Campo ${field.label} requiere evidencia adjunta.`,
      });
      continue;
    }

    totalScored += weight;
  }

  // Section min check
  for (const section of template.sections) {
    if (section.minCompletedFields === undefined) continue;
    const sectionFields = section.fields.filter((f) => isFieldActive(f, response.responses));
    const completed = sectionFields.filter((f) => {
      const r = responseByFieldId.get(f.id);
      return r && r.value !== null && r.value !== '';
    });
    if (completed.length < section.minCompletedFields) {
      findings.push({
        kind: 'section_min_not_met',
        sectionId: section.id,
        detail: `Sección '${section.title}': ${completed.length} de ${section.minCompletedFields} mínimo.`,
      });
    }
  }

  // Signatures
  if (response.locked) {
    const sigsPresent = response.responses.filter((r) => r.signatureMeta);
    for (const req of template.requiredSignatures) {
      if (req.optional) continue;
      const hasIt = sigsPresent.some((s) => s.signatureMeta?.role === req.role);
      if (!hasIt) {
        findings.push({
          kind: 'missing_signature_role',
          detail: `Falta firma del rol ${req.role}`,
        });
      }
    }
  }

  const completionScore =
    totalScoreableFields === 0 ? 100 : Math.round((totalScored / totalScoreableFields) * 100);

  return {
    valid: findings.length === 0,
    findings,
    completionScore,
    riskScore,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Rectification (audit-tracked edits post-lock)
// ────────────────────────────────────────────────────────────────────────

export interface RectifyFieldInput {
  response: ChecklistResponse;
  fieldId: string;
  newValue: FieldValue;
  reason: string;
  rectifiedByUid: string;
  now: Date;
}

export class RectificationError extends Error {
  constructor(public readonly code: string, msg: string) {
    super(`[${code}] ${msg}`);
    this.name = 'RectificationError';
  }
}

export function rectifyField(input: RectifyFieldInput): ChecklistResponse {
  if (!input.response.locked) {
    throw new RectificationError(
      'not_locked',
      'rectifyField solo aplica a respuestas bloqueadas (locked=true); use update normal antes de lock.',
    );
  }
  if (input.reason.trim().length < 10) {
    throw new RectificationError(
      'reason_too_short',
      'reason debe tener al menos 10 chars (audit requirement).',
    );
  }
  const existing = input.response.responses.find((r) => r.fieldId === input.fieldId);
  if (!existing) {
    throw new RectificationError('field_not_found', `Field ${input.fieldId} no encontrado.`);
  }

  const updated: FieldResponse = {
    ...existing,
    value: input.newValue,
    rectifiedFrom: {
      previousValue: existing.value,
      reason: input.reason,
      rectifiedByUid: input.rectifiedByUid,
      rectifiedAt: input.now.toISOString(),
    },
  };

  return {
    ...input.response,
    responses: input.response.responses.map((r) => (r.fieldId === input.fieldId ? updated : r)),
  };
}

// ────────────────────────────────────────────────────────────────────────
// Signing
// ────────────────────────────────────────────────────────────────────────

export interface SignInput {
  response: ChecklistResponse;
  role: SignatureRole;
  signedByUid: string;
  /** PNG base64 firma manuscrita. */
  signaturePng: string;
  now: Date;
}

export function applySignature(input: SignInput): ChecklistResponse {
  // Signature lives en su propio FieldResponse pseudo-field (id = `signature:${role}`)
  const sigField: FieldResponse = {
    fieldId: `signature:${input.role}`,
    value: input.signaturePng,
    signatureMeta: {
      role: input.role,
      signedAt: input.now.toISOString(),
      signedByUid: input.signedByUid,
    },
  };
  const filtered = input.response.responses.filter((r) => r.fieldId !== sigField.fieldId);
  return {
    ...input.response,
    responses: [...filtered, sigField],
  };
}

export function lockResponse(response: ChecklistResponse, now: Date): ChecklistResponse {
  if (response.locked) return response;
  return { ...response, locked: true, completedAt: now.toISOString() };
}
