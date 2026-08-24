// @vitest-environment jsdom
//
// Verifica que TacticalSimulation3D usa ErrorBoundary como red de seguridad
// alrededor del <Canvas> WebGL, de modo que un crash de driver/context-loss
// no tumbe toda la UI de emergencia. El Canvas se mockea porque jsdom no
// provee WebGL; el mock lanza un error para simular un driver crash.
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

beforeAll(() => {
  // Silenciar el error que React loguea cuando ErrorBoundary captura una excepción;
  // sin esto el test runner muestra un "console.error" ruidoso que enmascara el
  // resultado real.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

// Mock de @react-three/fiber: Canvas siempre lanza para simular WebGL crash.
// Permite verificar que el ErrorBoundary silent evita que el árbol padre caiga.
vi.mock('@react-three/fiber', () => ({
  Canvas: () => {
    throw new Error('WebGL context lost');
  },
  useFrame: vi.fn(),
}));

// Mock de @react-three/drei: necesario porque el componente importa varios
// helpers (OrbitControls, Box, etc.) que internamente consumen r3f.
vi.mock('@react-three/drei', () => ({
  OrbitControls: () => null,
  Box: () => null,
  Sphere: () => null,
  Cylinder: () => null,
  Text: () => null,
}));

import { TacticalSimulation3D } from './TacticalSimulation3D.js';

describe('TacticalSimulation3D — ErrorBoundary en Canvas WebGL', () => {
  it('NO propaga el crash del Canvas al árbol padre (silent boundary)', () => {
    // Renderizamos el componente — Canvas tira, ErrorBoundary captura.
    // Si NO hubiera ErrorBoundary, `render()` lanzaría y el test fallaría.
    expect(() => render(<TacticalSimulation3D />)).not.toThrow();

    // El ErrorBoundary silent muestra "Module temporarily inactive" (i18n en)
    // en lugar del full-screen error page, así que el padre sigue montado y
    // navegable.
    expect(
      screen.getByText(/module temporarily inactive/i),
    ).toBeInTheDocument();
  });
});