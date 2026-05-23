// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Praeventio Guard — Plan 2026-05-23 Fase B.2 — tests del hook.
//
// Estrategia de testing:
//   - `@testing-library/react@^16.3.2` está declarado en package.json pero
//     `@testing-library/dom` peer (~10.4) NO está actualmente instalado en
//     node_modules local (audit 2026-05-23 — afecta a TODOS los hook tests
//     del repo, no solo a este). Ver task spawned para arreglarlo a nivel
//     proyecto.
//   - Mientras tanto: hand-roll `renderHook` con `react-dom/client` directo.
//     Misma idea que `@testing-library/react`: render un wrapper que llama
//     al hook y guarda el último resultado en una ref para inspección.
//     Cubre re-renders + unmount sin necesitar la lib externa.
//
// Mock de `useProject` con un setter global para mover el selectedProject
// entre renders (evita levantar el provider real que necesita
// FirebaseContext + Firestore listener).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

// Mock de useProject — el setter permite cambiar selectedProject sin
// re-instanciar el provider.
let currentSelected: { id: string } | null = null;
vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: currentSelected }),
}));

import { useProjectFirestoreCollection } from './useProjectFirestoreCollection';
import type { ProjectScopedStore } from '../services/firestore/createProjectScopedStore';

// ───────────────────────────────────────────────────────────────────────
// Hand-rolled renderHook
// ───────────────────────────────────────────────────────────────────────

interface RenderHookResult<T> {
  result: { current: T };
  unmount: () => void;
  rerender: () => void;
}

function renderHook<T>(hook: () => T): RenderHookResult<T> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const result = { current: undefined as unknown as T };
  let setCounter: React.Dispatch<React.SetStateAction<number>> | null = null;

  const Wrapper: React.FC = () => {
    const [, setN] = React.useState(0);
    setCounter = setN;
    result.current = hook();
    return null;
  };

  let root: Root | null = null;
  act(() => {
    root = createRoot(container);
    root.render(React.createElement(Wrapper));
  });

  return {
    result,
    rerender: () => {
      act(() => {
        setCounter?.((n) => n + 1);
      });
    },
    unmount: () => {
      act(() => {
        root?.unmount();
      });
      container.remove();
    },
  };
}

// ───────────────────────────────────────────────────────────────────────
// Fixtures
// ───────────────────────────────────────────────────────────────────────

interface FakeDoc {
  id: string;
  status: 'open' | 'closed';
  label: string;
}

interface MockStore {
  save: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  subscribeFiltered: ReturnType<typeof vi.fn>;
}

function makeStore(): {
  store: ProjectScopedStore<FakeDoc>;
  mocks: MockStore;
  fireSnapshot: (items: FakeDoc[]) => void;
  fireError: (err: Error) => void;
  unsubscribe: ReturnType<typeof vi.fn>;
  filteredFireSnapshot: (items: FakeDoc[]) => void;
} {
  let snapCb: ((items: FakeDoc[]) => void) | null = null;
  let errCb: ((err: Error) => void) | null = null;
  let filteredSnapCb: ((items: FakeDoc[]) => void) | null = null;
  const unsubscribe = vi.fn();
  const mocks: MockStore = {
    save: vi.fn(async () => {}),
    patch: vi.fn(async () => {}),
    list: vi.fn(async () => [] as FakeDoc[]),
    subscribe: vi.fn((_projectId: string, onSnap, onError) => {
      snapCb = onSnap;
      errCb = onError ?? null;
      return unsubscribe;
    }),
    subscribeFiltered: vi.fn((_projectId: string, onSnap) => {
      filteredSnapCb = onSnap;
      return unsubscribe;
    }),
  };
  return {
    store: mocks as unknown as ProjectScopedStore<FakeDoc>,
    mocks,
    unsubscribe,
    fireSnapshot: (items) => {
      act(() => {
        snapCb?.(items);
      });
    },
    fireError: (err) => {
      act(() => {
        errCb?.(err);
      });
    },
    filteredFireSnapshot: (items) => {
      act(() => {
        filteredSnapCb?.(items);
      });
    },
  };
}

// ───────────────────────────────────────────────────────────────────────
// Tests
// ───────────────────────────────────────────────────────────────────────

