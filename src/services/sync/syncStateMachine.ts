import { del, get } from 'idb-keyval';
import { randomId } from '../../utils/randomId';
import { logger } from '../../utils/logger';
import {
  deleteEncrypted,
  getEncrypted,
  setEncrypted,
} from '../security/encryptedKvStore';
import {
  QUEUE_SCHEMA_VERSION,
  resolveCurrentQueueIdentity,
  type QueueIdentity,
  type QueueIdentityResolver,
} from './queueIdentity';

const LEGACY_QUEUE_KEY = 'guardian_offline_sync_v1';
const ENCRYPTED_QUEUE_KEY = 'offline-sync::generic::queue::v2';
const ENCRYPTED_QUARANTINE_KEY = 'offline-sync::generic::quarantine::v1';
const ENCRYPTED_LAST_SUCCESS_KEY = 'offline-sync::generic::last-success::v2';

const DEFAULT_MAX_OPERATIONS = 500;
const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_ATTEMPTS = 6;
const BACKOFF_MS: number[] = [0, 1_000, 5_000, 30_000, 5 * 60_000, 30 * 60_000];

export type SyncState =
  | 'online_synced'
  | 'online_syncing'
  | 'online_failed'
  | 'offline_queued'
  | 'offline_idle'
  | 'reconnecting';

export type SyncQueueClass = 'generic' | 'life_safety';
export type SyncHoldReason = 'identity_mismatch' | 'identity_unavailable';
export type SyncDeadLetterReason = 'max_attempts' | 'retention_expired';

export interface SyncOperation extends QueueIdentity {
  id: string;
  type: 'create' | 'update' | 'delete' | 'set';
  collection: string;
  data: Record<string, unknown>;
  projectId?: string;
  queueClass: SyncQueueClass;
  attempts: number;
  lastAttemptMs?: number;
  lastError?: string;
  createdAt: number;
  deadLettered?: boolean;
  deadLetterReason?: SyncDeadLetterReason;
  holdReason?: SyncHoldReason;
}

export interface LegacyQuarantineRecord {
  id: string;
  source: 'legacy_central_v1' | 'legacy_pending_sync' | 'encrypted_queue_invalid';
  legacyId: string;
  reason: 'missing_identity' | 'invalid_envelope';
  quarantinedAt: number;
  payload: unknown;
}

export interface LegacyQuarantineInput {
  source: LegacyQuarantineRecord['source'];
  legacyId: string;
  payload: unknown;
  reason?: LegacyQuarantineRecord['reason'];
}

export interface SyncQueuePersistence {
  loadOperations(): Promise<unknown>;
  saveOperations(operations: SyncOperation[]): Promise<void>;
  loadQuarantine(): Promise<unknown>;
  saveQuarantine(records: LegacyQuarantineRecord[]): Promise<void>;
  loadLastSuccessMs(): Promise<number | null>;
  saveLastSuccessMs(value: number): Promise<void>;
  loadLegacyOperations(): Promise<unknown>;
  deleteLegacyOperations(): Promise<void>;
  clearAll(): Promise<void>;
}

class EncryptedSyncQueuePersistence implements SyncQueuePersistence {
  loadOperations(): Promise<unknown> {
    return getEncrypted<unknown>(ENCRYPTED_QUEUE_KEY);
  }

  async saveOperations(operations: SyncOperation[]): Promise<void> {
    if (operations.length === 0) {
      await deleteEncrypted(ENCRYPTED_QUEUE_KEY);
      return;
    }
    await setEncrypted(ENCRYPTED_QUEUE_KEY, operations);
  }

  loadQuarantine(): Promise<unknown> {
    return getEncrypted<unknown>(ENCRYPTED_QUARANTINE_KEY);
  }

  async saveQuarantine(records: LegacyQuarantineRecord[]): Promise<void> {
    if (records.length === 0) {
      await deleteEncrypted(ENCRYPTED_QUARANTINE_KEY);
      return;
    }
    await setEncrypted(ENCRYPTED_QUARANTINE_KEY, records);
  }

