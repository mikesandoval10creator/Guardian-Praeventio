// SPDX-License-Identifier: MIT
//
// ARObjectOverlay — Sprint 21 Ola 4 Bucket L.4 (completado).
//
// Punto de entrada para visualizar un PlacedObject en realidad aumentada.
// Tiene 3 estados:
//
//   1. Loading — useWebXRSupport está detectando capabilities.
//   2. WebXR immersive-ar disponible:
//      - Muestra preview HTML con kind + lifecycle + botón "Iniciar AR".
//      - Al click, monta XRSession con un mesh primitivo del objeto
//        (color/forma según kind) que sigue el reticle de hit-test.
//      - Usuario tap-to-place → callback onConfirm({x,y,z}).
//      - Después del tap, sale de la sesión y muestra confirmación.
//   3. WebXR no disponible (iOS Safari, navegadores antiguos):
//      - Mensaje "AR no disponible" con CTA opcional para AR Quick Look
//        (Bucket M cubre la rama .usdz). Por ahora solo el mensaje.
//
// El placeholder de Ola 3 queda absorbido en el path "no disponible".

import React, { useMemo, useState } from 'react';
import { X, Smartphone, AlertTriangle, Camera, CheckCircle2, Loader2 } from 'lucide-react';
import * as THREE from 'three';
import type { PlacedObject, PlacedObjectKind } from '../../services/digitalTwin/photogrammetry/types';
import { HUMAN_KIND_LABEL } from './PlacedObjectsLayer';
import { useWebXRSupport } from '../../hooks/useWebXRSupport';
import { XRSession, type XRSessionAnchorPose } from '../ar/XRSession';
import {
  ArQuickLookButton,
  isArQuickLookSupported,
} from '../ar/ArQuickLookButton';

/** Mismo mapping de colores que PlacedObjectsLayer pero local para no
 *  importar un objeto privado. Coincidir es importante para coherencia
 *  visual entre el twin 3D y la sesión AR. */
const KIND_COLOR: Record<PlacedObjectKind, string> = {
  extinguisher_pqs: '#dc2626',
  extinguisher_co2: '#1f1f1f',
  extinguisher_water: '#2563eb',
  hydrant: '#f59e0b',
  sign_evacuation: '#10b981',
  sign_warning: '#f59e0b',
  sign_mandatory: '#2563eb',
  sign_prohibition: '#dc2626',
  aed: '#16a34a',
  first_aid_kit: '#dc2626',
  emergency_shower: '#06b6d4',
  eye_wash_station: '#06b6d4',
  gas_detector: '#a855f7',
  spill_kit: '#facc15',
  safety_shower: '#06b6d4',
  assembly_point: '#10b981',
  evacuation_route: '#10b981',
};

/**
 * Genera un mesh primitivo proxy del PlacedObject. En Bucket M aterrizará
 * carga real de GLB desde /public/models/{kind}.glb (con fallback a este
 * primitivo si el GLB falla o no existe). Por ahora solo primitivos.
 */
function buildPreviewMesh(kind: PlacedObjectKind): THREE.Object3D {
  const group = new THREE.Group();
  const color = new THREE.Color(KIND_COLOR[kind] ?? '#888888');
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2 });

  // Forma específica por categoría — proxy "good enough" hasta que entren
  // los GLB reales del Bucket M.
  if (kind.startsWith('extinguisher')) {
    // Cilindro vertical estilo extintor.
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.09, 0.5, 24),
      material,
    );
    body.position.y = 0.25;
    group.add(body);
  } else if (kind.startsWith('sign_')) {
    // Plano con borde — señalética.
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 0.3),
      new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide }),
    );
    plane.position.y = 0.4;
    group.add(plane);
  } else if (kind === 'hydrant') {
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.1, 0.6, 16),
      material,
    );
    stem.position.y = 0.3;
    group.add(stem);
  } else if (kind === 'aed') {
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, 0.12), material);
    box.position.y = 0.2;
    group.add(box);
  } else {
    // Default: caja pequeña.
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), material);
    box.position.y = 0.1;
    group.add(box);
  }
  return group;
}

