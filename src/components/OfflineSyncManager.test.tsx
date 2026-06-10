// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// AUDIT-2026-06 incident regression test — OfflineSyncManager mounts at the
// App() top level, OUTSIDE AppProviders/ProjectProvider (it must run on
// every route, including the anonymous landing). PR #767 made it call the
// throwing useProject() → the hook exploded on every boot, the root
// ErrorBoundary swallowed the whole SPA, and every visitor saw "Sistema
// Interrumpido" from 2026-06-08 until this fix. This test renders the
// component exactly as App() does — with NO ProjectProvider — and pins
// that it mounts cleanly.

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => false }));
vi.mock('../services/offlineStorage', () => ({
  offlineStorage: { getPendingActions: vi.fn(async () => []) },
}));
vi.mock('../services/firebase', () => ({ db: {} }));
vi.mock('../services/sync/conflictResolver', () => ({
  resolveConflict: vi.fn(),
  detectConflict: vi.fn(),
}));
vi.mock('../services/auditService', () => ({ logAuditAction: vi.fn() }));
vi.mock('../lib/apiAuth', () => ({ apiAuthHeader: vi.fn(async () => null) }));
vi.mock('../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { OfflineSyncManager } from './OfflineSyncManager';
import { ProjectProvider } from '../contexts/ProjectContext';

describe('OfflineSyncManager — provider-less mount (the 2026-06-08 outage)', () => {
  it('renders WITHOUT a ProjectProvider without throwing', () => {
    expect(() => render(<OfflineSyncManager />)).not.toThrow();
  });

  it('renders to null (headless manager)', () => {
    const { container } = render(<OfflineSyncManager />);
    expect(container.innerHTML).toBe('');
  });
});
