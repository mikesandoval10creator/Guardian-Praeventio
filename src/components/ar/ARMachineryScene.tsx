// SPDX-License-Identifier: MIT
//
// ARMachineryScene — Sprint F (2026-05-16) AR Real Vision.
//
// Modo AR para visualizar y crear "nodos de información" sobre
// maquinaria real del faena. Cumple la directiva del usuario:
//
//   "los nodos de información en la maquinaria de la empresa con
//    coordenadas, esa información es privada por proyecto"
//
// Reusa el `XRSession` existente (Sprint 21 L.3) — sesión WebXR real
// con hit-test, anchors, dom-overlay. Carga los anchors persistidos
// del proyecto vía `useProjectArAnchors` y los renderiza como labels
// 3D flotantes. Tap en un anchor → expandir card con info real.
// Tap en superficie nueva → "Crear anchor aquí" + selector equipment.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useProject } from '../../contexts/ProjectContext';
import { useFirebase } from '../../contexts/FirebaseContext';
import { useTenantId } from '../../hooks/useTenantId';
import { useProjectArAnchors } from '../../hooks/useProjectArAnchors';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { logger } from '../../utils/logger';
import { XRSession, type XRSessionAnchorPose } from './XRSession';
import {
  matrixFromPosition,
  newAnchorId,
  positionFromMatrix,
  type MachineryAnchor,
} from '../../services/ar/arAnchorService';
import { Cpu, MapPin, Plus, X, AlertTriangle, ShieldCheck } from 'lucide-react';
import { humanErrorMessage } from '../../lib/humanError';


interface CreateAnchorDraft {
  position: XRSessionAnchorPose;
  /** Estado del wizard de creación post-tap. */
  step: 'select_equipment' | 'enter_info' | 'saving';
}

/**
 * Compone un preview mesh 3D para acompañar al reticle del hit-test.
 * Forma simple: octahedro azul con label invisible que sirve de placeholder
 * visual. La info real va al dom-overlay.
 */
function buildPreviewMesh(): THREE.Object3D {
  const geo = new THREE.OctahedronGeometry(0.05);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x4db6ac,
    emissive: 0x1e88e5,
    emissiveIntensity: 0.35,
    metalness: 0.5,
    roughness: 0.3,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.1; // levitar sobre el suelo detectado
  return mesh;
}

interface AnchorPin {
  anchor: MachineryAnchor;
  /** Posición precomputada para el render loop. */
  worldPos: { x: number; y: number; z: number };
}

export interface ARMachineryScenePros {
  onExit?: () => void;
}

