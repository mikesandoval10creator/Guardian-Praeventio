/**
 * Calendar predictions — pure rule engine.
 *
 * Given known last-completion dates per project + an array of upcoming
 * calendar events, this module decides which Chilean-SST obligations
 * (CPHS, ODI, IPER review, ISO 45001 management review, audiometría
 * PREXOR, climate review) are coming due and proposes recommended dates.
 *
 * Pure: no IO, no Date.now(). The caller passes `now` explicitly.
 */

import { getNextDueDate, type ObligationKind } from './legalObligations';

export interface CalendarEvent {
  id: string;
  title: string;
  startTime: Date;
  endTime: Date;
  attendees?: string[];
}

export type PredictedActivityType =
  | 'cphs-meeting'
  | 'odi-training'
  | 'audiometria'
  | 'iper-review'
  | 'management-review-iso45001'
  | 'climate-risk-review';

export interface PredictedActivity {
  type: PredictedActivityType;
  projectId: string;
  recommendedDate: Date;
  recommendedDurationMin: number;
  reason: string;
  legalReference?: string;
  priority: 'info' | 'warning' | 'critical';
}

export interface ProjectPredictionContext {
  id: string;
  lastCphsMeeting?: Date;
  lastOdi?: Date;
  lastIperReview?: Date;
  lastAudiometria?: Date;
  lastManagementReview?: Date;
  lastClimateReview?: Date;
  audiometriaDosePercent?: number;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

const DAY_MS = 24 * 60 * 60 * 1000;

const CPHS_KEYWORDS = ['cphs', 'comité paritario', 'comite paritario', 'paritario'];
const ODI_KEYWORDS = ['odi', 'obligación de informar', 'obligacion de informar'];
const IPER_KEYWORDS = ['iper', 'matriz de riesgo', 'matriz iper'];
const MGMT_KEYWORDS = ['revisión por la dirección', 'revision por la direccion', 'iso 45001', 'management review'];
const AUDIO_KEYWORDS = ['audiometría', 'audiometria', 'prexor'];
const CLIMATE_KEYWORDS = ['clima', 'climático', 'climatico', 'meteor'];

function eventMentionsProject(event: CalendarEvent, projectId: string): boolean {
  // Match the project id directly OR fall back to "any project" when the
  // calendar event title is a generic obligation reminder. The calendar
  // sync layer prefixes events with the project id when it has one, so we
  // optimistically treat untagged matches as project-agnostic.
  const lower = event.title.toLowerCase();
  if (lower.includes(projectId.toLowerCase())) return true;
  return false;
}

function hasUpcomingEvent(
  events: CalendarEvent[],
  keywords: string[],
  projectId: string,
  now: Date,
  windowDays: number,
): boolean {
  const horizon = now.getTime() + windowDays * DAY_MS;
  return events.some((evt) => {
    if (evt.startTime.getTime() < now.getTime()) return false;
    if (evt.startTime.getTime() > horizon) return false;
    const lower = evt.title.toLowerCase();
    const keywordMatch = keywords.some((k) => lower.includes(k));
    if (!keywordMatch) return false;
    // If the event mentions a specific project id, require it to match.
    // Otherwise treat it as a generic match for that project.
    if (eventMentionsProject(evt, projectId)) return true;
    return true;
  });
}

interface RuleEval {
  type: PredictedActivityType;
  obligationKind: ObligationKind;
  lastDate?: Date;
  /** How many days before the due date we should start surfacing the prediction. */
  leadDays: number;
  /**
   * Maximum days from `now` for the recommendedDate. The prediction's
   * recommended date is clamped to `min(dueDate, now + recommendWithinDays)`
   * so the user is nudged to act proactively rather than at the legal limit.
   */
  recommendWithinDays: number;
  /** Calendar window (days from now) within which we look for an existing event before suppressing. */
  suppressionWindowDays: number;
  keywords: string[];
  durationMin: number;
  reasonPrefix: string;
  context?: { dosePercent?: number };
}

function priorityFor(daysUntilDue: number): 'info' | 'warning' | 'critical' {
  if (daysUntilDue <= 0) return 'critical';
  if (daysUntilDue <= 7) return 'warning';
  return 'info';
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

export function predictUpcomingActivities(
  events: CalendarEvent[],
  projects: ProjectPredictionContext[],
  now: Date,
): PredictedActivity[] {
  const out: PredictedActivity[] = [];

  for (const project of projects) {
    const rules: RuleEval[] = [
      {
        // CPHS: only surface when overdue (lead 0). Once the legal cadence
        // has elapsed we recommend doing it within the next 7 days.
        type: 'cphs-meeting',
        obligationKind: 'cphs-meeting',
        lastDate: project.lastCphsMeeting,
        leadDays: 0,
        recommendWithinDays: 7,
        suppressionWindowDays: 14,
        keywords: CPHS_KEYWORDS,
        durationMin: 60,
        reasonPrefix: 'Próxima sesión mensual del CPHS pendiente',
      },
      {
        type: 'odi-training',
        obligationKind: 'odi-training',
        lastDate: project.lastOdi,
        leadDays: 21,
        recommendWithinDays: 21,
        suppressionWindowDays: 30,
        keywords: ODI_KEYWORDS,
        durationMin: 90,
        reasonPrefix: 'Capacitación ODI semestral pendiente',
      },
      {
        type: 'iper-review',
        obligationKind: 'iper-review',
        lastDate: project.lastIperReview,
        leadDays: 21,
        recommendWithinDays: 21,
        suppressionWindowDays: 30,
        keywords: IPER_KEYWORDS,
        durationMin: 120,
        reasonPrefix: 'Revisión periódica de la matriz IPER',
      },
      {
        // ISO 45001 9.3 — surface anytime in the last 60 days of the
        // annual cadence, but recommend scheduling within the next 30 days.
        type: 'management-review-iso45001',
        obligationKind: 'management-review-iso45001',
        lastDate: project.lastManagementReview,
        leadDays: 60,
        recommendWithinDays: 30,
        suppressionWindowDays: 45,
        keywords: MGMT_KEYWORDS,
        durationMin: 120,
        reasonPrefix: 'Revisión por la dirección (ISO 45001)',
      },
      {
        type: 'audiometria',
        obligationKind: 'audiometria-prexor',
        lastDate: project.lastAudiometria,
        leadDays: 30,
        recommendWithinDays: 30,
        suppressionWindowDays: 30,
        keywords: AUDIO_KEYWORDS,
        durationMin: 60,
        reasonPrefix: 'Vigilancia audiométrica PREXOR',
        context: { dosePercent: project.audiometriaDosePercent },
      },
      {
        type: 'climate-risk-review',
        obligationKind: 'climate-risk-review',
        lastDate: project.lastClimateReview,
        leadDays: 14,
        recommendWithinDays: 14,
        suppressionWindowDays: 21,
        keywords: CLIMATE_KEYWORDS,
        durationMin: 30,
        reasonPrefix: 'Revisión trimestral de riesgos climáticos',
      },
    ];

    for (const rule of rules) {
      if (!rule.lastDate) continue; // No baseline → can't predict from cadence alone.

      const due = getNextDueDate(rule.obligationKind, rule.lastDate, rule.context);
      const daysUntilDue = Math.floor((due.dueDate.getTime() - now.getTime()) / DAY_MS);

      if (daysUntilDue > rule.leadDays) continue; // Too far out.

      // Suppress if a matching event is already in the calendar.
      if (hasUpcomingEvent(events, rule.keywords, project.id, now, rule.suppressionWindowDays)) {
        continue;
      }

      // Recommended date: clamp to [now, now + recommendWithinDays] window
      // even if the legal due date is further out. Never schedule in the past.
      const upperBound = now.getTime() + rule.recommendWithinDays * DAY_MS;
      const recommendedTime = Math.min(
        Math.max(due.dueDate.getTime(), now.getTime()),
        upperBound,
      );
      const recommended = new Date(recommendedTime);

      out.push({
        type: rule.type,
        projectId: project.id,
        recommendedDate: recommended,
        recommendedDurationMin: rule.durationMin,
        reason: `${rule.reasonPrefix} (cadencia ${due.cadenceDays} días).`,
        legalReference: due.legalReference,
        priority: priorityFor(daysUntilDue),
      });
    }
  }

  return out;
}
