// Guardian Praeventio — durable emergency delivery outbox (VIDA).
//
// Emergency check-ins, triage and activation are safety evidence. They must not
// rely on a Firestore client write resolving locally: the UI needs a server ACK,
// while a network outage needs durable retention and reconnect recovery.
//
// This is intentionally separate from SosOutbox. The SOS transport has its own
// endpoint/contract; this queue owns the project-scoped emergency state packet.
// Every packet carries a stable clientEventId. The server uses it as the
// idempotency key and as the deterministic event document id.

import {
  GenericOutboxEngine,
  type OutboxAdapter,
  type OutboxEntry,
  type OutboxEvent,
  type OutboxSender,
  type TelemetryEvent,
} from '../sync/genericOutboxEngine';
import { get, set } from 'idb-keyval';
import { apiAuthHeader } from '../../lib/apiAuth';
import { randomId } from '../../utils/randomId';
import { isOnline } from '../../utils/networkStatus';
import { logger } from '../../utils/logger';

export type EmergencyDeliveryOperation =
  | 'checkin'
  | 'triage'
  | 'activation'
  | 'resolution';

export type EmergencyCheckinStatus = 'safe' | 'danger';
export type EmergencyTriageLevel = 'verde' | 'amarillo' | 'rojo';

export interface EmergencyDeliveryPayload {
  operation: EmergencyDeliveryOperation;
  projectId: string;
  workerId?: string;
  status?: EmergencyCheckinStatus;
  triageLevel?: EmergencyTriageLevel;
  emergencyType?: string;
  eventId?: string;
  magnitude?: number;
  epicenter?: string;
  location?: { lat: number; lng: number };
  occurredAt: string;
}

export type EmergencyDeliveryEvent = OutboxEvent<EmergencyDeliveryPayload>;

export interface EmergencyDeliveryAck {
  accepted: boolean;
  persisted: boolean;
  delivered?: boolean;
  serverEventId?: string;
  notified?: number;
  failed?: number;
}

export type EmergencyDeliveryFailureKind =
  | 'network'
  | 'authorization'
  | 'server'
  | 'queue'
  | 'unknown';

export interface EmergencyDeliveryStatus {
  clientEventId: string;
  operation: EmergencyDeliveryOperation;
  projectId: string;
  status: 'pending' | 'accepted' | 'failed';
  queued: boolean;
  failureKind?: EmergencyDeliveryFailureKind;
  error?: string;
  ack?: EmergencyDeliveryAck;
}

export type EmergencyDeliveryAttempt = EmergencyDeliveryStatus;

type StatusListener = (status: EmergencyDeliveryStatus) => void;

const STORAGE_KEY = 'praeventio:emergency-delivery-outbox:v1';

async function loadAll(): Promise<OutboxEntry<EmergencyDeliveryPayload>[]> {
  try {
    const raw = await get<OutboxEntry<EmergencyDeliveryPayload>[]>(STORAGE_KEY);
    return Array.isArray(raw) ? raw : [];
  } catch (err) {
    // Private browsing/quota failure must be visible to telemetry and callers;
    // the emergency UI still remains usable, but the packet cannot be claimed
    // durable until IDB is available again.
    logger.error('emergencyDeliveryOutbox: IndexedDB load failed', { err: String(err) });
    return [];
  }
}

export function createIndexedDbEmergencyDeliveryAdapter(): OutboxAdapter<EmergencyDeliveryPayload> {
  return {
    listEntries: loadAll,
    async saveEntry(entry) {
      const all = await loadAll();
      const index = all.findIndex(
        (candidate) => candidate.event.clientEventId === entry.event.clientEventId,
      );
      if (index >= 0) all[index] = entry;
      else all.push(entry);
      await set(STORAGE_KEY, all);
    },
    async deleteEntry(clientEventId) {
      const all = await loadAll();
      await set(
        STORAGE_KEY,
        all.filter((entry) => entry.event.clientEventId !== clientEventId),
      );
    },
  };
}

const serverAcks = new Map<string, EmergencyDeliveryAck>();

function classifyFailure(error: string | undefined): EmergencyDeliveryFailureKind {
  if (!error) return 'unknown';
  if (/HTTP 4\d\d/i.test(error)) return 'authorization';
  if (/auth_unavailable/i.test(error)) return 'network';
  if (/HTTP 5\d\d/i.test(error)) return 'server';
  if (/network|offline|fetch|timeout|abort|Failed to fetch/i.test(error)) return 'network';
  return 'unknown';
}

