// Praeventio Guard — Sprint 39 Fase B.9: vencimientos universales.
//
// Cierra: Documento usuario "Ideas implementables §2.5"
//         Plan integral Fase B.9
//
// Antes:
// - Solo `checkExpiredPpe` (Sprint 28 H26) cubría EPP.
// - Documentos, capacitaciones, exámenes ocupacionales, permisos,
//   licencias, certificados — todos tenían `expiresAt` pero NADIE
//   levantaba `expiration_warning` ni los degradaba a `expired`.
//
// Diseño:
// - PURO: scanForExpirations({ items, now, warningWindowDays })
//   recibe un array de items con `expiresAt` y devuelve buckets:
//     - `expired`: ya pasaron
//     - `warning`: vencerán en ≤ warningWindowDays
//     - `ok`: vigentes con margen
// - Sin I/O: testeable sin Firebase. Los wrappers (Cloud Function /
//   maintenance reaper) llaman este helper con los items leídos de
//   sus respectivas collections.
//
// Los tipos cubiertos son TODOS los nodos con campo `expiresAt` que
// representen un compromiso vigente:
//   - EPP_ASSIGNMENT, DOCUMENT, TRAINING_CERTIFICATE,
//     OCCUPATIONAL_EXAM, WORK_PERMIT, LICENSE, MEDICAL_FITNESS,
//     CONTRACT, AUDIT_ACTION

export type ExpirationKind =
  | 'epp'
  | 'document'
  | 'training'
  | 'occupational_exam'
  | 'work_permit'
  | 'license'
  | 'medical_fitness'
  | 'contract'
  | 'audit_action';

export interface ExpirableItem {
  /** Stable id del item dentro de su collection. */
  id: string;
  /** Discrimina el kind para el caller (qué collection, qué notificación). */
  kind: ExpirationKind;
  /** ISO-8601. Items sin expiresAt o non-string son ignorados. */
  expiresAt: string | null | undefined;
  /** Owner: worker o proyecto. Usado para notification routing. */
  ownerId?: string;
  /** Descriptor humano (e.g. "Casco Juan Pérez", "Capacitación altura R1"). */
  label?: string;
  /** Estado actual ('active' | 'expired' | 'archived' | ...). El scanner
   *  no toca items que ya estén `expired` o `archived`. */
  status?: string;
  /** projectId si aplica (no todos los kinds están asociados a proyecto). */
  projectId?: string;
}

export interface ExpirationOutcome {
  item: ExpirableItem;
  /** Días hasta el vencimiento. Negativo = ya venció. */
  daysUntilExpiry: number;
  /** Severity tier derivado del horizonte y del kind. */
  severity: ExpirationSeverity;
}

export type ExpirationSeverity =
  /** Vence en > warningWindowDays. No requiere acción. */
  | 'ok'
  /** Vence en ≤ warningWindowDays. Pre-warning. */
  | 'warning'
  /** Vence en ≤ criticalWindowDays. Acción inmediata. */
  | 'critical'
  /** Ya venció. Bloqueo si aplica. */
  | 'expired';

export interface ScanOptions {
  /** Anclaje temporal. Default new Date(). */
  now?: Date;
  /** Items dentro de esta ventana → severity='warning'. Default 30. */
  warningWindowDays?: number;
  /** Items dentro de esta ventana → severity='critical'. Default 7. */
  criticalWindowDays?: number;
}

export interface ScanResult {
  /** Items que ya vencieron (daysUntilExpiry < 0). Severity='expired'. */
  expired: ExpirationOutcome[];
  /** Items en ventana crítica. */
  critical: ExpirationOutcome[];
  /** Items en ventana de aviso. */
  warning: ExpirationOutcome[];
  /** Items vigentes fuera de ventana. */
  ok: ExpirationOutcome[];
  /** Total de items procesados (excluye los descartados sin expiresAt). */
  totalScanned: number;
  /** Items descartados por faltar `expiresAt` o tener status='expired'. */
  skipped: number;
}

/**
 * Scan a flat list of expirable items and classify each by severity.
 * Pure function — no I/O. The caller fetches items from Firestore and
 * dispatches notifications based on the result buckets.
 */
export function scanForExpirations(
  items: ExpirableItem[],
  opts: ScanOptions = {},
): ScanResult {
  const now = opts.now ?? new Date();
  const warnDays = opts.warningWindowDays ?? 30;
  const critDays = opts.criticalWindowDays ?? 7;
  if (critDays >= warnDays) {
    throw new RangeError(
      `criticalWindowDays (${critDays}) must be < warningWindowDays (${warnDays})`,
    );
  }

  const nowMs = now.getTime();
  const expired: ExpirationOutcome[] = [];
  const critical: ExpirationOutcome[] = [];
  const warning: ExpirationOutcome[] = [];
  const ok: ExpirationOutcome[] = [];
  let skipped = 0;

  for (const item of items) {
    if (!item.expiresAt || typeof item.expiresAt !== 'string') {
      skipped += 1;
      continue;
    }
    if (item.status === 'expired' || item.status === 'archived') {
      skipped += 1;
      continue;
    }

    const expiryMs = Date.parse(item.expiresAt);
    if (!Number.isFinite(expiryMs)) {
      skipped += 1;
      continue;
    }
    const daysUntilExpiry = Math.floor((expiryMs - nowMs) / (24 * 60 * 60 * 1000));

    const severity: ExpirationSeverity =
      daysUntilExpiry < 0
        ? 'expired'
        : daysUntilExpiry <= critDays
          ? 'critical'
          : daysUntilExpiry <= warnDays
            ? 'warning'
            : 'ok';

    const outcome: ExpirationOutcome = { item, daysUntilExpiry, severity };
    switch (severity) {
      case 'expired':
        expired.push(outcome);
        break;
      case 'critical':
        critical.push(outcome);
        break;
      case 'warning':
        warning.push(outcome);
        break;
      default:
        ok.push(outcome);
    }
  }

  return {
    expired,
    critical,
    warning,
    ok,
    totalScanned: items.length - skipped,
    skipped,
  };
}

/**
 * Build a `NodeType.FINDING` payload de tipo "expiration_warning" desde
 * un outcome. El caller lo persiste vía Zettelkasten (o lo wirea a un
 * job que cree el nodo + edges).
 */
export function buildExpirationFindingPayload(outcome: ExpirationOutcome): {
  type: 'expiration_warning';
  itemId: string;
  itemKind: ExpirationKind;
  label: string;
  expiresAt: string;
  daysUntilExpiry: number;
  severity: ExpirationSeverity;
  projectId?: string;
  ownerId?: string;
} {
  return {
    type: 'expiration_warning',
    itemId: outcome.item.id,
    itemKind: outcome.item.kind,
    label: outcome.item.label ?? `${outcome.item.kind}:${outcome.item.id}`,
    expiresAt: outcome.item.expiresAt as string,
    daysUntilExpiry: outcome.daysUntilExpiry,
    severity: outcome.severity,
    projectId: outcome.item.projectId,
    ownerId: outcome.item.ownerId,
  };
}
