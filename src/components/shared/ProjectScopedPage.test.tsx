// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Praeventio Guard — Plan 2026-05-23 Fase B.3 — tests del shell component.
//
// Mismo enfoque hand-rolled que useProjectFirestoreCollection.test.tsx
// (`@testing-library/dom` peer falta en node_modules local — spawn-task
// creado para restaurarlo).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

let currentSelected: { id: string } | null = null;
vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: currentSelected }),
}));

import { ProjectScopedPage } from './ProjectScopedPage';

function renderInDom(ui: React.ReactElement): {
  container: HTMLElement;
  unmount: () => void;
  rerender: (next: React.ReactElement) => void;
} {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root | null = null;
  act(() => {
    root = createRoot(container);
    root.render(ui);
  });
  return {
    container,
    rerender: (next) => {
      act(() => {
        root?.render(next);
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

describe('ProjectScopedPage', () => {
  beforeEach(() => {
    currentSelected = null;
  });

  describe('project gate', () => {
    it('sin proyecto + !allowAnonymous → renderea EmptyState + NO renderea children', () => {
      currentSelected = null;
      const { container, unmount } = renderInDom(
        <ProjectScopedPage title="Test">
          <div data-testid="child-content">contenido</div>
        </ProjectScopedPage>,
      );
      expect(container.textContent).toContain('Selecciona un proyecto');
      expect(container.querySelector('[data-testid="child-content"]')).toBeNull();
      unmount();
    });

    it('sin proyecto + allowAnonymous=true → renderea children igual', () => {
      currentSelected = null;
      const { container, unmount } = renderInDom(
        <ProjectScopedPage title="Test" allowAnonymous>
          <div data-testid="child-content">contenido</div>
        </ProjectScopedPage>,
      );
      expect(container.querySelector('[data-testid="child-content"]')).not.toBeNull();
      unmount();
    });

    it('projectIdOverride bypassa el gate aunque selectedProject sea null', () => {
      currentSelected = null;
      const { container, unmount } = renderInDom(
        <ProjectScopedPage title="Test" projectIdOverride="forced-id">
          <div data-testid="child-content">contenido</div>
        </ProjectScopedPage>,
      );
      expect(container.querySelector('[data-testid="child-content"]')).not.toBeNull();
      unmount();
    });

    it('CTA del empty state dispara el callback', () => {
      currentSelected = null;
      const onClick = vi.fn();
      const { container, unmount } = renderInDom(
        <ProjectScopedPage
          title="Test"
          emptyProjectActionLabel="Ver proyectos"
          onEmptyProjectAction={onClick}
        >
          <div>nope</div>
        </ProjectScopedPage>,
      );
      const btn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Ver proyectos'),
      );
      expect(btn).toBeDefined();
      act(() => {
        btn?.click();
      });
      expect(onClick).toHaveBeenCalledTimes(1);
      unmount();
    });
  });

  describe('header', () => {
    beforeEach(() => {
      currentSelected = { id: 'p1' };
    });

    it('renderea title como h1', () => {
      const { container, unmount } = renderInDom(
        <ProjectScopedPage title="Stoppages Activas">
          <div>x</div>
        </ProjectScopedPage>,
      );
      const h1 = container.querySelector('h1');
      expect(h1?.textContent).toBe('Stoppages Activas');
      unmount();
    });

    it('renderea description cuando se pasa', () => {
      const { container, unmount } = renderInDom(
        <ProjectScopedPage title="X" description="sub copy">
          <div>x</div>
        </ProjectScopedPage>,
      );
      expect(container.textContent).toContain('sub copy');
      unmount();
    });

    it('renderea actions slot', () => {
      const { container, unmount } = renderInDom(
        <ProjectScopedPage
          title="X"
          actions={<button data-testid="hdr-cta">Nuevo</button>}
        >
          <div>x</div>
        </ProjectScopedPage>,
      );
      expect(container.querySelector('[data-testid="hdr-cta"]')).not.toBeNull();
      unmount();
    });
  });

  describe('loading state', () => {
    beforeEach(() => {
      currentSelected = { id: 'p1' };
    });

    it('loading=true → renderea spinner y NO children', () => {
      const { container, unmount } = renderInDom(
        <ProjectScopedPage title="X" loading>
          <div data-testid="child-content">contenido</div>
        </ProjectScopedPage>,
      );
      expect(
        container.querySelector('[data-testid="project-scoped-page-loading"]'),
      ).not.toBeNull();
      expect(container.querySelector('[data-testid="child-content"]')).toBeNull();
      unmount();
    });

    it('loading=false → renderea children y NO spinner', () => {
      const { container, unmount } = renderInDom(
        <ProjectScopedPage title="X" loading={false}>
          <div data-testid="child-content">contenido</div>
        </ProjectScopedPage>,
      );
      expect(
        container.querySelector('[data-testid="project-scoped-page-loading"]'),
      ).toBeNull();
      expect(container.querySelector('[data-testid="child-content"]')).not.toBeNull();
      unmount();
    });
  });

  describe('error banner', () => {
    beforeEach(() => {
      currentSelected = { id: 'p1' };
    });

    it('error=null → no renderea el banner', () => {
      const { container, unmount } = renderInDom(
        <ProjectScopedPage title="X">
          <div>x</div>
        </ProjectScopedPage>,
      );
      expect(container.querySelector('[data-testid="data-load-error-banner"]')).toBeNull();
      unmount();
    });

    it('error definido → renderea banner sobre el content', () => {
      const { container, unmount } = renderInDom(
        <ProjectScopedPage
          title="X"
          error={new Error('boom')}
          errorResourceLabel="paradas"
        >
          <div data-testid="child-content">contenido</div>
        </ProjectScopedPage>,
      );
      expect(
        container.querySelector('[data-testid="data-load-error-banner"]'),
      ).not.toBeNull();
      // El banner es non-blocking — children siguen renderizados.
      expect(container.querySelector('[data-testid="child-content"]')).not.toBeNull();
      unmount();
    });
  });

  describe('children passthrough con proyecto', () => {
    it('renderea children sin gates extra', () => {
      currentSelected = { id: 'p1' };
      const { container, unmount } = renderInDom(
        <ProjectScopedPage title="Y">
          <ul>
            <li data-testid="row-1">A</li>
            <li data-testid="row-2">B</li>
          </ul>
        </ProjectScopedPage>,
      );
      expect(container.querySelector('[data-testid="row-1"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="row-2"]')).not.toBeNull();
      unmount();
    });
  });
});
