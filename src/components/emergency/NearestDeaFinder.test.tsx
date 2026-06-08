// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));

import { NearestDeaFinder } from './NearestDeaFinder';
import type { Dea } from '../../services/dea/deaService';

function makeDea(id: string, coordinates?: { lat: number; lng: number }): Dea {
  return {
    id,
    location: id,
    description: '',
    batteryExpiry: '2027-01-01',
    padsExpiry: '2027-01-01',
    lastCheck: '2026-05-01',
    assignedToUid: 'u',
    assignedToName: 'r',
    createdAt: '2026-01-01',
    createdBy: 'u',
    coordinates,
  };
}

beforeEach(() => {
  Object.defineProperty(global.navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (ok: PositionCallback) =>
        ok({ coords: { latitude: -33.45, longitude: -70.66 } } as GeolocationPosition),
    },
  });
});
afterEach(cleanup);

describe('NearestDeaFinder', () => {
  it('finds and shows the nearest DEA (with coordinates) + the distance', async () => {
    const deas = [
      makeDea('far', { lat: -33.5, lng: -70.7 }),
      makeDea('near', { lat: -33.451, lng: -70.661 }),
    ];
    render(<NearestDeaFinder deas={deas} />);
    fireEvent.click(screen.getByText('Buscar el DEA más cercano'));
    await waitFor(() => expect(screen.getByTestId('nearest-dea-result')).toBeTruthy());
    expect(screen.getByText('near')).toBeTruthy();
  });

  it('tells the user when no DEA has a registered location', async () => {
    render(<NearestDeaFinder deas={[makeDea('a'), makeDea('b')]} />);
    fireEvent.click(screen.getByText('Buscar el DEA más cercano'));
    await waitFor(() => expect(screen.getByText(/Ningún DEA tiene ubicación/)).toBeTruthy());
  });
});
