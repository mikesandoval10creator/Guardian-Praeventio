/**
 * useProjectCapacity — thin reactive wrapper over the pure capacity logic.
 *
 * All business rules live in `src/services/capacity/*` (pure, unit-tested).
 * This hook just:
 *   1. Reads live projects from ProjectContext.
 *   2. Folds them into a CapacityState.
 *   3. Calls evaluateCapacity + evaluateNormativeAlerts.
 *
 * It deliberately does NOT bake in tier prices or normativa thresholds —
 * those stay in the service modules.
 */

import { useMemo } from 'react';
import { useProject } from '../contexts/ProjectContext';
import {
  evaluateCapacity,
  type CapacityState,
  type ProjectInfo,
  type TierData,
  type TierEvaluation,
} from '../services/capacity/tierEvaluation';
import {
  evaluateNormativeAlerts,
  type NormativeAlert,
} from '../services/capacity/normativeAlerts';

export interface UseProjectCapacityOptions {
  /**
   * Current tier id. In production this should come from
   * SubscriptionContext / IMP1's tier mapping. Passed as a prop here so the
   * hook stays decoupled and trivially testable.
   */
  currentTierId: string;
  /**
   * Tier catalogue. Injected (not imported) so this hook does not depend on
   * IMP1's `src/services/pricing/tiers.ts` shipping first. The Pricing page
   * will pass `TIERS` from tiers.ts directly.
   */
  tierData: TierData[];
}

export interface UseProjectCapacityResult {
  state: CapacityState;
  evaluation: TierEvaluation;
  alerts: NormativeAlert[];
  loading: boolean;
}

export function useProjectCapacity(
  options: UseProjectCapacityOptions,
): UseProjectCapacityResult {
  const { currentTierId, tierData } = options;
  const { projects, loading } = useProject();

  const state = useMemo<CapacityState>(() => {
    const perProjectWorkers: ProjectInfo[] = projects.map((p) => ({
      id: p.id,
      workerCount: p.workersCount ?? 0,
    }));
    const totalWorkers = perProjectWorkers.reduce(
      (sum, p) => sum + p.workerCount,
      0,
    );
    return {
      totalWorkers,
      totalProjects: perProjectWorkers.length,
      perProjectWorkers,
    };
  }, [projects]);

  const evaluation = useMemo<TierEvaluation>(
    () => evaluateCapacity(currentTierId, state, tierData),
    [currentTierId, state, tierData],
  );

  const alerts = useMemo<NormativeAlert[]>(
    () => evaluateNormativeAlerts(state.perProjectWorkers),
    [state.perProjectWorkers],
  );

  return { state, evaluation, alerts, loading };
}
