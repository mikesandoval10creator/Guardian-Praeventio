// VehicleDocsTab — "Documentos Vehiculares" surface inside Conducción Segura.
//
// Reads the project's assets of type 'Vehículo' (the existing, rules-governed
// `assets` collection — no new collection) and shows, per vehicle, the legal
// compliance status of its documents:
//   - Revisión técnica  (revisionTecnicaExpiresAt)
//   - Permiso de circulación (permisoCirculacionExpiresAt)
// classified vigente / por vencer (≤30 d) / vencido / sin registrar by the pure
// helper vehicleDocStatus. The operator can edit the two dates + patente; the
// write reuses MaquinariaManager's exact path (online updateDoc, offline
// saveForSync), so it inherits the same security + offline guarantees.
//
// Driver licence expiry is intentionally NOT here — it belongs to the driver
// (Conductores tab), not the vehicle.

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { where } from 'firebase/firestore';
import { Truck, ShieldCheck, CalendarClock, AlertTriangle, Loader2, Pencil, Save, X, WifiOff } from 'lucide-react';
import { useFirestoreCollection } from '../../hooks/useFirestoreCollection';
import { db, doc, updateDoc, handleFirestoreError, OperationType } from '../../services/firebase';
import type { Asset } from '../../types';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { saveForSync } from '../../utils/pwa-offline';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../shared/ToastContainer';
import { vehicleDocStatus, vehicleDocStateLabel, type VehicleDocState } from '../../utils/vehicleDocStatus';

