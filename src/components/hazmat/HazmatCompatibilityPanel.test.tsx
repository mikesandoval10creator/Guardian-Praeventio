// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HazmatCompatibilityPanel } from './HazmatCompatibilityPanel.js';
import type { HazmatItem } from '../../services/hazmat/hazmatInventory.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function item(
  id: string,
  name: string,
  classes: HazmatItem['hazardClasses'],
): HazmatItem {
  return {
    id,
    name,
    hazardClasses: classes,
    stockQty: 10,
    stockUnit: 'L',
    locationId: 'loc-A',
    requiredEpp: ['guantes nitrilo'],
  };
}

describe('<HazmatCompatibilityPanel />', () => {
  it('detecta incompatibles', () => {
    const items = [item('1', 'Gasolina', ['flammable']), item('2', 'Cloro', ['oxidizer'])];
    render(<HazmatCompatibilityPanel items={items} locationLabel="Bodega Norte" />);
    expect(screen.getByTestId('hazmat-compat-panel')).toBeInTheDocument();
    expect(screen.getByTestId('hazmat-compat-incompat').textContent).toMatch(/1/);
    expect(screen.getByTestId('hazmat-issue-0')).toBeInTheDocument();
  });

  it('almacenamiento limpio sin issues', () => {
    const items = [
      item('1', 'Aceite mineral', ['other']),
      item('2', 'Agua destilada', ['other']),
    ];
    render(<HazmatCompatibilityPanel items={items} />);
    expect(screen.getByTestId('hazmat-compat-clean')).toBeInTheDocument();
  });

  it('renderiza contador items', () => {
    const items = [item('1', 'X', ['toxic']), item('2', 'Y', ['corrosive'])];
    render(<HazmatCompatibilityPanel items={items} />);
    expect(screen.getByTestId('hazmat-compat-items').textContent).toMatch(/2/);
  });
});
