// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KpiRow } from '../../components/dashboard/KpiRow';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }) }));

describe('Responsive layout smoke', () => {
  it('KpiRow includes responsive grid classes', () => {
    render(<KpiRow items={[{ id: 'a', label: 'A', value: 1 }]} />);
    const grid = screen.getByTestId('kpi-row');
    expect(grid.className).toMatch(/grid-cols-2/);
    expect(grid.className).toMatch(/lg:grid-cols-4/);
  });
});
