// Praeventio Guard — Wire UI #28: <DriverScoreCard />
//
// Tarjeta individual del conductor con score, level, blockers y
// fechas críticas de licencia.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Car, AlertOctagon, CheckCircle2, AlertTriangle } from 'lucide-react';
import {
  computeDriverScore,
  type DriverProfile,
  type DriverScoreReport,
} from '../../services/drivingSafety/drivingSafetyService.js';

interface DriverScoreCardProps {
  profile: DriverProfile;
}

const LEVEL_CLASS: Record<DriverScoreReport['level'], string> = {
  excellent: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40',
  good: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30',
  fair: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/40',
  poor: 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/40',
  critical: 'bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/40',
};

export function DriverScoreCard({ profile }: DriverScoreCardProps) {
  const { t } = useTranslation();
  const report = useMemo(() => computeDriverScore(profile), [profile]);
  const Icon = report.canOperate ? CheckCircle2 : AlertOctagon;

  return (
    <section
      className={`rounded-2xl border-2 p-4 shadow-mode ${LEVEL_CLASS[report.level]}`}
      data-testid={`driver-score-${profile.workerUid}`}
      aria-label={t('driver.aria', 'Score de conductor') as string}
    >
      <header className="flex items-center gap-2 mb-2">
        <Car className="w-4 h-4" aria-hidden="true" />
        <h3 className="text-sm font-black uppercase tracking-wide">
          {profile.workerUid}
        </h3>
        <span className="ml-auto text-2xl font-black tabular-nums" data-testid="driver-score-value">
          {report.safetyScore}
        </span>
      </header>

      <div className="grid grid-cols-2 gap-2 text-xs mb-2">
        <div>
          <p className="text-[10px] uppercase opacity-70">
            {t('driver.licenseClass', 'Licencia')}
          </p>
          <p className="font-bold">{profile.licenseClass}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase opacity-70">
            {t('driver.experience', 'Experiencia')}
          </p>
          <p className="font-bold">{profile.yearsExperience} años</p>
        </div>
        <div>
          <p className="text-[10px] uppercase opacity-70">
            {t('driver.incidents12m', 'Incidentes 12m')}
          </p>
          <p className="font-bold tabular-nums">{profile.incidents12m}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase opacity-70">
            {t('driver.speeding30d', 'Speeding 30d')}
          </p>
          <p className="font-bold tabular-nums">{profile.speedingEvents30d}</p>
        </div>
      </div>

      <div
        className="flex items-center gap-2 text-xs font-bold mb-2"
        data-testid="driver-can-operate"
      >
        <Icon className="w-4 h-4" aria-hidden="true" />
        {report.canOperate
          ? t('driver.canOperate', 'Autorizado para operar')
          : t('driver.cannotOperate', 'NO autorizado')}
        <span className="ml-auto text-[10px] uppercase opacity-80">{report.level}</span>
      </div>

      {report.blockers.length > 0 && (
        <ul className="space-y-1" data-testid="driver-blockers">
          {report.blockers.map((b, i) => (
            <li key={i} className="text-[11px] flex items-start gap-1">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