export function ARMachineryScene({ onExit }: ARMachineryScenePros) {
  const { selectedProject } = useProject();
  const { user } = useFirebase();
  // Codex fix: tenantId NO está en user.* — viene del custom claim del
  // ID token. Sin esto, todo el flujo AR fallaba silenciosamente.
  const { tenantId } = useTenantId();
  const projectId = selectedProject?.id ?? null;

  const { anchors, loading, error } = useProjectArAnchors({
    tenantId,
    projectId,
    kind: 'machinery',
  });

  const machineryAnchors = useMemo(
    () => anchors.filter((a): a is MachineryAnchor => a.kind === 'machinery'),
    [anchors],
  );

  // Pre-computamos posiciones para el render loop.
  const pins: AnchorPin[] = useMemo(() => {
    return machineryAnchors.map((a) => ({
      anchor: a,
      worldPos: positionFromMatrix(a.matrix),
    }));
  }, [machineryAnchors]);

  const [selectedAnchor, setSelectedAnchor] = useState<MachineryAnchor | null>(null);
  const [draftAnchor, setDraftAnchor] = useState<CreateAnchorDraft | null>(null);
  const [equipmentCode, setEquipmentCode] = useState<string>('');
  const [equipmentId, setEquipmentId] = useState<string>('');
  const [saveError, setSaveError] = useState<string | null>(null);

  const previewMesh = useMemo(() => buildPreviewMesh(), []);

  const handleSelectAnchor = (pose: XRSessionAnchorPose) => {
    setDraftAnchor({ position: pose, step: 'select_equipment' });
    setEquipmentCode('');
    setEquipmentId('');
    setSaveError(null);
  };

  const handleConfirmCreate = async () => {
    if (!draftAnchor || !tenantId || !projectId || !user) return;
    if (!equipmentCode.trim() || !equipmentId.trim()) {
      setSaveError('Completa el código del equipo y el ID interno.');
      return;
    }
    setDraftAnchor({ ...draftAnchor, step: 'saving' });
    setSaveError(null);

    // Codex fix — Limitación honesta:
    //
    // Las coordenadas (x, y, z) que devuelve XRSession vienen del
    // WebXR `local` reference space, cuyo origen se establece POR SESIÓN.
    // Es decir, si guardo (3.2, 1.0, -0.5) ahora y mañana abro AR de
    // nuevo, esos mismos números van a apuntar a OTRO lugar físico
    // porque el origen del nuevo `local` space va a ser diferente.
    //
    // Mientras NO tengamos WebXR `anchors` con persistent ID (limitado
    // en browsers actuales) o un sistema de markers visuales (ej. QR
    // code en cada máquina que recalibre el origen), las anclas tienen
    // utilidad SOLO dentro de la misma sesión + son referencia
    // "aproximada" cross-session.
    //
    // Por eso:
    //   - Capturamos GPS coords del navigator.geolocation cuando se
    //     pueda — al menos sabremos a qué bbox del faena pertenece el
    //     ancla (útil para listas "anchors cerca de mí").
    //   - El UI debe disclaimar que las posiciones son "referenciales"
    //     hasta que llegue persistencia AR real (Roadmap próximo).
    const nowIso = new Date().toISOString();
    let gps = { latitude: 0, longitude: 0 };
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            timeout: 3000,
            maximumAge: 60_000,
            enableHighAccuracy: false,
          });
        });
        gps = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      } catch {
        // Geolocation rechazado o timeout — guardamos sin GPS (0,0).
      }
    }

    const anchor: MachineryAnchor = {
      id: newAnchorId('machinery'),
      kind: 'machinery',
      projectId,
      tenantId,
      createdByUid: user.uid,
      createdAt: nowIso,
      updatedAt: nowIso,
      gps,
      matrix: matrixFromPosition(
        draftAnchor.position.x,
        draftAnchor.position.y,
        draftAnchor.position.z,
      ),
      label: equipmentCode.trim(),
      equipmentId: equipmentId.trim(),
      info: {
        code: equipmentCode.trim(),
      },
    };

    try {
      // Path 3-niveles (match con firestore.rules).
      const path = `tenants/${tenantId}/ar_anchors/${anchor.id}`;
      await setDoc(doc(db, path), anchor);
      setDraftAnchor(null);
    } catch (err) {
      logger.error('AR anchor create failed', err);
      setSaveError(
        'No pudimos guardar el anchor. Verifica permiso del proyecto y reintenta.',
      );
      setDraftAnchor(draftAnchor); // back to select_equipment step
    }
  };

  // Render el dom-overlay con info real de los anchors visibles.
  const domOverlay = (
    <div className="absolute inset-0 flex flex-col">
      {/* Header */}
      <div className="pointer-events-auto m-4 flex items-center justify-between bg-black/70 backdrop-blur-md border border-white/10 rounded-2xl p-3">
        <div className="flex items-center gap-2">
          <Cpu className="w-5 h-5 text-cyan-400" />
          <div>
            <p className="text-xs font-bold text-white uppercase tracking-wider">
              Modo AR — Maquinaria
            </p>
            <p className="text-[10px] text-zinc-400">
              {selectedProject?.name ?? 'Proyecto activo'} · {pins.length} anclas
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onExit}
          aria-label="Salir AR"
          className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
        >
          <X className="w-5 h-5 text-white" />
        </button>
      </div>

      {/* Loading / error states */}
      {loading && (
        <div className="pointer-events-none m-4 bg-black/60 rounded-xl p-2 text-xs text-white">
          Cargando anclas del proyecto...
        </div>
      )}
      {error && (
        <div className="pointer-events-none m-4 bg-rose-900/70 rounded-xl p-3 text-xs text-rose-100">
          Error cargando anclas: {humanErrorMessage(error.message)}
        </div>
      )}

      {/* Spacer empuja la card seleccionada al bottom */}
      <div className="flex-1" />

      {/* Card de anchor seleccionado */}
      {selectedAnchor && (
        <div className="pointer-events-auto m-4 bg-black/85 backdrop-blur-md border border-cyan-500/30 rounded-2xl p-4 max-w-md mx-auto">
          <div className="flex items-start gap-3 mb-2">
            <MapPin className="w-5 h-5 text-cyan-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-white">{selectedAnchor.label}</h3>
              <p className="text-[10px] text-zinc-400 font-mono truncate">
                Equipo: {selectedAnchor.info.code}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedAnchor(null)}
              aria-label="Cerrar"
              className="p-1 rounded hover:bg-white/10"
            >
              <X className="w-4 h-4 text-zinc-400" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[10px] text-zinc-300">
            {selectedAnchor.info.lastInspectionAt && (
              <div className="flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                <span>Última: {selectedAnchor.info.lastInspectionAt.slice(0, 10)}</span>
              </div>
            )}
            {selectedAnchor.info.nextMaintenanceAt && (
              <div>Próx: {selectedAnchor.info.nextMaintenanceAt.slice(0, 10)}</div>
            )}
            {typeof selectedAnchor.info.activeAlertCount === 'number' &&
              selectedAnchor.info.activeAlertCount > 0 && (
                <div className="flex items-center gap-1 col-span-2 text-rose-300">
                  <AlertTriangle className="w-3 h-3" />
                  <span>{selectedAnchor.info.activeAlertCount} alerta(s) activa(s)</span>
                </div>
              )}
          </div>
        </div>
      )}

      {/* Wizard de creación */}
      {draftAnchor && (
        <div className="pointer-events-auto m-4 bg-black/85 backdrop-blur-md border border-emerald-500/30 rounded-2xl p-4 max-w-md mx-auto">
          <div className="flex items-center gap-2 mb-3">
            <Plus className="w-5 h-5 text-emerald-400" />
            <h3 className="text-sm font-bold text-white">Crear ancla aquí</h3>
          </div>
          <p className="text-[10px] text-zinc-400 mb-3 font-mono">
            Posición: x={draftAnchor.position.x.toFixed(2)} y=
            {draftAnchor.position.y.toFixed(2)} z=
            {draftAnchor.position.z.toFixed(2)}
          </p>

          <label className="block text-[10px] text-zinc-400 uppercase tracking-wide mb-1">
            Código equipo (e.g. GRH-001)
          </label>
          <input
            type="text"
            value={equipmentCode}
            onChange={(e) => setEquipmentCode(e.target.value)}
            placeholder="GRH-001"
            disabled={draftAnchor.step === 'saving'}
            className="w-full mb-2 px-3 py-2 rounded-lg bg-zinc-900 border border-white/10 text-white text-sm"
          />

          <label className="block text-[10px] text-zinc-400 uppercase tracking-wide mb-1">
            ID interno (Firestore)
          </label>
          <input
            type="text"
            value={equipmentId}
            onChange={(e) => setEquipmentId(e.target.value)}
            placeholder="eq-xxx-uuid"
            disabled={draftAnchor.step === 'saving'}
            className="w-full mb-2 px-3 py-2 rounded-lg bg-zinc-900 border border-white/10 text-white text-sm"
          />

          {saveError && (
            <p className="text-[10px] text-rose-300 mb-2">{humanErrorMessage(saveError)}</p>
          )}

          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={() => setDraftAnchor(null)}
              disabled={draftAnchor.step === 'saving'}
              className="flex-1 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold uppercase"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirmCreate}
              disabled={draftAnchor.step === 'saving'}
              className="flex-1 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold uppercase disabled:opacity-50"
            >
              {draftAnchor.step === 'saving' ? 'Guardando...' : 'Crear ancla'}
            </button>
          </div>
        </div>
      )}

      {/* Footer minimal con anchors visibles (click → seleccionar) */}
      {!draftAnchor && pins.length > 0 && (
        <div className="pointer-events-auto m-4 mt-auto bg-black/65 backdrop-blur-md rounded-2xl p-2 max-h-32 overflow-y-auto">
          <p className="text-[9px] text-zinc-500 uppercase tracking-widest mb-1 px-1">
            Anclas del proyecto
          </p>
          <ul className="space-y-1">
            {pins.map(({ anchor, worldPos }) => (
              <li key={anchor.id}>
                <button
                  type="button"
                  onClick={() => setSelectedAnchor(anchor)}
                  className="w-full text-left px-2 py-1 rounded hover:bg-white/10 text-[11px] flex justify-between items-center"
                >
                  <span className="text-white font-medium truncate">{anchor.label}</span>
                  <span className="text-zinc-500 font-mono text-[9px] shrink-0">
                    {worldPos.x.toFixed(1)},{worldPos.y.toFixed(1)},{worldPos.z.toFixed(1)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );

  return (
    <XRSession
      onSelectAnchor={handleSelectAnchor}
      onSessionEnd={onExit}
      reticleColor="#4db6ac"
      previewMesh={previewMesh}
      domOverlayContent={domOverlay}
    />
  );
}
