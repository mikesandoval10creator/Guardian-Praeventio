// @vitest-environment jsdom
//
// [P1][VIDA] Project realignment for push deep links.

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

// Controllable mocks for the two dependencies.
let mockSearch = '';
const setSelectedProject = vi.fn();
let mockProjects: Array<{ id: string }> = [];
let mockSelectedId: string | null = null;

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(mockSearch)],
}));

vi.mock('../contexts/ProjectContext', () => ({
  useProjectOptional: () => ({
    projects: mockProjects,
    selectedProject: mockSelectedId ? { id: mockSelectedId } : null,
    setSelectedProject,
  }),
}));

import { useDeepLinkProjectSync } from './useDeepLinkProjectSync';

function Probe({ onStatus }: { onStatus: (s: string) => void }) {
  const { status } = useDeepLinkProjectSync();
  onStatus(status);
  return null;
}

function renderWith(search: string, projects: Array<{ id: string }>, selectedId: string | null) {
  mockSearch = search;
  mockProjects = projects;
  mockSelectedId = selectedId;
  let last = '';
  act(() => {
    render(<Probe onStatus={(s) => (last = s)} />);
  });
  return () => last;
}

afterEach(() => {
  cleanup();
  setSelectedProject.mockReset();
  mockSearch = '';
  mockProjects = [];
  mockSelectedId = null;
});

describe('useDeepLinkProjectSync', () => {
  it('does nothing for non-push navigation even if projectId is present', () => {
    const status = renderWith('?projectId=p2', [{ id: 'p1' }, { id: 'p2' }], 'p1');
    expect(setSelectedProject).not.toHaveBeenCalled();
    expect(status()).toBe('idle');
  });

  it('selects the payload project when it differs from the active one', () => {
    const status = renderWith('?projectId=p2&source=push', [{ id: 'p1' }, { id: 'p2' }], 'p1');
    expect(setSelectedProject).toHaveBeenCalledWith({ id: 'p2' });
    expect(status()).toBe('aligned');
  });

  it('is a no-op when already on the payload project', () => {
    const status = renderWith('?projectId=p2&source=push', [{ id: 'p1' }, { id: 'p2' }], 'p2');
    expect(setSelectedProject).not.toHaveBeenCalled();
    expect(status()).toBe('aligned');
  });

  it('waits (resolving) while the projects list is still empty', () => {
    const status = renderWith('?projectId=p2&source=push', [], 'p1');
    expect(setSelectedProject).not.toHaveBeenCalled();
    expect(status()).toBe('resolving');
  });

  it('reports not-member when the payload project is not in the users projects', () => {
    const status = renderWith('?projectId=pX&source=push', [{ id: 'p1' }, { id: 'p2' }], 'p1');
    expect(setSelectedProject).not.toHaveBeenCalled();
    expect(status()).toBe('not-member');
  });
});
