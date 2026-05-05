// Praeventio Guard — Sprint 24 differentiators (Bucket MM).
//
// Schema migration registry for `RiskNode` documents stored in Firestore.
//
// Why this exists:
//   The Zettelkasten ("nodes" collection) has accumulated documents written
//   by 39+ commits across `dev/multiagent-bernoulli-sweep` plus historical
//   sprints. Older nodes lack fields that newer code reads unconditionally
//   (e.g. `metadata.geo` for the digital twin overlay added in Sprint 21,
//   `schemaVersion` itself, planned Sprint 24 fields). Writing a one-shot
//   "backfill all nodes" Cloud Function is expensive and brittle — instead
//   we apply migrations LAZILY on read in the Universal Knowledge context,
//   then asynchronously persist the upgraded shape so the next reader gets
//   a hot path without re-running migrations.
//
// Versioning contract:
//   • `version` is monotonic and dense (no gaps). Each migration MUST be
//     idempotent — applying it to an already-upgraded node returns an
//     equivalent node. This lets us replay migrations safely if a write
//     races and a stale reader applies the same upgrade twice.
//   • `up()` takes a node at version `N-1` and returns it at version `N`.
//     The returned object MUST include `schemaVersion: N`.
//   • `down()` is best-effort and used only by dev tooling
//     (`praeventio dev export-tenant` may need to emit at a pinned schema
//     version for older offline clients).
//
// Failure mode:
//   If `applyMigrations` encounters an unknown source version OR a forward
//   gap (e.g. node says v5 but registry only goes to v3), it returns the
//   node unchanged and the caller MUST log a warning. We do NOT throw —
//   throwing during a Firestore onSnapshot callback would tear down the
//   live subscription for an entire project.

export interface Migration {
  /** Monotonic, dense version this migration upgrades TO. */
  version: number;
  /** Short human-readable summary surfaced in dev CLI + audit logs. */
  description: string;
  /** Apply forward. Returns node at this migration's `version`. Must be idempotent. */
  up(node: any): any;
  /** Apply backward. Best-effort; some forward migrations are lossy. */
  down?(node: any): any;
}

/**
 * RiskNode schema migrations, in ascending order. To add a migration:
 *   1. Append a new entry with `version = lastVersion + 1`.
 *   2. Make `up` idempotent (applying twice is a no-op).
 *   3. Bump CURRENT_VERSION below.
 *   4. Add a unit test in `registry.test.ts` covering up + idempotency.
 */
export const RISK_NODE_MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Initial schema baseline — stamp schemaVersion=1 on legacy nodes',
    up: (n: any) => ({ ...n, schemaVersion: 1 }),
    down: (n: any) => {
      const { schemaVersion: _, ...rest } = n;
      return rest;
    },
  },
  {
    version: 2,
    description: 'Add metadata.geo for digital twin overlay (lat/lng/altitude or null)',
    up: (n: any) => ({
      ...n,
      schemaVersion: 2,
      metadata: {
        ...(n.metadata ?? {}),
        geo: n.metadata?.geo ?? null,
      },
    }),
    down: (n: any) => {
      const { geo: _g, ...metaRest } = n.metadata ?? {};
      return { ...n, schemaVersion: 1, metadata: metaRest };
    },
  },
  {
    version: 3,
    description: 'Normalize tags to string[] (some legacy nodes stored a comma-joined string)',
    up: (n: any) => {
      let tags = n.tags;
      if (typeof tags === 'string') {
        tags = tags.split(',').map((t: string) => t.trim()).filter(Boolean);
      } else if (!Array.isArray(tags)) {
        tags = [];
      }
      return { ...n, schemaVersion: 3, tags };
    },
  },
  {
    version: 4,
    description: 'Ensure connections is an array (default []) for nodes created before edge support',
    up: (n: any) => ({
      ...n,
      schemaVersion: 4,
      connections: Array.isArray(n.connections) ? n.connections : [],
    }),
  },
];

/**
 * Latest schema version the app knows how to read. Bump in lockstep when
 * appending to RISK_NODE_MIGRATIONS.
 */
export const CURRENT_RISK_NODE_VERSION = 4;

export function getCurrentVersion(): number {
  return CURRENT_RISK_NODE_VERSION;
}

/**
 * Apply migrations forward (or backward) on a single node, in order.
 *
 * @param node Source node (any shape — may be missing schemaVersion).
 * @param fromVersion The node's current schema version. If omitted, we
 *   read `node.schemaVersion` and fall back to 0 (pre-migration legacy).
 * @param toVersion Target version. Defaults to CURRENT_RISK_NODE_VERSION.
 * @returns Upgraded node, or the original node if migration is impossible
 *   (forward gap, unknown source version). Never throws.
 */
export function applyMigrations(
  node: any,
  fromVersion?: number,
  toVersion: number = CURRENT_RISK_NODE_VERSION,
): any {
  if (node == null) return node;

  const sourceVersion = fromVersion ?? (typeof node.schemaVersion === 'number' ? node.schemaVersion : 0);

  // Already at or beyond target — no-op.
  if (sourceVersion === toVersion) return node;

  // Forward path.
  if (sourceVersion < toVersion) {
    let current = node;
    for (let v = sourceVersion + 1; v <= toVersion; v++) {
      const migration = RISK_NODE_MIGRATIONS.find((m) => m.version === v);
      if (!migration) {
        // Forward gap — return the node as-is rather than crash readers.
        return current;
      }
      current = migration.up(current);
    }
    return current;
  }

  // Backward path (best-effort). Walk from sourceVersion down to toVersion.
  let current = node;
  for (let v = sourceVersion; v > toVersion; v--) {
    const migration = RISK_NODE_MIGRATIONS.find((m) => m.version === v);
    if (!migration?.down) {
      // No down-migration available — return what we have so far.
      return current;
    }
    current = migration.down(current);
  }
  return current;
}

/**
 * Convenience: returns true if the node's stored schemaVersion lags the
 * current version. Used by lazy-upgrade in UniversalKnowledgeContext to
 * decide whether to enqueue a background persist after applyMigrations.
 */
export function needsUpgrade(node: any, toVersion: number = CURRENT_RISK_NODE_VERSION): boolean {
  if (node == null) return false;
  const v = typeof node.schemaVersion === 'number' ? node.schemaVersion : 0;
  return v < toVersion;
}
