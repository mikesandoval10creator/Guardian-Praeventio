// @vitest-environment jsdom
//
// SystemEngine — provider project re-scope (A4 remediation).
//
// The provider used to feed only `tenantId` into `useSystemEvent`, which
// keyed the (dead) `tenants/{tid}/system_events` subscription. Pins the
// re-scope: the provider passes the SELECTED PROJECT id (the app's real
// tenancy unit) so the bus subscription follows `projects/{pid}`.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

const H = vi.hoisted(() => ({
  useSystemEvent: vi.fn(),
  selectedProject: { id: 'p77', name: 'Faena Norte' } as { id: string } | null,
}));

vi.mock('./EmergencyContext', () => ({
  useEmergency: () => ({ triggerEmergency: vi.fn(), isEmergencyActive: false }),
}));
vi.mock('./NotificationContext', () => ({
  useNotifications: () => ({ addNotification: vi.fn() }),
}));
vi.mock('./SubscriptionContext', () => ({
  useSubscription: () => ({ plan: 'free' }),
}));
vi.mock('./FirebaseContext', () => ({
  useFirebase: () => ({ user: { uid: 'u1' } }),
}));
vi.mock('./ProjectContext', () => ({
  useProject: () => ({ selectedProject: H.selectedProject }),
}));
vi.mock('../services/systemEngine/adapters/emergencyContextAdapter', () => ({
  useEmergencyContextAdapter: vi.fn(),
}));
vi.mock('../services/systemEngine/adapters/sensorContextAdapter', () => ({
  useSensorContextAdapter: vi.fn(),
}));
vi.mock('../services/systemEngine/adapters/subscriptionContextAdapter', () => ({
  useSubscriptionContextAdapter: vi.fn(),
}));
vi.mock('../services/systemEngine/subscriber', () => ({
  useSystemEvent: H.useSystemEvent,
}));
vi.mock('../services/systemEngine/eventLog', () => ({
  emit: vi.fn(async () => ({ ok: true })),
  drainOutbox: vi.fn(async () => ({ drained: 0, failed: 0 })),
  onLocalEmit: vi.fn(() => () => undefined),
}));
vi.mock('../services/auditService', () => ({
  logAuditAction: vi.fn(async () => undefined),
}));
vi.mock('../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  SystemEngineProvider,
  __resetSystemEngineProviderForTests,
} from './SystemEngineProvider';

beforeEach(() => {
  __resetSystemEngineProviderForTests();
  H.useSystemEvent.mockClear();
  H.selectedProject = { id: 'p77' };
});

describe('SystemEngineProvider — project scoping', () => {
  it('passes the selected project id into the bus subscription filter', () => {
    render(
      <SystemEngineProvider tenantId="default" enabled>
        <div data-testid="child" />
      </SystemEngineProvider>,
    );

    expect(H.useSystemEvent).toHaveBeenCalled();
    const filter = H.useSystemEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(filter.projectId).toBe('p77');
    expect(filter.tenantId).toBe('default');
  });

  it('passes no projectId when no project is selected (engine stays local-only)', () => {
    H.selectedProject = null;
    render(
      <SystemEngineProvider tenantId="default" enabled>
        <div />
      </SystemEngineProvider>,
    );

    const filter = H.useSystemEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(filter.projectId).toBeUndefined();
  });
});
