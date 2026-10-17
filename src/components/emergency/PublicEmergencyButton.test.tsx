// @vitest-environment jsdom
//
// Prototype-recovery #1: the public, no-login emergency affordance. Proves a
// crisis user reaches emergency CALLS + offline first-aid from the marketing
// landing without authenticating, and that the panel is self-contained (no
// AppProviders). i18n + the heavy offline surfaces are mocked so the test stays
// on this component's behaviour.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { HTMLAttributes, ReactNode } from 'react';

// These tests exercise menu/country state; animation promises belong to the
// browser suite and must not outlive component cleanup in jsdom.
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: {
    div: ({ initial: _initial, animate: _animate, exit: _exit, ...props }:
      HTMLAttributes<HTMLDivElement> & { initial?: unknown; animate?: unknown; exit?: unknown }) => <div {...props} />,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));
vi.mock('./FirstAidCards', () => ({
  FirstAidCards: () => <div data-testid="first-aid-cards">FirstAid</div>,
}));
vi.mock('./SurvivalMode', () => ({
  SurvivalMode: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="survival-mode">
      <button type="button" onClick={onClose}>
        close-survival
      </button>
    </div>
  ),
}));
vi.mock('./PublicDeaFinder', () => ({
  PublicDeaFinder: () => <div data-testid="public-dea-finder">DEA</div>,
}));

import { PublicEmergencyButton } from './PublicEmergencyButton';

afterEach(cleanup);

const telHrefs = () =>
  screen
    .queryAllByRole('link')
    .map((a) => a.getAttribute('href') ?? '')
    .filter((h) => h.startsWith('tel:'));

describe('PublicEmergencyButton — no-login emergency access', () => {
  it('requires an explicit country before showing calls, keeping offline help available', () => {
    render(<PublicEmergencyButton />);
    fireEvent.click(screen.getByTestId('public-emergency-trigger'));

    expect(telHrefs()).toEqual([]);
    expect(screen.getByRole('combobox', { name: 'País donde estás' })).toHaveValue('');
    fireEvent.click(screen.getByText('Primeros auxilios'));
    expect(screen.getByTestId('first-aid-cards')).toBeTruthy();
    fireEvent.click(screen.getByText('Volver'));
    fireEvent.click(screen.getByText('Modo supervivencia'));
    expect(screen.getByTestId('survival-mode')).toBeTruthy();
    fireEvent.click(screen.getByText('close-survival'));
    fireEvent.click(screen.getByTestId('public-emergency-dea'));
    expect(screen.getByTestId('public-dea-finder')).toBeTruthy();
  });

  it('uses the selected country and removes calls when the country is cleared or the panel is reopened', () => {
    render(<PublicEmergencyButton />);
    fireEvent.click(screen.getByTestId('public-emergency-trigger'));
    const country = screen.getByRole('combobox', { name: 'País donde estás' });
    fireEvent.change(country, { target: { value: 'US' } });
    expect(telHrefs()).toEqual(['tel:911', 'tel:911', 'tel:911']);
    fireEvent.change(country, { target: { value: '' } });
    expect(telHrefs()).toEqual([]);
    fireEvent.change(country, { target: { value: 'CL' } });
    expect(telHrefs()).toContain('tel:131');
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    fireEvent.click(screen.getByTestId('public-emergency-trigger'));
    expect(telHrefs()).toEqual([]);
  });

  it('renders a floating trigger and opens emergency CALL links for confirmed Chile', () => {
    render(<PublicEmergencyButton />);
    const trigger = screen.getByTestId('public-emergency-trigger');
    expect(trigger).toBeTruthy();

    fireEvent.click(trigger);
    fireEvent.change(screen.getByRole('combobox', { name: 'País donde estás' }), { target: { value: 'CL' } });

    const hrefs = telHrefs();
    expect(hrefs.length).toBe(3);
    // Chile emergency numbers: ambulancia 131, bomberos 132, carabineros 133.
    expect(hrefs.join(' ')).toContain('131');
    expect(hrefs.join(' ')).toContain('132');
    expect(hrefs.join(' ')).toContain('133');
  });

  it('opens offline first-aid, returns to the menu, and opens survival mode', () => {
    render(<PublicEmergencyButton />);
    fireEvent.click(screen.getByTestId('public-emergency-trigger'));

    // First aid sub-view.
    fireEvent.change(screen.getByRole('combobox', { name: 'País donde estás' }), { target: { value: 'CL' } });
    fireEvent.click(screen.getByText('Primeros auxilios'));
    expect(screen.getByTestId('first-aid-cards')).toBeTruthy();

    // Back to the menu — call links are visible again.
    fireEvent.click(screen.getByText('Volver'));
    expect(telHrefs().length).toBe(3);

    // Survival mode renders its own overlay; its onClose returns to the menu.
    fireEvent.click(screen.getByText('Modo supervivencia'));
    expect(screen.getByTestId('survival-mode')).toBeTruthy();
    fireEvent.click(screen.getByText('close-survival'));
    expect(telHrefs().length).toBe(3);
  });

  it('does not require any AppProviders/auth context to render', () => {
    // The render above would throw if the component used useProject/useFirebase/
    // useEmergency without a provider — it does not, which is the whole point.
    expect(() => render(<PublicEmergencyButton />)).not.toThrow();
  });
});
