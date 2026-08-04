// Praeventio Guard — modal de divulgación prominente de ubicación.
//
// Requisito Play Console (permisos sensibles): la app DEBE mostrar una
// divulgación prominente ANTES de solicitar el permiso de ubicación,
// indicando que recolecta ubicación incluso con la app cerrada o sin uso.
// Este modal se renderiza antes de que cualquier requestPermissions() del
// sistema operativo pueda dispararse.

import React from 'react';
import { MapPin, Check, X } from 'lucide-react';
import { LOCATION_DISCLOSURE_MESSAGE } from '../../services/location/locationPermissionRequest';

export interface LocationDisclosureModalProps {
  open: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}

export function LocationDisclosureModal({
  open,
  onAccept,
  onDismiss,
}: LocationDisclosureModalProps) {
  if (!open) return null;

  return (
    <div
      data-testid="location-disclosure-modal"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="location-disclosure-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-teal-700/30 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="mt-1 rounded-full bg-teal-600/20 p-2">
            <MapPin className="text-teal-400" size={22} />
          </div>
          <div>
            <h2
              id="location-disclosure-title"
              className="text-lg font-bold text-slate-100"
            >
              Tu ubicación protege tu vida
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              {LOCATION_DISCLOSURE_MESSAGE}
            </p>
            <p className="mt-3 text-xs leading-relaxed text-slate-400">
              Solo usamos tu ubicación para funciones de seguridad. Nunca se
              vende ni se comparte con terceros.
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            onClick={onAccept}
            data-testid="location-disclosure-accept"
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-2.5 font-semibold text-white hover:bg-teal-500"
          >
            <Check size={16} /> Entiendo y autorizo
          </button>
          <button
            type="button"
            onClick={onDismiss}
            data-testid="location-disclosure-dismiss"
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-slate-300 hover:bg-slate-700"
          >
            <X size={16} /> Ahora no
          </button>
        </div>
      </div>
    </div>
  );
}
