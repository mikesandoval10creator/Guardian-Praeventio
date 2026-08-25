// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ModuleGroupsGrid } from './ModuleGroupsGrid';
import { moduleGroups } from './moduleGroups';
import { hubsData } from '../../pages/ModuleHub';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }) }));

function LocationDisplay() {
  const l = useLocation();
  return <div data-testid="loc">{l.pathname}</div>;
}

function renderGrid() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <ModuleGroupsGrid />
      <LocationDisplay />
    </MemoryRouter>,
  );
}

describe('ModuleGroupsGrid (carrusel → página dedicada, glove-friendly)', () => {
  it('expone cada grupo UNA sola vez a accesibilidad (la copia del marquee es aria-hidden)', () => {
    renderGrid();
    const first = moduleGroups[0];
    const matches = screen.getAllByRole('button', { name: new RegExp(first.title, 'i') });
    expect(matches.length).toBe(1);
  });
  it('el heading no fuerza uppercase ni usa zinc hardcodeado', () => {
    const { container } = renderGrid();
    const heading = screen.getByRole('heading', { name: /módulos/i });
    expect(heading.className).not.toMatch(/uppercase/);
    expect(container.innerHTML).not.toMatch(/dark:text-white/);
  });
  // [Hy3-audit 3c4aa66d-73fe-8172-a14d-d88f510a03d5 reabierto 2026-08-24]:
  // Old test only clicked moduleGroups[0]; broken destinations for the
  // other 9 would slip through. Add a parametrized assertion of catalog
  // exhaustivity so a missing hubsData[id] for any group fails the test.
  //
  // it.fails because 4 groups (knowledge/ai-coach/innovation/administration)
  // are currently missing from hubsData — see ticket
  // 3c4aa66d-73fe-8193-... (Navegación rota a 4 hubs) which tracks the
  // server/UI fix. When that lands, switch it.fails → it again.
  it.fails('every moduleGroup has a corresponding hub in hubsData (exhaustividad del catálogo)', () => {
    expect(moduleGroups.length).toBeGreaterThan(1);
    const missing = moduleGroups.filter((g) => !hubsData[g.id]);
    expect(missing).toEqual([]);
  });
  it('al tocar CADA grupo se navega a /hub/:id (parametrized, not only first)', () => {
    expect(moduleGroups.length).toBeGreaterThan(0);
    for (const g of moduleGroups) {
      // Each iteration: fresh render so click handlers reset.
      const { unmount } = renderGrid();
      const btn = screen.getByRole('button', { name: new RegExp(g.title, 'i') });
      fireEvent.click(btn);
      expect(screen.getByTestId('loc').textContent).toBe(`/hub/${g.id}`);
      unmount();
    }
  });
});
