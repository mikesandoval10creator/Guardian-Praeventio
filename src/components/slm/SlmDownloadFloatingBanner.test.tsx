// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { SlmDownloadFloatingBanner } from './SlmDownloadFloatingBanner.js';
import type { useSlmAcquisition } from '../../hooks/useSlmAcquisition.js';
import type {
  AcquisitionStatus,
  NetworkAdvisory,
} from '../../services/slm/slmAcquisitionService.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

type Acquisition = ReturnType<typeof useSlmAcquisition>;

function statusOf(
  state: AcquisitionStatus['state'],
  over: Partial<AcquisitionStatus> = {},
): AcquisitionStatus {
  return {
    state,
    modelId: 'phi-3-mini',
    totalBytes: 2_720_000_000,
    totalMb: 2723,
    isPrePackaged: false,
    cachedBytes: 0,
    ...over,
  };
}

function makeAcq(over: Partial<Acquisition> & { status?: AcquisitionStatus } = {}): Acquisition {
  const base: Acquisition = {
    status: over.status ?? statusOf('downloading'),
    networkAdvisory: (over.networkAdvisory ?? 'wifi') as NetworkAdvisory,
    downloadProgress: over.downloadProgress ?? 0.35,
    downloadedBytes: over.downloadedBytes ?? 952_000_000,
    error: over.error ?? null,
    downloadPhase: over.downloadPhase ?? 'active',
    retryAttempt: over.retryAttempt ?? 0,
    accept: vi.fn(async () => {}),
    postpone: vi.fn(),
    decline: vi.fn(),
    refresh: vi.fn(async () => {}),
    pause: vi.fn(),
    resume: vi.fn(async () => {}),
    retry: vi.fn(async () => {}),
  };
  return { ...base, ...over };
}

describe('<SlmDownloadFloatingBanner />', () => {
  it('no renderiza cuando state="ready"', () => {
    const acq = makeAcq({
      status: statusOf('ready'),
      downloadPhase: 'idle',
    });
    const { container } = render(<SlmDownloadFloatingBanner acquisition={acq} />);
    expect(container.firstChild).toBeNull();
  });

  it('no renderiza cuando status es null', () => {
    const acq = makeAcq();
    (acq as { status: AcquisitionStatus | null }).status = null;
    const { container } = render(<SlmDownloadFloatingBanner acquisition={acq} />);
    expect(container.firstChild).toBeNull();
  });

  it('renderiza pill con bytes + porcentaje cuando activo', () => {
    const acq = makeAcq({ downloadProgress: 0.5, downloadedBytes: 1_360_000_000 });
    render(<SlmDownloadFloatingBanner acquisition={acq} />);
    expect(screen.getByTestId('slm-floating-banner')).toBeInTheDocument();
    expect(screen.getByTestId('slm-floating-banner-bytes')).toHaveTextContent(
      /50%/,
    );
    expect(screen.getByTestId('slm-floating-banner-fill').style.width).toBe('50%');
  });

  it('estado active: muestra botón Pausar', () => {
    const acq = makeAcq({ downloadPhase: 'active' });
    render(<SlmDownloadFloatingBanner acquisition={acq} />);
    fireEvent.click(screen.getByTestId('slm-floating-banner-pause'));
    expect(acq.pause).toHaveBeenCalled();
  });

  it('estado paused: muestra botón Reanudar', () => {
    const acq = makeAcq({ downloadPhase: 'paused' });
    render(<SlmDownloadFloatingBanner acquisition={acq} />);
    fireEvent.click(screen.getByTestId('slm-floating-banner-resume'));
    expect(acq.resume).toHaveBeenCalled();
  });

  it('estado failed: muestra botón Reintentar + error', () => {
    const acq = makeAcq({ downloadPhase: 'failed', error: 'NetworkError' });
    render(<SlmDownloadFloatingBanner acquisition={acq} />);
    expect(screen.getByTestId('slm-floating-banner-error')).toHaveTextContent(
      /conectar con el servidor/i,
    );
    fireEvent.click(screen.getByTestId('slm-floating-banner-retry'));
    expect(acq.retry).toHaveBeenCalled();
  });

  it('estado retrying: muestra hint y NO permite pausar/reanudar fuera de orden', () => {
    const acq = makeAcq({ downloadPhase: 'retrying' });
    render(<SlmDownloadFloatingBanner acquisition={acq} />);
    expect(screen.getByTestId('slm-floating-banner')).toBeInTheDocument();
    expect(screen.queryByTestId('slm-floating-banner-resume')).toBeNull();
    // Durante retrying se permite pausar (cancela el backoff).
    expect(screen.getByTestId('slm-floating-banner-pause')).toBeInTheDocument();
  });

  it('offline hint visible cuando network==offline y no paused', () => {
    const acq = makeAcq({ networkAdvisory: 'offline', downloadPhase: 'retrying' });
    render(<SlmDownloadFloatingBanner acquisition={acq} />);
    expect(
      screen.getByTestId('slm-floating-banner-offline-hint'),
    ).toBeInTheDocument();
  });

  it('tap abre detalle modal', () => {
    const acq = makeAcq();
    render(<SlmDownloadFloatingBanner acquisition={acq} />);
    fireEvent.click(screen.getByTestId('slm-floating-banner-open'));
    expect(screen.getByTestId('slm-acquisition-prompt')).toBeInTheDocument();
  });
});
