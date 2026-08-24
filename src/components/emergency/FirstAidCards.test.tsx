// @vitest-environment jsdom
//
// Verifica el fix del Hy3-audit 3c3aa66d-73fe-8190-bd55-e66a8dd5d43f:
// cuando se detiene el metrónomo con la guía de profundidad activa,
// depthCheckActive debe pasar a false y stopAccel() debe invocarse.
// Sin esto, el acelerómetro seguía corriendo sin UI visible tras
// apagar el metrónomo.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

// Mock useAccelerometer para devolver stubs que podemos espiar.
const stopAccelMock = vi.fn();
const startAccelMock = vi.fn();

vi.mock('../../hooks/useAccelerometer', () => ({
  useAccelerometer: () => ({
    data: null,
    start: startAccelMock,
    stop: stopAccelMock,
  }),
}));

// navigator.vibrate y speechSynthesis no existen en jsdom — stubs seguros.
Object.defineProperty(window.navigator, 'vibrate', {
  value: vi.fn(),
  writable: true,
  configurable: true,
});
Object.defineProperty(window, 'speechSynthesis', {
  value: { speak: vi.fn(), cancel: vi.fn() },
  writable: true,
  configurable: true,
});
// El metrónomo usa Web Audio API para emitir el beep; jsdom no la provee.
class FakeAudioContext {
  currentTime = 0;
  destination = {};
  close = vi.fn().mockResolvedValue(undefined);
  createOscillator() {
    return {
      connect: vi.fn(),
      frequency: { value: 0 },
      type: 'sine',
      start: vi.fn(),
      stop: vi.fn(),
    };
  }
  createGain() {
    return {
      connect: vi.fn(),
      gain: { value: 0 },
    };
  }
}
Object.defineProperty(window, 'AudioContext', {
  value: FakeAudioContext,
  writable: true,
  configurable: true,
});

import { FirstAidCards } from './FirstAidCards.js';

beforeEach(() => {
  stopAccelMock.mockClear();
  startAccelMock.mockClear();
  cleanup();
});

describe('FirstAidCards — depthCheckActive se resetea al detener metrónomo', () => {
  it('al detener metrónomo con depth activo, llama stopAccel para liberar el sensor', () => {
    render(<FirstAidCards />);

    // 1. Abrir la guía RCP (necesaria para ver el metrónomo).
    fireEvent.click(screen.getByText(/RCP \(Reanimación/i));
    // 2. Iniciar el metrónomo.
    fireEvent.click(screen.getByRole('button', { name: /Iniciar Metrónomo/i }));
    // 3. Activar la guía de profundidad (maniquí).
    const activateDepthBtn = screen.getByRole('button', {
      name: /Activar Guía de Profundidad/i,
    });
    fireEvent.click(activateDepthBtn);

    // El label debe haber cambiado a "Desactivar".
    expect(
      screen.getByRole('button', { name: /Desactivar Guía/i }),
    ).toBeInTheDocument();

    // Resetear el contador para medir SOLO las llamadas del fix.
    stopAccelMock.mockClear();

    // 4. Detener el metrónomo (con depth activo).
    fireEvent.click(screen.getByRole('button', { name: /Detener Metrónomo/i }));

    // El fix: al detener el metrónomo con depth activo, stopAccel()
    // debe invocarse para liberar el acelerómetro. Sin el fix, el
    // sensor quedaba corriendo sin UI visible.
    expect(stopAccelMock).toHaveBeenCalledTimes(1);
  });

  it('al detener metrónomo SIN depth activo, NO llama stopAccel', () => {
    render(<FirstAidCards />);

    // 1. Abrir la guía RCP + iniciar el metrónomo (sin activar depth).
    fireEvent.click(screen.getByText(/RCP \(Reanimación/i));
    fireEvent.click(screen.getByRole('button', { name: /Iniciar Metrónomo/i }));

    // 2. Resetear contadores y detener.
    stopAccelMock.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Detener Metrónomo/i }));

    // No había depth activa → stopAccel no debe invocarse.
    expect(stopAccelMock).not.toHaveBeenCalled();
  });
});