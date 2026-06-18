// Praeventio Guard — Checklist Pre-Uso de Vehículo (internal transit).
//
// Hosts the controlled VehiclePreOpChecklistCard: the page owns the vehicle
// kind + the per-item responses; the card renders the checklist and computes
// pass/block in-place via the REAL validatePreOpChecklist engine. No fetch /
// aggregation — pure client state + pure engine. GUIDANCE: a "no apto" verdict
// recommends not operating; the tool stops nothing — the operator/supervisor
// decides. Mounts the previously-orphan VehiclePreOpChecklistCard.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Truck } from 'lucide-react';
import { VehiclePreOpChecklistCard } from '../components/internalTransit/VehiclePreOpChecklistCard';
import type { VehicleKind, PreOpResponse } from '../services/internalTransit/internalTransitService';

const VEHICLE_LABELS: Record<VehicleKind, string> = {
  camion_grande: 'Camión grande (>7,5 t)',
  camioneta: 'Camioneta',
  cargador_frontal: 'Cargador frontal',
  grua_movil: 'Grúa móvil',
  minibus_personal: 'Minibús personal',
  bus_personal: 'Bus personal',
};
const KINDS = Object.keys(VEHICLE_LABELS) as VehicleKind[];

export function ChecklistVehiculo() {
  const { t } = useTranslation();
  const [vehicleKind, setVehicleKind] = useState<VehicleKind>('camioneta');
  const [responses, setResponses] = useState<PreOpResponse[]>([]);

  const onChangeResponse = (resp: PreOpResponse) =>
    setResponses((prev) => [...prev.filter((r) => r.itemId !== resp.itemId), resp]);

  // Switching vehicle invalidates the previous checklist's answers.
  const onKindChange = (k: VehicleKind) => {
    setVehicleKind(k);
    setResponses([]);
  };

  // Stable key so the controlled card resets cleanly per vehicle kind.
  const cardKey = useMemo(() => `preop-${vehicleKind}`, [vehicleKind]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-6">
      <header className="flex items-center gap-3">
        <div className="p-3 rounded-2xl bg-sky-500/10 border border-sky-500/20 shrink-0">
          <Truck className="w-6 h-6 text-sky-500" />
        </div>
        <div>
          <h1 className="text-2xl font-black uppercase tracking-tighter text-primary-token leading-tight">
            {t('checklistVehiculo.title', 'Checklist Pre-Uso de Vehículo')}
          </h1>
          <p className="text-xs sm:text-sm text-secondary-token font-medium mt-1">
            {t(
              'checklistVehiculo.subtitle',
              'Verificación previa al uso de vehículos y maquinaria móvil. Es una guía — recomienda, no detiene la operación.',
            )}
          </p>
        </div>
      </header>

      <div>
        <label className="text-[10px] font-bold uppercase tracking-widest text-secondary-token">
          {t('checklistVehiculo.kind', 'Tipo de vehículo')}
        </label>
        <select
          value={vehicleKind}
          onChange={(e) => onKindChange(e.target.value as VehicleKind)}
          className="mt-1 w-full bg-surface border border-default-token rounded-xl px-3 py-2 text-sm text-primary-token outline-none focus:border-sky-500"
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {VEHICLE_LABELS[k]}
            </option>
          ))}
        </select>
      </div>

      <VehiclePreOpChecklistCard
        key={cardKey}
        vehicleKind={vehicleKind}
        responses={responses}
        onChangeResponse={onChangeResponse}
      />
    </div>
  );
}
