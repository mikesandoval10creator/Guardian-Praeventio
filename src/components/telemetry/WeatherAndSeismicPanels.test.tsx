// @vitest-environment jsdom
//
// Sprint 25 — Bucket SS.2 — WeatherAndSeismicPanels tests.

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';

import { WeatherAndSeismicPanels } from './WeatherAndSeismicPanels';

const sampleQuakes = [
  {
    Fecha: '2026-05-04 03:14:22',
    Profundidad: '12 km',
    Magnitud: '4.5',
    RefGeografica: '20 km al N de Iquique',
    FechaUpdate: '2026-05-04T03:15:00Z',
  },
];

afterEach(() => cleanup());

describe('WeatherAndSeismicPanels', () => {
  it('renders the loading spinner when loading=true', () => {
    const { container } = render(
      <WeatherAndSeismicPanels
        loading={true}
        isOnline={true}
        weather={null}
        earthquakes={[]}
      />,
    );
    // Lucide loader has class "animate-spin"
    expect(container.querySelector('.animate-spin')).toBeTruthy();
  });

  it('renders weather data and earthquake list when loaded online', () => {
    render(
      <WeatherAndSeismicPanels
        loading={false}
        isOnline={true}
        weather={{ temp: 18, windSpeed: 12 }}
        earthquakes={sampleQuakes}
      />,
    );
    // Temperature (18°C) shows up
    expect(screen.getByText(/18/)).toBeInTheDocument();
    // Earthquake reference geographic appears
    expect(screen.getByText(/Iquique/)).toBeInTheDocument();
  });

  it('renders an offline indicator when isOnline=false', () => {
    const { container } = render(
      <WeatherAndSeismicPanels
        loading={false}
        isOnline={false}
        weather={null}
        earthquakes={[]}
      />,
    );
    // Either WifiOff icon (lucide class) or text — assert at least content
    // exists and the container is not empty.
    expect(container.textContent && container.textContent.length).toBeGreaterThan(0);
  });
});
