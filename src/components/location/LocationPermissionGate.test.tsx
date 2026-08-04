// @vitest-environment jsdom
// Flujo completo del gate de divulgación: la divulgación SIEMPRE precede al
// prompt del SO, y el prompt solo se dispara tras la aceptación del usuario.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const requestPermissionsMock = vi
  .fn()
  .mockResolvedValue({ location: 'granted', coarseLocation: 'granted' });

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
}));

vi.mock('@capacitor/geolocation', () => ({
  Geolocation: {
    checkPermissions: vi
      .fn()
      .mockResolvedValue({ location: 'prompt', coarseLocation: 'prompt' }),
    requestPermissions: requestPermissionsMock,
  },
}));

describe('LocationPermissionGate', () => {
  beforeEach(() => {
    localStorage.clear();
    requestPermissionsMock.mockClear();
    vi.resetModules();
  });

  it('muestra la divulgación en plataforma nativa cuando el permiso no está concedido', async () => {
    const { LocationPermissionGate } = await import('./LocationPermissionGate');
    render(<LocationPermissionGate />);
    await waitFor(() => {
      expect(screen.getByTestId('location-disclosure-modal')).toBeInTheDocument();
    });
    // El prompt del SO NO se disparó antes de la divulgación.
    expect(requestPermissionsMock).not.toHaveBeenCalled();
  });

  it('NO muestra la divulgación si el permiso ya está concedido', async () => {
    const geolocation = await import('@capacitor/geolocation');
    vi.mocked(geolocation.Geolocation.checkPermissions).mockResolvedValueOnce({
      location: 'granted',
      coarseLocation: 'granted',
    });
    const { LocationPermissionGate } = await import('./LocationPermissionGate');
    render(<LocationPermissionGate />);
    await waitFor(() => {
      expect(screen.queryByTestId('location-disclosure-modal')).not.toBeInTheDocument();
    });
    expect(requestPermissionsMock).not.toHaveBeenCalled();
  });

  it('aceptar la divulgación dispara el prompt del SO y persiste el consentimiento', async () => {
    const { LocationPermissionGate } = await import('./LocationPermissionGate');
    render(<LocationPermissionGate />);
    await waitFor(() => {
      expect(screen.getByTestId('location-disclosure-modal')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId('location-disclosure-accept'));
    expect(requestPermissionsMock).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('guardian.locationDisclosureAcknowledged.v1')).toBe('true');
    await waitFor(() => {
      expect(screen.queryByTestId('location-disclosure-modal')).not.toBeInTheDocument();
    });
  });

  it('cerrar sin aceptar NO dispara el prompt del SO', async () => {
    const { LocationPermissionGate } = await import('./LocationPermissionGate');
    render(<LocationPermissionGate />);
    await waitFor(() => {
      expect(screen.getByTestId('location-disclosure-modal')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId('location-disclosure-dismiss'));
    expect(requestPermissionsMock).not.toHaveBeenCalled();
    expect(localStorage.getItem('guardian.locationDisclosureAcknowledged.v1')).toBeNull();
    await waitFor(() => {
      expect(screen.queryByTestId('location-disclosure-modal')).not.toBeInTheDocument();
    });
  });
});