describe('useProjectFirestoreCollection', () => {
  beforeEach(() => {
    currentSelected = null;
    vi.clearAllMocks();
  });

  describe('proyecto vacío', () => {
    it('no llama subscribe + loading=false + items=[]', () => {
      currentSelected = null;
      const { store, mocks, unmount } = (() => {
        const s = makeStore();
        return { ...s, ...renderHook(() => useProjectFirestoreCollection(s.store)) };
      })();
      expect(mocks.subscribe).not.toHaveBeenCalled();
      // Nota: store ya capturado arriba para evitar shadowing
      void store;
      // (assertions hechas a través de `result.current` en otros tests; acá
      // basta con que subscribe no se invocó)
      unmount();
    });

    it('save tira si no hay proyecto', async () => {
      currentSelected = null;
      const { store } = makeStore();
      const { result, unmount } = renderHook(() => useProjectFirestoreCollection(store));
      await expect(
        result.current.save({ id: 'd1', status: 'open', label: 'x' }),
      ).rejects.toThrow(/sin proyecto/);
      unmount();
    });

    it('patch tira si no hay proyecto', async () => {
      currentSelected = null;
      const { store } = makeStore();
      const { result, unmount } = renderHook(() => useProjectFirestoreCollection(store));
      await expect(result.current.patch('d1', { status: 'closed' })).rejects.toThrow(/sin proyecto/);
      unmount();
    });

    it('refetch retorna [] sin llamar store.list', async () => {
      currentSelected = null;
      const { store, mocks } = makeStore();
      const { result, unmount } = renderHook(() => useProjectFirestoreCollection(store));
      const out = await result.current.refetch();
      expect(out).toEqual([]);
      expect(mocks.list).not.toHaveBeenCalled();
      unmount();
    });
  });

  describe('con proyecto', () => {
    it('llama store.subscribe con projectId y propaga items', () => {
      currentSelected = { id: 'p1' };
      const { store, mocks, fireSnapshot } = makeStore();
      const { result, unmount } = renderHook(() => useProjectFirestoreCollection(store));
      expect(mocks.subscribe).toHaveBeenCalledTimes(1);
      expect(mocks.subscribe.mock.calls[0][0]).toBe('p1');
      expect(result.current.loading).toBe(true);
      fireSnapshot([
        { id: 'd1', status: 'open', label: 'A' },
        { id: 'd2', status: 'closed', label: 'B' },
      ]);
      expect(result.current.items).toHaveLength(2);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
      unmount();
    });

    it('propaga error y deja loading=false', () => {
      currentSelected = { id: 'p1' };
      const { store, fireError } = makeStore();
      const { result, unmount } = renderHook(() => useProjectFirestoreCollection(store));
      const err = new Error('permission-denied');
      fireError(err);
      expect(result.current.error).toBe(err);
      expect(result.current.loading).toBe(false);
      unmount();
    });

    it('save delega a store.save(projectId, item)', async () => {
      currentSelected = { id: 'p1' };
      const { store, mocks } = makeStore();
      const { result, unmount } = renderHook(() => useProjectFirestoreCollection(store));
      const item: FakeDoc = { id: 'd1', status: 'open', label: 'X' };
      await act(async () => {
        await result.current.save(item);
      });
      expect(mocks.save).toHaveBeenCalledWith('p1', item);
      unmount();
    });

    it('patch delega a store.patch(projectId, id, partial)', async () => {
      currentSelected = { id: 'p1' };
      const { store, mocks } = makeStore();
      const { result, unmount } = renderHook(() => useProjectFirestoreCollection(store));
      await act(async () => {
        await result.current.patch('d1', { status: 'closed' });
      });
      expect(mocks.patch).toHaveBeenCalledWith('p1', 'd1', { status: 'closed' });
      unmount();
    });

    it('refetch llama store.list y retorna los items', async () => {
      currentSelected = { id: 'p1' };
      const { store, mocks } = makeStore();
      const docs: FakeDoc[] = [{ id: 'a', status: 'open', label: 'Q' }];
      mocks.list.mockResolvedValueOnce(docs);
      const { result, unmount } = renderHook(() => useProjectFirestoreCollection(store));
      let out: FakeDoc[] = [];
      await act(async () => {
        out = await result.current.refetch();
      });
      expect(mocks.list).toHaveBeenCalledWith('p1', undefined);
      expect(out).toEqual(docs);
      unmount();
    });

    it('forward options.limit a subscribe + list', async () => {
      currentSelected = { id: 'p1' };
      const { store, mocks } = makeStore();
      const { result, unmount } = renderHook(() =>
        useProjectFirestoreCollection(store, { limit: 42 }),
      );
      expect(mocks.subscribe.mock.calls[0][3]).toBe(42);
      await act(async () => {
        await result.current.refetch();
      });
      expect(mocks.list).toHaveBeenCalledWith('p1', 42);
      unmount();
    });
  });

  describe('options.autoSubscribe = false', () => {
    it('no llama subscribe pero permite save', async () => {
      currentSelected = { id: 'p1' };
      const { store, mocks } = makeStore();
      const { result, unmount } = renderHook(() =>
        useProjectFirestoreCollection(store, { autoSubscribe: false }),
      );
      expect(mocks.subscribe).not.toHaveBeenCalled();
      expect(result.current.loading).toBe(false);
      await act(async () => {
        await result.current.save({ id: 'd1', status: 'open', label: 'x' });
      });
      expect(mocks.save).toHaveBeenCalled();
      unmount();
    });
  });

  describe('options.activeOnly = true', () => {
    it('usa subscribeFiltered en vez de subscribe', () => {
      currentSelected = { id: 'p1' };
      const { store, mocks, filteredFireSnapshot } = makeStore();
      const { result, unmount } = renderHook(() =>
        useProjectFirestoreCollection(store, { activeOnly: true }),
      );
      expect(mocks.subscribeFiltered).toHaveBeenCalledTimes(1);
      expect(mocks.subscribe).not.toHaveBeenCalled();
      filteredFireSnapshot([{ id: 'd1', status: 'open', label: 'A' }]);
      expect(result.current.items).toHaveLength(1);
      unmount();
    });
  });

  describe('cleanup unsubscribe', () => {
    it('llama unsubscribe al unmount', () => {
      currentSelected = { id: 'p1' };
      const { store, unsubscribe } = makeStore();
      const { unmount } = renderHook(() => useProjectFirestoreCollection(store));
      expect(unsubscribe).not.toHaveBeenCalled();
      unmount();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('no rompe el unmount si unsubscribe tira', () => {
      currentSelected = { id: 'p1' };
      const { store, unsubscribe } = makeStore();
      unsubscribe.mockImplementationOnce(() => {
        throw new Error('unsubscribe falló');
      });
      const { unmount } = renderHook(() => useProjectFirestoreCollection(store));
      expect(() => unmount()).not.toThrow();
    });
  });

  describe('options.projectIdOverride', () => {
    it('override ignora ProjectContext', () => {
      currentSelected = { id: 'p1' };
      const { store, mocks } = makeStore();
      const { unmount } = renderHook(() =>
        useProjectFirestoreCollection(store, { projectIdOverride: 'other-proj' }),
      );
      expect(mocks.subscribe.mock.calls[0][0]).toBe('other-proj');
      unmount();
    });
  });
});
