import { randomId } from '../../utils/randomId';

export const QUEUE_SCHEMA_VERSION = 2 as const;
const INSTALLATION_ID_KEY = 'guardian.offline_queue.installation_id.v1';

export interface QueueIdentity {
  ownerUid: string;
  tenantId: string;
  installationId: string;
  schemaVersion: typeof QUEUE_SCHEMA_VERSION;
}

export type QueueIdentityResolver = () => Promise<QueueIdentity | null>;

export function isQueueIdentity(value: unknown): value is QueueIdentity {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.ownerUid === 'string' && candidate.ownerUid.length > 0 &&
    typeof candidate.tenantId === 'string' && candidate.tenantId.length > 0 &&
    typeof candidate.installationId === 'string' && candidate.installationId.length > 0 &&
    candidate.schemaVersion === QUEUE_SCHEMA_VERSION
  );
}

export function queueIdentitiesMatch(left: QueueIdentity, right: QueueIdentity): boolean {
  return (
    left.ownerUid === right.ownerUid &&
    left.tenantId === right.tenantId &&
    left.installationId === right.installationId &&
    left.schemaVersion === right.schemaVersion
  );
}

export interface QueueIdentityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface QueueAuthUser {
  uid: string;
  getIdTokenResult(): Promise<{ claims: Record<string, unknown> }>;
}

interface QueueIdentityResolverDependencies {
  getCurrentUser: () => QueueAuthUser | null;
  storage?: QueueIdentityStorage;
  createInstallationId?: () => string;
}

let volatileInstallationId: string | null = null;

function createDefaultInstallationId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `installation_${randomId()}`;
}

function browserStorage(): QueueIdentityStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function installationId(
  storage: QueueIdentityStorage | undefined,
  createId: () => string,
): string {
  if (storage) {
    try {
      const existing = storage.getItem(INSTALLATION_ID_KEY);
      if (existing) return existing;
      const created = createId();
      storage.setItem(INSTALLATION_ID_KEY, created);
      return created;
    } catch {
      // A session-only id fails safe after restart: persisted operations will
      // be held on installation mismatch instead of being rebound.
    }
  }
  if (!volatileInstallationId) volatileInstallationId = createId();
  return volatileInstallationId;
}

export function createQueueIdentityResolver(
  dependencies: QueueIdentityResolverDependencies,
): QueueIdentityResolver {
  return async () => {
    const user = dependencies.getCurrentUser();
    if (!user?.uid) return null;

    let claims: Record<string, unknown>;
    try {
      claims = (await user.getIdTokenResult()).claims;
    } catch {
      return null;
    }
    const tenantId = claims.tenantId;
    if (typeof tenantId !== 'string' || tenantId.length === 0) return null;

    return {
      ownerUid: user.uid,
      tenantId,
      installationId: installationId(
        dependencies.storage ?? browserStorage(),
        dependencies.createInstallationId ?? createDefaultInstallationId,
      ),
      schemaVersion: QUEUE_SCHEMA_VERSION,
    };
  };
}

/** Resolve authoritative queue identity from Firebase Auth, never payload data. */
export async function resolveCurrentQueueIdentity(): Promise<QueueIdentity | null> {
  const { auth } = await import('../firebase');
  return createQueueIdentityResolver({
    getCurrentUser: () => auth.currentUser,
  })();
}

/** Test-only reset for the non-browser installation-id fallback. */
export function __resetQueueIdentityForTests(): void {
  volatileInstallationId = null;
}
