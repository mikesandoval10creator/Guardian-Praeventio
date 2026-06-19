// Praeventio Guard — expirable items client hook (B.9 panel data path).
//
// Pairs with `src/server/routes/expirations.ts`:
//   GET /api/sprint-k/:projectId/expirations/list
//
// The server assembles REAL expirable items from project subcollections
// (today: EPP assignments with a confirmed `expiresAt`). The view runs the
// pure `scanForExpirations` engine over them — no fabricated dates.

import { useEndpoint } from './_fetchUtils';
import type { ExpirableItem } from '../services/expirations/expirationScanner';

interface ExpirableItemsResponse {
  items: ExpirableItem[];
}

export interface UseExpirableItems {
  items: ExpirableItem[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useExpirableItems(projectId: string | null): UseExpirableItems {
  const path = projectId
    ? `/api/sprint-k/${projectId}/expirations/list`
    : null;
  const { data, loading, error, refetch } =
    useEndpoint<ExpirableItemsResponse>(path);
  return { items: data?.items ?? [], loading, error, refetch };
}
