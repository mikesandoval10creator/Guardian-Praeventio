// @vitest-environment jsdom
//
// B.3 (VIDA) — EmergenciaAvanzada surfaces worker SOS alerts.
//
// The SOS server route writes tenants/{tenantId}/emergency_alerts (Admin SDK;
// tenantId = projects/{pid}.tenantId || pid) but no dashboard ever subscribed:
// a worker's SOS reached Firestore and stayed invisible. This suite pins:
//   1. the dashboard subscribes to tenants/{project.tenantId}/emergency_alerts.
//   2. tenantId falls back to projectId (server parity) when the project has
//      no tenantId field.
//   3. alerts pushed by the subscription render the banner (count + rows +
//      Google Maps link from geo).
//   4. stale alerts (> 24 h) are filtered out; empty feed hides the banner.
//
// Hermetic: mocks react-i18next, framer-motion, contexts, hooks and the
// firebase service module (onSnapshot handlers captured per collection path).
//
// NOTE (merge 2026-07-02): the de-fabrication suite for this same page lives
// in EmergenciaAvanzada.defabrication.test.tsx — the two suites need
// incompatible hermetic mock sets (this one mocks react-i18next and captures
// onNext by path; that one uses real i18n and captures onError callbacks), so
// they are kept as separate files on purpose.

import type { ReactNode, HTMLAttributes } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string) => (typeof fallback === 'string' ? fallback : _k),
  }),
}));

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
  motion: {
    div: (props: { children?: ReactNode } & Record<string, unknown>) => {
      const { children, initial: _i, animate: _a, exit: _e, ...rest } = props;
      return <div {...(rest as HTMLAttributes<HTMLDivElement>)}>{children}</div>;
    },
  },
}));

let mockProject: { id: string; name: string; tenantId?: string; country?: string } | null = null;
vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockProject }),
}));
vi.mock('../contexts/FirebaseContext', () => ({
  useFirebase: () => ({ user: { uid: 'u1', email: 'u1@test.com' }, isAdmin: true }),
}));

// Deep-link plumbing: configurable ?query and a neutralized realignment hook
// (its own logic is unit-tested in useDeepLinkProjectSync.test).
let mockSearchParams = new URLSearchParams('');
vi.mock('react-router-dom', () => ({
  useSearchParams: () => [mockSearchParams],
}));
vi.mock('../hooks/useDeepLinkProjectSync', () => ({
  useDeepLinkProjectSync: () => ({ status: 'idle', targetProjectId: null }),
}));

vi.mock('../hooks/useAcousticSOS', () => ({
  useAcousticSOS: () => ({ isActive: false, start: vi.fn(), stop: vi.fn() }),
}));
vi.mock('../hooks/useSeismicMonitor', () => ({
  useSeismicMonitor: () => ({ earthquakes: [], criticalAlert: null }),
}));
vi.mock('../hooks/useFirestoreCollection', () => ({
  useFirestoreCollection: () => ({ data: [] }),
}));

