// Praeventio Guard — Wire UI #64: <ZoneEntryGate />
//
// Gate visual ante intento de entrada a zona restringida. Muestra
// si está permitido o lista los requisitos faltantes (EPP / training
// / permit).

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { DoorOpen, DoorClosed, ShieldAlert } from 'lucide-react';
import {
  checkZoneEntry,
  type ZoneEntryCheckInput,
} from '../../services/zones/restrictedZonesEngine.js';

interface ZoneEntryGateProps {
  input: ZoneEntryCheckInput;
  onAcknowledge?: () => void;
}

export function ZoneEntryGate({ input, onAcknowledge }: ZoneEntryGateProps) {
  const { t } = useTranslation();
  const result = useMemo(() => checkZoneEntry(input), [input]);

  const tone = result.allowed
    ? {
        Icon: DoorOpen,
        color: 'text-emerald-500',
        bg: 'bg-emerald-500/10',
        border: 'border-emerald-500/30',
        label: t('zoneGate.allowed', 'ENTRADA PERMITIDA'),
        badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
      }
    : {
        Icon: DoorClosed,
        color: 'text-rose-500',
        bg: 'bg-rose-500/10',
        border: 'border-rose-500/30',
        label: t('zoneGate.denied', 'ENTRADA BLOQUEADA'),
        badge: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
      };

  const { Icon } = tone;

  return (
    <section
      className={`rounded-2xl border p-4 shadow-mode space-y-3 ${tone.bg} ${tone.border}`}
      data-testid={`zone-gate-${input.zone.id}`}
      aria-label={t('zoneGate.aria', 'Control acceso zona') as string}
    >
      <header className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${tone.color}`} aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token truncate">
          {input.zone.name}
        </h2>
        <span
          className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded ${tone.badge}`}
          data-testid={`zone-gate-status-${input.zone.id}`}
        >
          {tone.label}
        </span>
      </header>

      <div className="flex items-center gap-2 text-[10px] uppercase text-secondary-token">
        <span>{t('zoneGate.kind', 'Tipo')}:</span>
        <span className="font-bold">{input.zone.kind}</span>
        <span className="ml-auto truncate">UID: {input.workerUid}</span>
      </div>

      {result.missing.length > 0 && (
        <div data-testid={`zone-gate-missing-${input.zone.id}`}>
          <h3 className="flex items-center gap-1 text-[10px] uppercase font-bold text-rose-700 dark:text-rose-300 mb-1">
            <ShieldAlert className="w-3 h-3" aria-hidden="true" />
            {t('zoneGate.missing', 'Falta para entrar')}
          </h3>
          <ul className="space-y-1">
            {result.missing.map((m, i) => (
              <li
                key={i}
                className="text-[11px] text-rose-700 dark:text-rose-300 bg-rose-500/5 p-1.5 rounded"
                data-testid={`zone-gate-missing-item-${i}`}
              >
                {m}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.warnings.length > 0 && (
        <ul className="space-y-0.5" data-testid={`zone-gate-warnings-${input.zone.id}`}>
          {result.warnings.map((w, i) => (
            <li
              key={i}
              className="text-[11px] text-amber-700 dark:text-amber-300"
              data-testid={`zone-gate-warning-${i}`}
            >
              ⚠ {w}
            </li>
          ))}
        </ul>
      )}

      {result.allowed && onAcknowledge && (
        <button
          type="button"
          onClick={onAcknowledge}
          data-testid={`zone-gate-ack-${input.zone.id}`}
          className="w-full px-3 py-1.5 rounded bg-emerald-500 text-white text-xs font-bold hover:bg-emerald-600"
        >
          {t('zoneGate.acknowledge', 'Acepto las reglas y entro')}
        </button>
      )}
    </section>
  );
}
