// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ModuleGroupsGrid } from './ModuleGroupsGrid';
import { moduleGroups } from './moduleGroups';

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
  it('al tocar un grupo NAVEGA a su hub dedicado /hub/:id (sin cajón inline)', () => {
    renderGrid();
    const first = moduleGroups[0];
    fireEvent.click(screen.getByRole('button', { name: new RegExp(first.title, 'i') }));
    expect(screen.getByTestId('loc').textContent).toBe(`/hub/${first.id}`);
  });
});
