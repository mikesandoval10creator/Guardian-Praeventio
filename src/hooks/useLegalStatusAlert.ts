// Headcount-triggered legal-status advisory for the sidebar.
//
// Derives whether the SELECTED project has crossed a Chilean dotación
// threshold that makes a committee/department legally required:
//   • ≥25 trabajadores  → Comité Paritario de Higiene y Seguridad (CPHS)
//   • ≥100 trabajadores → Departamento de Prevención de Riesgos (DPRP)
//
// This is ADVISORY ONLY. Praeventio never blocks operations and never pushes to
// an organism; the banner just points the operator at the obligation + the
// legal calendar (where the reconcile cron has already materialised the
// obligation — see runLegalObligationReconcile / POST /api/legal/.../reconcile-
// obligations). Legal compliance is FREE on every tier (ADR 0021) and is never
// tier-gated.
//
// Thresholds come from the CL country pack (never hardcoded). DPRP supersedes
// CPHS in the banner: the higher obligation already implies the committee, so
// at ≥100 we surface the DPRP notice (which still mentions the CPHS).

import { useProject } from '../contexts/ProjectContext';
import { CL_PACK } from '../data/normativa/cl';

export type LegalAlertType = 'cphs' | 'dprp';

export interface LegalStatusAlert {
  alertType: LegalAlertType;
  projectId: string;
  workersCount: number;
  /** The threshold the dotación crossed (25 for CPHS, 100 for DPRP). */
  threshold: number;
}

/** Minimal shape the derivation needs — keeps it pure + unit-testable. */
export interface LegalAlertProjectInput {
  id: string;
  workersCount?: number;
  country?: string;
}

/**
 * Pure derivation: project → the legal obligation it has crossed into, or null.
 * Returns null when there is no project, no usable headcount, the project does
 * not operate in Chile, or the dotación is below the first threshold.
 */
export function deriveLegalStatusAlert(
  project: LegalAlertProjectInput | null | undefined,
): LegalStatusAlert | null {
  if (!project) return null;

  // CL is the platform default when `country` is absent (compliance target is
  // Chile; the onboarding wizard does not persist a country field). Non-CL
  // projects get no Chilean dotación advisory.
  const country = typeof project.country === 'string' ? project.country : 'CL';
  if (country !== 'CL') return null;

  const workersCount = project.workersCount;
  if (
    typeof workersCount !== 'number' ||
    !Number.isFinite(workersCount) ||
    workersCount <= 0
  ) {
    return null;
  }

  const { comiteRequiredAtWorkers, preventionDeptRequiredAtWorkers } = CL_PACK.thresholds;

  if (workersCount >= preventionDeptRequiredAtWorkers) {
    return {
      alertType: 'dprp',
      projectId: project.id,
      workersCount,
      threshold: preventionDeptRequiredAtWorkers,
    };
  }
  if (workersCount >= comiteRequiredAtWorkers) {
    return {
      alertType: 'cphs',
      projectId: project.id,
      workersCount,
      threshold: comiteRequiredAtWorkers,
    };
  }
  return null;
}

/** Hook wrapper: derives the advisory for the currently selected project. */
export function useLegalStatusAlert(): LegalStatusAlert | null {
  const { selectedProject } = useProject();
  return deriveLegalStatusAlert(selectedProject);
}
