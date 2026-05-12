// Praeventio Guard — Wire UI #16: <LotoStatusPanel />
//
// Vista del estado de un LOTO application (lock points aplicados,
// verificación cero energía, autorización de trabajo).

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, Unlock, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import {
  validateLotoApplication,
  type LotoApplication,
} from '../../services/loto/lotoDigitalLight.js';

interface LotoStatusPanelProps {
  application: LotoApplication;
  onApplyLockPoint?: () => void;
  onVerifyZeroEnergy?: (pointId: string) => void;
  onRelease?: () => void;
}

export function LotoStatusPanel({
  application,
  onApplyLockPoint,
  onVerifyZeroEnergy,
  onRelease,
}: LotoStatusPanelProps) {
  const { t } = useTranslation();
  const validation = useMemo(() => validateLotoApplication(application), [application]);
  const isReleased = Boolean(application.fullyReleasedAt);

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode"
      data-testid="loto-status-panel"
      aria-label={t('loto.aria', 'Estado LOTO') as string}
    >
      <header className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide flex items-center gap-2">
          {isReleased ? (
            <Unlock className="w-4 h-4 text-emerald-500" aria-hidden="true" />
          ) : (
            <Lock className="w-4 h-4 text-rose-500" aria-hidden="true" />
          )}
          LOTO — {application.equipmentId}
        </h2>
        <span
          className={`text-[10px] font-bold px-2 py-0.5 rounded ${
            isReleased
              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : validation.authorizesWork
                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
          }`}
          data-testid="loto-state-badge"
        >
          {isReleased
            ? t('loto.released', 'LIBERADO')
            : validation.authorizesWork
              ? t('loto.authorized', 'AUTORIZADO')
              : t('loto.blocked', 'BLOQUEADO')}
        </span>
      </header>

      <p className="text-xs text-secondary-token mb-3">{application.workDescription}</p>

      <div className="grid grid-cols-2 gap-3 mb-3 text-xs">
        <div>
          <p className="text-[10px] uppercase opacity-70">{t('loto.energiesIdentified', 'Energías')}</p>
          <p className="font-bold">{application.energiesIdentified.join(', ')}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase opacity-70">{t('loto.leader', 'Líder')}</p>
          <p className="font-bold">{application.leaderUid}</p>
        </div>
      </div>

      <div className="mb-3">
        <p className="text-[10px] uppercase opacity-70 mb-1">
          {t('loto.lockPoints', 'Lock Points')} ({application.lockPoints.length})
        </p>
        <ul className="space-y-1.5">
          {application.lockPoints.map((lp) => (
            <li
              key={lp.pointId}
              data-testid={`loto-point-${lp.pointId}`}
              className="flex items-center gap-2 text-xs"
            >
              {lp.zeroEnergyVerified ? (
                <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" aria-hidden="true" />
              ) : (
                <XCircle className="w-3 h-3 text-rose-500 shrink-0" aria-hidden="true" />
              )}
              <span className="flex-1 min-w-0 truncate">
                <span className="font-bold">{lp.tagId}</span> · {lp.description}
              </span>
              <span className="text-[9px] opacity-70">{lp.energyType}</span>
              {!lp.zeroEnergyVerified && onVerifyZeroEnergy && (
                <button
                  type="button"
                  onClick={() => onVerifyZeroEnergy(lp.pointId)}
                  data-testid={`loto-verify-${lp.pointId}`}
                  className="text-[10px] font-bold underline text-amber-700 dark:text-amber-300"
                >
                  {t('loto.verifyZero', 'Verificar cero')}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      {validation.messages.length > 0 && (
        <ul className="mb-3 space-y-1">
          {validation.messages.map((m, i) => (
            <li
              key={i}
              className="text-[11px] text-amber-700 dark:text-amber-300 flex items-start gap-1"
            >
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
              {m}
            </li>
          ))}
        </ul>
      )}

      {!isReleased && (
        <div className="flex gap-2 mt-3">
          {onApplyLockPoint && (
            <button
              type="button"
              onClick={onApplyLockPoint}
              data-testid="loto-add-point"
              className="text-xs font-bold px-3 py-1.5 rounded-md bg-sky-500/10 text-sky-700 dark:text-sky-300 hover:bg-sky-500/20"
            >
              + {t('loto.addPoint', 'Aplicar lock point')}
            </button>
          )}
          {onRelease && validation.authorizesWork && (
            <button
              type="button"
              onClick={onRelease}
              data-testid="loto-release"
              className="ml-auto text-xs font-bold px-3 py-1.5 rounded-md bg-emerald-500 text-white hover:bg-emerald-600"
            >
              {t('loto.releaseAll', 'Liberar todo')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