  async loadLastSuccessMs(): Promise<number | null> {
    const value = await getEncrypted<unknown>(ENCRYPTED_LAST_SUCCESS_KEY);
    return typeof value === 'number' ? value : null;
  }

  saveLastSuccessMs(value: number): Promise<void> {
    return setEncrypted(ENCRYPTED_LAST_SUCCESS_KEY, value);
  }

  loadLegacyOperations(): Promise<unknown> {
    return get<unknown>(LEGACY_QUEUE_KEY);
  }

  deleteLegacyOperations(): Promise<void> {
    return del(LEGACY_QUEUE_KEY);
  }

  async clearAll(): Promise<void> {
    await Promise.all([
      deleteEncrypted(ENCRYPTED_QUEUE_KEY),
      deleteEncrypted(ENCRYPTED_QUARANTINE_KEY),
      deleteEncrypted(ENCRYPTED_LAST_SUCCESS_KEY),
      del(LEGACY_QUEUE_KEY),
    ]);
  }
}

export interface SyncStateSnapshot {
  state: SyncState;
  pendingCount: number;
  operations: SyncOperation[];
  heldCount: number;
  deadLetterCount: number;
  quarantineCount: number;
  lastSyncSuccessMs: number | null;
  isOnline: boolean;
}

export type SyncExecutor = (op: SyncOperation) => Promise<void>;

export interface OfflineSyncStateMachineOptions {
  persistence?: SyncQueuePersistence;
  identityResolver?: QueueIdentityResolver;
  nowMs?: () => number;
  maxOperations?: number;
  retentionMs?: number;
}

export interface EnqueueSyncOperation {
  type: SyncOperation['type'];
  collection: string;
  data: Record<string, unknown>;
  projectId?: string;
  queueClass?: SyncQueueClass;
}

function getBackoffMs(attempts: number): number {
  if (attempts <= 0) return 0;
  if (attempts >= BACKOFF_MS.length) return BACKOFF_MS[BACKOFF_MS.length - 1];
  return BACKOFF_MS[attempts];
}

function recordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isQueueIdentity(value: unknown): value is QueueIdentity {
  if (!recordValue(value)) return false;
  return (
    typeof value.ownerUid === 'string' &&
    value.ownerUid.length > 0 &&
    typeof value.tenantId === 'string' &&
    value.tenantId.length > 0 &&
    typeof value.installationId === 'string' &&
    value.installationId.length > 0 &&
    value.schemaVersion === QUEUE_SCHEMA_VERSION
  );
}

function isSyncOperation(value: unknown): value is SyncOperation {
  if (!recordValue(value) || !isQueueIdentity(value)) return false;
  return (
    typeof value.id === 'string' &&
    (value.type === 'create' || value.type === 'update' || value.type === 'delete' || value.type === 'set') &&
    typeof value.collection === 'string' &&
    recordValue(value.data) &&
    (value.queueClass === 'generic' || value.queueClass === 'life_safety') &&
    typeof value.attempts === 'number' &&
    typeof value.createdAt === 'number'
  );
}

function dedupeKey(op: {
  collection: string;
  data: Record<string, unknown>;
  type: string;
  id?: string;
  ownerUid?: string;
  tenantId?: string;
  installationId?: string;
  projectId?: string;
}): string {
  const dataId = op.data.id ?? op.data.docId;
  const explicitId = typeof dataId === 'string' || typeof dataId === 'number' ? String(dataId) : '';
  const operationId = explicitId || `__idless__:${op.id ?? ''}`;
  return [
    op.ownerUid ?? '',
    op.tenantId ?? '',
    op.installationId ?? '',
    op.projectId ?? '',
    op.collection,
    op.type,
    operationId,
  ].join(':');
}

function makeOpId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `op_${Date.now().toString(36)}_${randomId()}`;
}

function identitiesMatch(operation: SyncOperation, current: QueueIdentity): boolean {
  return (
    operation.ownerUid === current.ownerUid &&
    operation.tenantId === current.tenantId &&
    operation.installationId === current.installationId &&
    operation.schemaVersion === current.schemaVersion
  );
}

function legacyId(value: unknown, index: number): string {
  if (recordValue(value) && (typeof value.id === 'string' || typeof value.id === 'number')) {
    return String(value.id);
  }
  return `index-${index}`;
}

