/**
 * Ergonomic legal-threshold trigger.
 *
 * WHY: DS-594 art. 110 (vibraciones mano-brazo / TMERT) + Circular SUSESO
 * 3596 obligan al empleador a iniciar la denuncia (DIEP) cuando la
 * exposicion alcanza el nivel de accion legal. Para REBA el umbral es
 * score >= 11 ("very high — implementar cambios ahora", Hignett &
 * McAtamney 2000) y para RULA score >= 7 ("action level 4 — investigar
 * y aplicar cambios de inmediato", McAtamney & Corlett 1993). ISO 11226
 * y NIOSH lifting equation convergen en el mismo umbral practico.
 *
 * Cuando el assessment cruza el umbral, este modulo:
 *
 *   1. Asigna un folio DIEP atomico via `nextFolio` (no crea el form
 *      completo — eso requiere RUT trabajador, RUT empresa, descripcion
 *      del incidente, etc., que el wizard ergonomico NO recolecta;
 *      el folio queda "pre-asignado" y la prevencionista completa el
 *      DIEP en el siguiente paso).
 *   2. Construye un `FamilyNodeSpec` derivado para el caso, anclado al
 *      cuerpo legal `norma-DS-594-Art-110` (que ya existe en el catalogo
 *      estatico `OHS_NORMATIVA_NODES`). El nodo derivado se devuelve al
 *      caller para que el RiskNetwork lo dibuje; no escribimos a un
 *      registro mutable porque el catalogo es una constante.
 *   3. Emite un audit log `ergonomic.legal_threshold_crossed`.
 *
 * Diseno fire-and-forget: el wrapper `triggerLegalConsequencesIfNeeded`
 * NUNCA lanza — captura cualquier error con `getErrorTracker()` para
 * que el path de save del assessment NO se rompa si SUSESO/audit estan
 * caidos. La consecuencia legal es un side-effect deseable, pero no
 * critica para la integridad del registro tecnico.
 */

import type { MinimalFolioStore } from '../suseso/folioGenerator';
import { nextFolio } from '../suseso/folioGenerator';
import { logAuditAction } from '../auditService';
import { getErrorTracker } from '../observability';
import type { FamilyNodeSpec } from '../zettelkasten/families/climateNodeRegistry';

/** REBA legal action threshold (DS-594 art. 110 / Hignett & McAtamney 2000). */
export const REBA_LEGAL_THRESHOLD = 11;
/** RULA legal action threshold (Circular SUSESO 3596 / McAtamney & Corlett 1993). */
export const RULA_LEGAL_THRESHOLD = 7;

/** The Zettelkasten anchor we link derived ergonomic-risk nodes to. */
export const DS594_ART110_ANCHOR_ID = 'norma-DS-594-Art-110';

export interface ErgonomicLegalTriggerInput {
  assessmentId: string;
  workerId: string;
  projectId: string;
  tenantId: string;
  type: 'REBA' | 'RULA';
  score: number;
  computedAt: string;
}

export interface ErgonomicLegalTriggerResult {
  /** Whether the assessment crossed the legal action threshold. */
  triggered: boolean;
  /** Allocated DIEP folio (only set when triggered). */
  diepFolio?: string;
  /** Derived Zettelkasten node spec to wire into RiskNetwork (only set when triggered). */
  nodeSpec?: FamilyNodeSpec;
}

export function crossesLegalThreshold(type: 'REBA' | 'RULA', score: number): boolean {
  if (!Number.isFinite(score)) return false;
  return type === 'REBA' ? score >= REBA_LEGAL_THRESHOLD : score >= RULA_LEGAL_THRESHOLD;
}

/**
 * Build the derived FamilyNodeSpec representing this specific ergonomic
 * incident. The id is unique per assessment so multiple events on the
 * same worker do NOT collide.
 */
function buildNodeSpec(input: ErgonomicLegalTriggerInput): FamilyNodeSpec {
  return {
    id: `riesgo-ergonomico-${input.type.toLowerCase()}-${input.assessmentId}`,
    description:
      `Riesgo ergonomico ${input.type} score=${input.score} (umbral legal DS-594 art. 110 ` +
      `cruzado) worker=${input.workerId}`,
    producerHint: 'src/services/safety/ergonomicAssessments.ts',
    consumerHints: ['src/pages/RiskNetwork.tsx', 'src/pages/SusesoReports.tsx'],
    source: 'DS-594',
  };
}

/**
 * Fire-and-forget dispatch of legal consequences. NEVER throws — errors
 * are captured via the observability adapter so the calling save path
 * stays clean.
 *
 * Pass `folioStore` so this module remains pure-deps testable; callers
 * inside the request path build it from firebase-admin (server) or the
 * client SDK (browser) as appropriate.
 */
export async function triggerLegalConsequencesIfNeeded(
  input: ErgonomicLegalTriggerInput,
  deps: { folioStore: MinimalFolioStore },
): Promise<ErgonomicLegalTriggerResult> {
  if (!crossesLegalThreshold(input.type, input.score)) {
    return { triggered: false };
  }

  let diepFolio: string | undefined;
  let nodeSpec: FamilyNodeSpec | undefined;

  // Step 1 — folio DIEP. If this fails we still try to record the audit
  // log so the prevencionista has a paper trail.
  try {
    diepFolio = await nextFolio(deps.folioStore, input.tenantId, 'DIEP');
  } catch (err) {
    getErrorTracker().captureException(
      err instanceof Error ? err : new Error(String(err)),
      {
        tags: { module: 'ergonomicLegalTrigger', step: 'nextFolio' },
        extra: {
          assessmentId: input.assessmentId,
          tenantId: input.tenantId,
          type: input.type,
          score: input.score,
        },
      },
    );
  }

  // Step 2 — derived Zettelkasten node. Pure construction, cannot fail,
  // but wrapped for symmetry + future-proofing.
  try {
    nodeSpec = buildNodeSpec(input);
  } catch (err) {
    getErrorTracker().captureException(
      err instanceof Error ? err : new Error(String(err)),
      { tags: { module: 'ergonomicLegalTrigger', step: 'buildNodeSpec' } },
    );
  }

  // Step 3 — audit log. Independent of folio success.
  try {
    await logAuditAction(
      'ergonomic.legal_threshold_crossed',
      'safety',
      {
        assessmentId: input.assessmentId,
        workerId: input.workerId,
        type: input.type,
        score: input.score,
        threshold:
          input.type === 'REBA' ? REBA_LEGAL_THRESHOLD : RULA_LEGAL_THRESHOLD,
        diepFolio: diepFolio ?? null,
        anchorNodeId: DS594_ART110_ANCHOR_ID,
        derivedNodeId: nodeSpec?.id ?? null,
        regulation: 'DS-594-art-110',
        computedAt: input.computedAt,
      },
      input.projectId,
    );
  } catch (err) {
    getErrorTracker().captureException(
      err instanceof Error ? err : new Error(String(err)),
      { tags: { module: 'ergonomicLegalTrigger', step: 'logAuditAction' } },
    );
  }

  return { triggered: true, diepFolio, nodeSpec };
}
