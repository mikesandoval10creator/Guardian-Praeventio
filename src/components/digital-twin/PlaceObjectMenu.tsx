// SPDX-License-Identifier: MIT
//
// PlaceObjectMenu — sidebar HTML panel listing the 17 PlacedObjectKind
// items as HTML5-draggable chips. The consumer (`DigitalTwinFaena`) listens
// for `dragover`/`drop` on the `<Canvas>` wrapper and creates a new
// `PlacedObject` with `lifecycle: 'planning'` at the dropped position.

import React from 'react';
import type { PlacedObjectKind } from '../../services/digitalTwin/photogrammetry/types';
import { HUMAN_KIND_LABEL } from './PlacedObjectsLayer';

const KIND_ORDER: PlacedObjectKind[] = [
  'extinguisher_pqs',
  'extinguisher_co2',
  'extinguisher_water',
  'hydrant',
  'aed',
  'first_aid_kit',
  'emergency_shower',
  'eye_wash_station',
  'gas_detector',
  'spill_kit',
  'safety_shower',
  'sign_evacuation',
  'sign_warning',
  'sign_mandatory',
  'sign_prohibition',
  'assembly_point',
  'evacuation_route',
];

const KIND_EMOJI: Record<PlacedObjectKind, string> = {
  extinguisher_pqs: 'PQS',
  extinguisher_co2: 'CO2',
  extinguisher_water: 'H2O',
  hydrant: 'HID',
  aed: 'AED',
  first_aid_kit: 'BTQ',
  emergency_shower: 'DUC',
  eye_wash_station: 'LAV',
  gas_detector: 'GAS',
  spill_kit: 'KAD',
  safety_shower: 'SEG',
  sign_evacuation: 'EVC',
  sign_warning: 'ADV',
  sign_mandatory: 'OBL',
  sign_prohibition: 'PRH',
  assembly_point: 'ENC',
  evacuation_route: 'VIA',
};

export const DRAG_MIME = 'application/x-praeventio-placed-kind';

export interface PlaceObjectMenuProps {
  onPickKind?: (kind: PlacedObjectKind) => void;
}

export function PlaceObjectMenu({ onPickKind }: PlaceObjectMenuProps) {
  return (
    <div className="bg-zinc-900/60 border border-white/5 rounded-2xl p-3">
      <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-3">
        Colocar objeto
      </p>
      <p className="text-[9px] text-zinc-500 leading-relaxed mb-3">
        Arrastrá un ítem al visor 3D para colocarlo en estado planning. Después
        marcalo como instalado para crear el nodo Zettelkasten + agendar
        mantenimiento.
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        {KIND_ORDER.map((kind) => (
          <button
            key={kind}
            type="button"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_MIME, kind);
              e.dataTransfer.setData('text/plain', kind);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            onClick={() => onPickKind?.(kind)}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-zinc-800/40 border border-white/5 hover:bg-zinc-700/60 hover:border-cyan-500/40 transition-colors text-left cursor-grab active:cursor-grabbing"
            aria-label={`Colocar ${HUMAN_KIND_LABEL[kind]}`}
          >
            <span className="text-[8px] font-mono font-black text-cyan-300 tracking-wider shrink-0">
              {KIND_EMOJI[kind]}
            </span>
            <span className="text-[10px] font-bold text-zinc-200 truncate">
              {HUMAN_KIND_LABEL[kind]}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
