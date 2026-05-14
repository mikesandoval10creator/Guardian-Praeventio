// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SlmAcquisitionPrompt } from './SlmAcquisitionPrompt.js';
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

function defaultProps(over: {
  status?: AcquisitionStatus;
  network?: NetworkAdvisory;
} = {}) {
  return {
    status: over.status ?? statusOf('needs_prompt'),
    networkAdvisory: over.network ?? 'wifi',
    onAccept: vi.fn(),
    onPostpone: vi.fn(),
    onDecline: vi.fn(),
  };
}

describe('<SlmAcquisitionPrompt />', () => {
  it('state="ready": no renderiza nada', () => {
    const { container } = render(
      <SlmAcquisitionPrompt {...defaultProps({ status: statusOf('ready') })} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('state="declined": no renderiza nada', () => {
    const { container } = render(
      <SlmAcquisitionPrompt {...defaultProps({ status: statusOf('declined') })} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('state="postponed": no renderiza nada', () => {
    const { container } = render(
      <SlmAcquisitionPrompt {...defaultProps({ status: statusOf('postponed') })} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('state="needs_prompt": modal visible con size + network', () => {
    render(<SlmAcquisitionPrompt {...defaultProps()} />);
    expect(screen.getByTestId('slm-acquisition-prompt')).toBeInTheDocument();
    expect(screen.getByTestId('slm-acq-size')).toHaveTextContent('2723 MB');
    expect(screen.getByTestId('slm-acq-network')).toHaveTextContent(/WiFi/);
  });

  it('WiFi: NO cellular warning', () => {
    render(<SlmAcquisitionPrompt {...defaultProps({ network: 'wifi' })} />);
    expect(screen.queryByTestId('slm-acq-cellular-warning')).toBeNull();
  });

  it('cellular: warning visible con tamaño', () => {
    render(<SlmAcquisitionPrompt {...defaultProps({ network: 'cellular' })} />);
    expect(screen.getByTestId('slm-acq-cellular-warning')).toBeInTheDocument();
    expect(screen.getByTestId('slm-acq-cellular-warning')).toHaveTextContent(
      /2723 MB/,
    );
  });

  it('offline: warning visible + accept disabled', () => {
    render(<SlmAcquisitionPrompt {...defaultProps({ network: 'offline' })} />);
    expect(screen.getByTestId('slm-acq-offline-warning')).toBeInTheDocument();
    expect(screen.getByTestId('slm-acq-accept')).toBeDisabled();
  });

  it('onAccept dispara al click descargar', () => {
    const props = defaultProps();
    render(<SlmAcquisitionPrompt {...props} />);
    fireEvent.click(screen.getByTestId('slm-acq-accept'));
    expect(props.onAccept).toHaveBeenCalledTimes(1);
  });

  it('onPostpone dispara al click después', () => {
    const props = defaultProps();
    render(<SlmAcquisitionPrompt {...props} />);
    fireEvent.click(screen.getByTestId('slm-acq-postpone'));
    expect(props.onPostpone).toHaveBeenCalledTimes(1);
  });

  it('onDecline dispara al click solo modo online', () => {
    const props = defaultProps();
    render(<SlmAcquisitionPrompt {...props} />);
    fireEvent.click(screen.getByTestId('slm-acq-decline'));
    expect(props.onDecline).toHaveBeenCalledTimes(1);
  });

  it('onDismiss: X button cuando no está descargando', () => {
    const onDismiss = vi.fn();
    render(
      <SlmAcquisitionPrompt {...defaultProps()} onDismiss={onDismiss} />,
    );
    fireEvent.click(screen.getByTestId('slm-acq-dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('sin onDismiss: X button oculto', () => {
    render(<SlmAcquisitionPrompt {...defaultProps()} />);
    expect(screen.queryByTestId('slm-acq-dismiss')).toBeNull();
  });

  it('state="downloading": muestra progreso, oculta botones de elección', () => {
    render(
      <SlmAcquisitionPrompt
        {...defaultProps({ status: statusOf('downloading') })}
        downloadProgress={0.42}
        downloadedBytes={1_143_240_000}
      />,
    );
    expect(screen.getByTestId('slm-acq-downloading')).toBeInTheDocument();
    expect(screen.getByTestId('slm-acq-progress-fill').style.width).toBe('42%');
    expect(screen.getByTestId('slm-acq-progress-bytes')).toHaveTextContent(
      '1090 MB / 2723 MB',
    );
    // No accept/postpone/decline buttons while downloading.
    expect(screen.queryByTestId('slm-acq-accept')).toBeNull();
    expect(screen.queryByTestId('slm-acq-postpone')).toBeNull();
    expect(screen.queryByTestId('slm-acq-decline')).toBeNull();
  });

  it('downloading: dismiss button NO disponible (no cancelable)', () => {
    render(
      <SlmAcquisitionPrompt
        {...defaultProps({ status: statusOf('downloading') })}
        onDismiss={vi.fn()}
        downloadProgress={0.5}
      />,
    );
    expect(screen.queryByTestId('slm-acq-dismiss')).toBeNull();
  });

  it('progressPct capado a 0..100', () => {
    const { rerender } = render(
      <SlmAcquisitionPrompt
        {...defaultProps({ status: statusOf('downloading') })}
        downloadProgress={-0.1}
      />,
    );
    expect(screen.getByTestId('slm-acq-progress-fill').style.width).toBe('0%');

    rerender(
      <SlmAcquisitionPrompt
        {...defaultProps({ status: statusOf('downloading') })}
        downloadProgress={1.5}
      />,
    );
    expect(screen.getByTestId('slm-acq-progress-fill').style.width).toBe('100%');
  });

  it('cellular en networkAdvisory: stats muestran "Datos móviles"', () => {
    render(<SlmAcquisitionPrompt {...defaultProps({ network: 'cellular' })} />);
    expect(screen.getByTestId('slm-acq-network')).toHaveTextContent(
      /Datos móviles/,
    );
  });

  it('unknown network: stats muestran fallback', () => {
    render(<SlmAcquisitionPrompt {...defaultProps({ network: 'unknown' })} />);
    expect(screen.getByTestId('slm-acq-network')).toHaveTextContent(
      /no detectado/,
    );
  });
});