export interface ARObjectOverlayProps {
  object: PlacedObject;
  onClose: () => void;
  /** Llamado cuando el usuario confirma posición vía tap-to-place. */
  onConfirm?: (pose: XRSessionAnchorPose) => void;
}

type Phase = 'preview' | 'session' | 'confirmed';

export function ARObjectOverlay({ object, onClose, onConfirm }: ARObjectOverlayProps) {
  const xrSupport = useWebXRSupport();
  const humanLabel = HUMAN_KIND_LABEL[object.kind] ?? object.kind;
  const [phase, setPhase] = useState<Phase>('preview');
  const [confirmedPose, setConfirmedPose] = useState<XRSessionAnchorPose | null>(null);

  // Bucket M.4 — branch iOS AR Quick Look. Detección sincrónica via
  // `relList.supports('ar')`. Solo aplica cuando WebXR NO es la opción
  // (iOS Safari NO expone WebXR). El path al .usdz se deriva del kind;
  // si el archivo no existe en producción, iOS muestra error de descarga
  // (ver docs/ar-assets.md "¿Qué pasa si el .usdz no existe?").
  const usdzPath = `/models/ar/${object.kind}.usdz`;
  const arQuickLookSupported = !xrSupport.loading && !xrSupport.immersiveAr && isArQuickLookSupported();

  // Preview mesh recreado solo si el kind cambia. Three.js objects son
  // mutables — no queremos generarlos en cada render.
  const previewMesh = useMemo(() => buildPreviewMesh(object.kind), [object.kind]);

  // PRE-DETECTION SPINNER: feedback breve mientras useWebXRSupport corre.
  if (xrSupport.loading) {
    return (
      <div
        className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-50"
        role="dialog"
        aria-modal="true"
        aria-label="Cargando AR"
      >
        <div className="bg-zinc-900 border border-white/10 rounded-2xl p-6 max-w-md w-[90%]">
          <div className="text-center py-4">
            <Loader2 className="w-6 h-6 text-cyan-400 animate-spin mx-auto mb-3" aria-hidden="true" />
            <p className="text-sm text-zinc-300">Detectando soporte AR...</p>
          </div>
        </div>
      </div>
    );
  }

  // SESSION ACTIVE: el XRSession overlay toma toda la pantalla.
  if (phase === 'session' && xrSupport.immersiveAr) {
    return (
      <XRSession
        previewMesh={previewMesh}
        reticleColor={KIND_COLOR[object.kind] ?? '#f59e0b'}
        onSessionEnd={() => setPhase('preview')}
        onSelectAnchor={(pose) => {
          setConfirmedPose(pose);
          setPhase('confirmed');
          onConfirm?.(pose);
        }}
        domOverlayContent={
          <div className="pointer-events-auto absolute bottom-6 left-4 right-4 mx-auto max-w-md bg-zinc-900/85 border border-white/15 rounded-2xl p-4 backdrop-blur">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-black text-white uppercase tracking-wider">{humanLabel}</p>
              <span className="text-[10px] font-mono text-cyan-300 uppercase">{object.lifecycle}</span>
            </div>
            <p className="text-xs text-zinc-300 leading-relaxed mb-3">
              Apunta la cámara a una superficie plana. Cuando aparezca el círculo,
              tócalo para anclar el objeto.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="w-full px-3 py-2 bg-rose-700/80 hover:bg-rose-600 text-white text-xs font-bold rounded-lg uppercase tracking-wider min-h-[44px]"
            >
              Cerrar AR
            </button>
          </div>
        }
      />
    );
  }

  // CONFIRMED: post-tap success card.
  if (phase === 'confirmed' && confirmedPose) {
    return (
      <div
        className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-50"
        role="dialog"
        aria-modal="true"
        aria-label="Posición AR confirmada"
      >
        <div className="bg-zinc-900 border border-emerald-500/30 rounded-2xl p-6 max-w-md w-[90%] relative">
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="absolute top-3 right-3 p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
          <div className="text-center py-4">
            <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6 text-emerald-400" aria-hidden="true" />
            </div>
            <p className="text-sm font-black text-white uppercase tracking-wider mb-2">
              Posición confirmada
            </p>
            <p className="text-xs text-zinc-400 leading-relaxed mb-3">
              {humanLabel} anclado en
              {' '}
              <span className="text-emerald-300 font-mono">
                ({confirmedPose.x.toFixed(2)}, {confirmedPose.y.toFixed(2)}, {confirmedPose.z.toFixed(2)})
              </span>
              {' '}m del origen local.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold uppercase tracking-wider min-h-[44px]"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    );
  }

  // PREVIEW: card por defecto antes de iniciar la sesión inmersiva.
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

        {!xrSupport.immersiveAr ? (
          arQuickLookSupported ? (
            // iOS branch — AR Quick Look (Bucket M.4).
            <div className="text-center py-4">
              <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center">
                <Smartphone className="w-6 h-6 text-cyan-400" aria-hidden="true" />
              </div>
              <p className="text-sm font-black text-white uppercase tracking-wider mb-2">
                {humanLabel}
              </p>
              <p className="text-[10px] font-mono text-zinc-500 mb-3">{object.id}</p>
              <p className="text-xs text-zinc-300 leading-relaxed mb-4">
                Tu dispositivo soporta AR Quick Look. Toca el botón para abrir el
                objeto en realidad aumentada nativa de iOS.
              </p>
              <ArQuickLookButton
                modelPath={usdzPath}
                label="Ver en AR (Quick Look)"
              />
              <p className="text-[10px] text-zinc-500 mt-3">
                Estado: <span className="text-cyan-300">{object.lifecycle}</span>
              </p>
            </div>
          ) : (
            <div className="text-center py-4">
              <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-amber-400" aria-hidden="true" />
              </div>
              <p className="text-sm font-black text-white uppercase tracking-wider mb-2">
                AR inmersivo no disponible
              </p>
              <p className="text-xs text-zinc-400 leading-relaxed">
                {xrSupport.available
                  ? 'Tu navegador expone WebXR pero no soporta sesiones immersive-ar. Prueba en Android Chrome 79+ o Quest Browser.'
                  : 'Tu dispositivo no expone WebXR ni AR Quick Look. Para ver objetos en realidad aumentada, abre Praeventio en un teléfono compatible con ARCore (Android Chrome) o ARKit (iPhone/iPad Safari).'}
              </p>
              <p className="text-[10px] text-zinc-500 mt-3">
                {humanLabel} · <span className="text-cyan-300">{object.lifecycle}</span>
              </p>
            </div>
          )
        ) : (
          <div className="text-center py-4">
            <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center">
              <Smartphone className="w-6 h-6 text-cyan-400" aria-hidden="true" />
            </div>
            <p className="text-sm font-black text-white uppercase tracking-wider mb-2">
              {humanLabel}
            </p>
            <p className="text-[10px] font-mono text-zinc-500 mb-3">{object.id}</p>
            <p className="text-xs text-zinc-300 leading-relaxed mb-4">
              Tu dispositivo soporta WebXR immersive-ar. Inicia la sesión y apunta
              la cámara a una superficie plana — un círculo de hit-test aparecerá
              y podrás tocar para anclar el objeto.
            </p>
            <button
              type="button"
              onClick={() => setPhase('session')}
              className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-bold uppercase tracking-wider min-h-[44px] inline-flex items-center gap-2"
            >
              <Camera className="w-4 h-4" aria-hidden="true" />
              Iniciar AR inmersivo
            </button>
            <p className="text-[10px] text-zinc-500 mt-3">
              Estado: <span className="text-cyan-300">{object.lifecycle}</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
