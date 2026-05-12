// Praeventio Guard — Wire UI #68: <EquipmentStatusCard />
//
// Tarjeta resumen del equipo: estado, criticidad, próxima mantención,
// última inspección + flag si requiere checklist pre-uso.

import { useTranslation } from 'react-i18next';
import { Wrench, ScanQrCode, CalendarClock, AlertCircle } from 'lucide-react';
import type {
  Equipment,
  EquipmentStatus,
  EquipmentCriticality,
} from '../../services/equipment/equipmentQrService.js';

interface EquipmentStatusCardProps {
  equipment: Equipment;
  onScanQr?: () => void;
  onStartPreUse?: () => void;
}

const STATUS_TONE: Record<EquipmentStatus, { badge: string; color: string }> = {
  operativo: {
    badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    color: 'text-emerald-500',
  },
  restringido: {
    badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    color: 'text-amber-500',
  },
  fuera_servicio: {
    badge: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
    color: 'text-rose-500',
  },
  en_mantencion: {
    badge: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
    color: 'text-sky-500',
  },
  bloqueado_loto: {
    badge: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
    color: 'text-violet-500',
  },
};

const CRITICALITY_TONE: Record<EquipmentCriticality, string> = {
  low: 'text-emerald-600',
  medium: 'text-amber-600',
  high: 'text-orange-600',
  critical: 'text-rose-600',
};

export function EquipmentStatusCard({
  equipment,
  onScanQr,
  onStartPreUse,
}: EquipmentStatusCardProps) {
  const { t } = useTranslation();
  const tone = STATUS_TONE[equipment.status];

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid={`equipment-card-${equipment.id}`}
      aria-label={t('equipment.aria', 'Estado equipo') as string}
    >
      <header className="flex items-center gap-2">
        <Wrench className={`w-4 h-4 ${tone.color}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-black text-primary-token truncate">{equipment.code}</h2>
          <p className="text-[10px] text-secondary-token truncate">
            {equipment.type} {equipment.brand ? `· ${equipment.brand}` : ''}
            {equipment.model ? ` ${equipment.model}` : ''}
          </p>
        </div>
        <span
          className={`text-[10px] font-bold px-2 py-0.5 rounded ${tone.badge}`}
          data-testid={`equipment-status-${equipment.id}`}
        >
          {equipment.status.toUpperCase()}
        </span>
      </header>

      <div className="grid grid-cols-2 gap-2 text-[10px]">
        <div className="bg-surface-elevated rounded p-1.5">
          <p className="uppercase text-secondary-token">{t('equipment.criticality', 'Criticidad')}</p>
          <p
            className={`font-black uppercase ${CRITICALITY_TONE[equipment.criticality]}`}
            data-testid={`equipment-criticality-${equipment.id}`}
          >
            {equipment.criticality}
          </p>
        </div>
        <div className="bg-surface-elevated rounded p-1.5">
          <p className="uppercase text-secondary-token flex items-center gap-1">
            <CalendarClock className="w-3 h-3" aria-hidden="true" />
            {t('equipment.nextMaint', 'Próx. mantención')}
          </p>
          <p className="font-bold tabular-nums text-[11px]">
            {equipment.nextMaintenanceAt
              ? equipment.nextMaintenanceAt.slice(0, 10)
              : t('equipment.notSet', 'sin programar')}
          </p>
        </div>
        <div className="bg-surface-elevated rounded p-1.5 col-span-2">
          <p className="uppercase text-secondary-token">
            {t('equipment.lastInspection', 'Última inspección')}
          </p>
          <p className="font-bold tabular-nums text-[11px]">
            {equipment.lastInspectedAt
              ? equipment.lastInspectedAt.slice(0, 10)
              : t('equipment.never', 'sin registro')}
          </p>
        </div>
      </div>

      {equipment.riskCategories.length > 0 && (
        <div
          className="flex flex-wrap gap-1"
          data-testid={`equipment-risks-${equipment.id}`}
        >
          {equipment.riskCategories.map((r) => (
            <span
              key={r}
              className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-300"
            >
              {r}
            </span>
          ))}
        </div>
      )}

      {equipment.requiresPreUseChecklist && equipment.status === 'operativo' && (
        <div
          className="flex items-start gap-2 bg-amber-500/10 text-amber-700 dark:text-amber-300 p-2 rounded text-[11px]"
          data-testid={`equipment-preuse-required-${equipment.id}`}
        >
          <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
          <span className="flex-1">
            {t('equipment.preUseRequired', 'Checklist pre-uso requerido antes de operar.')}
          </span>
          {onStartPreUse && (
            <button
              type="button"
              onClick={onStartPreUse}
              data-testid={`equipment-preuse-btn-${equipment.id}`}
              className="px-2 py-0.5 rounded bg-amber-500 text-white text-[10px] font-bold"
            >
              {t('equipment.startPreUse', 'Iniciar')}
            </button>
          )}
        </div>
      )}

      {onScanQr && (
        <button
          type="button"
          onClick={onScanQr}
          data-testid={`equipment-scan-${equipment.id}`}
          className="w-full flex items-center justify-center gap-1 px-3 py-1.5 rounded-md bg-sky-500 text-white text-xs font-bold hover:bg-sky-600"
        >
          <ScanQrCode className="w-3 h-3" aria-hidden="true" />
          {t('equipment.scanQr', 'Escanear QR')}
        </button>
      )}
    </section>
  );
}
