// Praeventio Guard — Sprint 39 Fase G.11: Control de trabajo solitario.
//
// Cierra: Documento usuario "Recomendaciones nuevas §72, §73"
//         Plan integral Top 15 #10
//
// Cuando un trabajador opera solo (faena remota, zona aislada), check-in
// periódico obligatorio. Si no responde → escalamiento.
//
// Determinístico. El caller (mobile + Cloud Function) wirea el reloj
// real y dispatch de notificaciones.

export interface LoneWorkerSession {
  id: string;
  workerUid: string;
  startedAt: string;
  /** Intervalo de check-in esperado en minutos. */
  checkInIntervalMin: number;
  /** Coords de la última posición conocida. */
  lastKnownLocation?: { lat: number; lng: number; at: string };
  /** Lista de check-ins recibidos en orden cronológico. */
  checkIns: Array<{ at: string; lat?: number; lng?: number; status: 'ok' | 'help' }>;
  /** Si el supervisor confirma sesión terminada. */
  endedAt?: string;
  status: LoneWorkerStatus;
}

export type LoneWorkerStatus =
  | 'active'
  | 'overdue_warning' // 1x intervalo sin check-in
  | 'overdue_critical' // 2x intervalo sin check-in
  | 'help_requested' // worker pulsó "ayuda"
  | 'ended';

export interface EscalationDecision {
  level: 'supervisor' | 'brigade' | 'emergency_services';
  message: string;
  triggeredAt: string;
  /**
   * Última ubicación conocida del trabajador (de `session.lastKnownLocation`,
   * que `recordCheckIn` mantiene). Viaja con la decisión para que el responder
   * sepa DÓNDE está el trabajador caído — antes la escalación solo llevaba IDs.
   * Ausente si la sesión nunca registró ubicación.
   */
  lastKnownLocation?: { lat: number; lng: number; at: string };
}

/**
 * Deriva el estado actual de la sesión basado en el tiempo desde el
 * último check-in vs el intervalo configurado.
 */
export function deriveLoneWorkerStatus(
  session: LoneWorkerSession,
  now: Date = new Date(),
): LoneWorkerStatus {
  if (session.endedAt) return 'ended';
  if (session.checkIns.some((c) => c.status === 'help')) return 'help_requested';

  const lastEvent = session.checkIns.length > 0
    ? session.checkIns[session.checkIns.length - 1].at
    : session.startedAt;
  const minSinceLast = (now.getTime() - Date.parse(lastEvent)) / 60_000;

  if (minSinceLast > session.checkInIntervalMin * 2) return 'overdue_critical';
  if (minSinceLast > session.checkInIntervalMin) return 'overdue_warning';
  return 'active';
}

/**
 * Decide qué nivel de escalamiento corresponde dado el estado actual.
 */
export function decideEscalation(
  session: LoneWorkerSession,
  now: Date = new Date(),
): EscalationDecision | null {
  const status = deriveLoneWorkerStatus(session, now);
  const at = now.toISOString();
  const loc = session.lastKnownLocation;
  const decide = (
    level: EscalationDecision['level'],
    message: string,
  ): EscalationDecision => ({
    level,
    message,
    triggeredAt: at,
    ...(loc ? { lastKnownLocation: loc } : {}),
  });

  switch (status) {
    case 'overdue_warning':
      return decide(
        'supervisor',
        `Trabajador ${session.workerUid} no responde check-in (>1× intervalo)`,
      );
    case 'overdue_critical':
      return decide(
        'brigade',
        `Trabajador ${session.workerUid} sin contacto (>2× intervalo) — activar brigada`,
      );
    case 'help_requested':
      return decide(
        'emergency_services',
        `Trabajador ${session.workerUid} solicitó ayuda activamente`,
      );
    default:
      return null;
  }
}

export function recordCheckIn(
  session: LoneWorkerSession,
  checkIn: { at?: string; lat?: number; lng?: number; status?: 'ok' | 'help' },
): LoneWorkerSession {
  const at = checkIn.at ?? new Date().toISOString();
  const status = checkIn.status ?? 'ok';
  return {
    ...session,
    checkIns: [...session.checkIns, { at, lat: checkIn.lat, lng: checkIn.lng, status }],
    lastKnownLocation:
      checkIn.lat !== undefined && checkIn.lng !== undefined
        ? { lat: checkIn.lat, lng: checkIn.lng, at }
        : session.lastKnownLocation,
    status: status === 'help' ? 'help_requested' : 'active',
  };
}

export function endSession(
  session: LoneWorkerSession,
  endedAt: string = new Date().toISOString(),
): LoneWorkerSession {
  return { ...session, endedAt, status: 'ended' };
}
