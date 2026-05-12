// Praeventio Guard — Wire UI #81: <AirQualityPanel />
//
// Panel CO2 + recomendación ventilación. Render del steady-state
// predicho + clasificación ASHRAE.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Wind, AlertOctagon, Thermometer } from 'lucide-react';
import {
  steadyStateCO2Ppm,
  recommendVentilation,
  classifyAirQuality,
  steadyStateTemperatureC,
  type CO2Zone,
  type CO2Driver,
  type ThermalZone,
  type ThermalDriver,
  type AirQualityLevel,
} from '../../services/hvac/thermalModel.js';

interface AirQualityPanelProps {
  co2Zone: CO2Zone;
  co2Driver: CO2Driver;
  /** Lectura actual del sensor (ppm). Si no, se usa el steady-state. */
  currentPpm?: number;
  /** Opcional: zona térmica para predecir T_ss. */
  thermal?: { zone: ThermalZone; driver: ThermalDriver };
}

const LEVEL_TONE: Record<AirQualityLevel, { bg: string; color: string; label: string }> = {
  excellent: { bg: 'bg-emerald-500/10', color: 'text-emerald-600', label: 'Excelente' },
  good: { bg: 'bg-teal-500/10', color: 'text-teal-600', label: 'Buena' },
  acceptable: { bg: 'bg-amber-500/10', color: 'text-amber-600', label: 'Aceptable' },
  poor: { bg: 'bg-orange-500/10', color: 'text-orange-600', label: 'Pobre' },
  critical: { bg: 'bg-rose-500/10', color: 'text-rose-600', label: 'Crítica' },
};

export function AirQualityPanel({
  co2Zone,
  co2Driver,
  currentPpm,
  thermal,
}: AirQualityPanelProps) {
  const { t } = useTranslation();
  const ssPpm = useMemo(() => steadyStateCO2Ppm(co2Zone, co2Driver), [co2Zone, co2Driver]);
  const ppm = currentPpm ?? ssPpm;
  const level = useMemo(() => classifyAirQuality(ppm), [ppm]);
  const rec = useMemo(() => recommendVentilation(ppm), [ppm]);
  const tone = LEVEL_TONE[level];

  const ssTemp = useMemo(
    () => (thermal ? steadyStateTemperatureC(thermal.zone, thermal.driver) : null),
    [thermal],
  );

  return (
    <section
      className={`rounded-2xl border border-default-token p-4 shadow-mode space-y-3 ${tone.bg}`}
      data-testid="air-quality-panel"
      aria-label={t('airQuality.aria', 'Calidad de aire') as string}
    >
      <header className="flex items-center gap-2">
        <Wind className={`w-4 h-4 ${tone.color}`} aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('airQuality.title', 'Calidad de aire')}
        </h2>
        <span
          className={`ml-auto text-[10px] font-bold uppercase ${tone.color}`}
          data-testid="air-quality-level"
        >
          {tone.label}
        </span>
      </header>

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-surface rounded p-2" data-testid="air-quality-ppm">
          <p className="text-[10px] uppercase text-secondary-token">
            {t('airQuality.co2', 'CO₂ predicción')}
          </p>
          <p className={`text-2xl font-black tabular-nums ${tone.color}`}>
            {Number.isFinite(ppm) ? Math.round(ppm) : '∞'}
          </p>
          <p className="text-[9px] uppercase text-secondary-token">ppm</p>
        </div>
        {ssTemp !== null && (
          <div className="bg-surface rounded p-2" data-testid="air-quality-temp">
            <p className="text-[10px] uppercase text-secondary-token flex items-center gap-1">
              <Thermometer className="w-3 h-3" aria-hidden="true" />
              {t('airQuality.temp', 'T° steady-state')}
            </p>
            <p className="text-2xl font-black tabular-nums">{ssTemp.toFixed(1)}</p>
            <p className="text-[9px] uppercase text-secondary-token">°C</p>
          </div>
        )}
      </div>

      <div className="flex justify-between text-[10px] text-secondary-token">
        <span>
          {t('airQuality.occupancy', 'Ocupantes')}:{' '}
          <span className="font-bold tabular-nums">{co2Driver.occupancyCount}</span>
        </span>
        <span>
          {t('airQuality.ventilation', 'Ventilación')}:{' '}
          <span className="font-bold tabular-nums">{co2Zone.airExchangeM3perH} m³/h</span>
        </span>
      </div>

      <p className="text-[11px]" data-testid="air-quality-message">
        {rec.message}
      </p>

      {rec.actions.length > 0 && (
        <div data-testid="air-quality-actions">
          <h3 className="flex items-center gap-1 text-[10px] uppercase font-bold text-secondary-token mb-1">
            <AlertOctagon className="w-3 h-3" aria-hidden="true" />
            {t('airQuality.actions', 'Acciones recomendadas')}
          </h3>
          <ul className="space-y-1">
            {rec.actions.map((a, i) => (
              <li
                key={i}
                className="text-[11px] bg-surface rounded px-2 py-1"
                data-testid={`air-quality-action-${i}`}
              >
                → {a}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