const STATE_STYLE: Record<VehicleDocState, { dot: string; text: string; bg: string }> = {
  vigente: { dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10' },
  por_vencer: { dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10' },
  vencido: { dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400', bg: 'bg-red-500/10' },
  sin_dato: { dot: 'bg-zinc-400', text: 'text-muted-token', bg: 'bg-elevated' },
};

function relativeLabel(daysLeft: number | null): string {
  if (daysLeft === null) return 'Sin fecha registrada';
  if (daysLeft < 0) return `Venció hace ${Math.abs(daysLeft)} día${Math.abs(daysLeft) === 1 ? '' : 's'}`;
  if (daysLeft === 0) return 'Vence hoy';
  return `Vence en ${daysLeft} día${daysLeft === 1 ? '' : 's'}`;
}

function DocStatusRow({ label, expiresAt }: { label: string; expiresAt?: string }) {
  const status = vehicleDocStatus(expiresAt);
  const style = STATE_STYLE[status.state];
  return (
    <div className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2 ${style.bg}`}>
      <div className="flex items-center gap-2 min-w-0">
        <span className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} aria-hidden="true" />
        <span className="text-[11px] font-bold text-secondary-token truncate">{label}</span>
      </div>
      <div className="text-right shrink-0">
        <p className={`text-[11px] font-black uppercase tracking-wide ${style.text}`}>
          {vehicleDocStateLabel(status.state)}
        </p>
        <p className="text-[9px] font-medium text-muted-token">{relativeLabel(status.daysLeft)}</p>
      </div>
    </div>
  );
}

interface EditState {
  plate: string;
  revisionTecnicaExpiresAt: string;
  permisoCirculacionExpiresAt: string;
}

export function VehicleDocsTab({ projectId }: { projectId: string | null }) {
  const isOnline = useOnlineStatus();
  const { toasts, show: showToast, dismiss } = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({ plate: '', revisionTecnicaExpiresAt: '', permisoCirculacionExpiresAt: '' });
  const [saving, setSaving] = useState(false);

  const { data: assets, loading } = useFirestoreCollection<Asset>(
    'assets',
    projectId ? [where('projectId', '==', projectId)] : [],
  );

  const vehicles = useMemo(
    () => assets.filter((a) => a.type === 'Vehículo'),
    [assets],
  );

  // Vehicles with at least one expired document — surfaced first as a banner.
  const expiredCount = useMemo(
    () =>
      vehicles.filter(
        (v) =>
          vehicleDocStatus(v.revisionTecnicaExpiresAt).state === 'vencido' ||
          vehicleDocStatus(v.permisoCirculacionExpiresAt).state === 'vencido',
      ).length,
    [vehicles],
  );

  const startEdit = (v: Asset) => {
    setEditingId(v.id);
    setEditState({
      plate: v.plate ?? '',
      revisionTecnicaExpiresAt: (v.revisionTecnicaExpiresAt ?? '').slice(0, 10),
      permisoCirculacionExpiresAt: (v.permisoCirculacionExpiresAt ?? '').slice(0, 10),
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const saveEdit = async (vehicle: Asset) => {
    setSaving(true);
    try {
      const patch = {
        plate: editState.plate.trim(),
        revisionTecnicaExpiresAt: editState.revisionTecnicaExpiresAt || '',
        permisoCirculacionExpiresAt: editState.permisoCirculacionExpiresAt || '',
      };
      if (!isOnline) {
        await saveForSync({ type: 'update', docId: vehicle.id, collection: 'assets', data: patch });
        showToast('Cambios guardados para sincronizar cuando haya conexión.', 'info');
      } else {
        await updateDoc(doc(db, 'assets', vehicle.id), patch);
        showToast('Documentos del vehículo actualizados.', 'success');
      }
      setEditingId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'assets');
    } finally {
      setSaving(false);
    }
  };

  if (!projectId) {
    return (
      <div className="text-center py-16 bg-surface rounded-[2rem] border border-dashed border-default-token">
        <Truck className="w-12 h-12 text-muted-token mx-auto mb-4" />
        <p className="text-xs font-bold text-muted-token uppercase tracking-widest">Selecciona un proyecto para ver sus vehículos</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
          <ShieldCheck className="w-6 h-6 text-blue-500" />
        </div>
        <div>
          <h3 className="text-base font-black text-primary-token uppercase tracking-tight">Documentos Vehiculares</h3>
          <p className="text-[10px] font-bold text-muted-token uppercase tracking-widest">Revisión técnica · Permiso de circulación</p>
        </div>
      </div>

      {/* Expired banner */}
      {expiredCount > 0 && (
        <div role="alert" className="flex items-center gap-3 rounded-2xl bg-red-500/10 border border-red-500/30 px-4 py-3">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 animate-pulse" />
          <p className="text-xs font-bold text-red-700 dark:text-red-300">
            {expiredCount} vehículo{expiredCount === 1 ? '' : 's'} con documentación vencida. Regularizar antes de circular.
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        </div>
      ) : vehicles.length === 0 ? (
        <div className="text-center py-12 bg-surface rounded-[2rem] border border-dashed border-default-token">
          <Truck className="w-12 h-12 text-muted-token mx-auto mb-4" />
          <p className="text-xs font-bold text-muted-token uppercase tracking-widest mb-1">No hay vehículos registrados</p>
          <p className="text-[11px] text-muted-token">Agrega activos de tipo «Vehículo» en Gestión de Activos.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {vehicles.map((v) => {
            const isEditing = editingId === v.id;
            return (
              <motion.div
                key={v.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-surface border border-default-token rounded-3xl p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
                      <Truck className="w-5 h-5 text-blue-500" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-sm font-black text-primary-token uppercase tracking-tight truncate">{v.name}</h4>
                      <p className="text-[10px] font-bold text-muted-token uppercase tracking-widest">
                        {v.plate ? `Patente ${v.plate}` : 'Sin patente registrada'}
                      </p>
                    </div>
                  </div>
                  {!isEditing && (
                    <button
                      onClick={() => startEdit(v)}
                      className="p-2 rounded-lg text-muted-token hover:text-primary-token hover:bg-elevated transition-colors shrink-0"
                      aria-label={`Editar documentos de ${v.name}`}
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {isEditing ? (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[9px] font-black uppercase tracking-widest text-muted-token mb-1">Patente</label>
                      <input
                        type="text"
                        value={editState.plate}
                        onChange={(e) => setEditState((s) => ({ ...s, plate: e.target.value.toUpperCase() }))}
                        placeholder="Ej: AB·CD·12"
                        className="w-full bg-elevated border border-default-token rounded-xl px-3 py-2 text-sm text-primary-token focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] font-black uppercase tracking-widest text-muted-token mb-1">Revisión técnica — vence</label>
                      <input
                        type="date"
                        value={editState.revisionTecnicaExpiresAt}
                        onChange={(e) => setEditState((s) => ({ ...s, revisionTecnicaExpiresAt: e.target.value }))}
                        className="w-full bg-elevated border border-default-token rounded-xl px-3 py-2 text-sm text-primary-token focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] font-black uppercase tracking-widest text-muted-token mb-1">Permiso de circulación — vence</label>
                      <input
                        type="date"
                        value={editState.permisoCirculacionExpiresAt}
                        onChange={(e) => setEditState((s) => ({ ...s, permisoCirculacionExpiresAt: e.target.value }))}
                        className="w-full bg-elevated border border-default-token rounded-xl px-3 py-2 text-sm text-primary-token focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                      />
                    </div>
                    {!isOnline && (
                      <p className="flex items-center gap-1.5 text-[10px] font-bold text-amber-600 dark:text-amber-400">
                        <WifiOff className="w-3 h-3" /> Sin conexión — se sincronizará al recuperar señal.
                      </p>
                    )}
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => saveEdit(v)}
                        disabled={saving}
                        className="flex-1 flex items-center justify-center gap-2 bg-blue-500 hover:bg-blue-600 text-white py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors disabled:opacity-50"
                      >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Guardar
                      </button>
                      <button
                        onClick={cancelEdit}
                        disabled={saving}
                        className="px-4 flex items-center justify-center gap-2 bg-elevated text-secondary-token py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-default-token/20 transition-colors disabled:opacity-50"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <DocStatusRow label="Revisión técnica" expiresAt={v.revisionTecnicaExpiresAt} />
                    <DocStatusRow label="Permiso de circulación" expiresAt={v.permisoCirculacionExpiresAt} />
                    {v.nextMaintenance && (
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-token pt-1">
                        <CalendarClock className="w-3 h-3" />
                        Próx. mantenimiento: {new Date(v.nextMaintenance).toLocaleDateString('es-CL')}
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
