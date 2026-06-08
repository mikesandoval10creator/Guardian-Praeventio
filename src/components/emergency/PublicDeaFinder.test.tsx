// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));

const getDocsMock = vi.fn();
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, name: string) => ({ name })),
  getDocs: (...args: unknown[]) => getDocsMock(...args),
}));
vi.mock('../../services/firebase', () => ({ db: {} }));

import { PublicDeaFinder } from './PublicDeaFinder';

function snap(docs: Array<{ id: string; data: Record<string, unknown> }>) {
  return { docs: docs.map((d) => ({ id: d.id, data: () => d.data })) };
}

beforeEach(() => {
  getDocsMock.mockReset();
  Object.defineProperty(global.navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (ok: PositionCallback) =>
        ok({ coords: { latitude: -33.45, longitude: -70.66 } } as GeolocationPosition),
    },
  });
});
afterEach(cleanup);

describe('PublicDeaFinder (#4 Step 3 — anonymous nearest-AED)', () => {
  it('reads dea_locations and shows the nearest AED + its public status', async () => {
    getDocsMock.mockResolvedValue(
      snap([
        { id: 'far', data: { location: 'Bodega', coordinates: { lat: -33.5, lng: -70.7 }, status: 'operational' } },
        {
          id: 'near',
          data: { location: 'Recepción Principal', coordinates: { lat: -33.451, lng: -70.661 }, status: 'warning' },
        },
      ]),
    );
    render(<PublicDeaFinder />);
    fireEvent.click(screen.getByTestId('public-dea-find'));
    await waitFor(() => expect(screen.getByTestId('public-nearest-dea-result')).toBeTruthy());
    // The nearer one wins, and its status comes straight from the public doc.
    expect(screen.getByText('Recepción Principal')).toBeTruthy();
    expect(screen.getByText('Por vencer')).toBeTruthy();
  });

  it('tells the bystander when no AED has a registered location', async () => {
    getDocsMock.mockResolvedValue(snap([{ id: 'x', data: { location: 'Sin coords', status: 'operational' } }]));
    render(<PublicDeaFinder />);
    fireEvent.click(screen.getByTestId('public-dea-find'));
    await waitFor(() => expect(screen.getByText(/Ningún DEA tiene ubicación/)).toBeTruthy());
  });

  it('shows a friendly error if the public registry read fails', async () => {
    getDocsMock.mockRejectedValue(new Error('permission-denied'));
    render(<PublicDeaFinder />);
    fireEvent.click(screen.getByTestId('public-dea-find'));
    await waitFor(() => expect(screen.getByText(/No pudimos cargar el mapa/)).toBeTruthy());
  });
});
