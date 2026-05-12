// Praeventio Guard — Wire UI #60: <HeatStressCard />
//
// Muestra protocolo de trabajo/descanso recomendado según WBGT +
// intensidad de carga (NIOSH/ACGIH).

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Thermometer, Droplets, Octagon } from 'lucide-react';
import {
  approximateWBGT,
  heatStressProtocol,
  type WorkIntensity,
} from '../../services/exposure/thermalStressCalculator.js';

interface HeatStressCardProps {
  tempC: number;
  humidityPercent: number;
  solarLoad?: 'none' | 'low' | 'medium' | 'high';
  intensity: WorkIntensity;
}

export function HeatStressCard({
  tempC,
  humidityPercent,
  solarLoad = 'medium',
  intensity,
}: HeatStressCardProps) {
  const { t } = useTranslation();
  const wbgt = useMemo(
    () => approximateWBGT(tempC, humidityPercent, solarLoad),
    [tempC, humidityPercent, solarLoad],
  );
  const protocol = useMemo(() => heatStressProtocol(wbgt, intensity), [wbgt, intensity]);

  const tone = protocol.stopWork
    ? 'bg-rose-500/10 border-rose-500/30'
    : protocol.workMinutesPerHour < 30
      ? 'bg-orange-500/10 border-orange-500/30'
      : protocol.workMinutesPerHour < 60
        ? 'bg-amber-500/10 border-amber-500/30'
        : 'bg-emerald-500/10 border-emerald-500/30';

  return (
    <section
      className={`rounded-2xl border p-4 shadow-mode space-y-3 ${tone}`}
      data-testid="heat-stress-card"
      aria-label={t('heatStress.aria', 'Estrés térmico WBGT') as string}
    >
      <header className="flex items-center gap-2">
        <Thermometer className="w-4 h-4 text-orange-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('heatStress.title', 'Estrés térmico')}
        </h2>
        <span className="ml-auto text-[10px] uppercase font-bold" data-testid="heat-stress-wbgt">
          WBGT {wbgt}°C
        </span>
      </header>

      {protocol.stopWork ? (
        <div
          className="flex items-start gap-2 bg-rose-500/20 text-rose-700 dark:text-rose-300 p-2 rounded text-[11px] font-bold"
          data-testid="heat-stress-stop"
        >
          <Octagon className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{protocol.message}</span>
        </div>
      ) : (
        <p className="text-xs text-secondary-token" data-testid="heat-stress-message">
          {protocol.message}
        </p>
      )}

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-surface rounded p-2" data-testid="heat-stress-work">
          <p className="text-[10px] uppercase text-secondary-token">
            {t('heatStress.work', 'Trabajo')}
          </p>
          <p className="text-xl font-black tabular-nums">{protocol.workMinutesPerHour}</p>
          <p className="text-[9px] uppercase">min/h</p>
        </div>
        <div className="bg-surface rounded p-2" data-testid="heat-stress-rest">
          <p className="text-[10px] uppercase text-secondary-token">
            {t('heatStress.rest', 'Descanso')}
          </p>
          <p className="text-xl font-black tabular-nums">{protocol.restMinutesPerHour}</p>
          <p className="text-[9px] uppercase">min/h</p>
        </div>
        <div className="bg-surface rounded p-2" data-testid="heat-stress-hydration">
          <p className="text-[10px] uppercase text-secondary-token flex items-center justify-center gap-1">
            <Droplets className="w-3 h-3" aria-hidden="true" />
            {t('heatStress.hydration', 'Agua')}
          </p>
          <p className="text-xl font-black tabular-nums">{protocol.hydrationMlPerHour}</p>
          <p className="text-[9px] uppercase">ml/h</p>
        </div>
      </div>

      <div className="flex justify-between text-[10px] text-secondary-token">
        <span>
          {t('heatStress.intensity', 'Intensidad')}:{' '}
          <span className="font-bold uppercase">{intensity}</span>
        </span>
        <span>
          {t('heatStress.solar', 'Carga solar')}:{' '}
          <span className="font-bold uppercase">{solarLoad}</span>
        </span>
      </div>
    </section>
  );
}
