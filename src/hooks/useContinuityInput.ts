// Praeventio Guard — Assembles ContinuityInput from real project data.
//
// Derives ContinuityInput dimensions from existing project hooks:
//   - uniqueSkillHolders: empty (no GET endpoint for per-worker skills yet)
//   - equipmentWithoutBackup: from equipment inventory (critical/high criticality, single-instance)
//   - soleSuppliers: from supplier registry (single-source for a service)
//   - unbackedCriticalDocs: empty until sitebook backup-tracking lands
//
// No fabricated data: empty arrays when the project has no data yet.

import { useMemo } from 'react';
import { useEquipment } from './useEquipment';
import { useSuppliers } from './useSuppliers';
import type { ContinuityInput } from '../services/continuity/continuityPlanning';

/**
 * Assembles a ContinuityInput from real project data sources.
 * Returns `{ input, loading, error }` for direct consumption by <SpofPanel>.
 */
export function useContinuityInput(projectId: string | null): {
  input: ContinuityInput;
  loading: boolean;
  error: Error | null;
} {
  const equipmentState = useEquipment(projectId);
  const suppliersState = useSuppliers(projectId);

  const loading = equipmentState.loading || suppliersState.loading;
  const error = equipmentState.error ?? suppliersState.error ?? null;

  const input = useMemo<ContinuityInput>(() => {
    // Equipment without backup: critical or high criticality items that are
    // single-instance (only one unit of that type in the project).
    const equipment = equipmentState.data?.equipment ?? [];
    const criticalEquipment = equipment.filter(
      (eq) => eq.criticality === 'critical' || eq.criticality === 'high',
    );
    // Count by type to detect single-instance critical equipment.
    const eqTypeCounts = new Map<string, number>();
    for (const eq of criticalEquipment) {
      eqTypeCounts.set(eq.type, (eqTypeCounts.get(eq.type) ?? 0) + 1);
    }
    const equipmentWithoutBackup = criticalEquipment
      .filter((eq) => (eqTypeCounts.get(eq.type) ?? 0) <= 1)
      .map((eq) => ({
        id: eq.id,
        label: `${eq.code} — ${eq.type}${eq.brand ? ` (${eq.brand})` : ''}`,
        dependentTasks: [] as string[],
      }));

    // Sole suppliers: suppliers whose services have no alternative provider.
    const suppliers = suppliersState.data?.suppliers ?? [];
    const serviceCount = new Map<string, number>();
    for (const s of suppliers) {
      for (const svc of s.services) {
        serviceCount.set(svc, (serviceCount.get(svc) ?? 0) + 1);
      }
    }
    const soleSuppliers: ContinuityInput['soleSuppliers'] = [];
    const seen = new Set<string>();
    for (const s of suppliers) {
      for (const svc of s.services) {
        if ((serviceCount.get(svc) ?? 0) === 1) {
          const key = `${s.id}:${svc}`;
          if (!seen.has(key)) {
            seen.add(key);
            soleSuppliers.push({ supplierId: s.id, service: svc });
          }
        }
      }
    }

    // Unique skill holders: requires worker-skill matrix to identify which
    // skills are held by exactly one person. No GET endpoint exists yet for
    // fetching per-worker skills; the skill-gap endpoints are POST compute
    // only. Pass empty until a dedicated data source lands (no fabricated data).
    const uniqueSkillHolders: ContinuityInput['uniqueSkillHolders'] = [];

    // Unbacked critical docs: not yet available from any data source.
    // Will be wired when sitebook backup-tracking lands.
    const unbackedCriticalDocs: ContinuityInput['unbackedCriticalDocs'] = [];

    return {
      uniqueSkillHolders,
      equipmentWithoutBackup,
      soleSuppliers,
      unbackedCriticalDocs,
    };
  }, [equipmentState.data, suppliersState.data]);

  return { input, loading, error };
}
