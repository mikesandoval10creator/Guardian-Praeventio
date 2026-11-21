// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GaussianSplatViewer } from './GaussianSplatViewer.js';
import {
  buildEvacuationPathOverlay,
  buildMeetingPointOverlay,
  type SplatCapture,
} from '../../services/digitalTwin/gaussianSplatRegistry.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

const engine = vi.hoisted(() => ({ create: vi.fn(), destroy: vi.fn() }));
vi.mock('playcanvas', () => ({
  Application: class {
    constructor(canvas: HTMLCanvasElement) { engine.create(canvas); }
    destroy() { engine.destroy(); }
  },
}));

function capture(over: Partial<SplatCapture> = {}): SplatCapture {
  return {
    id: 'c1',
    projectId: 'p1',
    capturedAt: new Date().toISOString(),
    capturedByUid: 'u1',
    format: 'splat',
    storageUrl: 'gs://x.splat',
    sizeBytes: 100 * 1024 * 1024,
    splatCount: 1_500_000,
    extentMeters: 100,
    centerCoords: { lat: -33.45, lng: -70.66 },
    isCanonical: true,
    ...over,
  };
}

describe('<GaussianSplatViewer />', () => {
  it('empty si no hay captura', () => {
    render(<GaussianSplatViewer capture={null} />);
    expect(screen.getByTestId('splat-viewer-empty')).toBeInTheDocument();
  });

  it('renderiza metadata + quality badge', () => {
    render(<GaussianSplatViewer capture={capture()} />);
    expect(screen.getByTestId('splat-viewer')).toBeInTheDocument();
    expect(screen.getByTestId('splat-quality-badge')).toBeInTheDocument();
  });

  it('muestra 5 presets cardinales', () => {
    render(<GaussianSplatViewer capture={capture()} />);
    expect(screen.getByTestId('splat-preset-north')).toBeInTheDocument();
    expect(screen.getByTestId('splat-preset-south')).toBeInTheDocument();
    expect(screen.getByTestId('splat-preset-east')).toBeInTheDocument();
    expect(screen.getByTestId('splat-preset-west')).toBeInTheDocument();
    expect(screen.getByTestId('splat-preset-top')).toBeInTheDocument();
  });

  it('onRender3D dispara al clickear preset', () => {
    const onRender = vi.fn();
    render(<GaussianSplatViewer capture={capture()} onRender3D={onRender} />);
    fireEvent.click(screen.getByTestId('splat-preset-north'));
    expect(onRender).toHaveBeenCalledTimes(1);
    expect(onRender.mock.calls[0][1].id).toBe('north');
  });

  it('renderiza overlays con ruta + path length', () => {
    const overlays = [
      buildEvacuationPathOverlay('ev1', [
        { x: 0, y: 0, z: 0 },
        { x: 3, y: 0, z: 4 },
      ]),
      buildMeetingPointOverlay('mp1', { x: 0, y: 0, z: 0 }, 'Punto A'),
    ];
    render(<GaussianSplatViewer capture={capture()} overlays={overlays} />);
    expect(screen.getByTestId('splat-overlays')).toBeInTheDocument();
    expect(screen.getByTestId('splat-overlay-ev1')).toBeInTheDocument();
    expect(screen.getByTestId('splat-overlay-mp1')).toBeInTheDocument();
    // Path tiene metros + segundos
    const ev1 = screen.getByTestId('splat-overlay-ev1');
    expect(ev1.textContent).toMatch(/m · /);
  });

  it('muestra issues si calidad baja', () => {
    render(<GaussianSplatViewer capture={capture({ splatCount: 50_000 })} />);
    expect(screen.getByTestId('splat-quality-issues')).toBeInTheDocument();
  });

  it('botón abrir 3D solo si isViewable', () => {
    render(<GaussianSplatViewer capture={capture()} />);
    expect(screen.getByTestId('splat-open-3d')).toBeInTheDocument();
  });

  it('termina la carga al inicializar el canvas y libera el motor al cerrar la vista', async () => {
    engine.create.mockClear();
    engine.destroy.mockClear();
    const view = render(<GaussianSplatViewer capture={capture()} />);
    expect(engine.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('splat-open-3d'));
    expect(screen.getByTestId('splat-engine-loading')).toBeInTheDocument();
    const canvas = await screen.findByRole('img', { name: 'Canvas 3D del visor' });
    expect(engine.create).toHaveBeenCalledExactlyOnceWith(canvas);
    expect(screen.queryByTestId('splat-engine-loading')).not.toBeInTheDocument();
    view.unmount();
    expect(engine.destroy).toHaveBeenCalledTimes(1);
  });

  it('conserva el motor al refrescar metadatos y lo libera al cambiar de captura', async () => {
    engine.create.mockClear();
    engine.destroy.mockClear();
    const original = capture();
    const view = render(<GaussianSplatViewer capture={original} />);
    fireEvent.click(screen.getByTestId('splat-open-3d'));
    const canvas = await screen.findByRole('img', { name: 'Canvas 3D del visor' });
    view.rerender(<GaussianSplatViewer capture={{ ...original, notes: 'updated' }} />);
    expect(screen.getByRole('img', { name: 'Canvas 3D del visor' })).toBe(canvas);
    expect(engine.destroy).not.toHaveBeenCalled();

    view.rerender(<GaussianSplatViewer capture={{ ...original, id: 'c2' }} />);
    expect(canvas).not.toBeInTheDocument();
    expect(engine.destroy).toHaveBeenCalledTimes(1);
    expect(engine.create).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('splat-open-3d'));
    expect(await screen.findByRole('img', { name: 'Canvas 3D del visor' })).not.toBe(canvas);
    expect(engine.create).toHaveBeenCalledTimes(2);
  });

  it('sale de la carga si el navegador no puede inicializar el motor', async () => {
    engine.create.mockImplementationOnce(() => { throw new Error('no graphics device'); });
    render(<GaussianSplatViewer capture={capture()} />);
    fireEvent.click(screen.getByTestId('splat-open-3d'));
    await waitFor(() => expect(screen.getByTestId('splat-engine-unavailable')).toBeInTheDocument());
    expect(screen.queryByTestId('splat-engine-loading')).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Canvas 3D del visor' })).not.toBeInTheDocument();
  });
});
