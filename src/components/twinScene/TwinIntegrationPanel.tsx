// Praeventio Guard — Sprint 46 D.1/D.2/D.3 integration panel.
//
// Componente container que conecta los 3 motores Twin existentes con
// la escena 3D nueva (TwinSceneInstanced) en un solo wire:
//
//   - D.2 cargo/stowageOptimizer.computeCenterOfGravity → cog marker 3D
//   - D.3 hvac/thermalModel.steadyStateTemperatureC → heatField overlay
//   - Workers feed (caller provee) → InstancedMesh por status
//
// Stateless: padre pasa snapshots; este traduce a props del scene.

import { useMemo } from 'react';
import {
  computeCenterOfGravity,
  type PlacedItem,
} from '../../services/cargo/stowageOptimizer.js';
import {
  steadyStateTemperatureC,
  type ThermalZone,
  type ThermalDriver,
} from '../../services/hvac/thermalModel.js';
import {
  TwinSceneInstanced,
  type WorkerMarker,
  type EquipmentInstance,
  type SensorMarker,
  type HeatField,
  type CargoItem as SceneCargo,
} from './TwinSceneInstanced.js';
import type { Vector3Tuple } from 'three';

export interface TwinIntegrationPanelProps {
  /** Trabajadores en vivo. */
  workers?: ReadonlyArray<WorkerMarker>;
  /** Equipos en faena. */
  equipment?: ReadonlyArray<EquipmentInstance>;
  /** Sensores con sus lecturas. */
  sensors?: ReadonlyArray<SensorMarker>;
  /** Cargo del módulo stowage (D.2). */
  placedCargo?: ReadonlyArray<PlacedItem>;
  /** Para overlay térmico (D.3). Si se pasa, el panel calcula
   *  steady-state y rendea como hotspot. */
  thermal?: {
    zone: ThermalZone;
    driver: ThermalDriver;
    /** Centro de la zona en el plano 3D (donde aparece el hotspot). */
    zoneCenter: Vector3Tuple;
    /** Umbral °C para considerar la zona en alerta (default 28). */
    alertThresholdC?: number;
    /** Umbral °C donde la severidad es crítica (default 35). */
    criticalThresholdC?: number;
  };
  /** Tono visual. */
  appearance?: 'light' | 'dark';
  /** Activar Rapier physics (opcional). */
  physicsEnabled?: boolean;
}

/**
 * Mapea steady-state °C a severidad 0..1.
 * alertThreshold → 0.2, criticalThreshold → 0.9, lineal entre medios.
 */
function severityFromTemp(
  c: number,
  alertC: number,
  criticalC: number,
): number {
  if (c < alertC) return 0;
  if (c >= criticalC) return 1;
  return 0.2 + ((c - alertC) / (criticalC - alertC)) * 0.7;
}

export function TwinIntegrationPanel({
  workers,
  equipment,
  sensors,
  placedCargo,
  thermal,
  appearance,
  physicsEnabled,
}: TwinIntegrationPanelProps) {
  // ── Cargo: convertir PlacedItem → SceneCargo + COG
  const sceneCargo: SceneCargo[] | undefined = useMemo(() => {
    if (!placedCargo || placedCargo.length === 0) return undefined;
    return placedCargo.map((p) => ({
      id: p.item.id,
      position: [
        p.position.x + p.item.dimensions.x / 2,
        p.position.y + p.item.dimensions.y / 2,
        p.position.z + p.item.dimensions.z / 2,
      ] as Vector3Tuple,
      size: [p.item.dimensions.x, p.item.dimensions.y, p.item.dimensions.z] as Vector3Tuple,
      massKg: p.item.mass,
    }));
  }, [placedCargo]);

  const cargoCog: Vector3Tuple | null = useMemo(() => {
    if (!placedCargo || placedCargo.length === 0) return null;
    const cog = computeCenterOfGravity([...placedCargo]);
    return [cog.x, cog.y, cog.z];
  }, [placedCargo]);

  // ── Thermal: calcular steady-state y mapear a heatField
  const heatField: HeatField | null = useMemo(() => {
    if (!thermal) return null;
    const alertC = thermal.alertThresholdC ?? 28;
    const criticalC = thermal.criticalThresholdC ?? 35;
    const ssC = steadyStateTemperatureC(thermal.zone, thermal.driver);
    const severity = severityFromTemp(ssC, alertC, criticalC);
    return {
      averageC: ssC,
      hotspot: thermal.zoneCenter,
      severity,
    };
  }, [thermal]);

  // HUD info derivado
  const cogReadout = cargoCog
    ? `COG (${cargoCog[0].toFixed(1)}, ${cargoCog[1].toFixed(1)}, ${cargoCog[2].toFixed(1)})`
    : 'sin cargo';
  const thermalReadout = heatField
    ? `T° ${heatField.averageC.toFixed(1)}°C · sev ${(heatField.severity * 100).toFixed(0)}%`
    : 'sin telemetría térmica';

  return (
    <section
      data-testid="twin-integration"
      className="space-y-2"
    >
      <TwinSceneInstanced
        workers={workers}
        equipment={equipment}
        sensors={sensors}
        cargo={sceneCargo}
        cargoCog={cargoCog}
        heatField={heatField}
        physicsEnabled={physicsEnabled}
        appearance={appearance}
      />
      <footer
        data-testid="twin-integration.readout"
        className="flex items-center justify-between rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200"
      >
        <span data-testid="twin-integration.cog">{cogReadout}</span>
        <span data-testid="twin-integration.thermal">{thermalReadout}</span>
        <span data-testid="twin-integration.physics">
          física: {physicsEnabled ? 'on' : 'off'}
        </span>
      </footer>
    </section>
  );
}
