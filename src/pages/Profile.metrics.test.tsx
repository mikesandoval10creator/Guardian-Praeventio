// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const H = vi.hoisted(() => ({
  project: { id: 'project-a' } as { id: string } | null,
  calls: [] as Array<{ path: string | null; constraints: unknown[] }>,
  states: new Map<string | null, { loading: boolean; error: Error | null }>(),
}));

vi.mock('../contexts/FirebaseContext', () => ({
  useFirebase: () => ({
    user: { uid: 'worker-a', displayName: 'Worker', metadata: {} },
    isAdmin: false,
  }),
}));
vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: H.project }),
}));
vi.mock('../hooks/useFirestoreCollection', () => ({
  useFirestoreCollection: (path: string | null, constraints: unknown[] = []) => {
    H.calls.push({ path, constraints });
    const state = H.states.get(path) ?? { loading: false, error: null };
    return { data: [], ...state };
  },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../services/firebase', () => ({ logOut: vi.fn() }));
vi.mock('idb-keyval', () => ({ get: vi.fn(), set: vi.fn() }));
vi.mock('../components/auth/MFASetupModal', () => ({
  MFASetupModal: () => null,
}));
vi.mock('../components/gamification/Medal3DViewer', () => ({
  Medal3DViewer: () => <div data-testid="medal-viewer" />,
}));

import { Profile } from './Profile';

beforeEach(() => {
  H.project = { id: 'project-a' };
  H.calls = [];
  H.states.clear();
});

describe('Profile — project-scoped prevention metrics', () => {
  it('queries canonical project paths and filters top-level collections by projectId', () => {
    render(<Profile />);

    expect(H.calls.map((call) => call.path)).toEqual([
      'training',
      'projects/project-a/safety_posts',
      'nodes',
    ]);
    expect(H.calls[0]?.constraints).toHaveLength(1);
    expect(H.calls[2]?.constraints).toHaveLength(1);
    expect(screen.getByTestId('profile-metrics-ready')).toBeInTheDocument();
  });

  it('does not query any collection when no project is selected', () => {
    H.project = null;
    render(<Profile />);

    expect(H.calls.map((call) => call.path)).toEqual([null, null, null]);
    expect(screen.getByTestId('profile-metrics-no-project')).toBeInTheDocument();
  });

  it('exposes a distinct error state instead of presenting empty metrics as healthy', () => {
    H.states.set('nodes', { loading: false, error: new Error('permission denied') });
    render(<Profile />);

    expect(screen.getByTestId('profile-metrics-error')).toBeInTheDocument();
    expect(screen.queryByTestId('profile-metrics-ready')).not.toBeInTheDocument();
  });
});
