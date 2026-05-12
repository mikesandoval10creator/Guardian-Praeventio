// Praeventio Guard — Wire UI #54: <AgendaDigestCard />
//
// Renderiza el daily digest del prevencionista: secciones generadas
// por buildDailyDigest.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock } from 'lucide-react';
import {
  buildDailyDigest,
  type DigestInputs,
} from '../../services/agenda/agendaScheduler.js';

interface AgendaDigestCardProps {
  workerUid: string;
  forDate: string;
  inputs: DigestInputs;
}

export function AgendaDigestCard({ workerUid, forDate, inputs }: AgendaDigestCardProps) {
  const { t } = useTranslation();
  const digest = useMemo(
    () => buildDailyDigest(workerUid, forDate, inputs),
    [workerUid, forDate, inputs],
  );

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid="agenda-digest-card"
      aria-label={t('agenda.digestAria', 'Digest diario') as string}
    >
      <header className="flex items-center gap-2">
        <CalendarClock className="w-4 h-4 text-sky-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('agenda.digestTitle', 'Tu día')}
        </h2>
        <span className="ml-auto text-[10px] text-secondary-token tabular-nums">{forDate}</span>
      </header>

      {digest.sections.length === 0 ? (
        <p
          className="text-[11px] text-secondary-token italic"
          data-testid="agenda-digest-empty"
        >
          {t('agenda.emptyDigest', 'Nada urgente hoy. Espacio para foco.')}
        </p>
      ) : (
        <div className="space-y-3">
          {digest.sections.map((s, i) => (
            <div
              key={i}
              data-testid={`agenda-digest-section-${i}`}
              className="bg-surface-elevated rounded p-2"
            >
              <h3 className="text-[10px] uppercase font-bold text-secondary-token mb-1">
                {s.title}
              </h3>
              <ul className="space-y-0.5">
                {s.bullets.map((b, j) => (
                  <li
                    key={j}
                    className="text-[11px]"
                    data-testid={`agenda-digest-bullet-${i}-${j}`}
                  >
                    • {b}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
