// @vitest-environment jsdom
//
// Sprint 29 Bucket DD F-G — CphsModulePageContainer wiring tests.
//
// We mock the FirebaseContext + ProjectContext + the firebase Web SDK
// adapter, then verify that the container drives `cphsService` correctly
// for the load → create → schedule → sign happy path.

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

// Mock the firebase web SDK module — the container imports from it but
// we only care that it's defined (the container's `buildDb` DI override
// bypasses these calls in tests).
vi.mock('../services/firebase', () => ({
  db: {} as any,
  collection: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  addDoc: vi.fn(),
  updateDoc: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
}));

vi.mock('../contexts/FirebaseContext', () => ({
  useFirebase: () => ({ user: { uid: 'admin1' } }),
}));
vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: { id: 'p1' } }),
}));

import { CphsModulePageContainer } from './CphsModule';
import type { MinimalCphsDb } from '../services/cphs/cphsService';

afterEach(() => cleanup());

// In-memory db fake — same shape as cphsService.test.ts
function makeDb(): { db: MinimalCphsDb; stores: Record<string, Map<string, any>> } {
  const stores: Record<string, Map<string, any>> = {
    cphs_committees: new Map(),
    cphs_meetings: new Map(),
  };
  let counter = 0;
  const collection = (name: string): any => {
    if (!stores[name]) stores[name] = new Map();
    const store = stores[name];
    return {
      add: async (data: any) => {
        counter += 1;
        const id = `${name}-${counter}`;
        store.set(id, { ...data, id });
        return { id };
      },
      doc: (id: string) => ({
        get: async () => ({
          exists: store.has(id),
          id,
          data: () => store.get(id),
        }),
        update: async (patch: any) => {
          const existing = store.get(id);
          if (!existing) throw new Error(`doc ${id} not found`);
          store.set(id, { ...existing, ...patch });
        },
      }),
      where: (field: string, op: string, value: any) => ({
        get: async () => {
          if (op !== '==') throw new Error('only == supported');
          const docs = Array.from(store.values())
            .filter((d) => (d as any)[field] === value)
            .map((d) => ({ id: d.id, data: () => d }));
          return { empty: docs.length === 0, docs };
        },
      }),
    };
  };
  return { db: { collection } as MinimalCphsDb, stores };
}

