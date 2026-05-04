// SPDX-License-Identifier: MIT
//
// ARObjectOverlay — Sprint 21 Ola 3 Bucket J.5.
//
// Placeholder funcional para la futura sesión WebXR (immersive-ar) que
// aterrizará en Ola 4. Por ahora cumple un contrato mínimo:
//
//   1. Detectar capability WebXR en el dispositivo.
//   2. Si NO hay capability → mostrar mensaje "AR no disponible".
//   3. Si HAY capability → mostrar mensaje "Próximamente (Ola 4)" con
//      el kind del objeto seleccionado.
//
// La sesión WebXR real (request, hit-test, anclaje del PlacedObject sobre
// el mundo físico) llega en Bucket M de Ola 4. Este componente sirve hoy
// como bridge para wirear el botón "Ver en AR" desde PlacedObjectsLayer
// y verificar que el flujo end-to-end (selección → AR overlay → cerrar)
// queda conectado.

import React from 'react';
import { X, Smartphone, AlertTriangle } from 'lucide-react';
import type { PlacedObject } from '../../services/digitalTwin/photogrammetry/types';
import { HUMAN_KIND_LABEL } from './PlacedObjectsLayer';

export interface ARObjectOverlayProps {
  object: PlacedObject;
  onClose: () => void;
}

/** Detecta si el navegador expone WebXR (no implica permiso, solo API). */
function detectWebXrCapability(): boolean {
  if (typeof navigator === 'undefined') return false;
  return 'xr' in navigator && Boolean((navigator as Navigator & { xr?: unknown }).xr);
}

export function ARObjectOverlay({ object, onClose }: ARObjectOverlayProps) {
  const arCapable = detectWebXrCapability();
  const humanLabel = HUMAN_KIND_LABEL[object.kind] ?? object.kind;

  return (
    <div
      className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-50"
      role="dialog"
      aria-modal="true"
      aria-label="Vista AR del objeto"
    >
      <div className="bg-zinc-900 border border-white/10 rounded-2xl p-6 max-w-md w-[90%] relative">
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar vista AR"
          className="absolute top-3 right-3 p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>

        {!arCapable ? (
          <div className="text-center py-4">
            <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-amber-400" aria-hidden="true" />
            </div>
            <p className="text-sm font-black text-white uppercase tracking-wider mb-2">
              AR no disponible
            </p>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Tu dispositivo no expone la API WebXR. Para ver objetos en
              realidad aumentada, abre Praeventio en un teléfono compatible
              con ARCore (Android) o ARKit (iOS).
            </p>
          </div>
        ) : (
          <div className="text-center py-4">
            <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center">
              <Smartphone className="w-6 h-6 text-cyan-400" aria-hidden="true" />
            </div>
            <p className="text-sm font-black text-white uppercase tracking-wider mb-2">
              {humanLabel}
            </p>
            <p className="text-[10px] font-mono text-zinc-500 mb-3">{object.id}</p>
            <p className="text-xs text-zinc-300 leading-relaxed mb-3">
              Próximamente: vista AR inmersiva (Ola 4). Apuntarás la cámara
              y verás el objeto anclado al mundo real con sus alertas de
              mantención superpuestas.
            </p>
            <p className="text-[10px] text-zinc-500">
              Estado actual: <span className="text-cyan-300">{object.lifecycle}</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
