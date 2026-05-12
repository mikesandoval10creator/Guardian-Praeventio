// Praeventio Guard — Sprint K: Agenda + Bloques de Foco + Recordatorios + Digests.
//
// Cierra: Documento usuario "§201-207"
//
// Organiza el día del prevencionista:
//   - Agenda con bloques de foco protegidos
//   - Recordatorios escalonados (24h, 4h, 30min)
//   - Digests por canal (push/email/whatsapp)
//   - Preferencias por usuario
//
// Determinístico, sin LLM.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type ReminderUrgency = 'low' | 'medium' | 'high' | 'urgent';
export type DeliveryChannel = 'push' | 'email' | 'whatsapp' | 'in_app';

export interface AgendaItem {
  id: string;
  workerUid: string;
  title: string;
  startAt: string;
  endAt: string;
  /** Si es un bloque de foco (no interrumpible). */
  focusBlock: boolean;
  urgency: ReminderUrgency;
  /** Recordatorios programados. */
  reminders: Array<{ atOffsetMinutes: number; channel: DeliveryChannel }>;
}

export interface UserPreferences {
  workerUid: string;
  /** Hora inicio del día laboral. */
  workDayStartHour: number;
  workDayEndHour: number;
  /** Canales preferidos por urgencia. */
  channelByUrgency: Record<ReminderUrgency, DeliveryChannel>;
  /** Bloques de foco diarios protegidos. */
  focusBlocksPerDay: number;
  /** No molestar después de hora. */
  doNotDisturbAfterHour?: number;
}

// ────────────────────────────────────────────────────────────────────────
// Reminder scheduling
// ────────────────────────────────────────────────────────────────────────

export interface ScheduledReminder {
  itemId: string;
  triggersAt: string;
  channel: DeliveryChannel;
  urgency: ReminderUrgency;
}

export function scheduleReminders(item: AgendaItem): ScheduledReminder[] {
  const startMs = Date.parse(item.startAt);
  return item.reminders.map((r) => ({
    itemId: item.id,
    triggersAt: new Date(startMs - r.atOffsetMinutes * 60_000).toISOString(),
    channel: r.channel,
    urgency: item.urgency,
  }));
}

export function selectChannelForUrgency(
  prefs: UserPreferences,
  urgency: ReminderUrgency,
): DeliveryChannel {
  return prefs.channelByUrgency[urgency];
}

// ────────────────────────────────────────────────────────────────────────
// Do not disturb filter
// ────────────────────────────────────────────────────────────────────────

export function shouldDeliverNow(
  reminder: ScheduledReminder,
  prefs: UserPreferences,
  nowIso: string,
): { deliver: boolean; reason: string } {
  if (reminder.urgency === 'urgent') {
    return { deliver: true, reason: 'Urgente — overrides DnD.' };
  }
  if (prefs.doNotDisturbAfterHour !== undefined) {
    const hour = new Date(nowIso).getUTCHours();
    if (hour >= prefs.doNotDisturbAfterHour || hour < prefs.workDayStartHour) {
      return { deliver: false, reason: `DnD activo (hora ${hour}). Diferir.` };
    }
  }
  return { deliver: true, reason: 'Dentro de ventana de trabajo.' };
}

// ────────────────────────────────────────────────────────────────────────
// Focus block protection
// ────────────────────────────────────────────────────────────────────────

export function isInFocusBlock(items: AgendaItem[], nowIso: string): AgendaItem | null {
  const nowMs = Date.parse(nowIso);
  return (
    items.find(
      (i) =>
        i.focusBlock &&
        Date.parse(i.startAt) <= nowMs &&
        Date.parse(i.endAt) >= nowMs,
    ) ?? null
  );
}

// ────────────────────────────────────────────────────────────────────────
// Digest builder (§206)
// ────────────────────────────────────────────────────────────────────────

export interface DigestSection {
  title: string;
  bullets: string[];
}

export interface DailyDigest {
  workerUid: string;
  forDate: string;
  sections: DigestSection[];
}

export interface DigestInputs {
  upcomingItems: AgendaItem[];
  overdueActions: number;
  pendingApprovals: number;
  freshIncidents: number;
}

export function buildDailyDigest(
  workerUid: string,
  forDate: string,
  inputs: DigestInputs,
): DailyDigest {
  const sections: DigestSection[] = [];

  if (inputs.upcomingItems.length > 0) {
    sections.push({
      title: 'Agenda hoy',
      bullets: inputs.upcomingItems.map(
        (i) => `${i.startAt.slice(11, 16)} ${i.title}${i.focusBlock ? ' (foco)' : ''}`,
      ),
    });
  }
  if (inputs.overdueActions > 0) {
    sections.push({
      title: 'Pendientes urgentes',
      bullets: [`${inputs.overdueActions} acciones vencidas`],
    });
  }
  if (inputs.pendingApprovals > 0) {
    sections.push({
      title: 'Aprobaciones',
      bullets: [`${inputs.pendingApprovals} aprobaciones esperando`],
    });
  }
  if (inputs.freshIncidents > 0) {
    sections.push({
      title: 'Incidentes recientes',
      bullets: [`${inputs.freshIncidents} incidentes registrados en últimas 24h`],
    });
  }

  return { workerUid, forDate, sections };
}
