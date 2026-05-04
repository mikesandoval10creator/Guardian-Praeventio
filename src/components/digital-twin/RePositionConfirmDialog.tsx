// SPDX-License-Identifier: MIT
//
// RePositionConfirmDialog — Sprint 21 Ola 4 Bucket N.3.
//
// Modal que vive DENTRO del DOM overlay de la sesión WebXR (cuando el
// `XRSession` declara `dom-overlay` con root apuntando al contenedor del
// overlay). Aparece cuando el usuario, dentro de la sesión AR, confirma
// una nueva posición candidata para un objeto ya `installed`.
//
// Muestra:
//   - Delta humano (ej. "Movido 1.2 m al norte / 0.3 m hacia abajo")
//   - Coordenadas mesh antes/después
//   - Si hay geoAnchor: nuevo lat/lng (y altitud delta)
//   - Botones: confirmar / cancelar
//
// El flujo de commit (Firestore + lifecycle + ZK node) NO ocurre aquí —
// este componente solo renderiza la decisión y propaga el callback. La
// orquestación está en `useArPlacement.confirmPlacement`.

import React from 'react';
import { Check, X, MapPin, Move3D } from 'lucide-react';

export interface RePositionConfirmDialogProps {
  /** Posición original (mesh coords). */
  previousPosition: { x: number; y: number; z: number };
  /** Posición candidata desde AR (mesh coords). */
  newPosition: { x: number; y: number; z: number };
  /** Geo previo (si el mesh tiene anchor). */
  previousGeo?: { lat: number; lng: number; altitudeM?: number } | null;
  /** Geo nuevo (calculado por meshToGeo). */
  newGeo?: { lat: number; lng: number; altitudeM?: number } | null;
  /** Confirma la nueva posición — el caller dispara `confirmPlacement`. */
  onConfirm: () => void;
  /** Cancela el reposicionamiento — vuelve al estado original. */
  onCancel: () => void;
  /** Etiqueta humana del objeto, p.ej. "Extintor PQS". */
  objectLabel?: string;
}

/** Convierte el delta mesh → texto humano (norte/sur, este/oeste, altitud). */
function humanizeDelta(d: { x: number; y: number; z: number }): string[] {
  const parts: string[] = [];
  // Convención: x → este, z → norte, y → arriba (ver useGeoAnchor).
  if (Math.abs(d.z) >= 0.1) {
    parts.push(`${d.z.toFixed(2)} m hacia el ${d.z > 0 ? 'norte' : 'sur'}`);
  }
  if (Math.abs(d.x) >= 0.1) {
    parts.push(`${d.x.toFixed(2)} m hacia el ${d.x > 0 ? 'este' : 'oeste'}`);
  }
  if (Math.abs(d.y) >= 0.1) {
    parts.push(`${d.y.toFixed(2)} m hacia ${d.y > 0 ? 'arriba' : 'abajo'}`);
  }
  if (parts.length === 0) parts.push('< 10 cm');
  return parts;
}

function formatCoord(c: { x: number; y: number; z: number }): string {
  return `(${c.x.toFixed(2)}, ${c.y.toFixed(2)}, ${c.z.toFixed(2)})`;
}

export function RePositionConfirmDialog({
  previousPosition,
  newPosition,
  previousGeo,
  newGeo,
  onConfirm,
  onCancel,
  objectLabel,
}: RePositionConfirmDialogProps) {
  const delta = {
    x: newPosition.x - previousPosition.x,
    y: newPosition.y - previousPosition.y,
    z: newPosition.z - previousPosition.z,
  };
  const deltaParts = humanizeDelta(delta);
  const distance = Math.sqrt(delta.x * delta.x + delta.y * delta.y + delta.z * delta.z);
  const showGeo = Boolean(newGeo);

  return (
    <div
      className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-[60] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ar-reposition-title"
    >
      <div className="bg-zinc-900 border border-cyan-500/40 rounded-2xl p-5 max-w-md w-full">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center">
            <Move3D className="w-4 h-4 text-cyan-300" aria-hidden="true" />
          </div>
          <div>
            <p
              id="ar-reposition-title"
              className="text-sm font-black text-white uppercase tracking-wider leading-tight"
            >
              Confirmar reposición
            </p>
            {objectLabel && (
              <p className="text-[10px] text-zinc-400 leading-tight">{objectLabel}</p>
            )}
          </div>
        </div>

        {/* Delta humano */}
        <div className="bg-zinc-950/60 border border-white/5 rounded-lg p-3 mb-3">
          <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-1">
            Delta detectado ({distance.toFixed(2)} m)
          </p>
          <ul className="text-xs text-cyan-200 space-y-0.5">
            {deltaParts.map((p) => (
              <li key={p}>• {p}</li>
            ))}
          </ul>
        </div>

        {/* Coords antes/después */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="bg-zinc-950/60 border border-white/5 rounded-lg p-2">
            <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-1">
              Antes
            </p>
            <p className="text-[10px] font-mono text-zinc-300">
              {formatCoord(previousPosition)}
            </p>
            {previousGeo && (
              <p className="text-[9px] font-mono text-zinc-500 mt-1">
                {previousGeo.lat.toFixed(6)}, {previousGeo.lng.toFixed(6)}
              </p>
            )}
          </div>
          <div className="bg-zinc-950/60 border border-cyan-500/30 rounded-lg p-2">
            <p className="text-[9px] font-black text-cyan-400 uppercase tracking-widest mb-1">
              Después
            </p>
            <p className="text-[10px] font-mono text-cyan-200">
              {formatCoord(newPosition)}
            </p>
            {newGeo && (
              <p className="text-[9px] font-mono text-cyan-300 mt-1">
                {newGeo.lat.toFixed(6)}, {newGeo.lng.toFixed(6)}
              </p>
            )}
          </div>
        </div>

        {showGeo && newGeo && (
          <div className="flex items-center gap-1.5 mb-3 text-[10px] text-zinc-400">
            <MapPin className="w-3 h-3 text-cyan-400" aria-hidden="true" />
            <span>
              Nuevo geo-anchor:{' '}
              <span className="font-mono text-cyan-200">
                {newGeo.lat.toFixed(6)}, {newGeo.lng.toFixed(6)}
              </span>
              {typeof newGeo.altitudeM === 'number' && (
                <>
                  {' · '}
                  <span className="font-mono text-cyan-200">
                    {newGeo.altitudeM.toFixed(1)} m
                  </span>
                </>
              )}
            </span>
          </div>
        )}

        {/* Acciones */}
        <div className="flex flex-col-reverse sm:flex-row gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2.5 px-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-black uppercase tracking-wider transition-colors border border-white/10 min-h-[44px] flex items-center justify-center gap-1.5"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 py-2.5 px-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-black uppercase tracking-wider transition-colors min-h-[44px] flex items-center justify-center gap-1.5"
          >
            <Check className="w-3.5 h-3.5" aria-hidden="true" />
            Confirmar nueva posición
          </button>
        </div>

        <p className="text-[9px] text-zinc-500 mt-2 text-center leading-relaxed">
          Cancelar mantiene la posición original. Confirmar persiste el cambio
          y registra un nuevo nodo Zettelkasten.
        </p>
      </div>
    </div>
  );
}
