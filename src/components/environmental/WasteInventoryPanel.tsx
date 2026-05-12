// Praeventio Guard — Wire UI #21: <WasteInventoryPanel />
//
// Panel ambiental: inventario de residuos por tipo, manifest pendiente
// de recepción, permisos próximos a vencer.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Recycle, AlertTriangle, FileCheck } from 'lucide-react';
import {
  buildWasteInventoryReport,
  detectPermitExpirations,
  type WasteRecord,
  type WasteManifest,
  type EnvironmentalPermit,
} from '../../services/environmental/environmentalCompliance.js';

interface WasteInventoryPanelProps {
  wastes: WasteRecord[];
  pendingManifests: WasteManifest[];
  permits: EnvironmentalPermit[];
}

const KIND_LABEL = {
  hazardous: 'Peligrosos',
  non_hazardous: 'No peligrosos',
  recyclable: 'Reciclables',
  organic: 'Orgánicos',
  electronic: 'Electrónicos',
};

export function WasteInventoryPanel({
  wastes,
  pendingManifests,
  permits,
}: WasteInventoryPanelProps) {
  const { t } = useTranslation();
  const inventory = useMemo(() => buildWasteInventoryReport(wastes), [wastes]);
  const expiringPermits = useMemo(() => detectPermitExpirations(permits, 90), [permits]);

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-4"
      data-testid="waste-inventory-panel"
      aria-label={t('waste.aria', 'Panel ambiental') as string}
    >
      <header className="flex items-center gap-2">
        <Recycle className="w-4 h-4 text-emerald-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('waste.title', 'Gestión Ambiental')}
        </h2>
      </header>

      {/* Inventario por tipo */}
      <div>
        <h3 className="text-xs font-bold uppercase text-secondary-token mb-2">
          {t('waste.inventory', 'Inventario')} ({inventory.totalQuantityKg} kg)
        </h3>
        <ul className="grid grid-cols-2 gap-2">
          {(Object.keys(inventory.byKind) as Array<keyof typeof inventory.byKind>).map((kind) => {
            const data = inventory.byKind[kind];
            if (data.count === 0) return null;
            return (
              <li
                key={kind}
                data-testid={`waste-kind-${kind}`}
                className="rounded-lg border border-default-token bg-surface-elevated p-2"
              >
                <p className="text-[10px] uppercase text-secondary-token">{KIND_LABEL[kind]}</p>
                <p className="text-sm font-bold text-primary-token tabular-nums">
                  {data.count} · {data.totalKg} kg
                </p>
              </li>
            );
          })}
        </ul>
        <p className="text-[10px] text-secondary-token mt-2">
          {inventory.inStock} {t('waste.inStock', 'en bodega')} · {inventory.dispatched}{' '}
          {t('waste.dispatched', 'despachados')}
        </p>
      </div>

      {/* Manifests pendientes */}
      {pendingManifests.length > 0 && (
        <div data-testid="waste-pending-manifests">
          <h3 className="text-xs font-bold uppercase text-amber-700 dark:text-amber-300 mb-2 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" aria-hidden="true" />
            {t('waste.pendingReception', 'Pendientes de recepción')} ({pendingManifests.length})
          </h3>
          <ul className="space-y-1 text-xs">
            {pendingManifests.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between p-2 rounded bg-amber-500/10"
              >
                <span className="font-mono text-[10px]">{m.id}</span>
                <span className="text-[10px]">
                  {t('waste.dispatchedOn', 'Despachado:')} {m.dispatchedAt.slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Permisos por vencer */}
      {expiringPermits.length > 0 && (
        <div data-testid="waste-expiring-permits">
          <h3 className="text-xs font-bold uppercase text-rose-700 dark:text-rose-300 mb-2 flex items-center gap-1">
            <FileCheck className="w-3 h-3" aria-hidden="true" />
            {t('waste.expiringPermits', 'Permisos por vencer')} ({expiringPermits.length})
          </h3>
          <ul className="space-y-1 text-xs">
            {expiringPermits.map((p) => (
              <li
                key={p.id}
                data-testid={`waste-permit-${p.id}`}
                className="flex items-center justify-between p-2 rounded bg-rose-500/10"
              >
                <span className="font-bold">{p.kind}</span>
                <span className="text-[10px] tabular-nums">
                  {p.daysUntilExpiration < 0
                    ? t('waste.permitOverdue', `Vencido hace ${Math.abs(p.daysUntilExpiration)}d`)
                    : t('waste.permitExpiresIn', `Vence en ${p.daysUntilExpiration}d`)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
