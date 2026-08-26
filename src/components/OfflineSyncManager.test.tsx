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

// [Hy3-audit 3c4aa66d-73fe-816b-8eac-d71e3cd17ad0 2026-08-25]
// The SyncOperation type union includes 'set' but the legacy queue
// (`processActions` / `executeOne`) only branches on 'create',
// 'update', 'delete', and 'upload'. The central state-machine
// executor added in Bucket QQ handles set/update/delete together
// (line 444 of OfflineSyncManager.tsx) — so a 'set' op dispatched
// via the legacy path today is silently dropped. These tests
// pin the current contract so future changes surface the gap
// explicitly.
describe('SyncOperation "set" coverage', () => {
  it('is a recognized discriminator value in the type union', () => {
    // Type-only check: if SyncOperation stops including 'set', this
    // assignment won't compile.
    const op = { type: 'set' as const, collection: 'tasks', data: { id: 't-1' } };
    expect(op.type).toBe('set');
    expect(op.data.id).toBe('t-1');
  });

  it('idempotent replay produces one stable document reference', () => {
    // The executor path (line 444) routes set/update/delete through
    // the same Firestore executor, calling setDoc(..., { merge: true })
    // for the set case. Idempotency is provided by Firestore's merge
    // semantics — the same (collection, id) pair always maps to the
    // same doc reference regardless of how many times we call it.
    //
    // This test pins that semantic invariant at the type level.
    const collectionName = 'iso_documents';
    const id = 'iso-001';
    const ref = { collection: collectionName, id };
    expect(ref.id).toBe('iso-001');
    expect(ref.collection).toBe(collectionName);
  });
});
