// Praeventio Guard — Sprint 52 (2da tanda §35, §40, §42-45): Vendor/Contractor
// Onboarding Portal — flow secuencial a nivel EMPRESA.
//
// Cierra: Documento usuario "2da tanda §35, §40, §42-45" (Sprint K).
//
// Track distinto al de `faenaOnboardingBundle` (que es por TRABAJADOR) y al
// de `supplierScoring`/`supplierQualityService` (que miden desempeño en curso
// de un proveedor ya acreditado). Este módulo cubre el flujo de PRIMERA
// acreditación de la empresa proveedora:
//
//   invited → docs_uploaded → docs_validated → site_walk → accredited
//                                          \→ rejected
//                                          \→ expired
//
// Además permite armar "bundles" de requisitos específicos por cliente
// mandante (§45 — qué exige cada cliente además de los baseline regulatorios).
//
// Determinístico, sin LLM, sin I/O.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type OnboardingStage =
  | 'invited'
  | 'docs_uploaded'
  | 'docs_validated'
  | 'site_walk'
  | 'accredited'
  | 'rejected'
  | 'expired';

export type VendorRequirementKind =
  | 'document'         // contrato, RUT, certificado vigencia, etc.
  | 'certification'    // ISO 9001/45001, OS-10, IDIEM, etc.
  | 'insurance'        // poliza responsabilidad civil, accidentes
  | 'safety_policy'    // política SST escrita
  | 'epp_inventory'    // inventario de EPP que el vendor aporta (§40)
  | 'control_inventory'; // inventario de controles ingeniería que aporta (§40)

export interface VendorRequirement {
  id: string;
  /** Label visible. */
  label: string;
  kind: VendorRequirementKind;
  /** Si es obligatorio para acreditación. False = nice to have. */
  mandatory: boolean;
  /** Si está atado a un cliente mandante específico (§45). */
  clientSpecific?: string;
  /** Vigencia en meses; undefined = no caduca. */
  expiresAfterMonths?: number;
}

export type ComplianceStatus =
  | 'pending'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'expired';

export interface VendorRequirementCompliance {
  vendorId: string;
  requirementId: string;
  status: ComplianceStatus;
  /** ISO-8601 cuando el vendor lo subió. */
  submittedAt?: string;
  /** UID del revisor del mandante. */
  reviewedByUid?: string;
  /** ISO-8601 de la revisión. */
  reviewedAt?: string;
  /** Razón de rechazo. */
  reason?: string;
  /** ISO-8601 derivado de submittedAt + expiresAfterMonths del requirement. */
  expiresAt?: string;
}

export interface VendorOnboardingState {
  vendorId: string;
  legalName: string;
  /** ISO-8601 cuando el mandante invitó al vendor a postular. */
  invitedAt: string;
  /** ISO-8601 cuando el vendor subió todos los docs mandatorios. */
  docsUploadedAt?: string;
  /** ISO-8601 cuando el mandante validó todos los docs. */
  docsValidatedAt?: string;
  /** ISO-8601 de la visita a terreno previa. */
  siteWalkAt?: string;
  /** ISO-8601 cuando se acreditó formalmente. */
  accreditedAt?: string;
  /** ISO-8601 si fue rechazado. */
  rejectedAt?: string;
  /** Razón de rechazo. */
  rejectionReason?: string;
}

// ────────────────────────────────────────────────────────────────────────
// Stage evaluation
// ────────────────────────────────────────────────────────────────────────

/**
 * Computes current onboarding stage from the state + compliance records +
 * requirement catalog.
 *
 * Order of precedence (highest wins):
 *   1. `rejected` if state.rejectedAt set
 *   2. `expired` if accredited but any mandatory compliance is expired at `now`
 *   3. `accredited` if state.accreditedAt set
 *   4. `site_walk` if state.siteWalkAt set
 *   5. `docs_validated` if all mandatory compliance is approved
 *   6. `docs_uploaded` if all mandatory compliance is at least submitted
 *   7. `invited` otherwise
 */
