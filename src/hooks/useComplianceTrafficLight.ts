// Praeventio Guard — F.2 compliance traffic light client hook.
//
// Pairs with `src/server/routes/compliance.ts`:
//   GET /api/compliance/:projectId/traffic-light
//
// The server builds a REAL ProjectProfile and runs the deterministic legal
// engine; categories without a wired data source come back as 'unknown'
// ("sin datos"), never fabricated green. The view only presents.

import { useEndpoint } from './_fetchUtils';
import type { ComplianceTrafficLightView } from '../services/compliance/trafficLightCoverage';

interface TrafficLightResponse {
  result: ComplianceTrafficLightView;
}

export interface UseComplianceTrafficLight {
  result: ComplianceTrafficLightView | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useComplianceTrafficLight(
  projectId: string | null,
): UseComplianceTrafficLight {
  const path = projectId
    ? `/api/compliance/${projectId}/traffic-light`
    : null;
  const { data, loading, error, refetch } =
    useEndpoint<TrafficLightResponse>(path);
  return { result: data?.result ?? null, loading, error, refetch };
}
