// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

const mockDeleteCachedModel = vi.fn(async () => {});
vi.mock('../../services/slm/cache/modelCache', () => ({
  deleteCachedModel: (...args: unknown[]) => mockDeleteCachedModel(...args),
  getCachedModelBytes: vi.fn(async () => 0),
  loadCachedModel: vi.fn(async () => null),
}));

// We mock the hook so the manager doesn't trigger the real state-machine
// path which would try to read localStorage + cache.
let currentHookValue: ReturnType<typeof makeAcqShape>;
function makeAcqShape() {
  return {
    status: {
      state: 'ready' as const,
      modelId: 'phi-3-mini',
      totalBytes: 2_720_000_000,
      totalMb: 2723,
      isPrePackaged: false,
      cachedBytes: 2_720_000_000,
    },
    networkAdvisory: 'wifi' as const,
    downloadProgress: 0,
    downloadedBytes: 0,
    error: null as string | null,
    downloadPhase: 'idle' as const,
    retryAttempt: 0,
    accept: vi.fn(async () => {}),
    postpone: vi.fn(),
    decline: vi.fn(),
    refresh: vi.fn(async () => {}),
    pause: vi.fn(),
    resume: vi.fn(async () => {}),
    retry: vi.fn(async () => {}),
  };
}

vi.mock('../../hooks/useSlmAcquisition', () => ({
  useSlmAcquisition: () => currentHookValue,
}));

import { SlmManagerScreen } from './SlmManagerScreen.js';

beforeEach(() => {
  currentHookValue = makeAcqShape();
  mockDeleteCachedModel.mockClear();
});

describe('<SlmManagerScreen />', () => {
  it('muestra el modelo activo y estado ready', () => {
    render(<SlmManagerScreen />);
    expect(screen.getByTestId('slm-manager-screen')).toBeInTheDocument();
    expect(screen.getByTestId('slm-manager-current')).toBeInTheDocument();
    expect(screen.getByTestId('slm-manager-current-state')).toHaveTextContent(
      /Listo/,
    );
  });

  it('lista todos los modelos registrados y permite seleccionar uno no-gated', () => {
    render(<SlmManagerScreen />);
    expect(screen.getByTestId('slm-manager-model-phi-3-mini')).toBeInTheDocument();
    expect(screen.getByTestId('slm-manager-model-qwen-2.5-0.5b')).toBeInTheDocument();
    expect(screen.getByTestId('slm-manager-model-gemma-2-2b')).toBeInTheDocument();
    expect(
      screen.getByTestId('slm-manager-select-qwen-2.5-0.5b'),
    ).not.toBeDisabled();
  });

  it('botón "Seleccionar" deshabilitado para modelos gated', () => {
    render(<SlmManagerScreen />);
    expect(screen.getByTestId('slm-manager-select-gemma-2-2b')).toBeDisabled();
  });

  it('modelo en uso queda como "En uso" y deshabilitado', () => {
    render(<SlmManagerScreen />);
    expect(screen.getByTestId('slm-manager-select-phi-3-mini')).toBeDisabled();
    expect(screen.getByTestId('slm-manager-select-phi-3-mini')).toHaveTextContent(
      /En uso/,
    );
  });

  it('borrar el modelo invoca deleteCachedModel + muestra mensaje', async () => {
    render(<SlmManagerScreen />);
    fireEvent.click(screen.getByTestId('slm-manager-delete'));
    await waitFor(() => {
      expect(mockDeleteCachedModel).toHaveBeenCalledWith('phi-3-mini');
    });
    expect(currentHookValue.refresh).toHaveBeenCalled();
  });

  it('volver a descargar invoca accept del hook', () => {
    render(<SlmManagerScreen />);
    fireEvent.click(screen.getByTestId('slm-manager-redownload'));
    expect(currentHookValue.accept).toHaveBeenCalled();
  });

  it('fase active: muestra progreso + botón pausar', () => {
    currentHookValue = {
      ...makeAcqShape(),
      downloadPhase: 'active',
      downloadProgress: 0.42,
      downloadedBytes: 1_142_000_000,
      status: {
        state: 'downloading',
        modelId: 'phi-3-mini',
        totalBytes: 2_720_000_000,
        totalMb: 2723,
        isPrePackaged: false,
        cachedBytes: 0,
      },
    };
    render(<SlmManagerScreen />);
    expect(screen.getByTestId('slm-manager-progress')).toBeInTheDocument();
    expect(screen.getByTestId('slm-manager-progress-fill').style.width).toBe(
      '42%',
    );
    fireEvent.click(screen.getByTestId('slm-manager-pause'));
    expect(currentHookValue.pause).toHaveBeenCalled();
  });

  it('fase failed: muestra error + botón reintentar', () => {
    currentHookValue = {
      ...makeAcqShape(),
      downloadPhase: 'failed',
      error: 'Timeout',
      status: {
        state: 'needs_prompt',
        modelId: 'phi-3-mini',
        totalBytes: 2_720_000_000,
        totalMb: 2723,
        isPrePackaged: false,
        cachedBytes: 0,
      },
    };
    render(<SlmManagerScreen />);
    expect(screen.getByTestId('slm-manager-error')).toHaveTextContent('Timeout');
    fireEvent.click(screen.getByTestId('slm-manager-retry'));
    expect(currentHookValue.retry).toHaveBeenCalled();
  });

  it('needs_prompt sin actividad: muestra botón "Descargar ahora"', () => {
    currentHookValue = {
      ...makeAcqShape(),
      status: {
        state: 'needs_prompt',
        modelId: 'phi-3-mini',
        totalBytes: 2_720_000_000,
        totalMb: 2723,
        isPrePackaged: false,
        cachedBytes: 0,
      },
    };
    render(<SlmManagerScreen />);
    fireEvent.click(screen.getByTestId('slm-manager-start'));
    expect(currentHookValue.accept).toHaveBeenCalled();
  });

  it('respeta allowedModelIds: deshabilita seleccionar modelos fuera del tier', () => {
    render(<SlmManagerScreen allowedModelIds={['phi-3-mini']} />);
    expect(
      screen.getByTestId('slm-manager-select-qwen-2.5-0.5b'),
    ).toBeDisabled();
  });

  it('NO renderiza enlaces externos (sin <a href>)', () => {
    const { container } = render(<SlmManagerScreen />);
    expect(container.querySelectorAll('a[href]')).toHaveLength(0);
  });
});
