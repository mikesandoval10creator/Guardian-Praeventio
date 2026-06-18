// @vitest-environment jsdom
// Thin host test: the page mounts the self-contained BucklingCalculatorCard
// (the card's form/engine behavior + the criticalLoad engine are covered by
// their own tests). Here we only assert the page hosts the calculator.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CalculadoraPandeo } from './CalculadoraPandeo';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, fb?: string) => fb ?? _k }),
}));

describe('CalculadoraPandeo (hosts the Euler buckling calculator)', () => {
  it('renders the buckling calculator card with its inputs', () => {
    render(<CalculadoraPandeo />);
    expect(screen.getByTestId('buckling-card')).toBeTruthy();
    expect(screen.getByTestId('buckling-material')).toBeTruthy();
    expect(screen.getByTestId('buckling-length')).toBeTruthy();
  });
});
