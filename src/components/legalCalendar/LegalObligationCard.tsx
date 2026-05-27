// Praeventio Guard — Plan Bloque 3.14: <LegalObligationCard />
//
// Card individual para UNA obligación legal próxima a vencer / vencida /
// cumplida. Muestra:
//   • Tipo de obligación (entrega DIAT, examen ocupacional, renovación
//     capacitación, vencimiento extintores, etc.).
//   • Cita legal (DS, ley, ISO).
//   • Días hasta vencimiento (teal cuando tranquilo, amber cuando se
//     acerca, rose cuando vencido).
//   • Banner directiva: "Entrega PENDIENTE: la empresa debe firmar y
//     entregar — Praeventio NO envía automáticamente."
//   • Acciones (opt-in via props): "Marcar entregada" / "Posponer".
//
// La card es presentacional. El padre conecta `onAcknowledge` /
// `onSnooze` con los wrappers de `useLegalCalendar.ts`.

import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react';
import type {
  CalendarEntry,
  ObligationKind,
} from '../../services/legalCalendar/legalObligationsCalendar.js';

export type LegalObligationVariant = 'upcoming' | 'overdue' | 'done';

interface LegalObligationCardProps {
  entry: CalendarEntry;
  /**
   * Visual tone of the card. Defaults derive from the entry:
   *   isOverdue → 'overdue', isInAlertWindow → 'upcoming', else 'upcoming'.
   * Pass 'done' explicitly when rendering the "cumplidas" tab.
   */
  variant?: LegalObligationVariant;
  /** Optional supervisor action — mark obligation as firmada + entregada. */
  onAcknowledge?: (entry: CalendarEntry) => void;
  /** Optional supervisor action — postpone (snooze) the next due date. */
  onSnooze?: (entry: CalendarEntry) => void;
  /** Optional row-click handler for navigation (detail page). */
  onClick?: (entry: CalendarEntry) => void;
}

const KIND_LABEL: Record<ObligationKind, string> = {
  audit: 'Auditoría',
  env_measurement: 'Medición ambiental',
  training_renewal: 'Renovación capacitación',
  cphs_meeting: 'Reunión CPHS',
  mutualidad_report: 'Reporte mutualidad',
  drill: 'Simulacro',
  medical_exam: 'Examen ocupacional',
  document_renewal: 'Renovación documento',
  permit_renewal: 'Renovación permiso',
};

const KIND_ICON: Record<ObligationKind, LucideIcon> = {
  audit: ShieldAlert,
  env_measurement: AlertTriangle,
  training_renewal: CalendarClock,
  cphs_meeting: CalendarClock,
  mutualidad_report: CalendarClock,
  drill: AlertTriangle,
  medical_exam: ShieldAlert,
  document_renewal: CalendarClock,
  permit_renewal: ShieldAlert,
};

function resolveVariant(entry: CalendarEntry, explicit?: LegalObligationVariant): LegalObligationVariant {
  if (explicit) return explicit;
  if (entry.isOverdue) return 'overdue';
  return 'upcoming';
}

interface VariantTokens {
  card: string;
  badge: string;
  meta: string;
  Icon: LucideIcon;
  badgeLabel: string;
}

function variantTokens(
  variant: LegalObligationVariant,
  entry: CalendarEntry,
  t: ReturnType<typeof useTranslation>['t'],
): VariantTokens {
  if (variant === 'overdue') {
    return {
      card: 'bg-rose-50 border-rose-300 dark:bg-rose-950/40 dark:border-rose-800',
      badge:
        'bg-rose-600 text-white dark:bg-rose-500',
      meta: 'text-rose-700 dark:text-rose-300',
      Icon: AlertTriangle,
      badgeLabel: t(
        'legal_card.badge_overdue',
        `Vencida hace ${Math.abs(entry.daysUntilDue)}d`,
        { days: Math.abs(entry.daysUntilDue) },
      ) as string,
    };
  }
  if (variant === 'done') {
    return {
      card: 'bg-emerald-50 border-emerald-300 dark:bg-emerald-950/40 dark:border-emerald-800',
      badge:
        'bg-emerald-600 text-white dark:bg-emerald-500',
      meta: 'text-emerald-700 dark:text-emerald-300',
      Icon: CheckCircle2,
      badgeLabel: t('legal_card.badge_done', 'Cumplida') as string,
    };
  }
  // upcoming — split by alert window severity
  const tight = entry.isInAlertWindow && entry.daysUntilDue <= 7;
  if (tight) {
    return {
      card: 'bg-amber-50 border-amber-300 dark:bg-amber-950/40 dark:border-amber-800',
      badge: 'bg-amber-500 text-white',
      meta: 'text-amber-700 dark:text-amber-300',
      Icon: Clock,
      badgeLabel: t(
        'legal_card.badge_due_soon',
        `En ${entry.daysUntilDue}d`,
        { days: entry.daysUntilDue },
      ) as string,
    };
  }
  return {
    card: 'bg-teal-50 border-teal-300 dark:bg-teal-950/40 dark:border-teal-800',
    badge: 'bg-teal-600 text-white dark:bg-teal-500',
    meta: 'text-teal-700 dark:text-teal-300',
    Icon: CalendarClock,
    badgeLabel: t(
      'legal_card.badge_due',
      `En ${entry.daysUntilDue}d`,
      { days: entry.daysUntilDue },
    ) as string,
  };
}

