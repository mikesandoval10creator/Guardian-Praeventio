// SPDX-License-Identifier: MIT
//
// ARWarehouseScene — Sprint F (2026-05-16) AR Real Vision, caso 3.
//
// Modo AR para PLANIFICAR el orden de una bodega antes de comprar/
// instalar los elementos físicos. Cumple la directiva del usuario:
//
//   "para planificar dónde poner cosas, el orden de una persona que
//    usa herramientas por ejemplo, mejorar la calidad de un inventario,
//    ayudar a ordenar una bodega"
//
// User flow:
//   1. Usuario entra al modo desde /digital-twin/ar
//   2. Elige qué tipo de objeto va a placear (extintor PQS, CO2,
//      hidrante, AED, señalética evacuación, etc.) — los 17 ArKind
//      tipados en ArViewLink.
//   3. XRSession arranca, ve reticle sobre superficie
//   4. Tap → guarda WarehouseObjectAnchor con el objectType seleccionado
//   5. Lista todos los placed objects del proyecto + alertas si hay
//      pares peligrosamente cerca (configurable, default 3m)
//   6. Tap en un objeto existente → opciones: cambiar status
//      (planned/installed/removed), eliminar, ver detalle
//
// Reusa el patrón de ARMachineryScene. La diferencia clave:
//   - Selector de tipo de objeto antes/durante el placement
//   - Validación de proximidad usando findProximityPairs del service
//   - Visualización del status (planned vs installed) con colores

import React, { useEffect, useMemo, useState } from 'react';
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
  findProximityPairs,
  matrixFromPosition,
  newAnchorId,
  positionFromMatrix,
  type WarehouseObjectAnchor,
} from '../../services/ar/arAnchorService';
import { Warehouse, X, Plus, AlertTriangle, Layers, CheckCircle2 } from 'lucide-react';

// Objetos placeables — match con ArKind de ArViewLink.tsx
const PLACEABLE_OBJECTS: Array<{
  type: WarehouseObjectAnchor['objectType'];
  label: string;
  emoji: string;
  /** Color hex para preview mesh + reticle */
  color: number;
}> = [
  { type: 'extinguisher_pqs', label: 'Extintor PQS', emoji: '🧯', color: 0xef4444 },
  { type: 'extinguisher_co2', label: 'Extintor CO₂', emoji: '🧯', color: 0x1e40af },
  { type: 'extinguisher_water', label: 'Extintor Agua', emoji: '🧯', color: 0x3b82f6 },
  { type: 'hydrant', label: 'Hidrante', emoji: '🚒', color: 0xdc2626 },
  { type: 'aed', label: 'DEA', emoji: '🫀', color: 0xec4899 },
  { type: 'first_aid_kit', label: 'Botiquín', emoji: '🩹', color: 0x10b981 },
  { type: 'sign_evacuation', label: 'Señal Evacuación', emoji: '🟢', color: 0x22c55e },
  { type: 'sign_warning', label: 'Señal Advertencia', emoji: '⚠️', color: 0xf59e0b },
  { type: 'sign_mandatory', label: 'Señal Obligación', emoji: '🔵', color: 0x2563eb },
  { type: 'sign_prohibition', label: 'Señal Prohibición', emoji: '🚫', color: 0xb91c1c },
  { type: 'emergency_shower', label: 'Ducha Emergencia', emoji: '🚿', color: 0x06b6d4 },
  { type: 'eye_wash_station', label: 'Lavaojos', emoji: '👁️', color: 0x0ea5e9 },
  { type: 'gas_detector', label: 'Detector Gas', emoji: '🌫️', color: 0xa78bfa },
  { type: 'spill_kit', label: 'Kit Derrames', emoji: '🧪', color: 0x84cc16 },
  { type: 'safety_shower', label: 'Ducha Seguridad', emoji: '💧', color: 0x06b6d4 },
  { type: 'assembly_point', label: 'Punto Encuentro', emoji: '🏁', color: 0x22d3ee },
  { type: 'evacuation_route', label: 'Ruta Evacuación', emoji: '➡️', color: 0x10b981 },
];

/** Radio mínimo entre objetos para que NO se considere "demasiado cerca". */
const PROXIMITY_THRESHOLD_M = 1.5;

function buildPreviewMesh(color: number): THREE.Object3D {
  const group = new THREE.Group();
  const geo = new THREE.BoxGeometry(0.12, 0.18, 0.12);
  const mat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.4,
    metalness: 0.3,
    roughness: 0.6,
    transparent: true,
    opacity: 0.85,
  });
  const cube = new THREE.Mesh(geo, mat);
  cube.position.y = 0.09;
  group.add(cube);
  return group;
}

export interface ARWarehouseSceneProps {
  onExit?: () => void;
}