vi.mock('../components/shared/Card', () => ({
  Card: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));
vi.mock('../components/shared/Tooltip', () => ({
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('../components/shared/ConfirmDialog', () => ({
  ConfirmDialog: () => null,
}));
vi.mock('../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// firebase service: capture each onSnapshot handler by its collection path.
type SnapDoc = { id: string; data: () => Record<string, unknown> };
type FakeSnap = { docs: SnapDoc[] };
const snapshotHandlers = new Map<string, (snap: FakeSnap) => void>();
vi.mock('../services/firebase', () => ({
  db: {},
  serverTimestamp: () => ({ __serverTimestamp: true }),
  collection: (_db: unknown, path: string) => ({ __path: path }),
  query: (col: { __path: string }, ..._constraints: unknown[]) => ({ __path: col.__path }),
  where: (...args: unknown[]) => ({ __where: args }),
  orderBy: (...args: unknown[]) => ({ __orderBy: args }),
  limit: (n: number) => ({ __limit: n }),
  doc: (_db: unknown, path: string, id?: string) => ({ __path: id ? `${path}/${id}` : path }),
  addDoc: vi.fn(async () => ({ id: 'new-doc' })),
  updateDoc: vi.fn(async () => undefined),
  setDoc: vi.fn(async () => undefined),
  onSnapshot: (
    q: { __path: string },
    onNext: (snap: FakeSnap) => void,
    _onError?: (err: unknown) => void,
  ) => {
    snapshotHandlers.set(q.__path, onNext);
    return () => snapshotHandlers.delete(q.__path);
  },
}));

import { EmergenciaAvanzada } from './EmergenciaAvanzada';

const sosDoc = (
  id: string,
  overrides: Record<string, unknown> = {},
): SnapDoc => ({
  id,
  data: () => ({
    type: 'sos',
    uid: `worker-${id}`,
    userEmail: `${id}@faena.cl`,
    projectId: 'p1',
    geo: { lat: -33.45, lng: -70.66 },
    clientTimestamp: null,
    createdAt: { toMillis: () => Date.now() - 60_000 },
    ...overrides,
  }),
});

beforeEach(() => {
  snapshotHandlers.clear();
  mockProject = { id: 'p1', name: 'Faena Norte', tenantId: 'tA' };
  mockSearchParams = new URLSearchParams('');
  // jsdom doesn't implement scrollIntoView; the deep-link focus effect calls it.
  Element.prototype.scrollIntoView = vi.fn();
});

describe('<EmergenciaAvanzada /> — SOS de trabajadores (B.3 VIDA)', () => {
  it('subscribes to tenants/{project.tenantId}/emergency_alerts', () => {
    render(<EmergenciaAvanzada />);
    expect(snapshotHandlers.has('tenants/tA/emergency_alerts')).toBe(true);
  });

  it('falls back to projectId as tenantId when the project has none (server parity)', () => {
    mockProject = { id: 'p1', name: 'Faena Norte' };
    render(<EmergenciaAvanzada />);
    expect(snapshotHandlers.has('tenants/p1/emergency_alerts')).toBe(true);
  });

  it('renders the SOS banner with count, rows and the Maps link', () => {
    render(<EmergenciaAvanzada />);
    const push = snapshotHandlers.get('tenants/tA/emergency_alerts');
    expect(push).toBeDefined();

    act(() => push!({ docs: [sosDoc('a1'), sosDoc('a2', { geo: null })] }));

    expect(screen.getByTestId('sos-alerts-banner')).toBeInTheDocument();
    expect(screen.getByTestId('sos-alerts-count').textContent).toBe('2');
    expect(screen.getAllByTestId('sos-alert-row')).toHaveLength(2);
    expect(screen.getByText('a1@faena.cl')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Ver ubicación' }) as HTMLAnchorElement;
    expect(link.href).toContain('google.com/maps?q=-33.45,-70.66');
  });

  it('highlights the deep-linked SOS row when arrived from a push (?alertId)', () => {
    mockSearchParams = new URLSearchParams('alertId=a2&source=push');
    render(<EmergenciaAvanzada />);
    const push = snapshotHandlers.get('tenants/tA/emergency_alerts');
    act(() => push!({ docs: [sosDoc('a1'), sosDoc('a2', { geo: null })] }));

    const focused = screen
      .getAllByTestId('sos-alert-row')
      .filter((r) => r.getAttribute('data-focused') === 'true');
    expect(focused).toHaveLength(1);
    expect(focused[0].textContent).toContain('a2@faena.cl');
  });

  it('filters stale alerts (>24 h) and hides the banner when nothing is recent', () => {
    render(<EmergenciaAvanzada />);
    const push = snapshotHandlers.get('tenants/tA/emergency_alerts');

    act(() =>
      push!({
        docs: [sosDoc('old', { createdAt: { toMillis: () => Date.now() - 25 * 60 * 60 * 1000 } })],
      }),
    );
    expect(screen.queryByTestId('sos-alerts-banner')).not.toBeInTheDocument();

    act(() => push!({ docs: [] }));
    expect(screen.queryByTestId('sos-alerts-banner')).not.toBeInTheDocument();
  });

  it('shows one-tap authority numbers on the emergency dashboard (region from project)', () => {
    mockProject = { id: 'p1', name: 'Faena Norte', tenantId: 'tA', country: 'CL' };
    render(<EmergenciaAvanzada />);
    const panel = screen.getByTestId('emergency-authority-panel');
    const hrefs = Array.from(panel.querySelectorAll('a[href^="tel:"]')).map((a) =>
      a.getAttribute('href'),
    );
    expect(hrefs).toContain('tel:131');
    expect(hrefs).toContain('tel:132');
    expect(hrefs).toContain('tel:133');
  });
});
