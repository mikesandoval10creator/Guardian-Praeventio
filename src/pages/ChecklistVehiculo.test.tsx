// @vitest-environment jsdom
// Thin host test: the page owns vehicle-kind + response state and renders the
// controlled VehiclePreOpChecklistCard (whose checklist behavior + the
// validatePreOpChecklist engine are covered by their own tests). Here we only
// assert the page hosts the card and its kind selector.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChecklistVehiculo } from './ChecklistVehiculo';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, fb?: string) => fb ?? _k }),
}));

describe('ChecklistVehiculo (hosts the vehicle pre-op checklist)', () => {
  it('renders the pre-op card and the vehicle-kind selector', () => {
    render(<ChecklistVehiculo />);
    expect(screen.getByTestId('vehicle-preop-card')).toBeTruthy();
    expect(screen.getByTestId('preop-items')).toBeTruthy();
    // kind selector shows the vehicle options
    expect(screen.getByText('Camioneta')).toBeTruthy();
  });
});