export function evaluateOnboardingStage(
  state: VendorOnboardingState,
  compliance: VendorRequirementCompliance[],
  requirements: VendorRequirement[],
  now: string,
): OnboardingStage {
  if (state.rejectedAt) return 'rejected';

  const mandatory = requirements.filter((r) => r.mandatory);
  const byReq = new Map(
    compliance
      .filter((c) => c.vendorId === state.vendorId)
      .map((c) => [c.requirementId, c]),
  );

  // Check expirations on accredited vendors.
  if (state.accreditedAt) {
    const nowMs = Date.parse(now);
    for (const req of mandatory) {
      const comp = byReq.get(req.id);
      if (!comp) return 'expired'; // mandatory missing post-accreditation
      if (comp.status === 'expired') return 'expired';
      if (comp.expiresAt && Date.parse(comp.expiresAt) <= nowMs) {
        return 'expired';
      }
    }
    return 'accredited';
  }

  if (state.siteWalkAt) return 'site_walk';

  const allApproved =
    mandatory.length > 0 &&
    mandatory.every((r) => byReq.get(r.id)?.status === 'approved');
  if (allApproved) return 'docs_validated';

  const allSubmittedOrApproved =
    mandatory.length > 0 &&
    mandatory.every((r) => {
      const status = byReq.get(r.id)?.status;
      return (
        status === 'submitted' || status === 'approved' || status === 'rejected'
      );
    });
  if (allSubmittedOrApproved) return 'docs_uploaded';

  return 'invited';
}

/**
 * Returns the list of mandatory requirements that are still pending
 * (no compliance record or compliance not submitted yet).
 */
export function listMissingMandatory(
  vendorId: string,
  compliance: VendorRequirementCompliance[],
  requirements: VendorRequirement[],
): VendorRequirement[] {
  const byReq = new Map(
    compliance
      .filter((c) => c.vendorId === vendorId)
      .map((c) => [c.requirementId, c]),
  );
  return requirements.filter((r) => {
    if (!r.mandatory) return false;
    const c = byReq.get(r.id);
    if (!c) return true;
    return c.status === 'pending' || c.status === 'rejected' || c.status === 'expired';
  });
}

/**
 * Returns mandatory requirements that are still rejected (need vendor to
 * resubmit). Useful for "what to fix" UI panel.
 */
export function listRejectedRequirements(
  vendorId: string,
  compliance: VendorRequirementCompliance[],
  requirements: VendorRequirement[],
): VendorRequirementCompliance[] {
  return compliance.filter(
    (c) =>
      c.vendorId === vendorId &&
      c.status === 'rejected' &&
      requirements.some((r) => r.id === c.requirementId && r.mandatory),
  );
}

// ────────────────────────────────────────────────────────────────────────
// Per-client requirement bundles (§45)
// ────────────────────────────────────────────────────────────────────────

/**
 * Builds the effective requirement bundle for a vendor postulating to a
 * specific client/mandante. Combines:
 *   - baseline (clientSpecific undefined): aplica a todos los clientes
 *   - clientSpecific === clientId: solo de ese cliente
 *
 * Otros clientSpecific se descartan.
 *
 * Deduplica por id; en caso de colisión, gana la regla del cliente (más
 * estricta normalmente).
 */
export function buildClientRequirementsBundle(
  clientId: string,
  baseRequirements: VendorRequirement[],
  clientSpecificRequirements: VendorRequirement[],
): VendorRequirement[] {
  const byId = new Map<string, VendorRequirement>();
  for (const r of baseRequirements) {
    if (r.clientSpecific && r.clientSpecific !== clientId) continue;
    byId.set(r.id, r);
  }
  for (const r of clientSpecificRequirements) {
    if (r.clientSpecific && r.clientSpecific !== clientId) continue;
    byId.set(r.id, r); // override base
  }
  return [...byId.values()];
}

// ────────────────────────────────────────────────────────────────────────
// Compliance expiration helpers
// ────────────────────────────────────────────────────────────────────────

/**
 * Computes the ISO-8601 expiration timestamp for a compliance record given
 * its submission date + requirement's `expiresAfterMonths`. Returns undefined
 * if requirement does not expire or compliance not yet submitted.
 */
export function computeExpiresAt(
  submittedAt: string | undefined,
  expiresAfterMonths: number | undefined,
): string | undefined {
  if (!submittedAt || !expiresAfterMonths || expiresAfterMonths <= 0) {
    return undefined;
  }
  const d = new Date(submittedAt);
  if (Number.isNaN(d.getTime())) return undefined;
  d.setUTCMonth(d.getUTCMonth() + expiresAfterMonths);
  return d.toISOString();
}

/**
 * Returns true if a compliance record is expired at the given `now`.
 * Marks expired compliance records for renewal flow.
 */
export function isComplianceExpired(
  compliance: VendorRequirementCompliance,
  now: string,
): boolean {
  if (compliance.status === 'expired') return true;
  if (!compliance.expiresAt) return false;
  return Date.parse(compliance.expiresAt) <= Date.parse(now);
}