/**
 * HTTP transport. Every non-2xx is retained as retry, never permanent_failure:
 * the generic engine would otherwise delete a safety packet. A 403 is surfaced
 * as `failed` by the controller while still retaining the packet for recovery
 * or manual escalation.
 */
export async function sendEmergencyDelivery(
  event: EmergencyDeliveryEvent,
): Promise<{ kind: 'success' | 'retry'; error?: string }> {
  const authHeader = await apiAuthHeader();
  if (!authHeader) return { kind: 'retry', error: 'auth_unavailable' };

  try {
    const abortController = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
    const timeoutId = setTimeout(() => abortController?.abort(), 10_000);
    let response: Response;
    try {
      response = await fetch('/api/emergency/delivery', {
        method: 'POST',
        credentials: 'include',
        signal: abortController?.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
          'Idempotency-Key': event.clientEventId,
        },
        body: JSON.stringify({
          clientEventId: event.clientEventId,
          ...event.payload,
        }),
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (response.ok) {
      let ack: EmergencyDeliveryAck | undefined;
      try {
        ack = (await response.json()) as EmergencyDeliveryAck;
      } catch {
        // A 2xx without JSON is still a server response, but the UI will show
        // accepted without delivery details rather than inventing them.
      }
      if (ack) serverAcks.set(event.clientEventId, ack);
      return { kind: 'success' };
    }
    try {
      await response.text();
    } catch {
      // The HTTP status remains the authoritative retry signal.
    }
    return { kind: 'retry', error: `HTTP ${response.status}` };
  } catch (err) {
    return {
      kind: 'retry',
      error: err instanceof Error ? err.message : 'network_error',
    };
  }
}

export interface EmergencyDeliveryControllerOptions {
  adapter: OutboxAdapter<EmergencyDeliveryPayload>;
  sender?: OutboxSender<EmergencyDeliveryPayload>;
  nowMs?: () => number;
}

export interface EmergencyDeliveryController {
  submit(
    payload: EmergencyDeliveryPayload,
    opts?: { clientEventId?: string },
  ): Promise<EmergencyDeliveryAttempt>;
  flush(): ReturnType<GenericOutboxEngine<EmergencyDeliveryPayload>['flush']>;
  deadLetters(): Promise<OutboxEntry<EmergencyDeliveryPayload>[]>;
  subscribe(clientEventId: string, listener: StatusListener): () => void;
  registerOnReconnect(): void;
}

export function createEmergencyDeliveryController(
  options: EmergencyDeliveryControllerOptions,
): EmergencyDeliveryController {
  const statuses = new Map<string, EmergencyDeliveryStatus>();
  const listeners = new Map<string, Set<StatusListener>>();

  const publish = (status: EmergencyDeliveryStatus): void => {
    statuses.set(status.clientEventId, status);
    for (const listener of listeners.get(status.clientEventId) ?? []) {
      try {
        listener(status);
      } catch {
        // A UI listener cannot break the safety queue.
      }
    }
  };

  const updateFromTelemetry = (telemetry: TelemetryEvent): void => {
    const previous = statuses.get(telemetry.entryId);
    if (!previous) return;

    if (telemetry.kind === 'enqueued') {
      publish({ ...previous, status: 'pending', queued: true });
      return;
    }
    if (telemetry.kind === 'flush_success') {
      publish({
        ...previous,
        status: 'accepted',
        queued: false,
        failureKind: undefined,
        error: undefined,
        ack: serverAcks.get(telemetry.entryId),
      });
      return;
    }
    if (telemetry.kind === 'flush_retry') {
      const failureKind = classifyFailure(telemetry.error);
      publish({
        ...previous,
        status: failureKind === 'authorization' ? 'failed' : 'pending',
        queued: true,
        failureKind,
        error: telemetry.error,
      });
      return;
    }
    if (telemetry.kind === 'dead_lettered') {
      publish({
        ...previous,
        status: 'failed',
        queued: true,
        failureKind: 'server',
        error: previous.error ?? `dead_lettered:${telemetry.reason}`,
      });
      return;
    }
    if (telemetry.kind === 'flush_permanent_failure') {
      publish({
        ...previous,
        status: 'failed',
        queued: true,
        failureKind: 'server',
        error: telemetry.error,
      });
    }
  };

  const outbox = new GenericOutboxEngine<EmergencyDeliveryPayload>({
    adapter: options.adapter,
    sender: options.sender ?? sendEmergencyDelivery,
    maxEntries: 500,
    maxRetries: 20,
    onTelemetry: updateFromTelemetry,
    nowMs: options.nowMs,
  });

  const hydratePersistedEntries = async (): Promise<void> => {
    const entries = await options.adapter.listEntries();
    for (const entry of entries) {
      if (statuses.has(entry.event.clientEventId)) continue;
      publish({
        clientEventId: entry.event.clientEventId,
        operation: entry.event.payload.operation,
        projectId: entry.event.payload.projectId,
        status: entry.deadLettered ? 'failed' : 'pending',
        queued: true,
        ...(entry.lastError ? {
          failureKind: classifyFailure(entry.lastError),
          error: entry.lastError,
        } : {}),
      });
    }
  };

  let reconnectArmed = false;
  const controller: EmergencyDeliveryController = {
    async submit(payload, opts) {
      const clientEventId = opts?.clientEventId ?? `emergency-${randomId()}`;
      publish({
        clientEventId,
        operation: payload.operation,
        projectId: payload.projectId,
        status: 'pending',
        queued: true,
      });

      const queued = await outbox.enqueue({
        clientEventId,
        kind: 'emergency_delivery',
        priority: 'critical',
        payload,
        occurredAt: payload.occurredAt,
      });
      if (!queued) {
        const failed: EmergencyDeliveryStatus = {
          clientEventId,
          operation: payload.operation,
          projectId: payload.projectId,
          status: 'failed',
          queued: false,
          failureKind: 'queue',
          error: 'queue_saturated',
        };
        publish(failed);
        return failed;
      }

      if (isOnline()) {
        try {
          await outbox.flush();
        } catch (err) {
          // The adapter/sender contract should retain the packet; expose a
          // pending state rather than rejecting the emergency interaction.
          publish({
            ...(statuses.get(clientEventId) as EmergencyDeliveryStatus),
            status: 'pending',
            queued: true,
            failureKind: 'network',
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return statuses.get(clientEventId) as EmergencyDeliveryAttempt;
    },

    async flush() {
      await hydratePersistedEntries();
      return outbox.flush();
    },

    deadLetters() {
      return outbox.deadLetters();
    },

    subscribe(clientEventId, listener) {
      let setForId = listeners.get(clientEventId);
      if (!setForId) {
        setForId = new Set<StatusListener>();
        listeners.set(clientEventId, setForId);
      }
      setForId.add(listener);
      const current = statuses.get(clientEventId);
      if (current) listener(current);
      return () => {
        const currentListeners = listeners.get(clientEventId);
        currentListeners?.delete(listener);
        if (currentListeners?.size === 0) listeners.delete(clientEventId);
      };
    },

    registerOnReconnect() {
      if (typeof window === 'undefined' || reconnectArmed) return;
      reconnectArmed = true;
      if (isOnline()) {
        void controller.flush().catch((err) =>
          logger.warn('emergencyDeliveryOutbox: initial flush failed', { err: String(err) }),
        );
      }
      window.addEventListener('online', () => {
        void controller.flush().catch((err) =>
          logger.warn('emergencyDeliveryOutbox: reconnect flush failed', { err: String(err) }),
        );
      });
    },
  };

  return controller;
}

let singleton: EmergencyDeliveryController | null = null;
function productionController(): EmergencyDeliveryController {
  if (!singleton) {
    singleton = createEmergencyDeliveryController({
      adapter: createIndexedDbEmergencyDeliveryAdapter(),
    });
  }
  return singleton;
}

export function submitEmergencyDelivery(
  payload: EmergencyDeliveryPayload,
  opts?: { clientEventId?: string },
): Promise<EmergencyDeliveryAttempt> {
  const controller = productionController();
  controller.registerOnReconnect();
  return controller.submit(payload, opts);
}

export function flushEmergencyDeliveries(): ReturnType<EmergencyDeliveryController['flush']> {
  return productionController().flush();
}

export function getEmergencyDeliveryDeadLetters(): ReturnType<EmergencyDeliveryController['deadLetters']> {
  return productionController().deadLetters();
}

export function subscribeEmergencyDelivery(
  clientEventId: string,
  listener: StatusListener,
): () => void {
  return productionController().subscribe(clientEventId, listener);
}

export function registerEmergencyDeliveryFlushOnReconnect(): void {
  productionController().registerOnReconnect();
}