describe('CphsModulePageContainer', () => {
  it('loads committees on mount and renders the empty state when there are none', async () => {
    const { db } = makeDb();
    render(<CphsModulePageContainer buildDb={() => db} />);
    await waitFor(() => {
      expect(screen.getByText(/no hay comités constituidos/i)).toBeTruthy();
    });
  });

  it('loads pre-existing committees from the injected db', async () => {
    const { db, stores } = makeDb();
    stores.cphs_committees.set('c1', {
      id: 'c1',
      projectId: 'p1',
      period: { start: '2026-01-01', end: '2028-01-01' },
      members: [],
      status: 'active',
      iso45001Compliance: true,
      createdAt: '2026-01-01',
      createdBy: 'admin',
    });
    render(<CphsModulePageContainer buildDb={() => db} />);
    await waitFor(() => {
      expect(screen.getByText(/Comités del Proyecto \(1\)/i)).toBeTruthy();
    });
  });

  it('renders the CphsCommitteeStatusCard fed by the real service read-path', async () => {
    // Seed a committee with REAL member composition + a held-but-unsigned
    // meeting + a scheduled one. The container loads them via
    // `cphsService.listCommittees` / `listMeetings` (the Firestore-shaped
    // read-path) and threads the active committee into the status card.
    // Asserting the card's COMPUTED values proves the card is genuinely
    // rendered from live data (anti-phantom-mount, CLAUDE.md #23) — not a
    // hardcoded/empty shell.
    const { db, stores } = makeDb();
    stores.cphs_committees.set('c1', {
      id: 'c1',
      projectId: 'p1',
      period: { start: '2026-01-01', end: '2028-01-01' },
      members: [
        { uid: 'e1', fullName: 'Emp Uno', role: 'chair', side: 'employer', elected: false },
        { uid: 'e2', fullName: 'Emp Dos', role: 'secretary', side: 'employer', elected: false },
        { uid: 'e3', fullName: 'Emp Tres', role: 'representative', side: 'employer', elected: false },
        { uid: 'w1', fullName: 'Trab Uno', role: 'representative', side: 'worker', elected: true },
        { uid: 'w2', fullName: 'Trab Dos', role: 'representative', side: 'worker', elected: true },
        { uid: 'w3', fullName: 'Trab Tres', role: 'representative', side: 'worker', elected: true },
      ],
      status: 'active',
      iso45001Compliance: true,
      createdAt: '2026-01-01',
      createdBy: 'admin1',
    });
    stores.cphs_meetings.set('m1', {
      id: 'm1',
      committeeId: 'c1',
      scheduledAt: '2026-05-15T10:00:00.000Z',
      attendees: ['admin1'],
      agenda: ['x'],
      minutes: 'acta sin firmar',
      resolutions: [],
      signatures: [],
      status: 'held',
    });
    stores.cphs_meetings.set('m2', {
      id: 'm2',
      committeeId: 'c1',
      scheduledAt: '2026-06-15T10:00:00.000Z',
      attendees: [],
      agenda: ['y'],
      resolutions: [],
      signatures: [],
      status: 'scheduled',
    });

    render(<CphsModulePageContainer buildDb={() => db} />);

    const card = await screen.findByTestId('cphs-status-card');
    expect(card).toBeTruthy();
    // 3 employer + 3 worker, computed by the card from the real members.
    expect(screen.getByTestId('cphs-employer-count').textContent).toMatch(/3/);
    expect(screen.getByTestId('cphs-worker-count').textContent).toMatch(/3/);
    // Status badge derived from the seeded committee.
    expect(screen.getByTestId('cphs-status-badge').textContent).toMatch(/active/);
    // 1 scheduled + 1 held-unsigned, both derived from the real
    // `listMeetings` read-path.
    expect(screen.getByTestId('cphs-meetings-scheduled').textContent).toMatch(/1/);
    expect(screen.getByTestId('cphs-meetings-unsigned').textContent).toMatch(/1/);
  });

  it('signMinutes wires the WebAuthn ceremony override end-to-end', async () => {
    // Seed a committee + a held meeting with admin1 in attendees.
    const { db, stores } = makeDb();
    stores.cphs_committees.set('c1', {
      id: 'c1',
      projectId: 'p1',
      period: { start: '2026-01-01', end: '2028-01-01' },
      members: [],
      status: 'active',
      iso45001Compliance: true,
      createdAt: '2026-01-01',
      createdBy: 'admin1',
    });
    stores.cphs_meetings.set('m1', {
      id: 'm1',
      committeeId: 'c1',
      scheduledAt: new Date().toISOString(),
      heldAt: new Date().toISOString(),
      attendees: ['admin1'],
      agenda: ['x'],
      resolutions: [],
      signatures: [],
      status: 'held',
    });
    const ceremony = vi.fn().mockResolvedValue({ credentialId: 'cred-x', signature: 'sig-x' });
    render(
      <CphsModulePageContainer
        buildDb={() => db}
        ceremony={ceremony}
      />,
    );
    // Wait for the meeting to render the sign button
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /firmar acta/i })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: /firmar acta/i }));
    await waitFor(() => expect(ceremony).toHaveBeenCalledWith('m1', 'admin1'));
    // Service should have appended the signature to the in-memory store.
    await waitFor(() => {
      const m = stores.cphs_meetings.get('m1');
      expect(m.signatures).toHaveLength(1);
      expect(m.signatures[0].uid).toBe('admin1');
    });
  });
});
