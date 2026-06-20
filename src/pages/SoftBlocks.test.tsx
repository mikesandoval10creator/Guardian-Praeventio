// @vitest-environment jsdom
//
// Praeventio Guard — Fase F.17 page wrapper smoke test.
//
// Cubre:
//   1. Empty state cuando no hay proyecto.
//   2. Render soft_block + lista de requirements unsatisfied.
//   3. Card cannot_override muestra alerta sin botón.
//   4. Empty state cuando no hay bloqueos (todos pass).
//   5. Botón override abre el form.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SoftBlocks, type ActiveSoftBlock } from './SoftBlocks';
import type { RequirementCheck } from '../services/softBlocking/requirementGate';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, fallback?: string | Record<string, unknown>, opts?: Record<string, unknown>) => {
      if (typeof fallback === 'string') {
        if (opts && typeof opts === 'object') {
          let out = fallback;
          for (const [key, val] of Object.entries(opts)) {
            out = out.replace(`{{${key}}}`, String(val));
          }
          return out;
        }
        return fallback;
      }
      return k;
    },
  }),
}));

let mockSelectedProject: { id: string; name: string } | null = null;
let mockIsOnline = true;

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));

function check(over: Partial<RequirementCheck> = {}): RequirementCheck {
  return {
    requirement: {
      id: 'r-training',
      kind: 'training',
      label: 'Capacitación altura',
      isMandatory: true,
      citation: 'DS 594',
    },
    status: 'missing',
    ...over,
  };
}

beforeEach(() => {
  mockSelectedProject = null;
  mockIsOnline = true;
});

describe('<SoftBlocks /> (Fase F.17)', () => {
  it('renderiza empty cuando no hay proyecto', () => {
    render(<SoftBlocks blocks={[]} />);
    expect(screen.getByTestId('soft-blocks-page-empty')).toBeInTheDocument();
  });

  it('renderiza empty success cuando se consultó y NO hay bloqueos activos (blocks=[])', () => {
    mockSelectedProject = { id: 'p1', name: 'Norte' };
    render(<SoftBlocks blocks={[]} />);
    expect(screen.getByTestId('soft-blocks-empty-state')).toBeInTheDocument();
    expect(screen.getByText(/Sin bloqueos activos/i)).toBeInTheDocument();
  });

  it('feed NO cableado (blocks=undefined): muestra empty-state honesto, NUNCA falso "todo OK"', () => {
    mockSelectedProject = { id: 'p1', name: 'Norte' };
    // App.tsx monta <SoftBlocks /> sin props → blocks === undefined.
    render(<SoftBlocks />);
    // Estado honesto "feed no conectado" presente.
    expect(
      screen.getByTestId('soft-blocks-page-feed-unavailable'),
    ).toBeInTheDocument();
    expect(screen.getByText(/aún no está conectado/i)).toBeInTheDocument();
    // Y NO el falso all-clear verde "Sin bloqueos activos".
    expect(
      screen.queryByTestId('soft-blocks-empty-state'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Sin bloqueos activos/i)).not.toBeInTheDocument();
  });

  it('muestra card de soft_block con lista de requirements y botón override', () => {
    mockSelectedProject = { id: 'p1', name: 'Norte' };
    const block: ActiveSoftBlock = {
      id: 'b1',
      title: 'Cuadrilla A — Altura',
      evaluatedAt: '2026-05-17T12:00:00Z',
      checks: [check()],
    };
    render(<SoftBlocks blocks={[block]} />);
    expect(screen.getByTestId('soft-block-card-b1')).toBeInTheDocument();
    // El label aparece tanto en <RequirementGatePanel> como en la lista
    // detallada del card → ≥1 ocurrencia.
    expect(screen.getAllByText(/Capacitación altura/i).length).toBeGreaterThan(0);
    expect(screen.getByTestId('soft-block-override-btn-b1')).toBeInTheDocument();
  });

  it('cannot_override muestra alerta sin botón', () => {
    mockSelectedProject = { id: 'p1', name: 'Norte' };
    const block: ActiveSoftBlock = {
      id: 'b2',
      title: 'LOTO sin verificación',
      evaluatedAt: '2026-05-17T12:00:00Z',
      checks: [
        check({
          requirement: {
            id: 'r-loto',
            kind: 'critical_control_verification',
            label: 'Verificación LOTO',
            isMandatory: true,
          },
        }),
      ],
    };
    render(<SoftBlocks blocks={[block]} />);
    expect(screen.getByTestId('soft-block-cannot-override-b2')).toBeInTheDocument();
    expect(screen.queryByTestId('soft-block-override-btn-b2')).not.toBeInTheDocument();
  });

  it('abre el form cuando se clickea override', () => {
    mockSelectedProject = { id: 'p1', name: 'Norte' };
    const block: ActiveSoftBlock = {
      id: 'b1',
      title: 'Cuadrilla A',
      evaluatedAt: '2026-05-17T12:00:00Z',
      checks: [check()],
    };
    render(<SoftBlocks blocks={[block]} />);
    fireEvent.click(screen.getByTestId('soft-block-override-btn-b1'));
    expect(screen.getByTestId('soft-block-override-form')).toBeInTheDocument();
    expect(screen.getByTestId('soft-block-form-uid')).toBeInTheDocument();
    expect(screen.getByTestId('soft-block-form-reason')).toBeInTheDocument();
  });

  it('valida razón ≥20 chars y dispara onOverride al confirmar', () => {
    mockSelectedProject = { id: 'p1', name: 'Norte' };
    const block: ActiveSoftBlock = {
      id: 'b1',
      title: 'Cuadrilla A',
      evaluatedAt: '2026-05-17T12:00:00Z',
      checks: [check()],
    };
    const onOverride = vi.fn();
    render(<SoftBlocks blocks={[block]} onOverride={onOverride} />);
    fireEvent.click(screen.getByTestId('soft-block-override-btn-b1'));
    // Razón corta → error.
    fireEvent.change(screen.getByTestId('soft-block-form-uid'), { target: { value: 'supervisor-1' } });
    fireEvent.change(screen.getByTestId('soft-block-form-reason'), { target: { value: 'corta' } });
    fireEvent.click(screen.getByTestId('soft-block-form-submit'));
    expect(screen.getByTestId('soft-block-form-error')).toBeInTheDocument();
    expect(onOverride).not.toHaveBeenCalled();
    // Razón válida → confirma.
    fireEvent.change(screen.getByTestId('soft-block-form-reason'), {
      target: { value: 'Trabajador con cert renovada off-system; subiremos hoy.' },
    });
    fireEvent.click(screen.getByTestId('soft-block-form-submit'));
    expect(onOverride).toHaveBeenCalledTimes(1);
    expect(onOverride.mock.calls[0][0]).toBe('b1');
    expect(onOverride.mock.calls[0][1].authorizingUid).toBe('supervisor-1');
  });

  it('muestra chip offline', () => {
    mockSelectedProject = { id: 'p1', name: 'Norte' };
    mockIsOnline = false;
    render(<SoftBlocks blocks={[]} />);
    expect(screen.getByTestId('soft-blocks-offline-chip')).toBeInTheDocument();
  });
});
