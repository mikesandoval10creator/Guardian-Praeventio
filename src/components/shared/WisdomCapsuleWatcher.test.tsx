// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => ({
  useWisdomCapsules: vi.fn(),
  useProject: vi.fn(),
  useTenantId: vi.fn(),
}));

vi.mock('../../hooks/useWisdomCapsules', () => ({
  useWisdomCapsules: H.useWisdomCapsules,
}));
vi.mock('../../contexts/ProjectContext', () => ({ useProject: H.useProject }));
vi.mock('../../hooks/useTenantId', () => ({ useTenantId: H.useTenantId }));
vi.mock('./WisdomCapsule', () => ({
  WisdomCapsule: ({ capsule }: { capsule: { id: string } }) => (
    <div data-testid="mock-wisdom-capsule">{capsule.id}</div>
  ),
}));

import { WisdomCapsuleWatcher } from './WisdomCapsuleWatcher';

const capsule = {
  id: 'capsule-a',
  title: 'Title',
  content: 'Content',
  lat: -33.45,
  lng: -70.66,
  radius: 50,
};

describe('WisdomCapsuleWatcher scope wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    H.useProject.mockReturnValue({ selectedProject: { id: 'project-a' } });
    H.useTenantId.mockReturnValue({ tenantId: 'tenant-a', loading: false });
    H.useWisdomCapsules.mockReturnValue({ nearbyCapsule: capsule, capsules: [capsule] });
  });

  it('passes selected project and verified tenant scope to the hook', () => {
    render(<WisdomCapsuleWatcher />);
    expect(H.useWisdomCapsules).toHaveBeenCalledWith({
      projectId: 'project-a',
      tenantId: 'tenant-a',
    });
    expect(document.querySelector('[data-testid="mock-wisdom-capsule"]')?.textContent).toBe(
      'capsule-a',
    );
  });

  it('renders no capsule while project or tenant scope is absent', () => {
    H.useProject.mockReturnValue({ selectedProject: null });
    H.useTenantId.mockReturnValue({ tenantId: null, loading: false });
    render(<WisdomCapsuleWatcher />);
    expect(H.useWisdomCapsules).toHaveBeenCalledWith({ projectId: null, tenantId: null });
    expect(document.querySelector('[data-testid="mock-wisdom-capsule"]')).toBeNull();
  });
});
