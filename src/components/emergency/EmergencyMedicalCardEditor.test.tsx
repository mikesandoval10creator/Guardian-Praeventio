// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const saveCard = vi.fn().mockResolvedValue({});
let mockCard: { shareConsent: boolean; bloodType?: string; allergies?: string } = { shareConsent: false };

vi.mock('../../hooks/useEmergencyMedicalCard', () => ({
  BLOOD_TYPES: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
  useEmergencyMedicalCard: () => ({ card: mockCard, saveCard, loading: false }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));

import { EmergencyMedicalCardEditor } from './EmergencyMedicalCardEditor';

beforeEach(() => {
  saveCard.mockClear();
  mockCard = { shareConsent: false };
});
afterEach(cleanup);

describe('EmergencyMedicalCardEditor', () => {
  it('persists the blood type + opt-in consent the worker selects', () => {
    render(<EmergencyMedicalCardEditor />);
    fireEvent.click(screen.getByRole('button', { name: 'O-' }));
    fireEvent.click(screen.getByRole('checkbox')); // grant consent
    fireEvent.click(screen.getByText('Guardar ficha'));
    expect(saveCard).toHaveBeenCalledWith(
      expect.objectContaining({ bloodType: 'O-', shareConsent: true }),
    );
  });

  it('does NOT consent by default — sharing stays off until explicitly granted', () => {
    render(<EmergencyMedicalCardEditor />);
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByText('Guardar ficha'));
    expect(saveCard).toHaveBeenCalledWith(expect.objectContaining({ shareConsent: false }));
  });
});