export function LegalObligationCard({
  entry,
  variant: variantProp,
  onAcknowledge,
  onSnooze,
  onClick,
}: LegalObligationCardProps) {
  const { t } = useTranslation();
  const variant = resolveVariant(entry, variantProp);
  const tokens = variantTokens(variant, entry, t);
  const { Icon } = tokens;
  const KindIcon = KIND_ICON[entry.kind];
  const dueDateLabel = (() => {
    try {
      const d = new Date(entry.nextDueAt);
      return d.toLocaleDateString();
    } catch {
      return entry.nextDueAt;
    }
  })();

  const interactive = Boolean(onClick);

  return (
    <article
      className={`rounded-2xl border p-4 space-y-3 shadow-sm transition-shadow ${tokens.card} ${
        interactive ? 'cursor-pointer hover:shadow-md' : ''
      }`}
      data-testid={`legal-obligation-card-${entry.id}`}
      data-variant={variant}
      aria-label={t('legal_card.aria', 'Obligación legal') as string}
      onClick={interactive ? () => onClick?.(entry) : undefined}
    >
      <header className="flex items-start gap-2">
        <span
          className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-white/70 dark:bg-zinc-900/60 shrink-0"
          aria-hidden="true"
        >
          <KindIcon className="w-4 h-4 text-zinc-700 dark:text-zinc-200" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            {KIND_LABEL[entry.kind]}
          </p>
          <h3
            className="text-sm font-bold text-zinc-900 dark:text-zinc-100 leading-snug"
            data-testid={`legal-obligation-card-${entry.id}-title`}
          >
            {entry.label}
          </h3>
        </div>
        <span
          className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-md shrink-0 ${tokens.badge}`}
          data-testid={`legal-obligation-card-${entry.id}-badge`}
        >
          <Icon className="w-3 h-3" aria-hidden="true" />
          {tokens.badgeLabel}
        </span>
      </header>

      <dl className="grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <dt className="uppercase font-bold text-zinc-500 dark:text-zinc-400">
            {t('legal_card.due_date', 'Vence')}
          </dt>
          <dd className={`font-bold tabular-nums ${tokens.meta}`} data-testid={`legal-obligation-card-${entry.id}-due`}>
            {dueDateLabel}
          </dd>
        </div>
        <div>
          <dt className="uppercase font-bold text-zinc-500 dark:text-zinc-400">
            {t('legal_card.citation', 'Normativa')}
          </dt>
          <dd className="font-mono text-zinc-700 dark:text-zinc-300 text-[10px] leading-tight">
            {entry.legalCitation}
          </dd>
        </div>
      </dl>

      {variant !== 'done' && (
        <p
          className="rounded-lg bg-white/70 dark:bg-zinc-900/40 border border-current/20 p-2 text-[11px] text-zinc-700 dark:text-zinc-200 leading-snug"
          data-testid={`legal-obligation-card-${entry.id}-no-push`}
        >
          <strong className="font-bold uppercase tracking-wide text-[10px] block mb-0.5">
            {t('legal_card.no_push_title', 'Entrega PENDIENTE')}:
          </strong>
          {t(
            'legal_card.no_push_body',
            'la empresa debe firmar y entregar — Praeventio NO envía automáticamente.',
          )}
        </p>
      )}

      {(onAcknowledge || onSnooze) && variant !== 'done' && (
        <div
          className="flex flex-wrap gap-2 pt-1"
          data-testid={`legal-obligation-card-${entry.id}-actions`}
        >
          {onAcknowledge && (
            <button
              type="button"
              onClick={(ev) => {
                ev.stopPropagation();
                onAcknowledge(entry);
              }}
              data-testid={`legal-obligation-card-${entry.id}-acknowledge`}
              className="inline-flex items-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white"
            >
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
              {t('legal_card.action_acknowledge', 'Marcar entregada')}
            </button>
          )}
          {onSnooze && (
            <button
              type="button"
              onClick={(ev) => {
                ev.stopPropagation();
                onSnooze(entry);
              }}
              data-testid={`legal-obligation-card-${entry.id}-snooze`}
              className="inline-flex items-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded-lg border border-current text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100/70 dark:hover:bg-zinc-800"
            >
              <Clock className="w-3.5 h-3.5" aria-hidden="true" />
              {t('legal_card.action_snooze', 'Posponer')}
            </button>
          )}
        </div>
      )}
    </article>
  );
}