export class OfflineSyncStateMachine {
  private operations = new Map<string, SyncOperation>();
  private quarantine = new Map<string, LegacyQuarantineRecord>();
  private listeners = new Set<(snap: SyncStateSnapshot) => void>();
  private isSyncing = false;
  private hasFailures = false;
  private lastSyncSuccessMs: number | null = null;
  private executor: SyncExecutor = async () => {
    throw new Error('OfflineSyncStateMachine: no executor wired');
  };
  private onlineGetter: () => boolean = () =>
    typeof navigator !== 'undefined' ? navigator.onLine : true;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly persistence: SyncQueuePersistence;
  private readonly identityResolver: QueueIdentityResolver;
  private readonly nowMs: () => number;
  private readonly maxOperations: number;
  private readonly retentionMs: number;
  private readonly readyPromise: Promise<void>;

  constructor(options: OfflineSyncStateMachineOptions = {}) {
    this.persistence = options.persistence ?? new EncryptedSyncQueuePersistence();
    this.identityResolver = options.identityResolver ?? resolveCurrentQueueIdentity;
    this.nowMs = options.nowMs ?? Date.now;
    this.maxOperations = options.maxOperations ?? DEFAULT_MAX_OPERATIONS;
    this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
    this.readyPromise = this.hydrate();
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
    }
  }

  private handleOnline = () => {
    logger.info('offlineSync: online event — draining queue');
    this.notify();
    void this.syncNow();
  };

  private handleOffline = () => {
    logger.info('offlineSync: offline event');
    this.notify();
  };

  private makeQuarantineRecord(input: LegacyQuarantineInput): LegacyQuarantineRecord {
    return {
      id: `${input.source}:${input.legacyId}`,
      source: input.source,
      legacyId: input.legacyId,
      reason: input.reason ?? 'missing_identity',
      quarantinedAt: this.nowMs(),
      payload: input.payload,
    };
  }

  private async addQuarantineRecords(records: LegacyQuarantineRecord[]): Promise<void> {
    const next = new Map(this.quarantine);
    for (const record of records) next.set(record.id, record);
    const values = Array.from(next.values());
    JSON.stringify(values);
    await this.persistence.saveQuarantine(values);
    this.quarantine = next;
  }

  private async hydrate(): Promise<void> {
    try {
      const storedQuarantine = await this.persistence.loadQuarantine();
      if (Array.isArray(storedQuarantine)) {
        for (const item of storedQuarantine) {
          if (recordValue(item) && typeof item.id === 'string') {
            this.quarantine.set(item.id, item as unknown as LegacyQuarantineRecord);
          }
        }
      }

      const storedOperations = await this.persistence.loadOperations();
      if (Array.isArray(storedOperations)) {
        const invalid: LegacyQuarantineRecord[] = [];
        storedOperations.forEach((operation, index) => {
          if (isSyncOperation(operation)) this.operations.set(operation.id, operation);
          else {
            invalid.push(this.makeQuarantineRecord({
              source: 'encrypted_queue_invalid',
              legacyId: legacyId(operation, index),
              reason: 'invalid_envelope',
              payload: operation,
            }));
          }
        });
        if (invalid.length > 0) {
          await this.addQuarantineRecords(invalid);
          await this.persistence.saveOperations(Array.from(this.operations.values()));
        }
      }

      const legacy = await this.persistence.loadLegacyOperations();
      if (legacy !== null && legacy !== undefined) {
        const legacyItems = Array.isArray(legacy) ? legacy : [legacy];
        const records = legacyItems.map((operation, index) =>
          this.makeQuarantineRecord({
            source: 'legacy_central_v1',
            legacyId: legacyId(operation, index),
            payload: operation,
          }),
        );
        await this.addQuarantineRecords(records);
        await this.persistence.deleteLegacyOperations();
      }

      this.lastSyncSuccessMs = await this.persistence.loadLastSuccessMs();
    } catch (error) {
      logger.error('offlineSync: hydrate failed', error);
    }
    this.notify();
  }

  ready(): Promise<void> {
    return this.readyPromise;
  }

  setExecutor(fn: SyncExecutor): void {
    this.executor = fn;
  }

  setOnlineGetter(fn: () => boolean): void {
    this.onlineGetter = fn;
  }

  private persistOperations(): Promise<void> {
    return this.persistence.saveOperations(Array.from(this.operations.values()));
  }

  private pendingOps(): SyncOperation[] {
    return Array.from(this.operations.values()).filter(
      (operation) => !operation.deadLettered && !operation.holdReason,
    );
  }

  getState(): SyncStateSnapshot {
    const isOnline = this.onlineGetter();
    const pending = this.pendingOps();
    const heldCount = this.heldOperations().length;
    const deadLetterCount = this.deadLetters().length;
    let state: SyncState;
    if (this.isSyncing) state = 'online_syncing';
    else if (!isOnline) state = pending.length > 0 ? 'offline_queued' : 'offline_idle';
    else if (this.hasFailures && pending.length > 0) state = 'online_failed';
    else if (pending.length === 0) state = 'online_synced';
    else state = 'reconnecting';
    return {
      state,
      pendingCount: pending.length,
      operations: pending,
      heldCount,
      deadLetterCount,
      quarantineCount: this.quarantine.size,
      lastSyncSuccessMs: this.lastSyncSuccessMs,
      isOnline,
    };
  }

  deadLetters(): SyncOperation[] {
    return Array.from(this.operations.values()).filter((operation) => operation.deadLettered);
  }

  heldOperations(): SyncOperation[] {
    return Array.from(this.operations.values()).filter((operation) => Boolean(operation.holdReason));
  }

  quarantinedEntries(): LegacyQuarantineRecord[] {
    return Array.from(this.quarantine.values());
  }

  async quarantineLegacyOperation(input: LegacyQuarantineInput): Promise<void> {
    await this.readyPromise;
    await this.addQuarantineRecords([this.makeQuarantineRecord(input)]);
    this.notify();
  }

  async clearDeadLetter(id: string): Promise<void> {
    await this.readyPromise;
    const operation = this.operations.get(id);
    if (operation?.deadLettered) {
      this.operations.delete(id);
      await this.persistOperations();
      this.notify();
    }
  }

  subscribe(cb: (snap: SyncStateSnapshot) => void): () => void {
    this.listeners.add(cb);
    try {
      cb(this.getState());
    } catch (error) {
      logger.error('offlineSync: subscriber threw on initial fire', error);
    }
    return () => this.listeners.delete(cb);
  }

  private notify(): void {
    const snapshot = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        logger.error('offlineSync: listener threw', error);
      }
    }
  }

  async enqueue(input: EnqueueSyncOperation): Promise<string> {
    await this.readyPromise;
    const identity = await this.identityResolver();
    if (!identity) {
      throw new Error('OfflineSyncStateMachine: authenticated queue identity unavailable');
    }
    const candidateId = makeOpId();
    const operationShape = { ...input, ...identity, id: candidateId };
    const key = dedupeKey(operationShape);
    const existing = Array.from(this.operations.values()).find(
      (operation) => dedupeKey(operation) === key,
    );
    if (!existing && this.operations.size >= this.maxOperations) {
      throw new Error(`OfflineSyncStateMachine: queue capacity ${this.maxOperations} reached`);
    }

    const id = existing?.id ?? candidateId;
    const next: SyncOperation = {
      id,
      type: input.type,
      collection: input.collection,
      data: input.data,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      queueClass: input.queueClass ?? 'generic',
      ...identity,
      attempts: 0,
      createdAt: this.nowMs(),
    };
    const previous = this.operations.get(id);
    this.operations.set(id, next);
    try {
      await this.persistOperations();
    } catch (error) {
      if (previous) this.operations.set(id, previous);
      else this.operations.delete(id);
      throw error;
    }
    this.notify();
    if (this.onlineGetter()) void this.syncNow();
    return id;
  }

  async syncNow(): Promise<{ succeeded: number; failed: number; held: number }> {
    await this.readyPromise;
    if (this.isSyncing || !this.onlineGetter()) return { succeeded: 0, failed: 0, held: 0 };
    if (this.operations.size === 0) {
      this.hasFailures = false;
      this.notify();
      return { succeeded: 0, failed: 0, held: 0 };
    }

    this.isSyncing = true;
    this.notify();
    let succeeded = 0;
    let failed = 0;
    let held = 0;
    const now = this.nowMs();
    const currentIdentity = await this.identityResolver();
    const operations = Array.from(this.operations.values());

    for (const original of operations) {
      if (original.deadLettered) continue;
      if (!currentIdentity) {
        this.operations.set(original.id, { ...original, holdReason: 'identity_unavailable' });
        held += 1;
        continue;
      }
      if (!identitiesMatch(original, currentIdentity)) {
        this.operations.set(original.id, { ...original, holdReason: 'identity_mismatch' });
        held += 1;
        continue;
      }

      const operation = original.holdReason
        ? { ...original, holdReason: undefined }
        : original;
      this.operations.set(operation.id, operation);

      if (
        operation.queueClass === 'generic' &&
        now - operation.createdAt > this.retentionMs
      ) {
        this.operations.set(operation.id, {
          ...operation,
          deadLettered: true,
          deadLetterReason: 'retention_expired',
          lastError: 'retention_expired',
        });
        continue;
      }
      if (operation.lastAttemptMs && operation.attempts > 0) {
        const wait = getBackoffMs(operation.attempts);
        if (now - operation.lastAttemptMs < wait) continue;
      }

      try {
        await this.executor(operation);
        this.operations.delete(operation.id);
        succeeded += 1;
      } catch (error) {
        const updated: SyncOperation = {
          ...operation,
          attempts: operation.attempts + 1,
          lastAttemptMs: this.nowMs(),
          lastError: error instanceof Error ? error.message : String(error),
        };
        if (updated.attempts >= MAX_ATTEMPTS) {
          this.operations.set(operation.id, {
            ...updated,
            deadLettered: true,
            deadLetterReason: 'max_attempts',
          });
          logger.error('offlineSync: op exceeded MAX_ATTEMPTS — dead-lettering', {
            opId: operation.id,
            collection: operation.collection,
            type: operation.type,
          });
        } else this.operations.set(operation.id, updated);
        failed += 1;
      }
    }

    this.hasFailures = failed > 0;
    const pending = this.pendingOps();
    if (succeeded > 0 && pending.length === 0 && failed === 0) {
      this.lastSyncSuccessMs = this.nowMs();
      await this.persistence.saveLastSuccessMs(this.lastSyncSuccessMs);
    }
    await this.persistOperations();
    this.isSyncing = false;
    this.notify();

    if (pending.length > 0) {
      const timerNow = this.nowMs();
      let minWait = Infinity;
      for (const operation of pending) {
        const due = (operation.lastAttemptMs ?? timerNow) + getBackoffMs(operation.attempts);
        minWait = Math.min(minWait, Math.max(0, due - timerNow));
      }
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        void this.syncNow();
      }, Math.max(Number.isFinite(minWait) ? minWait : 30_000, 250));
    }
    return { succeeded, failed, held };
  }

  async clearQueue(): Promise<void> {
    await this.readyPromise;
    this.operations.clear();
    this.hasFailures = false;
    await this.persistOperations();
    this.notify();
  }

  /** Explicit auth-lifecycle policy: purge only this generic queue namespace. */
  async purgeForLogout(): Promise<void> {
    await this.readyPromise;
    this.operations.clear();
    this.quarantine.clear();
    this.hasFailures = false;
    this.lastSyncSuccessMs = null;
    await this.persistence.clearAll();
    this.notify();
  }

  _dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
    }
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.listeners.clear();
    this.operations.clear();
    this.quarantine.clear();
    this.isSyncing = false;
    this.hasFailures = false;
    this.lastSyncSuccessMs = null;
  }
}

export const offlineSync = new OfflineSyncStateMachine();

export const _internal = {
  getBackoffMs,
  dedupeKey,
  MAX_ATTEMPTS,
  BACKOFF_MS,
  DEFAULT_MAX_OPERATIONS,
  DEFAULT_RETENTION_MS,
};
