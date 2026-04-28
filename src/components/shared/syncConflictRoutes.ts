/**
 * Shared mapping from Firestore collection names to in-app routes used by the
 * SyncConflictBanner's "Abrir registro" action.
 *
 * The banner itself stays router-agnostic (see `SyncConflictBanner.tsx`); the
 * top-level `RootLayout` consumes this helper and calls `react-router-dom`'s
 * `navigate` with the resolved target.
 *
 * For collections that don't yet have a dedicated detail route, we surface the
 * matching listing page with the doc id in a query string so the user can find
 * the record manually. When detail routes ship, update the mapping here — the
 * unit tests in `syncConflictRoutes.test.ts` cover the whole table.
 */

export const KNOWN_SYNC_COLLECTIONS = [
  'iper_nodes',
  'nodes',
  'audits',
  'workers',
  'documents',
  'projects',
  'findings',
] as const;

export type KnownSyncCollection = (typeof KNOWN_SYNC_COLLECTIONS)[number];

/**
 * Resolve a Firestore collection + document id pair to an in-app route, or
 * `null` if the collection is not in the known mapping. Callers should
 * gracefully no-op (and log a warning) when `null` is returned.
 *
 * The doc id is percent-encoded internally — callers must pass the raw id.
 */
export function routeForCollection(
  collectionName: string,
  docId: string,
): string | null {
  const id = encodeURIComponent(docId);
  switch (collectionName) {
    // IPER / risk graph nodes — best-guess: Risks listing (no detail route yet).
    case 'iper_nodes':
      return `/risks?node=${id}`;
    case 'nodes':
      return `/risk-network?node=${id}`;
    // Listings without dedicated detail routes — surface the listing with id.
    case 'audits':
      return `/audits?id=${id}`;
    case 'workers':
      return `/workers?id=${id}`;
    // Documents has a real detail viewer.
    case 'documents':
      return `/documents/${id}`;
    case 'projects':
      return `/projects?id=${id}`;
    case 'findings':
      return `/findings?id=${id}`;
    default:
      return null;
  }
}
