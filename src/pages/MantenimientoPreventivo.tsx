// Praeventio Guard — Mantenimiento Preventivo (horómetro) page.
//
// Monta el componente huérfano MaintenanceTaskList sobre su backend REAL:
// el usuario elige un equipo del proyecto (useEquipment → GET
// /api/sprint-k/:projectId/equipment) y la lista trae sus tareas de
// mantención preventiva (listMaintenanceTasks → GET
// /horometro/equipment/:eqId/maintenance-tasks). Las tareas las genera el
// flujo ZK del horómetro server-side cuando una lectura cruza un umbral de
// horas — datos reales, sin Math.random ni fabricación.
//
// DIRECTIVA: vista informativa, NO bloqueante — muestra qué mantención toca;
// la decisión es del equipo. El registro de lectura del horómetro
// (<HorometroEntryForm />) también vive acá: al seleccionar un equipo el
// usuario puede abrir el formulario y reportar las horas actuales, lo que
// dispara el flujo ZK server-side (lectura → umbral → tarea preventiva) que
// alimenta esta misma lista. (El mismo formulario se usa tras escanear el QR
// del equipo en el flujo móvil full-screen.)

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Wrench, WifiOff, Gauge } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useEquipment } from '../hooks/useEquipment';
import { MaintenanceTaskList } from '../components/horometro/MaintenanceTaskList';
import { HorometroEntryForm } from '../components/horometro/HorometroEntryForm';

export function MantenimientoPreventivo() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();
  const projectId = selectedProject?.id ?? null;

  const { data: equipmentData, refetch } = useEquipment(projectId);
  const equipment = equipmentData?.equipment ?? [];
  const [selectedEquipmentId, setSelectedEquipmentId] = useState<string>('');
  const [reading, setReading] = useState(false);

  const selectedEquipment = equipment.find((eq) => eq.id === selectedEquipmentId) ?? null;

  if (!selectedProject || !projectId) {
    return (
      <div
        className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto"
        data-testid="mantenimiento-preventivo-page-empty"
      >
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <Wrench className="w-12 h-12 mx-auto mb-4 text-secondary-token" aria-hidden="true" />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('maintenance.page.title', 'Mantenimiento Preventivo')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t(
              'maintenance.page.selectProject',
              'Selecciona un proyecto para ver el mantenimiento de sus equipos.',
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto space-y-4"
      data-testid="mantenimiento-preventivo-page"
    >
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-teal-500/10 text-teal-500 flex items-center justify-center border border-teal-500/20">
          <Wrench className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('maintenance.page.title', 'Mantenimiento Preventivo')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t(
              'maintenance.page.subtitle',
              'Tareas de mantención por equipo, gatilladas por umbrales de horómetro. Es una guía — la decisión es del equipo.',
            )}
          </p>
        </div>
        {!isOnline && (
          <span
            className="ml-auto flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400"
            data-testid="maintenance-offline-chip"
          >
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
      </header>

      <section className="rounded-2xl border border-default-token bg-surface p-4">
        <label
          htmlFor="maintenance-equipment"
          className="text-[10px] font-bold uppercase tracking-widest text-secondary-token"
        >
          {t('maintenance.page.equipmentLabel', 'Equipo')}
        </label>
        <select
          id="maintenance-equipment"
          value={selectedEquipmentId}
          onChange={(e) => {
            setSelectedEquipmentId(e.target.value);
            setReading(false);
          }}
          data-testid="maintenance-equipment-select"
          className="mt-1 w-full bg-surface border border-default-token rounded-xl px-3 py-2 text-sm text-primary-token outline-none focus:border-teal-500"
        >
          <option value="">
            {t('maintenance.page.selectEquipment', '— Selecciona un equipo —')}
          </option>
          {equipment.map((eq) => (
            <option key={eq.id} value={eq.id}>
              {eq.code} · {eq.type}
            </option>
          ))}
        </select>
        {equipment.length === 0 && (
          <p className="mt-2 text-xs text-secondary-token" data-testid="maintenance-no-equipment">
            {t('maintenance.page.noEquipment', 'No hay equipos registrados en este proyecto.')}
          </p>
        )}
      </section>

      {selectedEquipment ? (
        <>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setReading(true)}
              data-testid="maintenance-open-reading"
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-500 text-zinc-950 text-xs font-bold uppercase tracking-widest hover:bg-teal-400 transition-colors"
            >
              <Gauge className="w-4 h-4" aria-hidden="true" />
              {t('maintenance.page.registerReading', 'Registrar lectura de horómetro')}
            </button>
          </div>
          <MaintenanceTaskList projectId={projectId} equipmentId={selectedEquipment.id} />
        </>
      ) : (
        <div
          className="rounded-2xl border border-default-token bg-surface p-8 text-center text-sm text-secondary-token"
          data-testid="maintenance-select-prompt"
        >
          {t('maintenance.page.selectPrompt', 'Selecciona un equipo para ver sus tareas de mantención.')}
        </div>
      )}

      {reading && selectedEquipment && (
        <div
          className="fixed inset-0 z-50 bg-zinc-950 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          data-testid="maintenance-reading-overlay"
        >
          <HorometroEntryForm
            projectId={projectId}
            equipment={selectedEquipment}
            onSubmitted={() => {
              // The reading may have crossed a maintenance threshold and created
              // tasks; refetch equipment so any status change (e.g. nextMaintenanceAt)
              // is reflected when the operator closes the overlay.
              refetch();
            }}
            onCancel={() => setReading(false)}
          />
        </div>
      )}
    </div>
  );
}

export default MantenimientoPreventivo;
