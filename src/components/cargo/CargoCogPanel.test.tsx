// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CargoCogPanel } from './CargoCogPanel.js';
import type {
  Container,
  PlacedItem,
} from '../../services/cargo/stowageOptimizer.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

const container: Container = {
  dimensions: { x: 10, y: 4, z: 3 },
  maxPayloadKg: 5000,
};

const balanced: PlacedItem[] = [
  {
    item: { id: 'a', dimensions: { x: 2, y: 2, z: 1 }, mass: 1000 },
    position: { x: 4, y: 1, z: 0 },
  },
];

const skewed: PlacedItem[] = [
  {
    item: { id: 'a', dimensions: { x: 1, y: 1, z: 1 }, mass: 1500 },
    position: { x: 0, y: 0, z: 0 },
  },
];

describe('<CargoCogPanel />', () => {
  it('renderiza SVG y marker COG', () => {
    render(<CargoCogPanel container={container} placedItems={balanced} />);
    expect(screen.getByTestId('cargo-cog-panel')).toBeInTheDocument();
    expect(screen.getByTestId('cargo-cog-svg')).toBeInTheDocument();
    expect(screen.getByTestId('cargo-cog-marker')).toBeInTheDocument();
    expect(screen.getByTestId('cargo-cog-safezone')).toBeInTheDocument();
  });

  it('badge SEGURO cuando COG dentro tolerancia', () => {
    render(<CargoCogPanel container={container} placedItems={balanced} />);
    expect(screen.getByTestId('cargo-cog-safe-badge').textContent).toBe('SEGURO');
  });

  it('badge REVISAR cuando COG fuera tolerancia', () => {
    render(<CargoCogPanel container={container} placedItems={skewed} />);
    expect(screen.getByTestId('cargo-cog-safe-badge').textContent).toBe('REVISAR');
    expect(screen.getByTestId('cargo-cog-warnings')).toBeInTheDocument();
  });

  it('renderiza utilization volumen + masa + altura', () => {
    render(<CargoCogPanel container={container} placedItems={balanced} />);
    expect(screen.getByTestId('cargo-util-volume')).toBeInTheDocument();
    expect(screen.getByTestId('cargo-util-mass')).toBeInTheDocument();
    expect(screen.getByTestId('cargo-cog-height')).toBeInTheDocument();
  });

  it('warning overweight', () => {
    const heavy: PlacedItem[] = [
      {
        item: { id: 'h', dimensions: { x: 1, y: 1, z: 1 }, mass: 10_000 },
        position: { x: 4, y: 1, z: 0 },
      },
    ];
    render(<CargoCogPanel container={container} placedItems={heavy} />);
    expect(screen.getByTestId('cargo-overweight-warning')).toBeInTheDocument();
  });

  it('renderiza footprint por cada item', () => {
    render(<CargoCogPanel container={container} placedItems={balanced} />);
    expect(screen.getByTestId('cargo-item-footprint-a')).toBeInTheDocument();
  });
});
