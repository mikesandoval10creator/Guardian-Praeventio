// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../hooks/useNativeCompass', () => ({
  useNativeCompass: () => ({
    compassData: null,
    isActive: false,
    permissions: { location: 'unknown', sensors: 'unknown' },
    location: null,
    error: null,
    startCompass: vi.fn().mockResolvedValue(true),
    stopCompass: vi.fn(),
    calibrateCompass: vi.fn(),
    requestPermissions: vi.fn().mockResolvedValue(true),
    getDirectionName: (h: number) =>
      ['Norte', 'Noreste', 'Este', 'Sureste', 'Sur', 'Suroeste', 'Oeste', 'Noroeste'][
        Math.round(h / 45) % 8
      ],
    getDirectionAbbr: (h: number) =>
      ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(h / 45) % 8],
    isSupported: true,
    isReady: false,
    hasLocationPermission: false,
  }),
}));

// Mock Capacitor
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}));

describe('NativeCompass', () => {
  it('renders the trigger button', async () => {
    const { NativeCompass } = await import('./NativeCompass');
    render(<NativeCompass />);
    expect(screen.getByTestId('native-compass')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /brújula|compass/i })).toBeInTheDocument();
  });

  it('shows compass panel when button is clicked', async () => {
    const { NativeCompass } = await import('./NativeCompass');
    render(<NativeCompass />);
    const btn = screen.getByRole('button', { name: /abrir brújula/i });
    await userEvent.click(btn);
    expect(screen.getByTestId('compass-panel')).toBeInTheDocument();
  });

  it('shows sensors initializing message when no compass data', async () => {
    const { NativeCompass } = await import('./NativeCompass');
    render(<NativeCompass />);
    const btn = screen.getByRole('button', { name: /abrir brújula/i });
    await userEvent.click(btn);
    // Panel is shown, sensors initializing message visible
    expect(screen.getByText(/Iniciando sensores/)).toBeInTheDocument();
  });
});
