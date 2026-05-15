// Praeventio Guard — Wire UI: <CphsCommitteeStatusCard />
//
// Read-only status card del Comité Paritario de Higiene y Seguridad (CPHS):
//   - Estado del comité (active / expired / dissolved)
//   - Quórum DS 54 art. 66 (mínimo 3 empleador + 3 trabajador)
//   - Cumplimiento ISO 45001:2018 §5.4 (consulta efectiva, electos)
//   - Próximas reuniones agendadas
//   - Actas firmadas vs pendientes
//
// El audit hallazgo H29 (P1) detectó que la app mencionaba CPHS en
// strings pero no había UI para ver el estado del comité. Esta tarjeta
// cierra esa brecha.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Users, ShieldCheck, ShieldAlert, CalendarClock, FileSignature } from 'lucide-react';
import {
  isValidQuorum,
  workersAreElected,
  type CphsCommittee,
  type CphsMeeting,
} from '../../services/cphs/types.js';

interface CphsCommitteeStatusCardProps {
  committee: CphsCommittee;
  meetings: CphsMeeting[];
}

export function CphsCommitteeStatusCard({
  committee,
  meetings,
}: CphsCommitteeStatusCardProps) {
  const { t } = useTranslation();

  const status = useMemo(() => {
    const quorumOk = isValidQuorum(committee.members);
    const electedOk = workersAreElected(committee.members);
    const employer = committee.members.filter((m) => m.side === 'employer').length;
    const workers = committee.members.filter((m) => m.side === 'worker').length;
    return { quorumOk, electedOk, employer, workers };
  }, [committee]);

  const meetingStats = useMemo(() => {
    const scheduled = meetings.filter((m) => m.status === 'scheduled').length;
    const held = meetings.filter((m) => m.status === 'held').length;
    const heldWithMinutes = meetings.filter(
      (m) => m.status === 'held' && m.minutes && m.signatures.length > 0,
    ).length;
    const heldUnsigned = held - heldWithMinutes;
    return { scheduled, held, heldUnsigned };
  }, [meetings]);

  const compliantOverall =
    committee.iso45001Compliance && status.quorumOk && status.electedOk;

  return (
    <section
      className={`rounded-2xl border p-4 shadow-mode space-y-3 ${
        compliantOverall
          ? 'border-default-token bg-surface'
          : 'border-amber-500/30 bg-amber-500/5'
      }`}
      data-testid="cphs-status-card"
      aria-label={t('cphs.aria', 'Estado del Comité Paritario') as string}
    >
      <header className="flex items-center gap-2">
        <Users className="w-4 h-4 text-teal-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token">
          {t('cphs.title', 'Comité Paritario (CPHS)')}
        </h2>
        <span
          className="ml-auto text-[10px] uppercase tabular-nums px-2 py-0.5 rounded"
          data-testid="cphs-status-badge"
          style={{
            background:
              committee.status === 'active'
                ? 'rgba(16,185,129,0.15)'
                : 'rgba(244,63,94,0.15)',
            color:
              committee.status === 'active'
                ? 'rgb(5,150,105)'
                : 'rgb(225,29,72)',
          }}
        >
          {committee.status}
        </span>
      </header>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-surface-elevated rounded p-2" data-testid="cphs-employer-count">
          <p className="text-[10px] uppercase text-secondary-token">
            {t('cphs.employer', 'Empleador')}
          </p>
          <p className="text-xl font-black tabular-nums text-sky-600">
            {status.employer}
          </p>
        </div>
        <div className="bg-surface-elevated rounded p-2" data-testid="cphs-worker-count">
          <p className="text-[10px] uppercase text-secondary-token">
            {t('cphs.worker', 'Trabajadores')}
          </p>
          <p className="text-xl font-black tabular-nums text-sky-600">
            {status.workers}
          </p>
        </div>
        <div className="bg-surface-elevated rounded p-2" data-testid="cphs-iso45001">
          <p className="text-[10px] uppercase text-secondary-token flex items-center justify-center gap-1">
            {compliantOverall ? (
              <ShieldCheck className="w-3 h-3 text-emerald-500" aria-hidden="true" />
            ) : (
              <ShieldAlert className="w-3 h-3 text-amber-500" aria-hidden="true" />
            )}
            ISO 45001
          </p>
          <p
            className={`text-xs font-black ${
              compliantOverall ? 'text-emerald-600' : 'text-amber-600'
            }`}
          >
            {compliantOverall ? t('cphs.compliant', 'OK') : t('cphs.review', 'Revisar')}
          </p>
        </div>
      </div>

      {(!status.quorumOk || !status.electedOk) && (
        <div
          className="bg-amber-500/10 text-amber-700 dark:text-amber-300 p-2 rounded text-[11px] space-y-1"
          data-testid="cphs-warnings"
        >
          {!status.quorumOk && (
            <p data-testid="cphs-warn-quorum">
              ⚠ {t('cphs.quorumFail', 'Quórum insuficiente — DS 54 art. 66 exige 3+3 mínimo.')}
            </p>
          )}
          {!status.electedOk && (
            <p data-testid="cphs-warn-elected">
              ⚠ {t('cphs.electedFail', 'Representantes de trabajadores deben ser electos por sufragio.')}
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div
          className="flex items-center gap-2 bg-surface-elevated rounded p-2"
          data-testid="cphs-meetings-scheduled"
        >
          <CalendarClock className="w-3 h-3 text-violet-500" aria-hidden="true" />
          <div>
            <p className="text-[10px] uppercase text-secondary-token">
              {t('cphs.scheduled', 'Agendadas')}
            </p>
            <p className="text-sm font-black tabular-nums">{meetingStats.scheduled}</p>
          </div>
        </div>
        <div
          className="flex items-center gap-2 bg-surface-elevated rounded p-2"
          data-testid="cphs-meetings-unsigned"
        >
          <FileSignature
            className={`w-3 h-3 ${
              meetingStats.heldUnsigned > 0 ? 'text-rose-500' : 'text-emerald-500'
            }`}
            aria-hidden="true"
          />
          <div>
            <p className="text-[10px] uppercase text-secondary-token">
              {t('cphs.unsigned', 'Sin firma')}
            </p>
            <p className="text-sm font-black tabular-nums">
              {meetingStats.heldUnsigned}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
