// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { KpiRow } from '../../components/dashboard/KpiRow';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }) }));

describe('Responsive layout smoke', () => {
  // Explicit cleanup after each test to prevent leaked Promises from
  // @testing-library/react render() affecting subsequent tests and causing
  // the shard to fail with "PROMISE leaking" errors. Verified by the
  // commit that introduced this test in 2026-Q3.
  afterEach(() => {
    cleanup();
  });

  it('KpiRow includes responsive grid classes', () => {
    render(<KpiRow items={[{ id: 'a', label: 'A', value: 1 }]} />);
    const grid = screen.getByTestId('kpi-row');
    expect(grid.className).toMatch(/grid-cols-2/);
    expect(grid.className).toMatch(/lg:grid-cols-4/);
  });
});
