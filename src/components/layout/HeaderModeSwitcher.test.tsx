// @vitest-environment jsdom
// src/components/layout/HeaderModeSwitcher.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../contexts/AppModeContext', () => ({
  useAppMode: () => ({
    mode: 'normal', appearance: 'light',
    setMode: vi.fn(), setAppearance: vi.fn(), dismissEmergency: vi.fn(),
    emergencyAutoExpiresAt: null, emergencyAutoEvent: null,
  }),
  AppMode: {}, AppAppearance: {},
}));

import { HeaderModeSwitcher } from './HeaderModeSwitcher';

describe('HeaderModeSwitcher', () => {
  it('renderiza el botón trigger cerrado por defecto', () => {
    render(<HeaderModeSwitcher />);
    expect(screen.getByLabelText('Cambiar modo de visualización')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Selector de modo de UX' })).toBeNull();
  });
  it('abre el popover con los 4 modos al click', () => {
    render(<HeaderModeSwitcher />);
    fireEvent.click(screen.getByLabelText('Cambiar modo de visualización'));
    expect(screen.getByRole('group', { name: 'Selector de modo de UX' })).toBeInTheDocument();
  });
});
