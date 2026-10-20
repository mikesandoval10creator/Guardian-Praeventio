// @vitest-environment jsdom
//
// Regression: the maintenance-completion form must never fabricate a
// `local-<id>-<ts>` biometric fingerprint. It persists the server-verifiable
// SHA-256 commitment emitted by /api/auth/webauthn/verify when available, and
// otherwise sends NO hash at all (honest absence, e.g. the native plugin path
// which proves presence locally but yields no server-verifiable assertion).

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const h = vi.hoisted(() => ({
  authenticate: vi.fn(async () => true),
  getLastSignatureHash: vi.fn((): string | null => null),
  complete: vi.fn(),
}));

vi.mock('../../hooks/useBiometricAuth', () => ({
  useBiometricAuth: () => ({
    isSupported: true,
    authenticate: h.authenticate,
    getLastSignatureHash: h.getLastSignatureHash,
  }),
}));

vi.mock('../../hooks/useHorometro', () => ({
  completeMaintenanceTaskRequest: (...args: unknown[]) => h.complete(...args),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { MaintenanceCompleteForm } from './MaintenanceCompleteForm';

const TASK = {
  id: 'task-1',
  equipmentId: 'eq-1',
  equipmentType: 'Camion',
  thresholdHours: 250,
  multiplier: 1,
  status: 'due' as const,
  triggeredAtHours: 100,
} as unknown as Parameters<typeof MaintenanceCompleteForm>[0]['task'];

function setup(): void {
  h.complete.mockResolvedValue({
    task: { ...TASK, completion: {} },
    flow: { ok: true },
  });
  render(
    <MaintenanceCompleteForm
      projectId="p1"
      task={TASK}
      generateIdempotencyKey={() => 'idem-1'}
    />,
  );
  fireEvent.change(screen.getByTestId('maintenance-complete-notes'), {
    target: { value: 'Cambio de filtro y revision general del equipo.' },
  });
}

beforeEach(() => {
  h.authenticate.mockReset().mockResolvedValue(true);
  h.getLastSignatureHash.mockReset().mockReturnValue(null);
  h.complete.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('MaintenanceCompleteForm — biometric evidence honesty', () => {
  it('sends the server-issued signatureHash when the hook exposes one', async () => {
    const realHash = 'a'.repeat(64);
    h.getLastSignatureHash.mockReturnValue(realHash);
    setup();

    fireEvent.click(screen.getByTestId('maintenance-complete-submit'));

    await waitFor(() => expect(h.complete).toHaveBeenCalledTimes(1));
    const body = h.complete.mock.calls[0][2] as { biometricSignatureHash?: string };
    expect(body.biometricSignatureHash).toBe(realHash);
  });

  it('sends NO hash (never a fabricated one) when the hook has none', async () => {
    h.getLastSignatureHash.mockReturnValue(null);
    setup();

    fireEvent.click(screen.getByTestId('maintenance-complete-submit'));

    await waitFor(() => expect(h.complete).toHaveBeenCalledTimes(1));
    const body = h.complete.mock.calls[0][2] as { biometricSignatureHash?: string };
    expect(body.biometricSignatureHash).toBeUndefined();
    // The old bug persisted a fake fingerprint as if it were legal evidence.
    expect(JSON.stringify(h.complete.mock.calls[0][2])).not.toContain('local-');
  });
});