export function ARWarehouseScene({ onExit }: ARWarehouseSceneProps) {
  const { selectedProject } = useProject();
  const { user } = useFirebase();
  // Codex fix: tenantId viene del custom claim del ID token, no de user.*
  const { tenantId } = useTenantId();
  const projectId = selectedProject?.id ?? null;

  const { anchors, loading, error } = useProjectArAnchors({
    tenantId,
    projectId,
    kind: 'warehouse_object',
  });

  const warehouseObjects = useMemo(
    () => anchors.filter((a): a is WarehouseObjectAnchor => a.kind === 'warehouse_object'),
    [anchors],
  );

  const [selectedObjectType, setSelectedObjectType] =
    useState<WarehouseObjectAnchor['objectType']>('extinguisher_pqs');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selectedAnchorId, setSelectedAnchorId] = useState<string | null>(null);

  const selectedObjectMeta = useMemo(
    () => PLACEABLE_OBJECTS.find((o) => o.type === selectedObjectType) ?? PLACEABLE_OBJECTS[0]!,
    [selectedObjectType],
  );

  // Preview mesh cambia de color según el objeto elegido.
  const previewMesh = useMemo(
    () => buildPreviewMesh(selectedObjectMeta.color),
    [selectedObjectMeta.color],
  );

  // Proximidad: pares de objetos demasiado cerca.
  const proximityPairs = useMemo(
    () => findProximityPairs(warehouseObjects, PROXIMITY_THRESHOLD_M),
    [warehouseObjects],
  );

  const handleSelectAnchor = async (pose: XRSessionAnchorPose) => {
    if (!tenantId || !projectId || !user) {
      setSaveError('Falta proyecto activo o autenticación.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    const nowIso = new Date().toISOString();
    const anchor: WarehouseObjectAnchor = {
      id: newAnchorId('warehouse_object'),
      kind: 'warehouse_object',
      projectId,
      tenantId,
      createdByUid: user.uid,
      createdAt: nowIso,
      updatedAt: nowIso,
      gps: { latitude: 0, longitude: 0 },
      matrix: matrixFromPosition(pose.x, pose.y, pose.z),
      label: selectedObjectMeta.label,
      objectType: selectedObjectType,
      status: 'planned',
    };
    try {
      const path = `tenants/${tenantId}/ar_anchors/${anchor.id}`;
      await setDoc(doc(db, path), anchor);
    } catch (err) {
      logger.error('AR warehouse anchor create failed', err);
      setSaveError('No pudimos guardar el objeto. Verifica permiso del proyecto.');
    } finally {
      setSaving(false);
    }
  };

  const selectedAnchor = useMemo(
    () => warehouseObjects.find((a) => a.id === selectedAnchorId) ?? null,
    [warehouseObjects, selectedAnchorId],
  );

  const handleChangeStatus = async (
    anchor: WarehouseObjectAnchor,
    status: WarehouseObjectAnchor['status'],
  ) => {
    if (!tenantId || !projectId) return;
    try {
      const path = `tenants/${tenantId}/ar_anchors/${anchor.id}`;
      await setDoc(
        doc(db, path),
        { ...anchor, status, updatedAt: new Date().toISOString() },
        { merge: true },
      );
    } catch (err) {
      logger.error('AR warehouse status change failed', err);
    }
  };

  const domOverlay = (
    <div className="absolute inset-0 flex flex-col">
      {/* Header */}
      <div className="pointer-events-auto m-4 flex items-center justify-between bg-black/70 backdrop-blur-md border border-white/10 rounded-2xl p-3">
        <div className="flex items-center gap-2">
          <Warehouse className="w-5 h-5 text-emerald-400" />
          <div>
            <p className="text-xs font-bold text-white uppercase tracking-wider">
              Modo AR — Bodega
            </p>
            <p className="text-[10px] text-zinc-400">
              {selectedProject?.name ?? 'Proyecto'} · {warehouseObjects.length} objetos
              {proximityPairs.length > 0 && (
                <span className="ml-1 text-amber-300">
                  · {proximityPairs.length} muy cerca
                </span>
              )}
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

      {/* Selector tipo de objeto — chips */}
      <div className="pointer-events-auto mx-4 bg-black/65 backdrop-blur-md border border-white/10 rounded-2xl p-2">
        <p className="text-[9px] text-zinc-500 uppercase tracking-widest mb-1 px-1">
          Selecciona qué placear → tap en una superficie
        </p>
        <div className="flex gap-1 overflow-x-auto pb-1">
          {PLACEABLE_OBJECTS.map((o) => (
            <button
              key={o.type}
              type="button"
              onClick={() => setSelectedObjectType(o.type)}
              className={`shrink-0 px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wide border transition-colors ${
                selectedObjectType === o.type
                  ? 'bg-emerald-500/30 border-emerald-400 text-white'
                  : 'bg-zinc-900 border-white/5 text-zinc-300'
              }`}
            >
              <span className="mr-1">{o.emoji}</span>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="pointer-events-none m-4 bg-black/60 rounded-xl p-2 text-xs text-white">
          Cargando objetos del proyecto...
        </div>
      )}
      {error && (
        <div className="pointer-events-none m-4 bg-rose-900/70 rounded-xl p-3 text-xs text-rose-100">
          Error: {error.message}
        </div>
      )}
      {saving && (
        <div className="pointer-events-none m-4 bg-emerald-900/70 rounded-xl p-2 text-xs text-emerald-100">
          Guardando objeto...
        </div>
      )}
      {saveError && (
        <div className="pointer-events-none m-4 bg-rose-900/70 rounded-xl p-2 text-xs text-rose-100">
          {saveError}
        </div>
      )}

      <div className="flex-1" />

      {/* Alertas de proximidad */}
      {proximityPairs.length > 0 && (
        <div className="pointer-events-auto mx-4 mb-2 bg-amber-900/85 backdrop-blur-md border border-amber-500/40 rounded-2xl p-3 max-w-md">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="w-4 h-4 text-amber-300" />
            <p className="text-xs font-bold text-amber-100">
              {proximityPairs.length} par(es) demasiado cerca (&lt;{PROXIMITY_THRESHOLD_M}m)
            </p>
          </div>
          <ul className="text-[10px] text-amber-200/80 space-y-0.5">
            {proximityPairs.slice(0, 3).map((p, idx) => (
              <li key={idx}>
                "{p.a.label}" ↔ "{p.b.label}" — {p.distanceM.toFixed(2)}m
              </li>
            ))}
            {proximityPairs.length > 3 && (
              <li className="italic">…y {proximityPairs.length - 3} más</li>
            )}
          </ul>
          <p className="mt-1 text-[9px] text-amber-200/60">
            Considera separar visualmente para evitar interferencias operativas.
          </p>
        </div>
      )}

      {/* Card de objeto seleccionado */}
      {selectedAnchor && (
        <div className="pointer-events-auto m-4 bg-black/85 backdrop-blur-md border border-emerald-500/30 rounded-2xl p-4 max-w-md mx-auto">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className="text-sm font-bold text-white">{selectedAnchor.label}</h3>
              <p className="text-[10px] text-zinc-400 font-mono">
                {selectedAnchor.objectType}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedAnchorId(null)}
              className="p-1 rounded hover:bg-white/10"
              aria-label="Cerrar"
            >
              <X className="w-4 h-4 text-zinc-400" />
            </button>
          </div>
          <div className="flex gap-2 mb-2">
            {(['planned', 'installed', 'removed'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => handleChangeStatus(selectedAnchor, s)}
                className={`flex-1 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wide ${
                  selectedAnchor.status === s
                    ? s === 'installed'
                      ? 'bg-emerald-500/30 text-emerald-200'
                      : s === 'planned'
                        ? 'bg-amber-500/30 text-amber-200'
                        : 'bg-rose-500/30 text-rose-200'
                    : 'bg-zinc-800 text-zinc-400'
                }`}
              >
                {s === 'planned' ? 'Planeado' : s === 'installed' ? 'Instalado' : 'Removido'}
              </button>
            ))}
          </div>
          <p className="text-[9px] text-zinc-500 font-mono">
            Pos: {positionFromMatrix(selectedAnchor.matrix).x.toFixed(2)},{' '}
            {positionFromMatrix(selectedAnchor.matrix).y.toFixed(2)},{' '}
            {positionFromMatrix(selectedAnchor.matrix).z.toFixed(2)}
          </p>
        </div>
      )}

      {/* Listado objetos (footer) */}
      {!selectedAnchor && warehouseObjects.length > 0 && (
        <div className="pointer-events-auto m-4 bg-black/65 backdrop-blur-md rounded-2xl p-2 max-h-32 overflow-y-auto">
          <p className="text-[9px] text-zinc-500 uppercase tracking-widest mb-1 px-1">
            Objetos placeados
          </p>
          <ul className="space-y-0.5">
            {warehouseObjects.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => setSelectedAnchorId(a.id)}
                  className="w-full text-left px-2 py-1 rounded hover:bg-white/10 text-[11px] flex justify-between items-center"
                >
                  <span className="text-white font-medium truncate">
                    {PLACEABLE_OBJECTS.find((o) => o.type === a.objectType)?.emoji ?? '📦'}{' '}
                    {a.label}
                  </span>
                  <span
                    className={`text-[9px] uppercase font-bold ${
                      a.status === 'installed'
                        ? 'text-emerald-400'
                        : a.status === 'planned'
                          ? 'text-amber-400'
                          : 'text-rose-400'
                    }`}
                  >
                    {a.status === 'installed' && <CheckCircle2 className="w-3 h-3 inline" />}{' '}
                    {a.status}
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
      reticleColor={`#${selectedObjectMeta.color.toString(16).padStart(6, '0')}`}
      previewMesh={previewMesh}
      domOverlayContent={domOverlay}
    />
  );
}
